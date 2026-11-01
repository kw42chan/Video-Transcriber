-- Disposable migrated database only; all fixtures roll back.
begin;
insert into auth.users(id) values
 ('10101010-1010-4010-8010-101010101010'),
 ('20202020-2020-4020-8020-202020202020'),
 ('30303030-3030-4030-8030-303030303030'),
 ('60606060-6060-4060-8060-606060606060');
update public.profiles set byok_enabled=true where id='20202020-2020-4020-8020-202020202020';
set local role service_role;
do $$
declare
 uid uuid := '10101010-1010-4010-8010-101010101010'; jid uuid := gen_random_uuid();
 v1 bigint; v2 bigint;
begin
 perform public.reserve_upload(uid,jid,uid::text||'/'||jid::text||'/input.mp4');
 begin
   jid:=gen_random_uuid();
   perform public.reserve_upload(uid,jid,uid::text||'/'||jid::text||'/input.mp4');
   raise exception 'Trial quota bypass';
 exception when program_limit_exceeded then null; end;
 update public.profiles set trial_used=true where id=uid;
 begin
   perform public.reserve_upload(uid,jid,uid::text||'/'||jid::text||'/input.mp4');
   raise exception 'Exhausted trial upload allowed';
 exception when insufficient_privilege then null; end;
 uid:='20202020-2020-4020-8020-202020202020';
 for i in 1..4 loop
   jid:=gen_random_uuid();
   perform public.reserve_upload(uid,jid,uid::text||'/'||jid::text||'/input.mp4');
 end loop;
 begin
   jid:=gen_random_uuid();
   perform public.reserve_upload(uid,jid,uid::text||'/'||jid::text||'/input.mp4');
   raise exception 'Paid quota bypass';
 exception when program_limit_exceeded then null; end;
 -- Expired reservations cannot authorize uploads and no longer hold capacity.
 update public.upload_reservations set expires_at=now()-interval '1 second' where user_id=uid;
 perform public.reserve_upload(uid,jid,uid::text||'/'||jid::text||'/input.mp4');
 for i in 1..15 loop
   jid:=gen_random_uuid();
   update public.upload_reservations set expires_at=now()-interval '1 second' where user_id=uid;
   perform public.reserve_upload(uid,jid,uid::text||'/'||jid::text||'/input.mp4');
 end loop;
 begin
   jid:=gen_random_uuid();
   perform public.reserve_upload(uid,jid,uid::text||'/'||jid::text||'/input.mp4');
   raise exception 'Daily reservation cap bypass';
 exception when program_limit_exceeded then null; end;
 uid:='30303030-3030-4030-8030-303030303030';
 v1:=public.begin_billing_sync('event-old',uid,'cus_test');
 v2:=public.begin_billing_sync('event-new',uid,'cus_test');
 assert v2>v1;
 assert public.complete_billing_sync('event-new',uid,v2,'sub_test','canceled',now());
 assert not public.complete_billing_sync('event-old',uid,v1,'sub_test','active',now()+interval '1 day');
 assert (select status='canceled' from public.subscriptions where user_id=uid);
 assert not exists(select 1 from public.billing_events where event_id='event-old');
 assert public.begin_billing_sync('event-new',uid,'cus_test')=0;
 assert public.complete_billing_sync('event-new',uid,v2,'sub_test','active',now());
 assert (select status='canceled' from public.subscriptions where user_id=uid);
 begin
   perform public.begin_billing_sync('event-foreign',uid,'cus_other');
   raise exception 'Customer mapping changed';
 exception when raise_exception then
   assert (select stripe_customer_id='cus_test' from public.subscriptions where user_id=uid);
 end;
end;
$$;
reset role;

-- A completed but unreserved object, or a reservation without an object,
-- must not create jobs or consume the free trial.
do $$declare
 uid uuid := '60606060-6060-4060-8060-606060606060';
 jid uuid := '70707070-7070-4070-8070-707070707070';
 p text := uid::text||'/'||jid::text||'/input.mp4';
begin
 insert into storage.objects(bucket_id,name,metadata) values('user-uploads',p,'{"size":1}');
 begin
   perform public.create_job_with_trial(uid,jid,'user-uploads/'||p,'Bypass','input.mp4');
   raise exception 'Unreserved job accepted';
 exception when invalid_parameter_value then null; end;
 delete from storage.objects where bucket_id='user-uploads' and name=p;
 perform public.reserve_upload(uid,jid,p);
 begin
   perform public.create_job_with_trial(uid,jid,'user-uploads/'||p,'Missing','input.mp4');
   raise exception 'Missing upload job accepted';
 exception when invalid_parameter_value then null; end;
 assert not (select trial_used from public.profiles where id=uid);
 perform set_config('request.jwt.claim.sub',uid::text,true);
 update public.upload_reservations set expires_at=now()-interval '1 second' where job_id=jid;
 set local role authenticated;
 begin
   insert into storage.objects(bucket_id,name,metadata) values('user-uploads',p,'{"size":1}');
   raise exception 'Expired reservation allowed an upload';
 exception when insufficient_privilege then null; end;
 reset role;
 update public.upload_reservations set expires_at=now()+interval '15 minutes' where job_id=jid;
 -- The exact same authenticated Storage insert is allowed with a live reservation.
 set local role authenticated;
 insert into storage.objects(bucket_id,name,metadata) values('user-uploads',p,'{"size":1}');
 reset role;
 perform public.create_job_with_trial(uid,jid,'user-uploads/'||p,'Valid','input.mp4');
 assert (select trial_used from public.profiles where id=uid);
end$$;

select set_config('request.jwt.claim.sub','60606060-6060-4060-8060-606060606060',true);
set local role authenticated;
do $$declare bucket text; begin
 delete from storage.objects where bucket_id='user-uploads'
   and name='60606060-6060-4060-8060-606060606060/70707070-7070-4070-8070-707070707070/input.mp4';
 begin
   insert into storage.objects(bucket_id,name,metadata) values('user-uploads',
     '60606060-6060-4060-8060-606060606060/70707070-7070-4070-8070-707070707070/input.mp4','{"size":1}');
   raise exception 'Spent trial reused a live reservation';
 exception when insufficient_privilege then null; end;
 foreach bucket in array array['user-uploads','source-videos','voice-references'] loop
   begin
     insert into storage.objects(bucket_id,name,metadata) values
       (bucket,'60606060-6060-4060-8060-606060606060/direct.mp4','{"size":1}');
     raise exception 'Direct upload bypassed authorization';
   exception when insufficient_privilege then null; end;
 end loop;
 update storage.objects set metadata='{"size":1}' where bucket_id='user-uploads'
   and name like '60606060-6060-4060-8060-606060606060/%';
 assert not found, 'Client overwrite allowed';
 begin
   perform public.reserve_upload('60606060-6060-4060-8060-606060606060',gen_random_uuid(),'forged');
   raise exception 'Client called reservation RPC';
 exception when insufficient_privilege then null; end;
end$$;
reset role;

-- This valid trial fixture was queued above; finish it before worker claim tests.
update public.jobs set status='succeeded' where user_id='60606060-6060-4060-8060-606060606060';

-- Direct owner uploads/overwrites must have no remaining policy to bypass tokens.
do $$begin
 assert not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects'
   and cmd in ('INSERT','UPDATE','ALL') and policyname<>'user_uploads_insert_reserved'), 'Unexpected writable storage policy';
 assert not has_table_privilege('authenticated','public.upload_reservations','INSERT');
 assert not has_function_privilege('authenticated','public.reserve_upload(uuid,uuid,text)','EXECUTE');
 assert not has_function_privilege('authenticated','public.begin_billing_sync(text,uuid,text)','EXECUTE');
 assert not has_function_privilege('authenticated','public.complete_billing_sync(text,uuid,bigint,text,text,timestamptz)','EXECUTE');
end$$;

insert into public.jobs(id,user_id,input_path,status,lease_expires_at) values
 ('40404040-4040-4040-8040-404040404040','30303030-3030-4030-8030-303030303030','stale','running',now()-interval '1 minute'),
 ('50505050-5050-4050-8050-505050505050','30303030-3030-4030-8030-303030303030','next','pending',null);
set local role service_role;
do $$declare claimed public.jobs; begin
 select * into claimed from public.claim_next_job();
 assert claimed.id='50505050-5050-4050-8050-505050505050';
 assert claimed.lease_expires_at>now();
 assert (select status='failed' from public.jobs where input_path='stale');
end$$;
reset role;
rollback;
