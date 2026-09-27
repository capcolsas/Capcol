import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { EMPLOYEE_RETIREMENT_REASONS, validateRetirementDetails, retirementReasonLabel } from '../src/assets/js/utils/employeeRetirement.js';

const db = new PGlite();
await db.exec(`
  create role authenticated; create role anon;
  create schema auth;
  create function auth.uid() returns uuid language sql as $$select 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid$$;
  create function auth.jwt() returns jsonb language sql as $$select '{"email":"test@example.com"}'::jsonb$$;
  create function public.can_read_contract_data(text) returns boolean language sql as $$select $1='A'$$;
  create function public.can_read_employee_data(uuid,text) returns boolean language sql as $$select false$$;
  create table employees(id uuid primary key default gen_random_uuid(), documento text, contrato_codigo text,
    estado text default 'activo', fecha_ingreso timestamptz, fecha_retiro timestamptz);
  insert into employees(documento,estado,fecha_ingreso,fecha_retiro) values ('legacy','inactivo','2025-01-01','2025-02-01');
`);
const migration = await fs.readFile(new URL('../supabase/schema_operations_phase55_employee_retirements.sql',import.meta.url),'utf8');
await db.exec(migration);
await db.exec(migration); // Safe to apply twice; existing retirees are untouched.
assert.equal((await db.query(`select retiro_motivo from employees where documento='legacy'`)).rows[0].retiro_motivo,null);
assert.equal(retirementReasonLabel(null),'Motivo no registrado');
assert.equal(EMPLOYEE_RETIREMENT_REASONS.length,12);
assert.throws(()=>validateRetirementDetails('', 'Comentario'));
assert.throws(()=>validateRetirementDetails('renuncia','  \n '));

const id=(await db.query(`insert into employees(documento,contrato_codigo,fecha_ingreso) values ('new','A','2026-01-01') returning id`)).rows[0].id;
const retire=(reason,observation='Observación del retiro')=>db.query(`update employees set estado='inactivo',fecha_retiro='2026-02-01',retiro_motivo=$2,retiro_observacion=$3 where id=$1`,[id,reason,observation]);
await assert.rejects(retire(null));
await assert.rejects(retire('otro'));
await assert.rejects(retire('renuncia','  '));
await assert.rejects(retire('renuncia','\n\t '));
assert.equal((await db.query('select estado from employees where id=$1',[id])).rows[0].estado,'activo');
assert.equal((await db.query('select count(*)::int n from employee_retirements')).rows[0].n,0);
await assert.rejects(db.query(`update employees set estado='inactivo',fecha_retiro='2025-01-01',retiro_motivo='renuncia',retiro_observacion='Texto' where id=$1`,[id]));
for(const reason of EMPLOYEE_RETIREMENT_REASONS){
  validateRetirementDetails(reason.value,'Observación del retiro');
  await retire(reason.value);
  await db.query(`update employees set documento=documento where id=$1`,[id]); // No duplicate on unrelated updates.
  await assert.rejects(db.query(`update employees set retiro_observacion='Sobrescrito' where id=$1`,[id]));
  await db.query(`update employees set estado='activo',fecha_retiro=null where id=$1`,[id]);
  const employee=(await db.query('select retiro_motivo,retiro_observacion from employees where id=$1',[id])).rows[0];
  assert.deepEqual(employee,{retiro_motivo:null,retiro_observacion:null});
}
const history=(await db.query('select * from employee_retirements where employee_id=$1 order by created_at',[id])).rows;
assert.equal(history.length,12);
assert.equal(history[0].motivo,'renuncia');
assert.equal(history[0].observacion,'Observación del retiro');
assert.equal(history[0].created_by_email,'test@example.com');
// Failure of history insertion must roll back the employee UPDATE.
await db.exec(`create function reject_history() returns trigger language plpgsql as $$begin raise exception 'History unavailable'; end$$;
  create trigger reject_history before insert on employee_retirements for each row execute function reject_history();`);
await assert.rejects(retire('renuncia'));
assert.equal((await db.query('select estado from employees where id=$1',[id])).rows[0].estado,'activo');
await db.exec('drop trigger reject_history on employee_retirements');
// History is readable only in the authorized contract and cannot be edited directly.
await db.exec(`update employee_retirements set contrato_codigo='B' where motivo='fallecimiento'; set role authenticated;`);
assert.equal((await db.query('select count(*)::int n from employee_retirements')).rows[0].n,11);
await assert.rejects(db.query(`delete from employee_retirements`));
await assert.rejects(db.query(`update employee_retirements set observacion='Alterada'`));
await assert.rejects(db.query(`insert into employee_retirements(employee_id,fecha_retiro,motivo,observacion) values ($1,now(),'renuncia','Inventado')`,[id]));
await db.exec('reset role');
await db.close();
console.log('Employee retirements: 12 reasons, validation, legacy compatibility, repeated cycles, atomic history and RLS passed.');
