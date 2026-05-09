import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env' });

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en whatsapp-backend/.env');
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

function todayBogotaISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
}

function isoDatePart(value) {
  return String(value || '').slice(0, 10);
}

function isISODate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
}

function addDays(value, days) {
  const iso = isoDatePart(value);
  if (!isISODate(iso)) return '';
  const [year, month, day] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function addOneDay(value) {
  return addDays(value, 1);
}

function subtractOneDay(value) {
  return addDays(value, -1);
}

function latestHistoryRow(rows = []) {
  return [...rows].sort((left, right) => {
    const leftIngreso = isoDatePart(left?.fecha_ingreso) || isoDatePart(left?.created_at) || isoDatePart(left?.updated_at) || '';
    const rightIngreso = isoDatePart(right?.fecha_ingreso) || isoDatePart(right?.created_at) || isoDatePart(right?.updated_at) || '';
    if (leftIngreso !== rightIngreso) return leftIngreso.localeCompare(rightIngreso);
    return String(left?.id || '').localeCompare(String(right?.id || ''));
  }).at(-1) || null;
}

function uniqueDates(values = []) {
  return [...new Set((values || []).map((value) => isoDatePart(value)).filter(Boolean))].sort();
}

function toChunks(values = [], size = 100) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function parseArgs(argv = []) {
  const options = {
    apply: false,
    includeInactive: false,
    refresh: true,
    documents: [],
    refreshTo: todayBogotaISO()
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || '').trim();
    if (!arg) continue;
    if (arg === '--apply') {
      options.apply = true;
      continue;
    }
    if (arg === '--include-inactive') {
      options.includeInactive = true;
      continue;
    }
    if (arg === '--no-refresh') {
      options.refresh = false;
      continue;
    }
    if (arg === '--document' && argv[index + 1]) {
      options.documents.push(String(argv[index + 1] || '').trim());
      index += 1;
      continue;
    }
    if (arg.startsWith('--document=')) {
      options.documents.push(arg.slice('--document='.length).trim());
      continue;
    }
    if (arg.startsWith('--documents=')) {
      options.documents.push(...arg.slice('--documents='.length).split(',').map((value) => value.trim()).filter(Boolean));
      continue;
    }
    if (arg.startsWith('--refresh-to=')) {
      options.refreshTo = arg.slice('--refresh-to='.length).trim();
      continue;
    }
  }

  options.documents = [...new Set(options.documents.filter(Boolean))];
  if (!isISODate(options.refreshTo)) {
    throw new Error('Debes enviar --refresh-to en formato YYYY-MM-DD.');
  }
  return options;
}

async function selectEmployees({ includeInactive, documents }) {
  let query = supabase
    .from('employees')
    .select('id, codigo, documento, nombre, estado, cargo_codigo, cargo_nombre, sede_codigo, sede_nombre, fecha_ingreso, fecha_retiro, updated_at')
    .order('documento', { ascending: true });

  if (!includeInactive) query = query.eq('estado', 'activo');
  if (documents.length) query = query.in('documento', documents);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function selectHistory() {
  const { data, error } = await supabase
    .from('employee_cargo_history')
    .select('id, employee_id, employee_codigo, documento, cargo_codigo, cargo_nombre, sede_codigo, sede_nombre, fecha_ingreso, fecha_retiro, source, created_at')
    .order('employee_id', { ascending: true })
    .order('fecha_ingreso', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function selectSedes() {
  const { data, error } = await supabase
    .from('sedes')
    .select('codigo, nombre');
  if (error) throw error;
  return data || [];
}

async function selectAttendanceByDocuments(documents = []) {
  const rows = [];
  for (const chunk of toChunks(documents.filter(Boolean), 100)) {
    const { data, error } = await supabase
      .from('attendance')
      .select('documento, empleado_id, fecha, sede_codigo')
      .in('documento', chunk)
      .order('documento', { ascending: true })
      .order('fecha', { ascending: true });
    if (error) throw error;
    rows.push(...(data || []));
  }
  return rows;
}

function buildRepairPlan(employee, historyRows = [], attendanceRows = [], sedesByCode = new Map(), options = {}) {
  const employeeId = String(employee?.id || '').trim();
  const documento = String(employee?.documento || '').trim();
  const currentSede = String(employee?.sede_codigo || '').trim();
  const employeeEstado = String(employee?.estado || '').trim().toLowerCase();
  const employeeRetiro = isoDatePart(employee?.fecha_retiro);
  if (!employeeId || !documento || !currentSede) {
    return { skipped: true, reason: 'employee_incomplete' };
  }
  if (employeeEstado === 'inactivo' && !options?.allowInactive) {
    return { skipped: true, reason: 'employee_inactive' };
  }
  if (!historyRows.length) {
    return { skipped: true, reason: 'history_missing' };
  }

  const openRows = historyRows.filter((row) => !isoDatePart(row?.fecha_retiro));
  if (openRows.length > 1) {
    return { skipped: true, reason: 'multiple_open_history_rows' };
  }

  const currentHistoryRow = latestHistoryRow(openRows.length ? openRows : historyRows);
  const currentHistorySede = String(currentHistoryRow?.sede_codigo || '').trim();
  if (!currentHistoryRow || !currentHistorySede) {
    return { skipped: true, reason: 'history_current_missing' };
  }
  if (currentHistorySede === currentSede) {
    return { skipped: true, reason: 'already_synced' };
  }

  const oldSedeDates = uniqueDates(
    attendanceRows
      .filter((row) => String(row?.sede_codigo || '').trim() === currentHistorySede)
      .map((row) => row?.fecha)
  );
  const newSedeDates = uniqueDates(
    attendanceRows
      .filter((row) => String(row?.sede_codigo || '').trim() === currentSede)
      .map((row) => row?.fecha)
  );

  const lastOldDate = oldSedeDates.at(-1) || '';
  const firstNewDate = newSedeDates[0] || '';
  const updatedDate = isoDatePart(employee?.updated_at);

  let oldEndDate = '';
  let newStartDate = '';
  let evidence = '';

  if (firstNewDate && lastOldDate) {
    if (firstNewDate <= lastOldDate) {
      newStartDate = firstNewDate;
      oldEndDate = subtractOneDay(firstNewDate);
      evidence = 'attendance_conflict_prefers_new';
    } else {
      oldEndDate = lastOldDate;
      newStartDate = addOneDay(lastOldDate);
      evidence = firstNewDate === newStartDate ? 'attendance_exact' : 'attendance_gap';
    }
  } else if (firstNewDate) {
    newStartDate = firstNewDate;
    oldEndDate = subtractOneDay(firstNewDate);
    evidence = 'attendance_new_only';
  } else if (lastOldDate) {
    oldEndDate = lastOldDate;
    newStartDate = addOneDay(lastOldDate);
    evidence = 'attendance_old_only';
  } else if (isISODate(updatedDate)) {
    newStartDate = updatedDate;
    oldEndDate = subtractOneDay(updatedDate);
    evidence = 'updated_at_fallback';
  } else {
    return {
      skipped: true,
      reason: 'no_operational_evidence',
      details: { currentSede, currentHistorySede }
    };
  }

  if (!isISODate(oldEndDate) || !isISODate(newStartDate) || newStartDate <= oldEndDate) {
    return {
      skipped: true,
      reason: 'invalid_transition_dates',
      details: { oldEndDate, newStartDate, currentSede, currentHistorySede }
    };
  }

  let newEndDate = null;
  if (employeeEstado === 'inactivo') {
    if (!isISODate(employeeRetiro)) {
      return {
        skipped: true,
        reason: 'inactive_without_retiro_date',
        details: { documento, currentSede, currentHistorySede }
      };
    }
    if (employeeRetiro < newStartDate) {
      return {
        skipped: false,
        mode: 'employee_only',
        employeeId,
        documento,
        nombre: employee?.nombre || null,
        employeeCurrentSede: currentSede,
        employeeCurrentSedeNombre: sedesByCode.get(currentSede) || employee?.sede_nombre || null,
        historyCurrentSede: currentHistorySede,
        historyCurrentSedeNombre: sedesByCode.get(currentHistorySede) || currentHistoryRow?.sede_nombre || null,
        currentHistoryRowId: currentHistoryRow.id,
        oldEndDate,
        newStartDate,
        employeeRetiro,
        evidence: `${evidence}_inactive_no_window`
      };
    }
    newEndDate = employeeRetiro;
  }

  const overlappingTargetRow = historyRows.find((row) => {
    if (String(row?.id || '') === String(currentHistoryRow?.id || '')) return false;
    if (String(row?.sede_codigo || '').trim() !== currentSede) return false;
    const ingreso = isoDatePart(row?.fecha_ingreso);
    const retiro = isoDatePart(row?.fecha_retiro);
    if (!ingreso) return false;
    if (ingreso > newStartDate) return false;
    if (!retiro) return true;
    return retiro >= newStartDate;
  });
  if (overlappingTargetRow) {
    return {
      skipped: true,
      reason: 'target_history_already_exists',
      details: {
        targetHistoryId: overlappingTargetRow.id,
        targetSede: currentSede,
        targetIngreso: overlappingTargetRow.fecha_ingreso,
        targetRetiro: overlappingTargetRow.fecha_retiro
      }
    };
  }

  return {
    skipped: false,
    mode: 'history_and_employee',
    employeeId,
    employeeCodigo: employee?.codigo || null,
    documento,
    nombre: employee?.nombre || null,
    cargoCodigo: employee?.cargo_codigo || currentHistoryRow?.cargo_codigo || null,
    cargoNombre: employee?.cargo_nombre || currentHistoryRow?.cargo_nombre || null,
    employeeCurrentSede: currentSede,
    employeeCurrentSedeNombre: sedesByCode.get(currentSede) || employee?.sede_nombre || null,
    historyCurrentSede: currentHistorySede,
    historyCurrentSedeNombre: sedesByCode.get(currentHistorySede) || currentHistoryRow?.sede_nombre || null,
    currentHistoryRowId: currentHistoryRow.id,
    currentHistoryStart: isoDatePart(currentHistoryRow?.fecha_ingreso) || null,
    currentHistoryEnd: isoDatePart(currentHistoryRow?.fecha_retiro) || null,
    oldEndDate,
    newStartDate,
    newEndDate,
    employeeRetiro: employeeRetiro || null,
    lastOldDate: lastOldDate || null,
    firstNewDate: firstNewDate || null,
    evidence
  };
}

async function rebuildDailyStatusAndSnapshots(from, to, refreshSnapshots) {
  console.log(`Reconstruyendo employee_daily_status desde ${from} hasta ${to}...`);
  const { data, error } = await supabase.rpc('refresh_employee_daily_status_range', {
    p_fecha_desde: from,
    p_fecha_hasta: to
  });

  if (!error) {
    console.log('Filas reconstruidas reportadas por RPC:', data ?? 0);
  } else {
    console.warn('RPC por rango fallo; se intenta refresco dia a dia:', error.message || error);
    let rebuiltTotal = 0;
    let current = from;
    while (current <= to) {
      const { data: dayData, error: dayError } = await supabase.rpc('refresh_employee_daily_status', { p_fecha: current });
      if (dayError) throw dayError;
      rebuiltTotal += Number(dayData || 0);
      console.log(`employee_daily_status refrescado para ${current}:`, dayData ?? 0);
      current = addOneDay(current);
    }
    console.log('Filas reconstruidas acumuladas en refresco dia a dia:', rebuiltTotal);
  }

  if (!refreshSnapshots) return;

  console.log('Refrescando snapshots operativos por fecha...');
  let current = from;
  while (current <= to) {
    const { error: snapshotError } = await supabase.rpc('refresh_operational_snapshots_from_employee_daily_status', {
      p_fecha: current
    });
    if (snapshotError) throw snapshotError;
    console.log('Snapshots refrescados para', current);
    current = addOneDay(current);
  }
}

const options = parseArgs(process.argv.slice(2));
const employees = await selectEmployees({
  includeInactive: options.includeInactive,
  documents: options.documents
});
const historyRows = await selectHistory();
const sedesRows = await selectSedes();
const sedesByCode = new Map((sedesRows || []).map((row) => [String(row?.codigo || '').trim(), row?.nombre || null]));

const historyByEmployee = new Map();
for (const row of historyRows || []) {
  const key = String(row?.employee_id || '').trim();
  if (!key) continue;
  if (!historyByEmployee.has(key)) historyByEmployee.set(key, []);
  historyByEmployee.get(key).push(row);
}

const mismatchedEmployees = employees.filter((employee) => {
  const rows = historyByEmployee.get(String(employee?.id || '').trim()) || [];
  if (!rows.length) return false;
  const openRows = rows.filter((row) => !isoDatePart(row?.fecha_retiro));
  const currentHistoryRow = latestHistoryRow(openRows.length ? openRows : rows);
  return String(employee?.sede_codigo || '').trim()
    && String(currentHistoryRow?.sede_codigo || '').trim()
    && String(employee?.sede_codigo || '').trim() !== String(currentHistoryRow?.sede_codigo || '').trim();
});

if (!mismatchedEmployees.length) {
  console.log('No se encontraron empleados activos con sede actual desincronizada frente a employee_cargo_history.');
  process.exit(0);
}

const attendanceRows = await selectAttendanceByDocuments(mismatchedEmployees.map((employee) => String(employee?.documento || '').trim()));
const attendanceByDocument = new Map();
for (const row of attendanceRows || []) {
  const key = String(row?.documento || '').trim();
  if (!key) continue;
  if (!attendanceByDocument.has(key)) attendanceByDocument.set(key, []);
  attendanceByDocument.get(key).push(row);
}

const repairPlans = [];
const skippedPlans = [];
for (const employee of mismatchedEmployees) {
  const plan = buildRepairPlan(
    employee,
    historyByEmployee.get(String(employee?.id || '').trim()) || [],
    attendanceByDocument.get(String(employee?.documento || '').trim()) || [],
    sedesByCode,
    { allowInactive: options.includeInactive }
  );
  if (plan?.skipped) skippedPlans.push({ documento: employee?.documento || null, nombre: employee?.nombre || null, ...plan });
  else repairPlans.push(plan);
}

console.log('Candidatos desincronizados detectados:', mismatchedEmployees.length);
console.log('Reparables con evidencia suficiente:', repairPlans.length);
if (skippedPlans.length) {
  console.log('Casos omitidos:', JSON.stringify(skippedPlans, null, 2));
}

if (!repairPlans.length) {
  process.exit(0);
}

console.log('Plan de reparacion:');
console.log(JSON.stringify(repairPlans, null, 2));

if (!options.apply) {
  console.log('Dry-run completado. Ejecuta con --apply para persistir cambios.');
  process.exit(0);
}

let refreshFrom = '';

for (const plan of repairPlans) {
  if (String(plan?.mode || '') === 'employee_only') {
    const employeeOnlyPatch = {
      sede_codigo: plan.historyCurrentSede || null,
      sede_nombre: plan.historyCurrentSedeNombre || null
    };
    const { error: employeeOnlyError } = await supabase
      .from('employees')
      .update(employeeOnlyPatch)
      .eq('id', plan.employeeId);
    if (employeeOnlyError) throw employeeOnlyError;
    continue;
  }

  const historyPatch = { fecha_retiro: plan.oldEndDate };
  const { error: updateHistoryError } = await supabase
    .from('employee_cargo_history')
    .update(historyPatch)
    .eq('id', plan.currentHistoryRowId);
  if (updateHistoryError) throw updateHistoryError;

  const insertPayload = {
    employee_id: plan.employeeId,
    employee_codigo: plan.employeeCodigo || null,
    documento: plan.documento || null,
    cargo_codigo: plan.cargoCodigo || null,
    cargo_nombre: plan.cargoNombre || null,
    sede_codigo: plan.employeeCurrentSede || null,
    sede_nombre: plan.employeeCurrentSedeNombre || null,
    fecha_ingreso: plan.newStartDate,
    fecha_retiro: plan.newEndDate || null,
    source: 'repair_missing_history_transfer_script'
  };
  const { error: insertHistoryError } = await supabase
    .from('employee_cargo_history')
    .insert(insertPayload);
  if (insertHistoryError) throw insertHistoryError;

  const employeePatch = { fecha_ingreso: plan.newStartDate };
  const { error: updateEmployeeError } = await supabase
    .from('employees')
    .update(employeePatch)
    .eq('id', plan.employeeId);
  if (updateEmployeeError) throw updateEmployeeError;

  if (!refreshFrom || plan.oldEndDate < refreshFrom) {
    refreshFrom = plan.oldEndDate;
  }
}

console.log(`Cambios aplicados para ${repairPlans.length} empleado(s).`);

if (options.refresh && refreshFrom) {
  await rebuildDailyStatusAndSnapshots(refreshFrom, options.refreshTo, true);
}

console.log('Proceso completado.');
