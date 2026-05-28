-- Camicurt Aula demo license for local/staging testing.
-- Do not add this file to migrations. Run it manually from the Supabase SQL editor.
--
-- Default testing teacher: pau@camicurt.cat.

do $$
declare
  v_org_name text := 'Camicurt Aula Demo';
  v_legal_name text := 'Camicurt Aula Demo';
  v_teacher_email text := 'pau@camicurt.cat';
  v_teacher_name text := 'Docent Demo';
  v_org_id uuid;
  v_license_id uuid;
  v_teacher_id uuid;
begin
  select id into v_org_id
  from public.aula_organizations
  where name = v_org_name
  order by created_at desc
  limit 1;

  if v_org_id is null then
    insert into public.aula_organizations (
      name, legal_name, city, province, contact_email, billing_email,
      allowed_domains, status, notes
    ) values (
      v_org_name, v_legal_name, 'Testing', 'Barcelona',
      lower(v_teacher_email), lower(v_teacher_email),
      array['camicurt.cat']::text[], 'active',
      'Demo license created from supabase/aula_demo_license.sql'
    )
    returning id into v_org_id;
  else
    update public.aula_organizations
    set legal_name = v_legal_name,
        contact_email = lower(v_teacher_email),
        billing_email = lower(v_teacher_email),
        status = 'active',
        notes = 'Demo license refreshed from supabase/aula_demo_license.sql'
    where id = v_org_id;
  end if;

  select id into v_license_id
  from public.aula_licenses
  where organization_id = v_org_id
    and billing_reference = 'AULA-DEMO-TEST'
  order by created_at desc
  limit 1;

  if v_license_id is null then
    insert into public.aula_licenses (
      organization_id, plan, status, starts_at, ends_at, max_teachers,
      max_classes, max_sessions_per_month, max_participants_per_session,
      features, price_cents, billing_reference, notes
    ) values (
      v_org_id, 'centre', 'trial', current_date, current_date + 90, 5,
      20, 500, 60,
      app_private.aula_plan_features('centre') || jsonb_build_object(
        'classroom_sessions', true,
        'projector_mode', true,
        'teacher_materials', true,
        'csv_export', true,
        'private_ranking', true,
        'custom_challenges', true,
        'advanced_reports', true
      ),
      0, 'AULA-DEMO-TEST',
      'Demo license for QA/testing. Safe to delete.'
    )
    returning id into v_license_id;

    insert into public.aula_license_events (
      license_id, organization_id, event_type, new_status, new_plan,
      new_ends_at, notes, metadata
    ) values (
      v_license_id, v_org_id, 'demo_license_created', 'trial', 'centre',
      current_date + 90, 'Created from supabase/aula_demo_license.sql',
      jsonb_build_object('testing', true)
    );
  else
    update public.aula_licenses
    set plan = 'centre',
        status = 'trial',
        starts_at = current_date,
        ends_at = current_date + 90,
        max_teachers = 5,
        max_classes = 20,
        max_sessions_per_month = 500,
        max_participants_per_session = 60,
        features = app_private.aula_plan_features('centre') || jsonb_build_object(
          'classroom_sessions', true,
          'projector_mode', true,
          'teacher_materials', true,
          'csv_export', true,
          'private_ranking', true,
          'custom_challenges', true,
          'advanced_reports', true
        ),
        price_cents = 0,
        notes = 'Demo license refreshed from supabase/aula_demo_license.sql'
    where id = v_license_id;

    insert into public.aula_license_events (
      license_id, organization_id, event_type, previous_status, new_status,
      previous_plan, new_plan, new_ends_at, notes, metadata
    ) values (
      v_license_id, v_org_id, 'demo_license_refreshed', 'trial', 'trial',
      'centre', 'centre', current_date + 90,
      'Refreshed from supabase/aula_demo_license.sql',
      jsonb_build_object('testing', true)
    );
  end if;

  select id into v_teacher_id
  from public.aula_teachers
  where organization_id = v_org_id
    and email_normalized = lower(btrim(v_teacher_email))
  order by created_at desc
  limit 1;

  if v_teacher_id is null then
    insert into public.aula_teachers (
      organization_id, email, full_name, role, status
    ) values (
      v_org_id, lower(v_teacher_email), v_teacher_name, 'school_admin', 'invited'
    )
    returning id into v_teacher_id;
  else
    update public.aula_teachers
    set email = lower(v_teacher_email),
        full_name = v_teacher_name,
        role = 'school_admin',
        status = case
          when status in ('active','invited') then status
          else 'invited'
        end,
        invited_at = coalesce(invited_at, now())
    where id = v_teacher_id;
  end if;

  raise notice 'Camicurt Aula demo ready. teacher_email=%, organization_id=%, license_id=%',
    v_teacher_email, v_org_id, v_license_id;
end;
$$;

select
  o.name as organization,
  l.plan,
  l.status as license_status,
  l.starts_at,
  l.ends_at,
  l.features,
  t.email as teacher_email,
  t.role as teacher_role,
  t.status as teacher_status
from public.aula_organizations o
join public.aula_licenses l on l.organization_id = o.id
join public.aula_teachers t on t.organization_id = o.id
where o.name = 'Camicurt Aula Demo'
order by l.created_at desc, t.created_at desc;
