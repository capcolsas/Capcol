import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

// Exercise component loading with isolated UI adapters and deferred data requests.
const source = (await fs.readFile(new URL('../src/assets/js/components/ShiftsAdmin.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
const tick = () => new Promise(resolve => setImmediate(resolve));
function screen(mode, overrides = {}, initialContract = 'A') {
  const nodes = new Map(), pagers = new Map(), subscriptions = new Map();
  let contract = initialContract;
  const node = (tag, props = {}, children = []) => {
    const result = { tag, ...props, children, value: props.value || '', textContent: '',
      append(...items) { this.children.push(...items); },
      replaceChildren(...items) { this.children = items; },
      addEventListener() {}, setAttribute() {} };
    if (props.id) nodes.set(`#${props.id}`, result);
    return result;
  };
  const calls = { employees: 0, renew: 0, rules: 0, shifts: [], assignments: [], catalogs: [], activePlans: [] };
  const active = Array.from({ length: 60 }, (_, i) => ({ id: `a${i}`, sedeCodigo: `s${i}`, templateId: 'p', estado: 'activo', contratoCodigo: 'A', horizonDays: 90 }));
  const deps = {
    streamShiftTemplates(cb, error, status, options) {
      const call = { table: 'plans', options, cb, stopped: false }; calls.catalogs.push(call);
      cb([{ id: 'p', nombre: 'Plan', contratoCodigo: contract }]); return () => { call.stopped = true; };
    },
    streamSedes(cb, error, status, options) {
      const call = { table: 'sites', options, cb, stopped: false }; calls.catalogs.push(call);
      cb([]); return () => { call.stopped = true; };
    },
    streamActiveBaseEmployees() { calls.employees++; },
    listActiveBaseEmployees() { calls.employees++; return []; },
    renewActiveShiftPlans() { calls.renew++; },
    async listShiftTemplateRuleCounts(ids) { calls.rules++; return ids.map(templateId => ({ templateId, count: 3 })); },
    async listShiftSitePlanAssignments(options) { calls.activePlans.push(options); return active; },
    async listScheduledShiftsRange(from, to, options) {
      calls.shifts.push(options);
      return (options.sedeCodigos || []).map(sedeCodigo => ({ id: sedeCodigo, sedeCodigo, templateId: 'p', fechaOperativa: from }));
    },
    async listShiftAssignmentsForShifts(ids, options) { calls.assignments.push({ ids, options }); return []; },
    async listEmployeeShiftStatusRange() { return []; },
    async listShiftClosuresRange() { return []; },
    ...overrides
  };
  const context = vm.createContext({
    console, Map, Set, Date, Intl, Promise, el: node, SHIFT_GENERATION_DAYS: 30,
    qs(selector) { if (!nodes.has(selector)) nodes.set(selector, node('div')); return nodes.get(selector); },
    can: () => true, PERMS: {}, subscribe(key, cb) { subscriptions.set(key, cb); return () => subscriptions.delete(key); },
    contractFilterCode: () => contract, contractMatches: row => row.contratoCodigo === contract,
    todayBogota: () => '2026-09-06', addIsoDays: (day, n) => new Date(Date.parse(day) + n * 86400000).toISOString().slice(0, 10),
    createTablePagination(ui, options) {
      const state = { currentPage: 1, pageSize: options.defaultPageSize || 50 };
      const pager = { state, reset() { state.currentPage = 1; }, slice(rows) {
        state.currentPage = Math.min(state.currentPage, Math.max(1, Math.ceil(rows.length / state.pageSize)));
        return rows.slice((state.currentPage - 1) * state.pageSize, state.currentPage * state.pageSize);
      }, change: options.onChange };
      pagers.set(options.id, pager); return pager;
    },
    lucideInlineIcon: () => node('i'), infoIcon: () => node('i'), editIcon: () => node('i'), deactivateIcon: () => node('i'),
    showNotification() {}, mount: node('main'), deps
  });
  vm.runInContext(`${source}\n globalThis.cleanup = ${mode}(mount, deps);`, context);
  return { calls, nodes, pagers, cleanup: context.cleanup, changeContract(code) { contract = code; subscriptions.get('selectedContractCode')(); } };
}

const generated = screen('GeneratedShiftsAdmin');
await tick();
assert.equal(generated.calls.renew, 0, 'opening the module must not generate shifts');
assert.equal(generated.calls.employees, 0, 'employees are loaded only when assigning');
assert.equal(generated.calls.shifts.length, 1);
assert.equal(generated.calls.shifts[0].sedeCodigos.length, 25);
assert.equal(generated.calls.shifts[0].contratoCodigo, 'A');
assert.equal(generated.calls.assignments[0].ids.length, 25);
assert.equal(generated.calls.assignments[0].options.summaryOnly, true);
assert.equal(generated.calls.catalogs.length, 2);
assert(generated.calls.catalogs.every(call => call.options.contratoCodigo === 'A'));
generated.changeContract('A');
await tick();
assert.equal(generated.calls.activePlans.length, 1, 're-emitting the selected contract must not reload');
assert.equal(generated.calls.catalogs.length, 2);
const pager = generated.pagers.get('generatedShifts');
pager.state.currentPage = 2;
const previousRows = generated.nodes.get('#tblGeneratedShifts tbody').children;
const changingPage = pager.change();
assert.equal(generated.nodes.get('#tblGeneratedShifts tbody').children, previousRows, 'keep the current rows until the response is complete');
assert.equal(generated.nodes.get('#tblGeneratedShifts tbody').inert, true, 'old rows cannot be edited during loading');
await changingPage;
assert.equal(generated.nodes.get('#tblGeneratedShifts tbody').inert, false);
assert.equal(pager.state.currentPage, 2, 'loading must preserve the requested page');
assert.equal(generated.calls.shifts[1].sedeCodigos.length, 25);
assert.equal(generated.calls.shifts[1].sedeCodigos.some(code => generated.calls.shifts[0].sedeCodigos.includes(code)), false);
generated.changeContract('B');
await tick();
assert(generated.calls.catalogs.slice(0, 2).every(call => call.stopped));
assert(generated.calls.catalogs.slice(2).every(call => call.options.contratoCodigo === 'B'));
assert.equal(generated.calls.activePlans.at(-1).contratoCodigo, 'B');
const currentRows = generated.nodes.get('#tblGeneratedShifts tbody').children;
generated.calls.catalogs[0].cb([{ id: 'old', nombre: 'Old contract', contratoCodigo: 'A' }]);
assert.equal(generated.nodes.get('#tblGeneratedShifts tbody').children, currentRows, 'late catalog callbacks from the old contract are ignored');
generated.cleanup();

const unscoped = screen('GeneratedShiftsAdmin', {}, '');
await tick();
assert.equal(unscoped.calls.catalogs.length, 0);
assert.equal(unscoped.calls.activePlans.length, 0);
assert.equal(unscoped.calls.shifts.length, 0);
assert.match(unscoped.nodes.get('#generatedShiftMsg').textContent, /Selecciona un contrato/);
unscoped.changeContract('A');
await tick();
assert.equal(unscoped.calls.activePlans.length, 1);
unscoped.changeContract('');
await tick();
assert.equal(unscoped.calls.activePlans.length, 1, 'clearing the contract cannot trigger a global query');
assert(unscoped.calls.catalogs.every(call => call.stopped));
unscoped.cleanup();

const plans = screen('ShiftPlansAdmin');
await tick();
assert.equal(plans.calls.rules, 1, 'one batch counts rules for every plan');
assert.equal(plans.calls.employees, 0);
assert.equal(plans.calls.shifts.length, 0);
plans.cleanup();
const review = screen('ShiftReviewAdmin');
await tick();
assert.equal(review.calls.employees, 0);
assert.equal(review.calls.rules, 0);
review.cleanup();

const pending = [];
const race = screen('GeneratedShiftsAdmin', {
  listShiftSitePlanAssignments: () => new Promise(resolve => pending.push(resolve))
});
race.changeContract('B');
pending[1]([]);
await tick();
const message = race.nodes.get('#generatedShiftMsg').textContent;
pending[0]([{ sedeCodigo: 'old', templateId: 'p' }]);
await tick();
assert.equal(race.calls.shifts.length, 0, 'obsolete contract requests must stop before downloading shifts');
assert.equal(race.nodes.get('#generatedShiftMsg').textContent, message);
race.cleanup();
console.log('Shift loading: pagination, minimal requests, lazy employees and stale responses passed.');

const service = await fs.readFile(new URL('../src/assets/js/services/supabase/legacy.js', import.meta.url), 'utf8');
const queries = [];
const query = new Proxy({}, { get: (_, method) => (...args) => { queries.push([method, ...args]); return query; } });
const serviceContext = vm.createContext({
  supabase: { from: (...args) => { queries.push(['from', ...args]); return query; } },
  selectPagedRows: async build => { build(); return []; },
  chunkArray: (rows, size) => Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size)),
  mapScheduledShiftRow: row => row, mapShiftAssignmentRow: row => row, mapEmployeeShiftStatusRow: row => row
});
for (const name of ['listScheduledShiftsRange', 'listShiftAssignmentsForShifts', 'listEmployeeShiftStatusRange']) {
  const start = service.indexOf(`export async function ${name}(`);
  const end = service.indexOf('\n}', start) + 2;
  vm.runInContext(service.slice(start, end).replace('export ', ''), serviceContext);
}
await serviceContext.listScheduledShiftsRange('2026-09-07', '2026-12-05', { contratoCodigo: 'A', sedeCodigos: ['s1'], templateIds: ['p'] });
assert(queries.some(([op, key, value]) => op === 'eq' && key === 'contrato_codigo' && value === 'A'));
assert(queries.some(([op, key]) => op === 'in' && key === 'sede_codigo'));
assert(queries.some(([op, key]) => op === 'in' && key === 'template_id'));
queries.length = 0;
await serviceContext.listShiftAssignmentsForShifts(['s1'], { summaryOnly: true });
assert(queries.some(([op, value]) => op === 'select' && value === 'id,scheduled_shift_id,employee_id,documento,estado'));
queries.length = 0;
await serviceContext.listShiftAssignmentsForShifts(['s1']);
assert(queries.some(([op, value]) => op === 'select' && value === '*'), 'editing still gets complete assignments');
queries.length = 0;
await serviceContext.listEmployeeShiftStatusRange('2026-09-01', '2026-09-06', { reviewableOnly: true });
assert(queries.some(([op, value]) => op === 'or' && value.includes('requires_review.eq.true') && value.includes('salida_pendiente')));
console.log('Shift queries: server filters, minimal summary fields and full editing data passed.');
