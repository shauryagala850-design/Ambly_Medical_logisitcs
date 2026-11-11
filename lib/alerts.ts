import type { SiteRules } from '@/config/sites/types';
import { DOC_LABELS } from '@/config/sites/types';
import { docsForRules, shiftsForRules, staffForRules } from './data';
import { assignmentBlocks, effectiveApproval } from './rules/eligibility';
import { expiryStatus, expiryTone, type ExpiryStatus } from './rules/expiry';
import { validateRoster, type Violation } from './rules/roster';
import { MIN, dateKey, fmtDate, fmtDateTime, fmtDay, fmtTime } from './time';
import type { DocumentRow, ShiftRow, StaffRow, VehicleRow } from './types';

export interface Alert {
  tone: 'red' | 'amber';
  title: string;
  detail: string;
  href: string;
}

/** Keeps only the newest document of each type per person/vehicle, so a renewed document clears the old one's alert. */
export function currentDocuments(docs: DocumentRow[]): DocumentRow[] {
  const best = new Map<string, DocumentRow>();
  for (const d of docs) {
    const key = `${d.staff_id ?? d.vehicle_id}|${d.doc_type}`;
    const held = best.get(key);
    if (!held || (d.expires_on ?? '9999') > (held.expires_on ?? '9999')) best.set(key, d);
  }
  return [...best.values()];
}

export const docLabel = (type: string) => DOC_LABELS[type] ?? type;

export function expiryText(s: ExpiryStatus): string {
  if (s.state === 'no_expiry') return 'No expiry';
  if (s.state === 'expired') return `Expired ${-s.daysLeft!} day${s.daysLeft === -1 ? '' : 's'} ago`;
  if (s.daysLeft === 0) return 'Expires today';
  return `${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'} left`;
}

export function describeViolation(v: Violation, staff: StaffRow[], rules: SiteRules): string {
  const off = rules.utcOffsetMinutes;
  const who = staff.find((s) => s.id === v.staffId)?.full_name;
  if (v.code === 'COVERAGE_GAP') {
    return `${fmtDay(v.day!)}: no ${v.role} on shift ${fmtTime(v.from!, off)} to ${fmtTime(v.to!, off)} (${v.hours} h)`;
  }
  if (v.code === 'WEEKLY_LIMIT') return `${who}: ${v.message} (week of ${fmtDate(v.day!)})`;
  return `${who}, ${fmtDay(v.day!)}: ${v.message}`;
}

/**
 * People on upcoming shifts who may not be deployed by then, e.g. a licence that expires before the shift.
 * One line per person, naming the first affected shift.
 */
export function rosteredButBlocked(
  shifts: ShiftRow[],
  staff: StaffRow[],
  docs: DocumentRow[],
  rules: SiteRules,
  now: number,
): { staffId: string; day: string; text: string }[] {
  const off = rules.utcOffsetMinutes;
  const out = new Map<string, { staffId: string; day: string; text: string; count: number }>();
  for (const s of [...shifts].sort((a, b) => a.starts_at.localeCompare(b.starts_at))) {
    if (Date.parse(s.ends_at) <= now) continue;
    const p = staff.find((x) => x.id === s.staff_id);
    if (!p) continue;
    const blocks = assignmentBlocks(staffForRules(p), docsForRules(docs, p.id), now, Date.parse(s.ends_at), rules);
    if (blocks.length === 0) continue;
    const held = out.get(p.id);
    if (held) {
      held.count++;
      continue;
    }
    const day = dateKey(Date.parse(s.starts_at), off);
    out.set(p.id, { staffId: p.id, day, text: `${p.full_name} is rostered from ${fmtDay(day)} but cannot be deployed: ${blocks.join('; ')}`, count: 1 });
  }
  return [...out.values()].map((o) => ({ staffId: o.staffId, day: o.day, text: `${o.text} (${o.count} shift${o.count === 1 ? '' : 's'} affected)` }));
}

export function buildAlerts(input: {
  staff: StaffRow[];
  vehicles: VehicleRow[];
  docs: DocumentRow[];
  /** Shifts covering at least the validation range below, plus the rest of the weeks it touches. */
  shifts: ShiftRow[];
  range: { from: number; to: number };
  rules: SiteRules;
  now: number;
}): Alert[] {
  const { staff, vehicles, docs, shifts, range, rules, now } = input;
  const off = rules.utcOffsetMinutes;
  const today = dateKey(now, off);
  const alerts: Alert[] = [];
  const activeStaff = staff.filter((s) => s.active);
  const activeVehicles = vehicles.filter((v) => v.active);

  for (const s of shifts) {
    const start = Date.parse(s.starts_at);
    if (!s.check_in_at && start + 10 * MIN < now && Date.parse(s.ends_at) > now) {
      const who = staff.find((p) => p.id === s.staff_id)?.full_name ?? 'Someone';
      alerts.push({ tone: 'red', title: `${who} has not checked in`, detail: `Shift started at ${fmtTime(start, off)}`, href: '/duty' });
    }
  }

  for (const v of validateRoster(shiftsForRules(shifts, staff), rules, range)) {
    alerts.push({
      tone: 'red',
      title: v.code === 'COVERAGE_GAP' ? 'Gap in cover' : 'Shift limit broken',
      detail: describeViolation(v, staff, rules),
      href: `/roster?week=${v.day}`,
    });
  }

  for (const b of rosteredButBlocked(shifts, staff, docs, rules, now)) {
    alerts.push({ tone: 'red', title: 'Rostered but not deployable', detail: b.text, href: `/roster?week=${b.day}` });
  }

  for (const d of currentDocuments(docs)) {
    const person = activeStaff.find((s) => s.id === d.staff_id);
    const vehicle = activeVehicles.find((v) => v.id === d.vehicle_id);
    if (!person && !vehicle) continue;
    const status = expiryStatus(d.expires_on, today, rules.documents.expiryAlertDays);
    const tone = expiryTone(status, rules.documents.expiryAlertDays);
    if (tone !== 'red' && tone !== 'amber') continue;
    alerts.push({
      tone,
      title: `${docLabel(d.doc_type)}: ${expiryText(status).toLowerCase()}`,
      detail: `${person?.full_name ?? vehicle!.registration}, expiry ${fmtDate(d.expires_on!)}`,
      href: person ? `/staff/${person.id}` : '/documents',
    });
  }

  for (const p of activeStaff) {
    const held = new Set(docsForRules(docs, p.id).map((d) => d.docType));
    const missing = rules.documents.requiredStaffDocs[p.role].filter((t) => !held.has(t));
    if (missing.length > 0) {
      alerts.push({ tone: 'red', title: `${p.full_name}: documents missing`, detail: missing.map(docLabel).join(', '), href: `/staff/${p.id}` });
    }
    const approval = effectiveApproval(staffForRules(p), now, rules);
    if (approval.status === 'pending') {
      alerts.push({
        tone: 'amber',
        title: `${p.full_name}: awaiting client approval`,
        detail: `Deemed approved on ${fmtDateTime(approval.deemedAt!, off)} unless the client objects`,
        href: `/staff/${p.id}`,
      });
    } else if (approval.status === 'not_submitted') {
      alerts.push({ tone: 'amber', title: `${p.full_name}: documents not sent to client`, detail: 'Cannot be rostered until sent and approved', href: `/staff/${p.id}` });
    } else if (approval.status === 'objected') {
      alerts.push({ tone: 'red', title: `${p.full_name}: client objected`, detail: p.objection_note ?? 'No reason recorded', href: `/staff/${p.id}` });
    }
  }

  for (const v of activeVehicles) {
    const held = new Set(docs.filter((d) => d.vehicle_id === v.id).map((d) => d.doc_type));
    const missing = rules.documents.requiredVehicleDocs.filter((t) => !held.has(t));
    if (missing.length > 0) {
      alerts.push({ tone: v.category === 'main' ? 'red' : 'amber', title: `${v.registration}: documents missing`, detail: missing.map(docLabel).join(', '), href: '/documents' });
    }
  }

  return alerts.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'red' ? -1 : 1));
}
