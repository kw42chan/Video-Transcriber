-- Run against a disposable migrated Supabase database as postgres:
-- psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/atomic_job_trial.sql
-- All fixtures and jobs are rolled back.
begin;

do $$
declare
  role_name text;
  column_name text;
begin
  foreach role_name in array array['anon', 'authenticated'] loop
    foreach column_name in array array['trial_used', 'byok_enabled'] loop
      assert not has_column_privilege(role_name, 'public.profiles', column_name, 'UPDATE'),
        'Client can modify entitlement flags';
    end loop;
    assert not has_table_privilege(role_name, 'public.jobs', 'INSERT'), 'Direct job insert allowed';
    assert not has_function_privilege(role_name,
      'public.create_job_with_trial(uuid,uuid,text,text,text)', 'EXECUTE'), 'Client can execute RPC';
  end loop;
  foreach column_name in array array['encrypted_byok_keys', 'display_name', 'avatar_url'] loop
    assert has_column_privilege('authenticated', 'public.profiles', column_name, 'UPDATE'),
      'Safe profile update denied';
  end loop;
  assert has_function_privilege('service_role',
    'public.create_job_with_trial(uuid,uuid,text,text,text)', 'EXECUTE'), 'Service cannot execute RPC';
end;
$$;

insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333'),
  ('44444444-4444-4444-8444-444444444444');
-- Also works with minimal test schemas without the signup trigger.
insert into public.profiles (id)
select id from auth.users where id in (
  '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'
) on conflict (id) do nothing;

do $$
declare
  uid uuid := '11111111-1111-4111-8111-111111111111';
  jid uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
begin
  assert public.create_job_with_trial(uid, jid,
    'user-uploads/' || uid || '/' || jid || '/input.mp4', 'Trial', 'input.mp4') = jid;
  assert (select trial_used from public.profiles where id = uid), 'Trial not consumed';
  assert (select duration_seconds is null from public.jobs where id = jid), 'Unverified duration stored';

  begin
    jid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    perform public.create_job_with_trial(uid, jid,
      'user-uploads/' || uid || '/' || jid || '/input.mp4', 'Repeat', 'input.mp4');
    raise exception 'Repeat trial unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
  assert (select count(*) from public.jobs where user_id = uid) = 1, 'Repeat job created';

  -- A duplicate job ID must not consume another user's unused trial.
  uid := '22222222-2222-4222-8222-222222222222';
  jid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  begin
    perform public.create_job_with_trial(uid, jid,
      'user-uploads/' || uid || '/' || jid || '/input.mp4', 'Duplicate', 'input.mp4');
    raise exception 'Duplicate job unexpectedly allowed';
  exception when unique_violation then null;
  end;
  assert not (select trial_used from public.profiles where id = uid), 'Failed insert consumed trial';

  begin
    perform public.create_job_with_trial(uid, jid,
      'user-uploads/other-user/' || jid || '/input.mp4', 'Foreign', 'input.mp4');
    raise exception 'Foreign upload unexpectedly allowed';
  exception when invalid_parameter_value then null;
  end;
end;
$$;

insert into public.subscriptions (user_id, status, current_period_end)
values ('22222222-2222-4222-8222-222222222222', 'active', now() + interval '1 day'),
       ('44444444-4444-4444-8444-444444444444', 'active', now() - interval '1 day');
update public.profiles set byok_enabled = true where id = '33333333-3333-4333-8333-333333333333';
update public.profiles set trial_used = true where id = '44444444-4444-4444-8444-444444444444';

set local role service_role;
do $$
declare
  uid uuid;
  jid uuid;
begin
  foreach uid in array array[
    '22222222-2222-4222-8222-222222222222'::uuid,
    '33333333-3333-4333-8333-333333333333'::uuid
  ] loop
    for i in 1..2 loop
      jid := gen_random_uuid();
      perform public.create_job_with_trial(uid, jid,
        'user-uploads/' || uid || '/' || jid || '/input.mp4', 'Entitled', 'input.mp4');
    end loop;
    assert not (select trial_used from public.profiles where id = uid), 'Paid/BYOK consumed trial';
  end loop;
  uid := '44444444-4444-4444-8444-444444444444';
  jid := gen_random_uuid();
  begin
    perform public.create_job_with_trial(uid, jid,
      'user-uploads/' || uid || '/' || jid || '/input.mp4', 'Expired', 'input.mp4');
    raise exception 'Expired subscription unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

rollback;
