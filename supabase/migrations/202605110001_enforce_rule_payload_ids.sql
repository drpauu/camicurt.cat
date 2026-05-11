-- Guard against persisted levels that reference a rule without any comarca ids.
-- These constraints are NOT VALID so they do not block deployment before cleanup,
-- but PostgreSQL still enforces them for new and updated rows.

alter table public.levels
  drop constraint if exists levels_rule_payload_ids_chk;

alter table public.levels
  add constraint levels_rule_payload_ids_chk
  check (
    rule_id is null
    or cardinality(coalesce(avoid_ids, array[]::text[])) > 0
    or cardinality(coalesce(must_pass_ids, array[]::text[])) > 0
  ) not valid;

alter table public.level_bank
  drop constraint if exists level_bank_rule_payload_ids_chk;

alter table public.level_bank
  add constraint level_bank_rule_payload_ids_chk
  check (
    rule_id is null
    or cardinality(coalesce(avoid_ids, array[]::text[])) > 0
    or cardinality(coalesce(must_pass_ids, array[]::text[])) > 0
  ) not valid;
