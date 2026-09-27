import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { PGlite } from '@electric-sql/pglite';
import { attendanceRadius, validateAttendanceLocation, selectAttendanceShift } from '../whatsapp-backend/src/attendance-location.js';

const site = { qr_latitude: 4.6, qr_longitude: -74.1 };
assert.equal(attendanceRadius(site), 200);
assert.equal(attendanceRadius({ qr_radius_meters: 150 }), 150);
assert.equal(validateAttendanceLocation({ latitude: 4.6, longitude: -74.1 }, site).ok, true);
const north = meters => ({ latitude: 4.6 + meters / 6371000 * 180 / Math.PI, longitude: -74.1 });
assert.equal(validateAttendanceLocation(north(199.9), site).ok, true);
assert.equal(validateAttendanceLocation(north(200.1), site).ok, false, 'do not round before enforcing radius');
for (const value of [null, '', NaN, 91]) {
  assert.equal(validateAttendanceLocation(north(0), { ...site, qr_latitude: value }).ok, false);
  assert.equal(validateAttendanceLocation({ latitude: value, longitude: -74.1 }, site).ok, false);
}
const night = { id: 'night', estado: 'abierto', startsAt: '2026-09-07T03:00:00Z', endsAt: '2026-09-07T11:00:00Z' };
assert.equal(selectAttendanceShift([night], '2026-09-07T05:30:00Z').id, 'night');
assert.throws(() => selectAttendanceShift([night, { ...night, id: 'other' }], '2026-09-07T05:30:00Z'), /ambiguous/);
assert.throws(() => selectAttendanceShift([night], '2026-09-07T12:00:00Z'), /missing/);

// Exercise actual WhatsApp branching with adapters, including proof rejections.
const appSource = await fs.readFile(new URL('../whatsapp-backend/src/app.js', import.meta.url), 'utf8');
const start = appSource.indexOf('async function handleQrLocationInput(');
const end = appSource.indexOf('\nfunction isNamedLocation', start);
let qrCount = 0, directCount = 0;
const messages = [];
const employee = { id: 'E', documento: '123', sede_codigo: 'S', nombre: 'Ana' };
const shift = { id: 'T', sedeCodigo: 'S', fechaOperativa: '2026-09-06', nombre: 'Noche' };
const sede = { ...site, codigo: 'S', nombre: 'Sede', qr_enabled: false };
const context = vm.createContext({
  loadEmployeeFromSession: async () => employee, getSedeByCode: async () => sede,
  supabaseAdmin: { rpc: async () => ({ data: { mobile: false, sites: [sede] }, error: null }) },
  validateAttendanceLocation, getScheduledShiftById: async () => shift,
  selectAttendanceShift: () => shift, validateQrActionAvailability: async () => {},
  sendAttendanceQr: async () => { qrCount++; },
  registerAttendanceEvent: async args => { directCount++; assert.equal(args.method, 'location'); assert.equal(args.tokenRow.turno_id, 'T'); return { eventAt: new Date().toISOString() }; },
  storeSession: async () => {}, sendText: async (_phone, message) => messages.push(message),
  isNamedLocation: loc => Boolean(loc.name || loc.address), normalizeDocument: x => x, normalizePhone: x => x,
  sessionEmployee: x => x, getSessionPhone: () => '123', SESSION: { COMPLETED: 'completed' }
});
vm.runInContext(appSource.slice(start, end), context);
const session = { session_data: { pendingQrAction: 'entry', pendingShiftId: 'T' } };
await context.handleQrLocationInput('123', session, { location: north(0) });
assert.equal(directCount, 1); assert.equal(qrCount, 0);
sede.qr_enabled = true;
await context.handleQrLocationInput('123', session, { location: north(0) });
assert.equal(directCount, 1); assert.equal(qrCount, 1);
for (const input of [{ location: north(201) }, { location: north(0), forwarded: true }, { location: { ...north(0), name: 'Lugar' } }, {}]) {
  await context.handleQrLocationInput('123', session, input);
}
assert.equal(directCount, 1); assert.equal(qrCount, 1);

// Mobile WhatsApp: physical site selection, ambiguity, expiry and policy revalidation.
const mobileSession = { session_data: { pendingQrAction: 'entry', pendingShiftId: 'T' } };
let mobileSites = [{ ...sede, codigo: 'V1', nombre: 'Visita 1', qr_enabled: false }];
context.supabaseAdmin.rpc = async () => ({ data: { mobile: true, sites: mobileSites } });
context.storeSession = async (_phone, patch) => Object.assign(mobileSession, patch);
context.sendList = async (_phone, _body, _button, sections) => { context.lastList = sections; };
context.SESSION.AWAITING_MARKING_SITE = 'awaiting_marking_site';
context.SESSION.AWAITING_QR_LOCATION = 'awaiting_qr_location';
context.qrError = code => new Error(code);
let lastMark;
context.registerAttendanceEvent = async args => { lastMark = args; return { eventAt: new Date().toISOString() }; };
await context.handleQrLocationInput('123', mobileSession, { location: north(0) });
assert.equal(lastMark.tokenRow.sede_codigo, 'V1');
assert.equal(lastMark.tokenRow.turno_id, 'T', 'keep administrative shift');
mobileSession.session_data = { pendingQrAction: 'exit', pendingShiftId: 'T' };
mobileSites.push({ ...mobileSites[0], codigo: 'V2', nombre: 'Visita 2' });
lastMark = null;
await context.handleQrLocationInput('123', mobileSession, { location: north(0) });
assert.equal(lastMark, null, 'do not choose an ambiguous location arbitrarily');
assert.equal(mobileSession.session_state, 'awaiting_marking_site');
assert.equal(context.lastList[0].rows.length, 2);
await context.handleMarkingSiteSelection('123', mobileSession, { id: 'marking_site:OUT' });
assert.equal(lastMark, null);
await context.handleMarkingSiteSelection('123', mobileSession, { id: 'marking_site:V2' });
assert.equal(lastMark.tokenRow.sede_codigo, 'V2');
assert.equal(lastMark.tokenRow.action, 'exit');
mobileSession.session_data = { pendingQrAction: 'exit', pendingShiftId: 'T' };
await context.handleQrLocationInput('123', mobileSession, { location: north(0) });
mobileSession.session_data.markingVerifiedAt = new Date(Date.now() - 6 * 60000).toISOString();
lastMark = null;
await context.handleMarkingSiteSelection('123', mobileSession, { id: 'marking_site:V2' });
assert.equal(lastMark, null);
assert.equal(mobileSession.session_state, 'awaiting_qr_location');
await context.handleQrLocationInput('123', mobileSession, { location: north(0) });
mobileSites = [mobileSites[0]]; // permissions changed while choosing
await context.handleMarkingSiteSelection('123', mobileSession, { id: 'marking_site:V2' });
assert.equal(lastMark, null);

// The scanner must resolve the administrative shift, not the visited site's shifts.
mobileSites = Array.from({ length: 12 }, (_, index) => ({ ...sede, codigo: `PAGE${index}`, nombre: `Sede ${index}` }));
await context.handleQrLocationInput('123', mobileSession, { location: north(0) });
await context.handleMarkingSiteSelection('123', mobileSession, { id: 'marking_site:more' });
assert.equal(mobileSession.session_state, 'awaiting_marking_site');
assert.equal(context.lastList[0].rows.length, 4, 'three remaining sites and next-page action');
let resolvedSite;
const registrationStart = appSource.indexOf('async function registerAttendanceEvent(');
const registrationEnd = appSource.indexOf('\nasync function registerQrEntry', registrationStart);
const registration = vm.createContext({
  getScheduledShiftById: async () => shift,
  attendanceSiteOptions: async () => ({ mobile: true, sites: [{codigo:'V2'}] }),
  reloadEmployeeForAttendance: async () => employee,
  validateSupernumerarioEntrySite: async () => {},
  resolveAttendanceShift: async (_emp, site) => { resolvedSite=site; return shift; },
  classifyShiftEventTime: () => ({ status:'normal',minutes:0 }),
  resolveBackendContractContext: async ({sedeCodigo}) => { assert.equal(sedeCodigo,'S'); return {contrato_codigo:'C'}; },
  supabaseAdmin: {rpc: async (_name,{p_event}) => { assert.equal(p_event.sede_codigo,'V2'); assert.equal(p_event.turno_id,'T'); return {data:{status:'entry_registered'},error:null}; }},
  refreshOperationalState: async () => {}, qrError: code => new Error(code)
});
vm.runInContext(appSource.slice(registrationStart,registrationEnd),registration);
await registration.registerAttendanceEvent({tokenRow:{action:'entry',employee_id:'E',turno_id:'T',sede_codigo:'V2'},employee});
assert.equal(resolvedSite,'S');

const reportData = {
  attendance_qr_tokens: [], employee_daily_exits: [{ employee_id: 'E', documento: '123', turno_id: 'T1', sede_codigo: 'S',
    marking_sede_codigo: 'VISIT2', marking_sede_nombre: 'Segunda sede', exit_at: '2026-09-07T10:00:00Z', marking_method: 'qr',
    timing_alert_type: 'salida_tardia', timing_control_required: true, employee_reason: 'Entrega de turno' }], incapacitados: [],
  // An administrative record (vacaciones/compensatorio/incapacidad) for the day must win over a stray shift
  // assignment that was never cancelled: F has both a 'compensatorio' day and a live, unfinished shift T4.
  employee_daily_status: [{ employee_id: 'F', documento: '456', nombre: 'Miguel', sede_codigo: 'S', estado_dia: 'compensatorio', servicio_programado: false }],
  sedes: [{ codigo: 'S', nombre: 'Sede', estado: 'activo', qr_enabled: false }],
  cargos: [{ codigo: 'SUP', nombre: 'Supernumerario', alineacion_crud: 'supernumerario' }],
  // Supernumerarios have no scheduled_shifts row and no employee_daily_status row: SUP1 (on-call, unregistered
  // today) must still surface as pending; SUP2 (retired before the operational date) must not.
  employees: [{ id: 'E', documento: '123', nombre: 'Ana' }, { id: 'F', documento: '456', nombre: 'Miguel' },
    { id: 'SUP1', documento: '999888', nombre: 'Supernumerario Generico', telefono: '3000000000', estado: 'activo', cargo_codigo: 'SUP', sede_codigo: 'S' },
    { id: 'SUP2', documento: '999777', nombre: 'Supernumerario Retirado', estado: 'inactivo', cargo_codigo: 'SUP', sede_codigo: 'S', fecha_retiro: '2026-09-01' }],
  attendance: ['T1','T2'].map((turno_id, i) => ({ id: `A${i}`, empleado_id: 'E', documento: '123', nombre: 'Ana',
    sede_codigo: 'S', marking_sede_codigo: 'VISIT', marking_sede_nombre: 'Sede visitada', turno_id, asistio: true, novedad: '1', marking_method: 'location',
    reported_at: `2026-09-07T${i ? '15' : '05'}:00:00Z`, request_distance_meters: i ? 100 : 50 })),
  // T3's assignment keeps a stale snapshot (from when it was created); the current employees row must win.
  shift_assignments: [...['T1','T2','T3'].map(id => ({ employee_id: 'E', documento: id === 'T3' ? '999' : '123', nombre: id === 'T3' ? 'Ana Antigua' : 'Ana', estado: 'asignado',
    scheduled_shifts: { id, nombre: id, sede_codigo: 'S', estado: 'abierto' } })),
    { employee_id: 'F', documento: '456', nombre: 'Miguel', estado: 'asignado', scheduled_shifts: { id: 'T4', nombre: 'T4', sede_codigo: 'S', estado: 'programado' } }],
  employee_shift_status: ['T1','T2'].map(scheduled_shift_id => ({ scheduled_shift_id, employee_id: 'E', entrada_at: '2026-09-07T05:00:00Z' }))
};
const reportContext = vm.createContext({
  supabaseAdmin: { from(table) {
    const query = new Proxy({}, { get: (_target, method) => method === 'then'
      ? resolve => Promise.resolve(resolve({ data: reportData[table] || [], error: null })) : () => query });
    return query;
  } },
  NOVELTIES: { WORKING: { code: '1' } }, noveltyLabelByCode: () => null,
  dailyStatusLabel: (estado) => ({ incapacidad: 'Incapacidad', vacaciones: 'Vacaciones', compensatorio: 'Compensatorio' })[String(estado || '').trim().toLowerCase()] || '',
  isDifferentQrPhone: () => false
});
const reportStart = appSource.indexOf('async function listDailyQrRecords(');
// Slice through isPersonActiveForDate/toDateOnly too (declared right after listDailyQrRecords, before
// isDifferentQrPhone, which the context injects instead) so the real supernumerario eligibility logic runs.
vm.runInContext(appSource.slice(reportStart, appSource.indexOf('\nfunction isDifferentQrPhone(', reportStart)), reportContext);
const report = await reportContext.listDailyQrRecords('2026-09-07');
assert.equal(report.rows.length, 3, 'each shift must retain its own row, plus the compensatorio day for F');
const miguelRow = report.rows.find((row) => row.nombre === 'Miguel');
assert.equal(miguelRow.entryLabel, 'Compensatorio', 'the administrative record shows in the main list too');
assert.equal(report.rows[0].entryMethod, 'location');
assert.equal(report.rows[0].exitTimingAlert, 'salida_tardia');
assert.equal(report.rows[0].exitControlRequired, true);
assert.equal(report.rows[0].exitReason, 'Entrega de turno');
assert.equal(report.rows[0].entrySiteCode, 'VISIT');
assert.equal(report.rows[0].exitSiteCode, 'VISIT2');
assert.equal(report.rows[0].sedeCodigo, 'S');
assert.equal(report.rows[0].entryDistanceMeters, 50);
assert.equal(report.rows[1].entryDistanceMeters, 100);
assert.equal(report.pendingRows.length, 2, 'completed shifts must not hide next assigned shift, nor an on-call supernumerario');
const nextShiftPending = report.pendingRows.find((row) => row.turnoId === 'T3');
assert(nextShiftPending, 'the next assigned shift is still pending');
assert.equal(nextShiftPending.documento, '123', 'a stale assignment snapshot must not hide the employee\'s current documento');
assert.equal(nextShiftPending.nombre, 'Ana', 'nor the current name');
// Supernumerarios cover on demand: no scheduled_shifts row, no employee_daily_status row. Gathered separately by
// cargo alignment, they must still surface as pending (unregistered on-call staff) unless already retired.
const supernumerarioPending = report.pendingRows.find((row) => row.employeeId === 'SUP1');
assert(supernumerarioPending, 'an on-call, unregistered supernumerario is pending too');
assert.equal(supernumerarioPending.isSupernumerario, true);
assert.equal(supernumerarioPending.nombre, 'Supernumerario Generico');
assert.equal(supernumerarioPending.documento, '999888');
assert(!report.pendingRows.some((row) => row.employeeId === 'SUP2'), 'a supernumerario retired before the operational date is not pending');
assert(!report.pendingRows.some((row) => row.employeeId === 'F'), 'an employee on compensatorio wins over a shift assignment nobody cancelled');

for (const name of ['HistoricalQrRegistry']) {
  const source = await fs.readFile(new URL(`../src/assets/js/components/${name}.js`, import.meta.url), 'utf8');
  const cardStart = source.indexOf('  function recordCard(');
  const cardEnd = source.indexOf('\n  }', cardStart) + 4;
  const screen = vm.createContext({ el: (tag, props, children) => ({ tag, props, children }) });
  vm.runInContext(source.slice(cardStart, cardEnd), screen);
  const props = { title: 'Ana', subtitle: '123', markingMethod: 'location', meta: [['Turno','Noche']] };
  const card = screen.recordCard(props);
  assert.equal(card.tag, 'article');
  assert.match(JSON.stringify(card), /Ubicacion/);
}

// PostgreSQL transaction tests, with the existing table shapes used by phase 54.
const db = new PGlite();
try {
  const common = 'id text primary key, fecha text, documento text, nombre text, sede_codigo text, sede_nombre text, turno_id uuid, fecha_operativa text, registro_estado text, requires_review boolean default false, contrato_codigo text, contrato_nombre text, cliente_nombre_snapshot text, cliente_nit_snapshot text';
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table sedes(codigo text primary key, estado text, qr_enabled boolean default false, qr_latitude double precision, qr_longitude double precision, qr_radius_meters integer default 500);
    create table employees(id uuid primary key, documento text, nombre text, estado text);
    create table scheduled_shifts(id uuid primary key, sede_codigo text, sede_nombre text, fecha_operativa text, starts_at timestamptz, ends_at timestamptz, estado text, opened_at timestamptz, closed_at timestamptz);
    create table attendance(${common}, empleado_id uuid, asistio boolean default false, novedad text, reported_at timestamptz, early_entry_minutes integer default 0, late_entry_minutes integer default 0);
    create table employee_daily_exits(${common}, employee_id uuid, qr_token_id uuid, device_id uuid, entry_attendance_id text references attendance(id), exit_at timestamptz, early_exit_minutes integer default 0, late_exit_minutes integer default 0);
    create table employee_shift_status(id text primary key, scheduled_shift_id uuid, fecha_operativa text, employee_id uuid, documento text, nombre text, sede_codigo text,
      estado_turno text default 'programado', asistio boolean default false, entrada_at timestamptz, salida_at timestamptz, source_attendance_id text references attendance(id), source_exit_id text references employee_daily_exits(id),
      novedad_codigo text, novedad_nombre text, early_entry_minutes integer default 0, late_entry_minutes integer default 0, early_exit_minutes integer default 0, late_exit_minutes integer default 0,
      requires_review boolean default false, closed boolean default false, contrato_codigo text, contrato_nombre text, cliente_nombre_snapshot text, cliente_nit_snapshot text);
    create table attendance_qr_tokens(id uuid primary key, turno_id uuid, employee_id uuid, action text, sede_codigo text, used_at timestamptz, expires_at timestamptz, request_latitude double precision, request_longitude double precision, location_verified_at timestamptz, used_by_device_id uuid);
    create table sede_devices(id uuid primary key, sede_codigo text, estado text, revoked_at timestamptz);
    create table sede_device_sites(device_id uuid, sede_codigo text);
    insert into sedes values ('S','activo',false,4.6,-74.1,500),('CUSTOM','activo',false,4.6,-74.1,150);
  `);
  const migration = await fs.readFile(new URL('../supabase/schema_operations_phase54_shift_attendance.sql', import.meta.url), 'utf8');
  await db.exec(migration); await db.exec(migration);
  assert.deepEqual((await db.query('select qr_radius_meters from sedes order by codigo')).rows.map(r => r.qr_radius_meters), [150, 200]);
  const emp = '00000000-0000-0000-0000-000000000001';
  const other = '00000000-0000-0000-0000-000000000002';
  const t1 = '10000000-0000-0000-0000-000000000001';
  const t2 = '10000000-0000-0000-0000-000000000002';
  const t3 = '10000000-0000-0000-0000-000000000003';
  await db.query("insert into employees values($1,'123','Ana','activo'),($2,'456','Luis','activo')", [emp, other]);
  for (const id of [t1,t2,t3]) await db.query("insert into scheduled_shifts values($1,'S','Sede','2026-09-06',now()-interval '1 hour',now()+interval '1 hour','programado',null,null)", [id]);
  const event = (action, turn = t1, employeeId = emp) => ({ action, method: 'location', turno_id: turn, employee_id: employeeId,
    sede_codigo: 'S', whatsapp_recipient: 'threshold-tests', request_latitude: 4.6, request_longitude: -74.1, location_verified_at: new Date().toISOString(),
    classification: { status: 'normal', minutes: 0, requiresReview: false } });
  const mark = payload => db.query('select register_shift_attendance($1::jsonb) as result', [JSON.stringify(payload)]);
  await assert.rejects(mark(event('exit')), /exit_requires_entry/);
  await assert.rejects(mark({ ...event('entry'), request_latitude: 4.7 }), /location_outside/);
  await mark(event('entry'));
  await assert.rejects(mark(event('entry')), /entry_exists/);
  await mark(event('exit'));
  await assert.rejects(mark(event('exit')), /exit_exists/);
  await mark(event('entry',t2));
  assert.equal((await db.query('select count(*)::int as n from attendance')).rows[0].n, 2, 'two shifts on the same operational date');
  const closed = await db.query('select finalize_shift_attendance($1) as statuses', [t2]);
  assert.equal(closed.rows[0].statuses[0].estado_turno, 'salida_pendiente');
  assert.equal(closed.rows[0].statuses[0].salida_at, null, 'closure never fabricates exit time');
  await mark(event('exit', t2));
  assert.equal((await db.query('select estado_turno from employee_shift_status where scheduled_shift_id=$1',[t2])).rows[0].estado_turno, 'post_cierre_pendiente');
  await db.query('select finalize_shift_attendance($1)', [t2]);
  assert.ok((await db.query('select salida_at from employee_shift_status where scheduled_shift_id=$1',[t2])).rows[0].salida_at);
  assert.equal((await db.query('select count(*)::int as n from attendance_qr_tokens')).rows[0].n, 0, 'location mode never needs a QR token');
  await db.exec("update sedes set qr_enabled=true where codigo='S'");
  await assert.rejects(mark(event('entry',t3)), /qr_disabled/);
  const token = '20000000-0000-0000-0000-000000000001';
  const device = '30000000-0000-0000-0000-000000000001';
  await db.query("insert into sede_devices values($1,'S','activo',null)", [device]);
  await db.query("insert into attendance_qr_tokens values($1,$2,$3,'entry','S',null,now()+interval '10 minutes',4.6,-74.1,now(),null)", [token,t3,emp]);
  const qr = { ...event('entry',t3), method: 'qr', qr_token_id: token, device_id: device };
  await db.exec("alter table employee_shift_status add constraint simulated_failure check(scheduled_shift_id <> '10000000-0000-0000-0000-000000000003')");
  await assert.rejects(mark(qr), /simulated_failure/);
  assert.equal((await db.query('select used_at from attendance_qr_tokens')).rows[0].used_at, null, 'failed transaction leaves QR usable');
  assert.equal((await db.query('select count(*)::int as n from attendance where turno_id=$1',[t3])).rows[0].n, 0, 'no partial attendance after failure');
  await db.exec('alter table employee_shift_status drop constraint simulated_failure');
  await mark(qr);
  await assert.rejects(mark(qr), /qr_used/);
  assert.ok((await db.query('select used_at from attendance_qr_tokens')).rows[0].used_at);
  assert.equal((await db.query("select has_function_privilege('authenticated','register_shift_attendance(jsonb)','EXECUTE') as allowed")).rows[0].allowed, false);
  await db.exec(`
    create table cargos(codigo text primary key, alineacion_crud text);
    create table supervisor_profile(documento text primary key,zona_codigo text);
    create table employee_cargo_history(employee_id uuid,cargo_codigo text,fecha_ingreso date,fecha_retiro date,created_at timestamptz default now());
    create table shift_assignments(scheduled_shift_id uuid,employee_id uuid,documento text,estado text);
    alter table employees add column cargo_codigo text, add column zona_codigo text;
    alter table sedes add column nombre text, add column zona_codigo text, add column contrato_codigo text;
    alter table scheduled_shifts add column contrato_codigo text, add column contrato_nombre text, add column cliente_nombre_snapshot text, add column cliente_nit_snapshot text;
    insert into cargos values('SUP','supervisor'),('FIX','empleado');
    update employees set cargo_codigo='FIX',zona_codigo='BASE';
    update sedes set nombre=codigo,zona_codigo='BASE',contrato_codigo='C';
    update scheduled_shifts set contrato_codigo='C';
    insert into supervisor_profile values('123','Z');
    update employees set cargo_codigo='SUP' where documento='123';
    insert into sedes(codigo,nombre,estado,qr_enabled,qr_latitude,qr_longitude,qr_radius_meters,zona_codigo,contrato_codigo) values
      ('V1','Visita uno','activo',false,4.6,-74.1,200,'Z','C'),
      ('V2','Visita dos','activo',true,4.61,-74.1,200,'Z','C'),
      ('OUT','Otra zona','activo',false,4.6,-74.1,200,'OTHER','C'),
      ('CONTRACT','Otro contrato','activo',false,4.6,-74.1,200,'Z','D'),
      ('OFF','Inactiva','inactivo',false,4.6,-74.1,200,'Z','C');
  `);
  const mobileMigration = await fs.readFile(new URL('../supabase/schema_operations_phase60_mobile_attendance.sql', import.meta.url), 'utf8');
  await db.exec(mobileMigration); await db.exec(mobileMigration);
  assert.equal((await db.query("select marcacion_movil from cargos where codigo='SUP'")).rows[0].marcacion_movil, false);
  const t4 = '10000000-0000-0000-0000-000000000004';
  const t5 = '10000000-0000-0000-0000-000000000005';
  for (const id of [t4,t5]) {
    await db.query("insert into scheduled_shifts(id,sede_codigo,sede_nombre,fecha_operativa,starts_at,ends_at,estado,contrato_codigo) values($1,'S','Administrativa','2026-09-06',now()-interval '1 hour',now()+interval '1 hour','programado','C')", [id]);
    await db.query("insert into shift_assignments values($1,$2,'123','asignado')",[id,emp]);
  }
  const mobileEvent = (action, turn=t4) => ({ ...event(action,turn), sede_codigo:'V1' });
  await assert.rejects(mark(mobileEvent('entry')), /attendance_site_forbidden/, 'disabled cargo remains fixed');
  await db.exec("update cargos set marcacion_movil=true where codigo='SUP'");
  const options = (await db.query('select attendance_site_options($1,$2) as value',[emp,t4])).rows[0].value;
  assert.equal(options.mobile,true);
  assert.deepEqual(options.sites.map(s=>s.codigo).sort(),['V1','V2'],'profile zone overrides employee base zone; restrict contract and active sites');
  // Close the earlier fixed-site shift before opening a mobile one.
  await db.exec("update employee_shift_status set salida_at=now() where salida_at is null");
  for (const siteCode of ['S','OUT','CONTRACT','OFF']) await assert.rejects(mark({...mobileEvent('entry'),sede_codigo:siteCode}),/attendance_site_forbidden/);
  await assert.rejects(mark({...mobileEvent('entry'),request_latitude:4.7}),/location_outside/);
  await db.query("update shift_assignments set estado='cancelado' where scheduled_shift_id=$1",[t4]);
  await assert.rejects(mark(mobileEvent('entry')),/attendance_shift_missing/);
  await db.query("update shift_assignments set estado='asignado' where scheduled_shift_id=$1",[t4]);
  await mark(mobileEvent('entry'));
  const entry = (await db.query('select sede_codigo,marking_sede_codigo,contrato_codigo from attendance where turno_id=$1',[t4])).rows[0];
  assert.deepEqual(entry,{sede_codigo:'S',marking_sede_codigo:'V1',contrato_codigo:'C'});
  await assert.rejects(mark(mobileEvent('entry')),/entry_exists/);
  await assert.rejects(mark(mobileEvent('entry',t5)),/attendance_open_shift/);
  await assert.rejects(mark({...mobileEvent('exit'),sede_codigo:'V2',request_latitude:4.61}),/qr_disabled/);
  const mobileToken='20000000-0000-0000-0000-000000000002';
  await db.query("insert into attendance_qr_tokens values($1,$2,$3,'exit','V2',null,now()+interval '10 minutes',4.61,-74.1,now(),null)",[mobileToken,t4,emp]);
  const mobileQr={...mobileEvent('exit'),method:'qr',sede_codigo:'V2',qr_token_id:mobileToken,device_id:device};
  await assert.rejects(mark(mobileQr),/device_inactive/,'tablet must belong to physical exit site');
  await db.query("insert into sede_device_sites values($1,'V2')",[device]);
  await db.exec("update cargos set marcacion_movil=false where codigo='SUP'");
  await assert.rejects(mark(mobileQr),/attendance_site_forbidden/,'revalidate permission when scanning QR');
  await db.exec("update cargos set marcacion_movil=true where codigo='SUP'");
  await mark(mobileQr);
  const exit = (await db.query('select sede_codigo,marking_sede_codigo,turno_id from employee_daily_exits where turno_id=$1',[t4])).rows[0];
  assert.deepEqual(exit,{sede_codigo:'S',marking_sede_codigo:'V2',turno_id:t4});
  await assert.rejects(mark(mobileQr),/qr_used/);
  await db.exec("update supervisor_profile set zona_codigo=null; update employees set zona_codigo=null where documento='123'");
  await assert.rejects(mark(mobileEvent('entry',t5)),/attendance_zone_missing/);
  await db.exec("update employees set zona_codigo='Z' where documento='123'");
  await db.query("insert into employee_cargo_history(employee_id,cargo_codigo,fecha_ingreso) values($1,'FIX',current_date-1)",[emp]);
  assert.equal((await db.query('select attendance_site_options($1,$2) as value',[emp,t5])).rows[0].value.mobile,false,'effective cargo history controls mobility');
  assert.equal((await db.query("select has_function_privilege('authenticated','attendance_site_options(uuid,uuid)','EXECUTE') as allowed")).rows[0].allowed,false);
  await db.exec("update sedes set qr_enabled=false where codigo='S'");
  await mark(event('entry',t5,other)); await mark(event('exit',t5,other));
  assert.equal((await db.query('select marking_sede_codigo from attendance where turno_id=$1 and empleado_id=$2',[t5,other])).rows[0].marking_sede_codigo,'S','fixed-site cargo still registers normally');
  console.log('PASS: mobile cargo default, effective history, zones/contracts, administrative coverage, direct entry and QR exit at different sites, open-shift guard, revoked permissions, tablet scope and migration idempotence.');
  console.log('PASS: 200 m, invalid proofs, WhatsApp QR/direct branching, shift ambiguity, overnight identity, duplicate entries/exits, multiple shifts, closure, atomic rollback and RPC permissions.');
  await db.exec(`
    create table shift_template_rules(id uuid primary key,
      ventana_entrada_antes_minutos integer default 30, ventana_entrada_despues_minutos integer default 30,
      ventana_salida_antes_minutos integer default 30, ventana_salida_despues_minutos integer default 30);
    alter table scheduled_shifts add column template_rule_id uuid;
  `);
  // Production phase 27 supplies these fields; the isolated fixture adds them here.
  await db.exec(`
    alter table attendance_qr_tokens add column phone_number text;
    alter table attendance add column early_entry_reason text, add column late_entry_reason text;
    alter table employee_daily_exits add column early_exit_reason text, add column late_exit_reason text;
    alter table employee_shift_status add column early_entry_reason text, add column late_entry_reason text,
      add column early_exit_reason text, add column late_exit_reason text;
  `);
  const alertMigration = await fs.readFile(new URL('../supabase/schema_operations_phase61_attendance_alert_thresholds.sql', import.meta.url), 'utf8');
  await db.exec(alertMigration); await db.exec(alertMigration);
  const ruleId = '40000000-0000-0000-0000-000000000001';
  await db.query(`insert into shift_template_rules(id,alerta_entrada_antes_minutos,alerta_entrada_despues_minutos,
    alerta_salida_antes_minutos,alerta_salida_despues_minutos) values($1,5,5,5,5)`, [ruleId]);
  await assert.rejects(db.query('update shift_template_rules set alerta_entrada_antes_minutos=31 where id=$1',[ruleId]), /alerta_entrada_antes_range/);
  await assert.rejects(db.query('update shift_template_rules set alerta_salida_antes_minutos=-1 where id=$1',[ruleId]), /alerta_salida_antes_range/);
  for (const [index, before] of [[6, true], [7, false]]) {
    const turn = `10000000-0000-0000-0000-00000000000${index}`;
    await db.query(`insert into scheduled_shifts(id,sede_codigo,sede_nombre,fecha_operativa,starts_at,ends_at,estado,contrato_codigo,template_rule_id)
      values($1,'S','Sede','2026-09-23',clock_timestamp() + $2::interval,clock_timestamp()+interval '20 minutes','programado','C',$3)`,
      [turn, before ? '10 minutes' : '-10 minutes', ruleId]);
    await mark(event('entry',turn,other));
    if (!before) await db.query("update scheduled_shifts set ends_at=clock_timestamp()-interval '10 minutes' where id=$1",[turn]);
    await mark(event('exit',turn,other));
    const status = (await db.query('select * from employee_shift_status where scheduled_shift_id=$1',[turn])).rows[0];
    assert.equal(status.requires_review,true);
    assert.equal(status.estado_turno,'trabajado');
    for (const key of ['early_entry_minutes','late_entry_minutes','early_exit_minutes','late_exit_minutes']) assert.equal(status[key],0);
    assert.ok(status.timing_alerts[before ? 'entrada_anticipada' : 'entrada_tardia'] >= 10);
    assert.ok(status.timing_alerts[before ? 'salida_anticipada' : 'salida_tardia'] >= 10);
  }
  console.log('PASS: phase 61 repeatability, threshold constraints, all four comment-only alerts persisted without control minutes.');
  const controlTurn = '10000000-0000-0000-0000-000000000008';
  await db.query(`insert into scheduled_shifts(id,sede_codigo,sede_nombre,fecha_operativa,starts_at,ends_at,estado,contrato_codigo,template_rule_id)
    values($1,'S','Sede','2026-09-23',clock_timestamp()-interval '40 minutes',clock_timestamp()+interval '1 hour','programado','C',$2)`,[controlTurn,ruleId]);
  await mark(event('entry',controlTurn,other));
  const controlled = (await db.query('select * from employee_shift_status where scheduled_shift_id=$1',[controlTurn])).rows[0];
  assert.equal(controlled.estado_turno,'trabajado_tardio');
  assert.ok(controlled.late_entry_minutes >= 10 && controlled.late_entry_minutes <= 11);
  assert.ok(controlled.timing_alerts.entrada_tardia >= 40);
  assert.equal(controlled.requires_review,true);
  console.log('PASS: exceeding the control threshold records both the alert and the existing excess minutes.');
  const answer = (id, reason, recipient='wa:123', messageId=id) => db.query(
    'select answer_attendance_reason($1,$2,$3,$4) as result',[id,recipient,reason,messageId]);
  for (const [index, before, control] of [[9,true,false],[10,false,false],[11,false,true]]) {
    const turn = `10000000-0000-0000-0000-${String(index).padStart(12,'0')}`;
    await db.query(`insert into scheduled_shifts(id,sede_codigo,sede_nombre,fecha_operativa,starts_at,ends_at,estado,contrato_codigo,template_rule_id)
      values($1,'S','Sede','2026-09-23',clock_timestamp()+$2::interval,clock_timestamp()+interval '20 minutes','programado','C',$3)`,
      [turn, before ? '10 minutes' : control ? '-40 minutes' : '-10 minutes',ruleId]);
    const registered = (await mark({ ...event('entry',turn,other), whatsapp_recipient: 'wa:123' })).rows[0].result;
    const request = registered.reasonRequest;
    assert.equal(request.recipient, 'wa:123');
    assert.equal(request.alert_type, before ? 'entrada_anticipada' : 'entrada_tardia');
    const originalAt = (await db.query('select reported_at from attendance where id=$1',[registered.attendanceId])).rows[0].reported_at;
    await assert.rejects(answer(request.id, '  \n '), /attendance_reason_length/);
    await assert.rejects(answer(request.id, 'x'.repeat(201)), /attendance_reason_length/);
    await assert.rejects(answer(request.id, '  abcd  '), /attendance_reason_length/);
    await assert.rejects(answer(request.id, 'Bus tarde', 'intruder'), /attendance_reason_not_found/);
    await answer(request.id, 'Bus retrasado');
    await answer(request.id, 'Intento de sobrescritura');
    let status = (await db.query('select * from employee_shift_status where scheduled_shift_id=$1',[turn])).rows[0];
    assert.equal(status.requires_review, control, 'comment-only reply closes explanation, control remains reviewable');
    assert.equal(status[before ? 'early_entry_reason' : 'late_entry_reason'], 'Bus retrasado');
    const entryRecord = (await db.query('select * from attendance where id=$1',[registered.attendanceId])).rows[0];
    assert.equal(entryRecord.employee_reason, 'Bus retrasado');
    assert.equal(entryRecord.timing_control_required,control);
    assert.equal(entryRecord.reported_at.getTime(),originalAt.getTime(),'typing never moves the marking time');
    if (!before) await db.query("update scheduled_shifts set ends_at=clock_timestamp()-interval '10 minutes' where id=$1",[turn]);
    const exited = (await mark({ ...event('exit',turn,other), whatsapp_recipient: 'wa:123' })).rows[0].result;
    assert.equal(exited.reasonRequest.alert_type, before ? 'salida_anticipada' : 'salida_tardia');
    // A duplicate entry message must not complete the exit explanation.
    await answer(exited.reasonRequest.id, 'Bus repetido', 'wa:123',request.id);
    assert.equal((await db.query('select reason from attendance_reason_requests where id=$1',[exited.reasonRequest.id])).rows[0].reason,null);
    await answer(exited.reasonRequest.id, '😀'.repeat(200));
    assert.equal(Array.from((await db.query('select employee_reason from employee_daily_exits where id=$1',[exited.exitId])).rows[0].employee_reason).length,200);
  }
  // QR asks at scan time and uses the original WhatsApp recipient, including BSUIDs.
  const qrTurn='10000000-0000-0000-0000-000000000012';
  const reasonToken='20000000-0000-0000-0000-000000000012';
  await db.query(`insert into scheduled_shifts(id,sede_codigo,sede_nombre,fecha_operativa,starts_at,ends_at,estado,contrato_codigo,template_rule_id)
    values($1,'S','Sede','2026-09-23',clock_timestamp()+interval '10 minutes',clock_timestamp()+interval '1 hour','programado','C',$2)`,[qrTurn,ruleId]);
  await assert.rejects(mark({ ...event('entry',qrTurn,other), whatsapp_recipient: null }),/attendance_reason_recipient_missing/);
  assert.equal((await db.query('select count(*)::int as n from attendance where turno_id=$1',[qrTurn])).rows[0].n,0,'missing recipient rolls back marking');
  await db.exec("update sedes set qr_enabled=true where codigo='S'");
  await db.query(`insert into attendance_qr_tokens(id,turno_id,employee_id,action,sede_codigo,expires_at,request_latitude,request_longitude,location_verified_at,whatsapp_recipient)
    values($1,$2,$3,'entry','S',clock_timestamp()+interval '10 minutes',4.6,-74.1,clock_timestamp(),'bsuid:original')`,[reasonToken,qrTurn,other]);
  const qrReason = (await mark({ ...event('entry',qrTurn,other), method:'qr',qr_token_id:reasonToken,device_id:device })).rows[0].result.reasonRequest;
  assert.equal(qrReason.recipient,'bsuid:original');
  await answer(qrReason.id,'  abcde  ','bsuid:original');
  assert.equal((await db.query('select reason from attendance_reason_requests where id=$1',[qrReason.id])).rows[0].reason,'abcde');
  await assert.rejects(mark({ ...event('entry',qrTurn,other),method:'qr',qr_token_id:reasonToken,device_id:device }),/qr_used/);
  assert.equal((await db.query("select has_function_privilege('authenticated','answer_attendance_reason(text,text,text,text)','EXECUTE') as allowed")).rows[0].allowed,false);
  assert.equal((await db.query("select has_table_privilege('authenticated','attendance_reason_requests','SELECT') as allowed")).rows[0].allowed,false);
  assert.equal((await db.query("select has_function_privilege('service_role','register_shift_attendance_before_reasons(jsonb)','EXECUTE') as allowed")).rows[0].allowed,false);
  console.log('PASS: consolidated phase 61, four reasons, 200 Unicode characters, ownership, duplicate replies, unchanged timestamps, comment/control review, QR recipient, rollback and restricted permissions.');
} finally { await db.close(); }
