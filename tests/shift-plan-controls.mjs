import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { netRuleMinutes, formatHours, STANDARD_DAILY_MINUTES } from '../src/assets/js/utils/rotationHours.js';

const source = await fs.readFile(new URL('../src/assets/js/components/ShiftsAdmin.js', import.meta.url), 'utf8');
const modalCode = source.slice(source.indexOf('  async function openPlanModal('), source.indexOf('  async function deletePlan('));
const blankCode = source.slice(source.indexOf('  function blankRule('), source.indexOf('  function filteredTemplates('));
const constants = source.slice(source.indexOf('const DAY_OPTIONS'), source.indexOf('export const ShiftsAdmin'));

function el(tag, props = {}, children = []) {
  const node = {
    tag, ...props, children, handlers: {}, isConnected: true,
    value: props.value ?? (tag === 'select' ? children.find(n => n.selected)?.value ?? children[0]?.value ?? '' : ''),
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = nodes; },
    addEventListener(event, handler) { this.handlers[event] = handler; },
    getAttribute(name) { return this[name]; },
    focus() {}, remove() { this.isConnected = false; },
    querySelectorAll(selector) {
      const matches = n => selector.split(',').some(raw => {
        const s = raw.trim();
        if (s.startsWith('.')) return (n.className || '').split(' ').includes(s.slice(1));
        const attr = s.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
        if (attr) return n[attr[1]] !== undefined && (attr[2] === undefined || n[attr[1]] === attr[2]);
        return n.tag === s;
      });
      return this.children.filter(n => typeof n === 'object').flatMap(n => [ ...(matches(n) ? [n] : []), ...n.querySelectorAll(selector) ]);
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  };
  return node;
}

const controls = {
  ventanaEntradaAntesMinutos: 60, alertaEntradaAntesMinutos: 10,
  ventanaEntradaDespuesMinutos: 30, alertaEntradaDespuesMinutos: 5,
  ventanaSalidaAntesMinutos: 30, alertaSalidaAntesMinutos: 5,
  ventanaSalidaDespuesMinutos: 60, alertaSalidaDespuesMinutos: 10,
  ventanaNovedadHoras: 48
};
let saved = null;
let planWrites = 0, ruleWrites = 0, auditWrites = 0, deferRules = null;
let rows = ['1', '2', null].map((day, i) => ({
  id: `r${i}`, tipoDia: day ? 'dia_semana' : 'festivo', diaSemana: day,
  horaInicio: '08:00', horaFin: '16:00', frecuenciaTipo: 'todos', estado: 'activo',
  ...controls, ventanaNovedadHoras: i === 1 ? 24 : 48
}));
const body = el('body');
const messages = [];
const context = vm.createContext({
  el, qs: (selector, root) => root.querySelector(selector), canEdit: true,
  lunchSupported: false, DEFAULT_LUNCH_MINUTES: 60, netRuleMinutes, formatHours, STANDARD_DAILY_MINUTES,
  document: { body, querySelector: s => body.querySelector(s), addEventListener() {}, removeEventListener() {} },
  field: (label, input) => el('label', {}, [label, input]),
  optionNodes: (options, value) => options.map(o => el('option', { value: o.value, selected: String(o.value) === String(value) }, [o.label])),
  nextPlanOrder: () => 1, nextRuleOrder: () => 1, todayBogota: () => '2026-09-26',
  currentContractCode: () => 'C', refreshRuleCounts: async () => {},
  ruleRevision: 0, ruleCounts: new Map(), disposed: false, render() {},
  notify: message => messages.push(message), showActionModal: async () => ({ confirmed: true }),
  deps: {
    listShiftTemplateRules: async () => rows,
    updateShiftTemplate: async () => { planWrites++; return { id: 'P' }; },
    createShiftTemplate: async () => ({ id: 'P' }),
    addAuditLog: async () => { auditWrites++; },
    saveShiftTemplateRules: async payload => {
      ruleWrites++;
      if (deferRules) await deferRules;
      saved = payload;
      const changedIds = new Set([...payload.rules.map(row => row.id), ...payload.inactiveRuleIds]);
      rows = [...rows.filter(row => !changedIds.has(row.id)), ...payload.rules.map((row, i) => ({ ...row, id: row.id || `inserted-${i}` }))];
    }
  }
});
vm.runInContext(constants + blankCode + modalCode, context);
const open = async template => {
  body.replaceChildren();
  await context.openPlanModal(template);
  return body.querySelector('.shift-plan-modal');
};
const button = (root, text) => root.querySelectorAll('button').find(n => n.children.includes(text));
const template = { id: 'P', nombre: 'Plan' };
let dialog = await open(template);
assert.equal(dialog.querySelectorAll('[data-plan-control]').length, 9, 'one set of controls for the entire plan');
assert.equal(dialog.querySelectorAll('fieldset').length, 3);
for (const row of dialog.querySelectorAll('.shift-rule-row')) {
  assert.equal(row.querySelectorAll('[data-plan-control]').length, 0);
  assert.equal(row.querySelector('[data-field="ventanaNovedadHoras"]'), null);
}
assert(dialog.querySelectorAll('p').some(n => String(n.children).includes('controles diferentes')));
dialog.querySelector('[data-plan-control="ventanaNovedadHoras"]').value = '72';
dialog.querySelector('[data-plan-control="alertaEntradaAntesMinutos"]').value = '15';
await button(dialog, 'Agregar horario').handlers.click();
let added = dialog.querySelectorAll('.shift-rule-row').at(-1);
added.querySelector('[data-field="horaInicio"]').value = '09:00';
added.querySelector('[data-field="horaFin"]').value = '17:00';
const addingBatch = button(dialog, 'Agregar lunes-viernes').handlers.click();
const batch = body.querySelector('.shift-weekday-modal');
assert.equal(batch.querySelectorAll('[data-plan-control]').length, 0);
batch.querySelector('[data-weekday-field="horaInicio"]').value = '07:00';
batch.querySelector('[data-weekday-field="horaFin"]').value = '15:00';
button(batch, 'Agregar 5 horarios').handlers.click();
await addingBatch;
await button(dialog, 'Guardar cambios').handlers.click();
assert(saved, messages.join('\n'));
assert.equal(body.children[0].isConnected, false, 'successful saving closes the modal instead of leaving Guardando visible');
assert.equal(saved.rules.length, 9);
for (const row of saved.rules) {
  for (const [name, expected] of Object.entries({ ...controls, ventanaNovedadHoras: 72, alertaEntradaAntesMinutos: 15 })) {
    assert.equal(row[name], expected, `${name} applies to existing, new, batch and holiday rules`);
  }
}
dialog = await open(template);
assert.equal(dialog.querySelector('[data-plan-control="ventanaNovedadHoras"]').value, '72', 'saved values survive reopening');
assert(!dialog.querySelectorAll('p').some(n => String(n.children).includes('controles diferentes')));
let counts = [planWrites, ruleWrites, auditWrites];
await button(dialog, 'Guardar cambios').handlers.click();
assert.deepEqual([planWrites, ruleWrites, auditWrites], counts, 'saving an unchanged plan does not write or audit');
dialog = await open(template);
dialog.querySelector('[data-plan-field="nombre"]').value = 'Renamed';
await button(dialog, 'Guardar cambios').handlers.click();
assert.deepEqual([planWrites, ruleWrites, auditWrites], [counts[0] + 1, counts[1], counts[2] + 1], 'renaming does not rewrite schedules');
dialog = await open(template);
dialog.querySelector('.shift-rule-row').querySelector('[data-field="horaInicio"]').value = '06:00';
let release;
deferRules = new Promise(resolve => { release = resolve; });
counts = [planWrites, ruleWrites, auditWrites];
const saving = button(dialog, 'Guardar cambios').handlers.click();
await Promise.resolve();
await button(dialog, 'Cancelar').handlers.click();
assert.equal(body.children[0].isConnected, true, 'pending persistence cannot be dismissed');
await button(dialog, 'Guardar cambios').handlers.click();
assert.equal(ruleWrites, counts[1] + 1, 'double click cannot submit twice');
release();
await saving;
deferRules = null;
assert.equal(saved.rules.length, 1, 'changing one schedule only writes that schedule');
assert.equal(planWrites, counts[0], 'schedule changes do not rewrite plan metadata');
assert.equal(body.children[0].isConnected, false);
dialog = await open(template);
saved = null;
dialog.querySelector('[data-plan-control="alertaEntradaAntesMinutos"]').value = '61';
await button(dialog, 'Guardar cambios').handlers.click();
assert.equal(saved, null, 'invalid common thresholds are rejected before saving');
dialog = await open(null);
assert.equal(dialog.querySelector('[data-plan-control="ventanaNovedadHoras"]').value, '48');
assert.equal(dialog.querySelectorAll('[data-plan-control]').length, 9, 'new plans have controls before any days are added');
// Almuerzo por horario (fase SQL 66): campo en cada regla, 60 min por defecto y validacion.
context.lunchSupported = true;
dialog = await open(null);
dialog.querySelector('[data-plan-field="nombre"]').value = 'Con almuerzo';
await button(dialog, 'Agregar horario').handlers.click();
added = dialog.querySelectorAll('.shift-rule-row').at(-1);
const lunch = added.querySelector('[data-field="almuerzoMinutos"]');
assert(lunch, 'cada horario tiene su campo de almuerzo');
assert.equal(lunch.value, '60', 'el almuerzo por defecto es de una hora');
added.querySelector('[data-field="horaInicio"]').value = '07:00';
added.querySelector('[data-field="horaFin"]').value = '08:00';
lunch.value = '90';
saved = null;
await button(dialog, 'Crear plan').handlers.click();
assert.equal(saved, null, 'un almuerzo mayor al turno se rechaza antes de guardar');
// Tras un rechazo el boton cambia de texto en esta maqueta; se abre un editor nuevo con datos validos.
dialog = await open(null);
dialog.querySelector('[data-plan-field="nombre"]').value = 'Con almuerzo';
await button(dialog, 'Agregar horario').handlers.click();
added = dialog.querySelectorAll('.shift-rule-row').at(-1);
added.querySelector('[data-field="horaInicio"]').value = '07:00';
added.querySelector('[data-field="horaFin"]').value = '15:00';
added.querySelector('[data-field="almuerzoMinutos"]').value = '30';
await button(dialog, 'Crear plan').handlers.click();
assert(saved, messages.join('\n'));
assert.equal(saved.rules.at(-1).almuerzoMinutos, 30, 'el almuerzo se guarda por horario');
context.lunchSupported = false;
dialog = await open(null);
await button(dialog, 'Agregar horario').handlers.click();
assert.equal(dialog.querySelectorAll('.shift-rule-row').at(-1).querySelector('[data-field="almuerzoMinutos"]'), null, 'sin la fase 66 no se muestra el almuerzo');

console.log('Plan controls: one shared editor, legacy differences, existing/new/holiday/batch rules, persistence and validation passed.');
