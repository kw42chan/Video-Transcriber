begin;

-- Only the server may reserve capacity. Storage rechecks current entitlement.
create table public.upload_reservations (
  job_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  object_path text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes'
);
create index upload_reservations_user_created on public.upload_reservations(user_id, created_at);
alter table public.upload_reservations enable row level security;
revoke all on public.upload_reservations from public, anon, authenticated;
grant all on public.upload_reservations to service_role;
grant select on public.upload_reservations to authenticated;
create policy reservations_read_own on public.upload_reservations for select to authenticated
  using (user_id=(select auth.uid()));

create function public.reserve_upload(p_user_id uuid, p_job_id uuid, p_object_path text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  profile public.profiles;
  entitled boolean;
  used_bytes numeric;
  reserved_bytes numeric;
  quota_bytes bigint;
begin
  if p_user_id is null or p_job_id is null or p_object_path is null
    or p_object_path !~ ('^' || p_user_id::text || '/' || p_job_id::text || '/input[.](mp4|mov|webm)$') then
    raise exception 'Invalid upload' using errcode='22023';
  end if;
  -- Serialize capacity allocation and entitlement changes for this account.
  select * into profile from public.profiles where id=p_user_id for update;
  if not found then raise exception 'Profile missing' using errcode='P0002'; end if;
  entitled := profile.byok_enabled or exists (
    select 1 from public.subscriptions where user_id=p_user_id and status='active'
      and (current_period_end is null or current_period_end > now())
  );
  if not entitled and profile.trial_used then
    raise exception 'Trial already used' using errcode='42501';
  end if;
  if exists (select 1 from public.upload_reservations where job_id=p_job_id)
    or exists (select 1 from public.jobs where id=p_job_id) then
    raise exception 'Upload already reserved' using errcode='23505';
  end if;
  if (select count(*) from public.upload_reservations
      where user_id=p_user_id and created_at > now()-interval '24 hours') >= 20 then
    raise exception 'Daily upload limit reached' using errcode='54000';
  end if;
  -- Reserve the full bucket maximum, never a client-declared size.
  -- Include legacy input buckets; unknown sizes conservatively count as 500 MiB.
  select coalesce(sum(greatest(case when (metadata->>'size') ~ '^[0-9]+$'
    then (metadata->>'size')::numeric else 524288000 end, 524288000)),0)
    into used_bytes from storage.objects
    where bucket_id in ('user-uploads','source-videos','voice-references')
      and split_part(name,'/',1)=p_user_id::text;
  select count(*)*524288000::numeric into reserved_bytes
    from public.upload_reservations r where r.user_id=p_user_id and r.expires_at>now()
      and not exists (select 1 from storage.objects o
        where o.bucket_id='user-uploads' and o.name=r.object_path);
  quota_bytes := case when entitled then 2097152000 else 524288000 end;
  if used_bytes+reserved_bytes+524288000 > quota_bytes then
    raise exception 'Upload storage quota reached; delete unused inputs or wait for reservations to expire'
      using errcode='54000';
  end if;
  insert into public.upload_reservations(job_id,user_id,object_path)
    values(p_job_id,p_user_id,p_object_path);
  return p_object_path;
end;
$$;
revoke all on function public.reserve_upload(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.reserve_upload(uuid,uuid,text) to service_role;

-- A caller cannot bypass the reservation endpoint by using Storage directly.
-- Storage independently checks current entitlement, including trial consumption.
drop policy if exists "user_uploads_insert_own" on storage.objects;
drop policy if exists "user_uploads_update_own" on storage.objects;
drop policy if exists "Users upload own source videos" on storage.objects;
drop policy if exists "Users upload own voice refs" on storage.objects;
create policy user_uploads_insert_reserved on storage.objects for insert to authenticated
  with check (
    bucket_id='user-uploads'
    and exists(select 1 from public.upload_reservations r
      where r.user_id=(select auth.uid()) and r.object_path=name and r.expires_at>now())
    and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and (
      not p.trial_used or p.byok_enabled or exists(select 1 from public.subscriptions s
        where s.user_id=p.id and s.status='active'
          and (s.current_period_end is null or s.current_period_end>now()))
    ))
  );
update storage.buckets set file_size_limit=524288000,
  allowed_mime_types=array['video/mp4','video/quicktime','video/webm']
  where id='user-uploads';
commit;
