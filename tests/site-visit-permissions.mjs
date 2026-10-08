import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const db = new PGlite();
const manager = '00000000-0000-0000-0000-000000000001', viewer = '00000000-0000-0000-0000-000000000002';
const legacy = '00000000-0000-0000-0000-000000000003', none = '00000000-0000-0000-0000-000000000004';
// current_profile_has_permission mirrors production: the key's own value wins, else the legacy key's value.
await db.exec(`create role authenticated; create role anon; create schema auth; create schema storage;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create table profiles(id uuid primary key,email text,nombre text,role text,estado text,supervisor_eligible boolean,zona_codigo text,zonas_permitidas text[]);
 create table contracts(codigo text primary key,nombre text,estado text);
 create table sedes(codigo text primary key,nombre text,contrato_codigo text,zona_codigo text,estado text,qr_latitude double precision,qr_longitude double precision);
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text unique);
 create table test_perms(uid uuid,key text,value boolean);
 grant usage on schema public,auth,storage to authenticated;
 create function can_read_contract_data(text) returns boolean language sql as $$select true$$;
 create function current_profile_has_permission(p_key text,p_legacy text) returns boolean language sql security definer as $$
   select coalesce((select value from test_perms where uid=auth.uid() and key=p_key),(select value from test_perms where uid=auth.uid() and key=p_legacy),false)$$;
 create function current_supervisor_can_read_zone(text) returns boolean language sql as $$select false$$;
 insert into profiles values('${manager}','m@test','M','admin','activo',false,null,'{}'),('${viewer}','v@test','V','editor','activo',false,null,'{}'),
   ('${legacy}','l@test','L','admin','activo',false,null,'{}'),('${none}','n@test','N','editor','activo',false,null,'{}');
 insert into contracts values('A','Contrato A','activo');
 insert into sedes values('S1','Sede Norte','A','Z1','activo',4.7,-74.1);
 insert into test_perms values('${manager}','manageSiteVisits',true),('${manager}','editContracts',false),
   ('${viewer}','viewSiteVisits',true),('${viewer}','manageSiteVisits',false),('${viewer}','editContracts',true),
   ('${legacy}','editContracts',true),('${none}','editContracts',false);`);
for (const file of ['schema_operations_phase59_site_visits.sql', 'schema_operations_phase70_site_visit_permissions.sql']) {
  await db.exec(await fs.readFile(new URL(`../supabase/${file}`, import.meta.url), 'utf8'));
}
const user = id => db.query("select set_config('test.uid',$1,false)", [id]);
const count = async table => (await db.query(`select count(*)::int n from ${table}`)).rows[0].n;
const today = (await db.query("select (now() at time zone 'America/Bogota')::date::text d")).rows[0].d;
await db.exec('set role authenticated');

await user(manager);
await db.query("select visit_save_settings('A','weekly',$1,200,100)", [today]);
assert.equal(await count('visit_settings'), 1, 'manageSiteVisits reads settings');
assert.equal(await count('visit_assignments'), 1, 'manageSiteVisits reads assignments');

await user(viewer);
assert.equal(await count('visit_settings'), 1, 'viewSiteVisits reads settings');
assert.equal(await count('visit_cycles'), 1, 'viewSiteVisits reads cycles');
assert.equal(await count('visit_assignments'), 1, 'viewSiteVisits reads assignments');
await assert.rejects(db.query("select visit_save_settings('A','weekly',$1,200,100)", [today]), /Sin permiso/, 'explicit manageSiteVisits=false wins over editContracts');

await user(legacy);
assert.equal(await count('visit_assignments'), 1, 'editContracts alone keeps reading');
await db.query("select visit_save_settings('A','weekly',$1,200,100)", [today]);

await user(none);
assert.equal(await count('visit_settings'), 0);
assert.equal(await count('visit_cycles'), 0);
assert.equal(await count('visit_assignments'), 0);
await assert.rejects(db.query("select visit_save_settings('A','weekly',$1,200,100)", [today]), /Sin permiso/);

await db.close();
console.log('PASS: viewSiteVisits consults without managing, manageSiteVisits manages, editContracts keeps legacy access, no permission sees nothing.');
