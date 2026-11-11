import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { signOut } from '../login/actions';
import { switchSite } from './actions';

const NAV = [
  { href: '/', label: 'Dashboard', roles: ['admin', 'ops_manager'] },
  { href: '/duty', label: 'Duty', roles: ['admin', 'ops_manager', 'staff'] },
  { href: '/roster', label: 'Roster', roles: ['admin', 'ops_manager'] },
  { href: '/staff', label: 'Staff', roles: ['admin', 'ops_manager'] },
  { href: '/documents', label: 'Documents', roles: ['admin', 'ops_manager'] },
  { href: '/users', label: 'Users', roles: ['admin'] },
  { href: '/audit', label: 'Audit trail', roles: ['admin'] },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { me, site, sites } = await requireUser();
  return (
    <div className="min-h-screen">
      <header className="bg-pulse text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-3">
          <div className="flex items-baseline gap-3">
            <span className="font-heading text-2xl font-bold">Ambly</span>
            {sites.length > 1 ? (
              <form action={switchSite} className="flex items-center gap-1">
                <select name="site" defaultValue={site.slug} className="!w-auto !border-white/40 !bg-pulse !py-1 text-sm text-white">
                  {sites.map((s) => (
                    <option key={s.id} value={s.slug}>{s.name}</option>
                  ))}
                </select>
                <button className="cursor-pointer text-xs underline">Switch</button>
              </form>
            ) : (
              <span className="text-sm text-white/80">{site.name}</span>
            )}
          </div>
          <form action={signOut} className="flex items-center gap-3 text-sm">
            <span className="text-white/80">{me.full_name}</span>
            <button className="cursor-pointer underline">Log out</button>
          </form>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-2 text-sm font-medium">
          {NAV.filter((n) => n.roles.includes(me.role)).map((n) => (
            <Link key={n.href} href={n.href} className="whitespace-nowrap border-b-2 border-transparent px-3 py-2 hover:border-white">
              {n.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
