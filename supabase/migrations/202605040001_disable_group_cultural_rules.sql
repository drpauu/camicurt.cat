-- Disable generated "grup cultural" rules everywhere persisted levels can reference them.
-- New code also treats any remaining group-* rule_id as "Sense norma".

update public.levels
set
  rule_id = null,
  avoid_ids = null,
  must_pass_ids = null
where rule_id ~ '^group-[0-9]+-[01]$';

update public.level_bank
set
  rule_id = null,
  avoid_ids = null,
  must_pass_ids = null
where rule_id ~ '^group-[0-9]+-[01]$';
