import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const db = new PGlite();
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const SUPER = id(1), ADMIN = id(2), USER = id(3), OTHER = id(4);

// Profiles, roles matrix and overrides as in schema_initial; default_role_has_permission as in phase 40.
await db.exec(`create role authenticated; create schema auth;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create type app_role as enum ('superadmin','admin','editor','consultor','supervisor','tablet_qr','empleado');
 create table profiles(id uuid primary key,email text,role app_role not null default 'empleado',estado text not null default 'activo',
   supervisor_eligible boolean not null default false);
 create table roles_matrix(role app_role primary key,permissions jsonb not null default '{}');
 create table user_overrides(user_id uuid primary key,permissions jsonb not null default '{}');
 alter table profiles enable row level security;
 grant usage on schema auth to authenticated; grant select,insert,update,delete on profiles to authenticated;
 create policy profiles_all on profiles for all to authenticated using (true) with check (true);
 create function set_updated_at() returns trigger language plpgsql as $$begin new.updated_at=now(); return new; end$$;
 create function is_superadmin() returns boolean language sql stable security definer as $$
   select exists(select 1 from profiles where id=auth.uid() and role='superadmin' and estado='activo')$$;
 create function is_admin_like() returns boolean language sql stable security definer as $$
   select exists(select 1 from profiles where id=auth.uid() and role in('superadmin','admin') and estado='activo')$$;
 create function default_role_has_permission(role_value text, permission_key text) returns boolean language sql stable as $$
   select case when role_value='consultor' then permission_key = any(array['viewContracts','viewSedes','viewEmployees','viewReports'])
               when role_value='admin' then permission_key = any(array['viewUsers','editUsers','viewSedes']) else false end$$;
 insert into profiles(id,email,role) values('${SUPER}','s@t','superadmin'),('${ADMIN}','a@t','admin'),('${USER}','u@t','empleado'),('${OTHER}','o@t','consultor');`);

await db.exec(await fs.readFile(new URL('../supabase/schema_operations_phase72_access_profiles.sql', import.meta.url), 'utf8'));
await db.exec('grant select,insert,update,delete on access_profiles to authenticated; set role authenticated');

const user = (uid) => db.query("select set_config('test.uid',$1,false)", [uid]);
const can = async (key) => (await db.query('select current_profile_has_permission($1) v', [key])).rows[0].v;
const roleOf = async (uid) => (await db.query('select role::text r, access_profile_id p from profiles where id=$1', [uid])).rows[0];

// Only a superadmin defines profiles.
await user(ADMIN);
await assert.rejects(db.query("insert into access_profiles(nombre,base_role) values('Hack','admin')"), /row-level security/);
await user(SUPER);
const profile = (await db.query(`insert into access_profiles(nombre,base_role,permissions)
  values('Coordinador turnos','consultor','{"viewSedes":true,"viewEmployees":false,"viewShiftReview":true}') returning id`)).rows[0].id;
await assert.rejects(db.query("insert into access_profiles(nombre,base_role) values(' coordinador TURNOS ','consultor')"), /duplicate/, 'names are unique ignoring case');
await assert.rejects(db.query("insert into access_profiles(nombre,base_role) values('Root','superadmin')"), /check/, 'superadmin is not a base role');

// Assigning a profile sets the user's role to the base role.
await user(ADMIN);
await db.query('update profiles set access_profile_id=$1 where id=$2', [profile, USER]);
assert.deepEqual(await roleOf(USER), { r: 'consultor', p: profile });

await user(USER);
assert.equal(await can('viewShiftReview'), true, 'module granted by the profile');
assert.equal(await can('viewEmployees'), false, 'the profile can remove a module of its base role');
assert.equal(await can('viewReports'), true, 'keys the profile does not define fall back to the base role');
assert.equal((await db.query('select count(*)::int n from access_profiles')).rows[0].n, 1, 'reads its own profile');
await assert.rejects(db.query('update profiles set access_profile_id=null where id=$1', [USER]), /propio usuario/, 'cannot change its own profile');

await user(OTHER);
assert.equal((await db.query('select count(*)::int n from access_profiles')).rows[0].n, 0, 'other users do not read the catalog');

// User overrides still win over the profile.
await db.exec(`reset role; insert into user_overrides values('${USER}','{"viewShiftReview":false}'); set role authenticated`);
await user(USER);
assert.equal(await can('viewShiftReview'), false);
await db.exec(`reset role; delete from user_overrides; set role authenticated`);

// An inactive profile no longer grants anything: the base role applies.
await user(SUPER);
await db.query("update access_profiles set estado='inactivo' where id=$1", [profile]);
await user(USER);
assert.equal(await can('viewShiftReview'), false);
assert.equal(await can('viewEmployees'), true);
await user(ADMIN);
await assert.rejects(db.query('update profiles set access_profile_id=$1 where id=$2', [profile, OTHER]), /inactivo/, 'inactive profiles cannot be assigned');
await user(SUPER);
await db.query("update access_profiles set estado='activo' where id=$1", [profile]);

// The base role is fixed while users hold the profile.
await assert.rejects(db.query("update access_profiles set base_role='admin' where id=$1", [profile]), /rol base/);

// Choosing a system role directly leaves the profile.
await user(ADMIN);
await db.query("update profiles set role='editor' where id=$1", [USER]);
assert.deepEqual(await roleOf(USER), { r: 'editor', p: null });
await user(SUPER);
await db.query("update access_profiles set base_role='admin' where id=$1", [profile]);

await db.close();
console.log('PASS: superadmin-only profile catalog, base role sync, profile > role resolution with overrides on top, inactive fallback, self-protection and detach on direct role change.');
