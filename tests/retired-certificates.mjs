// node --experimental-vm-modules tests/retired-certificates.mjs
// Execute the actual route modules with isolated database and transport doubles.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { PGlite } from '@electric-sql/pglite';
import * as certificates from '../whatsapp-backend/src/certificates/certificate-service.js';

const employee = { id: 'owner', documento: '12345', nombre: 'Persona de prueba', telefono: '3001234567',
  estado: 'inactivo', fecha_ingreso: '2026-02-01', fecha_retiro: '2026-08-31', cargo_nombre: 'Operario' };
const cargo = { nombre: 'Operario', salario: 1500000, funciones: 'Revisar equipos.\nRegistrar novedades.' };
let sessions = [];
let history = [];
let audit = [];
let profile = null;
const calls = [];
const db = {
  auth: { async getUser(token) { return { data: { user: token === 'admin-token' ? { id: 'admin' } : null }, error: null }; } },
  from(table) {
    const filters = [];
    let mutation;
    const query = {
      select() { return this; }, eq(key, value) { filters.push([key, value]); return this; },
      in() { return this; }, or() { return this; }, order() { return this; },
      insert(value) { mutation = ['insert', value]; return this; },
      update(value) { mutation = ['update', value]; return this; },
      maybeSingle() { return Promise.resolve(result(true)); },
      single() { return Promise.resolve(result(true)); },
      then(resolve, reject) { return Promise.resolve(result(false)).then(resolve, reject); }
    };
    function result(single) {
      calls.push(table);
      let rows = table === 'employees' ? [employee] : table === 'employee_portal_sessions' ? sessions
        : table === 'employee_cargo_history' ? history : table === 'profiles' ? (profile ? [profile] : [])
        : table === 'cargos' ? [cargo] : [];
      if (table !== 'employee_cargo_history') rows = rows.filter((row) => filters.every(([key, value]) => row[key] === value));
      if (mutation?.[0] === 'insert') {
        const row = { id: crypto.randomUUID(), ...mutation[1] };
        if (table === 'employee_portal_sessions') sessions.push(row);
        if (table === 'employee_certificate_audit') audit.push(row);
        rows = [row];
      }
      if (mutation?.[0] === 'update') rows.forEach((row) => Object.assign(row, mutation[1]));
      return { data: single ? rows[0] || null : rows, error: null };
    }
    return query;
  }
};
const routes = new Map();
const app = { use() {}, patch() {}, get(paths, handler) { register('GET', paths, handler); }, post(paths, handler) { register('POST', paths, handler); } };
function register(method, paths, handler) {
  for (const path of Array.isArray(paths) ? paths : [paths]) routes.set(`${method} ${path}`, handler);
}
const express = Object.assign(() => app, { json: () => () => {} });
const config = { employeePortalSessionHours: 12, publicBackendUrl: 'https://example.test' };
function synthetic(values) {
  return new vm.SyntheticModule(Object.keys(values), function () {
    for (const [key, value] of Object.entries(values)) this.setExport(key, value);
  });
}
const portalSource = await fs.readFile(new URL('../whatsapp-backend/src/employee-portal.js', import.meta.url), 'utf8');
const portal = new vm.SourceTextModule(portalSource);
await portal.link((name) => {
  if (name === 'node:crypto') return synthetic({ default: crypto });
  if (name === './config.js') return synthetic({ config, isAllowedCorsOrigin: () => true });
  if (name === './supabase.js') return synthetic({ supabaseAdmin: db });
  throw new Error(`Unexpected import ${name}`);
});
await portal.evaluate();
const source = await fs.readFile(new URL('../whatsapp-backend/src/app.js', import.meta.url), 'utf8');
const backend = new vm.SourceTextModule(source);
await backend.link((name) => {
  if (name === './employee-portal.js') return portal;
  if (name === 'node:crypto') return synthetic({ default: crypto });
  if (name === 'express') return synthetic({ default: express });
  if (name === 'qrcode') return synthetic({ default: {} });
  if (name === './config.js') return synthetic({ config, isAllowedCorsOrigin: () => true });
  if (name === './supabase.js') return synthetic({ supabaseAdmin: db });
  if (name === './certificates/certificate-service.js') return synthetic(certificates);
  const matches = [...source.matchAll(/import\s+\{([^}]+)\}\s+from\s+'([^']+)'/g)].filter((match) => match[2] === name);
  return synthetic(Object.fromEntries(matches.flatMap((match) => match[1].split(',').map((key) => [key.trim(), () => {}]))));
});
await backend.evaluate();
async function request(method, path, token = '', body = {}, params = {}) {
  const response = { statusCode: 200, headers: {}, setHeader(key, value) { this.headers[key] = value; },
    status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; }, send(value) { this.body = value; } };
  const handler = routes.get(`${method} ${path}`);
  assert.ok(handler, path);
  // Expected rejection paths log errors; suppress only inside this isolated test.
  const previous = console.error;
  console.error = () => {};
  try { await handler({ headers: { authorization: token ? `Bearer ${token}` : '' }, body, query: {}, params, socket: {} }, response); }
  finally { console.error = previous; }
  return response;
}
const login = await request('POST', '/api/employee-login', '', { documento: '12345', last4: '4567' });
assert.equal(login.statusCode, 200);
assert.equal(login.body.session.estado, 'inactivo');
const token = login.body.token;
assert.equal((await request('GET', '/employee-me', token)).body.session.estado, 'inactivo');
for (const method of ['GET', 'POST']) {
  for (const prefix of ['', '/api']) {
    calls.length = 0;
    assert.equal((await request(method, `${prefix}/employee-incapacities`, token)).statusCode, 403);
    assert.ok(!calls.includes('incapacitados'), 'Denied before accessing incapacity data');
  }
}
for (const path of ['/employee-incapacities/:id/support', '/api/employee-incapacities/:id/support']) {
  assert.equal((await request('POST', path, token)).statusCode, 403);
}
for (const type of ['basic', 'with_salary', 'unknown']) {
  assert.equal((await request('POST', '/api/employee-certificates', token, { type })).statusCode, 403);
}
assert.equal(audit.length, 0);
const pdf = await request('POST', '/api/employee-certificates', token, { type: 'retired', employeeId: 'someone-else', documento: '999' });
assert.equal(pdf.statusCode, 200);
assert.equal(pdf.body.subarray(0, 5).toString(), '%PDF-');
assert.equal(pdf.headers['Cache-Control'], 'no-store');
assert.equal(audit[0].employee_id, 'owner');
assert.equal(audit[0].certificate_type, 'retired');
assert.match(pdf.headers['Content-Disposition'], /retiro-12345/);
function pdfText(buffer) {
  const raw = buffer.toString('latin1');
  return [...raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].flatMap((match) => {
    try {
      const stream = inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1');
      return [...stream.matchAll(/<([0-9a-f]+)>/gi)].map((part) => Buffer.from(part[1], 'hex').toString('latin1'));
    } catch { return []; }
  }).join('');
}
assert.match(pdfText(pdf.body), /laboró/);
assert.match(pdfText(pdf.body), /31\s*de\s*agosto\s*de\s*2026/);
assert.match(pdfText(pdf.body), /1\s*de\s*febrero\s*de\s*2026/);
assert.doesNotMatch(pdfText(pdf.body), /se\s*encuentra\s*vinculado|Actualmente\s*devenga/);
history = [
  { fecha_ingreso: '2020-01-01', source: 'import' },
  { fecha_ingreso: '2026-01-01', source: 'rehire_employee' },
  { fecha_ingreso: '2026-02-01', source: 'transfer' }
];
const rehiredPdf = await request('POST', '/employee-certificates', token, { type: 'retired' });
assert.equal(rehiredPdf.statusCode, 200);
assert.match(pdfText(rehiredPdf.body), /1\s*de\s*enero\s*de\s*2026/);
assert.doesNotMatch(pdfText(rehiredPdf.body), /2020/);
history = [];
employee.fecha_ingreso = '2026-02-01';
// Functions must be resolved from the employee's cargo, never request input.
for (const [state, type, wrongType] of [['inactivo', 'retired_with_functions', 'with_functions'], ['activo', 'with_functions', 'retired_with_functions']]) {
  employee.estado = state;
  const result = await request('POST', '/api/employee-certificates', token, { type, funciones: 'Injected duties', employeeId: 'another' });
  assert.equal(result.statusCode, 200);
  assert.match(pdfText(result.body), /Revisar\s*equipos/);
  assert.match(pdfText(result.body), /Registrar\s*novedades/);
  assert.doesNotMatch(pdfText(result.body), /Injected|Actualmente\s*devenga/);
  assert.equal(audit.at(-1).certificate_type, type);
  assert.equal(audit.at(-1).employee_id, employee.id);
  assert.match(result.headers['Content-Disposition'], /con-funciones/);
  assert.equal((await request('POST', '/api/employee-certificates', token, { type: wrongType })).statusCode, 403);
  cargo.funciones = ' ';
  const beforeAudit = audit.length;
  const missing = await request('POST', '/api/employee-certificates', token, { type });
  assert.equal(missing.statusCode, 409);
  assert.equal(missing.body.code, 'missing_functions');
  assert.equal(audit.length, beforeAudit);
  cargo.funciones = 'Revisar equipos.\nRegistrar novedades.';
}
employee.estado = 'inactivo';
const longFunctions = Array.from({length:100}, (_,i) => `Funcion ${i+1}: Revisar equipos y registrar resultados de la jornada.`).join('\n');
const longPdf = await certificates.buildEmployeeCertificatePdf({employee, cargo: {...cargo, funciones:longFunctions}, type:'retired_with_functions'});
for (let i = 1; i <= 100; i++) assert.match(pdfText(longPdf), new RegExp(`Funcion\\s*${i}:`));
assert.ok((longPdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length > 1, 'Long functions span multiple pages');
await fs.mkdir(new URL('../tmp/', import.meta.url), {recursive:true});
await fs.writeFile(new URL('../tmp/certificate-functions-long.pdf', import.meta.url), longPdf);

for (const value of [null, '2026-02-30', '2025-01-01']) {
  employee.fecha_retiro = value;
  for (const type of ['retired', 'retired_with_functions']) assert.equal((await request('POST', '/api/employee-certificates', token, { type })).statusCode, 409);
}
employee.fecha_retiro = '2026-08-31';
employee.estado = 'activo';
assert.equal((await request('GET', '/api/employee-me', token)).body.session.estado, 'activo');
assert.equal((await request('GET', '/api/employee-incapacities', token)).statusCode, 200);
assert.equal((await request('POST', '/api/employee-certificates', token, { type: 'retired' })).statusCode, 403);
assert.equal((await request('POST', '/api/employee-certificates', token, { type: 'basic' })).statusCode, 200);
assert.equal((await request('POST', '/api/employee-certificates', token, { type: 'with_salary' })).statusCode, 200);
// A previously active session loses operational access immediately upon retirement.
employee.estado = 'inactivo';
assert.equal((await request('GET', '/api/employee-incapacities', token)).statusCode, 403);
assert.equal((await request('GET', '/api/employee-me', token)).body.session.estado, 'inactivo');
assert.equal((await request('POST', '/api/employee-certificates', '', { type: 'retired' })).statusCode, 401);
assert.equal((await request('POST', '/api/employee-login', '', { documento: '12345', last4: '0000' })).statusCode, 403);
employee.estado = 'suspendido';
assert.equal((await request('POST', '/api/employee-login', '', { documento: '12345', last4: '4567' })).statusCode, 403);
employee.estado = 'inactivo';
sessions[0].expires_at = '2000-01-01';
assert.equal((await request('GET', '/api/employee-me', token)).statusCode, 401);
assert.equal((await request('POST', '/api/employee-certificates', token, { type: 'retired' })).statusCode, 401);

// Administrative UI submits the retirement type, and the authenticated admin
// endpoint generates the same PDF while retaining its role checks.
profile = { id: 'admin', role: 'admin', estado: 'activo', email: 'admin@example.test' };
const adminSource = await fs.readFile(new URL('../src/assets/js/components/EmployeesAdmin.js', import.meta.url), 'utf8');
const modalSource = adminSource.slice(adminSource.indexOf('  async function openCertificateModal(e){'), adminSource.indexOf('  async function openEditEmployeeModal(e){'));
let modalConfig;
let selectedType = 'with_salary';
let confirmed = true;
const adminResults = [];
const adminAudit = [];
const alerts = [];
const adminContext = vm.createContext({
  alert: (message) => alerts.push(message),
  showActionModal: async (options) => { modalConfig = options; return { confirmed, values: { type: selectedType } }; },
  deps: {
    async generateEmployeeCertificate(id, type) {
      adminResults.push(await request('POST', '/api/certificates/employees/:employeeId', 'admin-token', { type }, { employeeId: id }));
    },
    async addAuditLog(entry) { adminAudit.push(entry); }
  }
});
vm.runInContext(modalSource, adminContext);
await adminContext.openCertificateModal(employee);
assert.equal(modalConfig.fields[0].options.length, 2);
assert.equal(modalConfig.fields[0].options[0].value, 'retired');
assert.equal(adminResults.at(-1).statusCode, 200);
assert.match(pdfText(adminResults.at(-1).body), /laboró/);
assert.match(pdfText(adminResults.at(-1).body), /31\s*de\s*agosto\s*de\s*2026/);
assert.equal(adminAudit.at(-1).after.type, 'retired');
assert.equal(audit.at(-1).channel, 'admin');
assert.equal(audit.at(-1).requested_by_profile_id, 'admin');
selectedType = 'retired_with_functions';
await adminContext.openCertificateModal(employee);
assert.equal(adminResults.at(-1).statusCode, 200);
assert.match(pdfText(adminResults.at(-1).body), /Revisar\s*equipos/);
assert.equal(adminAudit.at(-1).after.type, 'retired_with_functions');
assert.equal((await request('POST', '/api/certificates/employees/:employeeId', token, { type: 'retired' }, { employeeId: employee.id })).statusCode, 401);
profile.role = 'empleado';
assert.equal((await request('POST', '/api/certificates/employees/:employeeId', 'admin-token', { type: 'retired' }, { employeeId: employee.id })).statusCode, 403);
profile.role = 'admin';
employee.estado = 'activo';
for (selectedType of ['basic', 'with_salary', 'with_functions']) {
  await adminContext.openCertificateModal(employee);
  assert.equal(modalConfig.fields[0].options.length, 3);
  assert.equal(adminResults.at(-1).statusCode, 200);
  assert.equal(adminAudit.at(-1).after.type, selectedType);
  assert.match(pdfText(adminResults.at(-1).body), /se\s*encuentra\s*vinculado/);
}
const previousCount = adminResults.length;
confirmed = false;
await adminContext.openCertificateModal(employee);
assert.equal(adminResults.length, previousCount);
assert.equal(alerts.length, 0);

const sql = new PGlite();
await sql.exec(`create table employee_certificate_audit(certificate_type text not null check(certificate_type in ('basic','with_salary')));
  insert into employee_certificate_audit values ('basic'),('with_salary');`);
const migration = await fs.readFile(new URL('../supabase/schema_operations_phase56_retired_certificates.sql', import.meta.url), 'utf8');
await sql.exec(migration);
await sql.exec(migration);
await sql.exec("insert into employee_certificate_audit values ('retired')");
await assert.rejects(sql.exec("insert into employee_certificate_audit values ('unknown')"));
assert.equal((await sql.query('select count(*)::int n from employee_certificate_audit')).rows[0].n, 3);
await sql.exec("create table cargos(id int primary key)");
const functionsMigration = await fs.readFile(new URL('../supabase/schema_operations_phase57_cargo_functions.sql', import.meta.url), 'utf8');
await sql.exec(functionsMigration);
await sql.exec(functionsMigration);
await sql.exec("insert into cargos(id) values (1); insert into employee_certificate_audit values ('with_functions'),('retired_with_functions')");
assert.equal((await sql.query('select funciones from cargos')).rows[0].funciones, '');
await assert.rejects(sql.query('update cargos set funciones=$1', ['x'.repeat(12001)]));
await sql.close();

// Render the actual dashboard without a browser or network; retired users must
// not even mount the component that requests incapacity records.
class Element {
  constructor(tag, attrs = {}, children = []) { this.tag = tag; Object.assign(this, attrs); this.children = children; this.dataset = {}; this.listeners = {}; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(event, handler) { this.listeners[event] = handler; }
  querySelector(tag) { return descendants(this).find((node) => node.tag === tag); }
}
function descendants(node) { return [node, ...(node.children || []).flatMap((child) => typeof child === 'object' ? descendants(child) : [])]; }
const root = new Element('main');
let mounts = 0;
const uiContext = vm.createContext({ document: { getElementById: () => root },
  sessionStorage: { getItem: () => '', removeItem() {} }, window: {}, console, URL, Blob, AbortController,
  fetch: () => { throw new Error('Unexpected UI network request'); } });
const uiSource = await fs.readFile(new URL('../src/assets/js/employee-app.js', import.meta.url), 'utf8');
const ui = new vm.SourceTextModule(uiSource.replace(/renderLoading\(\);\s*renderDashboard\(\);\s*$/, '') + '\nexport { renderDashboardCard };', { context: uiContext });
await ui.link((name) => {
  const values = name.includes('EmployeeIncapacities') ? { EmployeeIncapacities: () => { mounts++; } }
    : name.includes('PortalFooter') ? { mountPortalFooter: () => {} }
    : name.includes('config') ? { EMPLOYEE_PORTAL_API_BASE: '' }
    : { el: (tag, attrs, children) => new Element(tag, attrs, children), qs: () => null };
  return new vm.SyntheticModule(Object.keys(values), function () {
    for (const [key, value] of Object.entries(values)) this.setExport(key, value);
  }, { context: uiContext });
});
await ui.evaluate();
const retiredUi = ui.namespace.renderDashboardCard({ estado: 'inactivo', nombre: 'Persona' });
const retiredButtons = descendants(retiredUi).filter((node) => node.tag === 'button').map((node) => node.children.join(''));
assert.deepEqual(retiredButtons, ['Cerrar sesión', 'Certificado laboral de retiro (laboró)', 'Certificado con funciones']);
assert.equal(mounts, 0);
const activeUi = ui.namespace.renderDashboardCard({ estado: 'activo' });
assert.equal(descendants(activeUi).filter((node) => node.tag === 'button').length, 4);
assert.equal(mounts, 1);
console.log('Retired certificates: route permissions, ownership, status transitions, PDF, dates, sessions and migration passed.');
