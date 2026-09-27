import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
async function read(table,select){
 const rows=[];
 for(let from=0;;from+=500){
  const {data,error}=await db.from(table).select(select).order('id').range(from,from+499);
  if(error)throw new Error(`${table}: ${error.message}`);rows.push(...data);if(data.length<500)return rows;
 }
}
const shifts=await read('scheduled_shifts','id,template_id,sede_codigo,contrato_codigo,fecha_operativa,estado');
const assignments=await read('shift_assignments','id,scheduled_shift_id,employee_id,contrato_codigo,estado');
const employees=await read('employees','id,sede_codigo,contrato_codigo,estado');
const plans=await read('shift_site_plan_assignments','id,template_id,sede_codigo,estado,operarios_planeados');
const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Bogota'}).format(new Date());
const employeesById=new Map(employees.map(r=>[r.id,r]));
const shiftsById=new Map(shifts.map(r=>[r.id,r]));
const activeAssignments=assignments.filter(r=>r.estado!=='cancelado');
const countBy=(rows,key)=>rows.reduce((out,r)=>{const k=key(r);out[k]=(out[k]||0)+1;return out;},{});
console.log(JSON.stringify({totalAssignments:assignments.length,states:countBy(assignments,r=>r.estado),missingEmployee:assignments.filter(r=>!employeesById.has(r.employee_id)).length,missingShift:assignments.filter(r=>!shiftsById.has(r.scheduled_shift_id)).length,employeeContracts:countBy(employees,r=>`${r.contrato_codigo||'NULL'} / ${r.estado}`),assignedEmployeeContracts:countBy([...new Set(assignments.map(r=>r.employee_id))].map(id=>employeesById.get(id)||{}),r=>`${r.contrato_codigo||'NULL'} / ${r.estado||'missing'}`)}));
for(const plan of plans.filter(r=>r.estado==='activo')){
 const future=shifts.filter(r=>r.template_id===plan.template_id&&r.sede_codigo===plan.sede_codigo&&r.fecha_operativa>today&&['programado','abierto'].includes(r.estado));
 const ids=new Set(future.map(r=>r.id));const linked=activeAssignments.filter(r=>ids.has(r.scheduled_shift_id));
 const byShift=countBy(linked,r=>r.scheduled_shift_id);
 const uniqueEmployees=[...new Set(linked.map(r=>r.employee_id))];
 const common=uniqueEmployees.filter(id=>future.every(s=>linked.some(a=>a.employee_id===id&&a.scheduled_shift_id===s.id)));
 console.log(JSON.stringify({sede:plan.sede_codigo,plan:plan.template_id,future:future.length,assignments:linked.length,withAssignments:future.filter(r=>byShift[r.id]).length,withoutAssignments:future.filter(r=>!byShift[r.id]).length,uniqueEmployees:uniqueEmployees.length,preselectedEmployees:common.length,eligibleAssignedEmployees:uniqueEmployees.filter(id=>{const e=employeesById.get(id);return e?.estado==='activo'&&e.contrato_codigo==='CON-0001'&&e.sede_codigo===plan.sede_codigo;}).length,unassignedDateRange:future.filter(r=>!byShift[r.id]).map(r=>r.fecha_operativa).sort().filter((_,i,a)=>i===0||i===a.length-1)}));
}
