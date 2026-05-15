-- Correct visible Camicurt Aula text without changing schemas, slugs, IDs or API contracts.

update public.aula_challenge_packs
set description = 'Reptes curts per entendre la idea de ruta i veïnatge.'
where slug = 'primer-contacte-comarques';

update public.aula_challenge_packs
set title = 'Rutes fàcils'
where slug = 'rutes-facils';

update public.aula_challenges
set teacher_explanation = 'La ruta òptima baixa per la Conca de Barberà i el Baix Camp fins al tram de l''Ebre.',
    student_prompt = 'Connecteu la Segarra amb la Terra Alta amb el mínim de comarques intermèdies.'
where start_id = 'segarra'
  and target_id = 'terra-alta';

update public.aula_challenges
set title = 'Del Maresme al Berguedà',
    description = 'Connexió curta entre litoral i interior central.',
    teacher_explanation = 'El Vallès Oriental i el Bages fan de pont natural cap al Berguedà.',
    student_prompt = 'Trobeu una ruta curta del Maresme al Berguedà.'
where start_id = 'maresme'
  and target_id = 'bergueda';

update public.aula_challenges
set title = 'Del Barcelonès al Ripollès',
    teacher_explanation = 'La ruta puja pel Vallès Oriental i Osona fins al Ripollès.',
    student_prompt = 'Connecteu el Barcelonès amb el Ripollès.'
where start_id = 'barcelones'
  and target_id = 'ripolles';

update public.aula_challenges
set title = 'Del Tarragonès a la Garrotxa',
    teacher_explanation = 'La ruta òptima evita fer voltes pel litoral i travessa el centre del país.',
    student_prompt = 'Aneu del Tarragonès a la Garrotxa amb una ruta curta.'
where start_id = 'tarragones'
  and target_id = 'garrotxa';

update public.aula_challenges
set title = 'De l''Alt Empordà al Baix Ebre',
    teacher_explanation = 'El camí curt travessa la Garrotxa, Osona i el Bages abans de baixar cap al Camp i l''Ebre.',
    student_prompt = 'Connecteu l''Alt Empordà amb el Baix Ebre.'
where start_id = 'alt-emporda'
  and target_id = 'baix-ebre';

update public.aula_challenges
set title = 'De la Val d''Aran al Montsià',
    student_prompt = 'Aneu de la Val d''Aran al Montsià amb el mínim de passos.'
where start_id = 'val-d-aran'
  and target_id = 'montsia';

update public.aula_materials
set description = 'Objectius, preparació i dinàmica de classe.'
where material_type = 'teacher_guide';

update public.aula_materials
set description = 'Orientacions per comentar rutes òptimes.'
where material_type = 'solutionary';

update public.aula_materials
set title = 'Sessió de 45 minuts',
    description = 'Proposta de temporització per a una classe.'
where material_type = 'slides';

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
    raise exception 'Cal iniciar sessió.' using errcode = '28000';
  end if;
  if v_email = '' then
    raise exception 'No s''ha pogut llegir el correu de l''enllaç d''accés.';
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
    raise exception 'Aquest correu no té cap llicència activa de Camicurt Aula.';
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
    raise exception 'Aquest centre no té cap llicència activa.';
  end if;

  if v_teacher.status <> 'active' then
    select count(*) into v_active_count
    from public.aula_teachers
    where organization_id = v_teacher.organization_id
      and status = 'active'
      and user_id is not null;

    if v_license.max_teachers is not null and v_active_count >= v_license.max_teachers then
      raise exception 'La llicència ha arribat al límit de docents.';
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
    v_license.id, v_org.id, 'teacher_activated', v_uid, v_email, 'Docent activat via enllaç d''accés'
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
    raise exception 'No hi ha accés Aula actiu.' using errcode = '28000';
  end if;
  if not app_private.aula_has_feature('classroom_sessions') then
    raise exception 'La llicència no inclou sessions d''aula.';
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
      raise exception 'La llicència ha arribat al límit mensual de sessions.';
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
    raise exception 'No hi ha accés Aula actiu.' using errcode = '28000';
  end if;
  if p_status not in ('open','closed','archived') then
    raise exception 'Estat de sessió invàlid.';
  end if;

  select * into v_session
  from public.aula_sessions
  where id = p_session_id
    and organization_id = v_org_id
    and teacher_id = v_teacher_id
  for update;

  if v_session.id is null then
    raise exception 'Sessió no trobada.';
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
    raise exception 'Rol invàlid.';
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
    raise exception 'El centre no té llicència activa.';
  end if;

  select count(*) into v_count
  from public.aula_teachers
  where organization_id = p_organization_id
    and status in ('invited','active');
  if v_license.max_teachers is not null and v_count >= v_license.max_teachers then
    raise exception 'La llicència ha arribat al límit de docents.';
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
  if v_before.id is null then raise exception 'Llicència no trobada.'; end if;

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
    raise exception 'Estat invàlid.';
  end if;
  select * into v_before from public.aula_licenses where id = p_license_id for update;
  if v_before.id is null then raise exception 'Llicència no trobada.'; end if;

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
