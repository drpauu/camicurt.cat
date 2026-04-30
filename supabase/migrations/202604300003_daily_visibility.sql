-- Hide future daily levels from public clients.
-- Service-role scripts can still create and assign future calendar rows.

drop policy if exists "Public can read daily levels" on public.levels;
create policy "Public can read daily levels"
  on public.levels for select
  using (
    level_type = 'daily'
    and date <= ((now() at time zone 'Europe/Madrid')::date)
  );

drop policy if exists "Public can read daily calendar" on public.calendar_daily;
create policy "Public can read daily calendar"
  on public.calendar_daily for select
  using (date <= ((now() at time zone 'Europe/Madrid')::date));
