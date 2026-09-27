import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../whatsapp-backend/src/shifts.js', import.meta.url), 'utf8');
const context = vm.createContext({ Date });
vm.runInContext(source.slice(source.indexOf('export function classifyShiftEventTime'), source.indexOf('export async function closeDueScheduledShifts')).replace('export ', ''), context);
const shift = { startsAt: '2026-09-23T12:00:00Z', endsAt: '2026-09-23T20:00:00Z', rule: {} };
for (const side of ['Entrada', 'Salida']) for (const direction of ['Antes', 'Despues']) {
  shift.rule[`alerta${side}${direction}Minutos`] = 5;
  shift.rule[`ventana${side}${direction}Minutos`] = 30;
}
for (const action of ['entry', 'exit']) for (const sign of [-1, 1]) {
  const base = new Date(action === 'entry' ? shift.startsAt : shift.endsAt).getTime();
  const type = `${action === 'entry' ? 'entrada' : 'salida'}_${sign < 0 ? 'anticipada' : 'tardia'}`;
  for (const [elapsed, review, minutes] of [[0,false,0],[5,false,0],[5.01,true,0],[10,true,0],[30,true,0],[30.01,true,1],[45,true,15]]) {
    const result = context.classifyShiftEventTime(shift, action, new Date(base + sign * elapsed * 60000));
    assert.equal(result.requiresReview, review, `${type} at ${elapsed}`);
    assert.equal(result.minutes, minutes);
    assert.equal(result.status, minutes ? type : 'normal');
    assert.equal(result.timingAlerts[type], review ? Math.ceil(elapsed) : undefined);
  }
  const oldRule = Object.fromEntries(Object.entries(shift.rule).filter(([key]) => key.startsWith('ventana')));
  assert.equal(context.classifyShiftEventTime({ ...shift, rule: oldRule }, action, new Date(base + sign * 10 * 60000)).requiresReview, false);
}
// Review only offers authorizations for control minutes, and records every alert's reason.
const ui = await fs.readFile(new URL('../src/assets/js/components/ShiftsAdmin.js', import.meta.url), 'utf8');
const review = vm.createContext({ reviewShiftById: new Map() });
vm.runInContext(ui.slice(ui.indexOf('  function authorizationCandidate('), ui.indexOf('  function buildShiftStatusUpdate(')), review);
const row = { estadoTurno: 'trabajado', timingAlerts: { entrada_anticipada: 10, salida_tardia: 12 } };
assert.equal(review.authorizationCandidate(row), null);
assert.deepEqual(Array.from(review.reviewIssueTypes(row)), ['entrada_anticipada', 'salida_tardia']);
assert.equal(review.reviewReasonPatch('entrada_anticipada', 'Transporte').earlyEntryReason, 'Transporte');
assert.equal(review.reviewReasonPatch('salida_tardia', 'Entrega').lateExitReason, 'Entrega');
assert.equal(review.authorizationCandidate({ ...row, lateExitMinutes: 5 }).minutes, 5);
assert.deepEqual(Array.from(review.reviewIssueTypes({ ...row, earlyEntryReason: 'Bus', lateExitReason: 'Entrega' })), []);
assert.deepEqual(Array.from(review.reviewIssueTypes({ ...row, earlyEntryReason: 'Bus', lateExitReason: 'Entrega', lateExitMinutes: 5 })), ['salida_tardia']);
console.log('PASS: four timing directions, exact thresholds, comment-only minutes, legacy defaults and review authorization.');
