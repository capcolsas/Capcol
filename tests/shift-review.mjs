import assert from 'node:assert/strict';
import { isReviewableShiftStatus, shiftReviewCircumstances, shiftReviewLabel, shiftReviewTone } from '../src/assets/js/utils/shiftReview.js';

for (const estadoTurno of ['ausente_con_novedad', 'ausente_sin_reemplazo', 'sin_registro', 'cancelado']) {
  const row = { estadoTurno, requiresReview: true, requiereReemplazo: true };
  assert.equal(isReviewableShiftStatus(row), false, `${estadoTurno} does not belong in time review`);
  assert.deepEqual(shiftReviewCircumstances(row), []);
}
assert.equal(isReviewableShiftStatus({ estadoTurno: 'trabajado', requiresReview: true }), false);
const multiple = { estadoTurno: 'trabajado_tardio', lateEntryMinutes: 15, earlyExitMinutes: 20, requiresReview: true };
assert.equal(isReviewableShiftStatus(multiple), true);
assert.equal(shiftReviewLabel(multiple), 'Llegada tarde · Salida anticipada');
assert.equal(isReviewableShiftStatus({ ...multiple, estadoTurno: 'ajustado', requiresReview: false }), false, 'review completion preserves historical minutes without reopening the case');
assert.equal(shiftReviewLabel({ estadoTurno: 'salida_pendiente' }), 'Salida sin registrar');
assert.equal(shiftReviewLabel({ estadoTurno: 'post_cierre_pendiente', lateExitMinutes: 30 }), 'Salida tardia · Marcacion posterior al cierre');
const comment = { estadoTurno: 'trabajado', requiresReview: true, timingAlerts: { entrada_anticipada: 5 } };
assert.equal(shiftReviewLabel(comment), 'Entrada anticipada');
assert.equal(isReviewableShiftStatus(comment), true);
assert.equal(isReviewableShiftStatus({ ...comment, earlyEntryReason: 'Ingreso para cambio de uniforme' }), false, 'explained comment-only alert is not a pending time issue');
assert.equal(isReviewableShiftStatus({ ...comment, earlyEntryMinutes: 10, earlyEntryReason: 'Motivo informado' }), true, 'an explanation does not resolve a control-window exception');
console.log('Shift review: concrete circumstances, multiple issues, absence exclusion and resolved records passed.');
for (const circumstance of ['Llegada tarde', 'Salida anticipada']) assert.equal(shiftReviewTone(multiple, circumstance), 'red');
for (const circumstance of ['Entrada anticipada', 'Salida tardia']) assert.equal(shiftReviewTone(multiple, circumstance), 'orange');
assert.equal(shiftReviewTone({ estadoTurno: 'ajustado', requiresReview: false }, 'Llegada tarde'), '');
assert.equal(shiftReviewTone({ entryAuthorizationId: 'approved-entry', requiresReview: true }, 'Entrada anticipada'), '');
assert.equal(shiftReviewTone({ exitAuthorizationId: 'approved-exit', requiresReview: true }, 'Salida tardia'), '');
assert.equal(shiftReviewTone({ entryAuthorizationId: 'approved-entry', requiresReview: true }, 'Salida anticipada'), 'red');
assert.equal(shiftReviewTone({ earlyEntryReason: 'Explicacion del empleado' }, 'Entrada anticipada'), 'orange');
console.log('Shift review colors: pending circumstances, partial authorizations and completed review passed.');
