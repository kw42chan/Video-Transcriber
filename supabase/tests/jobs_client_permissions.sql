-- Run as postgres against a disposable migrated Supabase database:
-- psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/jobs_client_permissions.sql
begin;

do $$
declare
  role_name text;
  column_name text;
begin
  foreach role_name in array array['anon', 'authenticated'] loop
    assert not has_table_privilege(role_name, 'public.jobs', 'INSERT'), 'Client INSERT allowed';
    assert not has_table_privilege(role_name, 'public.jobs', 'UPDATE'), 'Client UPDATE allowed';
    for column_name in select attname from pg_attribute
      where attrelid = 'public.jobs'::regclass and attnum > 0 and not attisdropped loop
      assert not has_column_privilege(role_name, 'public.jobs', column_name, 'INSERT'), 'Column INSERT allowed';
      assert not has_column_privilege(role_name, 'public.jobs', column_name, 'UPDATE'), 'Column UPDATE allowed';
    end loop;
    assert not has_function_privilege(role_name, 'public.claim_next_job()', 'EXECUTE'), 'Client can claim jobs';
  end loop;
  assert has_table_privilege('authenticated', 'public.jobs', 'SELECT'), 'Client SELECT denied';
end;
$$;

insert into auth.users (id) values
  ('55555555-5555-4555-8555-555555555555'),
  ('66666666-6666-4666-8666-666666666666');
insert into public.jobs (id, user_id, status, input_path) values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '55555555-5555-4555-8555-555555555555',
    'pending', 'user-uploads/55555555-5555-4555-8555-555555555555/input.mp4'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '66666666-6666-4666-8666-666666666666',
    'succeeded', 'user-uploads/66666666-6666-4666-8666-666666666666/input.mp4');

-- Exercise the real worker RPC and service-role update permissions.
set local role service_role;
do $$
declare
  claimed public.jobs;
begin
  select * into claimed from public.claim_next_job();
  assert claimed.id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid, 'Worker could not claim pending job';
  assert claimed.status = 'running', 'Claim did not set running';
  update public.jobs set status = 'succeeded', output_paths = '{"video":"job-outputs/test.mp4"}'
    where id = claimed.id;
  assert found, 'Service-role completion update denied';
end;
$$;
reset role;

select set_config('request.jwt.claim.sub', '55555555-5555-4555-8555-555555555555', true);
select set_config('request.jwt.claims', '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  assert (select count(*) from public.jobs where id in (
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  )) = 1, 'Owner SELECT isolation failed';
  assert exists (select 1 from public.jobs where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
    'Owner cannot read own job';

  begin
    insert into public.jobs (user_id, input_path)
      values ('55555555-5555-4555-8555-555555555555', 'user-uploads/other-user/input.mp4');
    raise exception 'Direct insert unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.jobs set status = 'pending' where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    raise exception 'Client status update unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.jobs set input_path = 'user-uploads/other-user/input.mp4'
      where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    raise exception 'Client input_path update unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

rollback;
