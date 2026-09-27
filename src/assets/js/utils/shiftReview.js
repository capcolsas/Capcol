export function isReviewableShiftStatus(row = {}) {
  const status = String(row.estadoTurno || '').trim();
  if (status === 'ajustado' && row.requiresReview !== true) return false;
  return (row.requiresReview === true
    || ['post_cierre_pendiente', 'salida_pendiente', 'retiro_anticipado', 'trabajado_tardio'].includes(status))
    && pendingShiftReviewItems(row).length > 0;
}

export function shiftReviewCircumstances(row = {}) {
  const status = String(row.estadoTurno || '').trim();
  // Absence and coverage decisions belong to Registro diario.
  if (['ausente_con_novedad', 'ausente_sin_reemplazo', 'sin_registro', 'cancelado'].includes(status)) return [];
  const alerts = row.timingAlerts || {};
  const issues = [];
  const hasAlert = (type, reason) => Number(alerts[type] || 0) > 0 && !String(row[reason] || '').trim();
  if (Number(row.earlyEntryMinutes || 0) > 0 || hasAlert('entrada_anticipada', 'earlyEntryReason')) issues.push('Entrada anticipada');
  if (Number(row.lateEntryMinutes || 0) > 0 || status === 'trabajado_tardio' || hasAlert('entrada_tardia', 'lateEntryReason')) issues.push('Llegada tarde');
  if (Number(row.earlyExitMinutes || 0) > 0 || status === 'retiro_anticipado' || hasAlert('salida_anticipada', 'earlyExitReason')) issues.push('Salida anticipada');
  if (Number(row.lateExitMinutes || 0) > 0 || hasAlert('salida_tardia', 'lateExitReason')) issues.push('Salida tardia');
  if (status === 'salida_pendiente') issues.push('Salida sin registrar');
  if (status === 'post_cierre_pendiente') issues.push('Marcacion posterior al cierre');
  return issues;
}

export function shiftReviewLabel(row = {}) {
  return shiftReviewCircumstances(row).join(' · ') || 'Sin circunstancias de tiempo';
}

export function shiftReviewTone(row = {}, circumstance = '') {
  if (shiftReviewItems(row).find(item => item.label === circumstance)?.decision) return '';
  if (row.estadoTurno === 'ajustado' && row.requiresReview !== true) return '';
  if (circumstance === 'Entrada anticipada' && row.entryAuthorizationId) return '';
  if (circumstance === 'Salida tardia' && row.exitAuthorizationId) return '';
  if (['Llegada tarde', 'Salida anticipada'].includes(circumstance)) return 'red';
  if (['Entrada anticipada', 'Salida tardia'].includes(circumstance)) return 'orange';
  return '';
}

export const SHIFT_REVIEW_TYPES = [
  ['entrada_anticipada', 'Entrada anticipada', 'addition', 'earlyEntryReason'],
  ['entrada_tardia', 'Llegada tarde', 'deduction', 'lateEntryReason'],
  ['salida_anticipada', 'Salida anticipada', 'deduction', 'earlyExitReason'],
  ['salida_tardia', 'Salida tardia', 'addition', 'lateExitReason'],
  ['salida_sin_registro', 'Salida sin registrar', null, null],
  ['registro_post_cierre', 'Marcacion posterior al cierre', null, 'lateExitReason']
];

export function shiftReviewItems(row = {}) {
  const circumstances = shiftReviewCircumstances(row);
  return SHIFT_REVIEW_TYPES.filter(([key, label]) => circumstances.includes(label) || row.reviewDecisions?.[key])
    .map(([key, label, effect, reasonField]) => ({ key, label, effect, reasonField, decision: row.reviewDecisions?.[key] || null }));
}

export function pendingShiftReviewItems(row = {}) {
  if (row.estadoTurno === 'ajustado' && row.requiresReview !== true) return [];
  if (['ausente_con_novedad', 'ausente_sin_reemplazo', 'sin_registro', 'cancelado'].includes(row.estadoTurno)) return [];
  return shiftReviewItems(row).filter(item => !item.decision
    && !(item.key === 'entrada_anticipada' && row.entryAuthorizationId)
    && !(item.key === 'salida_tardia' && row.exitAuthorizationId));
}

export function shiftReviewDecisionLabel(decision) {
  return ({ addition: 'Adicion autorizada', deduction: 'Descuento autorizado', none: 'Aprobado sin ajuste' })[decision?.effect] || '';
}

export function shiftReviewSuggestedMinutes(row, shift, key) {
  const entry = entryMinutesFromStart(row, shift);
  if (key === 'entrada_anticipada') return entry.earlyEntryMinutes;
  if (key === 'entrada_tardia') return entry.lateEntryMinutes;
  const exit = row.salidaAt ? new Date(row.salidaAt).getTime() : NaN;
  const end = shift.endsAt ? new Date(shift.endsAt).getTime() : NaN;
  if (!Number.isFinite(exit) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.ceil((key === 'salida_anticipada' ? end - exit : exit - end) / 60000));
}

// Display elapsed time against the scheduled start. Stored entry-minute fields
// remain the excess beyond the tolerance window and still drive review rules.
export function entryMinutesFromStart(row = {}, shift = {}) {
  const entry = row.entradaAt ? new Date(row.entradaAt).getTime() : NaN;
  const start = shift.startsAt ? new Date(shift.startsAt).getTime() : NaN;
  if (!Number.isFinite(entry) || !Number.isFinite(start)) return { earlyEntryMinutes: null, lateEntryMinutes: null };
  return {
    earlyEntryMinutes: Math.max(0, Math.ceil((start - entry) / 60000)),
    lateEntryMinutes: Math.max(0, Math.ceil((entry - start) / 60000))
  };
}
