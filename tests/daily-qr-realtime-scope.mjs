import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

// Regression for the "Registro Diario" pending list flipping to "everyone registered": shift_assignments has no
// date column, so its realtime subscription could not be filtered server-side and refetched the whole day's
// registry on ANY assignment change anywhere in the system (any date, contract or sede). Extract the scoping
// predicates from streamDailyQrRecords (services/supabase/legacy.js) and exercise them directly.
const source = await fs.readFile(new URL('../src/assets/js/services/supabase/legacy.js', import.meta.url), 'utf8');
const helpersStart = source.indexOf('function shouldRefreshForDay(');
const helpersEnd = source.indexOf('\nasync function notifyTableReload');
const helpers = source.slice(helpersStart, helpersEnd);

const start = source.indexOf('export function streamDailyQrRecords(');
const bodyStart = source.indexOf('{', start) + 1;
const stop = source.indexOf('  const unTokens = registerTableReloader(', bodyStart);
if (helpersStart < 0 || start < 0 || stop < 0) throw new Error('markers not found');
const body = source.slice(bodyStart, stop) + '\n  return { emit, onAssignmentChange, onEmployeeChange, onSedeChange, updateScope, isScopeReady: () => scopeReady };\n';

const calls = { listDailyQrRecords: [] };
let dailySummary = { rows: [], pendingRows: [] };
const context = vm.createContext({
  listDailyQrRecords: async () => { calls.listDailyQrRecords.push(1); return dailySummary; }
});
vm.runInContext(helpers, context);
const harness = new Function('date', 'onData', 'onError', 'onStatus', body);
const emitted = [];
const handles = vm.runInContext(
  `(${harness.toString()})('2026-09-27', (summary) => { emitted.push(summary); }, null, null)`,
  Object.assign(context, { emitted })
);
await Promise.resolve().then(() => Promise.resolve()); // let the initial fire-and-forget emit() settle
assert.equal(calls.listDailyQrRecords.length, 1, 'the initial call always fetches once');

// Scope now reflects one known shift (T1) and one known employee (E).
dailySummary = { rows: [{ turnoId: 'T1', employeeId: 'E', documento: '123', sedeCodigo: 'S' }], pendingRows: [] };
await handles.emit();
assert.equal(calls.listDailyQrRecords.length, 2);
assert.equal(handles.isScopeReady(), true);

// An assignment change on a shift/employee outside today's known scope must not trigger a refetch.
handles.onAssignmentChange({ new: { scheduled_shift_id: 'OTHER-SHIFT', employee_id: 'X', documento: '999' } });
  await Promise.resolve().then(() => Promise.resolve());
assert.equal(calls.listDailyQrRecords.length, 2, 'unrelated shift_assignments changes elsewhere are ignored');

// An assignment change on today's known shift must refetch.
handles.onAssignmentChange({ new: { scheduled_shift_id: 'T1', employee_id: 'OTHER', documento: '000' } });
  await Promise.resolve().then(() => Promise.resolve());
assert.equal(calls.listDailyQrRecords.length, 3, 'a change on a known shift refreshes the registry');

// An assignment change for the known employee (e.g. a second shift for them today) also refetches, even on an
// unknown shift id, so a person already tracked never silently drops out of the list.
handles.onAssignmentChange({ new: { scheduled_shift_id: 'NEW-SHIFT', employee_id: 'E', documento: '123' } });
  await Promise.resolve().then(() => Promise.resolve());
assert.equal(calls.listDailyQrRecords.length, 4, 'a change for a tracked employee refreshes the registry');

// employees table changes keep the existing narrow scoping (regression guard for the same mechanism).
handles.onEmployeeChange({ new: { id: 'UNRELATED', documento: '555' } });
  await Promise.resolve().then(() => Promise.resolve());
assert.equal(calls.listDailyQrRecords.length, 4, 'unrelated employee changes elsewhere are ignored');
handles.onEmployeeChange({ new: { id: 'E', documento: '123' } });
  await Promise.resolve().then(() => Promise.resolve());
assert.equal(calls.listDailyQrRecords.length, 5, 'a change for a tracked employee refreshes the registry');

console.log('PASS: shift_assignments and employees realtime changes only refetch "Registro Diario" when they affect a shift or person already known for the day.');
