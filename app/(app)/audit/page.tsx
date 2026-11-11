import { Card, PageTitle } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { fmtDateTime } from '@/lib/time';
import type { AuditRow } from '@/lib/types';

const ACTION: Record<string, string> = { INSERT: 'Added', UPDATE: 'Changed', DELETE: 'Removed' };
const HIDDEN = new Set(['id', 'site_id', 'created_at']);
const show = (v: unknown) => (v === null || v === undefined || v === '' ? 'blank' : String(v));

function summary(row: AuditRow): string {
  if (row.action === 'UPDATE' && row.old_row && row.new_row) {
    return Object.keys(row.new_row)
      .filter((k) => !HIDDEN.has(k) && JSON.stringify(row.old_row![k]) !== JSON.stringify(row.new_row![k]))
      .map((k) => `${k}: ${show(row.old_row![k])} → ${show(row.new_row![k])}`)
      .join('; ');
  }
  const r = row.new_row ?? row.old_row ?? {};
  return ['full_name', 'registration', 'doc_type', 'phone', 'starts_at', 'expires_on']
    .filter((k) => r[k] !== undefined && r[k] !== null)
    .map((k) => `${k}: ${show(r[k])}`)
    .join('; ');
}

export default async function AuditPage() {
  const { supabase, site, rules } = await requireUser(['admin']);
  const { data } = await supabase
    .from('audit_log')
    .select('*')
    .or(`site_id.eq.${site.id},site_id.is.null`)
    .order('id', { ascending: false })
    .limit(300)
    .returns<AuditRow[]>();

  return (
    <>
      <PageTitle title="Audit trail" sub="Who changed what and when. Most recent 300 changes. Entries cannot be edited or deleted from the app." />
      <Card>
        <div className="-m-4 overflow-x-auto">
          <table>
            <thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead>
            <tbody>
              {(data ?? []).map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap">{fmtDateTime(Date.parse(r.at), rules.utcOffsetMinutes)}</td>
                  <td>{r.actor_name ?? (r.actor_phone ? `+${r.actor_phone}` : 'System')}</td>
                  <td className="whitespace-nowrap">{ACTION[r.action] ?? r.action} · {r.table_name.replaceAll('_', ' ')}</td>
                  <td className="break-all text-xs">{summary(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
