-- Ambly Ops: Phase 1 schema (operations data only).
-- Patient health data (Phase 4) will live in a separate schema with its own access rules.

create type user_role as enum ('admin', 'ops_manager', 'staff', 'client');
create type staff_role as enum ('driver', 'doctor');
create type staff_category as enum ('main', 'relief');
create type approval_status as enum ('not_submitted', 'submitted', 'approved', 'objected');

create table sites (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,          -- must match a rules file in config/sites
  name text not null,
  client_name text not null,
  provider_name text not null,
  created_at timestamptz not null default now()
);

create table staff (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites (id),
  full_name text not null,
  role staff_role not null,
  category staff_category not null default 'main',
  phone text,
  approval_status approval_status not null default 'not_submitted',
  docs_sent_at timestamptz,           -- when documents went to the client; starts the deemed-approval clock
  approved_at timestamptz,
  objection_note text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- People allowed to log in. Phone is digits only with country code, e.g. 919876543210.
create table app_users (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique check (phone ~ '^[0-9]{10,15}$'),
  full_name text not null,
  role user_role not null,
  site_id uuid references sites (id), -- null = all sites (admins)
  staff_id uuid references staff (id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table vehicles (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites (id),
  registration text not null,
  kind text not null default 'ALS',
  category text not null default 'main' check (category in ('main', 'backup')),
  owner_name text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (site_id, registration)
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites (id),
  staff_id uuid references staff (id) on delete cascade,
  vehicle_id uuid references vehicles (id) on delete cascade,
  doc_type text not null,
  doc_number text,
  issued_on date,
  expires_on date,
  file_path text,                     -- object path in the private "documents" storage bucket
  notes text,
  created_at timestamptz not null default now(),
  check ((staff_id is null) <> (vehicle_id is null))
);
create index documents_expiry_idx on documents (site_id, expires_on);

create table shifts (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites (id),
  staff_id uuid not null references staff (id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  check_in_at timestamptz,
  check_in_security text,             -- client security guard who signed the handover in
  check_out_at timestamptz,
  check_out_security text,
  notes text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index shifts_time_idx on shifts (site_id, starts_at);

create table audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  site_id uuid,
  actor_phone text,
  actor_name text,
  action text not null,
  table_name text not null,
  row_id text,
  old_row jsonb,
  new_row jsonb
);
create index audit_log_at_idx on audit_log (at desc);

-- ---------------------------------------------------------------------------
-- Who is calling? Helpers used by the access rules below.
-- ---------------------------------------------------------------------------

create function jwt_phone() returns text
language sql stable security definer set search_path = public, auth as $$
  select regexp_replace(coalesce((select phone from auth.users where id = auth.uid()), ''), '\D', '', 'g')
$$;

create function current_role_name() returns user_role
language sql stable security definer set search_path = public as $$
  select role from app_users where phone = jwt_phone() and active
$$;

create function has_role(variadic roles user_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(current_role_name() = any (roles), false)
$$;

create function can_access_site(s uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from app_users
    where phone = jwt_phone() and active and (site_id is null or site_id = s)
  )
$$;

create function admin_exists() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_users where role = 'admin' and active)
$$;

-- First-time setup: while no admin exists, the first person to log in can make themselves admin.
create function claim_first_admin(p_name text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  lock table app_users in exclusive mode;
  if jwt_phone() = '' or admin_exists() then
    return false;
  end if;
  insert into app_users (phone, full_name, role) values (jwt_phone(), p_name, 'admin')
  on conflict (phone) do update set role = 'admin', active = true, site_id = null, full_name = excluded.full_name;
  return true;
end $$;

-- Shift check-in / check-out. On-shift staff may only sign their own shift;
-- admins and the ops manager may record it on someone's behalf.
create function shift_check(p_shift uuid, p_kind text, p_security text) returns void
language plpgsql security definer set search_path = public as $$
declare
  me app_users;
  s shifts;
begin
  select * into me from app_users where phone = jwt_phone() and active;
  select * into s from shifts where id = p_shift;
  if me.id is null or s.id is null or not can_access_site(s.site_id) then
    raise exception 'Not allowed';
  end if;
  if me.role not in ('admin', 'ops_manager') and (me.role <> 'staff' or me.staff_id is distinct from s.staff_id) then
    raise exception 'You can only check in or out of your own shift';
  end if;
  if coalesce(trim(p_security), '') = '' then
    raise exception 'Security sign-off name is required';
  end if;
  if p_kind = 'in' then
    if s.check_in_at is not null then raise exception 'Already checked in'; end if;
    update shifts set check_in_at = now(), check_in_security = trim(p_security) where id = p_shift;
  elsif p_kind = 'out' then
    if s.check_in_at is null then raise exception 'Check in first'; end if;
    if s.check_out_at is not null then raise exception 'Already checked out'; end if;
    update shifts set check_out_at = now(), check_out_security = trim(p_security) where id = p_shift;
  else
    raise exception 'Unknown check type';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Audit trail: who changed what and when.
-- ---------------------------------------------------------------------------

create function audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb;
  n jsonb;
begin
  if tg_op <> 'INSERT' then o := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then n := to_jsonb(new); end if;
  insert into audit_log (site_id, actor_phone, actor_name, action, table_name, row_id, old_row, new_row)
  values (
    nullif(coalesce(n ->> 'site_id', o ->> 'site_id'), '')::uuid,
    nullif(jwt_phone(), ''),
    (select full_name from app_users where phone = jwt_phone()),
    tg_op, tg_table_name, coalesce(n ->> 'id', o ->> 'id'), o, n
  );
  return coalesce(new, old);
end $$;

create trigger audit_staff after insert or update or delete on staff for each row execute function audit_row();
create trigger audit_app_users after insert or update or delete on app_users for each row execute function audit_row();
create trigger audit_vehicles after insert or update or delete on vehicles for each row execute function audit_row();
create trigger audit_documents after insert or update or delete on documents for each row execute function audit_row();
create trigger audit_shifts after insert or update or delete on shifts for each row execute function audit_row();

-- ---------------------------------------------------------------------------
-- Access rules (row-level security). Nothing is readable without a matching rule.
-- The client role gets no access yet; its read-only view arrives in Phase 3.
-- ---------------------------------------------------------------------------

alter table sites enable row level security;
alter table staff enable row level security;
alter table app_users enable row level security;
alter table vehicles enable row level security;
alter table documents enable row level security;
alter table shifts enable row level security;
alter table audit_log enable row level security;

create policy sites_read on sites for select to authenticated using (can_access_site(id));
create policy sites_admin on sites for all to authenticated using (has_role('admin')) with check (has_role('admin'));

create policy app_users_read_self on app_users for select to authenticated using (phone = jwt_phone() or has_role('admin'));
create policy app_users_admin on app_users for all to authenticated using (has_role('admin')) with check (has_role('admin'));

create policy staff_read on staff for select to authenticated
  using (has_role('admin', 'ops_manager', 'staff') and can_access_site(site_id));
create policy staff_write on staff for all to authenticated
  using (has_role('admin', 'ops_manager') and can_access_site(site_id))
  with check (has_role('admin', 'ops_manager') and can_access_site(site_id));

create policy vehicles_read on vehicles for select to authenticated
  using (has_role('admin', 'ops_manager', 'staff') and can_access_site(site_id));
create policy vehicles_write on vehicles for all to authenticated
  using (has_role('admin', 'ops_manager') and can_access_site(site_id))
  with check (has_role('admin', 'ops_manager') and can_access_site(site_id));

create policy documents_rw on documents for all to authenticated
  using (has_role('admin', 'ops_manager') and can_access_site(site_id))
  with check (has_role('admin', 'ops_manager') and can_access_site(site_id));

create policy shifts_read on shifts for select to authenticated
  using (has_role('admin', 'ops_manager', 'staff') and can_access_site(site_id));
create policy shifts_write on shifts for all to authenticated
  using (has_role('admin', 'ops_manager') and can_access_site(site_id))
  with check (has_role('admin', 'ops_manager') and can_access_site(site_id));

create policy audit_read on audit_log for select to authenticated using (has_role('admin'));

revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated;
