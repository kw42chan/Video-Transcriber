-- Store the duration limit selected by the trusted entitlement gate and
-- finalize or release a trial reservation only after worker-side media probing.
begin;

alter table public.jobs
  add column duration_limit_seconds integer not null default 60
    check (duration_limit_seconds in (60, 300)),
  add column trial_reserved boolean not null default false;

revoke insert (duration_limit_seconds, trial_reserved),
  update (duration_limit_seconds, trial_reserved)
  on table public.jobs from public, anon, authenticated;
grant update (duration_seconds, status, error, trial_reserved)
  on table public.jobs to service_role;

create or replace function public.create_job_with_trial(
  p_user_id uuid,
  p_job_id uuid,
  p_input_path text,
  p_project_name text,
  p_file_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile public.profiles;
  entitled boolean;
  duration_limit integer;
begin
  if p_user_id is null or p_job_id is null
    or p_input_path is null
    or p_input_path !~ ('^user-uploads/' || p_user_id::text || '/' || p_job_id::text || '/input[.][a-z0-9]+$')
    or p_project_name is null or char_length(btrim(p_project_name)) not between 1 and 80
    or p_file_name is null or char_length(btrim(p_file_name)) not between 1 and 255 then
    raise exception 'Invalid payload' using errcode = '22023';
  end if;

  select * into profile from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'Profile missing' using errcode = 'P0002';
  end if;

  entitled := profile.byok_enabled or exists (
    select 1 from public.subscriptions
    where user_id = p_user_id and status = 'active'
      and (current_period_end is null or current_period_end > now())
  );
  if not entitled and profile.trial_used then
    raise exception 'Trial already used; subscription or BYOK required' using errcode = '42501';
  end if;

  duration_limit := case when entitled then 300 else 60 end;
  insert into public.jobs (
    id, user_id, status, input_path, duration_seconds, duration_limit_seconds,
    trial_reserved, metadata
  ) values (
    p_job_id, p_user_id, 'pending', p_input_path, null, duration_limit,
    not entitled, jsonb_build_object('project_name', p_project_name, 'file_name', p_file_name)
  );

  -- Reserve the single trial now to serialize concurrent uploads. The worker
  -- releases it if trusted duration validation rejects the source media.
  if not entitled then
    update public.profiles set trial_used = true where id = p_user_id;
  end if;
  return p_job_id;
end;
$$;

create or replace function public.complete_job_preflight(
  p_job_id uuid,
  p_duration_seconds numeric
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  job_user_id uuid;
  job public.jobs;
begin
  -- Keep lock ordering consistent with create_job_with_trial: profile, then job.
  select user_id into job_user_id from public.jobs where id = p_job_id;
  if not found then
    raise exception 'Job missing' using errcode = 'P0002';
  end if;

  perform 1 from public.profiles where id = job_user_id for update;
  select * into job from public.jobs where id = p_job_id for update;
  if not found or job.status <> 'running' then
    raise exception 'Job is not awaiting preflight' using errcode = '55000';
  end if;

  if p_duration_seconds is null or p_duration_seconds <= 0
    or p_duration_seconds > job.duration_limit_seconds then
    update public.jobs
      set status = 'failed',
          error = case
            when p_duration_seconds is not null and p_duration_seconds > job.duration_limit_seconds
              then 'Source video exceeds the duration limit. Please upload a shorter video.'
            else 'Could not validate the source video. Please check the file and try again.'
          end,
          duration_seconds = null,
          trial_reserved = false
      where id = p_job_id;

    if job.trial_reserved then
      update public.profiles set trial_used = false where id = job_user_id;
    end if;
    return false;
  end if;

  update public.jobs
    set duration_seconds = p_duration_seconds,
        trial_reserved = false
    where id = p_job_id;
  return true;
end;
$$;

revoke all on function public.create_job_with_trial(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.create_job_with_trial(uuid, uuid, text, text, text)
  to service_role;
revoke all on function public.complete_job_preflight(uuid, numeric)
  from public, anon, authenticated;
grant execute on function public.complete_job_preflight(uuid, numeric)
  to service_role;

commit;
