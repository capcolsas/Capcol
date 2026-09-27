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

// A person genuinely present that day (e.g. reported a compensatory day before the fix that links it to the shift)
// but whose shift-specific row was never marked attended must not show as pending/absent either.
const presentButUnlinkedStatus = { ...shiftStatus, decisionCobertura: 'no_aplica' };
const presentDaily = { employeeId: 'E', documento: '111', fecha: day, asistio: true, decisionCobertura: 'no_aplica' };
const deps3 = {
  listScheduledShiftsRange: async () => [shift],
  listShiftAssignmentsForShifts: async () => [assignment],
  listEmployeeShiftStatusRange: async () => [presentButUnlinkedStatus],
  listEmployeeDailyStatusRange: async () => [presentDaily]
};
const context3 = vm.createContext({ deps: deps3, summarizeShiftCoverage, isReviewableShiftStatus, dateAt, isoDate });
vm.runInContext(code, context3);
result = await context3.readCoverage(day, day, 'A', () => true);
assert.equal(result.total.attended, 1, 'a known-present person counts as attended even without an entrada_at on employee_shift_status');
assert.equal(result.total.pending, 0);
assert.equal(result.total.absent, 0);

// But an actual entrada_at (or asistio already true) on employee_shift_status is never second-guessed downward.
const genuinelyAbsent = { ...shiftStatus, decisionCobertura: 'no_aplica', asistio: false };
const noSignalDaily = { employeeId: 'E', documento: '111', fecha: day, asistio: false, decisionCobertura: 'no_aplica' };
const deps4 = {
  listScheduledShiftsRange: async () => [shift],
  listShiftAssignmentsForShifts: async () => [assignment],
  listEmployeeShiftStatusRange: async () => [genuinelyAbsent],
  listEmployeeDailyStatusRange: async () => [noSignalDaily]
};
const context4 = vm.createContext({ deps: deps4, summarizeShiftCoverage, isReviewableShiftStatus, dateAt, isoDate });
vm.runInContext(code, context4);
result = await context4.readCoverage(day, day, 'A', () => true);
assert.equal(result.total.attended, 0, 'a real absence with no presence signal anywhere stays an absence');
assert.equal(result.total.absent, 1);

// A vacation/incapacity is justified: its novelty code/name only live on employee_daily_status too. Without them,
// a shift auto-closed with nothing of its own reported (sin_registro, no code) looks exactly like an unexplained
// no-show and was wrongly counted as "unjustified" (only novedad 8, or nothing reported at all, should be).
const closedNoReport = { ...shiftStatus, decisionCobertura: 'no_aplica', closed: true, estadoTurno: 'sin_registro', novedadCodigo: null, novedadNombre: null, sourceIncapacityId: null };
const vacationsDaily = { employeeId: 'E', documento: '111', fecha: day, asistio: false, decisionCobertura: 'no_aplica', novedadCodigo: '9', novedadNombre: 'VACACIONES', sourceIncapacityId: 'INC1' };
const deps5 = {
  listScheduledShiftsRange: async () => [shift],
  listShiftAssignmentsForShifts: async () => [assignment],
  listEmployeeShiftStatusRange: async () => [closedNoReport],
  listEmployeeDailyStatusRange: async () => [vacationsDaily]
};
const context5 = vm.createContext({ deps: deps5, summarizeShiftCoverage, isReviewableShiftStatus, dateAt, isoDate });
vm.runInContext(code, context5);
result = await context5.readCoverage(day, day, 'A', () => true);
assert.equal(result.unjustifiedCount, 0, 'a vacation whose novelty code was never linked to the shift is not unjustified');
assert.equal(result.total.absent, 1, 'it is still an absence for coverage purposes, just not an unjustified one');

// A genuine no-show (nothing reported anywhere, on either table) is still correctly flagged as unjustified.
const deps6 = {
  listScheduledShiftsRange: async () => [shift],
  listShiftAssignmentsForShifts: async () => [assignment],
  listEmployeeShiftStatusRange: async () => [closedNoReport],
  listEmployeeDailyStatusRange: async () => []
};
const context6 = vm.createContext({ deps: deps6, summarizeShiftCoverage, isReviewableShiftStatus, dateAt, isoDate });
vm.runInContext(code, context6);
result = await context6.readCoverage(day, day, 'A', () => true);
assert.equal(result.unjustifiedCount, 1, 'a real unexplained no-show still counts as unjustified');

// Backends without listEmployeeDailyStatusRange still work (graceful fallback), matching pre-existing behaviour.
const { context: legacyContext, calls } = makeContext(undefined);
result = await legacyContext.readCoverage(day, day, 'A', () => true);
assert.equal(calls.listEmployeeDailyStatusRange, 0);
assert.equal(result.total.absent, 1);

console.log('PASS: shift coverage overlays the replacement decision from employee_daily_status, so "37 ausentismos, 0 reemplazos" reflects real replacements.');
