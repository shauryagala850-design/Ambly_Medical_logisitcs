import { redirect } from 'next/navigation';
import { Button, Flash } from '@/components/ui';
import { supabaseServer } from '@/lib/supabase/server';
import { signOut } from '../login/actions';

async function claimAdmin(form: FormData) {
  'use server';
  const name = String(form.get('name') ?? '').trim();
  if (!name) redirect('/no-access?error=Enter%20your%20name.');
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc('claim_first_admin', { p_name: name });
  if (error || !data) redirect('/no-access?error=An%20admin%20already%20exists.%20Ask%20them%20to%20add%20you.');
  redirect('/');
}

export default async function NoAccess({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/login');
  const { data: adminExists, error } = await supabase.rpc('admin_exists');

  return (
    <main className="flex min-h-screen items-center justify-center bg-pulse p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6">
        <h1 className="mb-3 text-3xl font-bold text-pulse">Ambly</h1>
        <Flash params={params} />
        {error ? (
          <p className="text-sm">The database is not set up yet. Run the setup SQL in Supabase (see README), then reload this page.</p>
        ) : params.reason === 'no-site' ? (
          <p className="text-sm">No client site has been set up yet. Run the sample-data SQL in Supabase (see README), then reload.</p>
        ) : adminExists === false ? (
          <form action={claimAdmin} className="space-y-4">
            <p className="text-sm">
              <strong>First-time setup.</strong> No admin exists yet. Enter your name to become the first admin for +{data.user.phone}.
            </p>
            <label>
              Your name
              <input name="name" required autoFocus />
            </label>
            <Button type="submit" className="w-full">Make me the admin</Button>
          </form>
        ) : (
          <p className="text-sm">
            The number +{data.user.phone} has not been given access. Ask an Ambly admin to add you under Users.
          </p>
        )}
        <form action={signOut} className="mt-5">
          <Button kind="secondary" type="submit" className="w-full">Log out</Button>
        </form>
      </div>
    </main>
  );
}
