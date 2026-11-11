import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
export const isConfigured = () => SUPABASE_URL !== '' && SUPABASE_ANON_KEY !== '';

/** Supabase client acting as the logged-in user. Every query is subject to the database access rules. */
export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called while rendering a page: cookies are refreshed by proxy.ts instead.
        }
      },
    },
  });
}
