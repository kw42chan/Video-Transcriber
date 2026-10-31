-- Keep privileged RPCs off the client PostgREST surface. Trigger functions
-- still run through their existing triggers without client EXECUTE grants.
begin;

alter function public.claim_next_job() set search_path = '';
alter function public.handle_new_user() set search_path = '';
alter function public.create_profile_for_auth_user() set search_path = '';
alter function public.create_default_project_stages() set search_path = '';
alter function public.create_job_with_trial(uuid, uuid, text, text, text) set search_path = '';

revoke all on function public.claim_next_job() from public, anon, authenticated;
grant execute on function public.claim_next_job() to service_role;

revoke all on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to service_role;

revoke all on function public.create_profile_for_auth_user() from public, anon, authenticated;
grant execute on function public.create_profile_for_auth_user() to service_role;

revoke all on function public.create_default_project_stages() from public, anon, authenticated;
grant execute on function public.create_default_project_stages() to service_role;

revoke all on function public.create_job_with_trial(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.create_job_with_trial(uuid, uuid, text, text, text) to service_role;

commit;
