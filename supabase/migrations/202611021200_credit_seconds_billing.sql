-- Credit-seconds billing: auditable ledger, monthly vs top-up pools, job reserve/finalize.
begin;

alter table public.subscriptions
  add column if not exists plan_key text
    check (plan_key is null or plan_key in ('starter', 'pro', 'studio'));

comment on column public.subscriptions.plan_key is
  'Active Stripe subscription tier; credits come from plan_key seconds on each invoice.paid.';

create table if not exists public.credit_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  monthly_seconds numeric(12, 3) not null default 0 check (monthly_seconds >= 0),
  topup_seconds numeric(12, 3) not null default 0 check (topup_seconds >= 0),
  reserved_seconds numeric(12, 3) not null default 0 check (reserved_seconds >= 0),
  updated_at timestamptz not null default now()
);

comment on table public.credit_accounts is
  'monthly_seconds reset/replaced on subscription renewal; topup_seconds persist across renewals.';

create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  amount_seconds numeric(12, 3) not null,
  kind text not null check (kind in (
    'monthly_grant', 'topup_grant', 'monthly_expire', 'job_reserve', 'job_release',
    'job_consume', 'admin_adjust'
  )),
  idempotency_key text not null unique,
  job_id uuid references public.jobs (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists credit_ledger_user_id_created_at_idx
  on public.credit_ledger (user_id, created_at desc);

alter table public.jobs
  add column if not exists billing_mode text
    check (billing_mode is null or billing_mode in ('trial', 'byok', 'platform')),
  add column if not exists reserved_seconds numeric(12, 3),
  add column if not exists billed_seconds numeric(12, 3);

comment on column public.jobs.billing_mode is
  'trial/BYOK skip platform credit debit; platform jobs reserve then consume seconds on success.';

-- Ensure credit account row exists (service-only callers).
create or replace function public.ensure_credit_account(p_user_id uuid)
returns public.credit_accounts
language plpgsql
security definer
set search_path = ''
as $$
declare
  acct public.credit_accounts;
begin
  insert into public.credit_accounts (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select * into acct from public.credit_accounts where user_id = p_user_id for update;
  return acct;
end;
$$;

create or replace function public.credit_available_seconds(p_user_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select greatest(
      ca.monthly_seconds + ca.topup_seconds - ca.reserved_seconds,
      0
    )
    from public.credit_accounts ca
    where ca.user_id = p_user_id),
    0
  );
$$;

-- Deduct from monthly pool first, then top-up.
create or replace function public._debit_pools(
  p_user_id uuid,
  p_amount numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  acct public.credit_accounts;
  from_monthly numeric;
  from_topup numeric;
begin
  if p_amount <= 0 then
    return;
  end if;

  select * into acct from public.ensure_credit_account(p_user_id);

  from_monthly := least(acct.monthly_seconds, p_amount);
  from_topup := p_amount - from_monthly;

  if from_topup > acct.topup_seconds then
    raise exception 'Insufficient credits' using errcode = '42501';
  end if;

  update public.credit_accounts
  set
    monthly_seconds = monthly_seconds - from_monthly,
    topup_seconds = topup_seconds - from_topup,
    updated_at = now()
  where user_id = p_user_id;
end;
$$;

create or replace function public.grant_monthly_credits(
  p_user_id uuid,
  p_seconds numeric,
  p_idempotency_key text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  acct public.credit_accounts;
  expired numeric;
begin
  if p_seconds <= 0 or p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'Invalid grant' using errcode = '22023';
  end if;

  if exists (select 1 from public.credit_ledger where idempotency_key = p_idempotency_key) then
    return;
  end if;

  select * into acct from public.ensure_credit_account(p_user_id);
  expired := acct.monthly_seconds;

  if expired > 0 then
    insert into public.credit_ledger (user_id, amount_seconds, kind, idempotency_key, metadata)
    values (
      p_user_id,
      -expired,
      'monthly_expire',
      p_idempotency_key || ':expire',
      coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('expired_seconds', expired)
    );
  end if;

  update public.credit_accounts
  set monthly_seconds = p_seconds, updated_at = now()
  where user_id = p_user_id;

  insert into public.credit_ledger (user_id, amount_seconds, kind, idempotency_key, metadata)
  values (p_user_id, p_seconds, 'monthly_grant', p_idempotency_key, coalesce(p_metadata, '{}'::jsonb));
end;
$$;

create or replace function public.grant_topup_credits(
  p_user_id uuid,
  p_seconds numeric,
  p_idempotency_key text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_seconds <= 0 or p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'Invalid grant' using errcode = '22023';
  end if;

  if exists (select 1 from public.credit_ledger where idempotency_key = p_idempotency_key) then
    return;
  end if;

  perform public.ensure_credit_account(p_user_id);

  update public.credit_accounts
  set topup_seconds = topup_seconds + p_seconds, updated_at = now()
  where user_id = p_user_id;

  insert into public.credit_ledger (user_id, amount_seconds, kind, idempotency_key, metadata)
  values (p_user_id, p_seconds, 'topup_grant', p_idempotency_key, coalesce(p_metadata, '{}'::jsonb));
end;
$$;

create or replace function public.reserve_job_credits(
  p_job_id uuid,
  p_duration_seconds numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.jobs;
  avail numeric;
begin
  if p_job_id is null or p_duration_seconds is null or p_duration_seconds <= 0 then
    raise exception 'Invalid reserve' using errcode = '22023';
  end if;

  select * into job from public.jobs where id = p_job_id for update;
  if not found then
    raise exception 'Job missing' using errcode = 'P0002';
  end if;

  if job.billing_mode is distinct from 'platform' then
    update public.jobs
    set duration_seconds = p_duration_seconds
    where id = p_job_id;
    return;
  end if;

  if job.reserved_seconds is not null and job.reserved_seconds > 0 then
    return;
  end if;

  perform public.ensure_credit_account(job.user_id);
  avail := public.credit_available_seconds(job.user_id);

  if avail < p_duration_seconds then
    raise exception 'Insufficient credits for video duration (% sec available, % sec required)',
      avail, p_duration_seconds using errcode = '42501';
  end if;

  update public.credit_accounts
  set reserved_seconds = reserved_seconds + p_duration_seconds, updated_at = now()
  where user_id = job.user_id;

  update public.jobs
  set
    reserved_seconds = p_duration_seconds,
    duration_seconds = p_duration_seconds
  where id = p_job_id;

  insert into public.credit_ledger (user_id, amount_seconds, kind, idempotency_key, job_id, metadata)
  values (
    job.user_id,
    -p_duration_seconds,
    'job_reserve',
    'job_reserve:' || p_job_id::text,
    p_job_id,
    jsonb_build_object('duration_seconds', p_duration_seconds)
  );
end;
$$;

create or replace function public.finalize_job_credits(
  p_job_id uuid,
  p_billed_seconds numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.jobs;
  reserved numeric;
  bill numeric;
  release_amt numeric;
begin
  select * into job from public.jobs where id = p_job_id for update;
  if not found then
    raise exception 'Job missing' using errcode = 'P0002';
  end if;

  if job.billing_mode is distinct from 'platform' then
    if p_billed_seconds is not null and p_billed_seconds > 0 then
      update public.jobs set duration_seconds = p_billed_seconds where id = p_job_id;
    end if;
    return;
  end if;

  reserved := coalesce(job.reserved_seconds, 0);
  if reserved <= 0 then
    return;
  end if;

  bill := greatest(least(coalesce(p_billed_seconds, reserved), reserved), 0);
  release_amt := reserved - bill;

  perform public.ensure_credit_account(job.user_id);

  update public.credit_accounts
  set
    reserved_seconds = greatest(reserved_seconds - reserved, 0),
    updated_at = now()
  where user_id = job.user_id;

  if bill > 0 then
    perform public._debit_pools(job.user_id, bill);
    insert into public.credit_ledger (user_id, amount_seconds, kind, idempotency_key, job_id, metadata)
    values (
      job.user_id,
      -bill,
      'job_consume',
      'job_consume:' || p_job_id::text,
      p_job_id,
      jsonb_build_object('billed_seconds', bill)
    );
  end if;

  if release_amt > 0 then
    insert into public.credit_ledger (user_id, amount_seconds, kind, idempotency_key, job_id, metadata)
    values (
      job.user_id,
      release_amt,
      'job_release',
      'job_release:' || p_job_id::text || ':success',
      p_job_id,
      jsonb_build_object('released_seconds', release_amt)
    );
  end if;

  update public.jobs
  set billed_seconds = bill, reserved_seconds = 0
  where id = p_job_id;
end;
$$;

create or replace function public.release_job_credits(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.jobs;
  reserved numeric;
begin
  select * into job from public.jobs where id = p_job_id for update;
  if not found then
    return;
  end if;

  if job.billing_mode is distinct from 'platform' then
    return;
  end if;

  reserved := coalesce(job.reserved_seconds, 0);
  if reserved <= 0 then
    return;
  end if;

  perform public.ensure_credit_account(job.user_id);

  update public.credit_accounts
  set
    reserved_seconds = greatest(reserved_seconds - reserved, 0),
    updated_at = now()
  where user_id = job.user_id;

  insert into public.credit_ledger (user_id, amount_seconds, kind, idempotency_key, job_id, metadata)
  values (
    job.user_id,
    reserved,
    'job_release',
    'job_release:' || p_job_id::text || ':failed',
    p_job_id,
    jsonb_build_object('released_seconds', reserved)
  )
  on conflict (idempotency_key) do nothing;

  update public.jobs set reserved_seconds = 0 where id = p_job_id;
end;
$$;

-- Replace entitlement gate: trial, BYOK, or platform credits (not unlimited subscription).
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
  mode text;
  avail numeric;
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

  if profile.byok_enabled then
    mode := 'byok';
  elsif not profile.trial_used then
    mode := 'trial';
  else
    avail := public.credit_available_seconds(p_user_id);
    if avail <= 0 then
      raise exception 'No credits remaining; subscribe or buy a top-up' using errcode = '42501';
    end if;
    mode := 'platform';
  end if;

  insert into public.jobs (id, user_id, status, input_path, duration_seconds, billing_mode, metadata)
  values (p_job_id, p_user_id, 'pending', p_input_path, null, mode,
    jsonb_build_object('project_name', p_project_name, 'file_name', p_file_name));

  if mode = 'trial' then
    update public.profiles set trial_used = true where id = p_user_id;
  end if;

  return p_job_id;
end;
$$;

alter table public.credit_accounts enable row level security;
alter table public.credit_ledger enable row level security;

create policy "credit_accounts_select_own"
  on public.credit_accounts for select
  using (auth.uid() = user_id);

create policy "credit_ledger_select_own"
  on public.credit_ledger for select
  using (auth.uid() = user_id);

revoke all on table public.credit_accounts from public, anon, authenticated;
revoke all on table public.credit_ledger from public, anon, authenticated;
grant select on table public.credit_accounts to authenticated;
grant select on table public.credit_ledger to authenticated;
grant all on table public.credit_accounts to service_role;
grant all on table public.credit_ledger to service_role;

revoke all on function public.ensure_credit_account(uuid) from public, anon, authenticated;
revoke all on function public.credit_available_seconds(uuid) from public, anon, authenticated;
revoke all on function public._debit_pools(uuid, numeric) from public, anon, authenticated;
revoke all on function public.grant_monthly_credits(uuid, numeric, text, jsonb) from public, anon, authenticated;
revoke all on function public.grant_topup_credits(uuid, numeric, text, jsonb) from public, anon, authenticated;
revoke all on function public.reserve_job_credits(uuid, numeric) from public, anon, authenticated;
revoke all on function public.finalize_job_credits(uuid, numeric) from public, anon, authenticated;
revoke all on function public.release_job_credits(uuid) from public, anon, authenticated;

grant execute on function public.ensure_credit_account(uuid) to service_role;
grant execute on function public.credit_available_seconds(uuid) to service_role;
grant execute on function public._debit_pools(uuid, numeric) to service_role;
grant execute on function public.grant_monthly_credits(uuid, numeric, text, jsonb) to service_role;
grant execute on function public.grant_topup_credits(uuid, numeric, text, jsonb) to service_role;
grant execute on function public.reserve_job_credits(uuid, numeric) to service_role;
grant execute on function public.finalize_job_credits(uuid, numeric) to service_role;
grant execute on function public.release_job_credits(uuid) to service_role;

commit;
