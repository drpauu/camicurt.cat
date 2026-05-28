-- Camicurt Aula custom levels and homework sessions.
-- Additive migration: keeps public game tables untouched and keeps students out of direct table access.

alter table public.aula_challenges
  add column if not exists organization_id uuid references public.aula_organizations(id) on delete cascade,
  add column if not exists teacher_id uuid references public.aula_teachers(id) on delete set null,
  add column if not exists source text default 'pack',
  add column if not exists visibility text default 'pack',
  add column if not exists validation_status text default 'valid',
  add column if not exists validation_warnings jsonb default '[]'::jsonb,
  add column if not exists manual_shortest_path text[],
  add column if not exists game_settings jsonb default '{}'::jsonb;

alter table public.aula_sessions
  add column if not exists session_type text default 'classroom',
  add column if not exists due_at timestamptz,
  add column if not exists instructions text;

alter table public.aula_results
  add column if not exists failure_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'aula_challenges_source_chk'
      and conrelid = 'public.aula_challenges'::regclass
  ) then
    alter table public.aula_challenges
      add constraint aula_challenges_source_chk
      check (source in ('pack','custom','template'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'aula_challenges_visibility_chk'
      and conrelid = 'public.aula_challenges'::regclass
  ) then
    alter table public.aula_challenges
      add constraint aula_challenges_visibility_chk
      check (visibility in ('pack','organization','private','archived'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'aula_challenges_validation_status_chk'
      and conrelid = 'public.aula_challenges'::regclass
  ) then
    alter table public.aula_challenges
      add constraint aula_challenges_validation_status_chk
      check (validation_status in ('valid','warning','invalid'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'aula_sessions_session_type_chk'
      and conrelid = 'public.aula_sessions'::regclass
  ) then
    alter table public.aula_sessions
      add constraint aula_sessions_session_type_chk
      check (session_type in ('classroom','homework'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'aula_results_failure_reason_chk'
      and conrelid = 'public.aula_results'::regclass
  ) then
    alter table public.aula_results
      add constraint aula_results_failure_reason_chk
      check (failure_reason is null or failure_reason in ('attempts','time','abandoned','manual'));
  end if;
end;
$$;

update public.aula_challenges
set source = coalesce(source, 'pack'),
    visibility = coalesce(visibility, 'pack'),
    validation_status = coalesce(validation_status, 'valid'),
    validation_warnings = coalesce(validation_warnings, '[]'::jsonb),
    game_settings = coalesce(game_settings, '{}'::jsonb)
where source is null
   or visibility is null
   or validation_status is null
   or validation_warnings is null
   or game_settings is null;

update public.aula_sessions
set session_type = coalesce(session_type, 'classroom')
where session_type is null;

create index if not exists aula_challenges_org_created_idx
  on public.aula_challenges(organization_id, created_at desc)
  where organization_id is not null;

create index if not exists aula_challenges_teacher_created_idx
  on public.aula_challenges(teacher_id, created_at desc)
  where teacher_id is not null;

create index if not exists aula_sessions_type_due_idx
  on public.aula_sessions(organization_id, session_type, due_at desc nulls last, created_at desc);

create or replace function app_private.aula_can_use_challenge(p_challenge_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.aula_challenges c
    left join public.aula_challenge_packs p on p.id = c.pack_id
    where c.id = p_challenge_id
      and c.is_active
      and app_private.aula_can_access()
      and (
        (
          coalesce(c.source, 'pack') = 'pack'
          and p.id is not null
          and p.is_active
          and (p.required_feature is null or app_private.aula_has_feature(p.required_feature))
        )
        or (
          coalesce(c.source, 'pack') in ('custom','template')
          and c.organization_id = app_private.aula_current_org_id()
          and coalesce(c.visibility, 'organization') <> 'archived'
          and (
            coalesce(c.visibility, 'organization') = 'organization'
            or c.teacher_id = app_private.aula_current_teacher_id()
          )
        )
      )
  )
$$;

create or replace function app_private.aula_clean_text_array(p_items text[])
returns text[]
language sql
immutable
as $$
  select coalesce(
    array_agg(item order by ord),
    '{}'::text[]
  )
  from (
    select distinct on (btrim(value)) btrim(value) as item, ord
    from unnest(coalesce(p_items, '{}'::text[])) with ordinality as t(value, ord)
    where btrim(value) <> ''
    order by btrim(value), ord
  ) cleaned
$$;

create or replace function app_private.aula_clean_warnings(p_warnings jsonb)
returns jsonb
language sql
immutable
as $$
  select case
    when jsonb_typeof(coalesce(p_warnings, '[]'::jsonb)) = 'array'
      then coalesce(p_warnings, '[]'::jsonb)
    else '[]'::jsonb
  end
$$;

create or replace function app_private.aula_normalize_game_settings(p_settings jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_settings jsonb := case
    when jsonb_typeof(coalesce(p_settings, '{}'::jsonb)) = 'object'
      then coalesce(p_settings, '{}'::jsonb)
    else '{}'::jsonb
  end;
  v_mode text := coalesce(nullif(v_settings ->> 'mode', ''), 'normal');
  v_max_attempts int;
  v_time_limit int;
begin
  if v_mode not in ('normal','timed','explore') then
    v_mode := 'normal';
  end if;

  v_max_attempts := nullif(v_settings ->> 'max_attempts', '')::int;
  v_time_limit := nullif(v_settings ->> 'time_limit_seconds', '')::int;

  if v_max_attempts is not null then
    v_max_attempts := greatest(1, least(v_max_attempts, 500));
  end if;
  if v_time_limit is not null then
    v_time_limit := greatest(10, least(v_time_limit, 7200));
  end if;

  return jsonb_strip_nulls(
    jsonb_build_object(
      'mode', v_mode,
      'max_attempts', v_max_attempts,
      'time_limit_seconds', v_time_limit,
      'allow_powerups', coalesce((v_settings ->> 'allow_powerups')::boolean, false),
      'show_ranking', coalesce((v_settings ->> 'show_ranking')::boolean, true),
      'show_solution_at_end', coalesce((v_settings ->> 'show_solution_at_end')::boolean, true),
      'powerups', case
        when jsonb_typeof(v_settings -> 'powerups') = 'object' then v_settings -> 'powerups'
        else null
      end
    )
  );
exception
  when others then
    return jsonb_build_object(
      'mode', 'normal',
      'allow_powerups', false,
      'show_ranking', true,
      'show_solution_at_end', true
    );
end;
$$;

create or replace function app_private.aula_custom_rule_json(
  p_rule_kind text,
  p_rule_label text,
  p_rule_comarca_ids text[]
)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_kind text := nullif(btrim(coalesce(p_rule_kind, '')), '');
  v_ids text[] := app_private.aula_clean_text_array(p_rule_comarca_ids);
begin
  if v_kind is null then
    return null;
  end if;
  if v_kind not in ('avoid','mustIncludeAny') then
    raise exception 'Tipus de norma invalid.';
  end if;
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception 'Cal indicar comarques per a la norma.';
  end if;

  return jsonb_build_object(
    'id', 'custom-rule',
    'kind', v_kind,
    'label', nullif(btrim(coalesce(p_rule_label, '')), ''),
    'comarcaIds', v_ids,
    'difficulty', 'medium',
    'tags', jsonb_build_array('aula')
  );
end;
$$;

create or replace function app_private.aula_validate_custom_level_input(
  p_title text,
  p_start_id text,
  p_target_id text,
  p_shortest_path text[],
  p_game_settings jsonb
)
returns void
language plpgsql
immutable
as $$
declare
  v_path text[] := app_private.aula_clean_text_array(p_shortest_path);
  v_settings jsonb := app_private.aula_normalize_game_settings(p_game_settings);
begin
  if nullif(btrim(coalesce(p_title, '')), '') is null then
    raise exception 'Cal posar un titol al nivell.';
  end if;
  if nullif(btrim(coalesce(p_start_id, '')), '') is null then
    raise exception 'Cal indicar la comarca inicial.';
  end if;
  if nullif(btrim(coalesce(p_target_id, '')), '') is null then
    raise exception 'Cal indicar la comarca de desti.';
  end if;
  if btrim(p_start_id) = btrim(p_target_id) then
    raise exception 'La comarca inicial i el desti han de ser diferents.';
  end if;
  if coalesce(array_length(v_path, 1), 0) < 2 then
    raise exception 'Cal indicar un cami amb inici i desti.';
  end if;
  if v_path[1] <> btrim(p_start_id) then
    raise exception 'El cami ha de començar per la comarca inicial.';
  end if;
  if v_path[array_length(v_path, 1)] <> btrim(p_target_id) then
    raise exception 'El cami ha d''acabar a la comarca de desti.';
  end if;
  if v_settings ->> 'mode' = 'timed' and not (v_settings ? 'time_limit_seconds') then
    raise exception 'El mode contrarellotge necessita temps limit.';
  end if;
end;
$$;

create or replace function app_private.aula_create_custom_level_impl(
  p_title text,
  p_description text,
  p_start_id text,
  p_target_id text,
  p_difficulty_id text,
  p_rule_kind text,
  p_rule_label text,
  p_rule_comarca_ids text[],
  p_shortest_path text[],
  p_student_prompt text,
  p_teacher_explanation text,
  p_game_settings jsonb,
  p_validation_warnings jsonb default '[]'::jsonb
)
returns public.aula_challenges
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_teacher_id uuid := app_private.aula_current_teacher_id();
  v_org_id uuid := app_private.aula_current_org_id();
  v_path text[] := app_private.aula_clean_text_array(p_shortest_path);
  v_rule_ids text[] := app_private.aula_clean_text_array(p_rule_comarca_ids);
  v_rule jsonb := app_private.aula_custom_rule_json(p_rule_kind, p_rule_label, v_rule_ids);
  v_settings jsonb := app_private.aula_normalize_game_settings(p_game_settings);
  v_warnings jsonb := app_private.aula_clean_warnings(p_validation_warnings);
  v_level public.aula_challenges%rowtype;
begin
  if v_teacher_id is null or v_org_id is null or not app_private.aula_can_access() then
    raise exception 'No hi ha acces Aula actiu.' using errcode = '28000';
  end if;
  if not app_private.aula_has_feature('custom_challenges') then
    raise exception 'La llicencia no inclou nivells personalitzats.';
  end if;

  perform app_private.aula_validate_custom_level_input(
    p_title, p_start_id, p_target_id, v_path, v_settings
  );

  insert into public.aula_challenges (
    organization_id, teacher_id, source, visibility, title, description,
    start_id, target_id, difficulty_id, rule_id, rule, avoid_ids, must_pass_ids,
    shortest_path, manual_shortest_path, shortest_internal_count,
    teacher_explanation, student_prompt, game_settings, validation_status,
    validation_warnings, is_active, sort_order
  ) values (
    v_org_id, v_teacher_id, 'custom', 'organization', btrim(p_title),
    nullif(btrim(coalesce(p_description, '')), ''),
    btrim(p_start_id), btrim(p_target_id),
    coalesce(nullif(btrim(coalesce(p_difficulty_id, '')), ''), 'pixapi'),
    case when v_rule is null then null else 'custom-rule' end,
    v_rule,
    case when v_rule ->> 'kind' = 'avoid' then v_rule_ids else null end,
    case when v_rule ->> 'kind' = 'mustIncludeAny' then v_rule_ids else null end,
    v_path,
    v_path,
    greatest(coalesce(array_length(v_path, 1), 0) - 2, 0),
    nullif(btrim(coalesce(p_teacher_explanation, '')), ''),
    nullif(btrim(coalesce(p_student_prompt, '')), ''),
    v_settings,
    case when jsonb_array_length(v_warnings) > 0 then 'warning' else 'valid' end,
    v_warnings,
    true,
    0
  )
  returning * into v_level;

  insert into public.aula_audit_logs (
    organization_id, actor_user_id, action, target_type, target_id, metadata
  ) values (
    v_org_id, auth.uid(), 'custom_level_created', 'aula_challenge', v_level.id,
    jsonb_build_object('validation_status', v_level.validation_status)
  );

  return v_level;
end;
$$;

create or replace function app_private.aula_update_custom_level_impl(
  p_challenge_id uuid,
  p_title text,
  p_description text,
  p_start_id text,
  p_target_id text,
  p_difficulty_id text,
  p_rule_kind text,
  p_rule_label text,
  p_rule_comarca_ids text[],
  p_shortest_path text[],
  p_student_prompt text,
  p_teacher_explanation text,
  p_game_settings jsonb,
  p_validation_warnings jsonb default '[]'::jsonb
)
returns public.aula_challenges
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_teacher_id uuid := app_private.aula_current_teacher_id();
  v_org_id uuid := app_private.aula_current_org_id();
  v_existing public.aula_challenges%rowtype;
  v_path text[] := app_private.aula_clean_text_array(p_shortest_path);
  v_rule_ids text[] := app_private.aula_clean_text_array(p_rule_comarca_ids);
  v_rule jsonb := app_private.aula_custom_rule_json(p_rule_kind, p_rule_label, v_rule_ids);
  v_settings jsonb := app_private.aula_normalize_game_settings(p_game_settings);
  v_warnings jsonb := app_private.aula_clean_warnings(p_validation_warnings);
  v_level public.aula_challenges%rowtype;
begin
  if v_teacher_id is null or v_org_id is null or not app_private.aula_can_access() then
    raise exception 'No hi ha acces Aula actiu.' using errcode = '28000';
  end if;
  if not app_private.aula_has_feature('custom_challenges') then
    raise exception 'La llicencia no inclou nivells personalitzats.';
  end if;

  select * into v_existing
  from public.aula_challenges
  where id = p_challenge_id
    and organization_id = v_org_id
    and source = 'custom'
  for update;

  if v_existing.id is null then
    raise exception 'Nivell no trobat.';
  end if;
  if v_existing.teacher_id <> v_teacher_id and not exists (
    select 1
    from public.aula_teachers t
    where t.id = v_teacher_id
      and t.role in ('school_admin','camicurt_admin')
  ) then
    raise exception 'No pots editar aquest nivell.';
  end if;

  perform app_private.aula_validate_custom_level_input(
    p_title, p_start_id, p_target_id, v_path, v_settings
  );

  update public.aula_challenges
  set title = btrim(p_title),
      description = nullif(btrim(coalesce(p_description, '')), ''),
      start_id = btrim(p_start_id),
      target_id = btrim(p_target_id),
      difficulty_id = coalesce(nullif(btrim(coalesce(p_difficulty_id, '')), ''), 'pixapi'),
      rule_id = case when v_rule is null then null else 'custom-rule' end,
      rule = v_rule,
      avoid_ids = case when v_rule ->> 'kind' = 'avoid' then v_rule_ids else null end,
      must_pass_ids = case when v_rule ->> 'kind' = 'mustIncludeAny' then v_rule_ids else null end,
      shortest_path = v_path,
      manual_shortest_path = v_path,
      shortest_internal_count = greatest(coalesce(array_length(v_path, 1), 0) - 2, 0),
      teacher_explanation = nullif(btrim(coalesce(p_teacher_explanation, '')), ''),
      student_prompt = nullif(btrim(coalesce(p_student_prompt, '')), ''),
      game_settings = v_settings,
      validation_status = case when jsonb_array_length(v_warnings) > 0 then 'warning' else 'valid' end,
      validation_warnings = v_warnings
  where id = p_challenge_id
  returning * into v_level;

  insert into public.aula_audit_logs (
    organization_id, actor_user_id, action, target_type, target_id, metadata
  ) values (
    v_org_id, auth.uid(), 'custom_level_updated', 'aula_challenge', v_level.id,
    jsonb_build_object('validation_status', v_level.validation_status)
  );

  return v_level;
end;
$$;

create or replace function app_private.aula_list_levels_impl()
returns table (
  id uuid,
  pack_id uuid,
  pack_title text,
  organization_id uuid,
  teacher_id uuid,
  source text,
  visibility text,
  title text,
  description text,
  start_id text,
  target_id text,
  difficulty_id text,
  rule_id text,
  rule jsonb,
  avoid_ids text[],
  must_pass_ids text[],
  shortest_path text[],
  manual_shortest_path text[],
  shortest_internal_count int,
  teacher_explanation text,
  student_prompt text,
  game_settings jsonb,
  validation_status text,
  validation_warnings jsonb,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not app_private.aula_can_access() then
    raise exception 'No hi ha acces Aula actiu.' using errcode = '28000';
  end if;

  return query
  select
    c.id, c.pack_id, p.title as pack_title, c.organization_id, c.teacher_id,
    coalesce(c.source, 'pack') as source,
    coalesce(c.visibility, 'pack') as visibility,
    c.title, c.description, c.start_id, c.target_id, c.difficulty_id,
    c.rule_id, c.rule, c.avoid_ids, c.must_pass_ids, c.shortest_path,
    c.manual_shortest_path, c.shortest_internal_count, c.teacher_explanation,
    c.student_prompt, coalesce(c.game_settings, '{}'::jsonb) as game_settings,
    coalesce(c.validation_status, 'valid') as validation_status,
    coalesce(c.validation_warnings, '[]'::jsonb) as validation_warnings,
    c.is_active, c.created_at, c.updated_at
  from public.aula_challenges c
  left join public.aula_challenge_packs p on p.id = c.pack_id
  where c.is_active
    and (
      (
        coalesce(c.source, 'pack') = 'pack'
        and p.is_active
        and (p.required_feature is null or app_private.aula_has_feature(p.required_feature))
      )
      or (
        coalesce(c.source, 'pack') in ('custom','template')
        and c.organization_id = app_private.aula_current_org_id()
        and coalesce(c.visibility, 'organization') <> 'archived'
        and (
          coalesce(c.visibility, 'organization') = 'organization'
          or c.teacher_id = app_private.aula_current_teacher_id()
        )
      )
    )
  order by
    case coalesce(c.source, 'pack') when 'custom' then 0 else 1 end,
    c.created_at desc,
    c.sort_order,
    c.title;
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
  if not app_private.aula_can_use_challenge(p_challenge_id) then
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
    title, expires_at, settings, session_type
  ) values (
    v_org_id, v_teacher_id, p_class_id, p_challenge_id, app_private.aula_generate_join_code(),
    'draft', nullif(btrim(coalesce(p_title, '')), ''), now() + interval '8 hours',
    coalesce(p_settings, '{}'::jsonb), 'classroom'
  )
  returning * into v_session;

  insert into public.aula_audit_logs (
    organization_id, actor_user_id, action, target_type, target_id, metadata
  ) values (
    v_org_id, auth.uid(), 'session_created', 'aula_session', v_session.id,
    jsonb_build_object('challenge_id', p_challenge_id, 'session_type', 'classroom')
  );

  return v_session;
end;
$$;

create or replace function app_private.aula_create_homework_session_impl(
  p_class_id uuid,
  p_challenge_id uuid,
  p_title text,
  p_instructions text,
  p_due_at timestamptz,
  p_settings jsonb default '{}'::jsonb
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
  v_expires_at timestamptz;
begin
  if v_teacher_id is null or v_org_id is null or v_license_id is null then
    raise exception 'No hi ha acces Aula actiu.' using errcode = '28000';
  end if;
  if not app_private.aula_has_feature('classroom_sessions') then
    raise exception 'La llicencia no inclou deures d''Aula.';
  end if;
  if not app_private.aula_can_use_challenge(p_challenge_id) then
    raise exception 'Nivell no disponible.';
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

  v_expires_at := coalesce(p_due_at + interval '1 day', now() + interval '14 days');
  if v_expires_at <= now() then
    raise exception 'La data limit ha de ser futura.';
  end if;

  insert into public.aula_sessions (
    organization_id, teacher_id, class_id, challenge_id, join_code, status,
    title, starts_at, opened_at, expires_at, settings, session_type, due_at,
    instructions
  ) values (
    v_org_id, v_teacher_id, p_class_id, p_challenge_id, app_private.aula_generate_join_code(),
    'open', nullif(btrim(coalesce(p_title, '')), ''), now(), now(), v_expires_at,
    coalesce(p_settings, '{}'::jsonb),
    'homework', p_due_at, nullif(btrim(coalesce(p_instructions, '')), '')
  )
  returning * into v_session;

  insert into public.aula_audit_logs (
    organization_id, actor_user_id, action, target_type, target_id, metadata
  ) values (
    v_org_id, auth.uid(), 'homework_created', 'aula_session', v_session.id,
    jsonb_build_object('challenge_id', p_challenge_id, 'due_at', p_due_at)
  );

  return v_session;
end;
$$;

create or replace function app_private.aula_get_homework_dashboard_impl(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id uuid := app_private.aula_current_org_id();
  v_session public.aula_sessions%rowtype;
  v_challenge public.aula_challenges%rowtype;
  v_participants jsonb;
  v_results jsonb;
  v_stats jsonb;
begin
  if not app_private.aula_can_access() then
    raise exception 'No hi ha acces Aula actiu.' using errcode = '28000';
  end if;

  select * into v_session
  from public.aula_sessions
  where id = p_session_id
    and organization_id = v_org_id;

  if v_session.id is null then
    raise exception 'Sessio no trobada.';
  end if;

  select * into v_challenge
  from public.aula_challenges
  where id = v_session.challenge_id;

  select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at), '[]'::jsonb)
  into v_participants
  from (
    select id, display_name, created_at, last_seen_at
    from public.aula_participants
    where session_id = p_session_id
  ) p;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.submitted_at desc), '[]'::jsonb)
  into v_results
  from (
    select
      r.*,
      p.display_name
    from public.aula_results r
    join public.aula_participants p on p.id = r.participant_id
    where r.session_id = p_session_id
  ) r;

  select jsonb_build_object(
    'participants', count(p.id),
    'submitted', count(r.id),
    'completed', count(r.id) filter (where r.completed),
    'failed', count(r.id) filter (where not r.completed),
    'avg_time_seconds', round(avg(r.time_seconds)::numeric, 1),
    'avg_attempts', round(avg(r.attempts_count)::numeric, 1),
    'avg_precision', round(avg(r.precision)::numeric, 1)
  )
  into v_stats
  from public.aula_participants p
  left join public.aula_results r on r.participant_id = p.id
  where p.session_id = p_session_id;

  return jsonb_build_object(
    'session', to_jsonb(v_session),
    'challenge', to_jsonb(v_challenge),
    'participants', v_participants,
    'results', v_results,
    'stats', coalesce(v_stats, '{}'::jsonb)
  );
end;
$$;

create or replace function public.aula_create_custom_level(
  p_title text,
  p_description text default null,
  p_start_id text default null,
  p_target_id text default null,
  p_difficulty_id text default 'pixapi',
  p_rule_kind text default null,
  p_rule_label text default null,
  p_rule_comarca_ids text[] default '{}'::text[],
  p_shortest_path text[] default '{}'::text[],
  p_student_prompt text default null,
  p_teacher_explanation text default null,
  p_game_settings jsonb default '{}'::jsonb,
  p_validation_warnings jsonb default '[]'::jsonb
)
returns public.aula_challenges
language plpgsql
set search_path = public, app_private, pg_temp
as $$
begin
  return app_private.aula_create_custom_level_impl(
    p_title, p_description, p_start_id, p_target_id, p_difficulty_id,
    p_rule_kind, p_rule_label, p_rule_comarca_ids, p_shortest_path,
    p_student_prompt, p_teacher_explanation, p_game_settings,
    p_validation_warnings
  );
end;
$$;

create or replace function public.aula_update_custom_level(
  p_challenge_id uuid,
  p_title text,
  p_description text default null,
  p_start_id text default null,
  p_target_id text default null,
  p_difficulty_id text default 'pixapi',
  p_rule_kind text default null,
  p_rule_label text default null,
  p_rule_comarca_ids text[] default '{}'::text[],
  p_shortest_path text[] default '{}'::text[],
  p_student_prompt text default null,
  p_teacher_explanation text default null,
  p_game_settings jsonb default '{}'::jsonb,
  p_validation_warnings jsonb default '[]'::jsonb
)
returns public.aula_challenges
language plpgsql
set search_path = public, app_private, pg_temp
as $$
begin
  return app_private.aula_update_custom_level_impl(
    p_challenge_id, p_title, p_description, p_start_id, p_target_id,
    p_difficulty_id, p_rule_kind, p_rule_label, p_rule_comarca_ids,
    p_shortest_path, p_student_prompt, p_teacher_explanation, p_game_settings,
    p_validation_warnings
  );
end;
$$;

create or replace function public.aula_list_levels()
returns table (
  id uuid,
  pack_id uuid,
  pack_title text,
  organization_id uuid,
  teacher_id uuid,
  source text,
  visibility text,
  title text,
  description text,
  start_id text,
  target_id text,
  difficulty_id text,
  rule_id text,
  rule jsonb,
  avoid_ids text[],
  must_pass_ids text[],
  shortest_path text[],
  manual_shortest_path text[],
  shortest_internal_count int,
  teacher_explanation text,
  student_prompt text,
  game_settings jsonb,
  validation_status text,
  validation_warnings jsonb,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
set search_path = public, app_private, pg_temp
as $$
begin
  return query select * from app_private.aula_list_levels_impl();
end;
$$;

create or replace function public.aula_create_homework_session(
  p_class_id uuid,
  p_challenge_id uuid,
  p_title text,
  p_instructions text default null,
  p_due_at timestamptz default null,
  p_settings jsonb default '{}'::jsonb
)
returns public.aula_sessions
language plpgsql
set search_path = public, app_private, pg_temp
as $$
begin
  return app_private.aula_create_homework_session_impl(
    p_class_id, p_challenge_id, p_title, p_instructions, p_due_at, p_settings
  );
end;
$$;

create or replace function public.aula_get_homework_dashboard(p_session_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public, app_private, pg_temp
as $$
begin
  return app_private.aula_get_homework_dashboard_impl(p_session_id);
end;
$$;

drop policy if exists "Aula teachers read active challenges" on public.aula_challenges;
create policy "Aula teachers read active challenges"
  on public.aula_challenges for select to authenticated
  using (
    is_active
    and app_private.aula_can_access()
    and (
      (
        coalesce(source, 'pack') = 'pack'
        and exists (
          select 1
          from public.aula_challenge_packs p
          where p.id = public.aula_challenges.pack_id
            and p.is_active
            and (p.required_feature is null or app_private.aula_has_feature(p.required_feature))
        )
      )
      or (
        coalesce(source, 'pack') in ('custom','template')
        and organization_id = app_private.aula_current_org_id()
        and coalesce(visibility, 'organization') <> 'archived'
        and (
          coalesce(visibility, 'organization') = 'organization'
          or teacher_id = app_private.aula_current_teacher_id()
        )
      )
    )
  );

revoke all on function app_private.aula_can_use_challenge(uuid) from public, anon, authenticated;
revoke all on function app_private.aula_clean_text_array(text[]) from public, anon, authenticated;
revoke all on function app_private.aula_clean_warnings(jsonb) from public, anon, authenticated;
revoke all on function app_private.aula_normalize_game_settings(jsonb) from public, anon, authenticated;
revoke all on function app_private.aula_custom_rule_json(text, text, text[]) from public, anon, authenticated;
revoke all on function app_private.aula_validate_custom_level_input(text, text, text, text[], jsonb) from public, anon, authenticated;
revoke all on function app_private.aula_create_custom_level_impl(text, text, text, text, text, text, text, text[], text[], text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function app_private.aula_update_custom_level_impl(uuid, text, text, text, text, text, text, text, text[], text[], text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function app_private.aula_list_levels_impl() from public, anon, authenticated;
revoke all on function app_private.aula_create_homework_session_impl(uuid, uuid, text, text, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function app_private.aula_get_homework_dashboard_impl(uuid) from public, anon, authenticated;

grant execute on function app_private.aula_can_use_challenge(uuid) to authenticated;
grant execute on function app_private.aula_create_custom_level_impl(text, text, text, text, text, text, text, text[], text[], text, text, jsonb, jsonb) to authenticated;
grant execute on function app_private.aula_update_custom_level_impl(uuid, text, text, text, text, text, text, text, text[], text[], text, text, jsonb, jsonb) to authenticated;
grant execute on function app_private.aula_list_levels_impl() to authenticated;
grant execute on function app_private.aula_create_homework_session_impl(uuid, uuid, text, text, timestamptz, jsonb) to authenticated;
grant execute on function app_private.aula_get_homework_dashboard_impl(uuid) to authenticated;

revoke all on function public.aula_create_custom_level(text, text, text, text, text, text, text, text[], text[], text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.aula_update_custom_level(uuid, text, text, text, text, text, text, text, text[], text[], text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.aula_list_levels() from public, anon, authenticated;
revoke all on function public.aula_create_homework_session(uuid, uuid, text, text, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.aula_get_homework_dashboard(uuid) from public, anon, authenticated;

grant execute on function public.aula_create_custom_level(text, text, text, text, text, text, text, text[], text[], text, text, jsonb, jsonb) to authenticated;
grant execute on function public.aula_update_custom_level(uuid, text, text, text, text, text, text, text, text[], text[], text, text, jsonb, jsonb) to authenticated;
grant execute on function public.aula_list_levels() to authenticated;
grant execute on function public.aula_create_homework_session(uuid, uuid, text, text, timestamptz, jsonb) to authenticated;
grant execute on function public.aula_get_homework_dashboard(uuid) to authenticated;
