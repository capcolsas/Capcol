// Runs supabase/reset_operation_keep_admin.sql on a database built from the release bundles:
// it must empty the operation, keep the administrative tables and fail safe on foreign keys.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { buildBundles } from '../supabase/build_release_bundles.mjs';

const STUBS = `
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth;
create table auth.users(id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb, created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true),''),'anon') $$;
create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
create schema storage;
create table storage.buckets(id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name,'/') $$;
create publication supabase_realtime;
`;

const db = new PGlite({ extensions: { pgcrypto, pg_trgm } });
await db.exec(STUBS);
for (const bundle of buildBundles().filter((b) => /^0[1-5]_/.test(b.file))) await db.exec(bundle.content);

// A little of everything: administrative rows that must survive, operation that must go.
await db.exec(`
  insert into public.zones(codigo, nombre, contrato_codigo) values('Z1','Zona 1','CON-0001');
  insert into public.sedes(codigo, nombre, zona_codigo, contrato_codigo) values('S1','Sede 1','Z1','CON-0001');
  insert into public.employees(codigo, documento, nombre, sede_codigo, contrato_codigo, estado) values('EMP-0001','1','Ana','S1','CON-0001','activo');
  insert into public.audit_logs(action, target_type) values('x','zone');
  insert into public.daily_closures(id, fecha) values('2026-10-10','2026-10-10');
`);
const count = async (table) => (await db.query(`select count(*)::int n from public.${table}`)).rows[0].n;
const migrationsBefore = await count('rocky_data_migrations');
assert.ok(migrationsBefore > 0, 'run-once registry has rows');

const script = fs.readFileSync(new URL('../supabase/reset_operation_keep_admin.sql', import.meta.url), 'utf8');
await db.exec(script);

for (const table of ['contracts', 'zones', 'sedes', 'employees']) assert.ok(await count(table) > 0, `${table} kept`);
assert.equal(await count('rocky_data_migrations'), migrationsBefore, 'run-once registry kept: bundle backfills do not run again');
for (const table of ['audit_logs', 'daily_closures', 'scheduled_shifts', 'shift_templates', 'shift_rotations', 'incapacitados', 'inventory_products', 'visit_settings', 'whatsapp_incoming']) {
  assert.equal(await count(table), 0, `${table} emptied`);
}

// Projects updated phase by phase (not with the bundles) have no rocky_data_migrations table.
await db.exec(`drop table public.rocky_data_migrations cascade;
  insert into public.audit_logs(action, target_type) values('y','zone');`);
await db.exec(script);
assert.equal(await count('audit_logs'), 0, 'works without the bundle registry');
assert.ok(await count('employees') > 0);

await db.close();
console.log('PASS: the reset empties the operation (turnos, rotaciones, auditoria, incapacidades, inventario, visitas) and keeps contracts, sedes, employees, access and the migration registry.');
