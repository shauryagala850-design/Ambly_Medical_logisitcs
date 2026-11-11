import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { rulesForSite } from '@/config/sites';
import { supabaseServer } from './supabase/server';
import type { AppUserRow, SiteRow, UserRole } from './types';

/** Digits only, with India's country code added to a bare 10-digit number. */
export function normalisePhone(input: string): string {
  const digits = input.replace(/\D/g, '').replace(/^0+/, '');
  return digits.length === 10 ? `91${digits}` : digits;
}

export const SITE_COOKIE = 'ambly_site';

const loadSession = cache(async () => {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: me } = await supabase
    .from('app_users')
    .select('*')
    .eq('phone', normalisePhone(user.phone ?? ''))
    .eq('active', true)
    .maybeSingle<AppUserRow>();
  if (!me || me.role === 'client') redirect('/no-access');

  const { data: sites } = await supabase.from('sites').select('*').order('name').returns<SiteRow[]>();
  if (!sites || sites.length === 0) redirect('/no-access?reason=no-site');
  const wanted = (await cookies()).get(SITE_COOKIE)?.value;
  const site = sites.find((s) => s.slug === wanted) ?? sites[0];

  return { supabase, me, site, sites, rules: rulesForSite(site.slug) };
});

/** Use at the top of every page and action. Redirects anyone not logged in or not in the allowed roles. */
export async function requireUser(allowed?: UserRole[]) {
  const session = await loadSession();
  if (allowed && !allowed.includes(session.me.role)) {
    redirect(session.me.role === 'staff' ? '/duty' : '/');
  }
  return session;
}

export const MANAGERS: UserRole[] = ['admin', 'ops_manager'];
