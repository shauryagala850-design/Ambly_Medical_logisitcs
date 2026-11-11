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
-- Private file storage for staff and vehicle documents.
-- Object paths: <site-slug>/staff/<staff-id>/<file>  or  <site-slug>/vehicle/<vehicle-id>/<file>
-- Files are only ever opened through short-lived signed links.

insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', false, 5242880)
on conflict (id) do nothing;

create policy documents_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and public.has_role('admin', 'ops_manager'));

-- Staff documents (IDs etc.) can be opened by admins only; the ops manager can open vehicle documents.
create policy documents_view on storage.objects for select to authenticated
  using (
    bucket_id = 'documents'
    and (
      public.has_role('admin')
      or (public.has_role('ops_manager') and (storage.foldername(name))[2] = 'vehicle')
    )
  );

create policy documents_delete on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and public.has_role('admin'));
-- Sample data for Marathon Futurex. All people below are MADE UP for testing.
-- Dates are relative to the day you run this, so alerts and the roster look live.

do $$
declare
  v_site uuid;
  v_amb uuid;
  v_backup uuid;
  d1 uuid; d2 uuid; d3 uuid; r1 uuid; r2 uuid; r3 uuid; doc1 uuid; doc2 uuid;
  monday date := date_trunc('week', (now() at time zone 'Asia/Kolkata'))::date;
  today date := (now() at time zone 'Asia/Kolkata')::date;
  p record;
  i int;
  dow int;
  dy date;
begin
  if exists (select 1 from sites where slug = 'marathon-futurex') then
    raise notice 'Sample data already loaded; nothing to do.';
    return;
  end if;

  insert into sites (slug, name, client_name, provider_name)
  values ('marathon-futurex', 'Marathon Futurex, Lower Parel', 'Marathon Nextgen Realty Limited', 'Ezung Healthcare Private Limited')
  returning id into v_site;

  -- Staff pool -------------------------------------------------------------
  insert into staff (site_id, full_name, role, category, phone, approval_status, docs_sent_at, approved_at)
  values (v_site, 'Sample Driver One', 'driver', 'main', '910000000001', 'approved', now() - interval '20 days', now() - interval '18 days') returning id into d1;
  insert into staff (site_id, full_name, role, category, phone, approval_status, docs_sent_at, approved_at)
  values (v_site, 'Sample Driver Two', 'driver', 'main', '910000000002', 'approved', now() - interval '20 days', now() - interval '18 days') returning id into d2;
  insert into staff (site_id, full_name, role, category, phone, approval_status, docs_sent_at, approved_at)
  values (v_site, 'Sample Driver Three', 'driver', 'main', '910000000003', 'approved', now() - interval '20 days', now() - interval '18 days') returning id into d3;
  -- Deemed approved: documents sent 10 days ago, no objection, never explicitly approved.
  insert into staff (site_id, full_name, role, category, phone, approval_status, docs_sent_at)
  values (v_site, 'Sample Relief Driver A', 'driver', 'relief', '910000000004', 'submitted', now() - interval '10 days') returning id into r1;
  -- Approved, but BLS certificate has expired: must be blocked from the roster.
  insert into staff (site_id, full_name, role, category, phone, approval_status, docs_sent_at, approved_at)
  values (v_site, 'Sample Relief Driver B', 'driver', 'relief', '910000000005', 'approved', now() - interval '20 days', now() - interval '18 days') returning id into r2;
  -- Documents sent yesterday: approval still pending.
  insert into staff (site_id, full_name, role, category, phone, approval_status, docs_sent_at)
  values (v_site, 'Sample Relief Driver C', 'driver', 'relief', '910000000006', 'submitted', now() - interval '1 day') returning id into r3;
  insert into staff (site_id, full_name, role, category, phone, approval_status, docs_sent_at, approved_at)
  values (v_site, 'Dr. Sample Doctor', 'doctor', 'main', '910000000007', 'approved', now() - interval '20 days', now() - interval '18 days') returning id into doc1;
  insert into staff (site_id, full_name, role, category, phone, approval_status, docs_sent_at, approved_at)
  values (v_site, 'Dr. Sample Relief Doctor', 'doctor', 'relief', '910000000008', 'approved', now() - interval '20 days', now() - interval '18 days') returning id into doc2;

  -- Staff documents ----------------------------------------------------------
  for p in select id, role from staff where site_id = v_site loop
    insert into documents (site_id, staff_id, doc_type, doc_number, issued_on, expires_on) values
      (v_site, p.id, 'id_proof', 'SAMPLE-ID', today - 400, null),
      (v_site, p.id, 'qualification', 'SAMPLE-QUAL', today - 900, null),
      (v_site, p.id, 'employer_references', null, today - 30, null),
      (v_site, p.id, 'self_declaration', null, today - 30, null);
    if p.role = 'driver' then
      insert into documents (site_id, staff_id, doc_type, doc_number, issued_on, expires_on) values
        (v_site, p.id, 'driving_licence', 'MH00-SAMPLE', today - 1500, today + 900),
        (v_site, p.id, 'bls_certificate', 'BLS-SAMPLE', today - 300, today + 430);
    else
      insert into documents (site_id, staff_id, doc_type, doc_number, issued_on, expires_on) values
        (v_site, p.id, 'medical_registration', 'MMC-SAMPLE', today - 700, today + 1100);
    end if;
  end loop;
  -- Variations so every alert level shows up.
  update documents set expires_on = today - 12 where staff_id = r2 and doc_type = 'bls_certificate';   -- expired
  update documents set expires_on = today + 5 where staff_id = d3 and doc_type = 'driving_licence';    -- 7-day alert
  update documents set expires_on = today + 24 where staff_id = d1 and doc_type = 'bls_certificate';   -- 30-day alert
  update documents set expires_on = today + 52 where staff_id = doc2 and doc_type = 'medical_registration'; -- 60-day alert

  -- Vehicles -----------------------------------------------------------------
  insert into vehicles (site_id, registration, kind, category, owner_name)
  values (v_site, 'MH-48-K-1058', 'ALS', 'main', 'Ezung Healthcare Private Limited') returning id into v_amb;
  insert into vehicles (site_id, registration, kind, category, owner_name)
  values (v_site, 'MH-00-XX-0000', 'ALS', 'backup', 'Ezung Healthcare Private Limited') returning id into v_backup;

  insert into documents (site_id, vehicle_id, doc_type, doc_number, issued_on, expires_on, notes) values
    (v_site, v_amb, 'rc', 'SAMPLE-RC', today - 500, null, null),
    (v_site, v_amb, 'fitness_certificate', 'SAMPLE-FIT', today - 200, today + 165, null),
    (v_site, v_amb, 'permit', 'SAMPLE-PERMIT', today - 200, today + 500, null),
    (v_site, v_amb, 'puc', 'SAMPLE-PUC', today - 160, today + 20, null),
    (v_site, v_amb, 'motor_insurance', 'SAMPLE-POLICY', null, date '2027-07-11', 'Held by the registered owner. Expiry date is from the contract.'),
    (v_site, v_amb, 'insurer_confirmation', null, today - 30, null, null),
    (v_site, v_backup, 'rc', 'SAMPLE-RC-2', today - 800, null, null),
    (v_site, v_backup, 'fitness_certificate', 'SAMPLE-FIT-2', today - 100, today + 265, null),
    (v_site, v_backup, 'puc', 'SAMPLE-PUC-2', today - 60, today + 120, null),
    (v_site, v_backup, 'motor_insurance', 'SAMPLE-POLICY-2', today - 100, today + 265, null);
    -- The backup ambulance deliberately has no permit or insurer confirmation on file.

  -- Roster: last week, this week and next week ------------------------------------
  -- Mornings: Driver One (off Sunday). Afternoons: Driver Two (off Monday). Nights: Driver Three (off Tuesday).
  -- Relief Driver A covers the weekly offs. Doctor works Mon-Sat; relief doctor covers Sunday.
  for i in -7..13 loop
    dy := monday + i;
    dow := extract(isodow from dy);   -- 1 = Monday ... 7 = Sunday
    insert into shifts (site_id, staff_id, starts_at, ends_at) values
      (v_site, case when dow = 7 then r1 else d1 end, (dy + time '06:00') at time zone 'Asia/Kolkata', (dy + time '14:00') at time zone 'Asia/Kolkata'),
      (v_site, case when dow = 1 then r1 else d2 end, (dy + time '14:00') at time zone 'Asia/Kolkata', (dy + time '22:00') at time zone 'Asia/Kolkata'),
      (v_site, case when dow = 7 then doc2 else doc1 end, (dy + time '10:00') at time zone 'Asia/Kolkata', (dy + time '18:00') at time zone 'Asia/Kolkata');
    -- Next week's Tuesday night relief shift is deliberately left unfilled so the gap warning shows.
    if not (dow = 2 and i >= 7) then
      insert into shifts (site_id, staff_id, starts_at, ends_at) values
        (v_site, case when dow = 2 then r1 else d3 end, (dy + time '22:00') at time zone 'Asia/Kolkata', (dy + 1 + time '06:00') at time zone 'Asia/Kolkata');
    end if;
  end loop;

  -- Completed shifts have check-in/out with security sign-off.
  update shifts set check_in_at = starts_at, check_in_security = 'Sample Guard (Gate 1)',
                    check_out_at = ends_at, check_out_security = 'Sample Guard (Gate 1)'
  where site_id = v_site and ends_at < now();
  update shifts set check_in_at = starts_at, check_in_security = 'Sample Guard (Gate 1)'
  where site_id = v_site and starts_at <= now() and ends_at >= now();

  delete from audit_log;  -- start the audit trail clean after loading sample data
end $$;
