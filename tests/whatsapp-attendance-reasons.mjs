import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { attendanceReasonPrompt, validateAttendanceReason } from '../whatsapp-backend/src/attendance-reasons.js';

const text = body => ({ type: 'text', text: { body }, id: 'M1', timestamp: '1790166001' });
for (const invalid of ['', '  \n ', 'x'.repeat(201), 'Hola', 'menú']) assert.ok(validateAttendanceReason(text(invalid)).error);
for (const type of ['image', 'audio', 'location', 'interactive', 'contacts']) assert.ok(validateAttendanceReason({ type }).error);
assert.equal(validateAttendanceReason(text('  Bus retrasado  ')).reason, 'Bus retrasado');
assert.ok(validateAttendanceReason(text('  abcd  ')).error);
assert.equal(validateAttendanceReason(text('  abcde  ')).reason, 'abcde');
assert.match(attendanceReasonPrompt({ alert_type: 'entrada_tardia' }), /entre 5 y 200 caracteres/);
assert.equal(validateAttendanceReason(text('x'.repeat(200))).reason.length, 200);
assert.equal(Array.from(validateAttendanceReason(text('😀'.repeat(200))).reason).length, 200);
assert.ok(validateAttendanceReason(text('😀'.repeat(201))).error);
for (const [alert_type, label] of Object.entries({ entrada_tardia: 'llegada tarde', entrada_anticipada: 'ingreso temprano', salida_anticipada: 'salida temprano', salida_tardia: 'salida tarde' })) {
  assert.match(attendanceReasonPrompt({ alert_type }), new RegExp(`Por favor escribe el motivo de: ${label}`));
}

const source = await fs.readFile(new URL('../whatsapp-backend/src/app.js', import.meta.url), 'utf8');
const requests = [{ id: 'R1', recipient: '123', alert_type: 'entrada_tardia', event_at: '2026-09-23T12:00:00Z', answered_at: null }];
const sent = [], saved = [];
let failDelivery = false, failSave = false;
const context = vm.createContext({ attendanceReasonPrompt, validateAttendanceReason, console: { error() {} },
  sendText: async (phone, body) => { if (failDelivery) throw new Error('delivery failed'); sent.push({ phone, body }); },
  supabaseAdmin: {
    from(table) {
      assert.equal(table, 'attendance_reason_requests');
      let filters = [];
      const query = { select() { return query; }, eq(key,value) { filters.push(row => row[key] === value); return query; },
        is(key,value) { filters.push(row => row[key] === value); return query; }, order() { return query; },
        async limit() { return { data: requests.filter(row => filters.every(filter => filter(row))).slice(0,1) }; } };
      return query;
    },
    async rpc(name, payload) {
      assert.equal(name, 'answer_attendance_reason');
      if (failSave) return { error: new Error('database failed') };
      saved.push(payload);
      Object.assign(requests.find(row => row.id === payload.p_request_id), { answered_at: 'now', message_id: payload.p_message_id });
      return {};
    }
  }
});
vm.runInContext(source.slice(source.indexOf('async function notifyAttendanceReason('), source.indexOf('async function openOperationalShiftFromAttendance(')), context);
await context.notifyAttendanceReason(requests[0]);
assert.match(sent.at(-1).body, /llegada tarde/);
failDelivery = true;
await context.notifyAttendanceReason(requests[0]);
failDelivery = false;
assert.equal(requests[0].answered_at, null, 'delivery failure preserves the pending explanation');
assert.equal(await context.handlePendingAttendanceReason('someone-else', text('Bus')), false);
for (const message of [text(''), text('x'.repeat(201)), text('Hola'), { type: 'location' }, { ...text('Old'), timestamp: '1' }]) {
  assert.equal(await context.handlePendingAttendanceReason('123', message), true);
  assert.equal(saved.length, 0);
}
failSave = true;
await assert.rejects(context.handlePendingAttendanceReason('123', { ...text('Bus tarde'), timestamp: '1790164801' }), /database failed/);
failSave = false;
await context.handlePendingAttendanceReason('123', { ...text('Bus retrasado'), timestamp: '1790164801' });
assert.equal(saved.length, 1);
assert.equal(saved[0].p_reason, 'Bus retrasado');
requests.push({ ...requests[0], id: 'R2', answered_at: null, message_id: null });
await context.handlePendingAttendanceReason('123', text('Bus retrasado'));
assert.equal(saved.length, 1, 'duplicate delivery cannot explain the next marking');
assert.equal(requests[1].answered_at, null);
console.log('PASS: four prompts, required plain text, Unicode 200-character boundary, recipient ownership, durable retry and duplicate messages.');

// Exercise the actual direct-marking and scanner branches: only committed alerts prompt.
let markingResult = { eventAt: '2026-09-23T12:00:00Z', reasonRequest: requests[1] };
const flow = [];
const markingContext = vm.createContext({
  selectAttendanceShift() {}, validateQrActionAvailability: async () => {},
  validateAttendanceLocation: () => ({ ok: true, distanceMeters: 10 }),
  normalizeDocument: value => value, normalizePhone: value => value, getSessionPhone: () => '123',
  sessionEmployee: value => value, SESSION: { COMPLETED: 'completed' },
  registerAttendanceEvent: async ({ tokenRow }) => { assert.equal(tokenRow.whatsapp_recipient,'123'); flow.push('commit'); return markingResult; },
  storeSession: async () => flow.push('session'), sendText: async () => flow.push('confirmation'),
  notifyAttendanceReason: async request => { assert.equal(request.id,'R2'); flow.push('prompt'); },
  sendAttendanceQr: async () => flow.push('qr-issued')
});
const markingStart = source.indexOf('async function completeLocatedMarking(');
vm.runInContext(source.slice(markingStart,source.indexOf('\nfunction isNamedLocation',markingStart)), markingContext);
const args = ['123', { session_data: { pendingQrAction: 'entry' } }, { id:'E',documento:'123' },
  { id:'T',nombre:'Turno',fechaOperativa:'2026-09-23' }, { codigo:'S',nombre:'Sede' }, { latitude:4.6,longitude:-74.1 },'2026-09-23T12:00:00Z'];
await markingContext.completeLocatedMarking(...args);
assert.deepEqual(flow,['commit','session','confirmation','prompt']);
flow.length=0;
markingResult = { eventAt: '2026-09-23T12:00:00Z' };
await markingContext.completeLocatedMarking(...args);
assert.deepEqual(flow,['commit','session','confirmation']);
flow.length=0;
await markingContext.completeLocatedMarking(...args.map((arg,index) => index === 4 ? { ...arg,qr_enabled:true } : arg));
assert.deepEqual(flow,['qr-issued'],'issuing a QR does not ask for a reason before it is scanned');
const scanStart = source.indexOf("      const result = tokenRow.action === 'exit'");
const scannerSource = source.slice(scanStart,source.indexOf('      await touchQrDevice',scanStart));
for (const action of ['entry','exit']) {
  let notified = false;
  const scanner = vm.createContext({ tokenRow:{action},device:{},employee:{},
    registerQrEntry: async () => ({reasonRequest:requests[1]}), registerQrExit: async () => ({reasonRequest:requests[1]}),
    notifyAttendanceReason: async request => { notified = request.id === 'R2'; }
  });
  await vm.runInContext(`(async () => { ${scannerSource} })()`, scanner);
  assert.equal(notified,true);
}
console.log('PASS: direct registration prompts after committing, normal registration skips explanation, QR prompts on entry/exit scan.');
