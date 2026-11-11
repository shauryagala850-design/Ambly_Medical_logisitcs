import Link from 'next/link';
import { DocForm } from '@/components/doc-form';
import { DocTable } from '@/components/doc-table';
import { Badge, Card, Flash, PageTitle } from '@/components/ui';
import { currentDocuments, docLabel } from '@/lib/alerts';
import { MANAGERS, requireUser } from '@/lib/auth';
import { loadDocuments, loadStaff, loadVehicles } from '@/lib/data';
import { expiryStatus, expiryTone } from '@/lib/rules/expiry';
import { dateKey } from '@/lib/time';

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const { supabase, site, rules, me } = await requireUser(MANAGERS);
  const [staff, vehicles, docs] = await Promise.all([
    loadStaff(supabase, site.id),
    loadVehicles(supabase, site.id),
    loadDocuments(supabase, site.id),
  ]);
  const today = dateKey(Date.now(), rules.utcOffsetMinutes);
  const alertDays = rules.documents.expiryAlertDays;
  const ownerOf = (d: { staff_id: string | null; vehicle_id: string | null }) =>
    staff.find((s) => s.id === d.staff_id)?.full_name ?? vehicles.find((v) => v.id === d.vehicle_id)?.registration ?? '';

  const current = currentDocuments(docs);
  const tone = (d: (typeof docs)[number]) => expiryTone(expiryStatus(d.expires_on, today, alertDays), alertDays);
  const attention = current.filter((d) => tone(d) === 'red' || tone(d) === 'amber');
  const expired = current.filter((d) => expiryStatus(d.expires_on, today, alertDays).state === 'expired');
  const onlyAttention = params.show === 'attention';
  const shown = onlyAttention ? attention : docs;

  const missing = [
    ...staff.filter((s) => s.active).map((s) => ({
      name: s.full_name,
      href: `/staff/${s.id}`,
      types: rules.documents.requiredStaffDocs[s.role].filter((t) => !docs.some((d) => d.staff_id === s.id && d.doc_type === t)),
    })),
    ...vehicles.filter((v) => v.active).map((v) => ({
      name: `${v.registration} (${v.category})`,
      href: '/documents',
      types: rules.documents.requiredVehicleDocs.filter((t) => !docs.some((d) => d.vehicle_id === v.id && d.doc_type === t)),
    })),
  ].filter((m) => m.types.length > 0);

  return (
    <>
      <PageTitle title="Documents and expiry" sub={`Alerts at ${[...alertDays].sort((a, b) => b - a).join(', ')} days before expiry.`} />
      <Flash params={params} />
      {expired.length > 0 && (
        <div className="mb-5 rounded-md bg-alert-red px-4 py-3 font-semibold text-white">
          EXPIRED: {expired.map((d) => `${ownerOf(d)} · ${docLabel(d.doc_type)}`).join(' | ')}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card
            title={onlyAttention ? `Needs attention (${attention.length})` : `All documents (${docs.length})`}
            action={
              <Link href={onlyAttention ? '/documents' : '/documents?show=attention'} className="text-sm font-medium text-pulse underline">
                {onlyAttention ? 'Show all' : `Show only expiring or expired (${attention.length})`}
              </Link>
            }
          >
            <DocTable
              docs={shown}
              today={today}
              alertDays={alertDays}
              ownerOf={ownerOf}
              back={onlyAttention ? '/documents?show=attention' : '/documents'}
              canDelete={me.role === 'admin'}
            />
          </Card>
        </div>
        <div className="space-y-5">
          <Card title="Missing required documents">
            {missing.length === 0 && <p className="text-sm text-alert-green">Every required document is on file.</p>}
            <ul className="space-y-2 text-sm">
              {missing.map((m) => (
                <li key={m.name}>
                  <Link href={m.href} className="font-medium text-pulse underline">{m.name}</Link>{' '}
                  <Badge tone="red">{m.types.length} missing</Badge>
                  <span className="block text-carbon/70">{m.types.map(docLabel).join(', ')}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Add a vehicle document">
            <DocForm back="/documents" vehicles={vehicles} types={rules.documents.requiredVehicleDocs} />
            <p className="mt-3 text-xs text-carbon/60">Staff documents are added from each person's page under Staff.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
