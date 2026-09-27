import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { PGlite } from '@electric-sql/pglite';
import { shiftPlanCapacity, validateShiftPlanCapacity } from '../src/assets/js/utils/shiftPlanCapacity.js';

const site={codigo:'S',nombre:'Sede',numeroOperarios:10};
const active=[{id:'1',templateId:'A',sedeCodigo:'S',estado:'activo',operariosPlaneados:6},
  {id:'2',templateId:'B',sedeCodigo:'S',estado:'activo',operariosPlaneados:4},
  {templateId:'C',sedeCodigo:'S',estado:'inactivo',operariosPlaneados:50},
  {templateId:'D',sedeCodigo:'OTHER',estado:'activo',operariosPlaneados:50}];
assert.deepEqual(shiftPlanCapacity(site,active,'B'),{planned:10,allocated:6,available:4});
assert.doesNotThrow(()=>validateShiftPlanCapacity(site,active,'B',4));
assert.throws(()=>validateShiftPlanCapacity(site,active,'B',5),/Disponible para este plan: 4/);
assert.throws(()=>validateShiftPlanCapacity(site,active,'C',1));
for(const value of [-1,1.5,NaN,Infinity]) assert.throws(()=>validateShiftPlanCapacity(site,[],'A',value));
assert.throws(()=>validateShiftPlanCapacity({codigo:'S'},[],'A',1));

const component=await fs.readFile(new URL('../src/assets/js/components/ShiftsAdmin.js',import.meta.url),'utf8');
const input={value:'4'}, check={checked:true}, label={textContent:''}, selection={value:'B'};
const row={getAttribute:()=> 'S',querySelector:selector=>({
  '[data-sede-operarios]':input,'[data-sede-check]':check,'[data-sede-capacity]':label
})[selector]};
const context=vm.createContext({shiftPlanCapacity,activeSedes:[site],activeBySede:new Map([['S',active.filter(a=>a.sedeCodigo==='S' && a.estado==='activo')]]),
  body:{querySelector:()=>selection,querySelectorAll:()=>[row]}});
const begin=component.indexOf('      function refreshAvailableEmployees()');
const finish=component.indexOf('      function applyPlanSelection()',begin);
vm.runInContext(component.slice(begin,finish),context);
context.refreshAvailableEmployees(); assert.equal(label.textContent,'Disponibles: 0');
input.value='2'; context.refreshAvailableEmployees(); assert.equal(label.textContent,'Disponibles: 2');
input.value='3'; context.refreshAvailableEmployees(); assert.equal(label.textContent,'Disponibles: 1');
assert.equal(input.max,'4','remaining count must not reduce the input limit');
input.value='5'; context.refreshAvailableEmployees(); assert.equal(label.textContent,'Disponibles: 0 · Excede por 1');
check.checked=false; context.refreshAvailableEmployees(); assert.equal(label.textContent,'Disponibles: 0','existing plans remain reserved when unchecked');
selection.value='NEW'; context.refreshAvailableEmployees(); assert.equal(label.textContent,'Disponibles: 0');
selection.value='A'; check.checked=true; input.value='1'; context.refreshAvailableEmployees(); assert.equal(label.textContent,'Disponibles: 5');

const db=new PGlite();
try{
  await db.exec(`
    create table sedes(codigo text primary key,nombre text,numero_operarios integer);
    create table shift_site_plan_assignments(id text primary key,template_id text,sede_codigo text,estado text,operarios_planeados integer check(operarios_planeados>=0));
    create table scheduled_shifts(id text primary key,template_id text,sede_codigo text,estado text,operarios_planeados integer);
    insert into sedes values ('S','Sede',10),('OTHER','Otra',10),('ZERO','Sin planeados',null);
  `);
  const migration=await fs.readFile(new URL('../supabase/schema_operations_phase53_shift_planned_capacity.sql',import.meta.url),'utf8');
  await db.exec(migration);
  await db.exec(migration);
  const activate=(id,plan,count,state='activo',site='S')=>db.query(
    'insert into shift_site_plan_assignments values($1,$2,$3,$4,$5)',[id,plan,site,state,count]);
  await activate('1','A',6); await activate('2','B',4);
  await assert.rejects(activate('3','C',1),/Disponible para este plan: 0/);
  await activate('4','D',50,'inactivo');
  await assert.rejects(db.exec("update shift_site_plan_assignments set estado='activo' where id='4'"));
  await db.exec("update shift_site_plan_assignments set operarios_planeados=4 where id='2'");
  await assert.rejects(db.exec("update shift_site_plan_assignments set operarios_planeados=5 where id='2'"));
  await db.exec("update shift_site_plan_assignments set operarios_planeados=3 where id='2'");
  await activate('3','C',1);
  await assert.rejects(db.exec("update sedes set numero_operarios=9 where codigo='S'"),/Ajusta los planes/);
  await db.exec("update sedes set numero_operarios=11 where codigo='S'");
  await activate('5','E',1);
  await assert.rejects(activate('zero','A',1,'activo','ZERO'));
  await assert.rejects(activate('missing','A',1,'activo','MISSING'));
  await assert.rejects(db.exec("insert into shift_site_plan_assignments values ('bulk1','A','OTHER','activo',7),('bulk2','B','OTHER','activo',7)"));
  assert.equal((await db.query("select count(*)::int n from shift_site_plan_assignments where sede_codigo='OTHER'")).rows[0].n,0);
  await db.exec("insert into scheduled_shifts values ('sh1','A','S','programado',6)");
  await assert.rejects(db.exec("insert into scheduled_shifts values ('sh2','A','S','programado',7)"));
  await assert.rejects(db.exec("update scheduled_shifts set operarios_planeados=7 where id='sh1'"));
  await assert.rejects(db.exec("insert into scheduled_shifts values ('sh3','NOT_ACTIVE','S','programado',1)"));
  await db.exec("insert into scheduled_shifts values ('historic','NOT_ACTIVE','S','cerrado',20)");
  await db.exec(migration);
  assert.equal((await db.query('select count(*)::int n from scheduled_shifts')).rows[0].n,2);
  console.log('PASS: planned staffing budget, multiple plans, edits, reactivation, zero staffing, atomic batches, site reductions, generated-turn limits and preservation.');
}finally{await db.close();}
