-- Bootstrap payload for the public daily calendar.
-- Returns availability plus coverage metadata so clients can distinguish
-- a real empty result from a broken/incomplete calendar.

create or replace function public.calendar_daily_bootstrap_public(
  p_from date default '2025-01-01',
  p_to date default null
)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  with bounds as (
    select
      coalesce(p_from, '2025-01-01'::date) as from_day,
      coalesce(
        p_to,
        ((now() at time zone 'Europe/Madrid')::date + 30)
      ) as to_day,
      (now() at time zone 'Europe/Madrid')::date as server_day
  ),
  rows as (
    select
      c.date,
      c.level_id,
      b.server_day,
      c.date <= b.server_day as is_unlocked
    from public.calendar_daily c
    cross join bounds b
    where c.date >= b.from_day
      and c.date <= b.to_day
    order by c.date desc
  ),
  coverage as (
    select
      case
        when least(b.to_day, b.server_day) < b.from_day then 0
        else (least(b.to_day, b.server_day) - b.from_day + 1)
      end as expected_past_days,
      count(r.date) filter (
        where r.date <= b.server_day
          and r.level_id is not null
      ) as assigned_past_days
    from bounds b
    left join rows r on true
    group by b.from_day, b.to_day, b.server_day
  )
  select jsonb_build_object(
    'serverDay', b.server_day,
    'from', b.from_day,
    'to', b.to_day,
    'rows', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'date', rows.date,
            'level_id', rows.level_id,
            'server_day', rows.server_day,
            'is_unlocked', rows.is_unlocked
          )
          order by rows.date desc
        )
        from rows
      ),
      '[]'::jsonb
    ),
    'expectedPastDays', c.expected_past_days,
    'assignedPastDays', c.assigned_past_days,
    'missingPastCount', greatest(c.expected_past_days - c.assigned_past_days, 0)
  )
  from bounds b
  cross join coverage c
$$;

revoke all on function public.calendar_daily_bootstrap_public(date, date)
  from public, anon, authenticated;

grant execute on function public.calendar_daily_bootstrap_public(date, date)
  to anon, authenticated, service_role;
