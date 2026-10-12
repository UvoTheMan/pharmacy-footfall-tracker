-- Daily footfall backup execution log.
-- Safe additive migration. Does not modify visits, memberships, auth, or existing RLS policies.
create table if not exists public.footfall_backup_runs (
  backup_date date primary key,
  status text not null check (status in ('sending', 'sent', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  visit_count integer not null default 0 check (visit_count >= 0),
  report_counts jsonb not null default '{}'::jsonb,
  provider_message_id text,
  error_message text,
  created_at timestamptz not null default now()
);

alter table public.footfall_backup_runs enable row level security;

-- No authenticated-user policies or grants are created. The Edge Function accesses this
-- table using the server-only service-role key, which bypasses RLS.
