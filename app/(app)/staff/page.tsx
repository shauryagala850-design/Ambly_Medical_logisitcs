import Link from 'next/link';
import { Badge, Button, Card, Flash, PageTitle, linkClass } from '@/components/ui';
import { APPROVAL_LABEL } from '@/lib/labels';
import { MANAGERS, requireUser } from '@/lib/auth';
import { docsForRules, loadDocuments, loadStaff, staffForRules } from '@/lib/data';
import { assignmentBlocks, effectiveApproval } from '@/lib/rules/eligibility';
import { HOUR } from '@/lib/time';
import { saveStaff } from '../actions';

export default async function StaffPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const { supabase, site, rules } = await requireUser(MANAGERS);
  const [staff, docs] = await Promise.all([loadStaff(supabase, site.id), loadDocuments(supabase, site.id)]);
  const now = Date.now();

  return (
    <>
      <PageTitle title="Staff and approved pool" sub="Only client-approved staff with valid documents can be rostered." />
      <Flash params={params} />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <div className="-m-4 overflow-x-auto">
              <table>
                <thead>
                  <tr><th>Name</th><th>Role</th><th>Client approval</th><th>Can be rostered?</th></tr>
                </thead>
                <tbody>
                  {staff.map((s) => {
                    const [label, tone] = APPROVAL_LABEL[effectiveApproval(staffForRules(s), now, rules).status];
                    const blocks = assignmentBlocks(staffForRules(s), docsForRules(docs, s.id), now, now + 8 * HOUR, rules);
                    return (
                      <tr key={s.id} className={s.active ? '' : 'opacity-50'}>
                        <td><Link href={`/staff/${s.id}`} className={linkClass}>{s.full_name}</Link></td>
                        <td className="capitalize">{s.role} · {s.category}</td>
                        <td><Badge tone={tone}>{label}</Badge></td>
                        <td>
                          {blocks.length === 0 ? <Badge tone="green">Yes</Badge> : <Badge tone="red">Blocked</Badge>}
                          {blocks.length > 0 && <span className="mt-1 block text-xs text-carbon/70">{blocks.join('; ')}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
        <Card title="Add a pool member">
          <form action={saveStaff} className="space-y-3">
            <label>Full name<input name="full_name" required /></label>
            <label>Role
              <select name="role"><option value="driver">Driver</option><option value="doctor">Doctor</option></select>
            </label>
            <label>Type
              <select name="category"><option value="main">Main</option><option value="relief">Relief / backup</option></select>
            </label>
            <label>Mobile number<input name="phone" type="tel" inputMode="numeric" /></label>
            <Button type="submit">Add</Button>
          </form>
        </Card>
      </div>
    </>
  );
}
