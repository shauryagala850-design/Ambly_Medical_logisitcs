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
