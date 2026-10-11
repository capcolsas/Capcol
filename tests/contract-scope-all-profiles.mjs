import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const db = new PGlite();
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const SUPER = id(1), ADMIN_OLD = id(2), ADMIN_A = id(3), EDITOR_LEGACY = id(4), CONSULTOR_A = id(5), SUPERVISOR = id(6), EMPLEADO = id(7);

// Minimal tables and the pre-phase-71 helpers the migration builds on. The *_write_admin FOR ALL
// policies and the schema_initial profile/audit policies reproduce the bug: admins read everything.
await db.exec(`create role authenticated; create role anon; create role service_role; create schema auth;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create table profiles(id uuid primary key,email text,role text,estado text default 'activo',supervisor_eligible boolean default false,
   zona_codigo text,zonas_permitidas text[] default '{}',contrato_codigo text,contratos_permitidos text[] not null default '{}',
   created_by_uid uuid,created_by_email text,last_modified_by_uid uuid,last_modified_by_email text,deleted_at timestamptz,
   deleted_by_uid uuid,deleted_by_email text,updated_at timestamptz);
 create table contracts(id uuid primary key default gen_random_uuid(),codigo text unique not null,nombre text,estado text default 'activo',
   created_by_uid uuid,created_by_email text,created_at timestamptz not null default now(),updated_at timestamptz);
 create table profile_contract_access(user_id uuid not null references profiles(id),contrato_codigo text not null references contracts(codigo) on update cascade,
   estado text not null default 'activo',created_by_uid uuid,created_by_email text,created_at timestamptz default now(),updated_at timestamptz default now(),
   primary key(user_id,contrato_codigo));
 create table zones(codigo text primary key,contrato_codigo text,id uuid default gen_random_uuid());
 create table dependencies(codigo text primary key,contrato_codigo text,id uuid default gen_random_uuid());
 create table sedes(codigo text primary key,zona_codigo text,contrato_codigo text,id uuid default gen_random_uuid());
 create table employees(id uuid primary key default gen_random_uuid(),documento text,zona_codigo text,sede_codigo text,contrato_codigo text);
 create table attendance(id serial,contrato_codigo text,sede_codigo text,empleado_id uuid,documento text);
 create table absenteeism(id serial,contrato_codigo text,sede_codigo text,empleado_id uuid,documento text);
 create table import_replacements(id serial,contrato_codigo text,sede_codigo text,empleado_id uuid,documento text);
 create table sede_status(id serial,contrato_codigo text,sede_codigo text);
 create table employee_cargo_history(id serial,contrato_codigo text,employee_id uuid,documento text);
 create table daily_sede_closures(id serial,contrato_codigo text,zona_codigo text,sede_codigo text);
 create table employee_daily_status(id serial,contrato_codigo text,zona_codigo_snapshot text,sede_codigo text);
 create table daily_contract_metrics(fecha text,contrato_codigo text,planeados int default 0,contratados int default 0,asistencias int default 0,
   ausentismos int default 0,pagados int default 0,no_contratados int default 0,faltan int default 0,sobran int default 0);
 create table incapacitados(id serial,employee_id uuid,documento text);
 create table import_history(id serial,confirmado_por_uid uuid); create table daily_metrics(id serial);
 create table daily_closures(id text primary key,fecha text,status text default 'closed',locked boolean default true,closed_by_uid uuid,closed_by_email text,
   closed_at timestamptz default now(),created_at timestamptz default now(),updated_at timestamptz default now(),asistencias int default 0);
 create table audit_logs(id uuid primary key default gen_random_uuid(),actor_uid uuid,actor_email text,target_type text,target_id text,action text,
   before_data jsonb,after_data jsonb,note text,created_at timestamptz default now());
 do $$ declare t text; begin
   foreach t in array array['profiles','contracts','profile_contract_access','zones','dependencies','sedes','employees','attendance','absenteeism',
     'import_replacements','sede_status','employee_cargo_history','daily_sede_closures','employee_daily_status','daily_contract_metrics',
     'incapacitados','import_history','daily_metrics','daily_closures','audit_logs'] loop
     execute format('alter table %I enable row level security', t);
     execute format('grant select,insert,update,delete on %I to authenticated', t);
   end loop;
 end $$;
 grant usage on schema auth to authenticated; grant usage, select on all sequences in schema public to authenticated;
 create function set_updated_at() returns trigger language plpgsql as $$begin new.updated_at=now(); return new; end$$;
 create function is_superadmin() returns boolean language sql stable security definer as $$
   select exists(select 1 from profiles where id=auth.uid() and role='superadmin' and estado='activo')$$;
 create function is_admin_like() returns boolean language sql stable security definer as $$
   select exists(select 1 from profiles where id=auth.uid() and role in('superadmin','admin') and estado='activo')$$;
 create function is_active_authenticated_user() returns boolean language sql stable security definer as $$
   select exists(select 1 from profiles where id=auth.uid() and estado='activo')$$;
 create function current_profile_has_permission(text,text default null) returns boolean language sql stable as $$select false$$;
 create function current_supervisor_can_read_zone(zone_code text) returns boolean language sql stable security definer as $$
   select exists(select 1 from profiles p where p.id=auth.uid() and p.role='supervisor' and p.supervisor_eligible
     and (zone_code=p.zona_codigo or zone_code=any(p.zonas_permitidas)))$$;
 create function can_read_shift_contract_data(text,uuid,text,uuid,text) returns boolean language sql stable as $$select false$$;
 create function search_active_sedes(text,integer) returns setof sedes language sql stable security definer as $$select * from sedes$$;
 create function find_employee_candidates_by_phone(text,integer) returns setof employees language sql stable security definer as $$select * from employees$$;
 do $$ declare t text; begin
   foreach t in array array['contracts','zones','sedes','dependencies','daily_metrics','daily_closures','import_history'] loop
     execute format('create policy %I on %I for all to authenticated using (is_admin_like()) with check (is_admin_like())', t || '_write_admin', t);
   end loop;
 end $$;
 create policy profiles_insert_self_or_admin on profiles for insert to authenticated with check (true);
 create policy profiles_select_self_or_admin on profiles for select to authenticated using (auth.uid()=id or is_admin_like());
 create policy profiles_update_self_or_admin on profiles for update to authenticated using (auth.uid()=id or is_admin_like()) with check (auth.uid()=id or is_admin_like());
 create policy audit_logs_read_admin_like on audit_logs for select to authenticated using (is_admin_like());
 insert into profiles(id,email,role,supervisor_eligible,zona_codigo) values
   ('${SUPER}','super@t','superadmin',false,null),('${ADMIN_OLD}','old@t','admin',false,null),('${ADMIN_A}','a@t','admin',false,null),
   ('${EDITOR_LEGACY}','ed@t','editor',false,null),('${CONSULTOR_A}','co@t','consultor',false,null),
   ('${SUPERVISOR}','sup@t','supervisor',true,'ZA'),('${EMPLEADO}','emp@t','empleado',false,null);
 insert into contracts(codigo,nombre) values('A','Contrato A'),('B','Contrato B');
 insert into zones values('ZA','A'),('ZB','B');
 insert into sedes values('SA','ZA','A'),('SB','ZB','B');
 insert into employees(documento,zona_codigo,sede_codigo,contrato_codigo) values('1','ZA','SA','A'),('2','ZB','SB','B');
 insert into attendance(contrato_codigo,sede_codigo,documento) values('A','SA','1'),('B','SB','2');
 insert into daily_closures(id,fecha,asistencias) values('2026-10-10','2026-10-10',30);
 insert into daily_contract_metrics(fecha,contrato_codigo,asistencias) values('2026-10-10','A',10),('2026-10-10','B',20);
 insert into daily_metrics default values; insert into import_history(confirmado_por_uid) values('${SUPER}');
 insert into audit_logs(actor_uid,target_type,target_id,action) values('${ADMIN_OLD}','zone','ZB','legacy_entry');`);

const load = async (file) => db.exec(await fs.readFile(new URL(`../supabase/${file}`, import.meta.url), 'utf8'));
await load('schema_operations_phase42_contract_profile_permissions.sql');

// State before phase 71: assignments the old model ignored for admins, plus a legacy profile column.
await db.exec(`insert into profile_contract_access(user_id,contrato_codigo) values('${ADMIN_A}','A'),('${CONSULTOR_A}','A');
 update profiles set contratos_permitidos='{B}' where id='${EDITOR_LEGACY}';`);

const user = (uid) => db.query("select set_config('test.uid',$1,false)", [uid]);
const rows = async (sql) => (await db.query(sql)).rows;
const codes = async (table, col = 'codigo') => (await rows(`select ${col} c from ${table} order by 1`)).map((r) => r.c).join(',');
const count = async (table) => (await rows(`select count(*)::int n from ${table}`))[0].n;

await db.exec('set role authenticated');
await user(ADMIN_A);
assert.equal(await codes('contracts'), 'A,B', 'bug reproduced: before phase 71 the FOR ALL policy lets an admin read every contract');
assert.equal(await count('profiles'), 7, 'bug reproduced: an admin reads every user');
await db.exec('reset role');

await load('schema_operations_phase71_contract_scope_all_profiles.sql');
const assigned = async (uid) => (await rows(`select contrato_codigo c from profile_contract_access where user_id='${uid}' order by 1`)).map((r) => r.c).join(',');
assert.equal(await assigned(ADMIN_OLD), 'A,B', 'admin without assignments gets every contract explicitly');
assert.equal(await assigned(ADMIN_A), 'A', 'existing assignments are kept as they are');
assert.equal(await assigned(EDITOR_LEGACY), 'B', 'legacy profile column becomes a real assignment');
assert.equal(await assigned(CONSULTOR_A), 'A');
assert.equal(await assigned(SUPERVISOR), 'A', 'supervisor gets the contracts of its zones');
assert.equal(await assigned(EMPLEADO), '', 'empleado gets nothing');
assert.deepEqual((await rows(`select contratos_permitidos c from profiles where id='${ADMIN_OLD}'`))[0].c, ['A', 'B'], 'profile cache synced');

await db.exec('set role authenticated');
const scope = async (uid) => {
  await user(uid);
  return [await codes('contracts'), await codes('zones'), await codes('sedes'), await codes('employees', 'documento'), await codes('attendance', 'contrato_codigo')].join(' | ');
};
assert.equal(await scope(SUPER), 'A,B | ZA,ZB | SA,SB | 1,2 | A,B', 'superadmin sees every contract');
assert.equal(await scope(ADMIN_OLD), 'A,B | ZA,ZB | SA,SB | 1,2 | A,B');
assert.equal(await scope(ADMIN_A), 'A | ZA | SA | 1 | A', 'admin limited to its contract');
assert.equal(await scope(EDITOR_LEGACY), 'B | ZB | SB | 2 | B', 'editor limited to its contract');
assert.equal(await scope(CONSULTOR_A), 'A | ZA | SA | 1 | A');
assert.equal(await scope(SUPERVISOR), 'A | ZA | SA | 1 | A', 'supervisor: its zone inside its contract');
assert.equal(await scope(EMPLEADO), ' |  |  |  | ');

// A contract outside the supervisor's assignments hides its zone even if the zone is still listed.
await db.exec(`reset role; update profiles set zonas_permitidas='{ZB}' where id='${SUPERVISOR}'; set role authenticated`);
assert.equal(await scope(SUPERVISOR), 'A | ZA | SA | 1 | A', 'zone of an unassigned contract stays hidden');

// Writes stay inside the admin's contracts.
await user(ADMIN_A);
await db.query("insert into zones values('ZA2','A')");
await assert.rejects(db.query("insert into zones values('ZB2','B')"), /row-level security/, 'cannot create data in another contract');
assert.equal((await db.query("update zones set contrato_codigo='A' where codigo='ZB'")).affectedRows, 0, 'cannot touch rows of another contract');
await assert.rejects(db.query(`insert into profile_contract_access(user_id,contrato_codigo) values('${ADMIN_A}','B')`), /row-level security/, 'cannot grant itself another contract');
await db.query(`insert into profile_contract_access(user_id,contrato_codigo) values('${EMPLEADO}','A')`);
assert.equal(await codes('profile_contract_access', "user_id::text||':'||contrato_codigo"), [`${ADMIN_A}:A`, `${CONSULTOR_A}:A`, `${EMPLEADO}:A`, `${SUPERVISOR}:A`, `${ADMIN_OLD}:A`].sort().join(','), 'admin only sees assignments of its contracts');

// The creator of a contract keeps seeing it.
const created = await db.query("insert into contracts(codigo,nombre,created_by_uid) values('C','Contrato C',auth.uid()) returning codigo");
assert.equal(created.rows[0].codigo, 'C', 'creator reads the inserted row');
assert.equal(await codes('contracts'), 'A,C', 'creator is assigned to the new contract');
await assert.rejects(db.query(`update profiles set contratos_permitidos='{A,B,C}' where id='${ADMIN_A}'`), /propio perfil/, 'own contract cache only mirrors the assignments');

// Users: an admin sees itself, users sharing one of its contracts and unassigned users; never superadmins.
const visibleUsers = async () => (await rows('select email e from profiles order by 1')).map((r) => r.e).join(',');
assert.equal(await visibleUsers(), 'a@t,co@t,emp@t,old@t,sup@t', 'admin A does not see the editor of contract B nor the superadmin');
assert.equal((await db.query(`update profiles set estado='inactivo' where id='${EDITOR_LEGACY}'`)).affectedRows, 0, 'cannot edit users of other contracts');
await assert.rejects(db.query(`update profiles set role='superadmin' where id='${CONSULTOR_A}'`), /SuperAdmin/, 'admin cannot grant superadmin');
await db.query(`update profiles set role='editor' where id='${CONSULTOR_A}'`);
await assert.rejects(db.query(`insert into profile_contract_access(user_id,contrato_codigo) values('${EDITOR_LEGACY}','A')`), /row-level security/, 'cannot assign contracts to users it cannot manage');

// Audit: entries of its contracts and its users; nobody writes in someone else's name or contract.
await db.query("insert into audit_logs(actor_uid,target_type,action,contrato_codigo) values(auth.uid(),'zone','create_zone','A')");
await assert.rejects(db.query("insert into audit_logs(actor_uid,action,contrato_codigo) values(auth.uid(),'x','B')"), /row-level security/);
await assert.rejects(db.query(`insert into audit_logs(actor_uid,action) values('${SUPER}','x')`), /row-level security/);
await db.exec(`reset role; insert into audit_logs(actor_uid,target_type,target_id,action,contrato_codigo) values
  ('${ADMIN_OLD}','zone','ZB','b_entry','B'),('${ADMIN_OLD}','user','${CONSULTOR_A}','user_entry',null),('${ADMIN_OLD}','role','admin','role_entry',null);
  set role authenticated`);
assert.equal(await codes('audit_logs', 'action'), 'create_zone,user_entry', 'admin A reads its contract and its users, not B nor legacy/role entries');

// Day closures: status for everyone, totals only over the user's contracts.
assert.deepEqual(await rows('select fecha, asistencias from daily_closures_scoped'), [{ fecha: '2026-10-10', asistencias: 10 }]);
assert.equal(await count('daily_closures'), 0, 'raw company-wide closures are superadmin only');
assert.equal(await count('daily_metrics'), 0, 'company-wide metrics are superadmin only');
assert.equal(await count('import_history'), 0, 'only own import confirmations');
await assert.rejects(db.query("select * from search_active_sedes('',10)"), /permission denied/, 'WhatsApp search RPCs are backend only');
await assert.rejects(db.query("select * from find_employee_candidates_by_phone('',10)"), /permission denied/);

await user(SUPER);
assert.deepEqual(await rows('select asistencias from daily_closures_scoped'), [{ asistencias: 30 }], 'superadmin totals cover every contract');
assert.equal(await codes('audit_logs', 'action'), 'b_entry,create_zone,legacy_entry,role_entry,user_entry');
assert.equal(await count('daily_metrics'), 1);

await user(EDITOR_LEGACY);
assert.equal(await codes('audit_logs', 'action'), '', 'without admin role or viewAudit only its own entries');
assert.equal(await visibleUsers(), 'ed@t', 'without viewUsers only itself');

// Phase 73: the audit entry takes the contract of its target, legacy entries included.
await db.exec('reset role');
await load('schema_operations_phase73_audit_contract_scope.sql');
await db.exec(`insert into audit_logs(actor_uid,actor_email,target_type,target_id,action) values
  (null,'cron@system','employee','1','backend_employee_a'),
  (null,'cron@system','shift_closure','x','closure_without_table');
  insert into audit_logs(actor_uid,target_type,target_id,action,contrato_codigo) values('${ADMIN_OLD}','zone','ZA','zone_a_tagged_b','B');
  set role authenticated`);
const contractOf = async (action) => (await db.query('select contrato_codigo c from audit_logs where action=$1', [action])).rows[0]?.c ?? null;
await user(SUPER);
assert.equal(await contractOf('legacy_entry'), 'B', 'legacy entry backfilled from its zone');
assert.equal(await contractOf('backend_employee_a'), 'A', 'backend entry takes the contract of its employee');
assert.equal(await contractOf('zone_a_tagged_b'), 'A', 'the target wins over the contract selected in the app');
assert.equal(await contractOf('closure_without_table'), null, 'unknown targets stay company-wide');
assert.equal(await contractOf('user_entry'), null);

await user(ADMIN_A);
assert.equal(await codes('audit_logs', 'action'), 'backend_employee_a,create_zone,user_entry,zone_a_tagged_b', 'admin A: its contract and its users only');
await db.query("insert into audit_logs(actor_uid,target_type,target_id,action,contrato_codigo) values(auth.uid(),'user',$1,'role_change','A')", [EMPLEADO]);
assert.equal(await contractOf('role_change'), null, 'user entries never carry the selected contract');

await user(ADMIN_OLD);
assert.equal((await codes('audit_logs', 'action')).includes('legacy_entry'), true, 'admin of B reads the B entries');

// Losing a contract hides its entries, even one's own.
await db.exec(`reset role; delete from profile_contract_access where user_id='${ADMIN_A}' and contrato_codigo='A'; set role authenticated`);
await user(ADMIN_A);
assert.equal((await codes('audit_logs', 'action')).includes('create_zone'), false, 'own entry of a contract no longer managed');

await db.close();
console.log('PASS: only superadmin sees every contract; the other profiles stay inside their assigned contracts for data, users, audit and day totals; audit entries take their target contract; only superadmin grants superadmin; backend RPCs closed.');
