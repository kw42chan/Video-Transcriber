-- Sidecar dubbing workspace schema. Run with: supabase db push
create extension if not exists pgcrypto;

create type public.project_status as enum ('draft', 'in_progress', 'complete', 'archived');
create type public.stage_status as enum ('waiting', 'ready', 'running', 'complete', 'failed', 'skipped');

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  trial_used boolean not null default false,
  byok_enabled boolean not null default false,
  encrypted_byok_keys jsonb,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles add column if not exists trial_used boolean not null default false;
alter table public.profiles add column if not exists byok_enabled boolean not null default false;
alter table public.profiles add column if not exists encrypted_byok_keys jsonb;
alter table public.profiles add column if not exists display_name text;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  status public.project_status not null default 'draft',
  current_stage text not null default 'source_video',
  source_path text,
  source_filename text,
  source_bytes bigint check (source_bytes is null or source_bytes >= 0),
  source_duration_seconds numeric(10,3),
  source_language text not null default 'en',
  target_language text not null default 'yue-HK',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_owner_updated_idx on public.projects(owner_id, updated_at desc);

create table public.project_stages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  stage_key text not null check (stage_key in ('transcription', 'translation', 'voice_generation', 'alignment', 'lip_sync', 'review')),
  status public.stage_status not null default 'waiting',
  provider text,
  input_path text,
  output_path text,
  details jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, stage_key)
);
create index project_stages_project_idx on public.project_stages(project_id, created_at);

create table public.voice_references (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  storage_path text not null,
  filename text not null,
  duration_seconds numeric(8,3),
  consent_confirmed boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.project_outputs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  output_kind text not null check (output_kind in ('transcript', 'translation', 'voice_audio', 'dubbed_video', 'lip_synced_video', 'qa_report')),
  storage_path text not null,
  filename text not null,
  content_type text,
  bytes bigint check (bytes is null or bytes >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger projects_set_updated_at before update on public.projects
for each row execute function public.set_updated_at();
create trigger project_stages_set_updated_at before update on public.project_stages
for each row execute function public.set_updated_at();
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

create or replace function public.create_default_project_stages()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.project_stages (project_id, stage_key) values
    (new.id, 'transcription'), (new.id, 'translation'), (new.id, 'voice_generation'),
    (new.id, 'alignment'), (new.id, 'lip_sync'), (new.id, 'review');
  return new;
end;
$$;
create trigger on_project_created after insert on public.projects
for each row execute function public.create_default_project_stages();

create or replace function public.create_profile_for_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (new.id, new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'avatar_url')
  on conflict (id) do update set
    display_name = excluded.display_name,
    avatar_url = excluded.avatar_url,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.create_profile_for_auth_user();
create trigger on_auth_user_metadata_updated after update of raw_user_meta_data on auth.users
for each row execute function public.create_profile_for_auth_user();

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_stages enable row level security;
alter table public.voice_references enable row level security;
alter table public.project_outputs enable row level security;

create policy "Users read own profile" on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "Users update own profile" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "Users manage own projects" on public.projects for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "Users manage stages of own projects" on public.project_stages for all to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));
create policy "Users manage own voice references" on public.voice_references for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "Users read outputs of own projects" on public.project_outputs for select to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('source-videos', 'source-videos', false, 1073741824, array['video/mp4','video/quicktime','video/webm']),
  ('voice-references', 'voice-references', false, 52428800, array['audio/wav','audio/mpeg','audio/mp4','audio/webm','audio/ogg','audio/flac']),
  ('project-outputs', 'project-outputs', false, 2147483648, array['video/mp4','audio/mpeg','audio/wav','text/plain','application/json'])
on conflict (id) do update set public = false;

create policy "Users upload own source videos" on storage.objects for insert to authenticated
  with check (bucket_id = 'source-videos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users read own source videos" on storage.objects for select to authenticated
  using (bucket_id = 'source-videos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users delete own source videos" on storage.objects for delete to authenticated
  using (bucket_id = 'source-videos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users upload own voice refs" on storage.objects for insert to authenticated
  with check (bucket_id = 'voice-references' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users read own voice refs" on storage.objects for select to authenticated
  using (bucket_id = 'voice-references' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users delete own voice refs" on storage.objects for delete to authenticated
  using (bucket_id = 'voice-references' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users read own project outputs" on storage.objects for select to authenticated
  using (bucket_id = 'project-outputs' and (storage.foldername(name))[1] = (select auth.uid())::text);
