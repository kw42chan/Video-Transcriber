-- Run as postgres against a disposable migrated Supabase database:
-- psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/definer_function_permissions.sql
begin;

do $$
declare
  fn record;
  role_name text;
begin
  for fn in select p.oid, p.proname, p.proconfig from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef loop
    foreach role_name in array array['anon', 'authenticated'] loop
      assert not has_function_privilege(role_name, fn.oid, 'EXECUTE'),
        'Client can execute SECURITY DEFINER function: ' || fn.proname;
    end loop;
    assert has_function_privilege('service_role', fn.oid, 'EXECUTE'),
      'Service role cannot execute: ' || fn.proname;
    assert exists (select 1 from unnest(fn.proconfig) setting where setting = 'search_path=""'),
      'Missing fixed empty search_path: ' || fn.proname;
  end loop;
end;
$$;

-- Test the legacy signup helper as a trigger as well as the current signup
-- trigger. Both must work without EXECUTE granted to the auth service role.
create trigger test_legacy_signup after insert on auth.users
  for each row execute function public.handle_new_user();
set local role supabase_auth_admin;
insert into auth.users (id, raw_user_meta_data)
values ('77777777-7777-4777-8777-777777777777', '{"full_name":"Signup test"}');
update auth.users set raw_user_meta_data = '{"full_name":"Updated signup test"}'
  where id = '77777777-7777-4777-8777-777777777777';
reset role;

do $$
begin
  assert exists (select 1 from public.profiles
    where id = '77777777-7777-4777-8777-777777777777'
      and display_name = 'Updated signup test' and not trial_used and not byok_enabled),
    'Signup or metadata trigger failed';
end;
$$;

select set_config('request.jwt.claim.sub', '77777777-7777-4777-8777-777777777777', true);
select set_config('request.jwt.claims', '{"sub":"77777777-7777-4777-8777-777777777777","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  begin
    perform public.claim_next_job();
    raise exception 'Client could invoke worker RPC';
  exception when insufficient_privilege then null;
  end;
end;
$$;
insert into public.projects (id, owner_id, name) values
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '77777777-7777-4777-8777-777777777777', 'Trigger test');
do $$
begin
  assert (select count(*) from public.project_stages
    where project_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee') = 6, 'Stage trigger failed';
end;
$$;
reset role;

rollback;
