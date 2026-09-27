import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { markingPhoneDetail, markingTimingDetail, markingSitesLabel, markingMethodLabel, markingDateTime, mergeAttendanceTracking, phoneInconsistencyDetail, carryOverMarkings } from '../src/assets/js/utils/attendanceTracking.js';

const date = '2026-09-08';
const marking = { employeeId: 'E', documento: '123', turnoId: 'T1', turnoNombre: 'Noche',
  fechaOperativa: '2026-09-07', entryAt: '2026-09-08T03:00:00Z', exitAt: '2026-09-08T11:00:00Z',
  entryMethod: 'location', exitMethod: 'qr', employeePhone: '3001111111', entryPhone: '3002222222', exitPhone: '3001111111',
  entryPhoneDifferent: true, exitPhoneDifferent: false };
assert.match(markingDateTime(marking.entryAt), /07\/09\/2026.*22:00:00/);
assert.match(markingDateTime(marking.exitAt), /08\/09\/2026.*06:00:00/);
assert.equal(markingMethodLabel('location'), 'WhatsApp');
assert.equal(markingMethodLabel('qr'), 'QR');
assert.equal(markingMethodLabel(null), 'Sin Identificar');
assert.equal(markingDateTime(null), '-');
assert.equal(markingSitesLabel({ tracking: { entrySiteName: 'Visita A', exitSiteName: 'Visita B' } }), 'Sede de ingreso: Visita A · Sede de salida: Visita B');
assert.match(phoneInconsistencyDetail(marking), /Ingreso: 3002222222/);
assert.doesNotMatch(phoneInconsistencyDetail(marking), /Salida:/);
assert.match(phoneInconsistencyDetail({ ...marking, exitPhoneDifferent: true }), /Salida:/);
assert.equal(phoneInconsistencyDetail({}), '');
assert.equal(phoneInconsistencyDetail(null), '');
assert.equal(markingPhoneDetail(marking, 'entry'), 'Celular diferente al registrado');
assert.equal(markingPhoneDetail(marking, 'exit'), 'Sin diferencia detectada');
assert.match(markingPhoneDetail({ ...marking, employeePhone: null }), /No se puede comparar/);
assert.match(markingPhoneDetail({ ...marking, entryPhone: null }), /Sin Identificar/);
assert.equal(markingPhoneDetail({}, 'exit'), 'Sin registro');
assert.equal(mergeAttendanceTracking([{ empleadoId: 'C', asistio: true, novedad: '7', createdAt: marking.entryAt }], [], date)[0].tracking, null);
const attendance = [
  { id: 'A1', empleadoId: 'E', turnoId: 'T1', asistio: true },
  { id: 'A2', empleadoId: 'E', turnoId: 'T2', asistio: true },
  { id: 'N', empleadoId: 'N', asistio: false, novedad: '3', createdAt: marking.entryAt }
];
const rows = mergeAttendanceTracking(attendance, [marking, { ...marking, turnoId: 'T2', entryMethod: 'qr' }], date);
assert.equal(rows.length, 3);
assert.equal(rows[0].tracking.entryMethod, 'location');
assert.equal(rows[1].tracking.entryMethod, 'qr');
assert.equal(rows[2].tracking, null, 'a novelty report must not become an entry');
const fastUpdate = mergeAttendanceTracking([], [marking], date);
assert.equal(fastUpdate[0].fechaOperativa, '2026-09-07');
assert.equal(carryOverMarkings([marking], date).length, 1);
assert.equal(carryOverMarkings([marking], '2026-09-09').length, 0);
assert.equal(carryOverMarkings([{ ...marking, exitAt: null }], date).length, 1);

const source = await fs.readFile(new URL('../src/assets/js/components/WhatsAppLive.js', import.meta.url), 'utf8');
let modal;
const node = (tag, props = {}, children = []) => ({ tag, props, children, handlers: {},
  addEventListener(name, callback) { this.handlers[name] = callback; } });
const context = vm.createContext({ el: node, markingTimingDetail, markingSitesLabel, markingMethodLabel, markingDateTime, phoneInconsistencyDetail,
  lucideInlineIcon: name => node('icon', { name }), showInfoModal: (...args) => { modal = args; },
  attendanceView: () => ({ rowClass: 'normal', novedadStyle: '', novedadText: 'Trabajando' }),
  rowStyleByClass: () => '', diasNode: () => '-', replacementNode: () => 'No aplica', infoButtonForRow: () => node('button') });
const begin = source.indexOf('  function markingNode(');
const end = source.indexOf('  function pendingRecordCard(', begin);
vm.runInContext(source.slice(begin, end), context);
const record = { ...fastUpdate[0], nombre: 'Ana', tracking: marking };
const table = context.attendanceTableRow(record, new Map());
assert.equal(table.children.length, 9);
const text = JSON.stringify(table);
assert.match(text, /WhatsApp/); assert.match(text, /QR/);
assert.match(text, /07\/09\/2026/); assert.match(text, /08\/09\/2026/);
const alert = context.phoneAlert(record);
assert.equal(alert.props.type, 'button');
assert.match(alert.props['aria-label'], /Ingreso/);
alert.handlers.click();
assert.equal(modal[0], 'Inconsistencia de celular');
assert(Array.isArray(modal[1]));
assert.match(modal[1].join(' '), /Celular de salida/);
assert.equal(context.phoneAlert({ tracking: {} }), null);
assert.equal(context.phoneAlert({ tracking: null }), null);
assert.equal(context.phoneAlert({ tracking: { ...marking, entryPhoneDifferent: false } }), null);
assert.match(context.phoneAlert({ tracking: { ...marking, entryPhoneDifferent: false, exitPhoneDifferent: true } }).props.title, /Salida:/);
assert.doesNotThrow(() => context.attendanceTableRow({ nombre: 'Novedad', tracking: null }, new Map()));
assert.match(JSON.stringify(context.attendanceCard(record, new Map())), /WhatsApp/);

const explained = { ...record, tracking: { ...marking, entryTimingAlert: 'entrada_tardia', entryReason: 'Demora del bus <texto>',
  entryControlRequired: false, exitTimingAlert: 'salida_tardia', exitControlRequired: true, exitReason: 'Entrega de turno' } };
const orange = context.markingNode(explained, 'entry').children[0];
assert.equal(orange.props.className, 'marking-time marking-time--comment');
assert.match(orange.props.title, /Solo explicación.*\nMotivo: Demora del bus <texto>/);
assert.equal(orange.props.innerHTML, undefined, 'employee text is never interpreted as HTML');
const red = context.markingNode(explained, 'exit').children[0];
assert.equal(red.props.className, 'marking-time marking-time--control');
assert.match(red.props.title, /Atención del turno/);
red.handlers.click();
assert.match(modal[1].join(' '), /Entrega de turno/);
assert.match(JSON.stringify(context.attendanceCard(explained, new Map())), /marking-time--comment/);

// The information button must use the same reference phone as the alert.
const infoContext = vm.createContext({ el: node, infoIcon: () => node('icon'), markingTimingDetail, markingPhoneDetail,
  markingDateTime, markingMethodLabel, phoneInconsistencyDetail, today: date,
  employeeInfoSnapshot: () => ({ nombre: 'Ana', telefono: 'outdated-local-phone' }),
  detailSection: (title, items) => node('section', { title }, items),
  showInfoModal: (...args) => { modal = args; }, displayNovedad: () => 'Trabajando' });
const infoStart = source.indexOf('  function infoButtonForRow(');
vm.runInContext(source.slice(infoStart, source.indexOf('  function pendingEmployeesForToday(', infoStart)), infoContext);
infoContext.infoButtonForRow(record).handlers.click();
const infoSections = modal[1][0].children;
assert.equal(infoSections[0].children.find(([label]) => label === 'Celular registrado')[1], marking.employeePhone);
assert.equal(infoSections.find(section => section.props.title === 'Ingreso').children.find(([label]) => label === 'Control de celular')[1].props.className, 'text-danger');
assert.match(JSON.stringify(infoSections), /Inconsistencia de celular/);
assert.doesNotMatch(JSON.stringify(infoSections), /outdated-local-phone/);
infoContext.infoButtonForRow({ ...record, tracking: { ...marking, employeePhone: null } }).handlers.click();
assert.equal(modal[1][0].children[0].children.find(([label]) => label === 'Celular registrado')[1], 'Sin Identificar');

const backendSource = await fs.readFile(new URL('../whatsapp-backend/src/app.js', import.meta.url), 'utf8');
const comparison = vm.createContext({});
for (const name of ['normalizePhone', 'isDifferentQrPhone']) {
  const start = backendSource.indexOf(`function ${name}(`);
  vm.runInContext(backendSource.slice(start, backendSource.indexOf('\n}', start) + 2), comparison);
}
assert.equal(comparison.isDifferentQrPhone('573001111111', '3001111111'), false);
assert.equal(comparison.isDifferentQrPhone('+57 300 111 1111', '3001111111'), false);
assert.equal(comparison.isDifferentQrPhone('3002222222', '3001111111'), true);
assert.equal(comparison.isDifferentQrPhone(null, '3001111111'), false);
assert.equal(comparison.isDifferentQrPhone('3002222222', null), false);
assert.match(markingTimingDetail({ entryTimingAlert: 'entrada_anticipada' }).reason, /Pendiente/);
assert.equal(markingTimingDetail({}), null);
assert.equal(mergeAttendanceTracking([{ empleadoId: 'E', asistio: true, timingAlertType: 'entrada_tardia', employeeReason: 'Bus', timingControlRequired: false }], [], date)[0].tracking.entryReason, 'Bus');

// Live source joins out-of-order updates, and rejects callbacks from replaced subscriptions.
const callbacks = new Map();
let cancelled = 0;
const streams = vm.createContext({ today: date, previousDay: '2026-09-07', carryOverMarkings,
  unAttendance: null, unTracking: null, unReplacements: null, unDailyMetrics: null, trackingGeneration: 0,
  updateModeHint() {}, render() {}, deps: {
    streamDailyQrRecords(day, callback) { callbacks.set(day, callback); return () => cancelled++; },
    streamAttendanceByDate() { return () => {}; }, streamImportReplacementsByDate() { return () => {}; }
  } });
const bindStart = source.indexOf('  function bindDateStreams(');
vm.runInContext(source.slice(bindStart, source.indexOf('\n  searchInput.addEventListener', bindStart)), streams);
streams.bindDateStreams();
callbacks.get('2026-09-07')({ rows: [marking], pendingRows: [] });
callbacks.get(date)({ rows: [], pendingRows: [{ turnoId: 'T3' }] });
assert.equal(streams.trackingRows.length, 1);
assert.equal(streams.trackingPending[0].turnoId, 'T3');
const oldCallback = callbacks.get(date);
streams.bindDateStreams();
assert.equal(cancelled, 2);
oldCallback({ rows: [marking], pendingRows: [] });
assert.equal(streams.trackingRows.length, 0);

console.log('PASS: daily per-shift merge, midnight dates, WhatsApp/QR methods, novelty preservation, phone alert detail, desktop/mobile rendering and live cleanup.');
