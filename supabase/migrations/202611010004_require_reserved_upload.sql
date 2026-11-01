-- Tie job creation to server-authorized completed uploads, with queue bounds.
begin;

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
begin
  if p_user_id is null or p_job_id is null
    or p_input_path is null
    or p_input_path !~ ('^user-uploads/' || p_user_id::text || '/' || p_job_id::text || '/input[.][a-z0-9]+$')
    or p_project_name is null or char_length(btrim(p_project_name)) not between 1 and 80
    or p_file_name is null or char_length(btrim(p_file_name)) not between 1 and 255 then
    raise exception 'Invalid payload' using errcode = '22023';
  end if;

  -- Serialize requests for this user. A waiting request sees the committed
  -- trial_used value before checking it; insert failures roll back consumption.
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

  if exists(select 1 from public.jobs where id=p_job_id) then
    raise exception 'Job already exists' using errcode='23505';
  end if;
  if not exists(select 1 from public.upload_reservations r
    join storage.objects o on o.bucket_id='user-uploads' and o.name=r.object_path
    where r.job_id=p_job_id and r.user_id=p_user_id and r.expires_at>now()
      and 'user-uploads/'||r.object_path=p_input_path) then
    raise exception 'A reserved, completed upload is required' using errcode='22023';
  end if;
  if (select count(*) from public.jobs where user_id=p_user_id and status in ('pending','running')) >= 4
    or (select count(*) from public.jobs where user_id=p_user_id and created_at>now()-interval '24 hours') >= 20 then
    raise exception 'Job limit reached' using errcode='54000';
  end if;
  -- Duration is unknown until the source media is inspected on the server.
  -- Never treat the dashboard's null/0 (or any client duration) as verified.
  insert into public.jobs (id, user_id, status, input_path, duration_seconds, max_duration_seconds, metadata)
  values (p_job_id, p_user_id, 'pending', p_input_path, null, case when entitled then 300 else 60 end,
    jsonb_build_object('project_name', p_project_name, 'file_name', p_file_name));

  if not entitled then
    update public.profiles set trial_used = true where id = p_user_id;
  end if;
  return p_job_id;
end;
$$;

revoke all on function public.create_job_with_trial(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.create_job_with_trial(uuid, uuid, text, text, text) to service_role;

commit;
