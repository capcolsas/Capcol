import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const tables = {
  contracts: 'codigo,estado',
  sedes: 'codigo,contrato_codigo,estado',
  shift_templates: 'id,contrato_codigo,estado',
  shift_site_plan_assignments: 'id,template_id,sede_codigo,contrato_codigo,estado',
  scheduled_shifts: 'id,template_id,sede_codigo,contrato_codigo,estado,fecha_operativa',
  shift_assignments: 'id,scheduled_shift_id,contrato_codigo',
  shift_time_authorizations: 'id,scheduled_shift_id,contrato_codigo',
  shift_closures: 'id,scheduled_shift_id,contrato_codigo',
  shift_adjustments: 'id,scheduled_shift_id,contrato_codigo',
  employee_shift_status: 'id,scheduled_shift_id,contrato_codigo'
};
const rows = {};
for (const [table, select] of Object.entries(tables)) {
  rows[table] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await db.from(table).select(select).order(table === 'contracts' || table === 'sedes' ? 'codigo' : 'id').range(from, from + 499);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows[table].push(...data);
    if (data.length < 500) break;
  }
  const counts = {};
  for (const row of rows[table]) {
    const key = `${row.contrato_codigo || '(sin contrato)'} / ${row.estado || '-'}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  console.log(JSON.stringify({ table, total: rows[table].length, counts }));
}
console.log(JSON.stringify({ targetExists: rows.contracts.some(r => r.codigo === 'CON-0001'), contracts: rows.contracts }));
const sites = new Map(rows.sedes.map(r => [r.codigo, r]));
const plans = new Map(rows.shift_templates.map(r => [r.id, r]));
for (const table of ['shift_site_plan_assignments', 'scheduled_shifts']) {
  const summary = {};
  for (const row of rows[table].filter(r => !String(r.contrato_codigo || '').trim() || r.contrato_codigo === 'CONTRATO-INICIAL')) {
    const key = `sede:${sites.get(row.sede_codigo)?.contrato_codigo || '(sin contrato)'};plan:${plans.get(row.template_id)?.contrato_codigo || '(sin contrato)'}`;
    summary[key] = (summary[key] || 0) + 1;
  }
  console.log(JSON.stringify({ table, missingContractRelations: summary }));
}
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Bogota' }).format(new Date());
console.log(JSON.stringify({ today, futureShifts: rows.scheduled_shifts.filter(r => r.fecha_operativa > today).length }));
