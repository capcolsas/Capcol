import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { cycleEntries } from '../src/assets/js/utils/rotationCycle.js';
import { addIsoDays, todayBogota } from '../src/assets/js/utils/shiftCalendar.js';
import * as rotationHours from '../src/assets/js/utils/rotationHours.js';
import * as rotationCoverage from '../src/assets/js/utils/rotationCoverage.js';

function el(tag, props = {}, children = []) {
  return { tag, ...props, children, value: props.value ?? '', isConnected: true,
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = nodes; },
    setAttribute(key, value) { this[key] = value; }
  };
}
const all = root => [root, ...root.children.filter(n => n && typeof n === 'object').flatMap(all)];
const button = (root, label) => all(root).find(n => n.tag === 'button' && (n['aria-label'] === label || n.children.includes(label)));
const field = (root, label) => all(root).find(n => n['aria-label'] === label);
const mount = el('main');
let modal = el('div'), confirmed = true, modalValues = {}, paused = 0, deleted = 0, savedRules;
const row = { id: 'R', nombre: 'Rotacion', estado: 'borrador', config: {
  site: 'S', start: '2026-09-27', days: 7, cycle: ['P'], members: [{ employee: 'E', offset: 0 }], rules: {}
} };
const rows = [row];
const deps = {
  listShiftRotations: async () => rows,
  streamSedes: cb => { cb([{ codigo: 'S', contratoCodigo: 'A', estado: 'activo' }]); },
  streamShiftTemplates: cb => { cb([{ id: 'P', nombre: 'Plan', contratoCodigo: 'A', estado: 'activo' }]); },
  listActiveBaseEmployees: async () => [{ id: 'E', nombre: 'Ana', contratoCodigo: 'A', sedeCodigo: 'S', estado: 'activo' },
    { id: 'F', nombre: 'Beto', contratoCodigo: 'A', sedeCodigo: 'S', estado: 'activo' }, { id: 'G', nombre: 'Carla', contratoCodigo: 'A', sedeCodigo: 'S', estado: 'activo' }],
  previewShiftRotation: async () => [],
  updateShiftRotationRules: async (_id, rules) => { savedRules = rules; row.config.rules = rules; },
  pauseShiftRotation: async () => { paused++; row.estado = 'pausado'; },
  deleteShiftRotation: async () => { deleted++; rows.length = 0; }
};
const source = (await fs.readFile(new URL('../src/assets/js/components/ShiftRotationsAdmin.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/gm, '').replace('export function', 'function');
const context = vm.createContext({ el, lucideInlineIcon: () => el('i'), subscribe: () => () => {},
  contractFilterCode: () => 'A', can: () => true, PERMS: {}, cycleEntries, addIsoDays, ...rotationHours, ...rotationCoverage,
  SHIFT_GENERATION_DAYS: 30, todayBogota: () => '2026-09-26',
  showInfoModal: (_title, content) => { modal = el('div', {}, content); }, closeInfoModal() {},
  showActionModal: async () => ({ confirmed, values: modalValues }), closeActionModal() {}
});
vm.runInContext(source, context);
context.ShiftRotationsAdmin(mount, deps);
await new Promise(resolve => setImmediate(resolve));
assert(button(mount, 'Activar rotacion'));
assert(button(mount, 'Eliminar rotacion'));
await button(mount, 'Reglas y disponibilidad').onclick();
const rest = field(modal, 'Descanso de Ana');
assert(rest, 'existing members can configure weekly rest without recreating the rotation');
rest.value = '1'; rest.onchange();
await all(modal).find(n => n.tag === 'form').onsubmit({ preventDefault() {} });
assert.equal(savedRules.weeklyRestDays.E, 1);
assert(all(modal).some(n => n.tag === 'strong' && n.children.includes('Descanso')), 'calendar marks the selected weekly rest');
row.estado = 'activo';
context.ShiftRotationsAdmin(mount, deps);
await new Promise(resolve => setImmediate(resolve));
assert(button(mount, 'Pausar rotacion'), 'pause is accessible directly from the list');
assert(!button(mount, 'Eliminar rotacion'), 'active rotations must be paused first');
confirmed = false;
await button(mount, 'Pausar rotacion').onclick();
assert.equal(paused, 0);
confirmed = true;
await button(mount, 'Pausar rotacion').onclick();
assert.equal(paused, 1);
await button(mount, 'Eliminar rotacion').onclick();
assert.equal(deleted, 1);

// Calendario con horas: semanas lunes-domingo, total frente al limite legal, extras y descansos.
const texts = root => all(root).flatMap(n => n.children.filter(c => typeof c === 'string'));
const monday = rotationHours.weekStartIso(addIsoDays(todayBogota(), 8)); // siempre futuro: los descansos solo se mueven en dias futuros
const iso = i => addIsoDays(monday, i);
rows.push({ id: 'R2', nombre: 'Rotacion semanal', estado: 'borrador', config: {
  site: 'S', start: monday, days: 1, cycle: [null, 'P', 'P', 'P', 'P', 'P', 'P'], members: [{ employee: 'E', offset: 0 }], rules: {}
} });
deps.previewShiftRotation = async () => Array.from({ length: 14 }, (_, i) => i).filter(i => i % 7 !== 0)
  .map(i => ({ fecha: iso(i), employee_id: 'E', template_id: 'P', shift_id: 'S' + i, result: 'Por asignar' }));
deps.listScheduledShiftsRange = async () => Array.from({ length: 14 }, (_, i) => ({ id: 'S' + i, startsAt: iso(i) + 'T07:00:00-05:00', endsAt: iso(i) + 'T15:00:00-05:00' }));
context.ShiftRotationsAdmin(mount, deps);
await new Promise(resolve => setImmediate(resolve));
await button(mount, 'Calendario y validacion').onclick();
let shown = texts(modal);
assert(shown.includes('Limite legal: 42 h'), 'muestra el limite semanal legal vigente');
assert(shown.includes('48 h'), 'suma las horas de la semana');
assert(shown.includes('+6 h extras sobre 42 h'), 'muestra las horas extras sobre el limite');
assert(shown.includes('Descansa: dom'), 'indica el dia de descanso de la rotacion');
assert(shown.includes('Personas en descanso'), 'la semana resume cuantas personas descansan cada dia');
assert(shown.includes('07:00 - 15:00') && shown.includes('8 h'), 'cada turno muestra su horario y horas');
assert(!shown.includes('No se pudieron consultar los turnos generados: las horas no estan disponibles.'));
deps.listScheduledShiftsRange = async () => { throw new Error('sin permiso'); };
await button(mount, 'Calendario y validacion').onclick();
shown = texts(modal);
assert(shown.includes('No se pudieron consultar los turnos generados: las horas no estan disponibles.'), 'avisa cuando las horas no se pueden calcular');
assert(!shown.some(t => String(t).includes('extras sobre')), 'sin horas no se inventan extras');

// Reparto automatico del descanso semanal: cada empleado un dia distinto, sin tocar el resto del formulario.
rows.length = 0;
rows.push({ id: 'R3', nombre: 'Rotacion equipo', estado: 'borrador', config: {
  site: 'S', start: monday, days: 1, cycle: ['P', 'P', 'P', 'P', 'P', 'P', null], members: ['E', 'F', 'G'].map(employee => ({ employee, offset: 0 })), rules: {}
} });
context.ShiftRotationsAdmin(mount, deps);
await new Promise(resolve => setImmediate(resolve));
await button(mount, 'Reglas y disponibilidad').onclick();
assert(all(modal).some(n => n.tag === 'p' && n.children.some(c => String(c).includes('no debe ser el mismo para todos'))), 'explica que el descanso no es el mismo para todos');
await button(modal, 'Distribuir descansos').onclick();
const assigned = ['Ana', 'Beto', 'Carla'].map(nombre => field(modal, 'Descanso de ' + nombre).value);
assert(assigned.every(day => day !== ''), 'todos quedan con dia de descanso');
assert.equal(new Set(assigned).size, 3, 'ningun empleado comparte el dia: ' + assigned);
assert(assigned.every(day => day !== '0'), 'el domingo queda cubierto');
// Editor con descansos rotativos (requiere la fase SQL 66).
rows.length = 0;
rows.push({ id: 'R4', nombre: 'Rotacion rotativa', estado: 'activo', config: {
  site: 'S', start: monday, days: 1, cycle: ['P', 'P', 'P', 'P', 'P', 'P', 'P'], members: ['E', 'F'].map(employee => ({ employee, offset: 0 })), rules: { restMode: 'fijo', weeklyRestDays: { E: 3 } }
} });
deps.getShiftRotationRulesVersion = async () => 66;
context.ShiftRotationsAdmin(mount, deps);
await new Promise(resolve => setImmediate(resolve));
await button(mount, 'Reglas y disponibilidad').onclick();
const modeField = field(modal, 'Tipo de descanso');
assert(modeField, 'con la fase 66 se puede elegir descanso rotativo o fijo');
assert.equal(modeField.value, 'fijo', 'una rotacion existente conserva su modo');
modeField.value = 'rotativo'; modeField.onchange();
await all(modal).find(n => n.tag === 'form').onsubmit({ preventDefault() {} });
assert.equal(savedRules.restMode, 'rotativo');
assert.equal(Object.keys(savedRules.weeklyRestDays).length, 0, 'en modo rotativo no quedan dias fijos');
deps.getShiftRotationRulesVersion = async () => 0;
await button(mount, 'Reglas y disponibilidad').onclick();
assert(!field(modal, 'Tipo de descanso'), 'sin la fase 66 solo existe el descanso fijo');
deps.getShiftRotationRulesVersion = async () => 66;

// Calendario rotativo: descansos compensatorios, jornada de 8 h sin almuerzo, horas registradas e intercambio.
const week = Array.from({ length: 14 }, (_, i) => i);
const tue = iso(1), wed = iso(2);
rows[0].config.rules = { restMode: 'rotativo' };
deps.previewShiftRotation = async () => week.flatMap(i => ['E', 'F'].map(employee => {
  const rest = (employee === 'E' && iso(i) === tue) || (employee === 'F' && iso(i) === wed);
  return { fecha: iso(i), employee_id: employee, template_id: rest ? null : 'P', shift_id: rest ? null : 'S' + i, result: rest ? 'Descanso compensatorio' : 'Por asignar' };
}));
deps.listScheduledShiftsRange = async () => week.map(i => ({ id: 'S' + i, startsAt: iso(i) + 'T07:00:00-05:00', endsAt: iso(i) + 'T15:00:00-05:00', almuerzoMinutos: 0 }));
deps.listShiftOvertimeWeeks = async () => [{ employee_id: 'E', week_start: monday, worked_minutes: 49 * 60, limit_minutes: 42 * 60, overtime_minutes: 7 * 60 }];
let swapCall = null;
deps.swapShiftRotationRestDays = async (...args) => { swapCall = args; return 4; };
deps.addAuditLog = async () => {};
context.ShiftRotationsAdmin(mount, deps);
await new Promise(resolve => setImmediate(resolve));
await button(mount, 'Calendario y validacion').onclick();
shown = texts(modal);
assert(shown.includes('Compensatorio'), 'el descanso compensatorio se distingue del semanal');
assert(shown.some(t => String(t).startsWith('Registrado: 49 h')), 'muestra las horas registradas por el servidor');
assert(all(modal).filter(n => n.tag === 'button' && n['aria-label'] === 'Intercambiar descanso').length >= 2, 'cada descanso semanal o compensatorio se puede intercambiar');
modalValues = { other: 'F|' + wed };
await button(modal, 'Intercambiar descanso').onclick();
assert.deepEqual(swapCall, ['R4', 'E', tue, 'F', wed], 'intercambia el descanso de E con el de F en la misma semana');
assert(all(modal).some(n => n.role === 'status' && String(n.textContent).startsWith('Descansos intercambiados (4')), 'informa el resultado');
// Mover el descanso a otro dia de la misma semana: con el boton y arrastrando.
let moveCall = null;
deps.moveShiftRotationRestDay = async (...args) => { moveCall = args; return 2; };
context.ShiftRotationsAdmin(mount, deps);
await new Promise(resolve => setImmediate(resolve));
await button(mount, 'Calendario y validacion').onclick();
assert(all(modal).filter(n => n.tag === 'button' && n['aria-label'] === 'Mover descanso').length >= 2, 'cada descanso movible tiene el boton Mover descanso');
const thu = iso(3), fri = iso(4);
modalValues = { date: thu };
await all(modal).find(n => n.tag === 'button' && n['aria-label'] === 'Mover descanso').onclick();
assert.deepEqual(moveCall, ['R4', 'E', tue, thu], 'el boton mueve el descanso de E al dia elegido');
assert(all(modal).some(n => n.role === 'status' && String(n.textContent).startsWith('Descanso movido')), 'informa el resultado');
moveCall = null;
const restCell = all(modal).find(n => n.tag === 'td' && n.draggable === true);
assert(restCell, 'la celda de descanso se puede arrastrar');
const calls = [];
deps.moveShiftRotationRestDay = async (...args) => { calls.push(args); return 1; };
const event = { preventDefault() {}, dataTransfer: { setData() {} } };
for (const target of all(modal).filter(n => n.tag === 'td' && typeof n.ondrop === 'function')) {
  target.classList = { add() {}, remove() {} };
  restCell.ondragstart(event);
  await target.ondrop(event);
}
await new Promise(resolve => setImmediate(resolve));
assert(calls.length >= 1, 'soltar sobre un dia de trabajo de la misma semana mueve el descanso');
assert(calls.every(call => call[1] === 'E' && call[2] === tue && call[3] !== tue && iso(0) <= call[3]), 'solo se mueve el descanso del empleado arrastrado, dentro de su semana');
assert(calls.every(call => new Date(call[3] + 'T00:00:00Z').getUTCDay() !== 0), 'nunca se suelta sobre domingo');
void fri;
delete deps.moveShiftRotationRestDay;
// Activar/aplicar: si hay programacion manual se ofrece conservarla o reemplazarla.
{
  const calls = [];
  deps.replaceManualShiftAssignments = async (id, dryRun) => { calls.push([id, dryRun]); return dryRun ? 5 : 5; };
  deps.applyShiftRotation = async () => 3;
  context.ShiftRotationsAdmin(mount, deps);
  await new Promise(resolve => setImmediate(resolve));
  await button(mount, 'Calendario y validacion').onclick();
  const applyButton = all(modal).find(n => n.tag === 'button' && (n.children || []).includes('Aplicar a turnos nuevos'));
  assert(applyButton, 'la rotacion activa ofrece aplicar a turnos nuevos');
  modalValues = { manual: 'keep' };
  await applyButton.onclick();
  assert.deepEqual(calls, [['R4', true]], 'conservar solo consulta cuantas asignaciones manuales hay');
  calls.length = 0;
  modalValues = { manual: 'replace' };
  await applyButton.onclick();
  assert.deepEqual(calls, [['R4', true], ['R4', false]], 'reemplazar las elimina antes de aplicar la rotacion');
  assert(all(modal).some(n => n.role === 'status' && String(n.textContent).includes('se reemplazaron 5 manuales')), 'informa cuantas asignaciones manuales se reemplazaron');
  delete deps.replaceManualShiftAssignments;
  delete deps.applyShiftRotation;
}
// Sin la funcion de intercambio o con rotacion de descanso fijo no se ofrece el boton.
delete deps.swapShiftRotationRestDays;
context.ShiftRotationsAdmin(mount, deps);
await new Promise(resolve => setImmediate(resolve));
await button(mount, 'Calendario y validacion').onclick();
assert(!button(modal, 'Intercambiar descanso'), 'sin soporte del servidor no hay intercambio');
// Ciclo por cupos y cobertura: manana 1, tarde 1, noche 2 con 4 personas.
{
  const people = ['Ana', 'Beto', 'Carla', 'Dani'];
  rows.length = 0;
  rows.push({ id: 'R6', nombre: 'Explora', estado: 'borrador', config: {
    site: 'S', start: monday, days: 7, cycle: ['P', 'Q', 'N'], members: [['E', 0], ['F', 1], ['G', 1], ['H', 2]].map(([employee, offset]) => ({ employee, offset })), rules: {}
  } });
  const originalEmployees = deps.listActiveBaseEmployees;
  deps.listActiveBaseEmployees = async () => ['E', 'F', 'G', 'H'].map((id, i) => ({ id, nombre: people[i], contratoCodigo: 'A', sedeCodigo: 'S', estado: 'activo' }));
  const quotaShifts = [{ templateId: 'P', operariosPlaneados: 1 }, { templateId: 'Q', operariosPlaneados: 1 }, { templateId: 'N', operariosPlaneados: 2 }];
  deps.listScheduledShiftsRange = async () => quotaShifts;
  context.ShiftRotationsAdmin(mount, deps);
  await new Promise(resolve => setImmediate(resolve));
  await button(mount, 'Crear version').onclick();
  await button(modal, 'Armar ciclo por cupos').onclick();
  assert.equal(field(modal, 'Plan de etapa 4')?.value, 'N', 'la noche se repite por sus 2 cupos');
  assert(!field(modal, 'Plan de etapa 5'), 'el ciclo queda en 4 etapas');
  assert.deepEqual(people.map(name => field(modal, 'Etapa inicial de ' + name).value), [0, 1, 2, 3], 'cada persona toma una posicion distinta');
  assert(all(modal).some(n => n.role === 'status' && String(n.textContent).includes('Cada etapa cubre exactamente los cupos')), 'confirma que cubre los cupos');
  // Relevos (fase 66 actualizada, version 67): el control existe solo con soporte y el ciclo por cupos no cuenta al relevo.
  assert(!field(modal, 'Relevo: Dani'), 'sin la version 67 no se ofrece marcar relevos');
  deps.getShiftRotationRulesVersion = async () => 67;
  deps.listActiveBaseEmployees = async () => ['E', 'F', 'G', 'H'].map((id, i) => ({ id, nombre: people[i], contratoCodigo: 'A', sedeCodigo: 'S', estado: 'activo' }));
  await button(mount, 'Crear version').onclick();
  const reliefBox = field(modal, 'Relevo: Dani');
  assert(reliefBox, 'con la version 67 cada empleado puede ser relevo');
  reliefBox.checked = true; reliefBox.onchange();
  await button(modal, 'Armar ciclo por cupos').onclick();
  assert.deepEqual(['Ana', 'Beto', 'Carla'].map(name => field(modal, 'Etapa inicial de ' + name).value), [0, 1, 2], 'el relevo no ocupa una posicion del ciclo');
  assert(all(modal).some(n => n.role === 'status' && String(n.textContent).includes('Faltan 1 personas')), 'avisa que falta un titular');
  assert(all(modal).some(n => n.role === 'status' && String(n.textContent).includes('relevo(s)')), 'sugiere cuantos relevos hacen falta');
  deps.getShiftRotationRulesVersion = async () => 66;
  deps.listActiveBaseEmployees = originalEmployees;
}
// Mover el sobrante de un relevo: boton y arrastre hacia un dia libre de la misma semana.
{
  rows.length = 0;
  rows.push({ id: 'R7', nombre: 'Con relevo', estado: 'activo', config: {
    site: 'S', start: monday, days: 7, cycle: ['P'], members: [{ employee: 'E', offset: 0 }, { employee: 'F', offset: 0, reliever: true }], rules: { restMode: 'rotativo' }
  } });
  deps.previewShiftRotation = async () => Array.from({ length: 14 }, (_, i) => i).flatMap(i => [
    { fecha: iso(i), employee_id: 'E', template_id: 'P', shift_id: 'S' + i, result: 'Por asignar' },
    i === 1 ? { fecha: iso(i), employee_id: 'F', template_id: 'P', shift_id: 'S' + i, result: 'Por asignar (sobrante)' }
      : { fecha: iso(i), employee_id: 'F', template_id: null, shift_id: null, result: 'Descanso relevo' }]);
  deps.listScheduledShiftsRange = async () => Array.from({ length: 14 }, (_, i) => ({ id: 'S' + i, templateId: 'P', fechaOperativa: iso(i), startsAt: iso(i) + 'T07:00:00-05:00', endsAt: iso(i) + 'T15:00:00-05:00', almuerzoMinutos: 60 }));
  const surplusCalls = [];
  deps.moveShiftRotationSurplus = async (...args) => { surplusCalls.push(args); return 2; };
  deps.getShiftRotationReliefWeeks = async () => [];
  deps.addAuditLog = async () => {};
  context.ShiftRotationsAdmin(mount, deps);
  await new Promise(resolve => setImmediate(resolve));
  await button(mount, 'Calendario y validacion').onclick();
  assert(texts(modal).includes('Sobrante (sobre el cupo)'), 'la celda marca el sobrante');
  modalValues = { date: iso(4) };
  await all(modal).find(n => n.tag === 'button' && n['aria-label'] === 'Mover sobrante').onclick();
  assert.deepEqual(surplusCalls, [['R7', 'F', iso(1), iso(4)]], 'el boton mueve el sobrante al dia elegido');
  surplusCalls.length = 0;
  const source = all(modal).find(n => n.tag === 'td' && n.draggable === true);
  assert(source, 'la celda del sobrante se puede arrastrar');
  const targets = all(modal).filter(n => n.tag === 'td' && typeof n.ondrop === 'function' && n !== source);
  const dropEvent = { preventDefault() {}, dataTransfer: { setData() {} } };
  for (const target of targets) {
    target.classList = { add() {}, remove() {} };
    source.ondragstart(dropEvent);
    await target.ondrop(dropEvent);
  }
  await new Promise(resolve => setImmediate(resolve));
  assert(surplusCalls.length >= 1, 'soltar sobre un dia libre mueve el sobrante');
  assert(surplusCalls.every(call => call[1] === 'F' && call[2] === iso(1) && call[3] !== iso(1) && call[3] >= iso(0) && call[3] <= iso(6)), 'solo dentro de la semana del sobrante');
  delete deps.moveShiftRotationSurplus;
}
console.log('PASS: weekly rest editor and calendar, direct pause/activation/deletion actions, cancellation, weekly hours, overtime and rest days.');
