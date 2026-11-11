import Link from 'next/link';
import { Badge, Card, PageTitle } from '@/components/ui';
import { buildAlerts, currentDocuments } from '@/lib/alerts';
import { MANAGERS, requireUser } from '@/lib/auth';
import { loadDocuments, loadShifts, loadStaff, loadVehicles } from '@/lib/data';
import { upcomingDeadlines } from '@/lib/rules/deadlines';
import { expiryStatus } from '@/lib/rules/expiry';
import { DAY, addDays, at, dateKey, daysBetween, fmtDate, fmtDateTime, fmtTime, weekStart } from '@/lib/time';

export default async function Dashboard() {
  const { supabase, site, rules } = await requireUser(MANAGERS);
  const off = rules.utcOffsetMinutes;
  const now = Date.now();
  const today = dateKey(now, off);
  const loadFrom = at(weekStart(today, rules.weekStartsOn), '00:00', off) - DAY;
  const [staff, vehicles, docs, shifts] = await Promise.all([
    loadStaff(supabase, site.id),
    loadVehicles(supabase, site.id),
    loadDocuments(supabase, site.id),
    loadShifts(supabase, site.id, loadFrom, now + 15 * DAY),
  ]);

  const alerts = buildAlerts({ staff, vehicles, docs, shifts, range: { from: now, to: now + 7 * DAY }, rules, now });
  const expired = currentDocuments(docs).filter(
    (d) =>
      expiryStatus(d.expires_on, today, []).state === 'expired' &&
      (staff.some((s) => s.id === d.staff_id && s.active) || vehicles.some((v) => v.id === d.vehicle_id && v.active)),
  );
  const onNow = shifts.filter((s) => Date.parse(s.starts_at) <= now && Date.parse(s.ends_at) > now);
  const nameOf = (id: string) => staff.find((s) => s.id === id);
  const main = vehicles.find((v) => v.category === 'main' && v.active);

  const deadlines = [
    ...upcomingDeadlines(rules, today, 45).map((d) => ({ ...d, href: null as string | null })),
    ...currentDocuments(docs)
      .filter((d) => d.expires_on && d.expires_on >= today && d.expires_on <= addDays(today, 60))
      .map((d) => ({
        date: d.expires_on!,
        title: `Document expires: ${d.doc_type.replaceAll('_', ' ')}`,
        detail: nameOf(d.staff_id ?? '')?.full_name ?? vehicles.find((v) => v.id === d.vehicle_id)?.registration ?? '',
        owner: 'us' as const,
        href: d.staff_id ? `/staff/${d.staff_id}` : '/documents',
      })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <>
      <PageTitle title="Dashboard" sub={`${site.name} · ${fmtDateTime(now, off)}`} />

      {expired.length > 0 && (
        <Link href="/documents?show=attention" className="mb-5 block rounded-md bg-alert-red px-4 py-3 font-semibold text-white">
          {expired.length} document{expired.length === 1 ? ' has' : 's have'} EXPIRED. A lapsed licence, registration or insurance allows immediate
          termination. Review now →
        </Link>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="On shift now">
          {(['driver', 'doctor'] as const).map((role) => {
            const cfg = rules.deployment.roles[role];
            const list = onNow.filter((s) => nameOf(s.staff_id)?.role === role);
            const nowHm = fmtTime(now, off);
            const required = cfg.coverage === '24x7' || (cfg.window !== undefined && nowHm >= cfg.window.start && nowHm < cfg.window.end);
            return (
              <div key={role} className="mb-3 last:mb-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-carbon/60">{role}</p>
                {list.map((s) => (
                  <p key={s.id} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{nameOf(s.staff_id)?.full_name}</span>
                    <span className="text-sm text-carbon/70">
                      {fmtTime(Date.parse(s.starts_at), off)} to {fmtTime(Date.parse(s.ends_at), off)}
                    </span>
                    {s.check_in_at ? <Badge tone="green">Checked in</Badge> : <Badge tone="red">Not checked in</Badge>}
                  </p>
                ))}
                {list.length === 0 &&
                  (required ? (
                    <Badge tone="red">Nobody rostered right now</Badge>
                  ) : (
                    <p className="text-sm text-carbon/70">
                      Not required now (cover {cfg.window?.start} to {cfg.window?.end})
                    </p>
                  ))}
              </div>
            );
          })}
        </Card>

        <Card title="Ambulance">
          <p className="font-heading text-2xl font-bold">{main?.registration ?? 'No main ambulance set'}</p>
          <p className="mt-1 text-sm text-carbon/70">
            On-site / away status, departures and returns will show here once the movement log is built (Phase 2).
          </p>
        </Card>

        <Card title="Absence this month">
          <p className="text-sm text-carbon/70">
            Absence count against the limit of {rules.absence.terminationMonthlyCount} and service-credit exposure against the Rs.{' '}
            {rules.absence.serviceCreditMonthlyCap.toLocaleString('en-IN')} cap will show here once the absence tracker is built (Phase 2).
          </p>
        </Card>

        <div className="lg:col-span-2">
          <Card title={`Open alerts (${alerts.length})`}>
            {alerts.length === 0 && <p className="text-sm text-alert-green">Nothing needs attention.</p>}
            <ul className="divide-y divide-clinical/50">
              {alerts.map((a, i) => (
                <li key={i}>
                  <Link href={a.href} className="flex items-start gap-3 py-2 hover:bg-clinical/20">
                    <Badge tone={a.tone}>{a.tone === 'red' ? 'Urgent' : 'Soon'}</Badge>
                    <span>
                      <span className="block text-sm font-medium">{a.title}</span>
                      <span className="block text-sm text-carbon/70">{a.detail}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <Card title="Upcoming deadlines">
          {!rules.contract.commencementDate && (
            <p className="mb-2 text-sm text-alert-amber">Commencement date not set in the site settings file; trial dates are not shown.</p>
          )}
          <ul className="divide-y divide-clinical/50">
            {deadlines.map((d, i) => {
              const days = daysBetween(today, d.date);
              const body = (
                <>
                  <span className="flex items-center justify-between gap-2 text-sm font-medium">
                    {d.title}
                    <Badge tone={days <= 7 ? 'red' : days <= 30 ? 'amber' : 'none'}>{days === 0 ? 'Today' : `${days} d`}</Badge>
                  </span>
                  <span className="block text-xs text-carbon/70">
                    {fmtDate(d.date)} · {d.owner === 'client' ? 'Client to act' : 'Ambly to act'} · {d.detail}
                  </span>
                </>
              );
              return (
                <li key={i} className="py-2">
                  {d.href ? <Link href={d.href} className="block">{body}</Link> : body}
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </>
  );
}
