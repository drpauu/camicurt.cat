-- Pregenerated level bank.
-- Daily calendar levels stay in public.levels; this table stores reusable candidates.

create table if not exists public.level_bank (
  id uuid primary key default gen_random_uuid(),
  seed_key text not null unique,
  difficulty_id text not null,
  rule_id text,
  start_id text not null,
  target_id text not null,
  shortest_path text[] not null,
  avoid_ids text[],
  must_pass_ids text[],
  fingerprint text not null,
  used_on date,
  created_at timestamptz not null default now()
);

create index if not exists level_bank_difficulty_used_idx
  on public.level_bank(difficulty_id, used_on, created_at);

create index if not exists level_bank_rule_id_idx
  on public.level_bank(rule_id);

create index if not exists level_bank_fingerprint_idx
  on public.level_bank(fingerprint);

alter table public.level_bank enable row level security;

drop policy if exists "Service role manages level bank" on public.level_bank;
create policy "Service role manages level bank"
  on public.level_bank
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

revoke all on public.level_bank from anon, authenticated;
grant all on public.level_bank to service_role;
