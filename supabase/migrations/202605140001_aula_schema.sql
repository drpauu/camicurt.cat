-- Camicurt Aula schema, access helpers, RPC wrappers, RLS and starter content.
-- Additive migration. It does not modify public game tables.

create extension if not exists pgcrypto;

create schema if not exists app_private;

create table if not exists public.aula_organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text,
  city text,
  province text,
  country text default 'ES',
  contact_email text,
  billing_email text,
  allowed_domains text[] default '{}'::text[],
  status text default 'active',
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint aula_organizations_status_chk check (status in ('active','blocked','archived'))
);

create table if not exists public.aula_licenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.aula_organizations(id) on delete cascade,
  plan text not null,
  status text not null,
  starts_at date not null,
  ends_at date not null,
  max_teachers int default 1,
  max_classes int,
  max_sessions_per_month int,
  max_participants_per_session int,
  features jsonb default '{}'::jsonb,
  price_cents int,
  currency text default 'EUR',
  billing_reference text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint aula_licenses_plan_chk check (plan in ('pilot','basic','plus','centre')),
  constraint aula_licenses_status_chk check (
    status in ('trial','active','expired','pending_payment','suspended','cancelled')
  ),
  constraint aula_licenses_dates_chk check (ends_at >= starts_at)
);

create table if not exists public.aula_teachers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.aula_organizations(id) on delete cascade,
  user_id uuid unique references auth.users(id) on delete set null,
  email text not null,
  email_normalized text generated always as (lower(btrim(email))) stored,
  full_name text,
  role text default 'teacher',
  status text default 'invited',
  invited_at timestamptz default now(),
  activated_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint aula_teachers_role_chk check (role in ('teacher','school_admin','camicurt_admin')),
  constraint aula_teachers_status_chk check (status in ('invited','active','disabled','removed'))
);

create table if not exists public.aula_license_events (
  id uuid primary key default gen_random_uuid(),
  license_id uuid references public.aula_licenses(id) on delete cascade,
  organization_id uuid references public.aula_organizations(id) on delete cascade,
  event_type text not null,
  previous_status text,
  new_status text,
  previous_plan text,
  new_plan text,
  previous_ends_at date,
  new_ends_at date,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_email text,
  notes text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists public.aula_classes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.aula_organizations(id) on delete cascade,
  teacher_id uuid references public.aula_teachers(id) on delete cascade,
  name text not null,
  level text,
  academic_year text,
  archived boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.aula_challenge_packs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text unique not null,
  description text,
  level text,
  estimated_minutes int,
  recommended_cycle text,
  is_active boolean default true,
  is_premium boolean default true,
  required_feature text,
  sort_order int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.aula_challenges (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid references public.aula_challenge_packs(id) on delete cascade,
  title text not null,
  description text,
  start_id text not null,
  target_id text not null,
  difficulty_id text not null,
  rule_id text,
  rule jsonb,
  avoid_ids text[],
  must_pass_ids text[],
  shortest_path text[] not null,
  shortest_internal_count int not null,
  teacher_explanation text,
  student_prompt text,
  is_active boolean default true,
  sort_order int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.aula_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.aula_organizations(id) on delete cascade,
  teacher_id uuid references public.aula_teachers(id) on delete cascade,
  class_id uuid references public.aula_classes(id) on delete set null,
  challenge_id uuid references public.aula_challenges(id) on delete restrict,
  join_code text unique not null,
  status text default 'draft',
  title text,
  starts_at timestamptz,
  opened_at timestamptz,
  closed_at timestamptz,
  expires_at timestamptz not null,
  settings jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint aula_sessions_status_chk check (status in ('draft','open','closed','archived'))
);

create table if not exists public.aula_participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.aula_sessions(id) on delete cascade,
  display_name text not null,
  display_name_normalized text generated always as (lower(btrim(display_name))) stored,
  participant_token_hash text not null,
  created_at timestamptz default now(),
  last_seen_at timestamptz,
  constraint aula_participants_display_name_chk check (char_length(display_name) between 1 and 60)
);

create table if not exists public.aula_results (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.aula_sessions(id) on delete cascade,
  participant_id uuid references public.aula_participants(id) on delete cascade,
  completed boolean default false,
  attempts_count int default 0,
  time_seconds int,
  precision int,
  optimal_internal_count int,
  found_internal_count int,
  distance_from_optimal int,
  attempts text[] default '{}'::text[],
  found_path text[],
  optimal_path text[],
  client_payload jsonb default '{}'::jsonb,
  verified boolean default false,
  submitted_at timestamptz default now(),
  unique(session_id, participant_id)
);

create table if not exists public.aula_materials (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  material_type text not null,
  pack_id uuid references public.aula_challenge_packs(id) on delete set null,
  storage_path text,
  external_url text,
  required_feature text,
  is_active boolean default true,
  created_at timestamptz default now(),
  constraint aula_materials_type_chk check (
    material_type in ('teacher_guide','worksheet','solutionary','slides','rubric','other')
  )
);

create table if not exists public.aula_audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.aula_organizations(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_type text,
  target_id uuid,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists aula_licenses_organization_id_idx on public.aula_licenses(organization_id);
create index if not exists aula_licenses_status_dates_idx on public.aula_licenses(status, starts_at, ends_at);
create index if not exists aula_teachers_user_id_idx on public.aula_teachers(user_id);
create index if not exists aula_teachers_email_normalized_idx on public.aula_teachers(email_normalized);
create unique index if not exists aula_teachers_org_email_normalized_key
  on public.aula_teachers(organization_id, email_normalized);
create index if not exists aula_sessions_organization_created_idx
  on public.aula_sessions(organization_id, created_at desc);
create index if not exists aula_sessions_teacher_created_idx
  on public.aula_sessions(teacher_id, created_at desc);
create index if not exists aula_sessions_join_code_idx on public.aula_sessions(join_code);
create index if not exists aula_participants_session_id_idx on public.aula_participants(session_id);
create index if not exists aula_results_session_id_idx on public.aula_results(session_id);
create index if not exists aula_license_events_license_created_idx
  on public.aula_license_events(license_id, created_at desc);
create index if not exists aula_license_events_org_created_idx
  on public.aula_license_events(organization_id, created_at desc);

create or replace function app_private.aula_set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists aula_organizations_updated_at on public.aula_organizations;
create trigger aula_organizations_updated_at
  before update on public.aula_organizations
  for each row execute function app_private.aula_set_updated_at();

drop trigger if exists aula_licenses_updated_at on public.aula_licenses;
create trigger aula_licenses_updated_at
  before update on public.aula_licenses
  for each row execute function app_private.aula_set_updated_at();

drop trigger if exists aula_teachers_updated_at on public.aula_teachers;
create trigger aula_teachers_updated_at
  before update on public.aula_teachers
  for each row execute function app_private.aula_set_updated_at();

drop trigger if exists aula_classes_updated_at on public.aula_classes;
create trigger aula_classes_updated_at
  before update on public.aula_classes
  for each row execute function app_private.aula_set_updated_at();

drop trigger if exists aula_challenge_packs_updated_at on public.aula_challenge_packs;
create trigger aula_challenge_packs_updated_at
  before update on public.aula_challenge_packs
  for each row execute function app_private.aula_set_updated_at();

drop trigger if exists aula_challenges_updated_at on public.aula_challenges;
create trigger aula_challenges_updated_at
  before update on public.aula_challenges
  for each row execute function app_private.aula_set_updated_at();

drop trigger if exists aula_sessions_updated_at on public.aula_sessions;
create trigger aula_sessions_updated_at
  before update on public.aula_sessions
  for each row execute function app_private.aula_set_updated_at();

create or replace function app_private.aula_plan_features(p_plan text)
returns jsonb
language sql
immutable
as $$
  select case p_plan
    when 'pilot' then jsonb_build_object(
      'classroom_sessions', true, 'projector_mode', true, 'teacher_materials', true,
      'csv_export', false, 'private_ranking', false, 'custom_challenges', false,
      'advanced_reports', false
    )
    when 'basic' then jsonb_build_object(
      'classroom_sessions', true, 'projector_mode', true, 'teacher_materials', true,
      'csv_export', false, 'private_ranking', true, 'custom_challenges', false,
      'advanced_reports', false
    )
    when 'plus' then jsonb_build_object(
      'classroom_sessions', true, 'projector_mode', true, 'teacher_materials', true,
      'csv_export', true, 'private_ranking', true, 'custom_challenges', true,
      'advanced_reports', false
    )
    when 'centre' then jsonb_build_object(
      'classroom_sessions', true, 'projector_mode', true, 'teacher_materials', true,
      'csv_export', true, 'private_ranking', true, 'custom_challenges', true,
      'advanced_reports', true
    )
    else '{}'::jsonb
  end
$$;

create or replace function app_private.aula_current_teacher_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select t.id
  from public.aula_teachers t
  where t.user_id = auth.uid()
    and t.status = 'active'
  order by t.activated_at nulls last, t.created_at
  limit 1
$$;

create or replace function app_private.aula_current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select t.organization_id
  from public.aula_teachers t
  where t.id = app_private.aula_current_teacher_id()
  limit 1
$$;

create or replace function app_private.aula_active_license_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select l.id
  from public.aula_licenses l
  join public.aula_organizations o on o.id = l.organization_id
  where l.organization_id = app_private.aula_current_org_id()
    and o.status = 'active'
    and l.status in ('trial','active')
    and l.starts_at <= current_date
    and l.ends_at >= current_date
  order by l.ends_at desc, l.created_at desc
  limit 1
$$;

create or replace function app_private.aula_can_access()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select app_private.aula_active_license_id() is not null
$$;

create or replace function app_private.aula_has_feature(feature_key text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((l.features ->> feature_key)::boolean, false)
  from public.aula_licenses l
  where l.id = app_private.aula_active_license_id()
$$;

create or replace function app_private.aula_is_camicurt_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.aula_teachers t
    where t.user_id = auth.uid()
      and t.status = 'active'
      and t.role = 'camicurt_admin'
  )
$$;

create or replace function app_private.aula_get_access_impl()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_teacher public.aula_teachers%rowtype;
  v_org public.aula_organizations%rowtype;
  v_license public.aula_licenses%rowtype;
begin
  if auth.uid() is null then
    return jsonb_build_object('allowed', false, 'reason', 'unauthenticated');
  end if;

  select * into v_teacher
  from public.aula_teachers
  where user_id = auth.uid()
  order by activated_at nulls last, created_at
  limit 1;

  if v_teacher.id is null then
    return jsonb_build_object('allowed', false, 'reason', 'no_teacher');
  end if;

  if v_teacher.status <> 'active' then
    return jsonb_build_object('allowed', false, 'reason', 'teacher_disabled');
  end if;

  select * into v_org from public.aula_organizations where id = v_teacher.organization_id;
  if v_org.id is null or v_org.status <> 'active' then
    return jsonb_build_object('allowed', false, 'reason', 'organization_blocked');
  end if;

  select * into v_license
  from public.aula_licenses
  where organization_id = v_org.id
    and status in ('trial','active')
    and starts_at <= current_date
    and ends_at >= current_date
  order by ends_at desc, created_at desc
  limit 1;

  if v_license.id is null then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'no_active_license',
      'teacher', jsonb_build_object('email', v_teacher.email, 'role', v_teacher.role),
      'organization', jsonb_build_object('id', v_org.id, 'name', v_org.name)
    );
  end if;

  update public.aula_teachers
  set last_seen_at = now()
  where id = v_teacher.id;

  return jsonb_build_object(
    'allowed', true,
    'teacher', jsonb_build_object(
      'id', v_teacher.id,
      'email', v_teacher.email,
      'full_name', v_teacher.full_name,
      'role', v_teacher.role,
      'status', v_teacher.status
    ),
    'organization', jsonb_build_object(
      'id', v_org.id,
      'name', v_org.name,
      'legal_name', v_org.legal_name,
      'city', v_org.city,
      'province', v_org.province,
      'status', v_org.status
    ),
    'license', jsonb_build_object(
      'id', v_license.id,
      'plan', v_license.plan,
      'status', v_license.status,
      'starts_at', v_license.starts_at,
      'ends_at', v_license.ends_at,
      'features', v_license.features,
      'max_teachers', v_license.max_teachers,
      'max_participants_per_session', v_license.max_participants_per_session
    )
  );
end;
$$;

create or replace function app_private.aula_claim_teacher_impl()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
  v_teacher public.aula_teachers%rowtype;
  v_org public.aula_organizations%rowtype;
  v_license public.aula_licenses%rowtype;
  v_active_count int;
begin
  if v_uid is null then
    raise exception 'Cal iniciar sessio.' using errcode = '28000';
  end if;
  if v_email = '' then
    raise exception 'No s''ha pogut llegir el correu del magic link.';
  end if;

  select t.* into v_teacher
  from public.aula_teachers t
  join public.aula_organizations o on o.id = t.organization_id and o.status = 'active'
  join public.aula_licenses l on l.organization_id = t.organization_id
    and l.status in ('trial','active')
    and l.starts_at <= current_date
    and l.ends_at >= current_date
  where t.email_normalized = v_email
    and t.status in ('invited','active')
    and (t.user_id is null or t.user_id = v_uid)
  order by t.status = 'active' desc, t.invited_at desc
  limit 1;

  if v_teacher.id is null then
    raise exception 'Aquest correu no te cap llicencia activa de Camicurt Aula.';
  end if;

  select * into v_org from public.aula_organizations where id = v_teacher.organization_id;
  select * into v_license
  from public.aula_licenses
  where organization_id = v_teacher.organization_id
    and status in ('trial','active')
    and starts_at <= current_date
    and ends_at >= current_date
  order by ends_at desc, created_at desc
  limit 1;

  if v_license.id is null then
    raise exception 'Aquest centre no te cap llicencia activa.';
  end if;

  if v_teacher.status <> 'active' then
    select count(*) into v_active_count
    from public.aula_teachers
    where organization_id = v_teacher.organization_id
      and status = 'active'
      and user_id is not null;

    if v_license.max_teachers is not null and v_active_count >= v_license.max_teachers then
      raise exception 'La llicencia ha arribat al limit de docents.';
    end if;
  end if;

  update public.aula_teachers
  set user_id = v_uid,
      status = 'active',
      activated_at = coalesce(activated_at, now()),
      last_seen_at = now()
  where id = v_teacher.id;

  insert into public.aula_license_events (
    license_id, organization_id, event_type, actor_user_id, actor_email, notes
  ) values (
    v_license.id, v_org.id, 'teacher_activated', v_uid, v_email, 'Docent activat via magic link'
  );

  insert into public.aula_audit_logs (
    organization_id, actor_user_id, action, target_type, target_id, metadata
  ) values (
    v_org.id, v_uid, 'teacher_activated', 'aula_teacher', v_teacher.id,
    jsonb_build_object('email', v_email)
  );

  return jsonb_build_object('claimed', true, 'teacher_id', v_teacher.id, 'organization_id', v_org.id);
end;
$$;

create or replace function app_private.aula_generate_join_code()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code text;
begin
  loop
    v_code := upper(substr(encode(gen_random_bytes(5), 'base64'), 1, 7));
    v_code := regexp_replace(v_code, '[^A-Z0-9]', '', 'g');
    v_code := replace(replace(replace(v_code, 'O', '2'), 'I', '3'), 'L', '4');
    v_code := substr(v_code || upper(substr(encode(gen_random_bytes(3), 'hex'), 1, 7)), 1, 7);
    exit when not exists (select 1 from public.aula_sessions where join_code = v_code);
  end loop;
  return v_code;
end;
$$;

create or replace function app_private.aula_create_session_impl(
  p_class_id uuid,
  p_challenge_id uuid,
  p_title text,
  p_settings jsonb
)
returns public.aula_sessions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_teacher_id uuid := app_private.aula_current_teacher_id();
  v_org_id uuid := app_private.aula_current_org_id();
  v_license_id uuid := app_private.aula_active_license_id();
  v_session public.aula_sessions%rowtype;
  v_month_count int;
  v_max_sessions int;
begin
  if v_teacher_id is null or v_org_id is null or v_license_id is null then
    raise exception 'No hi ha acces Aula actiu.' using errcode = '28000';
  end if;
  if not app_private.aula_has_feature('classroom_sessions') then
    raise exception 'La llicencia no inclou sessions d''aula.';
  end if;
  if not exists (select 1 from public.aula_challenges where id = p_challenge_id and is_active) then
    raise exception 'Repte no disponible.';
  end if;
  if p_class_id is not null and not exists (
    select 1 from public.aula_classes
    where id = p_class_id and organization_id = v_org_id
  ) then
    raise exception 'Classe no disponible.';
  end if;

  select max_sessions_per_month into v_max_sessions
  from public.aula_licenses where id = v_license_id;
  if v_max_sessions is not null then
    select count(*) into v_month_count
    from public.aula_sessions
    where organization_id = v_org_id
      and created_at >= date_trunc('month', now());
    if v_month_count >= v_max_sessions then
      raise exception 'La llicencia ha arribat al limit mensual de sessions.';
    end if;
  end if;

  insert into public.aula_sessions (
    organization_id, teacher_id, class_id, challenge_id, join_code, status,
    title, expires_at, settings
  ) values (
    v_org_id, v_teacher_id, p_class_id, p_challenge_id, app_private.aula_generate_join_code(),
    'draft', nullif(btrim(p_title), ''), now() + interval '8 hours',
    coalesce(p_settings, '{}'::jsonb)
  )
  returning * into v_session;

  insert into public.aula_audit_logs (
    organization_id, actor_user_id, action, target_type, target_id, metadata
  ) values (
    v_org_id, auth.uid(), 'session_created', 'aula_session', v_session.id,
    jsonb_build_object('challenge_id', p_challenge_id)
  );

  return v_session;
end;
$$;

create or replace function app_private.aula_set_session_status_impl(
  p_session_id uuid,
  p_status text
)
returns public.aula_sessions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_teacher_id uuid := app_private.aula_current_teacher_id();
  v_org_id uuid := app_private.aula_current_org_id();
  v_session public.aula_sessions%rowtype;
begin
  if not app_private.aula_can_access() then
    raise exception 'No hi ha acces Aula actiu.' using errcode = '28000';
  end if;
  if p_status not in ('open','closed','archived') then
    raise exception 'Estat de sessio invalid.';
  end if;

  select * into v_session
  from public.aula_sessions
  where id = p_session_id
    and organization_id = v_org_id
    and teacher_id = v_teacher_id
  for update;

  if v_session.id is null then
    raise exception 'Sessio no trobada.';
  end if;

  update public.aula_sessions
  set status = p_status,
      opened_at = case when p_status = 'open' then coalesce(opened_at, now()) else opened_at end,
      closed_at = case when p_status = 'closed' then coalesce(closed_at, now()) else closed_at end
  where id = p_session_id
  returning * into v_session;

  insert into public.aula_audit_logs (
    organization_id, actor_user_id, action, target_type, target_id, metadata
  ) values (
    v_org_id, auth.uid(), 'session_status_changed', 'aula_session', p_session_id,
    jsonb_build_object('status', p_status)
  );

  return v_session;
end;
$$;

create or replace function app_private.aula_admin_create_license_impl(
  p_organization_name text,
  p_legal_name text,
  p_city text,
  p_province text,
  p_contact_email text,
  p_billing_email text,
  p_allowed_domains text[],
  p_plan text,
  p_status text,
  p_starts_at date,
  p_ends_at date,
  p_max_teachers int,
  p_max_classes int,
  p_max_sessions_per_month int,
  p_max_participants_per_session int,
  p_price_cents int,
  p_billing_reference text,
  p_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org public.aula_organizations%rowtype;
  v_license public.aula_licenses%rowtype;
begin
  if not app_private.aula_is_camicurt_admin() then
    raise exception 'No autoritzat.' using errcode = '28000';
  end if;

  insert into public.aula_organizations (
    name, legal_name, city, province, contact_email, billing_email,
    allowed_domains, notes
  ) values (
    btrim(p_organization_name), nullif(btrim(p_legal_name), ''),
    nullif(btrim(p_city), ''), nullif(btrim(p_province), ''),
    nullif(lower(btrim(p_contact_email)), ''), nullif(lower(btrim(p_billing_email)), ''),
    coalesce(p_allowed_domains, '{}'::text[]), p_notes
  )
  returning * into v_org;

  insert into public.aula_licenses (
    organization_id, plan, status, starts_at, ends_at, max_teachers,
    max_classes, max_sessions_per_month, max_participants_per_session,
    features, price_cents, billing_reference, notes
  ) values (
    v_org.id, p_plan, p_status, p_starts_at, p_ends_at, coalesce(p_max_teachers, 1),
    p_max_classes, p_max_sessions_per_month, p_max_participants_per_session,
    app_private.aula_plan_features(p_plan), p_price_cents, p_billing_reference, p_notes
  )
  returning * into v_license;

  insert into public.aula_license_events (
    license_id, organization_id, event_type, new_status, new_plan, new_ends_at,
    actor_user_id, actor_email, notes
  ) values (
    v_license.id, v_org.id, 'license_created', v_license.status, v_license.plan,
    v_license.ends_at, auth.uid(), auth.jwt() ->> 'email', p_notes
  );

  return jsonb_build_object('organization_id', v_org.id, 'license_id', v_license.id);
end;
$$;

create or replace function app_private.aula_admin_invite_teacher_impl(
  p_organization_id uuid,
  p_email text,
  p_full_name text,
  p_role text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_license public.aula_licenses%rowtype;
  v_teacher public.aula_teachers%rowtype;
  v_count int;
  v_email text := lower(btrim(p_email));
  v_role text := coalesce(nullif(p_role, ''), 'teacher');
begin
  if not app_private.aula_is_camicurt_admin() then
    raise exception 'No autoritzat.' using errcode = '28000';
  end if;
  if v_role not in ('teacher','school_admin','camicurt_admin') then
    raise exception 'Rol invalid.';
  end if;

  select * into v_license
  from public.aula_licenses
  where organization_id = p_organization_id
    and status in ('trial','active')
    and starts_at <= current_date
    and ends_at >= current_date
  order by ends_at desc, created_at desc
  limit 1;
  if v_license.id is null then
    raise exception 'El centre no te llicencia activa.';
  end if;

  select count(*) into v_count
  from public.aula_teachers
  where organization_id = p_organization_id
    and status in ('invited','active');
  if v_license.max_teachers is not null and v_count >= v_license.max_teachers then
    raise exception 'La llicencia ha arribat al limit de docents.';
  end if;

  insert into public.aula_teachers (
    organization_id, email, full_name, role, status, invited_at
  ) values (
    p_organization_id, v_email, nullif(btrim(p_full_name), ''), v_role, 'invited', now()
  )
  on conflict (organization_id, email_normalized) do update
  set full_name = excluded.full_name,
      role = excluded.role,
      status = case when public.aula_teachers.status = 'removed' then 'invited' else public.aula_teachers.status end,
      invited_at = coalesce(public.aula_teachers.invited_at, now())
  returning * into v_teacher;

  insert into public.aula_license_events (
    license_id, organization_id, event_type, actor_user_id, actor_email, notes,
    metadata
  ) values (
    v_license.id, p_organization_id, 'teacher_invited', auth.uid(), auth.jwt() ->> 'email',
    'Docent convidat', jsonb_build_object('teacher_id', v_teacher.id, 'email', v_email, 'role', v_role)
  );

  return jsonb_build_object('teacher_id', v_teacher.id);
end;
$$;

create or replace function app_private.aula_admin_renew_license_impl(
  p_license_id uuid,
  p_new_ends_at date,
  p_billing_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_before public.aula_licenses%rowtype;
  v_after public.aula_licenses%rowtype;
begin
  if not app_private.aula_is_camicurt_admin() then
    raise exception 'No autoritzat.' using errcode = '28000';
  end if;
  select * into v_before from public.aula_licenses where id = p_license_id for update;
  if v_before.id is null then raise exception 'Llicencia no trobada.'; end if;

  update public.aula_licenses
  set ends_at = p_new_ends_at,
      status = case when status = 'expired' then 'active' else status end,
      billing_reference = coalesce(p_billing_reference, billing_reference)
  where id = p_license_id
  returning * into v_after;

  insert into public.aula_license_events (
    license_id, organization_id, event_type, previous_status, new_status,
    previous_ends_at, new_ends_at, actor_user_id, actor_email
  ) values (
    v_after.id, v_after.organization_id, 'license_renewed', v_before.status,
    v_after.status, v_before.ends_at, v_after.ends_at, auth.uid(), auth.jwt() ->> 'email'
  );

  return jsonb_build_object('license_id', v_after.id, 'ends_at', v_after.ends_at, 'status', v_after.status);
end;
$$;

create or replace function app_private.aula_admin_set_license_status_impl(
  p_license_id uuid,
  p_status text,
  p_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_before public.aula_licenses%rowtype;
  v_after public.aula_licenses%rowtype;
begin
  if not app_private.aula_is_camicurt_admin() then
    raise exception 'No autoritzat.' using errcode = '28000';
  end if;
  if p_status not in ('active','suspended','cancelled','expired','pending_payment') then
    raise exception 'Estat invalid.';
  end if;
  select * into v_before from public.aula_licenses where id = p_license_id for update;
  if v_before.id is null then raise exception 'Llicencia no trobada.'; end if;

  update public.aula_licenses
  set status = p_status,
      notes = coalesce(p_notes, notes)
  where id = p_license_id
  returning * into v_after;

  insert into public.aula_license_events (
    license_id, organization_id, event_type, previous_status, new_status,
    actor_user_id, actor_email, notes
  ) values (
    v_after.id, v_after.organization_id, 'license_status_changed',
    v_before.status, v_after.status, auth.uid(), auth.jwt() ->> 'email', p_notes
  );

  return jsonb_build_object('license_id', v_after.id, 'status', v_after.status);
end;
$$;

create or replace function app_private.aula_admin_list_licenses_impl()
returns table (
  license_id uuid,
  organization_id uuid,
  organization_name text,
  organization_status text,
  city text,
  contact_email text,
  plan text,
  status text,
  starts_at date,
  ends_at date,
  active_teachers bigint,
  invited_teachers bigint,
  max_teachers int,
  max_participants_per_session int,
  billing_reference text,
  price_cents int,
  currency text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not app_private.aula_is_camicurt_admin() then
    raise exception 'No autoritzat.' using errcode = '28000';
  end if;
  return query
  select
    l.id,
    o.id,
    o.name,
    o.status,
    o.city,
    o.contact_email,
    l.plan,
    l.status,
    l.starts_at,
    l.ends_at,
    count(t.*) filter (where t.status = 'active') as active_teachers,
    count(t.*) filter (where t.status = 'invited') as invited_teachers,
    l.max_teachers,
    l.max_participants_per_session,
    l.billing_reference,
    l.price_cents,
    l.currency
  from public.aula_licenses l
  join public.aula_organizations o on o.id = l.organization_id
  left join public.aula_teachers t on t.organization_id = o.id
  group by l.id, o.id
  order by l.created_at desc;
end;
$$;

create or replace function public.aula_get_access()
returns jsonb
language sql
stable
set search_path = public, app_private, pg_temp
as $$ select app_private.aula_get_access_impl() $$;

create or replace function public.aula_claim_teacher()
returns jsonb
language plpgsql
set search_path = public, app_private, pg_temp
as $$
begin
  return app_private.aula_claim_teacher_impl();
end;
$$;

create or replace function public.aula_create_session(
  p_class_id uuid,
  p_challenge_id uuid,
  p_title text,
  p_settings jsonb default '{}'::jsonb
)
returns public.aula_sessions
language plpgsql
set search_path = public, app_private, pg_temp
as $$
begin
  return app_private.aula_create_session_impl(p_class_id, p_challenge_id, p_title, p_settings);
end;
$$;

create or replace function public.aula_set_session_status(
  p_session_id uuid,
  p_status text
)
returns public.aula_sessions
language plpgsql
set search_path = public, app_private, pg_temp
as $$
begin
  return app_private.aula_set_session_status_impl(p_session_id, p_status);
end;
$$;

create or replace function public.aula_admin_create_license(
  p_organization_name text,
  p_legal_name text default null,
  p_city text default null,
  p_province text default null,
  p_contact_email text default null,
  p_billing_email text default null,
  p_allowed_domains text[] default '{}'::text[],
  p_plan text default 'pilot',
  p_status text default 'trial',
  p_starts_at date default current_date,
  p_ends_at date default (current_date + 30),
  p_max_teachers int default 1,
  p_max_classes int default null,
  p_max_sessions_per_month int default null,
  p_max_participants_per_session int default 30,
  p_price_cents int default null,
  p_billing_reference text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
set search_path = public, app_private, pg_temp
as $$
begin
  return app_private.aula_admin_create_license_impl(
    p_organization_name, p_legal_name, p_city, p_province, p_contact_email,
    p_billing_email, p_allowed_domains, p_plan, p_status, p_starts_at,
    p_ends_at, p_max_teachers, p_max_classes, p_max_sessions_per_month,
    p_max_participants_per_session, p_price_cents, p_billing_reference, p_notes
  );
end;
$$;

create or replace function public.aula_admin_invite_teacher(
  p_organization_id uuid,
  p_email text,
  p_full_name text default null,
  p_role text default 'teacher'
)
returns jsonb
language plpgsql
set search_path = public, app_private, pg_temp
as $$
begin
  return app_private.aula_admin_invite_teacher_impl(
    p_organization_id, p_email, p_full_name, p_role
  );
end;
$$;

create or replace function public.aula_admin_renew_license(
  p_license_id uuid,
  p_new_ends_at date,
  p_billing_reference text default null
)
returns jsonb
language plpgsql
set search_path = public, app_private, pg_temp
as $$
begin
  return app_private.aula_admin_renew_license_impl(
    p_license_id, p_new_ends_at, p_billing_reference
  );
end;
$$;

create or replace function public.aula_admin_set_license_status(
  p_license_id uuid,
  p_status text,
  p_notes text default null
)
returns jsonb
language plpgsql
set search_path = public, app_private, pg_temp
as $$
begin
  return app_private.aula_admin_set_license_status_impl(p_license_id, p_status, p_notes);
end;
$$;

create or replace function public.aula_admin_list_licenses()
returns table (
  license_id uuid,
  organization_id uuid,
  organization_name text,
  organization_status text,
  city text,
  contact_email text,
  plan text,
  status text,
  starts_at date,
  ends_at date,
  active_teachers bigint,
  invited_teachers bigint,
  max_teachers int,
  max_participants_per_session int,
  billing_reference text,
  price_cents int,
  currency text
)
language plpgsql
stable
set search_path = public, app_private, pg_temp
as $$
begin
  return query select * from app_private.aula_admin_list_licenses_impl();
end;
$$;

alter table public.aula_organizations enable row level security;
alter table public.aula_licenses enable row level security;
alter table public.aula_teachers enable row level security;
alter table public.aula_license_events enable row level security;
alter table public.aula_classes enable row level security;
alter table public.aula_challenge_packs enable row level security;
alter table public.aula_challenges enable row level security;
alter table public.aula_sessions enable row level security;
alter table public.aula_participants enable row level security;
alter table public.aula_results enable row level security;
alter table public.aula_materials enable row level security;
alter table public.aula_audit_logs enable row level security;

drop policy if exists "Aula teachers read own organization" on public.aula_organizations;
create policy "Aula teachers read own organization"
  on public.aula_organizations for select to authenticated
  using (id = app_private.aula_current_org_id() and app_private.aula_can_access());

drop policy if exists "Aula teachers read own licenses" on public.aula_licenses;
create policy "Aula teachers read own licenses"
  on public.aula_licenses for select to authenticated
  using (organization_id = app_private.aula_current_org_id() and app_private.aula_can_access());

drop policy if exists "Aula teachers read own org teachers" on public.aula_teachers;
create policy "Aula teachers read own org teachers"
  on public.aula_teachers for select to authenticated
  using (organization_id = app_private.aula_current_org_id() and app_private.aula_can_access());

drop policy if exists "Aula teachers read own org events" on public.aula_license_events;
create policy "Aula teachers read own org events"
  on public.aula_license_events for select to authenticated
  using (organization_id = app_private.aula_current_org_id() and app_private.aula_can_access());

drop policy if exists "Aula teachers read own classes" on public.aula_classes;
create policy "Aula teachers read own classes"
  on public.aula_classes for select to authenticated
  using (organization_id = app_private.aula_current_org_id() and app_private.aula_can_access());

drop policy if exists "Aula teachers create own classes" on public.aula_classes;
create policy "Aula teachers create own classes"
  on public.aula_classes for insert to authenticated
  with check (
    organization_id = app_private.aula_current_org_id()
    and teacher_id = app_private.aula_current_teacher_id()
    and app_private.aula_can_access()
  );

drop policy if exists "Aula teachers update own classes" on public.aula_classes;
create policy "Aula teachers update own classes"
  on public.aula_classes for update to authenticated
  using (
    organization_id = app_private.aula_current_org_id()
    and teacher_id = app_private.aula_current_teacher_id()
    and app_private.aula_can_access()
  )
  with check (
    organization_id = app_private.aula_current_org_id()
    and teacher_id = app_private.aula_current_teacher_id()
    and app_private.aula_can_access()
  );

drop policy if exists "Aula teachers read active packs" on public.aula_challenge_packs;
create policy "Aula teachers read active packs"
  on public.aula_challenge_packs for select to authenticated
  using (
    is_active
    and app_private.aula_can_access()
    and (required_feature is null or app_private.aula_has_feature(required_feature))
  );

drop policy if exists "Aula teachers read active challenges" on public.aula_challenges;
create policy "Aula teachers read active challenges"
  on public.aula_challenges for select to authenticated
  using (
    is_active
    and app_private.aula_can_access()
    and exists (
      select 1
      from public.aula_challenge_packs p
      where p.id = public.aula_challenges.pack_id
        and p.is_active
        and (p.required_feature is null or app_private.aula_has_feature(p.required_feature))
    )
  );

drop policy if exists "Aula teachers read own sessions" on public.aula_sessions;
create policy "Aula teachers read own sessions"
  on public.aula_sessions for select to authenticated
  using (organization_id = app_private.aula_current_org_id() and app_private.aula_can_access());

drop policy if exists "Aula teachers read own participants" on public.aula_participants;
create policy "Aula teachers read own participants"
  on public.aula_participants for select to authenticated
  using (
    exists (
      select 1 from public.aula_sessions s
      where s.id = public.aula_participants.session_id
        and s.organization_id = app_private.aula_current_org_id()
        and app_private.aula_can_access()
    )
  );

drop policy if exists "Aula teachers read own results" on public.aula_results;
create policy "Aula teachers read own results"
  on public.aula_results for select to authenticated
  using (
    exists (
      select 1 from public.aula_sessions s
      where s.id = public.aula_results.session_id
        and s.organization_id = app_private.aula_current_org_id()
        and app_private.aula_can_access()
    )
  );

drop policy if exists "Aula teachers read active materials" on public.aula_materials;
create policy "Aula teachers read active materials"
  on public.aula_materials for select to authenticated
  using (
    is_active
    and app_private.aula_can_access()
    and (required_feature is null or app_private.aula_has_feature(required_feature))
  );

drop policy if exists "Aula teachers read own audit logs" on public.aula_audit_logs;
create policy "Aula teachers read own audit logs"
  on public.aula_audit_logs for select to authenticated
  using (organization_id = app_private.aula_current_org_id() and app_private.aula_can_access());

grant usage on schema public to anon, authenticated;
grant usage on schema app_private to anon, authenticated;

grant select on
  public.aula_organizations,
  public.aula_licenses,
  public.aula_teachers,
  public.aula_license_events,
  public.aula_classes,
  public.aula_challenge_packs,
  public.aula_challenges,
  public.aula_sessions,
  public.aula_participants,
  public.aula_results,
  public.aula_materials,
  public.aula_audit_logs
to authenticated;

grant insert, update on public.aula_classes to authenticated;

revoke all on all functions in schema app_private from public, anon, authenticated;
grant execute on function app_private.aula_get_access_impl() to anon, authenticated;
grant execute on function app_private.aula_current_teacher_id() to authenticated;
grant execute on function app_private.aula_current_org_id() to authenticated;
grant execute on function app_private.aula_active_license_id() to authenticated;
grant execute on function app_private.aula_can_access() to authenticated;
grant execute on function app_private.aula_has_feature(text) to authenticated;
grant execute on function app_private.aula_is_camicurt_admin() to authenticated;
grant execute on function app_private.aula_claim_teacher_impl() to authenticated;
grant execute on function app_private.aula_create_session_impl(uuid, uuid, text, jsonb) to authenticated;
grant execute on function app_private.aula_set_session_status_impl(uuid, text) to authenticated;
grant execute on function app_private.aula_admin_create_license_impl(
  text, text, text, text, text, text, text[], text, text, date, date, int, int, int, int, int, text, text
) to authenticated;
grant execute on function app_private.aula_admin_invite_teacher_impl(uuid, text, text, text) to authenticated;
grant execute on function app_private.aula_admin_renew_license_impl(uuid, date, text) to authenticated;
grant execute on function app_private.aula_admin_set_license_status_impl(uuid, text, text) to authenticated;
grant execute on function app_private.aula_admin_list_licenses_impl() to authenticated;

revoke all on function public.aula_get_access() from public, anon, authenticated;
revoke all on function public.aula_claim_teacher() from public, anon, authenticated;
revoke all on function public.aula_create_session(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.aula_set_session_status(uuid, text) from public, anon, authenticated;
revoke all on function public.aula_admin_create_license(
  text, text, text, text, text, text, text[], text, text, date, date, int, int, int, int, int, text, text
) from public, anon, authenticated;
revoke all on function public.aula_admin_invite_teacher(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.aula_admin_renew_license(uuid, date, text) from public, anon, authenticated;
revoke all on function public.aula_admin_set_license_status(uuid, text, text) from public, anon, authenticated;
revoke all on function public.aula_admin_list_licenses() from public, anon, authenticated;
grant execute on function public.aula_get_access() to anon, authenticated;
grant execute on function public.aula_claim_teacher() to authenticated;
grant execute on function public.aula_create_session(uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.aula_set_session_status(uuid, text) to authenticated;
grant execute on function public.aula_admin_create_license(
  text, text, text, text, text, text, text[], text, text, date, date, int, int, int, int, int, text, text
) to authenticated;
grant execute on function public.aula_admin_invite_teacher(uuid, text, text, text) to authenticated;
grant execute on function public.aula_admin_renew_license(uuid, date, text) to authenticated;
grant execute on function public.aula_admin_set_license_status(uuid, text, text) to authenticated;
grant execute on function public.aula_admin_list_licenses() to authenticated;

grant all on
  public.aula_organizations,
  public.aula_licenses,
  public.aula_teachers,
  public.aula_license_events,
  public.aula_classes,
  public.aula_challenge_packs,
  public.aula_challenges,
  public.aula_sessions,
  public.aula_participants,
  public.aula_results,
  public.aula_materials,
  public.aula_audit_logs
to service_role;

insert into public.aula_challenge_packs (
  title, slug, description, level, estimated_minutes, recommended_cycle, sort_order
) values
  (
    'Primer contacte amb les comarques',
    'primer-contacte-comarques',
    'Reptes curts per entendre la idea de ruta i veinatge.',
    'inicial',
    20,
    'Cicle superior i ESO',
    10
  ),
  (
    'Rutes facils',
    'rutes-facils',
    'Rutes assequibles per practicar connexions interiors.',
    'basic',
    30,
    'ESO',
    20
  ),
  (
    'Costa i interior',
    'costa-i-interior',
    'Reptes que connecten comarques de costa amb comarques interiors.',
    'mitja',
    45,
    'ESO',
    30
  )
on conflict (slug) do update
set title = excluded.title,
    description = excluded.description,
    level = excluded.level,
    estimated_minutes = excluded.estimated_minutes,
    recommended_cycle = excluded.recommended_cycle,
    sort_order = excluded.sort_order,
    is_active = true;

insert into public.aula_challenges (
  pack_id, title, description, start_id, target_id, difficulty_id, shortest_path,
  shortest_internal_count, teacher_explanation, student_prompt, sort_order
)
select p.id, v.title, v.description, v.start_id, v.target_id, v.difficulty_id,
       v.shortest_path, v.shortest_internal_count, v.teacher_explanation,
       v.student_prompt, v.sort_order
from (
  values
    (
      'primer-contacte-comarques',
      'De la Segarra a la Terra Alta',
      'Ruta curta per veure com el centre connecta amb el sud.',
      'segarra',
      'terra-alta',
      'pixapi',
      array['segarra','conca-de-barbera','baix-camp','baix-ebre','terra-alta']::text[],
      3,
      'La ruta optima baixa per la Conca de Barbera i el Baix Camp fins al tram de l''Ebre.',
      'Connecteu la Segarra amb la Terra Alta amb el minim de comarques intermedies.',
      10
    ),
    (
      'primer-contacte-comarques',
      'Del Maresme al Bergueda',
      'Connexio curta entre litoral i interior central.',
      'maresme',
      'bergueda',
      'pixapi',
      array['maresme','valles-oriental','bages','bergueda']::text[],
      2,
      'El Valles Oriental i el Bages fan de pont natural cap al Bergueda.',
      'Trobeu una ruta curta del Maresme al Bergueda.',
      20
    ),
    (
      'rutes-facils',
      'Del Barcelones al Ripolles',
      'Ruta curta cap al nord interior.',
      'barcelones',
      'ripolles',
      'pixapi',
      array['barcelones','valles-oriental','osona','ripolles']::text[],
      2,
      'La ruta puja pel Valles Oriental i Osona fins al Ripolles.',
      'Connecteu el Barcelones amb el Ripolles.',
      10
    ),
    (
      'rutes-facils',
      'Del Tarragones a la Garrotxa',
      'Ruta mitjana que travessa comarques centrals.',
      'tarragones',
      'garrotxa',
      'dominguero',
      array['tarragones','alt-camp','anoia','bages','osona','garrotxa']::text[],
      4,
      'La ruta optima evita fer voltes pel litoral i travessa el centre del pais.',
      'Aneu del Tarragones a la Garrotxa amb una ruta curta.',
      20
    ),
    (
      'costa-i-interior',
      'De l''Alt Emporda al Baix Ebre',
      'Repte llarg de nord-est a sud.',
      'alt-emporda',
      'baix-ebre',
      'rondinaire',
      array['alt-emporda','garrotxa','osona','bages','anoia','alt-camp','baix-camp','baix-ebre']::text[],
      6,
      'El cami curt travessa la Garrotxa, Osona i el Bages abans de baixar cap al Camp i l''Ebre.',
      'Connecteu l''Alt Emporda amb el Baix Ebre.',
      10
    ),
    (
      'costa-i-interior',
      'De la Val d''Aran al Montsia',
      'Repte llarg de muntanya a delta.',
      'val-d-aran',
      'montsia',
      'rondinaire',
      array['val-d-aran','pallars-sobira','alt-urgell','noguera','segria','ribera-d-ebre','baix-ebre','montsia']::text[],
      6,
      'La ruta segueix el Pirineu occidental cap a Ponent i baixa per l''Ebre.',
      'Aneu de la Val d''Aran al Montsia amb el minim de passos.',
      20
    )
) as v(
  pack_slug, title, description, start_id, target_id, difficulty_id, shortest_path,
  shortest_internal_count, teacher_explanation, student_prompt, sort_order
)
join public.aula_challenge_packs p on p.slug = v.pack_slug;

insert into public.aula_materials (title, description, material_type, is_active)
values
  ('Guia docent', 'Objectius, preparacio i dinamica de classe.', 'teacher_guide', true),
  ('Fitxa d''alumne', 'Plantilla imprimible per equips.', 'worksheet', true),
  ('Solucionari', 'Orientacions per comentar rutes optimes.', 'solutionary', true),
  ('Sessio de 45 minuts', 'Proposta de temporitzacio per a una classe.', 'slides', true);
