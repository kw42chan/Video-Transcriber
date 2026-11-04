-- Run against a disposable migrated Supabase database as postgres:
-- psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/job_duration_preflight.sql
-- All fixtures and jobs are rolled back.
begin;

insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');
insert into public.profiles (id)
select id from auth.users where id in (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222'
) on conflict (id) do nothing;
insert into public.subscriptions (user_id, status, current_period_end)
values ('22222222-2222-4222-8222-222222222222', 'active', now() + interval '1 day');

set local role service_role;

do $$
declare
  trial_user uuid := '11111111-1111-4111-8111-111111111111';
  paid_user uuid := '22222222-2222-4222-8222-222222222222';
  jid uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  accepted boolean;
begin
  assert has_function_privilege('service_role',
    'public.complete_job_preflight(uuid,numeric)', 'EXECUTE'), 'Service cannot finalize preflight';
  assert not has_function_privilege('authenticated',
    'public.complete_job_preflight(uuid,numeric)', 'EXECUTE'), 'Client can finalize preflight';

  perform public.create_job_with_trial(
    trial_user, jid, 'user-uploads/' || trial_user || '/' || jid || '/input.mp4', 'Trial', 'input.mp4'
  );
  assert (select duration_limit_seconds = 60 and trial_reserved from public.jobs where id = jid),
    'Trial job did not receive a 60-second reserved limit';
  update public.jobs set status = 'running' where id = jid;
  accepted := public.complete_job_preflight(jid, 60.001);
  assert not accepted, 'Over-limit trial media was accepted';
  assert (select status = 'failed' and not trial_reserved from public.jobs where id = jid),
    'Over-limit trial job was not failed';
  assert not (select trial_used from public.profiles where id = trial_user),
    'Rejected trial media consumed the trial';

  jid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  perform public.create_job_with_trial(
    trial_user, jid, 'user-uploads/' || trial_user || '/' || jid || '/input.mp4', 'Unreadable trial', 'input.mp4'
  );
  update public.jobs set status = 'running' where id = jid;
  accepted := public.complete_job_preflight(jid, null);
  assert not accepted, 'Unreadable trial media was accepted';
  assert not (select trial_used from public.profiles where id = trial_user),
    'Unreadable trial media consumed the trial';

  jid := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  perform public.create_job_with_trial(
    trial_user, jid, 'user-uploads/' || trial_user || '/' || jid || '/input.mp4', 'Valid trial', 'input.mp4'
  );
  update public.jobs set status = 'running' where id = jid;
  accepted := public.complete_job_preflight(jid, 60);
  assert accepted, '60-second trial media was rejected';
  assert (select duration_seconds = 60 and not trial_reserved from public.jobs where id = jid),
    'Accepted trial duration was not saved';
  assert (select trial_used from public.profiles where id = trial_user),
    'Accepted trial was not consumed';

  jid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  perform public.create_job_with_trial(
    paid_user, jid, 'user-uploads/' || paid_user || '/' || jid || '/input.mp4', 'Paid', 'input.mp4'
  );
  assert (select duration_limit_seconds = 300 and not trial_reserved from public.jobs where id = jid),
    'Paid job did not receive a 300-second limit';
  update public.jobs set status = 'running' where id = jid;
  accepted := public.complete_job_preflight(jid, 300);
  assert accepted, '300-second paid media was rejected';
  assert not (select trial_used from public.profiles where id = paid_user),
    'Paid job consumed a trial';
end;
$$;

reset role;
rollback;
