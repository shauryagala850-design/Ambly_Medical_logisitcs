import { Badge, Button, Flash, PageTitle } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { loadShifts, loadStaff } from '@/lib/data';
import { DAY, HOUR, dateKey, fmtDay, fmtTime } from '@/lib/time';
import { checkShift } from '../actions';

/** Mobile-first duty register: check in and out of shifts, with the client's security guard signing each handover. */
export default async function DutyPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const { supabase, site, rules, me } = await requireUser();
  const off = rules.utcOffsetMinutes;
  const now = Date.now();
  const [staff, all] = await Promise.all([loadStaff(supabase, site.id), loadShifts(supabase, site.id, now - 12 * HOUR, now + 2 * DAY)]);
  const mine = me.role === 'staff';
  const shifts = all.filter((s) => {
    if (mine && s.staff_id !== me.staff_id) return false;
    // Hide shifts that are finished and signed out, and (for managers) anything not starting within a day.
    if (s.check_out_at) return false;
    if (Date.parse(s.ends_at) < now && !s.check_in_at) return false;
    return mine || Date.parse(s.starts_at) < now + DAY;
  });

  return (
    <div className="mx-auto max-w-md">
      <PageTitle title="Duty register" sub={mine ? 'Your shifts' : 'All shifts, next 24 hours'} />
      <Flash params={params} />
      {mine && !me.staff_id && <p className="text-sm text-alert-red">Your login is not linked to a staff profile. Ask an admin to fix this under Users.</p>}
      {shifts.length === 0 && <p className="rounded-lg border border-clinical p-4 text-sm">No upcoming shifts.</p>}
      <ul className="space-y-4">
        {shifts.map((s) => {
          const start = Date.parse(s.starts_at);
          const end = Date.parse(s.ends_at);
          const p = staff.find((x) => x.id === s.staff_id);
          const live = start <= now && end > now;
          const canCheckIn = !s.check_in_at && start - now <= 30 * 60_000;
          return (
            <li key={s.id} className={`rounded-lg border-2 p-4 ${live ? 'border-pulse' : 'border-clinical'}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-heading text-2xl font-bold text-pulse">{fmtTime(start, off)} to {fmtTime(end, off)}</p>
                  <p className="text-sm text-carbon/70">{fmtDay(dateKey(start, off))} · {p?.full_name} · <span className="capitalize">{p?.role}</span></p>
                </div>
                {s.check_in_at ? <Badge tone="green">On duty</Badge> : live ? <Badge tone="red">Not checked in</Badge> : <Badge tone="grey">Upcoming</Badge>}
              </div>
              {s.check_in_at && (
                <p className="mt-2 text-sm">Checked in {fmtTime(Date.parse(s.check_in_at), off)}, signed by {s.check_in_security}</p>
              )}
              {(canCheckIn || s.check_in_at) && (
                <form action={checkShift} className="mt-3 space-y-3">
                  <input type="hidden" name="id" value={s.id} />
                  <input type="hidden" name="kind" value={s.check_in_at ? 'out' : 'in'} />
                  <label>Security guard signing this handover (name)
                    <input name="security" required autoComplete="off" className="!py-3 !text-base" />
                  </label>
                  <Button type="submit" className="w-full !py-3 !text-base">{s.check_in_at ? 'Check out' : 'Check in'}</Button>
                </form>
              )}
              {!canCheckIn && !s.check_in_at && <p className="mt-2 text-sm text-carbon/60">Check-in opens 30 minutes before the shift.</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
