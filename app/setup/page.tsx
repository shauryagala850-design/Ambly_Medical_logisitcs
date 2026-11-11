import { redirect } from 'next/navigation';
import { isConfigured } from '@/lib/supabase/server';

export default function Setup() {
  if (isConfigured()) redirect('/');
  return (
    <main className="flex min-h-screen items-center justify-center bg-pulse p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 text-sm">
        <h1 className="mb-3 text-3xl font-bold text-pulse">Ambly</h1>
        <p>
          The app is deployed but not yet connected to its database. Add <code>NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
          <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in Vercel (Project → Settings → Environment Variables), then redeploy.
          The README has the steps.
        </p>
      </div>
    </main>
  );
}
