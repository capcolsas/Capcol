// Verifica que los bundles de supabase/releases/ equivalgan a aplicar las fases fuente en orden,
// que se puedan re-ejecutar y que actualicen un proyecto desde cualquier version intermedia.
//   node release-bundles.mjs            corre todo (unos minutos)
//   RELEASE_QUICK=1 node release-bundles.mjs   menos puntos de partida intermedios
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { buildBundles, listSources, RELEASES_DIR } from '../supabase/build_release_bundles.mjs';

const SUPA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../supabase');
const QUICK = process.env.RELEASE_QUICK === '1';

// Objetos propios de Supabase que las fases dan por existentes.
const STUBS = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users(id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb, created_at timestamptz default now());
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true),''),'anon') $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
create schema if not exists storage;
create table if not exists storage.buckets(id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table if not exists storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name,'/') $$;
create publication supabase_realtime;
`;

async function freshDb() {
  const db = new PGlite({ extensions: { pgcrypto, pg_trgm } });
  await db.exec(STUBS);
  return db;
}

async function run(db, label, sql) {
  try { await db.exec(sql); }
  catch (error) {
    try { await db.exec('rollback'); } catch { /* nada que revertir */ }
    throw new Error(`${label}: ${error.message}${error.where ? ` | ${error.where}` : ''}`);
  }
}

// Los bundles normalizan BOM y saltos de linea; la referencia igual, para comparar solo la logica.
const readSource = (file) => fs.readFileSync(path.join(SUPA, file), 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
const bundles = buildBundles();
const numbered = bundles.filter((b) => /^0[1-5]_/.test(b.file));

async function applySources(db, upToFile) {
  for (const file of listSources()) {
    await run(db, file, readSource(file));
    if (file === upToFile) return;
  }
}
async function applyBundles(db) {
  for (const bundle of numbered) await run(db, bundle.file, bundle.content);
}

async function snapshot(db) {
  const q = async (sql) => (await db.query(sql)).rows;
  const out = [];
  const push = (kind, rows) => rows.forEach((r) => out.push(`${kind}|${Object.values(r).join('|')}`));
  push('COL', await q(`select table_name, column_name, data_type, coalesce(column_default,'') d, is_nullable from information_schema.columns where table_schema='public' order by 1,2`));
  push('IDX', await q(`select tablename, indexname, regexp_replace(indexdef,'\\s+',' ','g') from pg_indexes where schemaname='public' order by 1,2`));
  push('CON', await q(`select conrelid::regclass::text, conname, pg_get_constraintdef(oid) from pg_constraint where connamespace='public'::regnamespace order by 1,2`));
  push('FN', await q(`select p.proname||'('||pg_get_function_identity_arguments(p.oid)||')', md5(pg_get_functiondef(p.oid)) from pg_proc p where p.pronamespace='public'::regnamespace order by 1`));
  push('TRG', await q(`select tgrelid::regclass::text, tgname, md5(pg_get_triggerdef(oid)) from pg_trigger where not tgisinternal order by 1,2`));
  push('POL', await q(`select schemaname||'.'||tablename, policyname, cmd, coalesce(roles::text,''), coalesce(qual,''), coalesce(with_check,'') from pg_policies order by 1,2`));
  push('RLS', await q(`select c.oid::regclass::text, c.relrowsecurity::text, c.relforcerowsecurity::text from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' order by 1`));
  push('VIEW', await q(`select viewname, md5(definition) from pg_views where schemaname='public' order by 1`));
  push('GRT', await q(`select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated','service_role') group by 1,2 order by 1,2`));
  push('FGRT', await q(`select routine_name, grantee, privilege_type from information_schema.routine_privileges where routine_schema='public' and grantee in ('anon','authenticated','service_role') order by 1,2,3`));
  push('PUB', await q(`select schemaname||'.'||tablename from pg_publication_tables where pubname='supabase_realtime' order by 1`));
  push('BKT', await q(`select id, coalesce(public::text,''), coalesce(file_size_limit::text,'') from storage.buckets order by 1`));
  return out;
}

// Lo unico que los bundles agregan sobre las fases originales: el registro de respaldos de una vez.
const EXTRA = /rocky_data_migrations|rocky_run_once/;
function compare(label, expected, actual) {
  const a = new Set(actual), e = new Set(expected);
  const missing = expected.filter((x) => !a.has(x) && !EXTRA.test(x));
  const unexpected = actual.filter((x) => !e.has(x) && !EXTRA.test(x));
  assert.deepEqual({ missing: missing.slice(0, 8), unexpected: unexpected.slice(0, 8) }, { missing: [], unexpected: [] }, `${label}: el esquema difiere de las fases originales`);
}

let step = 0;
const ok = (msg) => console.log(`ok ${++step} - ${msg}`);

// 0) Los bundles publicados en el repositorio deben corresponder a las fuentes.
for (const bundle of bundles) {
  assert.equal(fs.readFileSync(path.join(RELEASES_DIR, bundle.file), 'utf8'), bundle.content, `${bundle.file} desactualizado: ejecuta node supabase/build_release_bundles.mjs`);
}
ok('los bundles del repositorio estan al dia');

// Referencia: aplicar las fases originales, una a una, en orden.
const reference = await freshDb();
await applySources(reference);
const expected = await snapshot(reference);
assert.ok(expected.length > 2000, 'la referencia debe tener el esquema completo');
ok(`referencia: ${listSources().length} fases originales -> ${expected.length} elementos de esquema`);

// 1) Proyecto nuevo: solo los bundles.
const fresh = await freshDb();
await applyBundles(fresh);
compare('proyecto nuevo', expected, await snapshot(fresh));
ok('proyecto nuevo: 5 bundles == fases originales');

// 2) Re-ejecucion completa sobre una base ya actualizada.
await applyBundles(fresh);
compare('re-ejecucion', expected, await snapshot(fresh));
ok('re-ejecutar los 5 bundles no falla ni cambia el esquema');

// 3) Actualizar un proyecto que quedo en CUALQUIER version intermedia: se aplica cada fase original
// y, tras cada una, se clona la base y se le aplican los bundles. Asi se prueba cada punto de partida.
const allSources = listSources();
const cuts = new Set(QUICK ? allSources.filter((_, i) => i % 8 === 0 || i === allSources.length - 2) : allSources.slice(0, -1));
const walker = await freshDb();
let tested = 0;
for (const file of allSources) {
  await run(walker, file, readSource(file));
  if (!cuts.has(file)) continue;
  const clone = new PGlite({ loadDataDir: await walker.dumpDataDir('gzip'), extensions: { pgcrypto, pg_trgm } });
  await clone.waitReady;
  await applyBundles(clone);
  compare(`actualizar desde ${file}`, expected, await snapshot(clone));
  await clone.close();
  tested += 1;
}
ok(`proyecto existente en cada una de las ${tested} versiones intermedias probadas -> bundles == version actual`);

// 4) Un proyecto en produccion no debe perder ni recuperar datos al aplicar los bundles.
const live = await freshDb();
await applySources(live);
await live.exec(`
  insert into public.contracts(codigo, nombre, cliente_nombre, estado) values ('CT-A','Contrato A','Cliente A','activo'),('CT-B','Contrato B','Cliente B','activo');
  delete from public.contracts where codigo = 'CON-0001';
  update public.roles_matrix set permissions = '{"custom": true}'::jsonb where role = 'admin';
`);
const before = {
  contracts: (await live.query(`select codigo from public.contracts order by 1`)).rows.map((r) => r.codigo),
  admin: (await live.query(`select permissions from public.roles_matrix where role='admin'`)).rows[0].permissions
};
await applyBundles(live);
await applyBundles(live);
const after = {
  contracts: (await live.query(`select codigo from public.contracts order by 1`)).rows.map((r) => r.codigo),
  admin: (await live.query(`select permissions from public.roles_matrix where role='admin'`)).rows[0].permissions
};
assert.deepEqual(after, before, 'los bundles no deben resucitar el contrato inicial ni pisar permisos personalizados');
assert.deepEqual((await live.query(`select id from public.rocky_data_migrations order by 1`)).rows.map((r) => r.id).includes('contracts_initial_seed'), true);
ok('proyecto en produccion: contratos y permisos intactos tras aplicar los bundles dos veces');

// 5) Primera vez que se aplica el bundle sobre un proyecto ya poblado: no repite respaldos de datos.
const populated = await freshDb();
await applySources(populated);
await populated.exec(`
  insert into public.contracts(codigo, nombre, cliente_nombre, estado) values ('CT-A','Contrato A','Cliente A','activo');
  insert into public.cargos(codigo, nombre, estado) values ('CG1','Cargo 1','activo'),('CG2','Cargo 2','activo');
  insert into public.contract_cargos(contrato_codigo, cargo_codigo, salario, estado) values ('CT-A','CG1',1,'activo'),('CT-A','CG2',2,'activo');
  delete from public.contract_cargos where cargo_codigo = 'CG2';
  insert into public.sedes(codigo, nombre, contrato_codigo, qr_radius_meters) values ('SD1','Sede 1','CT-A',500);
`);
await applyBundles(populated);
assert.equal((await populated.query(`select count(*)::int n from public.contract_cargos where cargo_codigo='CG2'`)).rows[0].n, 0, 'no debe reaparecer una asignacion cargo-contrato eliminada');
assert.equal((await populated.query(`select qr_radius_meters from public.sedes where codigo='SD1'`)).rows[0].qr_radius_meters, 500, 'un radio QR de 500 m configurado a proposito no debe volver a 200');
ok('proyecto poblado: sin respaldos repetidos (cargos por contrato y radio QR conservados)');

console.log(`\n${step} verificaciones correctas`);
