import type { SupabaseClient } from '@supabase/supabase-js';
import type { DocForRules, StaffForRules } from './rules/eligibility';
import type { ShiftForRules } from './rules/roster';
import type { DocumentRow, ShiftRow, StaffRow, VehicleRow } from './types';

export async function loadStaff(db: SupabaseClient, siteId: string): Promise<StaffRow[]> {
  const { data, error } = await db.from('staff').select('*').eq('site_id', siteId).order('full_name');
  if (error) throw new Error(error.message);
  return data as StaffRow[];
}

export async function loadVehicles(db: SupabaseClient, siteId: string): Promise<VehicleRow[]> {
  const { data, error } = await db.from('vehicles').select('*').eq('site_id', siteId).order('category').order('registration');
  if (error) throw new Error(error.message);
  return data as VehicleRow[];
}

export async function loadDocuments(db: SupabaseClient, siteId: string): Promise<DocumentRow[]> {
  const { data, error } = await db.from('documents').select('*').eq('site_id', siteId).order('expires_on', { nullsFirst: false });
  if (error) throw new Error(error.message);
  return data as DocumentRow[];
}

/** Shifts overlapping [from, to), oldest first. */
export async function loadShifts(db: SupabaseClient, siteId: string, from: number, to: number): Promise<ShiftRow[]> {
  const { data, error } = await db
    .from('shifts')
    .select('*')
    .eq('site_id', siteId)
    .lt('starts_at', new Date(to).toISOString())
    .gt('ends_at', new Date(from).toISOString())
    .order('starts_at');
  if (error) throw new Error(error.message);
  return data as ShiftRow[];
}

export const staffForRules = (s: StaffRow): StaffForRules => ({
  id: s.id,
  role: s.role,
  active: s.active,
  approvalStatus: s.approval_status,
  docsSentAt: s.docs_sent_at ? Date.parse(s.docs_sent_at) : null,
});

export const docsForRules = (docs: DocumentRow[], staffId: string): DocForRules[] =>
  docs.filter((d) => d.staff_id === staffId).map((d) => ({ docType: d.doc_type, expiresOn: d.expires_on }));

export function shiftsForRules(shifts: ShiftRow[], staff: StaffRow[]): ShiftForRules[] {
  const roles = new Map(staff.map((s) => [s.id, s.role]));
  return shifts.map((s) => ({
    id: s.id,
    staffId: s.staff_id,
    role: roles.get(s.staff_id) ?? 'driver',
    start: Date.parse(s.starts_at),
    end: Date.parse(s.ends_at),
  }));
}
