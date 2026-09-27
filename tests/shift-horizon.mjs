import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import * as calendar from '../src/assets/js/utils/shiftCalendar.js';
import * as backendCalendar from '../whatsapp-backend/src/shift-calendar.js';

assert.equal(calendar.SHIFT_GENERATION_DAYS,30);
assert.equal(backendCalendar.SHIFT_GENERATION_DAYS,calendar.SHIFT_GENERATION_DAYS);
const legacy=await fs.readFile(new URL('../src/assets/js/services/supabase/legacy.js',import.meta.url),'utf8');
const start=legacy.indexOf('export async function renewActiveShiftPlans(');
const end=legacy.indexOf('\n}',start)+2;
const generated=[];
let rotationRuns=0;
const front=vm.createContext({ ...calendar,
  todayBogota:()=> '2026-09-06',
  listShiftSitePlanAssignments:async()=>[1,90,370].map(horizonDays=>({horizonDays,templateId:'P',sedeCodigo:'S',operariosPlaneados:1})),
  generateScheduledShiftsFromPlans:async args=>{generated.push(args);return {};},
  renewShiftRotations:async()=>{rotationRuns++;}
});
vm.runInContext(legacy.slice(start,end).replace('export ',''),front);
await front.renewActiveShiftPlans({contratoCodigo:'A'});
assert.equal(generated.length,3);
assert(generated.every(row=>row.dateFrom==='2026-09-07' && row.dateTo==='2026-10-06'));
assert.equal(rotationRuns,1);

const backendSource=(await fs.readFile(new URL('../whatsapp-backend/src/shifts.js',import.meta.url),'utf8'))
  .replace(/^import [\s\S]*?;\r?\n/gm,'').replace(/^export /gm,'');
const requests=[];
const supabaseAdmin={from(table){
  const calls=[];
  const query=new Proxy({}, {get(_target,method){
    if(method==='then') return resolve=>{
      requests.push({table,calls});
      const data=table==='shift_site_plan_assignments'
        ? [1,90,370].map(horizon_days=>({horizon_days,template_id:'P',sede_codigo:'S'})) : [];
      return Promise.resolve(resolve({data,error:null}));
    };
    return (...args)=>{calls.push([method,...args]);return query;};
  }});
  return query;
}};
const backend=vm.createContext({...backendCalendar,supabaseAdmin,console});
vm.runInContext(backendSource,backend);
const first=await backend.renewActiveShiftPlans({dateFrom:'2026-09-06'});
const next=await backend.renewActiveShiftPlans({dateFrom:'2026-09-07'});
assert.equal(first.dateTo,'2026-10-06');
assert.equal(next.dateTo,'2026-10-07');
assert.equal(first.created,0);
assert.equal(next.created,0);
assert.equal(requests.filter(row=>row.table==='shift_rotations').length,2);
assert(requests.filter(row=>row.table==='scheduled_shifts').every(row=>row.calls.some(([method,column])=>method==='lte' && column==='fecha_operativa')));
console.log('PASS: frontend/backend fixed horizon ignores legacy values, advances daily and applies rotations after generation.');
