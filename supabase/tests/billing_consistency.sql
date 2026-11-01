-- Run after all migrations in a disposable database. Fixtures roll back.
begin;
insert into auth.users(id) values
 ('81818181-8181-4181-8181-818181818181'),
 ('82828282-8282-4282-8282-828282828282');
set local role service_role;
do $$declare
 uid uuid := '81818181-8181-4181-8181-818181818181';
 other_uid uuid := '82828282-8282-4282-8282-828282828282';
 older bigint; newer bigint; attempt jsonb; retry jsonb; renewed jsonb;
begin
 older:=public.begin_billing_sync('billing-first',uid,'cus_consistency');
 newer:=public.begin_billing_sync('billing-later',uid,'cus_consistency');
 assert newer>older;
 -- The latest provider read wins; a failed write cannot mark an event complete.
 assert public.complete_billing_sync('billing-later',uid,newer,'sub_test','canceled',now());
 assert not public.complete_billing_sync('billing-first',uid,older,'sub_test','active',now()+interval '1 day');
 assert not exists(select 1 from public.billing_events where event_id='billing-first');
 assert (select status='canceled' from public.subscriptions where user_id=uid);
 assert public.begin_billing_sync('billing-later',uid,'cus_consistency')=0;
 -- Duplicate completion is harmless and cannot change the committed entitlement.
 assert public.complete_billing_sync('billing-later',uid,newer,'sub_test','active',now()+interval '1 day');
 assert (select status='canceled' from public.subscriptions where user_id=uid);
 begin
   perform public.begin_billing_sync('billing-later',other_uid,'cus_other');
   assert false,'Processed event accepted for a different user';
 exception when raise_exception then null; end;
 begin
   perform public.complete_billing_sync('billing-later',other_uid,newer,'sub_other','active',now()+interval '1 day');
   assert false,'Completed event accepted for a different user';
 exception when raise_exception then null; end;
 begin
   insert into public.subscriptions(user_id,stripe_customer_id) values(other_uid,'cus_consistency');
   assert false,'Two users shared a provider customer';
 exception when unique_violation then null; end;
 newer:=public.begin_billing_sync('billing-invalid',uid,'cus_consistency');
 begin
   perform public.complete_billing_sync('billing-invalid',uid,newer,'sub_test','active',null);
   assert false,'Unbounded active access accepted';
 exception when invalid_parameter_value then null; end;
 assert not exists(select 1 from public.billing_events where event_id='billing-invalid');
 assert (select status='canceled' from public.subscriptions where user_id=uid);
 assert public.complete_billing_sync('billing-invalid',uid,newer,'sub_test','active',now()+interval '1 day');
 begin
   perform public.reserve_checkout(uid);
   assert false,'Checkout reservation bypassed an active local subscription';
 exception when insufficient_privilege then null; end;
 update public.subscriptions set status='canceled' where user_id=uid;

 -- Repeated/concurrent callers reuse the durable attempt until the explicit
 -- provider session expiry, not merely within an application clock bucket.
 attempt:=public.reserve_checkout(uid);
 retry:=public.reserve_checkout(uid);
 assert attempt=retry;
 assert attempt->>'customerId'='cus_consistency';
 assert (attempt->>'expiresAt')::bigint>extract(epoch from now());
 update public.subscriptions set checkout_expires_at=now()-interval '1 second' where user_id=uid;
 renewed:=public.reserve_checkout(uid);
 assert renewed->>'attemptId'<>attempt->>'attemptId';
 assert renewed->>'customerId'='cus_consistency';
end$$;
reset role;
do $$begin
 assert not has_function_privilege('anon','public.reserve_checkout(uuid)','EXECUTE');
 assert not has_function_privilege('authenticated','public.reserve_checkout(uuid)','EXECUTE');
 assert not has_column_privilege('authenticated','public.subscriptions','checkout_attempt_id','UPDATE');
end$$;
rollback;
