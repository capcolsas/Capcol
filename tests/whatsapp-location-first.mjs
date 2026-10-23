import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { decideMarkingAction, isMenuKeyword } from '../whatsapp-backend/src/whatsapp-intents.js';
import { decryptFlowMedia, decryptFlowRequest, encryptFlowResponse } from '../whatsapp-backend/src/whatsapp-flow-crypto.js';

// ---- Menu keyword: only R / Rocky / N / Novedad open the menu, in any case or accent.
for (const value of ['R', 'r', ' r. ', 'Rocky', 'rocky', 'ROCKY', 'N', 'n', 'Novedad', 'novedad', 'NOVEDAD', 'Novedád', 'novedades']) {
  assert.equal(isMenuKeyword(value), true, value);
}
for (const value of ['Hola', 'hola', 'menu', 'gracias', 'rr', 'ok', 'novedad hoy', '', null]) assert.equal(isMenuKeyword(value), false, String(value));
console.log('PASS: menu keywords R, Rocky, N and Novedad in any case; "Hola" and courtesy words are not keywords.');

// ---- Entry/exit decision.
const now = new Date('2026-10-18T13:00:00Z');
const shiftA = { id: 'A' }, shiftB = { id: 'B' };
assert.deepEqual(decideMarkingAction({ entry: { available: true, shift: shiftA }, now }), { action: 'entry', shift: shiftA });
assert.deepEqual(decideMarkingAction({ entry: { available: true, shift: null }, now }), { action: 'entry', shift: null }, 'covering supernumerario');
assert.deepEqual(decideMarkingAction({ entry: { available: false }, now }), { action: 'none' });
const openOld = { shift: shiftA, entradaAt: '2026-10-18T05:00:00Z' };
const openRecent = { shift: shiftA, entradaAt: '2026-10-18T12:45:00Z' };
assert.deepEqual(decideMarkingAction({ openEntry: openOld, entry: { available: false }, now }), { action: 'exit', shift: shiftA });
assert.deepEqual(decideMarkingAction({ openEntry: openOld, entry: { available: true, shift: shiftA }, now }), { action: 'exit', shift: shiftA }, 'same shift is not a second entry');
assert.deepEqual(decideMarkingAction({ openEntry: openOld, entry: { available: true, shift: null }, now }), { action: 'exit', shift: shiftA }, 'supernumerario with an open shift exits');
assert.deepEqual(decideMarkingAction({ openEntry: openRecent, entry: { available: false }, now }), { action: 'confirm_exit', shift: shiftA }, '15 minutes after entry asks');
assert.deepEqual(decideMarkingAction({ openEntry: openRecent, entry: { available: false }, now, guardMinutes: 10 }), { action: 'exit', shift: shiftA });
assert.deepEqual(decideMarkingAction({ openEntry: openOld, entry: { available: true, shift: shiftB }, now }), { action: 'choose', exitShift: shiftA, entryShift: shiftB });
console.log('PASS: entry, exit, exit right after entry and double shift decisions.');

// ---- Flow endpoint encryption, as the WhatsApp client does it.
const passphrase = 'frase-de-prueba';
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase }
});
function clientRequest(payload, key = publicKey) {
  const aesKey = crypto.randomBytes(16), iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-128-gcm', aesKey, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return {
    aesKey, iv,
    body: {
      encrypted_aes_key: crypto.publicEncrypt({ key, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, aesKey).toString('base64'),
      encrypted_flow_data: data.toString('base64'),
      initial_vector: iv.toString('base64')
    }
  };
}
const sample = clientRequest({ action: 'INIT', flow_token: 'T', version: '3.0' });
const decrypted = decryptFlowRequest(sample.body, privateKey, passphrase);
assert.deepEqual(decrypted.body, { action: 'INIT', flow_token: 'T', version: '3.0' });
const encrypted = Buffer.from(encryptFlowResponse({ screen: 'INICIO', data: { a: 1 } }, decrypted.aesKey, decrypted.iv), 'base64');
const decipher = crypto.createDecipheriv('aes-128-gcm', sample.aesKey, Buffer.from(sample.iv.map(byte => ~byte & 0xff)));
decipher.setAuthTag(encrypted.subarray(-16));
assert.deepEqual(JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]).toString('utf8')), { screen: 'INICIO', data: { a: 1 } });
const otherKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' } }).publicKey;
assert.throws(() => decryptFlowRequest(clientRequest({}, otherKey).body, privateKey, passphrase), error => error.statusCode === 421, 'unknown key asks the client to refresh it');
const tampered = clientRequest({ action: 'ping' });
tampered.body.encrypted_flow_data = Buffer.from(Buffer.from(tampered.body.encrypted_flow_data, 'base64').map((byte, index) => index === 0 ? byte ^ 1 : byte)).toString('base64');
assert.throws(() => decryptFlowRequest(tampered.body, privateKey, passphrase), error => error.statusCode === 421);
assert.throws(() => decryptFlowRequest({}, privateKey, passphrase), error => error.statusCode === 400);

function encryptMedia(plaintext) {
  const encryptionKey = crypto.randomBytes(32), hmacKey = crypto.randomBytes(32), iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const hmac = crypto.createHmac('sha256', hmacKey).update(Buffer.concat([iv, ciphertext])).digest().subarray(0, 10);
  const file = Buffer.concat([ciphertext, hmac]);
  const sha = value => crypto.createHash('sha256').update(value).digest('base64');
  return { file, metadata: { encryption_key: encryptionKey.toString('base64'), hmac_key: hmacKey.toString('base64'), iv: iv.toString('base64'), encrypted_hash: sha(file), plaintext_hash: sha(plaintext) } };
}
const pdf = Buffer.from('%PDF-1.4 soporte de incapacidad');
const media = encryptMedia(pdf);
assert.deepEqual(decryptFlowMedia(media.file, media.metadata), pdf);
const flipped = Buffer.from(media.file); flipped[0] ^= 1;
assert.throws(() => decryptFlowMedia(flipped, media.metadata), /hash_mismatch/);
assert.throws(() => decryptFlowMedia(media.file, { ...media.metadata, hmac_key: crypto.randomBytes(32).toString('base64') }), /hmac_mismatch/);
console.log('PASS: Flow request/response encryption, key refresh (421), tampering and media hash/HMAC checks.');

// ---- Inbound routing in location mode: only location, keyword and pending confirmations are answered.
const source = await fs.readFile(new URL('../whatsapp-backend/src/app.js', import.meta.url), 'utf8');
const slice = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const SESSION = { AWAITING_QR_LOCATION: 'awaiting_qr_location', AWAITING_MARKING_SITE: 'awaiting_marking_site', AWAITING_MARKING_CONFIRM: 'awaiting_marking_confirm', AWAITING_OVERRIDE_LOCATION: 'awaiting_override_location', COMPLETED: 'completed', IDLE: 'idle' };
const log = [];
const someoneElse = { id: 'E9', documento: '900', nombre: 'Beto', telefono: '573000000999' };
let lastMarking = null;
let session = { session_state: 'idle', session_data: {} };
let employeeByPhone = { id: 'E1', documento: '100', nombre: 'Ana', telefono: '573000000001' };
let openRows = [], entryShift = { id: 'T2', nombre: 'Tarde', fechaOperativa: '2026-10-18', sedeNombre: 'Sede', sedeCodigo: 'S' }, entryError = null;
const shiftsById = { T1: { id: 'T1', nombre: 'Manana', fechaOperativa: '2026-10-18', sedeNombre: 'Sede', sedeCodigo: 'S', estado: 'abierto' }, T2: entryShift };
const query = () => {
  const chain = new Proxy({}, { get: (_target, method) => method === 'limit' ? async () => ({ data: openRows, error: null }) : () => chain });
  return chain;
};
const router = vm.createContext({
  config: { whatsappConversationMode: 'location', whatsappExitGuardMinutes: 30 }, SESSION, console,
  isMenuKeyword, decideMarkingAction,
  getWhatsAppRecipient: message => message.from,
  extractFlowReply: message => message.interactive?.type === 'nfm_reply' ? JSON.parse(message.interactive.nfm_reply.response_json) : null,
  handleFlowCompletion: async () => log.push('flow-completed'),
  handlePendingAttendanceReason: async (_phone, message) => message.pendingReason === true,
  parseInboundAction: message => ({ id: message.interactive?.button_reply?.id || '', value: message.text?.body || message.interactive?.button_reply?.title || '', location: message.location || null, forwarded: Boolean(message.context?.forwarded) }),
  sendMenuFlow: async phone => log.push(`menu-flow:${phone}`),
  sendMarkingFlow: async (phone, options) => log.push(`marking-flow:${options.start}`),
  getSession: async () => session,
  storeSession: async (_phone, patch) => { session = { ...session, ...patch }; },
  resetSession: async () => { session = { session_state: 'idle', session_data: {} }; log.push('reset'); },
  markMessageRead: async message => log.push(`read:${message.id}`),
  sendText: async (_phone, body) => log.push(`text:${body}`),
  sendButtons: async (_phone, body, buttons) => log.push(`buttons:${buttons.map(button => button.id).join(',')}`),
  normalizeBusinessScopedUserId: value => /^[A-Z]{2}\.\d+$/.test(value) ? value : '',
  findEmployeeByPhone: async () => employeeByPhone,
  reloadEmployeeForAttendance: async employee => employee,
  loadEmployeeFromSession: async source => source?.employee_id === 'E9' ? someoneElse : employeeByPhone,
  normalizeDocument: value => String(value || ''), normalizePhone: value => value,
  currentDate: () => '2026-10-18', addIsoDays: value => value,
  supabaseAdmin: { from: query },
  getScheduledShiftById: async id => shiftsById[id] || null,
  validateQrActionAvailability: async () => {},
  resolveAttendanceShift: async () => { if (entryError) throw new Error(entryError); return entryShift; },
  qrMessageFromError: error => `qr:${error.message}`,
  qrError: message => new Error(message),
  sessionEmployee: employee => employee,
  isNamedLocation: location => Boolean(location?.name || location?.address),
  handleQrLocationInput: async (_phone, markingSession, parsed) => (lastMarking = markingSession, log.push(`mark:${markingSession.session_data.pendingQrAction}:${markingSession.session_data.pendingShiftId}:${parsed.location.latitude}`))
});
vm.runInContext(slice('const MARKING_LOCATION_MAX_AGE_MS', 'async function startIdentificationFlow('), router);
const run = async message => { log.length = 0; await router.processLocationFirstMessage({ from: '573000000001', id: 'W1', ...message }); return [...log]; };
const location = { latitude: 4.6, longitude: -74.1 };

for (const message of [{ type: 'text', text: { body: 'Hola' } }, { type: 'text', text: { body: 'gracias' } }, { type: 'sticker' }, { type: 'reaction' }, { type: 'audio' }, { type: 'image' }]) {
  assert.deepEqual(await run(message), ['read:W1'], `${message.type} ${message.text?.body || ''} is only marked as read`);
}
assert.deepEqual(await run({ type: 'text', text: { body: 'R' } }), ['menu-flow:573000000001']);
assert.deepEqual(await run({ type: 'text', text: { body: 'NOVEDAD' } }), ['menu-flow:573000000001']);
assert.deepEqual(await run({ type: 'interactive', interactive: { type: 'nfm_reply', nfm_reply: { response_json: '{"flow_token":"X"}' } } }), ['flow-completed']);
assert.deepEqual(await run({ type: 'text', text: { body: 'R' }, pendingReason: true }), [], 'a pending reason takes precedence over the keyword');

assert.deepEqual(await run({ type: 'location', location }), ['mark:entry:T2:4.6'], 'no open entry: the location is an entry');
openRows = [{ scheduled_shift_id: 'T1', entrada_at: new Date(Date.now() - 4 * 3600000).toISOString() }];
entryError = 'entry_exists';
assert.deepEqual(await run({ type: 'location', location }), ['mark:exit:T1:4.6'], 'open entry: the location is an exit');
entryError = null;
assert.deepEqual(await run({ type: 'location', location }), ['buttons:marking:exit:T1,marking:entry:T2,marking:cancel'], 'open entry and next shift ask');
assert.equal(session.session_state, SESSION.AWAITING_MARKING_CONFIRM);
assert.deepEqual(await run({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'marking:entry:T2', title: 'Registrar ingreso' } } }), ['mark:entry:T2:4.6']);
openRows = [{ scheduled_shift_id: 'T1', entrada_at: new Date(Date.now() - 10 * 60000).toISOString() }];
entryError = 'entry_exists';
assert.deepEqual(await run({ type: 'location', location }), ['buttons:marking:exit:T1,marking:cancel'], 'exit 10 minutes after entry asks');
assert.deepEqual(await run({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'marking:cancel', title: 'Fue un error' } } }), ['reset'], '"Fue un error" sends nothing');
await run({ type: 'location', location });
session.session_data.pendingLocationAt = new Date(Date.now() - 6 * 60000).toISOString();
const expired = await run({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'marking:exit:T1', title: 'Registrar salida' } } });
assert.deepEqual(expired.slice(0, 1), ['reset']);
assert.match(expired[1], /ubicación venció/);
assert.deepEqual(await run({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'marking:exit:T1', title: 'Registrar salida' } } }), ['read:W1'], 'a stale button outside the confirmation step is ignored');
openRows = [];
entryError = 'attendance_shift_missing';
assert.deepEqual(await run({ type: 'location', location }), ['text:qr:attendance_shift_missing']);
assert.match((await run({ type: 'location', location: { ...location, name: 'Centro comercial' } }))[0], /nombre o direccion/);
assert.match((await run({ type: 'location', location, context: { forwarded: true } }))[0], /reenviada/);
// "No soy yo" + "Marcar ingreso o salida": the next location marks the identified person, from this phone.
entryError = null;
const override = minutesAgo => ({ session_state: SESSION.AWAITING_OVERRIDE_LOCATION,
  session_data: { identityOverride: { employeeId: 'E9', documento: '900', nombre: 'Beto', createdAt: new Date(Date.now() - minutesAgo * 60000).toISOString() } } });
session = override(2);
assert.deepEqual(await run({ type: 'location', location }), ['mark:entry:T2:4.6']);
assert.equal(lastMarking.employee_id, 'E9', 'marks the identified person, not the phone owner');
assert.equal(lastMarking.phone_number, '573000000001', 'records the phone that sent the location, flagged as a different phone');
assert.equal(session.session_state, SESSION.AWAITING_QR_LOCATION, 'the marking consumes the override');
lastMarking = null;
assert.deepEqual(await run({ type: 'location', location }), ['mark:entry:T2:4.6']);
assert.equal(lastMarking.employee_id, 'E1', 'once consumed, the phone owner marks again');
session = override(20);
const lateOverride = await run({ type: 'location', location });
assert.equal(lateOverride[0], 'reset');
assert.match(lateOverride[1], /^text:El tiempo para marcar a nombre de Beto venció/, 'a recently expired override never marks the owner by mistake');
assert.equal(lateOverride.length, 2);
session = override(120);
assert.deepEqual(await run({ type: 'location', location }), ['reset', 'mark:entry:T2:4.6']);
assert.equal(lastMarking.employee_id, 'E1', 'a forgotten override does not block the owner hours later');
employeeByPhone = null;
assert.deepEqual(await run({ type: 'location', location }), ['marking-flow:cedula'], 'unregistered number gets the marking Flow');
console.log('PASS: location mode answers only locations, keywords and confirmations; entry/exit/double shift/guard/expiry/cancel routing.');

// ---- Flow "menu" and "marcacion" screens.
const flowSessions = [];
const writes = { incapacitados: [], soportes: [] };
const registered = [];
const sent = [];
const storedSessions = [];
let overlap = false, activeIncapacity = null;
const employees = {
  E1: { id: 'E1', documento: '100', nombre: 'Ana', sede_nombre: 'Principal', isSupernumerario: false },
  E2: { id: 'E2', documento: '200', nombre: 'Luis', isSupernumerario: true }
};
const flowDb = {
  from(table) {
    const filters = [];
    let patch = null, op = 'select';
    const chain = {
      select: () => chain,
      eq: (key, value) => { filters.push(row => row[key] === value); return chain; },
      is: (key, value) => { filters.push(row => (row[key] ?? null) === value); return chain; },
      update: value => { op = 'update'; patch = value; return chain; },
      insert: async row => {
        if (table === 'whatsapp_flow_sessions') flowSessions.push({ id: `F${flowSessions.length + 1}`, estado: 'abierto', ...row });
        if (table === 'incapacidad_soportes') writes.soportes.push(row);
        return { error: null };
      },
      maybeSingle: async () => ({ data: flowSessions.find(row => filters.every(filter => filter(row))) || null, error: null }),
      then: resolve => {
        if (op === 'update' && table === 'whatsapp_flow_sessions') flowSessions.filter(row => filters.every(filter => filter(row))).forEach(row => Object.assign(row, patch));
        if (op === 'update' && table === 'incapacitados') writes.incapacitados.push(patch);
        resolve({ error: null });
      }
    };
    return chain;
  }
};
const NOVELTIES = vm.runInNewContext(`(${source.slice(source.indexOf('const NOVELTIES = {') + 'const NOVELTIES = '.length, source.indexOf('};', source.indexOf('const NOVELTIES = {')) + 1)})`);
let markingOutcome = { type: 'registered', message: 'Ingreso registrado correctamente.' };
const flows = vm.createContext({
  NOVELTIES, SESSION, Buffer, console: { error() {} },
  config: { whatsappConversationMode: 'location', whatsappFlowMenuId: 'MENU', whatsappFlowMarkingId: 'MARK' },
  FLOW_LOCATION_MAX_AGE_MS: 10 * 60000,
  NO_REGISTERED_MESSAGE: 'No estás registrado', EMPLOYEE_PORTAL_URL: 'https://portal',
  createQrToken: () => `tok${flowSessions.length + 1}`, hashToken: token => `h:${token}`,
  supabaseAdmin: flowDb,
  loadEmployeeFromSession: async ({ employee_id }) => employees[employee_id] || null,
  findEmployeeByDocument: async documento => Object.values(employees).find(row => row.documento === documento) || null,
  findEmployeeByPhone: async () => employees.E1,
  findActiveIncapacity: async () => activeIncapacity,
  registerNovelty: async (phone, employee, novelty, sede, incapacity, options) => {
    assert.equal(options.notify, false, 'Flows never send the registration message');
    registered.push({ code: novelty.code, ...incapacity });
    return overlap ? { status: 'overlap' } : { status: 'registered', incapacityRow: novelty.tracksIncapacity ? { id: 'INC1' } : null };
  },
  normalizeDocument: value => String(value || '').replace(/\D+/g, ''),
  normalizeBusinessScopedUserId: () => '',
  sendText: async (phone, body) => sent.push(body),
  sendFlowMessage: async (phone, message) => sent.push(`flow:${message.flowId}:${message.flowToken}`),
  markMessageRead: async () => {},
  userMessageForProcessingError: error => `error:${error.message}`,
  qrError: (message, statusCode) => Object.assign(new Error(message), { statusCode }),
  truncate: value => value,
  decryptFlowMedia: file => Buffer.from(file),
  fetch: async url => url.includes('roto') ? { ok: false, status: 404 } : { ok: true, arrayBuffer: async () => pdf },
  uploadIncapacitySupportBuffer: async ({ fileName, mimeType, folder }) => ({ url: `https://store/${folder}/${fileName}`, name: fileName, mimeType, storagePath: `${folder}/${fileName}` }),
  QRCode: { toBuffer: async () => Buffer.from('png') }, buildQrScanValue: token => `scan:${token}`,
  notifyAttendanceReason: async () => sent.push('reason-prompt'),
  getSession: async () => ({ session_state: 'idle', session_data: {} }),
  storeSession: async (phone, patch) => storedSessions.push({ phone, ...patch }),
  locationMarkingSession: (phone, employee, action, shiftId) => ({ session_data: { pendingQrAction: action, pendingShiftId: shiftId } }),
  locatedMarkingCandidates: async () => ({ shift: { id: 'T1' }, candidates: [{ codigo: 'S' }], message: null }),
  completeLocatedMarking: async (...args) => { assert.equal(args.at(-1).reply, false); return markingOutcome; },
  planLocationMarking: async employee => ({ employee, decision: { action: 'entry', shift: { id: 'T1' } } }),
  markingUnavailableMessage: () => 'sin turno', markingConfirmationPrompt: () => ({ body: '', buttons: [] }),
  isValidWhatsAppSignature: () => true, decryptFlowRequest, encryptFlowResponse
});
vm.runInContext(slice('function parseInputDate(', 'function truncate('), flows);
vm.runInContext(slice('const FLOW_SESSION_HOURS', 'async function sendText('), flows);
// Results come from the vm realm: compare them as plain JSON.
const plain = value => JSON.parse(JSON.stringify(value));
const request = async body => plain(await flows.handleFlowRequest(body));
const exchange = (token, screen, data) => request({ action: 'data_exchange', flow_token: token, screen, data });

assert.deepEqual(await request({ action: 'ping' }), { data: { status: 'active' } });
await assert.rejects(request({ action: 'INIT', flow_token: 'nope' }), error => error.statusCode === 427);

await flows.sendMenuFlow('573000000001');
assert.equal(sent.at(-1), 'flow:MENU:tok1');
let screen = await request({ action: 'INIT', flow_token: 'tok1' });
assert.equal(screen.screen, 'INICIO');
assert.deepEqual(screen.data.opciones.map(option => option.id), ['incapacidad', 'novedad', 'compensatorio', 'no_soy_yo']);
screen = await exchange('tok1', 'INICIO', { opcion: 'incapacidad' });
assert.deepEqual(screen.data.tipos.map(option => option.id), ['3', '2']);
screen = await exchange('tok1', 'INCAPACIDAD', { tipo: '3', fecha_inicio: '2026-10-10', fecha_fin: '2026-10-08' });
assert.equal(screen.screen, 'INCAPACIDAD');
assert.match(screen.data.aviso, /no puede ser menor/);
assert.equal(registered.length, 0);
screen = await exchange('tok1', 'INCAPACIDAD', { tipo: '9', fecha_inicio: '2026-10-10', fecha_fin: '2026-10-12' });
assert.match(screen.data.aviso, /tipo de registro/, 'a novelty code cannot be registered from the incapacity screen');
screen = await exchange('tok1', 'INCAPACIDAD', { tipo: '3', fecha_inicio: '2026-10-10', fecha_fin: '2026-10-14' });
assert.equal(screen.screen, 'SOPORTE');
assert.match(screen.data.resumen, /Enfermedad General, del 10\/10\/2026 al 14\/10\/2026/);
assert.match(screen.data.resumen, /opcional/);
await exchange('tok1', 'INCAPACIDAD', { tipo: '3', fecha_inicio: '2026-10-10', fecha_fin: '2026-10-14' });
assert.equal(registered.length, 1, 'a retried submit does not register twice');
const file = name => ({ cdn_url: `https://cdn/${name}`, file_name: name, media_id: name, encryption_metadata: {} });
screen = await exchange('tok1', 'SOPORTE', { soporte: [file('incapacidad.pdf'), { file_name: 'sin-cdn' }] });
assert.equal(screen.screen, 'EPICRISIS', 'more than three days asks for the clinical history');
screen = await exchange('tok1', 'EPICRISIS', { epicrisis: [file('epicrisis.pdf'), file('roto.pdf')] });
assert.deepEqual(screen, { screen: 'SUCCESS', data: { extension_message_response: { params: { flow_token: 'tok1' } } } });
assert.equal(flowSessions[0].data.media.length, 3, 'only references are kept until the Flow reply arrives');
sent.length = 0;
await flows.handleFlowCompletion('573000000001', { id: 'W9' }, { flow_token: 'tok1' });
assert.deepEqual(writes.soportes.map(row => `${row.tipo}:${row.nombre}`), ['incapacidad:incapacidad.pdf', 'epicrisis:epicrisis.pdf']);
assert.equal(writes.soportes[0].mime_type, 'application/pdf');
assert.equal(writes.incapacitados[0].soporte_url, 'https://store/whatsapp-flow/incapacidad.pdf', 'main support kept for the portal');
assert.equal(sent.length, 1, 'only the failed file costs a message');
assert.match(sent[0], /uno de los soportes[\s\S]*https:\/\/portal/);
assert.equal(flowSessions[0].estado, 'completado');
await flows.handleFlowCompletion('573000000001', { id: 'W9' }, { flow_token: 'tok1' });
assert.equal(writes.soportes.length, 2, 'a repeated Flow reply does not store the files again');
await assert.rejects(exchange('tok1', 'INICIO', { opcion: 'novedad' }), error => error.statusCode === 427, 'a completed Flow cannot be reused');

// Short incapacity: the support screen closes the Flow directly; no support is fine.
await flows.sendMenuFlow('573000000001');
await exchange('tok2', 'INCAPACIDAD', { tipo: '2', fecha_inicio: '2026-10-01', fecha_fin: '2026-10-02' });
assert.equal((await exchange('tok2', 'SOPORTE', { soporte: [] })).screen, 'SUCCESS');
// Overlap and novelties without support.
await flows.sendMenuFlow('573000000001');
overlap = true;
screen = await exchange('tok3', 'NOVEDAD', { tipo: '9', fecha_inicio: '2026-11-01', fecha_fin: '2026-11-15' });
assert.match(screen.data.aviso, /Ya registraste una novedad/);
overlap = false;
screen = await exchange('tok3', 'NOVEDAD', { tipo: '9', fecha_inicio: '2026-11-01', fecha_fin: '2026-11-15' });
assert.equal(screen.screen, 'CONFIRMACION');
assert.match(screen.data.resumen, /Vacaciones/);
// Older clients send DatePicker values as timestamps.
await flows.sendMenuFlow('573000000001');
screen = await exchange('tok4', 'NOVEDAD', { tipo: '5', fecha_inicio: String(Date.parse('2026-12-01T17:00:00Z')), fecha_fin: String(Date.parse('2026-12-02T17:00:00Z')) });
assert.match(screen.data.resumen, /01\/12\/2026 al 02\/12\/2026/);
// Compensatorio is registered once.
await flows.sendMenuFlow('573000000001');
assert.equal((await exchange('tok5', 'INICIO', { opcion: 'compensatorio' })).screen, 'COMPENSATORIO');
const before = registered.length;
await exchange('tok5', 'COMPENSATORIO', {});
assert.equal((await exchange('tok5', 'COMPENSATORIO', {})).screen, 'CONFIRMACION');
assert.equal(registered.length, before + 1);
// "No soy yo", unknown numbers and supernumerarios.
await flows.sendMenuFlow('573000000001');
assert.equal((await exchange('tok6', 'INICIO', { opcion: 'no_soy_yo' })).screen, 'CEDULA');
screen = await exchange('tok6', 'CEDULA', { documento: '999' });
assert.equal(screen.screen, 'CEDULA');
assert.equal(screen.data.mostrar_aviso, true);
screen = await exchange('tok6', 'CEDULA', { documento: '2.0.0' });
assert.equal(screen.screen, 'OPCIONES');
assert.deepEqual(screen.data.opciones.map(option => option.id), ['incapacidad', 'novedad', 'marcar'], 'supernumerario: no compensatorio, no "No soy yo" after the cédula, and a way to mark from this phone');
screen = await exchange('tok6', 'OPCIONES', { opcion: 'novedad' });
assert.deepEqual(screen.data.tipos.map(option => option.id), ['4', '5', '9'], 'no Licencia Remunerada for supernumerarios');
screen = await exchange('tok6', 'OPCIONES', { opcion: 'marcar' });
assert.equal(screen.screen, 'CONFIRMACION');
assert.match(screen.data.resumen, /^Listo, Luis\. Ahora envía tu ubicación actual .* próximos 10 minutos/);
const overrideSession = storedSessions.at(-1);
assert.equal(overrideSession.phone, '573000000001');
assert.equal(overrideSession.session_state, 'awaiting_override_location');
assert.equal(overrideSession.session_data.identityOverride.employeeId, 'E2', 'the next location marks the person identified by cédula');
// The phone owner cannot reach the override from INICIO: the option only exists after typing a cédula.
await flows.sendMenuFlow('573000000001');
const storedBefore = storedSessions.length;
assert.equal((await exchange(`tok${flowSessions.length}`, 'INICIO', { opcion: 'marcar' })).screen, 'OPCIONES');
assert.equal(storedSessions.length, storedBefore, 'no override without identifying by cédula');
activeIncapacity = { fecha_fin: '2026-10-20' };
await flows.sendMenuFlow('573000000001');
screen = await request({ action: 'INIT', flow_token: 'tok8' });
assert.equal(screen.screen, 'CONFIRMACION');
assert.match(screen.data.resumen, /incapacitado hasta el 20\/10\/2026/);
activeIncapacity = null;
console.log('PASS: menu Flow screens, date validation, retries, overlap, optional support with clinical history, file storage and failure message.');

// Marking Flow for an unregistered number.
await flows.sendMarkingFlow('573000000009', { start: 'cedula', location, receivedAt: new Date().toISOString() });
assert.equal(sent.at(-1), 'flow:MARK:tok9');
assert.equal((await request({ action: 'INIT', flow_token: 'tok9' })).screen, 'CEDULA');
screen = await exchange('tok9', 'CEDULA', { documento: '100' });
assert.deepEqual(screen, { screen: 'CONFIRMACION', data: { resumen: 'Ingreso registrado correctamente.', tiene_qr: false, qr_imagen: screen.data.qr_imagen } });
markingOutcome = { type: 'invalid', message: 'otra' };
assert.equal((await exchange('tok9', 'CEDULA', { documento: '100' })).data.resumen, 'Ingreso registrado correctamente.', 'a retried submit shows the registered result');
await flows.sendMarkingFlow('573000000009', { start: 'cedula', location, receivedAt: new Date(Date.now() - 11 * 60000).toISOString() });
assert.match((await exchange('tok10', 'CEDULA', { documento: '100' })).data.resumen, /ubicación venció/);
markingOutcome = { type: 'qr', token: 'QRT', caption: 'QR temporal para registrar ingreso.' };
await flows.sendMarkingFlow('573000000009', { start: 'cedula', location, receivedAt: new Date().toISOString() });
screen = await exchange('tok11', 'CEDULA', { documento: '100' });
assert.equal(screen.data.tiene_qr, true);
assert.equal(screen.data.qr_imagen, Buffer.from('png').toString('base64'));
console.log('PASS: marking Flow identifies by cédula, registers once, expires stale locations and shows the QR on screen.');
