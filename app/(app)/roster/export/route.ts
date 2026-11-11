import { MANAGERS, requireUser } from '@/lib/auth';
import { loadShifts, loadStaff } from '@/lib/data';
import { addMonths, at, dateKey, fmtDay, fmtTime } from '@/lib/time';

const cell = (v: string) => {
  // Quote for CSV, and neutralise values a spreadsheet would treat as a formula.
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${safe.replaceAll('"', '""')}"`;
};

/** Monthly roster as a CSV file: every shift starting in the month, with duty-register sign-offs where recorded. */
export async function GET(req: Request) {
  const { supabase, site, rules } = await requireUser(MANAGERS);
  const off = rules.utcOffsetMinutes;
  const asked = new URL(req.url).searchParams.get('month') ?? '';
  const month = /^\d{4}-\d{2}$/.test(asked) ? asked : dateKey(Date.now(), off).slice(0, 7);
  const from = at(`${month}-01`, '00:00', off);
  const to = at(addMonths(`${month}-01`, 1), '00:00', off);

  const [staff, shifts] = await Promise.all([loadStaff(supabase, site.id), loadShifts(supabase, site.id, from, to)]);
  const rows = [['Date', 'Start', 'End', 'Role', 'Name', 'Main or relief', 'Check-in', 'Check-in security sign-off', 'Check-out', 'Check-out security sign-off']];
  for (const s of shifts) {
    const start = Date.parse(s.starts_at);
    if (start < from) continue;
    const p = staff.find((x) => x.id === s.staff_id);
    rows.push([
      fmtDay(dateKey(start, off)),
      fmtTime(start, off),
      fmtTime(Date.parse(s.ends_at), off),
      p?.role ?? '',
      p?.full_name ?? '',
      p?.category ?? '',
      s.check_in_at ? fmtTime(Date.parse(s.check_in_at), off) : '',
      s.check_in_security ?? '',
      s.check_out_at ? fmtTime(Date.parse(s.check_out_at), off) : '',
      s.check_out_security ?? '',
    ]);
  }
  const title = [`Roster for ${site.name}`, month, `Provider: ${site.provider_name}`];
  const csv = [title, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  return new Response(`﻿${csv}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="roster-${site.slug}-${month}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
