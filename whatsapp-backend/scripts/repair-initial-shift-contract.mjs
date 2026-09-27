import 'dotenv/config';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

// One-time recovery of the retired placeholder, never a reassignment of valid contracts.
const source = 'CONTRATO-INICIAL';
const target = 'CON-0001';
const apply = process.argv.includes('--apply');
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const context = 'contrato_codigo,contrato_nombre,cliente_nombre_snapshot,cliente_nit_snapshot';
async function read(table, select, filter) {
  const rows = [];
  for (let from = 0; ; from += 500) {
    let query = db.from(table).select(select).order(table === 'sedes' || table === 'contracts' ? 'codigo' : 'id').range(from, from + 499);
    if (filter) query = query.eq('contrato_codigo', filter);
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < 500) return rows;
  }
}
const contracts = await read('contracts', 'codigo,nombre,cliente_nombre,cliente_nit');
const contract = contracts.find(r => r.codigo === target);
if (!contract || contracts.some(r => r.codigo === source)) throw new Error('El destino no existe o el origen sigue siendo un contrato valido.');
const sites = new Map((await read('sedes', 'codigo,contrato_codigo')).map(r => [r.codigo, r]));
const plans = new Map((await read('shift_templates', 'id,contrato_codigo')).map(r => [r.id, r]));
const shifts = await read('scheduled_shifts', `id,template_id,sede_codigo,${context}`);
const shiftsById = new Map(shifts.map(r => [r.id, r]));
const pending = { scheduled_shifts: shifts.filter(r => r.contrato_codigo === source) };
const activations = await read('shift_site_plan_assignments', `id,template_id,sede_codigo,${context}`, source);
for (const row of [...pending.scheduled_shifts, ...activations]) {
  if (sites.get(row.sede_codigo)?.contrato_codigo !== target || plans.get(row.template_id)?.contrato_codigo !== target) {
    throw new Error(`Relacion ambigua para ${row.id}; no se modifico ningun registro.`);
  }
}
for (const table of ['shift_assignments', 'shift_closures', 'employee_shift_status', 'shift_time_authorizations', 'shift_adjustments']) {
  pending[table] = await read(table, `id,scheduled_shift_id,${context}`, source);
  for (const row of pending[table]) {
    const parent = shiftsById.get(row.scheduled_shift_id);
    if (!parent || ![source, target].includes(parent.contrato_codigo) || sites.get(parent.sede_codigo)?.contrato_codigo !== target || plans.get(parent.template_id)?.contrato_codigo !== target) {
      throw new Error(`Relacion ambigua en ${table} / ${row.id}; no se modifico ningun registro.`);
    }
  }
}
// Publish the recovered activations only after all related records are consistent.
pending.shift_site_plan_assignments = activations;
console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', source, target, counts: Object.fromEntries(Object.entries(pending).map(([table, rows]) => [table, rows.length])) }));
if (apply) {
  const directory = fileURLToPath(new URL('../../backups/', import.meta.url));
  await fs.mkdir(directory, { recursive: true });
  const backup = `${directory}shift-contract-recovery-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  await fs.writeFile(backup, JSON.stringify({ source, target, createdAt: new Date().toISOString(), pending }, null, 2), { flag: 'wx' });
  console.log(`Backup: ${backup}`);
  const patch = { contrato_codigo: target, contrato_nombre: contract.nombre, cliente_nombre_snapshot: contract.cliente_nombre, cliente_nit_snapshot: contract.cliente_nit };
  for (const [table, rows] of Object.entries(pending)) {
    let updated = 0;
    for (let offset = 0; offset < rows.length; offset += 100) {
      const ids = rows.slice(offset, offset + 100).map(r => r.id);
      const { data, error } = await db.from(table).update(patch).in('id', ids).eq('contrato_codigo', source).select(`id,${context}`);
      if (error) throw new Error(`${table}: ${error.message}. Respaldo disponible; la ejecucion puede haber aplicado lotes anteriores.`);
      if (data.length !== ids.length || data.some(r => r.contrato_codigo !== target)) throw new Error(`Verificacion fallida en ${table}; revisar respaldo y lotes anteriores.`);
      updated += data.length;
    }
    console.log(JSON.stringify({ table, updated }));
  }
  for (const table of Object.keys(pending)) {
    const remaining = await read(table, 'id,contrato_codigo', source);
    if (remaining.length) throw new Error(`Quedan ${remaining.length} registros antiguos en ${table}.`);
  }
  console.log('Verificado: no quedan registros de turnos asociados a CONTRATO-INICIAL.');
}
