'use server';

import { redirect } from 'next/navigation';
import { normalisePhone } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';

const back = (params: Record<string, string>) => redirect(`/login?${new URLSearchParams(params)}`);

export async function sendCode(form: FormData) {
  const phone = normalisePhone(String(form.get('phone') ?? ''));
  if (!/^[0-9]{11,15}$/.test(phone)) back({ error: 'Enter a 10-digit mobile number.' });
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithOtp({ phone: `+${phone}` });
  if (error) back({ error: `Could not send the code: ${error.message}` });
  back({ phone });
}

export async function verifyCode(form: FormData) {
  const phone = normalisePhone(String(form.get('phone') ?? ''));
  const token = String(form.get('code') ?? '').replace(/\D/g, '');
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.verifyOtp({ phone: `+${phone}`, token, type: 'sms' });
  if (error) back({ phone, error: 'That code is wrong or has expired. Try again.' });
  redirect('/');
}

export async function signOut() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect('/login');
}
