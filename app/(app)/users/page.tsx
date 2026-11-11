import { Badge, Button, Card, Flash, PageTitle } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { loadStaff } from '@/lib/data';
import type { AppUserRow } from '@/lib/types';
import { saveUser, setUserActive } from '../actions';

const ROLE_LABEL: Record<string, string> = { admin: 'Admin', ops_manager: 'Ops manager', staff: 'On-shift staff', client: 'Client (Phase 3)' };

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const { supabase, site, me } = await requireUser(['admin']);
  const [{ data }, staff] = await Promise.all([
    supabase.from('app_users').select('*').order('role').order('full_name').returns<AppUserRow[]>(),
    loadStaff(supabase, site.id),
  ]);
  const users = data ?? [];

  return (
    <>
      <PageTitle title="Users" sub="Who can log in, and what they can see." />
      <Flash params={params} />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <div className="-m-4 overflow-x-auto">
              <table>
                <thead><tr><th>Name</th><th>Mobile</th><th>Role</th><th>Access</th><th /></tr></thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td className="font-medium">{u.full_name}</td>
                      <td>+{u.phone}</td>
                      <td>
                        {ROLE_LABEL[u.role]}
                        {u.staff_id && <span className="block text-xs text-carbon/60">{staff.find((s) => s.id === u.staff_id)?.full_name}</span>}
                      </td>
                      <td>{u.active ? <Badge tone="green">Active</Badge> : <Badge tone="grey">Removed</Badge>}</td>
                      <td>
                        {u.id !== me.id && (
                          <form action={setUserActive}>
                            <input type="hidden" name="id" value={u.id} />
                            <input type="hidden" name="active" value={String(!u.active)} />
                            <button className="cursor-pointer text-xs underline">{u.active ? 'Remove access' : 'Restore access'}</button>
                          </form>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
        <Card title="Add or update a user">
          <form action={saveUser} className="space-y-3">
            <label>Full name<input name="full_name" required /></label>
            <label>Mobile number<input name="phone" type="tel" inputMode="numeric" required /></label>
            <label>Role
              <select name="role">
                <option value="staff">On-shift staff (mobile duty view only)</option>
                <option value="ops_manager">Ops manager (roster, staff, documents)</option>
                <option value="admin">Admin (everything)</option>
              </select>
            </label>
            <label>Staff profile (for on-shift staff)
              <select name="staff_id">
                <option value="">None</option>
                {staff.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.full_name} ({s.role})</option>)}
              </select>
            </label>
            <Button type="submit">Save user</Button>
            <p className="text-xs text-carbon/60">Using a number that already exists updates that user.</p>
          </form>
        </Card>
      </div>
    </>
  );
}
