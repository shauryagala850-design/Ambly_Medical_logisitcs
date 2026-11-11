import type { StaffRole } from '@/config/sites/types';
import type { ApprovalStatus } from './rules/eligibility';

export type UserRole = 'admin' | 'ops_manager' | 'staff' | 'client';

export interface SiteRow {
  id: string;
  slug: string;
  name: string;
  client_name: string;
  provider_name: string;
}
export interface AppUserRow {
  id: string;
  phone: string;
  full_name: string;
  role: UserRole;
  site_id: string | null;
  staff_id: string | null;
  active: boolean;
}
export interface StaffRow {
  id: string;
  site_id: string;
  full_name: string;
  role: StaffRole;
  category: 'main' | 'relief';
  phone: string | null;
  approval_status: ApprovalStatus;
  docs_sent_at: string | null;
  approved_at: string | null;
  objection_note: string | null;
  active: boolean;
}
export interface VehicleRow {
  id: string;
  site_id: string;
  registration: string;
  kind: string;
  category: 'main' | 'backup';
  owner_name: string | null;
  active: boolean;
}
export interface DocumentRow {
  id: string;
  site_id: string;
  staff_id: string | null;
  vehicle_id: string | null;
  doc_type: string;
  doc_number: string | null;
  issued_on: string | null;
  expires_on: string | null;
  file_path: string | null;
  notes: string | null;
}
export interface ShiftRow {
  id: string;
  site_id: string;
  staff_id: string;
  starts_at: string;
  ends_at: string;
  check_in_at: string | null;
  check_in_security: string | null;
  check_out_at: string | null;
  check_out_security: string | null;
  notes: string | null;
}
export interface AuditRow {
  id: number;
  at: string;
  actor_phone: string | null;
  actor_name: string | null;
  action: string;
  table_name: string;
  row_id: string | null;
  old_row: Record<string, unknown> | null;
  new_row: Record<string, unknown> | null;
}
