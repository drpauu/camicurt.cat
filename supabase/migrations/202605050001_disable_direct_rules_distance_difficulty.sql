-- Disable direct comarca-name rules and reclassify persisted difficulty by shortest path distance.
-- Direct rules reveal the answer in the rule text, e.g. "Has de passar per Gironès.".

begin;

create temporary table _direct_rule_levels on commit drop as
select id
from public.levels
where rule_id ~ '-direct-[01]$';

delete from public.calendar_daily
where level_id in (select id from _direct_rule_levels);

delete from public.attempts
where rule_id ~ '-direct-[01]$';

delete from public.telemetry_events
where rule_id ~ '-direct-[01]$';

delete from public.levels
where id in (select id from _direct_rule_levels);

delete from public.level_bank
where rule_id ~ '-direct-[01]$';

update public.levels
set difficulty_id = case
  when greatest(coalesce(array_length(shortest_path, 1), 0) - 2, 0) <= 3 then 'pixapi'
  when greatest(coalesce(array_length(shortest_path, 1), 0) - 2, 0) <= 5 then 'dominguero'
  when greatest(coalesce(array_length(shortest_path, 1), 0) - 2, 0) <= 8 then 'rondinaire'
  else 'cap-colla-rutes'
end;

update public.level_bank
set difficulty_id = case
  when greatest(coalesce(array_length(shortest_path, 1), 0) - 2, 0) <= 3 then 'pixapi'
  when greatest(coalesce(array_length(shortest_path, 1), 0) - 2, 0) <= 5 then 'dominguero'
  when greatest(coalesce(array_length(shortest_path, 1), 0) - 2, 0) <= 8 then 'rondinaire'
  else 'cap-colla-rutes'
end;

update public.attempts
set difficulty_id = case
  when greatest(coalesce(shortest, 0), 0) <= 3 then 'pixapi'
  when greatest(coalesce(shortest, 0), 0) <= 5 then 'dominguero'
  when greatest(coalesce(shortest, 0), 0) <= 8 then 'rondinaire'
  else 'cap-colla-rutes'
end
where shortest is not null;

commit;
