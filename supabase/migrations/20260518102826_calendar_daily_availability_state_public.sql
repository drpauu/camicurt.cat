-- Public calendar availability state with an authoritative unlock day.
-- The legacy calendar_daily_availability_public(date, date) RPC remains
-- available for older clients; this version adds the server-side Madrid date.

create or replace function public.calendar_daily_availability_state_public(
  p_from date default null,
  p_to date default null
)
returns table(
  date date,
  level_id uuid,
  server_day date,
  is_unlocked boolean
)
language sql
stable
set search_path = public, pg_temp
as $$
  with state as (
    select (now() at time zone 'Europe/Madrid')::date as server_day
  )
  select
    c.date,
    c.level_id,
    state.server_day,
    c.date <= state.server_day as is_unlocked
  from public.calendar_daily c
  cross join state
  where (p_from is null or c.date >= p_from)
    and (p_to is null or c.date <= p_to)
  order by c.date desc
$$;

revoke all on function public.calendar_daily_availability_state_public(date, date)
  from public, anon, authenticated;

grant execute on function public.calendar_daily_availability_state_public(date, date)
  to anon, authenticated, service_role;
