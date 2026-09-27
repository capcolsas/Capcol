import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Regression: a replacement decision (reemplazo/ausentismo) for a novelty is written to employee_daily_status, not
// to employee_shift_status; "Resumen del contrato" builds its coverage purely from employee_shift_status, so every
// replaced absence used to be counted as a plain absence (e.g. "37 ausentismos, 0 reemplazos" even with real
// replacements on record). readCoverage (ContractDashboard.js) must overlay the daily-status decision before
// handing the statuses to summarizeShiftCoverage.
const root = new URL('../', import.meta.url);
const read = path => fs.readFileSync(new URL(path, root), 'utf8');
const dataUrl = path => `data:text/javascript;base64,${Buffer.from(read(path)).toString('base64')}`;
const { summarizeShiftCoverage } = await import(dataUrl('src/assets/js/utils/shiftCoverage.js'));
const { isReviewableShiftStatus } = await import(dataUrl('src/assets/js/utils/shiftReview.js'));
const { dateAt, isoDate } = await import(dataUrl('src/assets/js/components/dashboards/contractDashboardDemo.js'));

const source = read('src/assets/js/components/ContractDashboard.js');
const start = source.indexOf('  async function readCoverage(');
const end = source.indexOf('\n  }', source.indexOf('reviewRows\n    };', start)) + 4;
const code = source.slice(start, end);

const day = '2026-09-27';
const shift = { id: 'S1', contratoCodigo: 'A', fechaOperativa: day, estado: 'abierto', sedeCodigo: 'S' };
const assignment = { id: 'A1', scheduledShiftId: 'S1', employeeId: 'E', documento: '111' };
// employee_shift_status: nobody attended and the row was never touched with a replacement decision (the real bug).
const shiftStatus = { scheduledShiftId: 'S1', fechaOperativa: day, employeeId: 'E', documento: '111', asistio: false, closed: true, estadoTurno: 'ausente_con_novedad', decisionCobertura: 'no_aplica' };
// employee_daily_status: the same day correctly recorded the replacement.
const dailyStatus = { employeeId: 'E', documento: '111', fecha: day, decisionCobertura: 'reemplazo', reemplazadoPorEmployeeId: 'SUP', reemplazadoPorDocumento: '999', reemplazadoPorNombre: 'Supernumerario' };

function makeContext(dailyStatuses) {
  const calls = { listEmployeeDailyStatusRange: 0 };
  const deps = {
    listScheduledShiftsRange: async () => [shift],
    listShiftAssignmentsForShifts: async () => [assignment],
    listEmployeeShiftStatusRange: async () => [shiftStatus],
    listEmployeeDailyStatusRange: dailyStatuses === undefined ? undefined : async () => { calls.listEmployeeDailyStatusRange++; return dailyStatuses; }
  };
  const context = vm.createContext({ deps, summarizeShiftCoverage, isReviewableShiftStatus, dateAt, isoDate });
  vm.runInContext(code, context);
  return { context, calls };
}

let { context } = makeContext([dailyStatus]);
let result = await context.readCoverage(day, day, 'A', () => true);
assert.equal(result.total.replaced, 1, 'the replacement recorded on employee_daily_status is now counted');
assert.equal(result.total.absent, 0, 'it must not also be counted as a plain absence');
assert.equal(result.total.covered, 1);

// Without a matching daily-status decision, behaviour is unchanged: still an absence.
({ context } = makeContext([]));
result = await context.readCoverage(day, day, 'A', () => true);
assert.equal(result.total.replaced, 0);
assert.equal(result.total.absent, 1);

// A daily-status row for a different day/person must not leak in.
({ context } = makeContext([{ ...dailyStatus, fecha: '2026-09-26' }]));
result = await context.readCoverage(day, day, 'A', () => true);
assert.equal(result.total.replaced, 0);
assert.equal(result.total.absent, 1);

// If employee_shift_status already carries its own decision, it takes precedence (no override needed/possible).
const alreadyDecided = { ...shiftStatus, decisionCobertura: 'reemplazo', reemplazadoPorEmployeeId: 'OTHER' };
const deps2 = {
  listScheduledShiftsRange: async () => [shift],
  listShiftAssignmentsForShifts: async () => [assignment],
  listEmployeeShiftStatusRange: async () => [alreadyDecided],
  listEmployeeDailyStatusRange: async () => [dailyStatus]
};
const context2 = vm.createContext({ deps: deps2, summarizeShiftCoverage, isReviewableShiftStatus, dateAt, isoDate });
vm.runInContext(code, context2);
result = await context2.readCoverage(day, day, 'A', () => true);
assert.equal(result.total.replaced, 1);

// Backends without listEmployeeDailyStatusRange still work (graceful fallback), matching pre-existing behaviour.
const { context: legacyContext, calls } = makeContext(undefined);
result = await legacyContext.readCoverage(day, day, 'A', () => true);
assert.equal(calls.listEmployeeDailyStatusRange, 0);
assert.equal(result.total.absent, 1);

console.log('PASS: shift coverage overlays the replacement decision from employee_daily_status, so "37 ausentismos, 0 reemplazos" reflects real replacements.');
