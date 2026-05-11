drop policy if exists "Players can insert own telemetry" on public.telemetry_events;
create policy "Players can insert own telemetry"
  on public.telemetry_events for insert
  to authenticated
  with check ((select auth.uid()) is not null and (select auth.uid()) = player_id);

drop policy if exists "Players can upsert own telemetry" on public.telemetry_events;
create policy "Players can upsert own telemetry"
  on public.telemetry_events for update
  to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = player_id)
  with check ((select auth.uid()) is not null and (select auth.uid()) = player_id);
