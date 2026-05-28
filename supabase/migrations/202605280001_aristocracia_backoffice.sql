-- Internal Camicurt backoffice: workers, status, social links and access helpers.
-- Additive migration. It stores no passwords or private keys.

create extension if not exists pgcrypto;

create schema if not exists app_private;

grant usage on schema app_private to anon, authenticated;

create or replace function app_private.aristocracia_set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.aristocracia_workers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  email text not null,
  email_normalized text generated always as (lower(btrim(email))) stored,
  full_name text,
  role text not null default 'support',
  status text not null default 'active',
  invited_at timestamptz default now(),
  activated_at timestamptz,
  last_seen_at timestamptz,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint aristocracia_workers_role_chk check (role in ('owner','admin','support')),
  constraint aristocracia_workers_status_chk check (status in ('active','invited','disabled','removed'))
);

create unique index if not exists aristocracia_workers_email_normalized_key
  on public.aristocracia_workers(email_normalized);

create table if not exists public.aristocracia_social_links (
  id uuid primary key default gen_random_uuid(),
  platform text not null unique,
  label text not null,
  url text,
  status text not null default 'draft',
  sort_order int not null default 0,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint aristocracia_social_links_status_chk check (status in ('draft','active','hidden'))
);

create table if not exists public.aristocracia_status_services (
  id uuid primary key default gen_random_uuid(),
  service_key text not null unique,
  name text not null,
  description text,
  check_kind text not null default 'http',
  check_url text,
  automatic_status text not null default 'unknown',
  manual_status text,
  notes text,
  last_http_status int,
  last_latency_ms int,
  last_error text,
  last_checked_at timestamptz,
  auto_check boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint aristocracia_status_services_check_kind_chk check (
    check_kind in ('http','supabase_rest','edge_function')
  ),
  constraint aristocracia_status_services_auto_status_chk check (
    automatic_status in ('unknown','online','degraded','offline','maintenance')
  ),
  constraint aristocracia_status_services_manual_status_chk check (
    manual_status is null or manual_status in ('online','degraded','offline','maintenance')
  )
);

create table if not exists public.aristocracia_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_email text,
  action text not null,
  target_type text,
  target_id uuid,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

drop trigger if exists aristocracia_workers_updated_at on public.aristocracia_workers;
create trigger aristocracia_workers_updated_at
  before update on public.aristocracia_workers
  for each row execute function app_private.aristocracia_set_updated_at();

drop trigger if exists aristocracia_social_links_updated_at on public.aristocracia_social_links;
create trigger aristocracia_social_links_updated_at
  before update on public.aristocracia_social_links
  for each row execute function app_private.aristocracia_set_updated_at();

drop trigger if exists aristocracia_status_services_updated_at on public.aristocracia_status_services;
create trigger aristocracia_status_services_updated_at
  before update on public.aristocracia_status_services
  for each row execute function app_private.aristocracia_set_updated_at();

create or replace function app_private.aristocracia_current_worker()
returns public.aristocracia_workers
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
  v_worker public.aristocracia_workers%rowtype;
begin
  if v_uid is null then
    return null;
  end if;

  select * into v_worker
  from public.aristocracia_workers
  where status = 'active'
    and (
      user_id = v_uid
      or (user_id is null and email_normalized = v_email)
    )
  order by user_id = v_uid desc, created_at
  limit 1;

  return v_worker;
end;
$$;

create or replace function app_private.aristocracia_can_access()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((app_private.aristocracia_current_worker()).role in ('owner','admin'), false)
$$;

create or replace function app_private.aristocracia_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((app_private.aristocracia_current_worker()).role in ('owner','admin'), false)
$$;

create or replace function app_private.aristocracia_require_admin()
returns public.aristocracia_workers
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_worker public.aristocracia_workers%rowtype;
begin
  v_worker := app_private.aristocracia_current_worker();
  if v_worker.id is null or v_worker.role not in ('owner','admin') then
    raise exception 'No autoritzat.' using errcode = '28000';
  end if;
  return v_worker;
end;
$$;

create or replace function app_private.aristocracia_get_access_impl()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
  v_worker public.aristocracia_workers%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('allowed', false, 'reason', 'unauthenticated');
  end if;

  select * into v_worker
  from public.aristocracia_workers
  where status in ('active','invited')
    and (
      user_id = v_uid
      or (user_id is null and email_normalized = v_email)
    )
  order by user_id = v_uid desc, status = 'active' desc, created_at
  limit 1;

  if v_worker.id is null then
    return jsonb_build_object('allowed', false, 'reason', 'not_worker');
  end if;

  if v_worker.status <> 'active' then
    return jsonb_build_object('allowed', false, 'reason', 'worker_disabled');
  end if;

  if v_worker.role not in ('owner','admin') then
    return jsonb_build_object('allowed', false, 'reason', 'not_admin');
  end if;

  if v_worker.user_id is null then
    update public.aristocracia_workers
    set user_id = v_uid,
        activated_at = coalesce(activated_at, now())
    where id = v_worker.id
    returning * into v_worker;
  end if;

  update public.aristocracia_workers
  set last_seen_at = now()
  where id = v_worker.id;

  return jsonb_build_object(
    'allowed', true,
    'worker', jsonb_build_object(
      'id', v_worker.id,
      'email', v_worker.email,
      'full_name', v_worker.full_name,
      'role', v_worker.role,
      'status', v_worker.status
    )
  );
end;
$$;

create or replace function app_private.aristocracia_license_rows()
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
  currency text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
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
    l.currency,
    l.created_at
  from public.aula_licenses l
  join public.aula_organizations o on o.id = l.organization_id
  left join public.aula_teachers t on t.organization_id = o.id
  group by l.id, o.id
$$;

create or replace function app_private.aristocracia_get_dashboard_impl()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_worker public.aristocracia_workers%rowtype;
  v_license_summary jsonb;
  v_licenses jsonb;
  v_services jsonb;
  v_social jsonb;
  v_workers jsonb;
begin
  v_worker := app_private.aristocracia_require_admin();

  select jsonb_build_object(
    'total', count(*),
    'active', count(*) filter (where status = 'active'),
    'trial', count(*) filter (where status = 'trial'),
    'expired', count(*) filter (where status = 'expired' or ends_at < current_date),
    'pending_payment', count(*) filter (where status = 'pending_payment'),
    'suspended', count(*) filter (where status = 'suspended')
  )
  into v_license_summary
  from public.aula_licenses;

  select coalesce(jsonb_agg(to_jsonb(row_item) - 'created_at' order by row_item.created_at desc), '[]'::jsonb)
  into v_licenses
  from app_private.aristocracia_license_rows() row_item;

  select coalesce(jsonb_agg(to_jsonb(service_item) order by service_item.sort_order, service_item.name), '[]'::jsonb)
  into v_services
  from (
    select
      id, service_key, name, description, check_kind, check_url,
      automatic_status, manual_status,
      coalesce(manual_status, automatic_status) as effective_status,
      notes, last_http_status, last_latency_ms, last_error, last_checked_at,
      auto_check, sort_order
    from public.aristocracia_status_services
  ) service_item;

  select coalesce(jsonb_agg(to_jsonb(social_item) order by social_item.sort_order, social_item.label), '[]'::jsonb)
  into v_social
  from (
    select id, platform, label, url, status, sort_order, notes
    from public.aristocracia_social_links
  ) social_item;

  select coalesce(jsonb_agg(to_jsonb(worker_item) order by worker_item.created_at), '[]'::jsonb)
  into v_workers
  from (
    select id, email, full_name, role, status, invited_at, activated_at, last_seen_at, created_at
    from public.aristocracia_workers
  ) worker_item;

  return jsonb_build_object(
    'worker', jsonb_build_object(
      'id', v_worker.id,
      'email', v_worker.email,
      'full_name', v_worker.full_name,
      'role', v_worker.role,
      'status', v_worker.status
    ),
    'license_summary', coalesce(v_license_summary, '{}'::jsonb),
    'licenses', v_licenses,
    'status_services', v_services,
    'social_links', v_social,
    'workers', v_workers
  );
end;
$$;

create or replace function app_private.aristocracia_upsert_social_link_impl(
  p_platform text,
  p_label text,
  p_url text,
  p_status text,
  p_sort_order int default 0,
  p_notes text default null
)
returns public.aristocracia_social_links
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_worker public.aristocracia_workers%rowtype;
  v_status text := coalesce(nullif(btrim(p_status), ''), 'draft');
  v_link public.aristocracia_social_links%rowtype;
begin
  v_worker := app_private.aristocracia_require_admin();
  if v_status not in ('draft','active','hidden') then
    raise exception 'Estat de xarxa invalid.';
  end if;

  insert into public.aristocracia_social_links (
    platform, label, url, status, sort_order, notes
  ) values (
    lower(btrim(p_platform)),
    nullif(btrim(p_label), ''),
    nullif(btrim(coalesce(p_url, '')), ''),
    v_status,
    coalesce(p_sort_order, 0),
    nullif(btrim(coalesce(p_notes, '')), '')
  )
  on conflict (platform) do update
  set label = excluded.label,
      url = excluded.url,
      status = excluded.status,
      sort_order = excluded.sort_order,
      notes = excluded.notes
  returning * into v_link;

  insert into public.aristocracia_audit_logs (
    actor_user_id, actor_email, action, target_type, target_id, metadata
  ) values (
    auth.uid(), v_worker.email, 'social_link_upserted', 'aristocracia_social_link',
    v_link.id, jsonb_build_object('platform', v_link.platform, 'status', v_link.status)
  );

  return v_link;
end;
$$;

create or replace function app_private.aristocracia_update_status_override_impl(
  p_service_key text,
  p_manual_status text,
  p_notes text default null
)
returns public.aristocracia_status_services
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_worker public.aristocracia_workers%rowtype;
  v_manual text := nullif(btrim(coalesce(p_manual_status, '')), '');
  v_service public.aristocracia_status_services%rowtype;
begin
  v_worker := app_private.aristocracia_require_admin();
  if v_manual is not null and v_manual not in ('online','degraded','offline','maintenance') then
    raise exception 'Estat manual invalid.';
  end if;

  update public.aristocracia_status_services
  set manual_status = v_manual,
      notes = coalesce(nullif(btrim(coalesce(p_notes, '')), ''), notes)
  where service_key = p_service_key
  returning * into v_service;

  if v_service.id is null then
    raise exception 'Servei no trobat.';
  end if;

  insert into public.aristocracia_audit_logs (
    actor_user_id, actor_email, action, target_type, target_id, metadata
  ) values (
    auth.uid(), v_worker.email, 'status_override_updated', 'aristocracia_status_service',
    v_service.id, jsonb_build_object('service_key', v_service.service_key, 'manual_status', v_service.manual_status)
  );

  return v_service;
end;
$$;

create or replace function app_private.aristocracia_list_workers_impl()
returns table (
  id uuid,
  email text,
  full_name text,
  role text,
  status text,
  invited_at timestamptz,
  activated_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform app_private.aristocracia_require_admin();
  return query
  select w.id, w.email, w.full_name, w.role, w.status, w.invited_at,
         w.activated_at, w.last_seen_at, w.created_at
  from public.aristocracia_workers w
  order by w.created_at;
end;
$$;

create or replace function public.aristocracia_get_access()
returns jsonb
language sql
set search_path = public, app_private, pg_temp
as $$ select app_private.aristocracia_get_access_impl() $$;

create or replace function public.aristocracia_get_dashboard()
returns jsonb
language sql
stable
set search_path = public, app_private, pg_temp
as $$ select app_private.aristocracia_get_dashboard_impl() $$;

create or replace function public.aristocracia_upsert_social_link(
  p_platform text,
  p_label text,
  p_url text default null,
  p_status text default 'draft',
  p_sort_order int default 0,
  p_notes text default null
)
returns public.aristocracia_social_links
language plpgsql
set search_path = public, app_private, pg_temp
as $$
begin
  return app_private.aristocracia_upsert_social_link_impl(
    p_platform, p_label, p_url, p_status, p_sort_order, p_notes
  );
end;
$$;

create or replace function public.aristocracia_update_status_override(
  p_service_key text,
  p_manual_status text default null,
  p_notes text default null
)
returns public.aristocracia_status_services
language plpgsql
set search_path = public, app_private, pg_temp
as $$
begin
  return app_private.aristocracia_update_status_override_impl(
    p_service_key, p_manual_status, p_notes
  );
end;
$$;

create or replace function public.aristocracia_list_workers()
returns table (
  id uuid,
  email text,
  full_name text,
  role text,
  status text,
  invited_at timestamptz,
  activated_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
set search_path = public, app_private, pg_temp
as $$
begin
  return query select * from app_private.aristocracia_list_workers_impl();
end;
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
  or app_private.aristocracia_is_admin()
$$;

alter table public.aristocracia_workers enable row level security;
alter table public.aristocracia_social_links enable row level security;
alter table public.aristocracia_status_services enable row level security;
alter table public.aristocracia_audit_logs enable row level security;

drop policy if exists "Aristocracia workers read internal data" on public.aristocracia_workers;
create policy "Aristocracia workers read internal data"
  on public.aristocracia_workers for select to authenticated
  using (app_private.aristocracia_can_access());

drop policy if exists "Aristocracia admins manage workers" on public.aristocracia_workers;
create policy "Aristocracia admins manage workers"
  on public.aristocracia_workers for all to authenticated
  using (app_private.aristocracia_is_admin())
  with check (app_private.aristocracia_is_admin());

drop policy if exists "Aristocracia workers read social links" on public.aristocracia_social_links;
create policy "Aristocracia workers read social links"
  on public.aristocracia_social_links for select to authenticated
  using (app_private.aristocracia_can_access());

drop policy if exists "Aristocracia admins manage social links" on public.aristocracia_social_links;
create policy "Aristocracia admins manage social links"
  on public.aristocracia_social_links for all to authenticated
  using (app_private.aristocracia_is_admin())
  with check (app_private.aristocracia_is_admin());

drop policy if exists "Aristocracia workers read status services" on public.aristocracia_status_services;
create policy "Aristocracia workers read status services"
  on public.aristocracia_status_services for select to authenticated
  using (app_private.aristocracia_can_access());

drop policy if exists "Aristocracia admins manage status services" on public.aristocracia_status_services;
create policy "Aristocracia admins manage status services"
  on public.aristocracia_status_services for all to authenticated
  using (app_private.aristocracia_is_admin())
  with check (app_private.aristocracia_is_admin());

drop policy if exists "Aristocracia admins read audit logs" on public.aristocracia_audit_logs;
create policy "Aristocracia admins read audit logs"
  on public.aristocracia_audit_logs for select to authenticated
  using (app_private.aristocracia_is_admin());

drop policy if exists "Aristocracia admins insert audit logs" on public.aristocracia_audit_logs;
create policy "Aristocracia admins insert audit logs"
  on public.aristocracia_audit_logs for insert to authenticated
  with check (app_private.aristocracia_is_admin());

grant select, insert, update on
  public.aristocracia_workers,
  public.aristocracia_social_links,
  public.aristocracia_status_services,
  public.aristocracia_audit_logs
to authenticated;

grant all on
  public.aristocracia_workers,
  public.aristocracia_social_links,
  public.aristocracia_status_services,
  public.aristocracia_audit_logs
to service_role;

revoke all on function app_private.aristocracia_current_worker() from public, anon, authenticated;
revoke all on function app_private.aristocracia_can_access() from public, anon, authenticated;
revoke all on function app_private.aristocracia_is_admin() from public, anon, authenticated;
revoke all on function app_private.aristocracia_require_admin() from public, anon, authenticated;
revoke all on function app_private.aristocracia_get_access_impl() from public, anon, authenticated;
revoke all on function app_private.aristocracia_license_rows() from public, anon, authenticated;
revoke all on function app_private.aristocracia_get_dashboard_impl() from public, anon, authenticated;
revoke all on function app_private.aristocracia_upsert_social_link_impl(text, text, text, text, int, text) from public, anon, authenticated;
revoke all on function app_private.aristocracia_update_status_override_impl(text, text, text) from public, anon, authenticated;
revoke all on function app_private.aristocracia_list_workers_impl() from public, anon, authenticated;

grant execute on function app_private.aristocracia_current_worker() to authenticated;
grant execute on function app_private.aristocracia_can_access() to authenticated;
grant execute on function app_private.aristocracia_is_admin() to authenticated;
grant execute on function app_private.aristocracia_require_admin() to authenticated;
grant execute on function app_private.aristocracia_get_access_impl() to anon, authenticated;
grant execute on function app_private.aristocracia_license_rows() to authenticated;
grant execute on function app_private.aristocracia_get_dashboard_impl() to authenticated;
grant execute on function app_private.aristocracia_upsert_social_link_impl(text, text, text, text, int, text) to authenticated;
grant execute on function app_private.aristocracia_update_status_override_impl(text, text, text) to authenticated;
grant execute on function app_private.aristocracia_list_workers_impl() to authenticated;

revoke all on function public.aristocracia_get_access() from public, anon, authenticated;
revoke all on function public.aristocracia_get_dashboard() from public, anon, authenticated;
revoke all on function public.aristocracia_upsert_social_link(text, text, text, text, int, text) from public, anon, authenticated;
revoke all on function public.aristocracia_update_status_override(text, text, text) from public, anon, authenticated;
revoke all on function public.aristocracia_list_workers() from public, anon, authenticated;

grant execute on function public.aristocracia_get_access() to anon, authenticated;
grant execute on function public.aristocracia_get_dashboard() to authenticated;
grant execute on function public.aristocracia_upsert_social_link(text, text, text, text, int, text) to authenticated;
grant execute on function public.aristocracia_update_status_override(text, text, text) to authenticated;
grant execute on function public.aristocracia_list_workers() to authenticated;

insert into public.aristocracia_workers (
  email, full_name, role, status, notes
) values (
  'pau@camicurt.cat', 'Pau', 'owner', 'active', 'Owner inicial del backoffice intern.'
)
on conflict (email_normalized) do update
set full_name = excluded.full_name,
    role = 'owner',
    status = 'active',
    notes = excluded.notes;

insert into public.aristocracia_status_services (
  service_key, name, description, check_kind, check_url, sort_order
) values
  ('web_public', 'Web pública', 'Joc públic de camicurt.cat', 'http', 'https://camicurt.cat/', 10),
  ('aula_web', 'Camicurt Aula', 'Landing i accés de Camicurt Aula', 'http', 'https://camicurt.cat/aula', 20),
  ('supabase_api', 'Supabase API', 'Connexió de base de dades i API REST', 'supabase_rest', null, 30),
  ('aula_session_function', 'Aula Session Function', 'Edge Function de codis i resultats Aula', 'edge_function', null, 40)
on conflict (service_key) do update
set name = excluded.name,
    description = excluded.description,
    check_kind = excluded.check_kind,
    check_url = excluded.check_url,
    sort_order = excluded.sort_order;

insert into public.aristocracia_social_links (
  platform, label, url, status, sort_order
) values
  ('instagram', 'Instagram', null, 'draft', 10),
  ('tiktok', 'TikTok', null, 'draft', 20),
  ('x', 'X', null, 'draft', 30),
  ('youtube', 'YouTube', null, 'draft', 40),
  ('linkedin', 'LinkedIn', null, 'draft', 50),
  ('email', 'Email', 'mailto:pau@camicurt.cat', 'active', 60)
on conflict (platform) do update
set label = excluded.label,
    url = coalesce(public.aristocracia_social_links.url, excluded.url),
    status = case
      when public.aristocracia_social_links.platform = 'email' then 'active'
      else public.aristocracia_social_links.status
    end,
    sort_order = excluded.sort_order;
