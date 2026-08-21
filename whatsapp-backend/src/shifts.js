import { supabaseAdmin } from './supabase.js';
import {
  addIsoDays,
  buildScheduledShiftCandidate,
  listIsoDatesInRange,
  shiftRuleAppliesOnDate,
  todayBogota
} from './shift-calendar.js';

let activeRenewPromise = null;
let lastRenewDate = '';

export function mapShiftTemplateRow(row = {}) {
  return {
    id: row.id || null,
    nombre: row.nombre || null,
    notasProgramacion: row.notas_programacion || null,
    estado: row.estado || 'activo',
    orden: Number(row.orden || 0)
  };
}

export function mapShiftTemplateRuleRow(row = {}) {
  return {
    id: row.id || null,
    templateId: row.template_id || null,
    nombre: row.nombre || null,
    tipoDia: row.tipo_dia || 'dia_semana',
    diaSemana: row.dia_semana || null,
    horaInicio: row.hora_inicio || null,
    horaFin: row.hora_fin || null,
    cruzaDia: row.cruza_dia === true,
    frecuenciaTipo: row.frecuencia_tipo || 'todos',
    frecuenciaSemanas: Number(row.frecuencia_semanas || 1),
    fechaAncla: row.fecha_ancla || null,
    semanaMes: row.semana_mes == null ? null : Number(row.semana_mes || 0),
    festivoModo: row.festivo_modo || 'excluir',
    ventanaEntradaAntesMinutos: Number(row.ventana_entrada_antes_minutos || 0),
    ventanaEntradaDespuesMinutos: Number(row.ventana_entrada_despues_minutos || 0),
    ventanaSalidaAntesMinutos: Number(row.ventana_salida_antes_minutos || 0),
    ventanaSalidaDespuesMinutos: Number(row.ventana_salida_despues_minutos || 0),
    ventanaNovedadHoras: Number(row.ventana_novedad_horas || 0),
    estado: row.estado || 'activo',
    orden: Number(row.orden || 0),
    notas: row.notas || null
  };
}

export function mapScheduledShiftRow(row = {}) {
  const template = row.shift_templates ? mapShiftTemplateRow(row.shift_templates) : null;
  const rule = row.shift_template_rules ? mapShiftTemplateRuleRow(row.shift_template_rules) : null;
  return {
    id: row.id || null,
    templateId: row.template_id || null,
    templateRuleId: row.template_rule_id || null,
    fechaOperativa: row.fecha_operativa || null,
    sedeCodigo: row.sede_codigo || null,
    sedeNombre: row.sede_nombre || null,
    nombre: row.nombre || null,
    startsAt: row.starts_at || null,
    endsAt: row.ends_at || null,
    estado: row.estado || 'programado',
    operariosPlaneados: Number(row.operarios_planeados || 0),
    template,
    rule
  };
}

function mapShiftSitePlanAssignmentRow(row = {}) {
  return {
    id: row.id || null,
    templateId: row.template_id || null,
    sedeCodigo: row.sede_codigo || null,
    sedeNombre: row.sede_nombre || null,
    operariosPlaneados: Number(row.operarios_planeados || 0),
    horizonDays: Number(row.horizon_days || 90),
    estado: row.estado || 'activo'
  };
}

async function selectPagedRows(buildQuery, pageSize = 1000) {
  const rows = [];
  let from = 0;
  const safePageSize = Math.max(1, Number(pageSize) || 1000);
  while (true) {
    const to = from + safePageSize - 1;
    const { data, error } = await buildQuery().range(from, to);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < safePageSize) break;
    from += safePageSize;
  }
  return rows;
}

export async function ensureActiveShiftPlansRenewed({ force = false } = {}) {
  const today = todayBogota();
  if (!force && lastRenewDate === today) return { skipped: true, reason: 'already_renewed_today' };
  if (activeRenewPromise) return activeRenewPromise;
  activeRenewPromise = renewActiveShiftPlans({ dateFrom: today })
    .then((result) => {
      lastRenewDate = today;
      return result;
    })
    .finally(() => {
      activeRenewPromise = null;
    });
  return activeRenewPromise;
}

function chunkArray(items = [], size = 500) {
  const output = [];
  const chunkSize = Math.max(1, Number(size) || 500);
  for (let index = 0; index < (items || []).length; index += chunkSize) {
    output.push(items.slice(index, index + chunkSize));
  }
  return output;
}

export async function renewActiveShiftPlans({ dateFrom = todayBogota() } = {}) {
  const assignmentsRaw = await selectPagedRows(() => supabaseAdmin
    .from('shift_site_plan_assignments')
    .select('*')
    .eq('estado', 'activo'));
  const assignments = assignmentsRaw.map(mapShiftSitePlanAssignmentRow)
    .filter((row) => row.templateId && row.sedeCodigo);
  if (!assignments.length) return { assignments: 0, created: 0, skippedExisting: 0, skippedInvalid: 0 };

  const templateIds = [...new Set(assignments.map((row) => row.templateId))];
  const sedeCodigos = [...new Set(assignments.map((row) => row.sedeCodigo))];
  const days = Math.min(370, Math.max(...assignments.map((row) => Number(row.horizonDays || 90))));
  const dateTo = addIsoDays(dateFrom, days - 1);
  const [templatesRaw, rulesRaw, existingRaw] = await Promise.all([
    selectPagedRows(() => supabaseAdmin
      .from('shift_templates')
      .select('*')
      .in('id', templateIds)
      .eq('estado', 'activo')),
    selectPagedRows(() => supabaseAdmin
      .from('shift_template_rules')
      .select('*')
      .in('template_id', templateIds)
      .eq('estado', 'activo')),
    selectPagedRows(() => supabaseAdmin
      .from('scheduled_shifts')
      .select('sede_codigo,template_rule_id,fecha_operativa')
      .gte('fecha_operativa', dateFrom)
      .lte('fecha_operativa', dateTo)
      .in('sede_codigo', sedeCodigos)
      .in('template_id', templateIds))
  ]);

  const templatesById = new Map(templatesRaw.map(mapShiftTemplateRow).map((row) => [row.id, row]));
  const rulesByTemplate = new Map();
  rulesRaw.map(mapShiftTemplateRuleRow).forEach((rule) => {
    if (!rulesByTemplate.has(rule.templateId)) rulesByTemplate.set(rule.templateId, []);
    rulesByTemplate.get(rule.templateId).push(rule);
  });
  const existingKeys = new Set((existingRaw || [])
    .filter((row) => row.sede_codigo && row.template_rule_id && row.fecha_operativa)
    .map((row) => `${row.sede_codigo}|${row.template_rule_id}|${row.fecha_operativa}`));
  const dates = listIsoDatesInRange(dateFrom, dateTo, 370);
  const rows = [];
  let skippedExisting = 0;
  let skippedInvalid = 0;

  assignments.forEach((assignment) => {
    const template = templatesById.get(assignment.templateId);
    if (!template) return;
    const rules = rulesByTemplate.get(assignment.templateId) || [];
    const site = {
      templateId: assignment.templateId,
      sedeCodigo: assignment.sedeCodigo,
      sedeNombre: assignment.sedeNombre,
      operariosPlaneados: assignment.operariosPlaneados
    };
    dates.forEach((fechaOperativa) => {
      rules.forEach((rule) => {
        if (!shiftRuleAppliesOnDate(rule, fechaOperativa)) return;
        const key = `${assignment.sedeCodigo}|${rule.id}|${fechaOperativa}`;
        if (existingKeys.has(key)) {
          skippedExisting += 1;
          return;
        }
        const candidate = buildScheduledShiftCandidate({ template, site, rule, fechaOperativa });
        if (!candidate) {
          skippedInvalid += 1;
          return;
        }
        rows.push({
          template_id: candidate.templateId,
          template_rule_id: candidate.templateRuleId,
          fecha_operativa: candidate.fechaOperativa,
          sede_codigo: candidate.sedeCodigo,
          sede_nombre: candidate.sedeNombre,
          nombre: candidate.nombre,
          starts_at: candidate.startsAt,
          ends_at: candidate.endsAt,
          estado: candidate.estado,
          operarios_planeados: candidate.operariosPlaneados
        });
        existingKeys.add(key);
      });
    });
  });

  let created = 0;
  const chunkSize = 500;
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    const { data, error } = await supabaseAdmin
      .from('scheduled_shifts')
      .insert(chunk)
      .select('id');
    if (error) throw error;
    created += (data || []).length;
  }

  return {
    assignments: assignments.length,
    created,
    skippedExisting,
    skippedInvalid,
    dateFrom,
    dateTo
  };
}

export async function listScheduledShiftsForOperationalDate(fechaOperativa, { sedeCodigo = null, estados = ['programado', 'abierto'] } = {}) {
  const day = String(fechaOperativa || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return [];

  let query = supabaseAdmin
    .from('scheduled_shifts')
    .select('*,shift_templates(*),shift_template_rules(*)')
    .eq('fecha_operativa', day)
    .order('starts_at', { ascending: true });
  if (sedeCodigo) query = query.eq('sede_codigo', String(sedeCodigo).trim());
  if (Array.isArray(estados) && estados.length) query = query.in('estado', estados);

  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(mapScheduledShiftRow);
}

export async function getScheduledShiftById(scheduledShiftId) {
  const id = String(scheduledShiftId || '').trim();
  if (!id) return null;
  const { data, error } = await supabaseAdmin
    .from('scheduled_shifts')
    .select('*,shift_templates(*),shift_template_rules(*)')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data?.id ? mapScheduledShiftRow(data) : null;
}

export async function listEmployeeShiftAssignmentsForRange({ employeeId = null, documento = null, dateFrom, dateTo }) {
  const from = String(dateFrom || '').trim();
  const to = String(dateTo || '').trim();
  const empId = String(employeeId || '').trim();
  const doc = String(documento || '').trim();
  if (!from || !to || (!empId && !doc)) return [];

  let query = supabaseAdmin
    .from('shift_assignments')
    .select('*,scheduled_shifts!inner(*,shift_templates(*),shift_template_rules(*))')
    .gte('scheduled_shifts.fecha_operativa', from)
    .lte('scheduled_shifts.fecha_operativa', to)
    .neq('estado', 'cancelado');
  if (empId && doc) query = query.or(`employee_id.eq.${empId},documento.eq.${doc}`);
  else if (empId) query = query.eq('employee_id', empId);
  else query = query.eq('documento', doc);

  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map((row) => ({
    id: row.id || null,
    employeeId: row.employee_id || null,
    documento: row.documento || null,
    nombre: row.nombre || null,
    estado: row.estado || 'asignado',
    shift: row.scheduled_shifts ? mapScheduledShiftRow(row.scheduled_shifts) : null
  }));
}

export async function resolveScheduledShiftForEmployeeEvent({
  fechaOperativa,
  employeeId = null,
  documento = null,
  sedeCodigo = null,
  action = 'entry',
  eventAt = new Date()
} = {}) {
  const day = String(fechaOperativa || '').trim();
  const empId = String(employeeId || '').trim();
  const doc = String(documento || '').trim();
  const site = String(sedeCodigo || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;

  let candidates = [];
  if (empId || doc) {
    const assignments = await listEmployeeShiftAssignmentsForRange({
      employeeId: empId || null,
      documento: doc || null,
      dateFrom: day,
      dateTo: day
    });
    candidates = assignments
      .filter((row) => String(row.estado || 'asignado') !== 'cancelado')
      .map((row) => row.shift)
      .filter(Boolean)
      .filter((shift) => ['programado', 'abierto'].includes(String(shift.estado || '').trim()))
      .filter((shift) => !site || String(shift.sedeCodigo || '').trim() === site);
  }

  if (!candidates.length && site) {
    candidates = await listScheduledShiftsForOperationalDate(day, {
      sedeCodigo: site,
      estados: ['programado', 'abierto']
    });
  }

  return chooseBestScheduledShiftCandidate(candidates, action, eventAt);
}

export async function openScheduledShiftForEmployeeEvent({
  fechaOperativa,
  employeeId = null,
  documento = null,
  sedeCodigo = null,
  action = 'entry',
  eventAt = new Date()
} = {}) {
  try {
    await ensureActiveShiftPlansRenewed();
  } catch (error) {
    console.error('No se pudo renovar turnos activos antes del registro:', error);
  }
  const shift = await resolveScheduledShiftForEmployeeEvent({
    fechaOperativa,
    employeeId,
    documento,
    sedeCodigo,
    action,
    eventAt
  });
  if (!shift?.id) return null;
  if (String(shift.estado || '').trim() === 'abierto') return { shift, opened: false };

  const openedAt = (eventAt instanceof Date ? eventAt : new Date(eventAt)).toISOString();
  const { data, error } = await supabaseAdmin
    .from('scheduled_shifts')
    .update({ estado: 'abierto', opened_at: openedAt })
    .eq('id', shift.id)
    .eq('estado', 'programado')
    .select('*,shift_templates(*),shift_template_rules(*)')
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) return { shift, opened: false };
  return { shift: mapScheduledShiftRow(data), opened: true };
}

function chooseBestScheduledShiftCandidate(shifts = [], action = 'entry', eventAt = new Date()) {
  const eventDate = eventAt instanceof Date ? eventAt : new Date(eventAt);
  const eventMs = eventDate.getTime();
  if (!Array.isArray(shifts) || !shifts.length || Number.isNaN(eventMs)) return null;

  const targetField = action === 'exit' ? 'endsAt' : 'startsAt';
  return shifts
    .filter((shift) => shift?.id && shift?.startsAt && shift?.endsAt)
    .map((shift) => {
      const targetMs = new Date(shift[targetField]).getTime();
      const startMs = new Date(shift.startsAt).getTime();
      const endMs = new Date(shift.endsAt).getTime();
      const inside = !Number.isNaN(startMs) && !Number.isNaN(endMs) && eventMs >= startMs && eventMs <= endMs;
      return {
        shift,
        score: (inside ? -1 : 0) * 24 * 60 * 60000 + Math.abs(eventMs - targetMs)
      };
    })
    .filter((item) => Number.isFinite(item.score))
    .sort((a, b) => a.score - b.score)[0]?.shift || null;
}

export function classifyShiftEventTime(shift = {}, action = 'entry', eventAt = new Date()) {
  const eventDate = eventAt instanceof Date ? eventAt : new Date(eventAt);
  const start = shift?.startsAt ? new Date(shift.startsAt) : null;
  const end = shift?.endsAt ? new Date(shift.endsAt) : null;
  if (!start || !end || Number.isNaN(eventDate.getTime()) || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { status: 'unknown', minutes: 0, requiresReview: false };
  }

  const template = shift.rule || shift.template || {};
  const minuteMs = 60000;
  if (action === 'exit') {
    const before = Number(template.ventanaSalidaAntesMinutos || 0);
    const after = Number(template.ventanaSalidaDespuesMinutos || 0);
    const normalFrom = new Date(end.getTime() - before * minuteMs);
    const normalUntil = new Date(end.getTime() + after * minuteMs);
    if (eventDate < normalFrom) return { status: 'salida_anticipada', minutes: Math.ceil((normalFrom.getTime() - eventDate.getTime()) / minuteMs), requiresReview: true };
    if (eventDate > normalUntil) return { status: 'salida_tardia', minutes: Math.ceil((eventDate.getTime() - normalUntil.getTime()) / minuteMs), requiresReview: true };
    return { status: 'normal', minutes: 0, requiresReview: false };
  }

  const before = Number(template.ventanaEntradaAntesMinutos || 0);
  const after = Number(template.ventanaEntradaDespuesMinutos || 0);
  const normalFrom = new Date(start.getTime() - before * minuteMs);
  const normalUntil = new Date(start.getTime() + after * minuteMs);
  if (eventDate < normalFrom) return { status: 'entrada_anticipada', minutes: Math.ceil((normalFrom.getTime() - eventDate.getTime()) / minuteMs), requiresReview: true };
  if (eventDate > normalUntil) return { status: 'entrada_tardia', minutes: Math.ceil((eventDate.getTime() - normalUntil.getTime()) / minuteMs), requiresReview: true };
  return { status: 'normal', minutes: 0, requiresReview: false };
}

export async function closeDueScheduledShifts({ now = new Date(), limit = 100 } = {}) {
  await ensureActiveShiftPlansRenewed();
  const nowDate = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(nowDate.getTime())) throw new Error('invalid_now');
  const nowIso = nowDate.toISOString();
  const safeLimit = Math.min(500, Math.max(1, Number(limit) || 100));
  const rows = await selectPagedRows(() => supabaseAdmin
    .from('scheduled_shifts')
    .select('*,shift_templates(*),shift_template_rules(*)')
    .in('estado', ['programado', 'abierto'])
    .lte('ends_at', nowIso)
    .order('ends_at', { ascending: true }), 500);

  const due = [];
  for (const row of rows || []) {
    if (due.length >= safeLimit) break;
    const shift = mapScheduledShiftRow(row);
    if (isScheduledShiftDueForClosure(shift, nowDate)) due.push(shift);
  }

  const results = [];
  for (const shift of due) {
    try {
      results.push(await closeScheduledShiftAutomatically(shift.id, { now: nowDate }));
    } catch (error) {
      console.error('No se pudo cerrar automaticamente el turno:', shift.id, error);
      results.push({
        scheduledShiftId: shift.id,
        status: 'failed',
        error: error?.message || 'shift_close_failed'
      });
    }
  }

  return {
    scanned: (rows || []).length,
    due: due.length,
    closed: results.filter((row) => row.status === 'closed').length,
    alreadyClosed: results.filter((row) => row.status === 'already_closed').length,
    failed: results.filter((row) => row.status === 'failed').length,
    results
  };
}

function isScheduledShiftDueForClosure(shift = {}, now = new Date()) {
  if (!shift?.id || !shift.endsAt) return false;
  const end = new Date(shift.endsAt);
  const nowDate = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(end.getTime()) || Number.isNaN(nowDate.getTime())) return false;
  const exitAfterMinutes = Math.max(0, Number(shift.rule?.ventanaSalidaDespuesMinutos || 0));
  return nowDate.getTime() >= end.getTime() + exitAfterMinutes * 60000;
}

export async function closeScheduledShiftAutomatically(scheduledShiftId, { now = new Date(), closedByEmail = 'cron@system' } = {}) {
  const shiftId = String(scheduledShiftId || '').trim();
  if (!shiftId) throw new Error('missing_scheduled_shift_id');
  const nowDate = now instanceof Date ? now : new Date(now);
  const nowIso = Number.isNaN(nowDate.getTime()) ? new Date().toISOString() : nowDate.toISOString();
  const { data: shiftRow, error: shiftError } = await supabaseAdmin
    .from('scheduled_shifts')
    .select('*,shift_templates(*),shift_template_rules(*)')
    .eq('id', shiftId)
    .maybeSingle();
  if (shiftError) throw shiftError;
  if (!shiftRow?.id) throw new Error('scheduled_shift_not_found');
  if (String(shiftRow.estado || '').trim() === 'cerrado') {
    const { data: closureRow, error: closureError } = await supabaseAdmin
      .from('shift_closures')
      .select('*')
      .eq('scheduled_shift_id', shiftId)
      .maybeSingle();
    if (closureError) throw closureError;
    return { status: 'already_closed', scheduledShiftId: shiftId, closure: closureRow || null };
  }

  const [statusRows, assignmentRows, authorizationRows, adjustmentRows, sedeRows] = await Promise.all([
    selectPagedRows(() => supabaseAdmin.from('employee_shift_status').select('*').eq('scheduled_shift_id', shiftId)),
    selectPagedRows(() => supabaseAdmin.from('shift_assignments').select('*').eq('scheduled_shift_id', shiftId).neq('estado', 'cancelado')),
    selectPagedRows(() => supabaseAdmin.from('shift_time_authorizations').select('id,estado').eq('scheduled_shift_id', shiftId).eq('estado', 'pendiente')),
    selectPagedRows(() => supabaseAdmin.from('shift_adjustments').select('id,estado').eq('scheduled_shift_id', shiftId).eq('estado', 'pendiente')),
    selectPagedRows(() => supabaseAdmin.from('sedes').select('codigo,qr_enabled').eq('codigo', shiftRow.sede_codigo).limit(1))
  ]);
  const qrEnabled = sedeRows[0]?.qr_enabled === true;
  let effectiveStatusRows = statusRows || [];
  if ((assignmentRows || []).length && effectiveStatusRows.length < (assignmentRows || []).length) {
    await seedEmployeeShiftStatusFromAssignments(assignmentRows || []);
    effectiveStatusRows = await selectPagedRows(() => supabaseAdmin.from('employee_shift_status').select('*').eq('scheduled_shift_id', shiftId));
  }

  const finalizedStatuses = finalizeShiftStatusesForClosure(effectiveStatusRows, { qrEnabled });
  const shift = mapScheduledShiftRow(shiftRow);
  const summary = summarizeShiftClosure({
    shift,
    statuses: finalizedStatuses,
    assignments: assignmentRows || [],
    pendingAuthorizations: authorizationRows || [],
    pendingAdjustments: adjustmentRows || []
  });
  const closurePayload = {
    id: `shift_${shiftId}`,
    scheduled_shift_id: shiftId,
    fecha_operativa: shiftRow.fecha_operativa,
    sede_codigo: shiftRow.sede_codigo,
    planeados: summary.planeados,
    asignados: summary.asignados,
    registrados: summary.registrados,
    ausencias: summary.ausencias,
    reemplazos: summary.reemplazos,
    faltantes: summary.faltantes,
    sobrantes: summary.sobrantes,
    entradas_fuera_ventana: summary.entradasFueraVentana,
    salidas_fuera_ventana: summary.salidasFueraVentana,
    salidas_pendientes: summary.salidasPendientes,
    autorizaciones_pendientes: summary.autorizacionesPendientes,
    ajustes_pendientes: summary.ajustesPendientes,
    closed_by_uid: null,
    closed_by_email: closedByEmail,
    closed_at: nowIso,
    snapshot: {
      shift,
      qrEnabled,
      statuses: finalizedStatuses,
      assignments: assignmentRows || [],
      summary
    }
  };

  await applyShiftStatusClosureUpdates(shiftId, { qrEnabled });
  const { data: closureRows, error: closureError } = await supabaseAdmin
    .from('shift_closures')
    .upsert(closurePayload, { onConflict: 'scheduled_shift_id' })
    .select('*');
  if (closureError) throw closureError;
  const { error: closeShiftError } = await supabaseAdmin
    .from('scheduled_shifts')
    .update({
      estado: 'cerrado',
      closed_at: nowIso,
      closed_by_uid: null,
      closed_by_email: closedByEmail
    })
    .eq('id', shiftId);
  if (closeShiftError) throw closeShiftError;
  await insertShiftAuditLog({
    actorEmail: closedByEmail,
    targetId: closurePayload.id,
    action: 'shift_close_completed',
    after: {
      scheduledShiftId: shiftId,
      fechaOperativa: shiftRow.fecha_operativa,
      sedeCodigo: shiftRow.sede_codigo,
      summary
    },
    note: `Cierre automatico de turno ${shiftRow.nombre || shiftId}.`
  });

  return {
    status: 'closed',
    scheduledShiftId: shiftId,
    closure: (closureRows || [])[0] || closurePayload,
    summary
  };
}

async function insertShiftAuditLog({
  actorEmail = 'cron@system',
  targetId = null,
  action = null,
  before = null,
  after = null,
  note = null
} = {}) {
  if (!action) return;
  try {
    const { error } = await supabaseAdmin
      .from('audit_logs')
      .insert({
        actor_uid: null,
        actor_email: actorEmail,
        target_type: 'shift_closure',
        target_id: targetId == null ? null : String(targetId),
        action,
        before_data: before,
        after_data: after,
        note
      });
    if (error) console.error('No se pudo guardar auditoria de cierre de turno:', error);
  } catch (error) {
    console.error('Fallo guardando auditoria de cierre de turno:', error);
  }
}

async function seedEmployeeShiftStatusFromAssignments(assignments = []) {
  const rows = (Array.isArray(assignments) ? assignments : [])
    .filter((row) => row.scheduled_shift_id && (row.employee_id || row.documento));
  if (!rows.length) return { saved: 0 };
  const shiftIds = [...new Set(rows.map((row) => String(row.scheduled_shift_id || '').trim()).filter(Boolean))];
  const shifts = await selectPagedRows(() => supabaseAdmin
    .from('scheduled_shifts')
    .select('id,fecha_operativa,sede_codigo')
    .in('id', shiftIds));
  const shiftById = new Map((shifts || []).map((row) => [String(row.id || '').trim(), row]));
  const statusRows = rows
    .map((row) => {
      const shiftId = String(row.scheduled_shift_id || '').trim();
      const shift = shiftById.get(shiftId);
      const employeeId = String(row.employee_id || '').trim();
      const documento = String(row.documento || '').trim();
      const identity = employeeId || documento;
      if (!shift?.fecha_operativa || !identity) return null;
      return {
        id: `${shiftId}_${identity}`,
        scheduled_shift_id: shiftId,
        fecha_operativa: shift.fecha_operativa,
        employee_id: employeeId || null,
        documento: documento || null,
        nombre: row.nombre || null,
        sede_codigo: row.sede_codigo || shift.sede_codigo || null,
        estado_turno: 'programado',
        asistio: false
      };
    })
    .filter(Boolean);
  for (const chunk of chunkArray(statusRows, 500)) {
    const { error } = await supabaseAdmin
      .from('employee_shift_status')
      .upsert(chunk, { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw error;
  }
  return { saved: statusRows.length };
}

function finalizeShiftStatusesForClosure(rows = [], { qrEnabled = false } = {}) {
  return (rows || []).map((row) => {
    const next = { ...row };
    const estado = String(next.estado_turno || 'programado').trim();
    const attended = next.asistio === true || Boolean(next.entrada_at);
    if (estado === 'programado') next.estado_turno = 'sin_registro';
    if (qrEnabled && attended && !next.salida_at && !['ausente_con_novedad', 'cancelado'].includes(estado)) {
      next.estado_turno = 'salida_pendiente';
    }
    next.closed = true;
    return next;
  });
}

function summarizeShiftClosure({ shift = {}, statuses = [], assignments = [], pendingAuthorizations = [], pendingAdjustments = [] } = {}) {
  const activeStatuses = (statuses || []).filter((row) => String(row.estado_turno || '') !== 'cancelado');
  const planeados = Math.max(0, Number(shift.operariosPlaneados || 0));
  const asignados = (assignments || []).length || activeStatuses.length;
  const registrados = activeStatuses.filter((row) => row.asistio === true || row.entrada_at).length;
  const ausencias = activeStatuses.filter((row) => ['ausente_con_novedad', 'ausente_sin_reemplazo', 'sin_registro'].includes(String(row.estado_turno || ''))).length;
  const reemplazos = activeStatuses.filter((row) => (
    String(row.decision_cobertura || '') === 'reemplazo'
    || Boolean(row.reemplazado_por_employee_id || row.reemplazado_por_documento || row.reemplazado_por_nombre)
  )).length;
  const coverage = registrados + reemplazos;
  return {
    planeados,
    asignados,
    registrados,
    ausencias,
    reemplazos,
    faltantes: Math.max(0, planeados - coverage),
    sobrantes: Math.max(0, coverage - planeados),
    entradasFueraVentana: activeStatuses.filter((row) => Number(row.early_entry_minutes || 0) > 0 || Number(row.late_entry_minutes || 0) > 0).length,
    salidasFueraVentana: activeStatuses.filter((row) => Number(row.early_exit_minutes || 0) > 0 || Number(row.late_exit_minutes || 0) > 0).length,
    salidasPendientes: activeStatuses.filter((row) => String(row.estado_turno || '') === 'salida_pendiente').length,
    autorizacionesPendientes: (pendingAuthorizations || []).length,
    ajustesPendientes: (pendingAdjustments || []).length
  };
}

async function applyShiftStatusClosureUpdates(shiftId, { qrEnabled = false } = {}) {
  const id = String(shiftId || '').trim();
  if (!id) return;
  const { error: missingError } = await supabaseAdmin
    .from('employee_shift_status')
    .update({ estado_turno: 'sin_registro' })
    .eq('scheduled_shift_id', id)
    .eq('estado_turno', 'programado')
    .eq('closed', false);
  if (missingError) throw missingError;
  if (qrEnabled) {
    const { error: pendingExitError } = await supabaseAdmin
      .from('employee_shift_status')
      .update({ estado_turno: 'salida_pendiente' })
      .eq('scheduled_shift_id', id)
      .eq('closed', false)
      .eq('asistio', true)
      .is('salida_at', null);
    if (pendingExitError) throw pendingExitError;
  }
  const { error: closedError } = await supabaseAdmin
    .from('employee_shift_status')
    .update({ closed: true })
    .eq('scheduled_shift_id', id);
  if (closedError) throw closedError;
}
