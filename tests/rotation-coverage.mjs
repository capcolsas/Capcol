import assert from 'node:assert/strict';
import { quotasByTemplate, buildCycleByQuota, buildCoverage, coverageStatus } from '../src/assets/js/utils/rotationCoverage.js';
import { buildRotationWeeks } from '../src/assets/js/utils/rotationHours.js';

// Cupos: el mayor numero de operarios planeados entre los turnos del plan.
const shifts = [
  { templateId: 'M', operariosPlaneados: 1, fechaOperativa: '2026-09-28' }, { templateId: 'T', operariosPlaneados: 1, fechaOperativa: '2026-09-28' },
  { templateId: 'N', operariosPlaneados: 2, fechaOperativa: '2026-09-28' }, { templateId: 'N', operariosPlaneados: 1, fechaOperativa: '2026-09-29' }
];
const quotas = quotasByTemplate(shifts, ['M', 'T', 'N', 'X']);
assert.deepEqual([...quotas], [['M', 1], ['T', 1], ['N', 2], ['X', null]]);

// Ciclo por cupos: manana 1, tarde 1, noche 2 con 4 personas cubre exactamente cada etapa.
let result = buildCycleByQuota({ planIds: ['M', 'T', 'N'], quotas, staff: 4 });
assert.deepEqual(result.cycle, ['M', 'T', 'N', 'N']);
assert.deepEqual(result.offsets, [0, 1, 2, 3]);
assert.equal(result.missing, 0);
assert.equal(result.extra, 0);
for (let step = 0; step < result.length; step += 1) {
  const count = {};
  for (const offset of result.offsets) { const plan = result.cycle[(step + offset) % result.length]; count[plan] = (count[plan] || 0) + 1; }
  assert.deepEqual(count, { M: 1, T: 1, N: 2 }, `etapa ${step}: el reparto coincide con los cupos`);
}
// Falta o sobra personal.
result = buildCycleByQuota({ planIds: ['M', 'T', 'N'], quotas, staff: 3 });
assert.equal(result.missing, 1);
assert.deepEqual(result.offsets, [0, 1, 2]);
result = buildCycleByQuota({ planIds: ['M', 'T', 'N'], quotas, staff: 6 });
assert.equal(result.extra, 2);
assert.equal(result.offsets.length, 4);
// Plan sin turnos generados: se asume 1 cupo y se informa; los repetidos no duplican planes.
result = buildCycleByQuota({ planIds: ['M', 'X', 'M', null], quotas, staff: 2 });
assert.deepEqual(result.cycle, ['M', 'X']);
assert.deepEqual(result.assumed, ['X']);
// Tope de 28 etapas.
result = buildCycleByQuota({ planIds: ['A'], quotas: new Map([['A', 40]]), staff: 40 });
assert.equal(result.length, 28);
assert.equal(result.truncated, true);

// Cobertura por dia: personas de la rotacion frente a los cupos de cada plan.
const monday = '2026-09-28';
const config = { start: monday, days: 7, cycle: ['M', 'T', 'N', 'N'], members: ['E', 'F', 'G', 'H'].map((employee, offset) => ({ employee, offset })), rules: {} };
const day = i => new Date(Date.parse(`${monday}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10);
const allShifts = Array.from({ length: 14 }, (_, i) => ['M', 'T', 'N'].map(template => ({
  id: `${template}${i}`, templateId: template, fechaOperativa: day(i), operariosPlaneados: template === 'N' ? 2 : 1,
  startsAt: `${day(i)}T07:00:00-05:00`, endsAt: `${day(i)}T15:00:00-05:00`
}))).flat();
const results = Array.from({ length: 14 }, (_, i) => config.members.map(({ employee, offset }) => {
  const template = config.cycle[(Math.floor(i / 7) + offset) % 4];
  return { fecha: day(i), employee_id: employee, template_id: template, shift_id: `${template}${i}`, result: 'Por asignar' };
})).flat();
const weeks = buildRotationWeeks({ config, from: monday, results, shifts: allShifts });
let coverage = buildCoverage(weeks, allShifts, ['M', 'T', 'N']);
assert.equal(coverage.length, 2);
for (const plan of coverage[0]) for (const d of plan.days) assert.equal(coverageStatus(d), 'ok', `${plan.templateId} ${d.date}`);
assert.deepEqual(coverage[0].find(p => p.templateId === 'N').days[0], { date: monday, required: 2, covered: 2 });
// El descanso de una persona deja un hueco visible en su turno.
const missingOne = results.map(r => (r.employee_id === 'H' && r.fecha === day(2)) ? { ...r, template_id: null, shift_id: null, result: 'Descanso semanal' } : r);
const weeksMissing = buildRotationWeeks({ config, from: monday, results: missingOne, shifts: allShifts });
coverage = buildCoverage(weeksMissing, allShifts, ['M', 'T', 'N']);
const night = coverage[0].find(p => p.templateId === 'N').days[2];
assert.deepEqual(night, { date: day(2), required: 2, covered: 1 });
assert.equal(coverageStatus(night), 'falta');
assert.equal(coverageStatus({ required: 2, covered: 1 }), 'falta');
assert.equal(coverageStatus({ required: 1, covered: 2 }), 'sobra');
assert.equal(coverageStatus({ required: null, covered: 0 }), 'sin');
// Sin turnos consultados no hay cobertura.
assert.equal(buildCoverage(weeks, null, ['M']), null);
console.log('PASS: cupos por plan, ciclo por cupos, faltantes y sobrantes, cobertura por dia.');
