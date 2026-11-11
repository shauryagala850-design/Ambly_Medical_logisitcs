import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DocForm } from '@/components/doc-form';
import { DocTable } from '@/components/doc-table';
import { Badge, Button, Card, Flash, PageTitle, linkClass } from '@/components/ui';
import { MANAGERS, requireUser } from '@/lib/auth';
import { docsForRules, loadDocuments, loadStaff, staffForRules } from '@/lib/data';
import { APPROVAL_LABEL } from '@/lib/labels';
import { assignmentBlocks, effectiveApproval } from '@/lib/rules/eligibility';
import { HOUR, dateKey, fmtDateTime } from '@/lib/time';
import { saveStaff, setApproval } from '../../actions';

export default async function StaffDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const flash = await searchParams;
  const { supabase, site, rules, me } = await requireUser(MANAGERS);
  const [staff, allDocs] = await Promise.all([loadStaff(supabase, site.id), loadDocuments(supabase, site.id)]);
  const person = staff.find((s) => s.id === id);
  if (!person) notFound();

  const off = rules.utcOffsetMinutes;
  const now = Date.now();
  const docs = allDocs.filter((d) => d.staff_id === id);
  const approval = effectiveApproval(staffForRules(person), now, rules);
  const [label, tone] = APPROVAL_LABEL[approval.status];
  const blocks = assignmentBlocks(staffForRules(person), docsForRules(allDocs, id), now, now + 8 * HOUR, rules);
  const back = `/staff/${id}`;

  return (
    <>
      <p className="mb-2 text-sm"><Link href="/staff" className={linkClass}>← All staff</Link></p>
      <PageTitle title={person.full_name} sub={`${person.role} · ${person.category}${person.active ? '' : ' · inactive'}`} />
      <Flash params={flash} />

      <div className={`mb-5 rounded-md px-4 py-3 text-sm font-medium text-white ${blocks.length === 0 ? 'bg-alert-green' : 'bg-alert-red'}`}>
        {blocks.length === 0 ? 'Can be rostered today.' : `Blocked from the roster: ${blocks.join('; ')}.`}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="Documents">
            <DocTable docs={docs} today={dateKey(now, off)} alertDays={rules.documents.expiryAlertDays} back={back} canDelete={me.role === 'admin'} />
          </Card>
          <Card title="Add a document">
            <DocForm back={back} staffId={id} types={rules.documents.requiredStaffDocs[person.role]} />
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Client approval">
            <p className="mb-2"><Badge tone={tone}>{label}</Badge></p>
            <dl className="mb-4 space-y-1 text-sm">
              {person.docs_sent_at && <div>Documents sent: {fmtDateTime(Date.parse(person.docs_sent_at), off)}</div>}
              {approval.status === 'pending' && (
                <div>Deemed approved on {fmtDateTime(approval.deemedAt!, off)} if the client does not object ({rules.deployment.deemedApprovalDays} days).</div>
              )}
              {approval.status === 'deemed_approved' && <div>Deemed approved since {fmtDateTime(approval.deemedAt!, off)} (no objection received).</div>}
              {person.approved_at && <div>Approved: {fmtDateTime(Date.parse(person.approved_at), off)}</div>}
              {person.objection_note && <div>Objection: {person.objection_note}</div>}
            </dl>
            <div className="space-y-3">
              <form action={setApproval} className="space-y-2">
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="step" value="sent" />
                <label>Documents sent to client at (blank = now)<input type="datetime-local" name="sent_at" /></label>
                <Button kind="secondary" type="submit">Record documents sent</Button>
              </form>
              <form action={setApproval}>
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="step" value="approved" />
                <Button kind="secondary" type="submit">Client approved</Button>
              </form>
              <form action={setApproval} className="space-y-2">
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="step" value="objected" />
                <label>Objection reason<input name="note" /></label>
                <Button kind="danger" type="submit">Client objected</Button>
              </form>
            </div>
          </Card>

          <Card title="Details">
            <form action={saveStaff} className="space-y-3">
              <input type="hidden" name="id" value={id} />
              <label>Full name<input name="full_name" defaultValue={person.full_name} required /></label>
              <label>Role
                <select name="role" defaultValue={person.role}><option value="driver">Driver</option><option value="doctor">Doctor</option></select>
              </label>
              <label>Type
                <select name="category" defaultValue={person.category}><option value="main">Main</option><option value="relief">Relief / backup</option></select>
              </label>
              <label>Mobile number<input name="phone" type="tel" defaultValue={person.phone ?? ''} /></label>
              <label className="!flex items-center gap-2"><input type="checkbox" name="active" defaultChecked={person.active} className="!w-auto" /> Active</label>
              <Button type="submit">Save</Button>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}
