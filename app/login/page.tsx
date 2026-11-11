import { redirect } from 'next/navigation';
import { Button, Flash } from '@/components/ui';
import { supabaseServer } from '@/lib/supabase/server';
import { sendCode, verifyCode } from './actions';

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (data.user) redirect('/');

  return (
    <main className="flex min-h-screen items-center justify-center bg-pulse p-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-6">
        <h1 className="text-4xl font-bold text-pulse">Ambly</h1>
        <p className="mb-5 text-sm text-carbon/70">Operations and compliance</p>
        <Flash params={params} />
        {params.phone ? (
          <form action={verifyCode} className="space-y-4">
            <input type="hidden" name="phone" value={params.phone} />
            <label>
              Code sent to +{params.phone}
              <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required autoFocus />
            </label>
            <Button type="submit" className="w-full">Log in</Button>
            <a href="/login" className="block text-center text-sm text-pulse underline">Use a different number</a>
          </form>
        ) : (
          <form action={sendCode} className="space-y-4">
            <label>
              Mobile number
              <input name="phone" type="tel" inputMode="numeric" autoComplete="tel" placeholder="98765 43210" required autoFocus />
            </label>
            <Button type="submit" className="w-full">Send code</Button>
            <p className="text-xs text-carbon/60">You stay logged in on this device until you log out.</p>
          </form>
        )}
      </div>
    </main>
  );
}
