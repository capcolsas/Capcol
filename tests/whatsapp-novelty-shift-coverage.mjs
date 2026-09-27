import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

// Regression: a compensatory day (the employee is physically present, "Compensatorio" novelty) must attach the
// operational shift the same way a normal "Trabajando" report does, so it shows up in the contract's shift
// coverage. Before this fix, only WORKING opened the shift; every other non-absence novelty silently fell through
// to `shiftResult = null`, leaving employee_shift_status.entrada_at unset even though the person is present.
const source = await fs.readFile(new URL('../whatsapp-backend/src/app.js', import.meta.url), 'utf8');
const start = source.indexOf('async function registerNovelty(');
const end = source.indexOf('\nasync function ', start + 10);
const code = source.slice(start, end);

async function run(novelty, { absenceCase = false } = {}) {
  const openCalls = [];
  const resolveCalls = [];
  const upserts = { attendance: [] };
  const context = vm.createContext({
    NOVELTIES: { WORKING: { code: '1' }, COMPENSATORY: { code: '7' } },
    currentDate: () => '2026-09-27',
    currentTime: () => '07:10',
    reloadEmployeeForAttendance: async (e) => e,
    normalizeDocument: (d) => d,
    buildDailyRecordId: (date, doc) => `${date}_${doc}`,
    resolveBackendContractContext: async () => ({ contrato_codigo: 'CON-0001' }),
    findOverlappingIncapacity: async () => null,
    openOperationalShiftFromAttendance: async (args) => { openCalls.push(args); return { shift: { id: 'SHIFT1', fechaOperativa: '2026-09-27' }, opened: false }; },
    resolveOperationalShiftForAttendance: async (args) => { resolveCalls.push(args); return absenceCase ? { shift: { id: 'SHIFT1', fechaOperativa: '2026-09-27' }, opened: false } : null; },
    shiftRegistrationFields: (result) => ({ turno_id: result?.shift?.id || null }),
    upsertEmployeeShiftStatusFromEvent: async () => null,
    isAttendanceScheduledForOperationalService: async () => false,
    clearDailyOperationalAbsenceArtifacts: async () => {},
    releaseSupernumerarioReplacementsForIncapacity: async () => {},
    refreshOperationalState: async () => {},
    sessionEmployee: (e) => e,
    buildSupportMessage: () => null,
    buildOverlapMessage: () => 'overlap',
    formatDateForHumans: (v) => v,
    storeSession: async () => {},
    sendText: async () => {},
    SESSION: { COMPLETED: 'completed' },
    supabaseAdmin: { from(table) {
      const query = new Proxy({}, { get: (_t, method) => {
        if (method === 'then') return (resolve) => Promise.resolve(resolve({ data: null, error: null }));
        if (method === 'select' || method === 'single') return () => query;
        return (payload) => { if (table === 'attendance' && payload) upserts.attendance.push(payload); return query; };
      } });
      return query;
    } }
  });
  vm.runInContext(code, context);
  await context.registerNovelty('3001111111', { id: 'E', documento: '456', nombre: 'Miguel', sede_codigo: 'S', sede_nombre: 'Sede' }, novelty);
  return { openCalls, resolveCalls, attendance: upserts.attendance[0] };
}

// Compensatorio: present (absenteeism:false, not the WORKING code) must open the shift like WORKING does.
const compensatory = { code: '7', label: 'Compensatorio', absenteeism: false, requiresDates: false, tracksIncapacity: false, requiresSupport: false, dateContext: 'incapacidad' };
let result = await run(compensatory);
assert.equal(result.openCalls.length, 1, 'a present-but-not-"Trabajando" novelty opens the shift too');
assert.equal(result.resolveCalls.length, 0);
assert.equal(result.attendance.turno_id, 'SHIFT1', 'the attendance record links to the shift, so coverage counts it');

// Working keeps opening the shift (unchanged behaviour).
const working = { code: '1', label: 'Trabajando', absenteeism: false, requiresDates: false, tracksIncapacity: false, requiresSupport: false, dateContext: 'incapacidad' };
result = await run(working);
assert.equal(result.openCalls.length, 1);
assert.equal(result.resolveCalls.length, 0);
assert.equal(result.attendance.turno_id, 'SHIFT1');

// A true absence (vacaciones, licencia, etc.) only resolves the shift for record-keeping; it never opens/attaches it.
const vacations = { code: '9', label: 'Vacaciones', absenteeism: true, requiresDates: true, tracksIncapacity: true, requiresSupport: false, dateContext: 'vacaciones' };
result = await run(vacations, { absenceCase: true });
assert.equal(result.openCalls.length, 0);
assert.equal(result.resolveCalls.length, 1);
assert.equal(result.attendance.turno_id, 'SHIFT1', 'the resolved shift is still recorded for reference');
result = await run(vacations, { absenceCase: false });
assert.equal(result.attendance.turno_id, null, 'without a resolvable shift the absence record simply has none');

console.log('PASS: a present-but-non-"Trabajando" novelty (compensatorio) opens the operational shift like "Trabajando" does, so it counts in shift coverage; absences still only resolve it.');
