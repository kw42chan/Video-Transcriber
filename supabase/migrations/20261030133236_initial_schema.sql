-- Video-Transcriber SaaS MVP schema
create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  trial_used boolean not null default false,
  byok_enabled boolean not null default false,
  encrypted_byok_keys jsonb,
  created_at timestamptz not null default now()
);

comment on column public.profiles.encrypted_byok_keys is
  'AES-GCM encrypted JSON: { openrouter?, cantoGen?, synclabs?, fal? } — never expose plaintext to clients';

create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text,
  status text not null default 'inactive',
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subscriptions_stripe_customer_id_idx
  on public.subscriptions (stripe_customer_id);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'succeeded', 'failed')),
  input_path text not null,
  output_paths jsonb not null default '{}'::jsonb,
  error text,
  duration_seconds numeric,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists jobs_user_id_created_at_idx
  on public.jobs (user_id, created_at desc);

create index if not exists jobs_status_created_at_idx
  on public.jobs (status, created_at)
  where status = 'pending';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists jobs_set_updated_at on public.jobs;
create trigger jobs_set_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();

drop trigger if exists subscriptions_set_updated_at on public.subscriptions;
create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

create or replace function public.claim_next_job()
returns setof public.jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.jobs;
begin
  select * into claimed
  from public.jobs
  where status = 'pending'
  order by created_at asc
  for update skip locked
  limit 1;

  if not found then
    return;
  end if;

  update public.jobs
  set status = 'running', updated_at = now()
  where id = claimed.id
  returning * into claimed;

  return next claimed;
end;
$$;

revoke all on function public.claim_next_job() from public;
grant execute on function public.claim_next_job() to service_role;

alter table public.profiles enable row level security;
alter table public.subscriptions enable row level security;
alter table public.jobs enable row level security;

create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "subscriptions_select_own"
  on public.subscriptions for select
  using (auth.uid() = user_id);

create policy "jobs_select_own"
  on public.jobs for select
  using (auth.uid() = user_id);

create policy "jobs_insert_own"
  on public.jobs for insert
  with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'user-uploads',
    'user-uploads',
    false,
    524288000,
    array['video/mp4', 'video/quicktime', 'video/webm', 'audio/wav', 'audio/mpeg', 'audio/mp4']
  ),
  (
    'job-outputs',
    'job-outputs',
    false,
    524288000,
    array['video/mp4', 'audio/wav', 'audio/mpeg', 'application/json', 'text/plain']
  )
on conflict (id) do nothing;

create policy "user_uploads_select_own"
  on storage.objects for select
  using (
    bucket_id = 'user-uploads'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "user_uploads_insert_own"
  on storage.objects for insert
  with check (
    bucket_id = 'user-uploads'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "user_uploads_update_own"
  on storage.objects for update
  using (
    bucket_id = 'user-uploads'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "user_uploads_delete_own"
  on storage.objects for delete
  using (
    bucket_id = 'user-uploads'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "job_outputs_select_own"
  on storage.objects for select
  using (
    bucket_id = 'job-outputs'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
;
