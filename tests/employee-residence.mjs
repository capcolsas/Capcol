import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const db = new PGlite();
await db.exec(`create table employees(id uuid primary key default gen_random_uuid(), documento text);
  insert into employees(documento) values('1');`);
const phase = await fs.readFile(new URL('../supabase/schema_operations_phase74_employee_residence_emergency.sql', import.meta.url), 'utf8');
await db.exec(phase);
await db.exec(phase); // bundles re-run every phase

const update = (set) => db.query(`update employees set ${set} where documento='1'`);
await update(`direccion_residencia='Calle 10 # 20-30', barrio_residencia='Centro', municipio_residencia='Medellin',
  residencia_latitud=6.244203, residencia_longitud=-75.581212, restricciones_medicas='No levantar mas de 10 kg',
  contacto_emergencia_nombre='Maria Perez', contacto_emergencia_parentesco='Madre', contacto_emergencia_telefono='573001112233'`);
const row = (await db.query("select * from employees where documento='1'")).rows[0];
assert.equal(row.municipio_residencia, 'Medellin');
assert.equal(row.residencia_latitud, 6.244203);
assert.equal(row.contacto_emergencia_parentesco, 'Madre');

await assert.rejects(update('residencia_longitud=null'), /employees_residencia_ubicacion_check/, 'one coordinate alone is rejected');
await assert.rejects(update('residencia_latitud=95'), /employees_residencia_ubicacion_check/, 'latitude out of range');
await assert.rejects(update('residencia_longitud=-190'), /employees_residencia_ubicacion_check/, 'longitude out of range');
await update('residencia_latitud=null, residencia_longitud=null');
assert.equal((await db.query("select residencia_latitud from employees where documento='1'")).rows[0].residencia_latitud, null, 'both cleared is valid');

await db.close();
console.log('PASS: employee residence, medical restrictions and emergency contact columns; location is both coordinates within range or none; phase re-runnable.');
