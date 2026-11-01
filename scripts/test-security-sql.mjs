// Disposable PostgreSQL compatibility checks. Never connects to production.
// Optionally supply --pglite-module /absolute/path/to/pglite/dist/index.js.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const moduleFlag = process.argv.indexOf('--pglite-module');
const modulePath = moduleFlag < 0 ? '@electric-sql/pglite'
  : pathToFileURL(path.resolve(process.argv[moduleFlag + 1])).href;
const { PGlite } = await import(modulePath);
const db = new PGlite();
try {
  // Model the Auth/Storage platform schemas and grants; migrations supply all
  // application tables, functions and policies under test.
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create role supabase_auth_admin;
    create schema auth; create schema storage;
    create table auth.users (id uuid primary key, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    create table storage.buckets (id text primary key, name text, public boolean,
      file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(),
      bucket_id text, name text, metadata jsonb default '{}', unique(bucket_id,name));
    create function storage.foldername(text) returns text[] language sql as
      $$select string_to_array($1, '/')$$;
    grant usage on schema public, auth, storage to anon, authenticated, service_role;
    grant all on storage.objects to service_role;
    grant select,insert,update,delete on storage.objects to authenticated;
    alter table storage.objects enable row level security;
    grant all on auth.users to supabase_auth_admin;
    grant usage on schema auth to supabase_auth_admin;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  `);
  const migrations = path.join(root, 'supabase/migrations');
  for (const file of (await fs.readdir(migrations)).filter((name) => name.endsWith('.sql')).sort()) {
    // gen_random_uuid is built into the embedded PostgreSQL version; no
    // pgcrypto extension installation is needed for these regression suites.
    const sql = (await fs.readFile(path.join(migrations, file), 'utf8'))
      .replace(/create extension if not exists "?pgcrypto"?;/gi, '');
    await db.exec(sql);
    console.log('Applied', file);
  }
  const tests = path.join(root, 'supabase/tests');
  const suites = (await fs.readdir(tests)).filter((name) => name.endsWith('.sql')).sort();
  for (const file of suites) {
    await db.exec(await fs.readFile(path.join(tests, file), 'utf8'));
    console.log('Passed', file);
  }
  console.log(`${suites.length} SQL suites passed; database discarded`);
} finally { await db.close(); }
