begin;
alter table public.jobs add column lease_expires_at timestamptz;
create or replace function public.claim_next_job()
returns setof public.jobs language plpgsql security definer set search_path='' as $$
declare claimed public.jobs;
begin
  -- Never auto-retry a crashed job: provider charges may already have occurred.
  update public.jobs set status='failed', error='Worker lease expired; review before retrying'
    where status='running' and coalesce(lease_expires_at,updated_at+interval '60 minutes')<now();
  select * into claimed from public.jobs where status='pending'
    order by created_at for update skip locked limit 1;
  if not found then return; end if;
  update public.jobs set status='running', lease_expires_at=now()+interval '60 minutes'
    where id=claimed.id returning * into claimed;
  return next claimed;
end;
$$;
revoke all on function public.claim_next_job() from public,anon,authenticated;
grant execute on function public.claim_next_job() to service_role;
alter table public.subscriptions add column billing_sync_version bigint not null default 0;
alter table public.subscriptions add column checkout_attempt_id uuid;
alter table public.subscriptions add column checkout_expires_at timestamptz;
alter table public.subscriptions add constraint checkout_attempt_pair
  check ((checkout_attempt_id is null)=(checkout_expires_at is null));
-- A provider customer must never grant access to two different local users.
-- Pre-existing duplicates must be reconciled before this migration is applied.
create unique index subscriptions_customer_unique on public.subscriptions(stripe_customer_id)
  where stripe_customer_id is not null;
revoke insert,update,delete on public.subscriptions from public,anon,authenticated;
revoke insert(user_id,stripe_customer_id,stripe_subscription_id,status,current_period_end,created_at,updated_at,
  billing_sync_version,checkout_attempt_id,checkout_expires_at),
  update(user_id,stripe_customer_id,stripe_subscription_id,status,current_period_end,created_at,updated_at,
  billing_sync_version,checkout_attempt_id,checkout_expires_at)
  on public.subscriptions from public,anon,authenticated;
grant all on public.subscriptions to service_role;
create table public.billing_events (
  event_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  processed_at timestamptz not null default now()
);
alter table public.billing_events enable row level security;
revoke all on public.billing_events from public,anon,authenticated;
grant all on public.billing_events to service_role;

-- Fence handlers BEFORE reading Stripe so old in-flight work cannot win.
create function public.begin_billing_sync(p_event_id text,p_user_id uuid,p_customer_id text)
returns bigint language plpgsql security definer set search_path='' as $$
declare result bigint;
begin
  if nullif(btrim(p_event_id),'') is null or nullif(btrim(p_customer_id),'') is null then
    raise exception 'Invalid billing event' using errcode='22023';
  end if;
  perform 1 from public.profiles where id=p_user_id for update;
  if not found then raise exception 'Profile missing'; end if;
  if exists(select 1 from public.billing_events where event_id=p_event_id and user_id<>p_user_id) then
    raise exception 'Event mapping mismatch';
  end if;
  if exists(select 1 from public.billing_events where event_id=p_event_id) then return 0; end if;
  insert into public.subscriptions(user_id,stripe_customer_id)
    values(p_user_id,p_customer_id) on conflict(user_id) do nothing;
  if exists(select 1 from public.subscriptions where user_id=p_user_id
      and stripe_customer_id is not null and stripe_customer_id<>p_customer_id) then
    raise exception 'Customer mapping mismatch';
  end if;
  update public.subscriptions set stripe_customer_id=p_customer_id,
    billing_sync_version=billing_sync_version+1 where user_id=p_user_id
    returning billing_sync_version into result;
  return result;
end;
$$;
create function public.complete_billing_sync(p_event_id text,p_user_id uuid,p_version bigint,
  p_subscription_id text,p_status text,p_period_end timestamptz)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if nullif(btrim(p_event_id),'') is null or p_version is null or p_version<=0
    or p_status is null or p_status not in ('inactive','incomplete','incomplete_expired','trialing','active','past_due','canceled','unpaid','paused')
    or (p_status='active' and (nullif(btrim(p_subscription_id),'') is null or p_period_end is null)) then
    raise exception 'Invalid billing state' using errcode='22023';
  end if;
  perform 1 from public.profiles where id=p_user_id for update;
  if not found then return false; end if;
  if exists(select 1 from public.billing_events where event_id=p_event_id and user_id<>p_user_id) then
    raise exception 'Event mapping mismatch';
  end if;
  if exists(select 1 from public.billing_events where event_id=p_event_id) then return true; end if;
  update public.subscriptions set stripe_subscription_id=p_subscription_id,
    status=p_status,current_period_end=p_period_end
    where user_id=p_user_id and billing_sync_version=p_version;
  if not found then return false; end if;
  insert into public.billing_events(event_id,user_id) values(p_event_id,p_user_id);
  return true;
end;
$$;
revoke all on function public.begin_billing_sync(text,uuid,text) from public,anon,authenticated;
revoke all on function public.complete_billing_sync(text,uuid,bigint,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.begin_billing_sync(text,uuid,text) to service_role;
grant execute on function public.complete_billing_sync(text,uuid,bigint,text,text,timestamptz) to service_role;

-- Persist the checkout attempt across requests and server restarts. A clock
-- bucket alone can issue two payable sessions across its boundary.
create function public.reserve_checkout(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare subscription public.subscriptions;
begin
  perform 1 from public.profiles where id=p_user_id for update;
  if not found then raise exception 'Profile missing'; end if;
  select * into subscription from public.subscriptions where user_id=p_user_id;
  if not found or subscription.stripe_customer_id is null then raise exception 'Customer mapping missing'; end if;
  if subscription.status='active' and (subscription.current_period_end is null or subscription.current_period_end>now()) then
    raise exception 'Subscription already active' using errcode='42501';
  end if;
  if subscription.checkout_attempt_id is null or subscription.checkout_expires_at is null or subscription.checkout_expires_at<=now() then
    update public.subscriptions set checkout_attempt_id=gen_random_uuid(),checkout_expires_at=now()+interval '1 hour'
      where user_id=p_user_id returning * into subscription;
  end if;
  return jsonb_build_object('attemptId',subscription.checkout_attempt_id,
    'expiresAt',floor(extract(epoch from subscription.checkout_expires_at))::bigint,
    'customerId',subscription.stripe_customer_id);
end;
$$;
revoke all on function public.reserve_checkout(uuid) from public,anon,authenticated;
grant execute on function public.reserve_checkout(uuid) to service_role;
commit;
