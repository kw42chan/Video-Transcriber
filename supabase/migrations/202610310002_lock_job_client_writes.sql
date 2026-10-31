-- Jobs are created by the API's service-role-only entitlement RPC and updated
-- by the worker. User sessions may only read their own rows.
begin;

alter table public.jobs enable row level security;
drop policy if exists "jobs_insert_own" on public.jobs;
drop policy if exists "jobs_update_own" on public.jobs;

-- Column grants survive table-level revokes, so remove both forms explicitly.
revoke insert, update on table public.jobs from public, anon, authenticated;
revoke insert (id, user_id, status, input_path, output_paths, error,
  duration_seconds, metadata, created_at, updated_at),
  update (id, user_id, status, input_path, output_paths, error,
  duration_seconds, metadata, created_at, updated_at)
  on table public.jobs from public, anon, authenticated;

-- Keep jobs_select_own unchanged: auth.uid() = user_id.
grant select on table public.jobs to authenticated;
grant select, insert, update on table public.jobs to service_role;

commit;
