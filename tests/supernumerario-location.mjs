import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { validateAttendanceLocation, attendanceRadius, selectAttendanceShift } from '../whatsapp-backend/src/attendance-location.js';

const source = await fs.readFile(new URL('../whatsapp-backend/src/app.js', import.meta.url), 'utf8');
const employee = { id: 'E', documento: '123', nombre: 'Supernumerario', isSupernumerario: true, marcacionMovil: false };
const sites = [
  { codigo: 'A', nombre: 'Sede A', estado: 'activo', contrato_codigo: 'C', qr_latitude: 4.6, qr_longitude: -74.1, qr_enabled: false },
  { codigo: 'B', nombre: 'Sede B', estado: 'activo', contrato_codigo: 'D', qr_latitude: 4.61, qr_longitude: -74.1, qr_enabled: true },
  { codigo: 'X', nombre: 'Sin permiso', estado: 'activo', contrato_codigo: 'X', qr_latitude: 4.62, qr_longitude: -74.1 },
  { codigo: 'OFF', nombre: 'Inactiva', estado: 'inactivo', contrato_codigo: 'C', qr_latitude: 4.6, qr_longitude: -74.1 }
];
const shifts = sites.map(site => ({ id: `T${site.codigo}`, sedeCodigo: site.codigo, sedeNombre: site.nombre, estado: 'abierto',
  startsAt: new Date(Date.now() - 3600000).toISOString(), endsAt: new Date(Date.now() + 3600000).toISOString() }));
let contracts = ['C', 'D'], open = [], available = shifts, session = {}, mark, qr, lastList, resolvedSite;
const messages = [];
const ctx = vm.createContext({
  SESSION: { AWAITING_QR_LOCATION: 'location', AWAITING_QR_ATTENDANCE_ACTION: 'action', AWAITING_MARKING_SITE: 'site', COMPLETED: 'completed' },
  MENU_IDS: { QR_ENTRY: 'qr_entry', QR_EXIT: 'qr_exit' },
  normalizeKey: value => value || '', normalizeDocument: value => value, normalizePhone: value => value,
  currentDate: () => '2026-09-22', addIsoDays: (date, days) => date,
  reloadEmployeeForAttendance: async () => employee, loadEmployeeFromSession: async () => employee,
  sessionEmployee: value => value, getSessionPhone: () => '123',
  storeSession: async (_phone, patch) => { session = { ...session, ...patch }; },
  sendText: async (_phone, text) => messages.push(text), sendButtons: async () => {},
  sendList: async (_phone, _text, _button, sections) => { lastList = sections; },
  isNamedLocation: loc => Boolean(loc.name || loc.address), validateAttendanceLocation, attendanceRadius, selectAttendanceShift,
  getScheduledShiftById: async id => shifts.find(shift => shift.id === id),
  getSedeByCode: async code => sites.find(site => site.codigo === code),
  listEmployeeShiftAssignmentsForRange: async () => [],
  listScheduledShiftsForOperationalDate: async (_day, { sedeCodigo }) => { resolvedSite = sedeCodigo; return available.filter(shift => shift.sedeCodigo === sedeCodigo); },
  validateQrActionAvailability: async () => {}, qrError: code => new Error(code),
  registerAttendanceEvent: async value => { mark = value; return { eventAt: new Date().toISOString() }; },
  sendAttendanceQr: async (...args) => { qr = args; },
  supabaseAdmin: {
    rpc: async (name, args) => name === 'supernumerario_contract_codes'
      ? { data: contracts } : { data: { mobile: false, sites: sites.filter(site => `T${site.codigo}` === args.p_shift_id) } },
    from: table => {
      let rows = table === 'sedes' ? sites : open;
      const query = {
        select: () => query, order: () => query,
        eq: (key, value) => { rows = rows.filter(row => row[key] === value); return query; },
        neq: (key, value) => { rows = rows.filter(row => row[key] !== value); return query; },
        in: (key, values) => { rows = rows.filter(row => values.includes(row[key])); return query; },
        not: (key, _op, value) => { rows = rows.filter(row => row[key] !== value); return query; },
        is: (key, value) => { rows = rows.filter(row => row[key] === value); return query; },
        limit: n => { rows = rows.slice(0, n); return query; },
        range: (from, to) => { rows = rows.slice(from, to + 1); return query; },
        then: resolve => resolve({ data: rows, error: null })
      };
      return query;
    }
  }
});
for (const [start, end] of [
  ['async function resolveAttendanceShift(', 'async function validateQrActionReady('],
  ['async function promptQrAttendanceAction(', 'function isNamedLocation(']
]) vm.runInContext(source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))), ctx);

const begin = async () => {
  session = {}; mark = null; qr = null; lastList = null;
  await ctx.promptQrAttendanceAction('123', employee);
  assert.equal(session.session_state, 'action', 'no base site required for a covering supernumerario');
  await ctx.handleQrAttendanceAction('123', session, { id: 'qr_entry' });
  assert.equal(session.session_state, 'location');
  assert.equal(session.session_data.pendingShiftId, null, 'resolve shift only after locating the site');
};
const location = site => ({ location: { latitude: site.qr_latitude, longitude: site.qr_longitude } });
await begin();
await ctx.handleQrLocationInput('123', session, location(sites[0]));
assert.equal(mark.tokenRow.sede_codigo, 'A');
assert.equal(mark.tokenRow.turno_id, 'TA');
assert.equal(resolvedSite, 'A');
assert.equal(lastList, null, 'one nearby site does not require a list');
assert.equal(qr, null);
await begin();
await ctx.handleQrLocationInput('123', session, location(sites[1]));
assert.equal(qr[3].codigo, 'B');
assert.equal(qr[5].id, 'TB');
assert.equal(mark, null);
await begin();
for (const input of [location(sites[2]), { ...location(sites[0]), forwarded: true }, { location: { ...location(sites[0]).location, name: 'Búsqueda' } }, {}]) {
  await ctx.handleQrLocationInput('123', session, input);
  assert.equal(mark, null); assert.equal(qr, null);
}
available = [];
await assert.rejects(ctx.handleQrLocationInput('123', session, location(sites[0])), /attendance_shift_missing/);
available = [...shifts, { ...shifts[0], id: 'OTHER' }];
await assert.rejects(ctx.handleQrLocationInput('123', session, location(sites[0])), /attendance_shift_ambiguous/);
available = shifts;
sites.push({ ...sites[0], codigo: 'NEAR', nombre: 'Sede cercana' });
shifts.push({ ...shifts[0], id: 'TNEAR', sedeCodigo: 'NEAR' });
await ctx.handleQrLocationInput('123', session, location(sites[0]));
assert.equal(session.session_state, 'site');
assert.equal(lastList[0].rows.length, 2);
assert.equal(mark, null);
await ctx.handleMarkingSiteSelection('123', session, { id: 'marking_site:NEAR' });
assert.equal(mark.tokenRow.sede_codigo, 'NEAR');
await begin();
await ctx.handleQrLocationInput('123', session, location(sites[0]));
contracts = [];
await ctx.handleMarkingSiteSelection('123', session, { id: 'marking_site:A' });
assert.equal(mark, null, 'recheck contracts after selecting nearby site');
await assert.rejects(ctx.validateSupernumerarioEntrySite(employee, 'A'), /attendance_site_forbidden/);
contracts = ['C', 'D'];
open = [{ id: 'OPEN', employee_id: 'E', scheduled_shift_id: 'TA', entrada_at: '2026-09-22T01:00:00Z', salida_at: null, estado_turno: 'trabajado' }];
await assert.rejects(begin(), /attendance_open_shift/);
await ctx.handleQrAttendanceAction('123', session, { id: 'qr_exit' });
assert.equal(session.session_data.pendingShiftId, 'TA', 'exit recovers the open shift without a site search');
await ctx.handleQrLocationInput('123', session, location(sites[1]));
assert.equal(mark, null, 'covering supernumerario exits at the working shift site');
await ctx.handleQrLocationInput('123', session, location(sites[0]));
assert.equal(mark.tokenRow.action, 'exit');
assert.equal(mark.tokenRow.turno_id, 'TA');
console.log('PASS: supernumerario location-first entry, direct/QR, authorized active sites, ambiguity, invalid locations, unavailable shifts, revoked contracts, open shift and location-validated exit.');
