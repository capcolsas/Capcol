import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const ui = await fs.readFile(new URL('../src/assets/js/components/CargosAdmin.js', import.meta.url), 'utf8');
let modal, response, saved, audit;
const context = vm.createContext({
  currentContract: () => 'C', contractNameByCode: () => 'Contrato', salaryColumnLabel: () => 'Salario',
  salaryInputValue: value => String(value || ''), salaryFor: cargo => cargo.salario,
  parseSalary: value => Number(value), crudOptions: [{ value: 'supervisor', label: 'Supervisor' }],
  showActionModal: async options => { modal = options; return response; },
  saveContractSalary: async () => {}, alert: message => { if (message.startsWith('Error:')) throw Error(message); },
  deps: {
    getNextCargoCode: async () => 'SUP',
    createCargo: async payload => { saved = payload; return 'id'; },
    updateCargo: async (_id, payload) => { saved = payload; },
    addAuditLog: async payload => { audit = payload; }
  }
});
const mobility = ui.split('\n').find(line => line.includes('const mobilityField ='));
vm.runInContext(mobility, context);
vm.runInContext(ui.slice(ui.indexOf('  async function openCreateModal('), ui.indexOf('\n  if (canEdit)')), context);
vm.runInContext(ui.slice(ui.indexOf('  async function openEditModal('), ui.indexOf('\n  function recordCard(')), context);
response = { confirmed: true, values: { name: 'Supervisor', salary: '100', crud: 'supervisor', mobility: ['enabled'] } };
await context.openCreateModal();
assert.equal(modal.fields.find(field => field.id === 'mobility').value.length, 0, 'new cargos default to fixed');
assert.equal(saved.marcacionMovil, true);
assert.equal(audit.after.marcacionMovil, true);
response = { confirmed: true, values: { code: 'SUP', name: 'Supervisor', salary: '100', crud: 'supervisor', mobility: [], detail: 'Volver a sede fija' } };
await context.openEditModal({ id: 'id', codigo: 'SUP', nombre: 'Supervisor', salario: 100, marcacionMovil: true });
assert.deepEqual(Array.from(modal.fields.find(field => field.id === 'mobility').value), ['enabled']);
assert.equal(saved.marcacionMovil, false);
assert.equal(audit.before.marcacionMovil, true);
assert.equal(audit.after.marcacionMovil, false);
const previous = saved;
response = { confirmed: false };
await context.openEditModal({ id: 'id', codigo: 'SUP' });
assert.equal(saved, previous, 'cancel does not save');

const service = await fs.readFile(new URL('../src/assets/js/services/supabase/legacy.js', import.meta.url), 'utf8');
let payload;
const query = { select: () => query, single: async () => ({ data: { id: 'id' } }), eq: async () => ({ error: null }) };
const dataContext = vm.createContext({
  mapCatalogRow: row => ({ id: row.id }), getCurrentAuditFields: async () => ({}), notifyTableReload: async () => {},
  supabase: { from: table => { assert.equal(table, 'cargos'); return {
    insert: data => { payload = data; return query; }, update: data => { payload = data; return query; }
  }; } }
});
for (const [start, end] of [
  ['function mapCargoRow(', 'function mapContractCargoRow('],
  ['export async function createCargo(', 'export async function upsertContractCargo('],
  ['export async function updateCargo(', 'export async function setCargoStatus(']
]) vm.runInContext(service.slice(service.indexOf(start), service.indexOf(end)).replace(/^export /gm, ''), dataContext);
assert.equal(dataContext.mapCargoRow({ marcacion_movil: true }).marcacionMovil, true);
assert.equal(dataContext.mapCargoRow({}).marcacionMovil, false);
await dataContext.createCargo({ codigo: 'FIX', nombre: 'Fijo' });
assert.equal(payload.marcacion_movil, false);
await dataContext.createCargo({ codigo: 'SUP', nombre: 'Supervisor', marcacionMovil: true });
assert.equal(payload.marcacion_movil, true);
await dataContext.updateCargo('id', { marcacionMovil: false });
assert.equal(payload.marcacion_movil, false);
await dataContext.updateCargo('id', { funciones: 'Revisar sedes' });
assert.equal(Object.hasOwn(payload, 'marcacion_movil'), false, 'unrelated updates preserve mobility');
console.log('PASS: cargo create/edit defaults, enable/disable, cancellation, audit, read mapping and persistence.');
