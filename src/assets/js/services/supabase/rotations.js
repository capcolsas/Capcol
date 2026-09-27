import { supabase } from './client.js';

async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}
export async function listShiftRotations(contract) {
  if (!contract) return [];
  const { data, error } = await supabase.from('shift_rotations').select('*').eq('contrato_codigo', contract).order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}
async function requireRulesVersion(config) {
  if (!config.rules && !config.unavailable?.length && !(config.members || []).some(member => member.reliever)) return;
  try {
    const version = await rpc('shift_rotation_rules_version', {});
    if (Object.keys(config.rules?.weeklyRestDays || {}).length && Number(version) < 64) throw new Error('Aplica la migracion SQL fase 64 para programar descansos semanales.');
    if ((config.members || []).some(member => member.reliever) && Number(version) < 67) throw new Error('Aplica la migracion SQL fase 66 (bundle 05) actualizada para usar relevos.');
    if ((config.rules?.restMode === 'rotativo' || config.rules?.restPlan) && Number(version) < 66) throw new Error('Aplica la migracion SQL fase 66 para usar descansos rotativos.');
    if (!Number.isFinite(Number(version)) || Number(version) < 51) throw new Error('Aplica la migracion SQL fase 51 antes de usar reglas avanzadas.');
  } catch (error) {
    if (['PGRST202','42883'].includes(error?.code)) throw new Error('Aplica la migracion SQL fase 51 antes de usar reglas avanzadas.');
    throw error;
  }
}
export async function previewShiftRotation(contract, config, from, to) {
  await requireRulesVersion(config);
  return rpc('preview_shift_rotation', { p_contract: contract, p_config: config, p_from: from, p_to: to });
}
export async function saveShiftRotation(contract, name, config) {
  await requireRulesVersion(config);
  return rpc('save_shift_rotation', { p_contract: contract, p_name: name, p_config: config });
}
export const applyShiftRotation = (id, activate = false) => rpc('apply_shift_rotation', { p_id: id, p_activate: activate });
export const pauseShiftRotation = id => rpc('pause_shift_rotation', { p_id: id });
export async function deleteShiftRotation(id) {
  try { return await rpc('delete_shift_rotation', { p_id: id }); }
  catch (error) {
    if (['PGRST202','42883'].includes(error?.code)) throw new Error('Aplica la migracion SQL fase 64 para eliminar rotaciones.');
    throw error;
  }
}
// Version de las reglas de rotacion instaladas en la base (0 si aun no existen). 66: almuerzo, descansos rotativos y horas extra.
export async function getShiftRotationRulesVersion() {
  try { return Number(await rpc('shift_rotation_rules_version', {})) || 0; }
  catch { return 0; }
}
// Intercambia el descanso de dos empleados de la misma sede en una semana; devuelve las asignaciones cambiadas.
export const swapShiftRotationRestDays = (id, employeeA, dateA, employeeB, dateB) =>
  rpc('swap_shift_rotation_rest_days', { p_id: id, p_employee_a: employeeA, p_date_a: dateA, p_employee_b: employeeB, p_date_b: dateB });
// Mueve un dia sobrante de un relevo a otro dia libre de la misma semana; devuelve las asignaciones cambiadas.
export const moveShiftRotationSurplus = (id, employee, fromDate, toDate) =>
  rpc('move_shift_rotation_surplus', { p_id: id, p_employee: employee, p_from: fromDate, p_to: toDate });
// Semanas de cada relevo: dias trabajados, dias extra y descanso pendiente.
export async function getShiftRotationReliefWeeks(config, from, to) {
  try { return (await rpc('shift_rotation_relief_weeks', { p_config: config, p_from: from, p_to: to })) || []; }
  catch { return []; }
}
// Mueve el descanso de un empleado a otro dia (lunes a sabado) de la misma semana; devuelve las asignaciones cambiadas.
export const moveShiftRotationRestDay = (id, employee, fromDate, toDate) =>
  rpc('move_shift_rotation_rest_day', { p_id: id, p_employee: employee, p_from: fromDate, p_to: toDate });
// Programacion manual (sin rotacion) de los miembros en los proximos 30 dias: con dryRun solo la cuenta; sin dryRun la elimina.
export const replaceManualShiftAssignments = (id, dryRun = true) => rpc('replace_manual_shift_assignments', { p_id: id, p_dry_run: dryRun });
// Horas extra registradas por empleado y semana (lunes) al aplicar rotaciones.
export async function listShiftOvertimeWeeks(contract, from, to) {
  if (!contract || !from || !to) return [];
  const { data, error } = await supabase.from('shift_overtime_weeks').select('*').eq('contrato_codigo', contract).gte('week_start', from).lte('week_start', to);
  if (error?.code === 'PGRST205' || error?.code === '42P01') return [];
  if (error) throw error;
  return data || [];
}
export async function updateShiftRotationRules(id, rules, unavailable) {
  await requireRulesVersion({ rules, unavailable });
  return rpc('update_shift_rotation_rules', { p_id: id, p_rules: rules, p_unavailable: unavailable });
}

export async function renewShiftRotations(contratoCodigo = null) {
  let query = supabase.from('shift_rotations').select('id').eq('estado', 'activo');
  if (contratoCodigo) query = query.eq('contrato_codigo', contratoCodigo);
  const { data, error } = await query;
  // Existing installations can continue generating shifts until phase 50 is applied.
  if (error?.code === 'PGRST205' || error?.code === '42P01') return [];
  if (error) throw error;
  const results = [];
  for (const rotation of data || []) results.push(await applyShiftRotation(rotation.id));
  return results;
}
