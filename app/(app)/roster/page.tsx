import Link from 'next/link';
import { Badge, Button, Card, Flash, PageTitle } from '@/components/ui';
import { describeViolation, rosteredButBlocked } from '@/lib/alerts';
import { MANAGERS, requireUser } from '@/lib/auth';
import { docsForRules, loadDocuments, loadShifts, loadStaff, shiftsForRules, staffForRules } from '@/lib/data';
import { assignmentBlocks } from '@/lib/rules/eligibility';
import { validateRoster } from '@/lib/rules/roster';
import { DAY, HOUR, addDays, at, dateKey, fmtDate, fmtDay, fmtTime, weekStart } from '@/lib/time';
import { addShift, copyWeekForward, deleteShift } from '../actions';

export default async function RosterPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const { supabase, site, rules } = await requireUser(MANAGERS);
  const off = rules.utcOffsetMinutes;
  const now = Date.now();
  const today = dateKey(now, off);
  const asked = /^\d{4}-\d{2}-\d{2}$/.test(params.week ?? '') ? params.week! : today;
  const week = weekStart(asked, rules.weekStartsOn);
  const from = at(week, '00:00', off);
  const to = from + 7 * DAY;

  const [staff, docs, shifts] = await Promise.all([
    loadStaff(supabase, site.id),
    loadDocuments(supabase, site.id),
    loadShifts(supabase, site.id, from - DAY, to + DAY),
  ]);
  const person = (id: string) => staff.find((s) => s.id === id);
  const violations = validateRoster(shiftsForRules(shifts, staff), rules, { from, to });
  const blocked = rosteredButBlocked(shifts.filter((s) => Date.parse(s.starts_at) >= from && Date.parse(s.starts_at) < to), staff, docs, rules, now);
  const problems = [...violations.map((v) => describeViolation(v, staff, rules)), ...blocked.map((b) => b.text)];
  const flagged = new Set(violations.flatMap((v) => v.shiftIds ?? []));
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const month = week.slice(0, 7);
  const slots = (['driver', 'doctor'] as const).flatMap((role) =>
    rules.deployment.roles[role].standardShifts.map(([s, e]) => ({ value: `${s}-${e}`, label: `${s} to ${e} (${role})` })),
  );

  return (
    <>
      <PageTitle
        title="Roster"
        sub={`Week of ${fmtDate(week)} to ${fmtDate(addDays(week, 6))}`}
        action={
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Link href={`/roster?week=${addDays(week, -7)}`} className="rounded-md border border-pulse px-3 py-2 font-semibold text-pulse">← Previous</Link>
            <Link href="/roster" className="rounded-md border border-pulse px-3 py-2 font-semibold text-pulse">This week</Link>
            <Link href={`/roster?week=${addDays(week, 7)}`} className="rounded-md border border-pulse px-3 py-2 font-semibold text-pulse">Next →</Link>
          </div>
        }
      />
      <Flash params={params} />

      <div className={`mb-5 rounded-md border-l-4 px-4 py-3 ${problems.length === 0 ? 'border-alert-green bg-alert-green/10' : 'border-alert-red bg-alert-red/10'}`}>
        {problems.length === 0 ? (
          <p className="text-sm font-medium text-alert-green">This week meets the contract: full 24x7 driver cover, doctor cover, and all shift-hour limits.</p>
        ) : (
          <>
            <p className="mb-1 text-sm font-semibold text-alert-red">{problems.length} problem{problems.length === 1 ? '' : 's'} this week</p>
            <ul className="list-disc space-y-0.5 pl-5 text-sm">
              {problems.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          </>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <div className="-m-4 overflow-x-auto">
              <table>
                <thead><tr><th>Day</th><th>Shift</th><th>Who</th><th>Duty register</th><th /></tr></thead>
                <tbody>
                  {days.map((day) => {
                    const list = shifts.filter((s) => dateKey(Date.parse(s.starts_at), off) === day);
                    if (list.length === 0) {
                      return <tr key={day}><td className="font-semibold">{fmtDay(day)}</td><td colSpan={4}><Badge tone="red">No shifts</Badge></td></tr>;
                    }
                    return list.map((s, i) => {
                      const p = person(s.staff_id);
                      const start = Date.parse(s.starts_at);
                      const end = Date.parse(s.ends_at);
                      return (
                        <tr key={s.id} className={day === today ? 'bg-clinical/20' : ''}>
                          {i === 0 && <td rowSpan={list.length} className="font-semibold whitespace-nowrap">{fmtDay(day)}</td>}
                          <td className="whitespace-nowrap">
                            {fmtTime(start, off)} to {fmtTime(end, off)}
                            {flagged.has(s.id) && <> <Badge tone="red">Limit</Badge></>}
                          </td>
                          <td>
                            <span className="font-medium">{p?.full_name}</span>
                            <span className="block text-xs capitalize text-carbon/60">{p?.role} · {p?.category}</span>
                          </td>
                          <td className="text-xs">
                            {s.check_in_at ? (
                              <>
                                In {fmtTime(Date.parse(s.check_in_at), off)} ({s.check_in_security})
                                {s.check_out_at && <span className="block">Out {fmtTime(Date.parse(s.check_out_at), off)} ({s.check_out_security})</span>}
                              </>
                            ) : start + 10 * 60_000 < now ? (
                              <Badge tone="red">No check-in</Badge>
                            ) : (
                              <span className="text-carbon/50">Planned</span>
                            )}
                          </td>
                          <td>
                            {!s.check_in_at && (
                              <form action={deleteShift}>
                                <input type="hidden" name="id" value={s.id} />
                                <input type="hidden" name="week" value={week} />
                                <button className="cursor-pointer text-xs text-alert-red underline">Remove</button>
                              </form>
                            )}
                          </td>
                        </tr>
                      );
                    });
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Add a shift">
            <form action={addShift} className="space-y-3">
              <input type="hidden" name="week" value={week} />
              <label>Date
                <select name="day" defaultValue={days.includes(today) ? today : week}>
                  {days.map((d) => <option key={d} value={d}>{fmtDay(d)}</option>)}
                </select>
              </label>
              <label>Shift
                <select name="slot">
                  {slots.map((s) => <option key={s.label} value={s.value}>{s.label}</option>)}
                  <option value="custom">Other times (enter below)</option>
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label>Other: start<input type="time" name="start" /></label>
                <label>Other: end<input type="time" name="end" /></label>
              </div>
              <label>Staff member
                <select name="staff_id" required>
                  <option value="">Choose…</option>
                  {staff.filter((s) => s.active).map((s) => {
                    const blocked = assignmentBlocks(staffForRules(s), docsForRules(docs, s.id), now, Math.max(now, from) + 8 * HOUR, rules).length > 0;
                    return <option key={s.id} value={s.id}>{s.full_name} ({s.role}, {s.category}){blocked ? ' — BLOCKED' : ''}</option>;
                  })}
                </select>
              </label>
              <Button type="submit">Add shift</Button>
              <p className="text-xs text-carbon/60">Anyone not client-approved, or with a missing or expired document, is refused.</p>
            </form>
          </Card>

          <Card title="Plan ahead and share">
            <form action={copyWeekForward} className="mb-4">
              <input type="hidden" name="week" value={week} />
              <Button kind="secondary" type="submit">Copy this week to next week</Button>
            </form>
            <p className="mb-1 text-sm font-medium">Monthly roster for the client</p>
            <div className="flex flex-wrap gap-3 text-sm">
              <a className="font-medium text-pulse underline" href={`/roster/export?month=${month}`}>Download {month} (CSV)</a>
              <a className="font-medium text-pulse underline" href={`/roster/export?month=${addDays(`${month}-28`, 7).slice(0, 7)}`}>Download next month (CSV)</a>
            </div>
            <p className="mt-2 text-xs text-carbon/60">Opens in Excel or Google Sheets. Contains names, roles and shift times only.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
