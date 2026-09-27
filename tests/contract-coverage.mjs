import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = path => fs.readFileSync(new URL(path, root), 'utf8');
const { summarizeShiftCoverage } = await import(`data:text/javascript;base64,${Buffer.from(read('src/assets/js/utils/shiftCoverage.js')).toString('base64')}`);
const { isReviewableShiftStatus, entryMinutesFromStart, shiftReviewCircumstances, shiftReviewItems } = await import(`data:text/javascript;base64,${Buffer.from(read('src/assets/js/utils/shiftReview.js')).toString('base64')}`);
const timingShift = { startsAt: '2026-08-24T13:00:00Z' };
assert.deepEqual(entryMinutesFromStart({ entradaAt: '2026-08-24T13:41:24Z', lateEntryMinutes: 12 }, timingShift), { earlyEntryMinutes: 0, lateEntryMinutes: 42 });
assert.deepEqual(entryMinutesFromStart({ entradaAt: '2026-08-24T12:24:09Z', earlyEntryMinutes: 6 }, timingShift), { earlyEntryMinutes: 36, lateEntryMinutes: 0 });
assert.equal(entryMinutesFromStart({ entradaAt: '2026-08-24T08:00:00-05:00' }, timingShift).lateEntryMinutes, 0);
assert.equal(entryMinutesFromStart({ entradaAt: '2026-08-25T00:15:00Z' }, { startsAt: '2026-08-24T23:30:00Z' }).lateEntryMinutes, 45);
assert.equal(entryMinutesFromStart({ lateEntryMinutes: 12 }, timingShift).lateEntryMinutes, null);
assert.equal(entryMinutesFromStart({ entradaAt: 'invalid' }, timingShift).earlyEntryMinutes, null);
for (const estadoTurno of ['post_cierre_pendiente', 'salida_pendiente', 'retiro_anticipado', 'trabajado_tardio']) assert(isReviewableShiftStatus({ estadoTurno }));
assert.equal(isReviewableShiftStatus({ estadoTurno: 'ajustado', requiresReview: false }), false);
assert.equal(isReviewableShiftStatus({ estadoTurno: 'ajustado', requiresReview: true, lateExitMinutes: 10 }), true);
assert.equal(isReviewableShiftStatus({ estadoTurno: 'trabajado', requiresReview: false }), false);
const dates = ['2026-08-24', '2026-08-25'];
const shifts = [
  { id: 's1', fechaOperativa: dates[0], estado: 'cerrado', nombre: 'Turno manana', sedeNombre: 'Sede Centro', ...timingShift },
  { id: 's2', fechaOperativa: dates[1], estado: 'cerrado' },
  { id: 'cancel', fechaOperativa: dates[0], estado: 'cancelado' }
];
const assignment = (id, shift = 's1', extra = {}) => ({ id: `${shift}-${id}`, scheduledShiftId: shift, employeeId: id, documento: id, ...extra });
const status = (id, extra = {}, shift = 's1') => ({ scheduledShiftId: shift, employeeId: id, documento: id, ...extra });
const assigned = [assignment('a'), assignment('a'), assignment('b'), assignment('r'), assignment('c'), assignment('d'), assignment('x', 'cancel'), assignment('z', 's1', { estado: 'cancelado' }), assignment('a', 's2')];
const statuses = [
  status('a', { asistio: true, requiresReview: true, nombre: 'Persona A', fechaOperativa: dates[0], entradaAt: '2026-08-24T13:41:24Z', lateEntryMinutes: 12, estadoTurno: 'trabajado_tardio' }),
  status('b', { estadoTurno: 'ausente_con_novedad', decisionCobertura: 'reemplazo', reemplazadoPorEmployeeId: 'r', reemplazadoPorDocumento: 'r' }),
  status('r', { asistio: true }),
  status('c', { estadoTurno: 'ausente_sin_reemplazo', closed: true, novedadCodigo: '8' }),
  status('d', { estadoTurno: 'sin_registro', closed: false, requiresReview: true }),
  status('a', { entradaAt: '2026-08-25T12:00:00Z' }, 's2')
];
const result = summarizeShiftCoverage(dates, shifts, assigned, statuses);
assert.deepEqual(result.total, { assigned: 5, attended: 2, replaced: 1, absent: 1, pending: 1, covered: 3 });
assert.equal(result.rows[0].assigned, 4, 'replacement assignment and duplicate do not add slots');
assert.equal(result.rows[1].attended, 1, 'same person on another shift counts again');
assert.equal(result.total.covered / result.total.assigned, 0.6, 'weekly percentage is weighted by slots');
assert.equal(summarizeShiftCoverage(dates, shifts, [assignment('a')], [status('a', { asistio: true, decisionCobertura: 'reemplazo' })]).total.covered, 1);
assert.equal(summarizeShiftCoverage(dates, shifts, [assignment('a')], []).total.pending, 1, 'missing record is not an absence');
assert.equal(summarizeShiftCoverage(dates, shifts, [assignment('a')], [status('a', { closed: true })]).total.absent, 1);
assert.equal(summarizeShiftCoverage(dates, shifts, [assignment('a')], [status('a', { asistio: true }, 's2')]).total.covered, 0, 'attendance from another shift cannot cover this slot');
assert.equal(summarizeShiftCoverage(dates, [], assigned, statuses).total.assigned, 0);
assert.deepEqual(result.absencePeople.map(person => [person.documento, person.total, person.replaced, person.absent]), [['c', 1, 0, 1], ['b', 1, 1, 0]]);
const repeatedAbsences = summarizeShiftCoverage(dates, shifts, [...assigned, assignment('c', 's2')], [...statuses, status('c', { closed: true }, 's2')]);
assert.equal(repeatedAbsences.absencePeople[0].documento, 'c');
assert.equal(repeatedAbsences.absencePeople[0].total, 2);
assert.deepEqual(repeatedAbsences.absencePeople[0].dates, dates);
assert.equal(repeatedAbsences.absencePeople.reduce((sum, person) => sum + person.absent, 0), repeatedAbsences.total.absent);
assert(!result.absencePeople.some(person => ['a', 'r', 'd', 'x', 'z'].includes(person.documento)), 'attendees, replacements, pending and cancelled slots are not absent people');
assert.equal(result.unjustifiedCount, 1);
for (const [extra, expected] of [
  [{ closed: true, estadoTurno: 'sin_registro' }, 1],
  [{ closed: false, estadoTurno: 'sin_registro' }, 0],
  [{ closed: true, estadoTurno: 'sin_registro', sourceIncapacityId: 'incapacity' }, 0],
  [{ closed: true, novedadCodigo: '3', novedadNombre: 'Enfermedad General' }, 0],
  [{ closed: true, novedadNombre: 'Ausencia no justificada' }, 1],
  [{ asistio: true, novedadCodigo: '8' }, 0],
  [{ estadoTurno: 'ausente_con_novedad', novedadCodigo: '8', decisionCobertura: 'reemplazo' }, 1]
]) {
  assert.equal(summarizeShiftCoverage(dates, shifts, [assignment('a')], [status('a', extra)]).unjustifiedCount, expected, JSON.stringify(extra));
}
const rankedUnjustified = summarizeShiftCoverage(dates, shifts,
  [assignment('a'), assignment('b'), assignment('b', 's2')],
  [status('a', { closed: true, novedadCodigo: '8' }),
    status('b', { closed: true, novedadCodigo: '8', decisionCobertura: 'reemplazo' }),
    status('b', { closed: true, estadoTurno: 'sin_registro' }, 's2')]);
assert.equal(rankedUnjustified.unjustifiedCount, 3);
assert.deepEqual(rankedUnjustified.unjustifiedPeople.map(person => [person.documento, person.total, person.replaced, person.absent]), [['b', 2, 1, 1], ['a', 1, 0, 1]]);
assert.deepEqual(rankedUnjustified.unjustifiedPeople[0].dates, dates);
const siteShifts = [
  ['n1', 'N', dates[0]], ['n2', 'N', dates[0]], ['n3', 'N', dates[1]],
  ['s1', 'S', dates[0]], ['covered', 'C', dates[0]],
  ['partial1', 'P', dates[0]], ['partial2', 'P', dates[0]],
  ['pending1', 'W', dates[0]], ['pending2', 'W', dates[0]],
  ['empty', 'E', dates[0]], ['cancel', 'X', dates[0]]
].map(([id, sedeCodigo, fechaOperativa]) => ({ id, sedeCodigo, sedeNombre: `Sede ${sedeCodigo}`, fechaOperativa, contratoCodigo: 'A', estado: id === 'cancel' ? 'cancelado' : 'cerrado' }));
const siteAssignments = siteShifts.filter(shift => shift.id !== 'empty').map(shift => assignment('a', shift.id));
const siteStatuses = siteShifts.map(shift => status('a', shift.id === 'covered'
  ? { decisionCobertura: 'reemplazo' }
  : shift.id === 'partial2' ? { asistio: true }
    : shift.id === 'pending2' ? { closed: false, estadoTurno: 'sin_registro' }
      : { closed: true, estadoTurno: 'sin_registro' }, shift.id));
const unattended = summarizeShiftCoverage(dates, siteShifts, siteAssignments, siteStatuses);
assert.equal(unattended.unattendedDayCount, 2, 'counts distinct dates, not sites or shifts');
assert.deepEqual(unattended.unattendedSiteDays.map(day => [day.date, day.sedeCodigo]), [[dates[0], 'N'], [dates[0], 'S'], [dates[1], 'N']]);
assert.equal(unattended.unattendedSiteDays[0].assigned, 2, 'multiple shifts at one site/day make one detail row');
assert.equal(summarizeShiftCoverage(dates, [], [], []).unattendedDayCount, 0);

// Exercise the actual component with asynchronous service responses and a small DOM adapter.
let selected = 'A', onSelect;
let modalHost = null, modalTitle = '';
const shiftRequests = [], statusRequests = [], employeeRequests = [];
class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-08-26T02:00:00Z'])); } }
const el = (tag, props = {}, children = []) => ({ tag, props, children, value: props.value, validity: { valid: true }, listeners: {}, append(...items){this.children.push(...items);}, addEventListener(event, fn){this.listeners[event] = fn;}, replaceChildren(...items){this.children = items;} });
const context = vm.createContext({ Intl, Date: FixedDate, Number, String, Math, Set, Error, summarizeShiftCoverage, isReviewableShiftStatus, entryMinutesFromStart, el,
  lucideInlineIcon: () => '', summaryMetric: (label, value, icon, tone, detail) => el('metric', { label, value, detail }),
  showInfoModal(title, lines){if(modalHost) modalHost.isConnected = false; modalTitle = title; modalHost = lines[0]; modalHost.isConnected = true;},
  closeInfoModal(){if(modalHost) modalHost.isConnected = false;}, contractFilterCode: () => selected === '__all__' ? '' : selected,
  contractMatches: (row, code) => row.contratoCodigo === code,
  subscribe: (_key, callback) => { onSelect = callback; return () => {}; }
});
vm.runInContext(read('src/assets/js/components/dashboards/contractDashboardDemo.js').replace(/^export /gm, '') + '\n'
  + read('src/assets/js/components/ContractDashboard.js').replace(/^import .*;\r?\n/gm, '').replace('export const ContractDashboard =', 'globalThis.ContractDashboard ='), context);
const mount = el('main');
const cleanup = context.ContractDashboard(mount, {
  streamContracts: callback => { callback([{ codigo: 'A', fechaInicio: '2026-08-24', fechaFin: '2026-09-06' }]); return () => {}; },
  listActiveBaseEmployees: async options => { employeeRequests.push(options); return []; },
  listScheduledShiftsRange: (from, to, options) => new Promise((resolve, reject) => shiftRequests.push({ from, to, options, resolve, reject })),
  listEmployeeShiftStatusRange: (from, to, options) => new Promise((resolve, reject) => statusRequests.push({ from, to, options, resolve, reject })),
  listShiftAssignmentsForShifts: async () => assigned
});
const tick = () => new Promise(resolve => setImmediate(resolve));
function find(node, predicate) {
  if (!node || typeof node !== 'object') return;
  if (predicate(node)) return node;
  for (const child of node.children || []) { const found = find(child, predicate); if (found) return found; }
}
const metric = () => find(mount, node => node.props.label === 'Cobertura de turnos').props;
const absenteeism = () => find(mount, node => node.props.label === 'Ausentismo semanal').props;
const novelties = () => find(mount, node => node.props.label === 'Novedades abiertas').props;
function alertFor(host, id) {
  if (!find(host, node => node.props['data-alert'] === id)) {
    find(host, node => node.props['aria-controls'] === 'contract-alert-list').props.onclick();
  }
  return find(host, node => node.props['data-alert'] === id);
}
const reviewAlert = () => alertFor(mount, 'review');
// "Ausentismo semanal" is a plain KPI card now, not a duplicate alert; its own onclick opens the same detail.
const absenteeismCard = () => find(mount, node => node.props.label === 'Ausentismo semanal');
const unjustifiedAlert = () => alertFor(mount, 'unjustified');
const unattendedAlert = () => alertFor(mount, 'unattended');
const table = () => find(mount, node => node.tag === 'table');
const coverageQuery = () => shiftRequests.findLast(query => query.from === statusRequests.at(-1)?.from);
assert.equal(metric().value, '—');
assert.equal(absenteeism().value, '—');
assert.equal(absenteeism().detail, 'Cargando ausentismo...');
assert.equal(novelties().detail, 'Cargando novedades...');
assert.equal(reviewAlert().props.disabled, true);
assert.equal(absenteeismCard().onclick, undefined, 'not clickable before there is anything to show');
assert.equal(unjustifiedAlert().props.disabled, true);
assert.equal(unattendedAlert().props.disabled, true);
assert.equal(statusRequests[0].from, '2026-08-24');
assert.equal(statusRequests[0].to, '2026-08-30');
assert.equal(statusRequests[0].options.contratoCodigo, 'A');
assert.equal(find(mount, node => node.tag === 'input').value, '2026-08-30', 'shows Sunday of the current Bogota week');
assert.equal(employeeRequests[0].fecha, '2026-08-30', 'headcount uses selected week end');
assert(shiftRequests.every(query => query.from === '2026-08-24' && query.to === '2026-08-30'), 'assignment and coverage queries use exactly the selected week');
const fact = label => find(mount, node => node.props.className === 'contract-demo__fact' && node.children[1].children[0].children[0] === label).children[1].children[1].children[0];
assert.equal(fact('Vigencia'), '7 dias restantes');
coverageQuery().resolve(shifts.map(row => ({ ...row, contratoCodigo: 'A' })));
statusRequests[0].resolve(statuses);
await tick();
assert.equal(metric().value, '60 %');
assert.equal(unattendedAlert().props.disabled, true, 'partial absence is not a site without attention');
assert.equal(metric().detail, '3 de 5 turnos hasta hoy');
assert.equal(absenteeism().value, '20 %', 'counts only the uncovered absence, excluding replacements and pending slots');
assert.equal(absenteeism().detail, '1 ausencia sin reemplazo');
assert.equal(novelties().value, 1, 'absence-only records are managed in Registro diario');
assert.equal(novelties().detail, 'Pendientes en revision de turnos');
assert.equal(reviewAlert().props.disabled, false);
assert.equal(find(reviewAlert(), node => node.tag === 'strong').children[0], '1 pendiente de revision de turnos');
reviewAlert().props.onclick();
assert.equal(modalTitle, 'Pendientes de revision de turnos');
const reviewTable = find(modalHost, node => node.props['aria-label'] === 'Pendientes de revision de turnos');
const reviewRows = find(reviewTable, node => node.tag === 'tbody').children;
assert.equal(reviewRows.length, novelties().value, 'alert details and KPI come from the same pending records');
assert.equal(reviewRows[0].children[0].children[0], dates[0]);
assert.equal(reviewRows[0].children[1].children[0], 'Persona A (a)');
assert.equal(reviewRows[0].children.length, 4);
assert.equal(reviewRows[0].children[2].children[0], 'Sede Centro');
assert.equal(reviewRows[0].children[3].children[0], 'Entrada tardia: 42 min');
assert.equal(reviewRows.length, 1, 'generic requiresReview without a time circumstance is excluded');
assert(absenteeismCard().onclick, 'the KPI itself opens the same absence detail the removed alert used to');
absenteeismCard().onclick();
assert.equal(modalTitle, 'Ausentismo semanal · Detalle de faltas');
const absenceTable = find(modalHost, node => node.props['aria-label'] === 'Detalle de ausentismo semanal');
const absenceRows = find(absenceTable, node => node.tag === 'tbody').children;
assert.equal(absenceRows.length, 2, 'includes covered and uncovered absences');
assert(absenceRows[0].children[0].children[0].includes('(c)'));
assert.deepEqual(Array.from(absenceRows[0].children.slice(1, 4), node => node.children[0]), ['1', '0', '1']);
assert(absenceRows[1].children[0].children[0].includes('(b)'));
assert.deepEqual(Array.from(absenceRows[1].children.slice(1, 4), node => node.children[0]), ['1', '1', '0']);
assert.equal(find(unjustifiedAlert(), node => node.tag === 'strong').children[0], '1 ausencia no justificada en la semana');
// This count includes unjustified absences that already have a replacement, so it can exceed "Ausentismo semanal"
// (only absences without one); the breakdown must be visible right on the KPI, not just discoverable in the modal.
assert(find(unjustifiedAlert(), node => node.children?.[0] === '0 con reemplazo · 1 sin reemplazo · Ver detalle'), 'unjustified KPI shows its own replaced/sin reemplazo breakdown');
unjustifiedAlert().props.onclick();
assert.equal(modalTitle, 'Ausencias no justificadas');
assert.match(find(modalHost, node => node.tag === 'p')?.children?.[0] || '', /puede ser mayor que "Ausentismo semanal"/);
const unjustifiedTable = find(modalHost, node => node.props['aria-label'] === 'Detalle de ausencias no justificadas');
const unjustifiedRows = find(unjustifiedTable, node => node.tag === 'tbody').children;
assert.equal(unjustifiedRows.length, 1);
assert(unjustifiedRows[0].children[0].children[0].includes('(c)'));
assert.deepEqual(Array.from(unjustifiedRows[0].children.slice(1, 4), node => node.children[0]), ['1', '0', '1']);
const footer = find(table(), node => node.tag === 'tfoot');
assert.equal(footer.children[0].children.at(-1).children[0], metric().value, 'table and metric agree');
assert.equal(find(mount, node => node.props.className === 'btn contract-demo__export').props.disabled, true, 'PDF waits for all dashboard queries, including assignments');
find(mount, node => node.props.title === 'Semana siguiente').props.onclick();
assert.equal(modalHost.isConnected, false, 'changing week dismisses old review details');
assert.equal(metric().value, '—', 'old results cleared during reload');
assert.equal(absenteeism().value, '—', 'old absenteeism cleared with the selected week');
assert.equal(novelties().value, '—');
const staleShifts = coverageQuery(), staleStatuses = statusRequests.at(-1);
assert.equal(staleStatuses.from, '2026-08-31');
assert.equal(employeeRequests.at(-1).fecha, '2026-09-06');
assert.equal(find(mount, node => node.tag === 'input').value, '2026-09-06');
assert.equal(fact('Vigencia'), '0 dias restantes');
assert.equal(fact('Ejecucion temporal').children[0].children[0], '100 %');
find(mount, node => node.props.title === 'Semana siguiente').props.onclick();
coverageQuery().resolve([]); statusRequests.at(-1).resolve([]); await tick();
assert(metric().detail.includes('Sin turnos asignados'));
assert.equal(absenteeism().detail, 'Sin turnos asignados');
assert.equal(absenteeism().value, '—', 'no assignments does not mean zero absenteeism');
assert.equal(novelties().value, 0);
assert.equal(unjustifiedAlert().props.disabled, true);
assert.equal(novelties().detail, 'Sin pendientes de revision');
assert.equal(absenteeismCard().onclick, undefined, 'no assignments means nothing to drill into');
assert.equal(reviewAlert().props.disabled, true);
assert.equal(find(reviewAlert(), node => node.tag === 'strong').children[0], 'Sin pendientes de revision');
assert.equal(table(), undefined, 'empty week has an explicit message instead of a table of zeros');
staleShifts.resolve(shifts); staleStatuses.resolve(statuses); await tick();
assert(metric().detail.includes('Sin turnos asignados'), 'stale responses ignored');
selected = 'B'; onSelect();
assert.equal(statusRequests.at(-1).options.contratoCodigo, 'B');
coverageQuery().reject(new Error('unavailable')); statusRequests.at(-1).resolve([]); await tick();
assert.equal(metric().detail, 'No se pudo cargar la cobertura');
assert.equal(unattendedAlert().props.disabled, true);
assert.equal(find(unattendedAlert(), node => node.tag === 'strong').children[0], 'No se pudieron cargar las sedes sin atencion');
assert.equal(unjustifiedAlert().props.disabled, true);
assert.equal(absenteeism().detail, 'No se pudo cargar el ausentismo');
assert.equal(novelties().detail, 'No se pudo cargar las novedades');
assert.equal(absenteeismCard().onclick, undefined, 'a failed load is not clickable either');
assert.equal(reviewAlert().props.disabled, true);
assert.equal(find(reviewAlert(), node => node.tag === 'strong').children[0], 'No se pudieron cargar los pendientes');
assert.equal(table(), undefined, 'error is not presented as zero attendance');
selected = '__all__'; onSelect(); assert.equal(metric().detail, 'Selecciona un contrato');
assert.equal(absenteeism().detail, 'Selecciona un contrato');
assert.equal(novelties().detail, 'Selecciona un contrato');
const picker = find(mount, node => node.tag === 'input');
picker.value = '2026-10-07'; picker.listeners.change();
assert.equal(find(mount, node => node.tag === 'input').value, '2026-10-11', 'date picker shows Sunday while queries start on Monday');
selected = 'A'; onSelect(); const pending = coverageQuery(); cleanup();
assert.equal(pending.from, '2026-10-05'); assert.equal(pending.to, '2026-10-11');
assert.equal(employeeRequests.at(-1).fecha, '2026-10-11');
pending.resolve([]); statusRequests.at(-1).resolve([]); await tick();
assert.equal(metric().detail, 'Cargando cobertura...', 'disposed component is not updated');
// The shared employee service must forward the requested date and retain its default for other callers.
const service = read('src/assets/js/services/supabase/legacy.js');
const serviceFunction = service.slice(service.indexOf('export async function listActiveBaseEmployees('), service.indexOf('export function streamActiveBaseEmployees(')).replace('export async function', 'async function');
const requestedDates = [];
const serviceContext = vm.createContext({
  todayBogotaISO: () => '2026-09-20',
  listEmployeesEffectiveOnDate: async date => { requestedDates.push(date); return []; },
  supabase: { from: () => ({ select: async () => ({ data: [], error: null }) }) },
  isEmployeeSupernumerario: () => false, mapEmployeeRow: row => row
});
vm.runInContext(serviceFunction, serviceContext);
await serviceContext.listActiveBaseEmployees({ fecha: '2026-08-30' });
await serviceContext.listActiveBaseEmployees();
assert.deepEqual(requestedDates, ['2026-08-30', '2026-09-20']);

const shiftAdminSource = read('src/assets/js/components/ShiftsAdmin.js');
const summaryStart = shiftAdminSource.indexOf('  function shiftReviewTimeSummary(');
const summaryEnd = shiftAdminSource.indexOf('\n  function renderGeneratedShifts', summaryStart);
const reviewContext = vm.createContext({ entryMinutesFromStart, shiftReviewCircumstances, shiftReviewItems, reviewShiftById: new Map([['s1', timingShift]]) });
vm.runInContext(shiftAdminSource.slice(summaryStart, summaryEnd), reviewContext);
assert.equal(reviewContext.shiftReviewTimeSummary(statuses[0]), '42 min');
assert.equal(reviewContext.shiftReviewTimeSummary({ scheduledShiftId: 's1', entradaAt: '2026-08-24T12:24:09Z', earlyEntryMinutes: 6 }), '36 min');
assert.equal(reviewContext.shiftReviewTimeSummary({ scheduledShiftId: 's1', lateEntryMinutes: 12 }), '-');
assert.equal(reviewContext.shiftReviewTimeSummary({ ...statuses[0], earlyExitMinutes: 20 }), '42 min · 20 min');
assert.equal(reviewContext.shiftReviewTimeSummary({ estadoTurno: 'salida_pendiente' }), '-');
assert.equal(statuses[0].lateEntryMinutes, 12, 'display calculation does not change stored excess or approval rules');

selected = 'A';
let calendarError = false;
const calendarQueries = [];
const calendarMount = el('main');
const calendarCleanup = context.ContractDashboard(calendarMount, {
  listActiveBaseEmployees: async () => [],
  listScheduledShiftsRange: async (from, to, options) => {
    calendarQueries.push({ from, to, options });
    if (calendarError) throw new Error('load failed');
    return shifts.map(row => ({ ...row, contratoCodigo: 'A' }));
  },
  listEmployeeShiftStatusRange: async () => statuses,
  listShiftAssignmentsForShifts: async () => assigned
});
await tick();
const openCalendar = () => find(calendarMount, node => node.tag === 'button' && node.children[0] === 'Ver calendario').props.onclick();
await openCalendar();
assert(modalTitle.includes('agosto'), 'month follows the Sunday shown in the picker');
assert.deepEqual(calendarQueries.at(-1), { from: '2026-07-27', to: '2026-09-06', options: calendarQueries.at(-1).options });
assert.equal(calendarQueries.at(-1).options.contratoCodigo, 'A');
const grid = find(modalHost, node => node.props.className === 'contract-demo__calendar');
const days = grid.children.filter(node => node.tag === 'button');
assert.equal(days.length, 42);
assert.equal(days.filter(node => node.props.className.includes('is-selected-week')).length, 7);
assert.equal(days.filter(node => node.props['aria-current'] === 'date').length, 1);
const monday = days.find(node => node.props['aria-label'].startsWith('lunes, 24'));
assert(monday); assert.equal(monday.children[1].children[0], '2/4');
monday.props.onclick();
assert(find(modalHost, node => node.props['aria-live'] === 'polite').children[0].includes('1 reemplazos'));
assert(days.some(node => node.children[1].children[0] === '—'), 'empty days do not fabricate coverage');
const loading = openCalendar(); const closedHost = modalHost; context.closeInfoModal(); await loading;
assert.equal(closedHost.children[0], 'Cargando calendario...', 'closed modal is not updated or reopened');
calendarError = true; await openCalendar(); assert(modalHost.children[0].includes('No se pudo cargar'));
calendarError = false; await openCalendar(); assert(find(modalHost, node => node.props.className === 'contract-demo__calendar'));
onSelect(); assert.equal(modalHost.isConnected, false, 'contract reload closes the calendar'); await tick();
selected = '__all__'; onSelect(); await openCalendar(); assert(modalHost.children[0].includes('Selecciona un contrato'));
calendarCleanup();

selected = 'A';
let emitSites, failSites;
const hiringMount = el('main');
const site = (codigo, numeroOperarios, extra = {}) => ({ codigo, numeroOperarios, nombre: `Sede ${codigo}`, contratoCodigo: 'A', estado: 'activo', ...extra });
const hiringCleanup = context.ContractDashboard(hiringMount, {
  streamSedes: (data, error) => { emitSites = data; failSites = error; return () => {}; },
  listActiveBaseEmployees: async ({ fecha }) => fecha === '2026-08-30' ? [
    { contratoCodigo: 'A', sedeCodigo: '1' },
    ...Array.from({ length: 3 }, () => ({ contratoCodigo: 'A', sedeCodigo: '2' })),
    { contratoCodigo: 'B', sedeCodigo: '1' }
  ] : [],
  listScheduledShiftsRange: async () => [], listEmployeeShiftStatusRange: async () => [], listShiftAssignmentsForShifts: async () => []
});
const hiringAlert = () => alertFor(hiringMount, 'hiring');
const hiringTitle = () => find(hiringAlert(), node => node.tag === 'strong').children[0];
const hiringComment = () => find(hiringAlert(), node => node.props.className === 'contract-demo__alert-copy').children[1].children[0];
assert.equal(hiringAlert().props.disabled, true);
emitSites([site('1', 3), site('2', 1), site('inactive', 90, { estado: 'inactivo' }), site('other', 90, { contratoCodigo: 'B' })]);
await tick();
assert.equal(hiringTitle(), '2 personas pendientes de contratar', 'surplus in another site does not offset a shortage');
assert.equal(hiringComment(), 'Sede 1: 2');
hiringAlert().props.onclick();
assert.equal(modalTitle, 'Pendientes de contratacion por sede');
const hiringTable = find(modalHost, node => node.tag === 'table');
const hiringRows = find(hiringTable, node => node.tag === 'tbody').children;
assert.equal(hiringRows.length, 1);
assert.deepEqual(Array.from(hiringRows[0].children, node => node.children[0]), ['Sede 1', '3', '1', '2']);
emitSites([site('1', 2)]); assert.equal(hiringTitle(), '1 persona pendiente de contratar');
emitSites([site('1', 2), site('3', 2), site('4', 1)]);
assert.equal(hiringComment(), 'Sede 1: 1 · Sede 3: 2 · Sede 4: 1');
emitSites([site('1', 2), site('3', 2), site('4', 1), site('5', 3)]);
assert.equal(hiringComment(), 'Ver mas');
hiringAlert().props.onclick();
assert.equal(find(modalHost, node => node.tag === 'tbody').children.length, 4);
assert.equal(find(modalHost, node => node.tag === 'tfoot').children[0].children[1].children[0], '7');
emitSites([site('1', 1)]); assert.equal(hiringTitle(), 'Sin pendientes de contratacion'); assert.equal(hiringAlert().props.disabled, true);
find(hiringMount, node => node.props.title === 'Semana siguiente').props.onclick(); await tick();
assert.equal(modalHost.isConnected, false);
assert.equal(hiringTitle(), '1 persona pendiente de contratar', 'uses contracted staff at the selected week end');
emitSites([site('1', null)]); assert.equal(hiringTitle(), 'Hay sedes sin requerimiento valido'); assert.equal(hiringAlert().props.disabled, true);
failSites(new Error('unavailable'), 'LOAD_ERROR'); emitSites([]);
assert.equal(hiringTitle(), 'No se pudieron cargar los pendientes de contratacion');
emitSites([site('1', 1)]); assert.equal(hiringTitle(), '1 persona pendiente de contratar');
selected = '__all__'; onSelect(); assert.equal(hiringTitle(), 'Selecciona un contrato');
hiringCleanup();

selected = 'A';
const replacementsMount = el('main');
const replacementsCleanup = context.ContractDashboard(replacementsMount, {
  listActiveBaseEmployees: async () => [],
  listScheduledShiftsRange: async () => shifts.map(row => ({ ...row, contratoCodigo: 'A' })),
  listEmployeeShiftStatusRange: async () => [statuses[1]],
  listShiftAssignmentsForShifts: async () => [assignment('b')]
});
await tick();
const replacementCard = find(replacementsMount, node => node.props.label === 'Ausentismo semanal');
assert.equal(replacementCard.props.detail, '0 ausencias sin reemplazo');
assert(replacementCard.onclick, 'covered absences remain accessible even with zero unreplaced absenteeism');
replacementCard.onclick();
assert.equal(find(modalHost, node => node.tag === 'tbody').children.length, 1);
replacementsCleanup();
const unattendedMount = el('main');
const unattendedCleanup = context.ContractDashboard(unattendedMount, {
  listActiveBaseEmployees: async () => [],
  listScheduledShiftsRange: async () => siteShifts,
  listEmployeeShiftStatusRange: async () => siteStatuses,
  listShiftAssignmentsForShifts: async () => siteAssignments
});
await tick();
const siteAlert = () => alertFor(unattendedMount, 'unattended');
assert.equal(find(siteAlert(), node => node.tag === 'strong').children[0], '2 dias con sedes sin atencion en la semana');
assert.equal(siteAlert().props.disabled, false);
siteAlert().props.onclick();
assert.equal(modalTitle, 'Sedes sin atencion');
const siteRows = find(modalHost, node => node.tag === 'tbody').children;
assert.equal(siteRows.length, 3);
assert.deepEqual(Array.from(siteRows, row => row.children[1].children[0]), ['Sede N', 'Sede S', 'Sede N']);
assert.notEqual(siteRows[0].children[0].children[0], siteRows[2].children[0].children[0]);
find(unattendedMount, node => node.props.title === 'Semana siguiente').props.onclick();
assert.equal(modalHost.isConnected, false);
assert.equal(siteAlert().props.disabled, true);
await tick();
assert.equal(find(siteAlert(), node => node.tag === 'strong').children[0], '0 dias con sedes sin atencion en la semana');
selected = '__all__'; onSelect();
assert.equal(find(siteAlert(), node => node.tag === 'strong').children[0], 'Selecciona un contrato');
unattendedCleanup();
selected = 'A';
const incapacityMount = el('main'), incapacityQueries = [];
const incapacityCleanup = context.ContractDashboard(incapacityMount, {
  listActiveBaseEmployees: async () => [], listScheduledShiftsRange: async () => [],
  listEmployeeShiftStatusRange: async () => [], listShiftAssignmentsForShifts: async () => [],
  listIncapacidadesRange: (from, to, options) => new Promise((resolve, reject) => incapacityQueries.push({ from, to, options, resolve, reject }))
});
const incapacityAlert = () => alertFor(incapacityMount, 'incapacity');
const incapacityTitle = () => find(incapacityAlert(), node => node.tag === 'strong').children[0];
const incapacity = (id, documento, extra = {}) => ({ id, documento, nombre: `Persona ${documento}`, contratoCodigo: 'A', estado: 'activo',
  fechaInicio: '2026-08-24', fechaFin: '2026-08-26', source: 'Enfermedad General', ...extra });
assert.equal(incapacityAlert().props.disabled, true);
assert.equal(incapacityQueries[0].from, '2026-08-24');
assert.equal(incapacityQueries[0].to, '2026-08-30');
assert.equal(incapacityQueries[0].options.contratoCodigo, 'A');
incapacityQueries[0].resolve([
  incapacity('1', 'A'), incapacity('2', 'B', { source: 'Accidente Laboral', fechaInicio: '2026-08-20' }),
  incapacity('3', 'B', { fechaInicio: '2026-08-29', fechaFin: '2026-09-02', soporteNombre: 'archivo-sin-adjunto.pdf' }),
  incapacity('3', 'B'), // duplicate ID must not inflate the count
  incapacity('url', 'C', { soporteUrl: 'https://example.test/support.pdf' }),
  incapacity('path', 'C', { soporteStoragePath: 'private/support.pdf' }),
  incapacity('inactive', 'C', { estado: 'inactivo' }),
  incapacity('vacation', 'C', { source: 'Vacaciones' }),
  incapacity('leave', 'C', { source: 'Licencia Remunerada' }),
  incapacity('other', 'C', { contratoCodigo: 'B' }),
  incapacity('before', 'C', { fechaInicio: '2026-08-20', fechaFin: '2026-08-23' }),
  incapacity('after', 'C', { fechaInicio: '2026-08-31', fechaFin: '2026-09-02' })
]);
await tick();
assert.equal(incapacityTitle(), '3 incapacidades sin soporte', 'counts cases overlapping the week, not days or shifts');
incapacityAlert().props.onclick();
assert.equal(modalTitle, 'Incapacidades sin soporte');
const incapacityRows = find(modalHost, node => node.tag === 'tbody').children;
assert.deepEqual(Array.from(incapacityRows, row => Array.from(row.children, cell => cell.children[0])), [['Persona B (B)', '2'], ['Persona A (A)', '1']]);
assert.equal(find(modalHost, node => node.tag === 'tfoot').children[0].children[1].children[0], '3');
find(incapacityMount, node => node.props.title === 'Semana siguiente').props.onclick();
assert.equal(modalHost.isConnected, false);
assert.equal(incapacityAlert().props.disabled, true);
const staleIncapacities = incapacityQueries.at(-1);
selected = 'B'; onSelect();
assert.equal(incapacityQueries.at(-1).options.contratoCodigo, 'B');
incapacityQueries.at(-1).resolve([]); await tick();
assert.equal(incapacityTitle(), '0 incapacidades sin soporte');
staleIncapacities.resolve([incapacity('stale', 'A')]); await tick();
assert.equal(incapacityTitle(), '0 incapacidades sin soporte');
find(incapacityMount, node => node.props.title === 'Semana siguiente').props.onclick();
incapacityQueries.at(-1).reject(new Error('unavailable')); await tick();
assert.equal(incapacityTitle(), 'No se pudieron cargar las incapacidades sin soporte');
assert.equal(incapacityAlert().props.disabled, true);
selected = '__all__'; onSelect();
assert.equal(incapacityTitle(), 'Selecciona un contrato');
selected = 'A'; onSelect();
incapacityAlert();
incapacityCleanup();
incapacityQueries.at(-1).resolve([]); await tick();
assert.equal(incapacityTitle(), 'Cargando incapacidades sin soporte...', 'disposed component ignores late responses');
const rankedMount = el('main');
let updateRankedSites;
const rankedCleanup = context.ContractDashboard(rankedMount, {
  streamSedes: callback => { updateRankedSites = callback; callback([site('1', 5)]); return () => {}; },
  listActiveBaseEmployees: async () => [],
  listScheduledShiftsRange: async () => shifts.map(row => ({ ...row, contratoCodigo: 'A' })),
  listEmployeeShiftStatusRange: async () => statuses,
  listShiftAssignmentsForShifts: async () => assigned,
  listIncapacidadesRange: async () => [incapacity('1', 'A'), incapacity('2', 'B'), incapacity('3', 'B')]
});
const visibleAlerts = () => Array.from(find(rankedMount, node => node.props.id === 'contract-alert-list').children, node => node.props['data-alert']);
const alertToggle = () => find(rankedMount, node => node.props['aria-controls'] === 'contract-alert-list');
assert.equal(visibleAlerts().length, 4, 'four alerts even while loading');
await tick();
assert.deepEqual(visibleAlerts(), ['hiring', 'incapacity', 'review', 'unjustified'], 'top four use each headline count; "Ausentismo semanal" is a KPI card now, not one of these alerts');
assert.equal(alertToggle().children[0], 'Ver más');
assert.equal(alertToggle().props['aria-expanded'], 'false');
alertToggle().props.onclick();
assert.deepEqual(visibleAlerts(), ['hiring', 'incapacity', 'review', 'unjustified', 'unattended', 'unassigned'], 'remaining alerts retain descending order and stable ties');
assert.equal(alertToggle().children[0], 'Ver menos');
assert.equal(alertToggle().props['aria-expanded'], 'true');
alertToggle().props.onclick();
assert.equal(visibleAlerts().length, 4);
updateRankedSites([site('1', 0)]);
assert.deepEqual(visibleAlerts(), ['incapacity', 'review', 'unjustified', 'hiring'], 'ranking updates when counts change');
alertToggle().props.onclick();
find(rankedMount, node => node.props.title === 'Semana siguiente').props.onclick();
assert.equal(visibleAlerts().length, 4, 'changing week collapses alerts');
await tick();
assert.equal(visibleAlerts().length, 4);
assert.equal(alertToggle().props['aria-expanded'], 'false');
alertToggle().props.onclick();
selected = '__all__'; onSelect();
assert.equal(visibleAlerts().length, 4, 'changing contract collapses alerts');
rankedCleanup();
selected = 'A';
const unassignedMount = el('main');
let failUnassigned = false;
const employee = (id, fechaIngreso, extra = {}) => ({ id, documento: id, nombre: id, fechaIngreso, contratoCodigo: 'A', sedeNombre: 'Sede Centro', ...extra });
const unassignedCleanup = context.ContractDashboard(unassignedMount, {
  listActiveBaseEmployees: async () => {
    if (failUnassigned) throw new Error('unavailable');
    return [employee('Antiguo', '2026-08-01'), employee('Antiguo', '2026-08-01'),
      employee('Nuevo', '2026-08-27'), employee('Domingo', '2026-08-30'), employee('Sin fecha', null),
      employee('Cancelado', '2026-08-01'), employee('Reemplazado', '2026-08-01'),
      employee('Asignado ID', '2026-08-01'), employee('Asignado doc', '2026-08-01'),
      employee('Otro contrato', '2026-08-01', { contratoCodigo: 'B' })];
  },
  listScheduledShiftsRange: async () => shifts.map(row => ({ ...row, contratoCodigo: 'A' })),
  listEmployeeShiftStatusRange: async () => [],
  listShiftAssignmentsForShifts: async () => [
    assignment('Asignado ID', 's1', { documento: null }),
    assignment('Asignado doc', 's1', { employeeId: 'another-id' }),
    assignment('Cancelado', 's1', { estado: 'cancelado' }),
    assignment('Reemplazado', 's1', { estado: 'reemplazado' }),
    assignment('Antiguo', 'cancel')
  ]
});
assert.equal(alertFor(unassignedMount, 'unassigned').props.disabled, true);
await tick();
const unassignedAlert = () => alertFor(unassignedMount, 'unassigned');
assert.equal(find(unassignedAlert(), node => node.tag === 'strong').children[0], '6 personas contratadas sin turnos asignados');
unassignedAlert().props.onclick();
assert.equal(modalTitle, 'Personas contratadas sin turnos asignados');
const unassignedRows = find(modalHost, node => node.tag === 'tbody').children;
assert.deepEqual(Array.from(unassignedRows, row => row.children[3].children[0]), ['7', '7', '7', '4', '1', 'No disponible']);
assert.deepEqual(Array.from(unassignedRows, row => row.children[0].children[0]), [
  'Antiguo (Antiguo)', 'Cancelado (Cancelado)', 'Reemplazado (Reemplazado)', 'Nuevo (Nuevo)', 'Domingo (Domingo)', 'Sin fecha (Sin fecha)'
]);
assert.equal(unassignedRows[0].children[1].children[0], 'Sede Centro');
assert.equal(unassignedRows[5].children[2].children[0], 'Ingreso no registrado');
failUnassigned = true;
find(unassignedMount, node => node.props.title === 'Semana siguiente').props.onclick();
assert.equal(modalHost.isConnected, false);
assert.equal(unassignedAlert().props.disabled, true);
await tick();
assert.equal(find(unassignedAlert(), node => node.tag === 'strong').children[0], 'No se pudo cargar el personal sin turnos');
selected = '__all__'; onSelect();
assert.equal(find(unassignedAlert(), node => node.tag === 'strong').children[0], 'Selecciona un contrato');
unassignedCleanup();
selected = 'A';
const cutoffMount = el('main');
let futureOnly = false;
const cutoffCleanup = context.ContractDashboard(cutoffMount, {
  listActiveBaseEmployees: async () => [],
  listScheduledShiftsRange: async from => [0, 1, 1, 2, 6].map((offset, index) => {
    const day = new Date(`${from}T12:00:00Z`); day.setUTCDate(day.getUTCDate() + offset);
    return { id: `cutoff-${index}`, contratoCodigo: 'A', fechaOperativa: day.toISOString().slice(0, 10), estado: 'programado' };
  }).filter((row, index) => !futureOnly || index >= 3),
  listShiftAssignmentsForShifts: async ids => ids.map(id => assignment('person', id)),
  listEmployeeShiftStatusRange: async () => [
    status('person', { asistio: true }, 'cutoff-0'),
    status('person', { decisionCobertura: 'reemplazo' }, 'cutoff-1'),
    status('person', { asistio: true }, 'cutoff-3')
  ]
});
const cutoffMetric = () => find(cutoffMount, node => node.props.label === 'Cobertura de turnos').props;
await tick();
assert.equal(cutoffMetric().value, '66,7 %', 'includes all of today in Bogota, excludes tomorrow even with recorded attendance');
assert.equal(cutoffMetric().detail, '2 de 3 turnos hasta hoy');
const cutoffTable = find(cutoffMount, node => node.tag === 'tfoot').children[0];
assert.equal(cutoffTable.children[1].children[0], '5', 'weekly programming still includes future assignments');
assert.equal(cutoffTable.children.at(-1).children[0], '60 %');
find(cutoffMount, node => node.props.title === 'Semana anterior').props.onclick(); await tick();
assert.equal(cutoffMetric().detail, '3 de 5 turnos', 'past weeks retain the full-week total');
find(cutoffMount, node => node.props.title === 'Semana siguiente').props.onclick(); await tick();
find(cutoffMount, node => node.props.title === 'Semana siguiente').props.onclick(); await tick();
assert.equal(cutoffMetric().detail, '3 de 5 turnos', 'future selected weeks retain their existing behavior');
futureOnly = true;
find(cutoffMount, node => node.props.title === 'Semana anterior').props.onclick(); await tick();
assert.equal(cutoffMetric().value, '—', 'future assignments alone cannot produce a current coverage percentage');
assert.equal(cutoffMetric().detail, 'Sin turnos asignados hasta hoy');
cutoffCleanup();
console.log('PASS: current-week coverage through today in Bogota, full-day inclusion, future exclusion, replacements, no eligible slots and other weeks.');
console.log('PASS: contracted people without assignments, weekly days since admission, ranking, missing dates, deduplication, assignment matching, errors and contract scope.');
console.log('PASS: descending alert counts, stable ties, four/seven toggle, live reranking and collapse on week/contract changes.');
console.log('PASS: missing incapacity supports, date overlap, contract scope, case deduplication, person ranking, exclusions, errors, races and disposal.');
console.log('PASS: unattended site days, distinct-date count, multi-shift grouping, attendance/replacement/pending exclusions, modal and selected-week scope.');
console.log('PASS: selected-week ranges and picker, historical headcount date, contract cutoff, coverage totals, replacements, empty states, races and cleanup.');
console.log('PASS: real monthly calendar, daily detail, selected-week/today markers, errors, retry and dismissal.');
console.log('PASS: review alert shares KPI count, shows date/person/site/reason without duplicate reasons and handles loading, empty, errors and selection changes.');
console.log('PASS: hiring shortages by active site, no surplus offset, contract/week scope, one-to-three site preview, more than three details, missing data and errors.');
console.log('PASS: absenteeism alert and full absence detail, grouped people/dates, sorted uncovered absences, consistent totals and replacement-only weeks.');
