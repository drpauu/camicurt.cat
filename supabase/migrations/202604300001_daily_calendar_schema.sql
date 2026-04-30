-- Daily calendar schema for camicurt.cat.
-- This migration is additive and keeps nullable week_key columns only for legacy/client compatibility.

create extension if not exists pgcrypto;

create table if not exists public.levels (
  id uuid primary key default gen_random_uuid(),
  level_type text not null default 'daily',
  date date,
  week_key text,
  difficulty_id text not null,
  rule_id text,
  start_id text not null,
  target_id text not null,
  shortest_path text[] not null,
  avoid_ids text[],
  must_pass_ids text[],
  created_at timestamptz not null default now()
);

alter table public.levels add column if not exists level_type text not null default 'daily';
alter table public.levels add column if not exists date date;
alter table public.levels add column if not exists week_key text;
alter table public.levels add column if not exists difficulty_id text not null default 'cap-colla-rutes';
alter table public.levels add column if not exists rule_id text;
alter table public.levels add column if not exists start_id text;
alter table public.levels add column if not exists target_id text;
alter table public.levels add column if not exists shortest_path text[];
alter table public.levels add column if not exists avoid_ids text[];
alter table public.levels add column if not exists must_pass_ids text[];
alter table public.levels add column if not exists created_at timestamptz not null default now();
alter table public.levels alter column id set default gen_random_uuid();

create table if not exists public.calendar_daily (
  date date primary key,
  level_id uuid not null unique references public.levels(id) on delete restrict,
  published_at timestamptz not null default now()
);

alter table public.calendar_daily add column if not exists published_at timestamptz not null default now();

create table if not exists public.players (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  unlocked_difficulties text[] not null default array['pixapi']::text[],
  language text,
  music_track text,
  music_enabled boolean,
  music_volume numeric,
  sfx_enabled boolean,
  sfx_volume numeric,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

alter table public.players add column if not exists unlocked_difficulties text[] not null default array['pixapi']::text[];
alter table public.players add column if not exists language text;
alter table public.players add column if not exists music_track text;
alter table public.players add column if not exists music_enabled boolean;
alter table public.players add column if not exists music_volume numeric;
alter table public.players add column if not exists sfx_enabled boolean;
alter table public.players add column if not exists sfx_volume numeric;
alter table public.players add column if not exists created_at timestamptz not null default now();
alter table public.players add column if not exists last_seen timestamptz not null default now();

create table if not exists public.attempts (
  id uuid primary key,
  player_id uuid not null references public.players(id) on delete cascade,
  level_id uuid references public.levels(id) on delete set null,
  level_type text not null default 'daily',
  day_key date,
  week_key text,
  difficulty_id text,
  time_ms integer,
  attempts integer,
  guesses integer,
  distance integer,
  shortest integer,
  found integer,
  rule_id text,
  rule_difficulty text,
  start_id text,
  target_id text,
  region text,
  created_at timestamptz not null default now()
);

alter table public.attempts add column if not exists level_id uuid references public.levels(id) on delete set null;
alter table public.attempts add column if not exists week_key text;

create table if not exists public.cron_runs (
  run_key text primary key,
  created_at timestamptz not null default now()
);

create table if not exists public.telemetry_events (
  id uuid primary key default gen_random_uuid(),
  player_id uuid references public.players(id) on delete set null,
  event_type text not null,
  mode text,
  difficulty_id text,
  map_id text,
  start_id text,
  target_id text,
  rule_id text,
  day_key date,
  week_key text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.telemetry_events add column if not exists week_key text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'levels_daily_only_chk' and conrelid = 'public.levels'::regclass
  ) then
    alter table public.levels
      add constraint levels_daily_only_chk check (level_type = 'daily') not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'levels_daily_date_required_chk' and conrelid = 'public.levels'::regclass
  ) then
    alter table public.levels
      add constraint levels_daily_date_required_chk check (date is not null) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'attempts_daily_only_chk' and conrelid = 'public.attempts'::regclass
  ) then
    alter table public.attempts
      add constraint attempts_daily_only_chk check (level_type = 'daily') not valid;
  end if;
end $$;

create unique index if not exists levels_date_key on public.levels(date);
create index if not exists levels_rule_id_idx on public.levels(rule_id);
create unique index if not exists calendar_daily_level_id_key on public.calendar_daily(level_id);
create index if not exists calendar_daily_date_desc_idx on public.calendar_daily(date desc);
create index if not exists attempts_player_created_at_idx on public.attempts(player_id, created_at desc);
create index if not exists attempts_level_rank_idx on public.attempts(level_id, time_ms, attempts);
create index if not exists telemetry_events_created_at_idx on public.telemetry_events(created_at desc);
create index if not exists telemetry_events_player_created_at_idx on public.telemetry_events(player_id, created_at desc);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'calendar_daily_level_id_fkey'
      and conrelid = 'public.calendar_daily'::regclass
  ) then
    alter table public.calendar_daily
      add constraint calendar_daily_level_id_fkey
      foreign key (level_id) references public.levels(id) on delete restrict;
  end if;
end $$;

create or replace view public.daily_calendar_public
with (security_invoker = true)
as
select
  c.date,
  c.level_id,
  c.published_at,
  l.start_id,
  l.target_id,
  l.rule_id,
  l.difficulty_id,
  l.shortest_path,
  l.avoid_ids,
  l.must_pass_ids
from public.calendar_daily c
join public.levels l on l.id = c.level_id;

create or replace function public.create_daily_level(
  p_date date,
  p_difficulty_id text,
  p_rule_id text,
  p_start_id text,
  p_target_id text,
  p_shortest_path text[],
  p_avoid_ids text[] default null,
  p_must_pass_ids text[] default null
)
returns table(created boolean, level_id uuid, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_level_id uuid;
  existing_level_id uuid;
begin
  select c.level_id
    into existing_level_id
  from public.calendar_daily c
  where c.date = p_date;

  if existing_level_id is not null then
    return query select false, existing_level_id, 'ja_existeix'::text;
    return;
  end if;

  insert into public.levels (
    level_type,
    date,
    week_key,
    difficulty_id,
    rule_id,
    start_id,
    target_id,
    shortest_path,
    avoid_ids,
    must_pass_ids
  )
  values (
    'daily',
    p_date,
    null,
    p_difficulty_id,
    p_rule_id,
    p_start_id,
    p_target_id,
    p_shortest_path,
    p_avoid_ids,
    p_must_pass_ids
  )
  on conflict (date) do nothing
  returning id into inserted_level_id;

  if inserted_level_id is null then
    select l.id
      into inserted_level_id
    from public.levels l
    where l.date = p_date
    limit 1;
  end if;

  if inserted_level_id is null then
    return query select false, null::uuid, 'no_s_ha_pogut_crear_el_nivell'::text;
    return;
  end if;

  insert into public.calendar_daily (date, level_id)
  values (p_date, inserted_level_id)
  on conflict (date) do nothing;

  select c.level_id
    into existing_level_id
  from public.calendar_daily c
  where c.date = p_date;

  if existing_level_id = inserted_level_id then
    return query select true, inserted_level_id, null::text;
    return;
  end if;

  return query select false, existing_level_id, 'ja_existeix'::text;
end;
$$;

alter table public.levels enable row level security;
alter table public.calendar_daily enable row level security;
alter table public.players enable row level security;
alter table public.attempts enable row level security;
alter table public.cron_runs enable row level security;
alter table public.telemetry_events enable row level security;

drop policy if exists "Public can read daily levels" on public.levels;
create policy "Public can read daily levels"
  on public.levels for select
  using (level_type = 'daily');

drop policy if exists "Public can read daily calendar" on public.calendar_daily;
create policy "Public can read daily calendar"
  on public.calendar_daily for select
  using (true);

drop policy if exists "Players can read own profile" on public.players;
create policy "Players can read own profile"
  on public.players for select
  using (auth.uid() = id);

drop policy if exists "Players can insert own profile" on public.players;
create policy "Players can insert own profile"
  on public.players for insert
  with check (auth.uid() = id);

drop policy if exists "Players can update own profile" on public.players;
create policy "Players can update own profile"
  on public.players for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "Players can read own attempts" on public.attempts;
create policy "Players can read own attempts"
  on public.attempts for select
  using (auth.uid() = player_id);

drop policy if exists "Players can insert own attempts" on public.attempts;
create policy "Players can insert own attempts"
  on public.attempts for insert
  with check (auth.uid() = player_id);

drop policy if exists "Players can upsert own attempts" on public.attempts;
create policy "Players can upsert own attempts"
  on public.attempts for update
  using (auth.uid() = player_id)
  with check (auth.uid() = player_id);

drop policy if exists "Players can insert own telemetry" on public.telemetry_events;
create policy "Players can insert own telemetry"
  on public.telemetry_events for insert
  with check (player_id is null or auth.uid() = player_id);

drop policy if exists "Players can upsert own telemetry" on public.telemetry_events;
create policy "Players can upsert own telemetry"
  on public.telemetry_events for update
  using (player_id is null or auth.uid() = player_id)
  with check (player_id is null or auth.uid() = player_id);

grant usage on schema public to anon, authenticated;
grant select on public.levels, public.calendar_daily, public.daily_calendar_public to anon, authenticated;
grant select, insert, update on public.players, public.attempts, public.telemetry_events to authenticated;
revoke all on function public.create_daily_level(
  date,
  text,
  text,
  text,
  text,
  text[],
  text[],
  text[]
) from public, anon, authenticated;
grant execute on function public.create_daily_level(
  date,
  text,
  text,
  text,
  text,
  text[],
  text[],
  text[]
) to service_role;

comment on column public.levels.week_key is 'Deprecated legacy column. Daily calendar keeps this null.';
comment on column public.attempts.week_key is 'Deprecated legacy column. Daily calendar keeps this null.';
comment on column public.telemetry_events.week_key is 'Deprecated legacy column. Daily calendar keeps this null.';
