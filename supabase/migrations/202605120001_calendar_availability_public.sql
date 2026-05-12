-- Public RPC for calendar availability.
-- This keeps future day visibility stable even when direct table exposure
-- changes in the Data API configuration.

create or replace function public.calendar_daily_availability_public(
  p_from date default null,
  p_to date default null
)
returns table(date date, level_id uuid)
language sql
stable
as $$
  select c.date, c.level_id
  from public.calendar_daily c
  where (p_from is null or c.date >= p_from)
    and (p_to is null or c.date <= p_to)
  order by c.date desc
$$;

revoke all on function public.calendar_daily_availability_public(date, date)
  from public, anon, authenticated;

grant execute on function public.calendar_daily_availability_public(date, date)
  to anon, authenticated, service_role;
