'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { DOC_LABELS, type StaffRole } from '@/config/sites/types';
import { MANAGERS, SITE_COOKIE, normalisePhone, requireUser } from '@/lib/auth';
import { docsForRules, loadDocuments, loadShifts, loadStaff, staffForRules } from '@/lib/data';
import { assignmentBlocks } from '@/lib/rules/eligibility';
import { DAY, addDays, at } from '@/lib/time';
import type { StaffRow } from '@/lib/types';

const str = (form: FormData, key: string) => String(form.get(key) ?? '').trim();
const orNull = (v: string) => (v === '' ? null : v);

function go(path: string, kind: 'error' | 'notice', message: string): never {
  revalidatePath('/', 'layout');
  redirect(`${path}${path.includes('?') ? '&' : '?'}${kind}=${encodeURIComponent(message)}`);
}

export async function switchSite(form: FormData) {
  (await cookies()).set(SITE_COOKIE, str(form, 'site'), { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
  redirect('/');
}

// ---- Staff -----------------------------------------------------------------

export async function saveStaff(form: FormData) {
  const { supabase, site } = await requireUser(MANAGERS);
  const id = str(form, 'id');
  const row = {
    full_name: str(form, 'full_name'),
    role: str(form, 'role') as StaffRole,
    category: str(form, 'category'),
    phone: orNull(normalisePhone(str(form, 'phone'))),
  };
  if (!row.full_name) go(id ? `/staff/${id}` : '/staff', 'error', 'Name is required.');
  if (id) {
    const { error } = await supabase.from('staff').update({ ...row, active: form.get('active') === 'on' }).eq('id', id);
    if (error) go(`/staff/${id}`, 'error', error.message);
    go(`/staff/${id}`, 'notice', 'Saved.');
  }
  const { data, error } = await supabase.from('staff').insert({ ...row, site_id: site.id }).select('id').single();
  if (error) go('/staff', 'error', error.message);
  go(`/staff/${data!.id}`, 'notice', 'Added. Now upload their documents and send them to the client.');
}

export async function setApproval(form: FormData) {
  const { supabase, rules } = await requireUser(MANAGERS);
  const id = str(form, 'id');
  const step = str(form, 'step');
  const now = new Date().toISOString();
  // "Sent at" arrives as local date and time (YYYY-MM-DDTHH:MM); blank means now.
  const [sentDay, sentHm] = str(form, 'sent_at').split('T');
  const sentAt = sentDay && sentHm ? new Date(at(sentDay, sentHm.slice(0, 5), rules.utcOffsetMinutes)).toISOString() : now;
  if (step === 'sent' && Date.parse(sentAt) > Date.now()) go(`/staff/${id}`, 'error', 'The sent time cannot be in the future.');
  const patch =
    step === 'sent'
      ? { approval_status: 'submitted', docs_sent_at: sentAt, approved_at: null, objection_note: null }
      : step === 'approved'
        ? { approval_status: 'approved', approved_at: now, objection_note: null }
        : step === 'objected'
          ? { approval_status: 'objected', approved_at: null, objection_note: orNull(str(form, 'note')) }
          : { approval_status: 'not_submitted', docs_sent_at: null, approved_at: null, objection_note: null };
  const { error } = await supabase.from('staff').update(patch).eq('id', id);
  if (error) go(`/staff/${id}`, 'error', error.message);
  go(`/staff/${id}`, 'notice', 'Approval status updated.');
}

// ---- Documents ---------------------------------------------------------------

export async function addDocument(form: FormData) {
  const { supabase, site } = await requireUser(MANAGERS);
  const back = str(form, 'back') || '/documents';
  const staffId = orNull(str(form, 'staff_id'));
  const vehicleId = orNull(str(form, 'vehicle_id'));
  const docType = str(form, 'doc_type');
  if ((staffId === null) === (vehicleId === null)) go(back, 'error', 'Choose who or which vehicle the document belongs to.');
  if (!(docType in DOC_LABELS)) go(back, 'error', 'Choose a document type.');
  const issued = orNull(str(form, 'issued_on'));
  const expires = orNull(str(form, 'expires_on'));
  if (issued && expires && expires < issued) go(back, 'error', 'The expiry date is before the issue date.');

  let filePath: string | null = null;
  const file = form.get('file');
  if (file instanceof File && file.size > 0) {
    if (file.size > 4 * 1024 * 1024) go(back, 'error', 'The file is larger than 4 MB. Please upload a smaller scan or photo.');
    const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80);
    filePath = `${site.slug}/${staffId ? 'staff' : 'vehicle'}/${staffId ?? vehicleId}/${crypto.randomUUID()}-${safe}`;
    const { error } = await supabase.storage.from('documents').upload(filePath, file, { contentType: file.type || undefined });
    if (error) go(back, 'error', `Upload failed: ${error.message}`);
  }

  const { error } = await supabase.from('documents').insert({
    site_id: site.id,
    staff_id: staffId,
    vehicle_id: vehicleId,
    doc_type: docType,
    doc_number: orNull(str(form, 'doc_number')),
    issued_on: issued,
    expires_on: expires,
    file_path: filePath,
    notes: orNull(str(form, 'notes')),
  });
  if (error) go(back, 'error', error.message);
  go(back, 'notice', 'Document added.');
}

export async function deleteDocument(form: FormData) {
  const { supabase } = await requireUser(['admin']);
  const back = str(form, 'back') || '/documents';
  const { data } = await supabase.from('documents').select('file_path').eq('id', str(form, 'id')).maybeSingle();
  const { error } = await supabase.from('documents').delete().eq('id', str(form, 'id'));
  if (error) go(back, 'error', error.message);
  if (data?.file_path) await supabase.storage.from('documents').remove([data.file_path]);
  go(back, 'notice', 'Document removed.');
}

// ---- Roster ------------------------------------------------------------------

function eligibility(person: StaffRow, docs: Awaited<ReturnType<typeof loadDocuments>>, end: number, rules: Awaited<ReturnType<typeof requireUser>>['rules']) {
  return assignmentBlocks(staffForRules(person), docsForRules(docs, person.id), Date.now(), end, rules);
}

export async function addShift(form: FormData) {
  const { supabase, site, rules } = await requireUser(MANAGERS);
  const back = `/roster?week=${str(form, 'week')}`;
  const day = str(form, 'day');
  const [startHm, endHm] = str(form, 'slot') === 'custom' ? [str(form, 'start'), str(form, 'end')] : str(form, 'slot').split('-');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(startHm ?? '') || !/^\d{2}:\d{2}$/.test(endHm ?? '')) {
    go(back, 'error', 'Choose a date and shift times.');
  }
  const off = rules.utcOffsetMinutes;
  const start = at(day, startHm, off);
  const end = endHm > startHm ? at(day, endHm, off) : at(addDays(day, 1), endHm, off); // overnight shift
  const [staff, docs] = await Promise.all([loadStaff(supabase, site.id), loadDocuments(supabase, site.id)]);
  const person = staff.find((s) => s.id === str(form, 'staff_id'));
  if (!person) go(back, 'error', 'Choose a staff member.');

  const blocks = eligibility(person, docs, end, rules);
  if (blocks.length > 0) go(back, 'error', `${person.full_name} cannot be rostered: ${blocks.join('; ')}.`);

  const { error } = await supabase.from('shifts').insert({
    site_id: site.id,
    staff_id: person.id,
    starts_at: new Date(start).toISOString(),
    ends_at: new Date(end).toISOString(),
  });
  if (error) go(back, 'error', error.message);
  go(back, 'notice', `Shift added for ${person.full_name}. Any limit or cover problems are listed below.`);
}

export async function deleteShift(form: FormData) {
  const { supabase } = await requireUser(MANAGERS);
  const back = `/roster?week=${str(form, 'week')}`;
  const { data } = await supabase.from('shifts').select('check_in_at').eq('id', str(form, 'id')).maybeSingle();
  if (data?.check_in_at) go(back, 'error', 'This shift has a check-in on record and cannot be deleted (duty register).');
  const { error } = await supabase.from('shifts').delete().eq('id', str(form, 'id'));
  if (error) go(back, 'error', error.message);
  go(back, 'notice', 'Shift removed.');
}

/** Copies every shift starting in the given week to the following week, skipping anyone who may not be deployed. */
export async function copyWeekForward(form: FormData) {
  const { supabase, site, rules } = await requireUser(MANAGERS);
  const week = str(form, 'week');
  const next = addDays(week, 7);
  const off = rules.utcOffsetMinutes;
  const from = at(week, '00:00', off);
  const [staff, docs, source, existing] = await Promise.all([
    loadStaff(supabase, site.id),
    loadDocuments(supabase, site.id),
    loadShifts(supabase, site.id, from, from + 7 * DAY),
    loadShifts(supabase, site.id, from + 7 * DAY, from + 14 * DAY),
  ]);
  const taken = new Set(existing.map((s) => `${s.staff_id}|${Date.parse(s.starts_at)}`));
  const rows: object[] = [];
  const skipped = new Set<string>();
  for (const s of source) {
    const start = Date.parse(s.starts_at) + 7 * DAY;
    const end = Date.parse(s.ends_at) + 7 * DAY;
    if (start < from + 7 * DAY || taken.has(`${s.staff_id}|${start}`)) continue;
    const person = staff.find((p) => p.id === s.staff_id);
    if (!person) continue;
    if (eligibility(person, docs, end, rules).length > 0) {
      skipped.add(person.full_name);
      continue;
    }
    rows.push({ site_id: site.id, staff_id: s.staff_id, starts_at: new Date(start).toISOString(), ends_at: new Date(end).toISOString() });
  }
  if (rows.length > 0) {
    const { error } = await supabase.from('shifts').insert(rows);
    if (error) go(`/roster?week=${week}`, 'error', error.message);
  }
  const note = skipped.size > 0 ? ` Skipped (not eligible): ${[...skipped].join(', ')}.` : '';
  go(`/roster?week=${next}`, skipped.size > 0 ? 'error' : 'notice', `Copied ${rows.length} shifts.${note}`);
}

export async function checkShift(form: FormData) {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc('shift_check', {
    p_shift: str(form, 'id'),
    p_kind: str(form, 'kind'),
    p_security: str(form, 'security'),
  });
  if (error) go('/duty', 'error', error.message);
  go('/duty', 'notice', str(form, 'kind') === 'in' ? 'Checked in.' : 'Checked out.');
}

// ---- Users -------------------------------------------------------------------

export async function saveUser(form: FormData) {
  const { supabase, site } = await requireUser(['admin']);
  const phone = normalisePhone(str(form, 'phone'));
  const role = str(form, 'role');
  if (!/^[0-9]{11,15}$/.test(phone)) go('/users', 'error', 'Enter a 10-digit mobile number.');
  if (!['admin', 'ops_manager', 'staff'].includes(role)) go('/users', 'error', 'Choose a role.');
  const staffId = role === 'staff' ? orNull(str(form, 'staff_id')) : null;
  if (role === 'staff' && !staffId) go('/users', 'error', 'Choose which staff profile this login belongs to.');
  const { error } = await supabase.from('app_users').upsert(
    { phone, full_name: str(form, 'full_name'), role, site_id: role === 'admin' ? null : site.id, staff_id: staffId, active: true },
    { onConflict: 'phone' },
  );
  if (error) go('/users', 'error', error.message);
  go('/users', 'notice', 'User saved. They can now log in with that mobile number.');
}

export async function setUserActive(form: FormData) {
  const { supabase, me } = await requireUser(['admin']);
  if (str(form, 'id') === me.id) go('/users', 'error', 'You cannot remove your own access.');
  const { error } = await supabase.from('app_users').update({ active: str(form, 'active') === 'true' }).eq('id', str(form, 'id'));
  if (error) go('/users', 'error', error.message);
  go('/users', 'notice', 'Access updated.');
}
