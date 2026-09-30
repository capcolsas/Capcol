import { el, lucideInlineIcon } from '../utils/dom.js';
import { subscribe } from '../state.js';
import { contractFilterCode } from '../utils/contractScope.js';
import { can, PERMS } from '../permissions.js';
import { todayBogota, addIsoDays, SHIFT_GENERATION_DAYS } from '../utils/shiftCalendar.js';
import { quotasByTemplate, buildCycleByQuota, buildCoverage, coverageStatus } from '../utils/rotationCoverage.js';
import { buildRotationWeeks, summarizeWeekRow, distributeWeeklyRestDays, weekStartIso, formatHours, formatTime, formatDayHeader, formatRange, weekdayName } from '../utils/rotationHours.js';
import { showInfoModal, closeInfoModal } from '../utils/infoModal.js';
import { showActionModal, closeActionModal } from '../utils/actionModal.js';

export function ShiftRotationsAdmin(mount, deps = {}) {
  const ui = el('section', { className: 'main-card rotation-page' });
  const body = el('div');
  const message = el('p', { className: 'text-muted', role: 'status' });
  const editable = can(PERMS.MANAGE_GENERATED_SHIFTS);
  let sites = [], plans = [], employees = [], rows = [], disposed = false, revision = 0;
  const iconButton = (label, icon, action) => el('button', { className: 'btn btn--icon', type: 'button', title: label, 'aria-label': label, onclick: action }, [lucideInlineIcon(icon)]);
  const title = el('div', { className: 'rotation-heading' }, [el('h2', {}, ['Rotaciones de turnos'])]);
  if (editable) title.append(el('button', { className: 'btn btn--primary', type: 'button', onclick: () => editor() }, ['Nueva rotacion']));
  ui.append(title, message, body); mount.replaceChildren(ui);
  const scoped = (list, code = contractFilterCode()) => list.filter(r => r.contratoCodigo === code && r.estado !== 'inactivo');
  const planName = id => plans.find(p => p.id === id)?.nombre || id || 'Descanso';
  const personName = id => employees.find(e => e.id === id)?.nombre || id;
  const failure = error => { message.textContent = ['PGRST205','PGRST202','42P01'].includes(error?.code)
    ? 'Rotaciones no disponible: falta aplicar la migracion SQL fase 50.' : `No se pudo completar la operacion: ${error?.message || error}`; };

  async function refresh() {
    const token = ++revision;
    rows = []; body.replaceChildren();
    if (!contractFilterCode()) { message.textContent = 'Selecciona un contrato en la barra lateral.'; return; }
    message.textContent = 'Cargando rotaciones...';
    try {
      const data = await deps.listShiftRotations(contractFilterCode());
      if (disposed || token !== revision) return;
      rows = data; message.textContent = ''; render();
    } catch (error) { if (!disposed && token === revision) failure(error); }
  }
  function render() {
    body.replaceChildren();
    if (!rows.length) { body.append(el('p', { className: 'text-muted' }, ['Sin rotaciones registradas.'])); return; }
    const table = el('table', { className: 'table' }, [el('thead', {}, [el('tr', {}, ['Rotacion','Sede','Inicio','Ciclo','Estado','Acciones'].map(t => el('th', {}, [t])))]),
      el('tbody', {}, rows.map(row => el('tr', {}, [
        el('td', {}, [row.nombre]), el('td', {}, [sites.find(s => s.codigo === row.config.site)?.nombre || row.config.site]),
        el('td', {}, [row.config.start]), el('td', {}, [`${row.config.days * row.config.cycle.length} dias`]),
        el('td', {}, [el('span', { className: `badge ${row.estado === 'activo' ? 'badge--ok' : ['inactivo', 'pausado'].includes(row.estado) ? 'badge--off' : 'badge--warn'}` }, [row.estado])]), el('td', {}, [el('div', { className: 'row-actions' }, [
          iconButton('Calendario y validacion', 'calendar-days', () => preview(row)),
          ...(editable ? [iconButton('Reglas y disponibilidad', 'sliders-horizontal', () => editor(row, true)), iconButton('Crear version', 'copy', () => editor(row)),
            ...(row.estado === 'activo' ? [iconButton('Pausar rotacion', 'pause', () => changeRotation(row, false))]
              : [iconButton('Activar rotacion', 'play', () => preview(row)), iconButton('Eliminar rotacion', 'trash-2', () => changeRotation(row, true))])
          ] : [])
        ])])
      ])))]);
    body.append(el('div', { className: 'table-wrap' }, [table]));
  }

  async function changeRotation(row, remove) {
    const code = contractFilterCode();
    const confirmation = await showActionModal({
      title: remove ? 'Eliminar rotacion' : 'Pausar rotacion',
      message: remove ? `Se eliminará "${row.nombre}" si no tiene asignaciones. Las rotaciones con historial se conservan pausadas.`
        : 'Se detendrán las nuevas asignaciones automáticas. Las asignaciones ya creadas se conservan.',
      confirmText: remove ? 'Eliminar' : 'Pausar'
    });
    if (!confirmation.confirmed || disposed || code !== contractFilterCode()) return;
    try {
      if (remove) await deps.deleteShiftRotation(row.id);
      else await deps.pauseShiftRotation(row.id);
      if (!disposed && code === contractFilterCode()) await refresh();
    } catch (error) { if (!disposed && code === contractFilterCode()) failure(error); }
  }

  async function loadEmployees(code) {
    const data = await deps.listActiveBaseEmployees({ contratoCodigo: code });
    if (disposed || code !== contractFilterCode()) return false;
    employees = data;
    return true;
  }

  async function editor(previous, rulesOnly = false) {
    const code = contractFilterCode();
    if (!code) { message.textContent = 'Selecciona un contrato.'; return; }
    try { if (!await loadEmployees(code)) return; }
    catch (error) { failure(error); return; }
    // Descansos rotativos, compensatorio, almuerzo y horas extra requieren la fase SQL 66.
    let rotativoSupported = false;
    try { rotativoSupported = Number(await deps.getShiftRotationRulesVersion?.()) >= 66; } catch { rotativoSupported = false; }
    const form = el('form', { className: 'rotation-editor' });
    const input = (type, value = '') => el('input', { className: 'input', type, value });
    const field = (label, control) => {
      control.setAttribute('aria-label', label);
      return el('label', { className: 'rotation-field' }, [el('span', {}, [label]), control]);
    };
    const name = input('text', previous ? `${previous.nombre} - nueva version` : ''); name.required = true;
    const site = el('select', { className: 'select', required: true }, [el('option', { value: '' }, ['Selecciona sede']), ...scoped(sites).map(s => el('option', { value: s.codigo }, [s.nombre]))]);
    site.value = previous?.config.site || '';
    const start = input('date', rulesOnly ? previous.config.start : addIsoDays(todayBogota(), 1)); start.required = true; start.min = start.value;
    const end = input('date', rulesOnly ? previous.config.end || '' : '');
    const duration = el('select', { className: 'select' }, [1,2,3,4,5,6,7,14,21,28].map(d => el('option', { value: d }, [`${d} ${d === 1 ? 'dia' : 'dias'} por etapa`])));
    duration.value = previous?.config.days || 7;
    const steps = el('div', { className: 'rotation-steps' });
    const members = el('div', { className: 'rotation-members' });
    const warning = el('p', { role: 'status', className: 'text-muted' });
    const cycle = [...(previous?.config.cycle || [null, null])];
    const selected = new Map((previous?.config.members || []).map(m => [m.employee, m.offset]));
    const relievers = new Set((previous?.config.members || []).filter(m => m.reliever).map(m => m.employee));
    let reliefSupported = false;
    try { reliefSupported = Number(await deps.getShiftRotationRulesVersion?.()) >= 67; } catch { reliefSupported = false; }
    const restDays = new Map(Object.entries(previous?.config.rules?.weeklyRestDays || {}).map(([id, day]) => [id, String(day)]));
    const restPanel = el('div');
    let restMode = previous?.config.rules?.restMode || (rotativoSupported && !previous ? 'rotativo' : 'fijo');
    const modeSelect = el('select', { className: 'select' }, [
      el('option', { value: 'rotativo' }, ['Rotativo: un día distinto cada semana (recomendado)']),
      el('option', { value: 'fijo' }, ['Fijo: el mismo día todas las semanas'])
    ]);
    modeSelect.value = restMode;
    const rotatingNote = el('p', { className: 'text-muted' }, ['Las semanas van de domingo a sábado (42 h: el domingo y cinco días más). Quien está planeado para trabajar el domingo descansa un día de esa misma semana, de lunes a sábado, distinto cada semana y repartido entre el equipo. Quien no trabaja el domingo ya descansó y no genera descanso adicional. El día de descanso no suma horas. Desde el calendario puedes mover el descanso o intercambiarlo entre empleados de la sede.']);
    const fixedPanel = el('div');
    const syncRestMode = () => { rotatingNote.hidden = restMode !== 'rotativo'; fixedPanel.hidden = restMode !== 'fijo'; };
    modeSelect.onchange = () => { restMode = modeSelect.value; syncRestMode(); };
    const drawRestDays = () => {
      restPanel.replaceChildren(...[...selected.keys()].map(id => {
        const select = el('select', { className: 'select' }, [
          el('option', { value: '' }, ['Según el ciclo']),
          ...['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'].map((day, i) => el('option', { value: String(i) }, [day]))
        ]);
        select.value = restDays.get(id) ?? '';
        select.onchange = () => { if (select.value === '') restDays.delete(id); else restDays.set(id, select.value); };
        return field(`Descanso de ${personName(id)}`, select);
      }));
      if (!selected.size) restPanel.append(el('p', { className: 'text-muted' }, ['Selecciona empleados para programar su descanso semanal.']));
    };
    const limits = [
      ['minRestHours', 'Descanso minimo entre turnos (horas)', 72, 0.5],
      ['maxDailyHours', 'Maximo de horas por dia', 24, 0.5],
      ['maxWeeklyHours', 'Maximo de horas por semana', 168, 0.5],
      ['maxConsecutiveDays', 'Maximo de dias consecutivos', 31, 1]
    ];
    const ruleControls = new Map();
    const rulesPanel = el('div', { className: 'rotation-fields' }, limits.map(([key, label, max, step]) => {
      const enabled = input('checkbox'); enabled.checked = Number(previous?.config.rules?.[key] || 0) > 0;
      const value = input('number', previous?.config.rules?.[key] || '');
      value.min = step; value.max = max; value.step = step; value.disabled = !enabled.checked; value.required = enabled.checked;
      value.setAttribute('aria-label', label);
      enabled.onchange = () => { value.disabled = !enabled.checked; value.required = enabled.checked; };
      ruleControls.set(key, { enabled, value });
      return el('div', { className: 'rotation-field' }, [el('label', { className: 'rotation-toggle' }, [enabled, label]), value]);
    }));
    const unavailable = (previous?.config.unavailable || []).map(period => ({ ...period }));
    const unavailablePanel = el('div');
    const drawUnavailable = () => {
      unavailablePanel.replaceChildren(...unavailable.map((period, index) => {
        const employee = el('select', { className: 'select', required: true, 'aria-label': `Empleado no disponible ${index + 1}` }, [el('option', { value: '' }, ['Selecciona empleado']),
          ...scoped(employees).filter(e => e.sedeCodigo === site.value).map(e => el('option', { value: e.id }, [e.nombre]))]);
        employee.value = period.employee || ''; employee.onchange = () => { period.employee = employee.value; };
        const fromDate = input('date', period.from || start.value); fromDate.required = true;
        const toDate = input('date', period.to || fromDate.value); toDate.required = true;
        period.from = fromDate.value; period.to = toDate.value;
        fromDate.onchange = () => { period.from = fromDate.value; };
        toDate.onchange = () => { period.to = toDate.value; };
        return el('div', { className: 'rotation-unavailable' }, [field('Empleado', employee), field('Desde', fromDate), field('Hasta', toDate),
          iconButton('Quitar indisponibilidad', 'trash-2', () => { unavailable.splice(index, 1); drawUnavailable(); })]);
      }));
    };
    const drawMembers = () => {
      members.replaceChildren(...scoped(employees).filter(e => e.sedeCodigo === site.value).map(e => {
        const check = input('checkbox'); check.checked = selected.has(e.id);
        const offset = el('select', { className: 'select', 'aria-label': `Etapa inicial de ${e.nombre}`, disabled: !check.checked }, cycle.map((_, i) => el('option', { value: i }, [`Equipo ${i + 1} - etapa ${i + 1}`])));
        offset.value = selected.get(e.id) ?? 0;
        const relief = input('checkbox'); relief.checked = relievers.has(e.id); relief.setAttribute('aria-label', `Relevo: ${e.nombre}`);
        offset.disabled = !check.checked || relief.checked;
        check.onchange = () => { offset.disabled = !check.checked || relief.checked; if (check.checked) selected.set(e.id, Number(offset.value)); else { selected.delete(e.id); relievers.delete(e.id); } drawRestDays(); };
        relief.onchange = () => { if (relief.checked) { if (!check.checked) { check.checked = true; selected.set(e.id, 0); } relievers.add(e.id); } else relievers.delete(e.id); offset.disabled = !check.checked || relief.checked; };
        offset.onchange = () => selected.set(e.id, Number(offset.value));
        return el('div', { className: 'rotation-member' }, [el('label', {}, [check, e.nombre]), offset,
          ...(reliefSupported ? [el('label', { className: 'rotation-member__relief', title: 'Cubre el turno de quien descansa o no esta disponible' }, [relief, 'Relevo'])] : [])]);
      }));
      drawRestDays();
    };
    const drawSteps = () => {
      steps.replaceChildren(...cycle.map((value, index) => {
        const select = el('select', { className: 'select', 'aria-label': `Plan de etapa ${index + 1}` }, [el('option', { value: '' }, ['Descanso']), ...scoped(plans).map(p => el('option', { value: p.id }, [p.nombre]))]);
        select.value = value || ''; select.onchange = () => { cycle[index] = select.value || null; };
        return el('div', { className: 'rotation-step' }, [el('span', {}, [`Etapa ${index + 1}`]), select,
          iconButton('Quitar etapa', 'trash-2', () => { if (cycle.length <= 1) return; cycle.splice(index, 1); selected.clear(); drawSteps(); drawMembers(); })]);
      }));
    };
    site.onchange = () => { selected.clear(); unavailable.length = 0; drawMembers(); drawUnavailable(); };
    // Repite cada plan segun sus cupos planeados y reparte a los empleados seleccionados, una posicion distinta cada uno.
    const buildByQuota = async () => {
      const planIds = [...new Set(cycle.filter(Boolean))];
      if (!site.value) { warning.textContent = 'Selecciona la sede.'; return; }
      if (!planIds.length) { warning.textContent = 'Elige primero los planes en la secuencia del ciclo (un plan por etapa, sin repetir).'; return; }
      const people = [...selected.keys()].filter(id => !relievers.has(id)).sort((a, b) => personName(a).localeCompare(personName(b)));
      if (!people.length) { warning.textContent = 'Selecciona los empleados titulares del equipo.'; return; }
      let shifts = [];
      try { shifts = (await deps.listScheduledShiftsRange?.(start.value, addIsoDays(start.value, 13), { contratoCodigo: code, sedeCodigo: site.value, templateIds: planIds })) || []; }
      catch { shifts = []; }
      const quotas = quotasByTemplate(shifts, planIds);
      const result = buildCycleByQuota({ planIds, quotas, staff: people.length });
      cycle.splice(0, cycle.length, ...result.cycle);
      const keptRelievers = [...relievers].filter(id => selected.has(id));
      selected.clear();
      people.slice(0, result.offsets.length).forEach((id, i) => selected.set(id, result.offsets[i]));
      keptRelievers.forEach(id => selected.set(id, 0));
      const suggested = Math.max(0, Math.ceil(result.length * 7 / 6) - result.length);
      drawSteps(); drawMembers();
      const parts = planIds.map(id => `${planName(id)} x${Number(quotas.get(id)) || 1}`).join(' + ');
      warning.textContent = [`Ciclo por cupos: ${parts} = ${result.length} posiciones para ${people.length} personas.`,
        result.assumed.length ? `Sin turnos generados para ${result.assumed.map(planName).join(', ')}: se asumio 1 cupo.` : '',
        result.missing ? `Faltan ${result.missing} personas para cubrir todos los cupos.` : '',
        result.extra ? `Sobran ${result.extra} personas: no se incluyeron en el ciclo (podran cubrir descansos como relevo).` : '',
        result.truncated ? 'El ciclo se recorto a 28 etapas.' : '',
        !result.missing && !result.extra ? 'Cada etapa cubre exactamente los cupos de cada plan.' : '',
        reliefSupported ? `Para cubrir los descansos hacen falta ${suggested} relevo(s); tienes ${keptRelievers.length}.` : ''].filter(Boolean).join(' ');
    };
    const save = el('button', { type: 'submit', className: 'btn btn--primary' }, [rulesOnly ? 'Guardar reglas' : 'Guardar borrador']);
    if (!rulesOnly) form.append(el('div', { className: 'rotation-fields' }, [field('Nombre', name),field('Sede', site),field('Inicio del ciclo', start),field('Fin (opcional)', end),field('Duracion de etapa', duration)]),
      el('h4', {}, ['Secuencia del ciclo']),
      el('p', { className: 'text-muted' }, ['Las etapas de 7, 14, 21 o 28 dias cambian de plan cada domingo: las semanas van de domingo a sabado.']), steps,
      iconButton('Agregar etapa', 'plus', () => { if (cycle.length >= 28) return; cycle.push(null); drawSteps(); drawMembers(); }),
      el('button', { type: 'button', className: 'btn', onclick: buildByQuota }, ['Armar ciclo por cupos']),
      el('h4', {}, ['Equipos y etapa inicial']), members);
    fixedPanel.append(
      el('p', { className: 'text-muted' }, ['Elige un día por empleado o conserva los descansos del ciclo. Ese día no recibirá nuevas asignaciones de esta rotación. Los turnos nocturnos que lo invadan se señalarán en la validación.']),
      el('p', { className: 'text-muted' }, ['Programar un descanso no modifica los recargos de nómina. Si ya existen asignaciones en ese día, revisa el conflicto en el calendario.']),
      el('p', { className: 'text-muted' }, ['Cada empleado debe tener un día de descanso por semana y no debe ser el mismo para todos. El día de descanso no suma horas.']),
      el('button', { type: 'button', className: 'btn', onclick: () => {
        const order = [...selected].map(([employee, offset]) => ({ employee, offset })).sort((a, b) => personName(a.employee).localeCompare(personName(b.employee)));
        Object.entries(distributeWeeklyRestDays(order)).forEach(([id, day]) => restDays.set(id, String(day)));
        drawRestDays();
      } }, ['Distribuir descansos']), restPanel);
    form.append(el('h4', {}, ['Descanso semanal']),
      ...(rotativoSupported ? [field('Tipo de descanso', modeSelect), rotatingNote] : []),
      fixedPanel,
      el('h4', {}, ['Limites de asignacion']), rulesPanel,
      el('h4', {}, ['Periodos de indisponibilidad']), unavailablePanel,
      iconButton('Agregar indisponibilidad', 'calendar-x', () => { unavailable.push({ employee: '', from: start.value, to: start.value }); drawUnavailable(); }), warning, save);
    drawSteps(); drawMembers(); drawUnavailable(); syncRestMode();
    form.onsubmit = async event => {
      event.preventDefault(); if (code !== contractFilterCode()) return;
      const config = { site: site.value, start: start.value, end: end.value || null, days: Number(duration.value), cycle: [...cycle], members: [...selected].map(([employee, offset]) => relievers.has(employee) ? { employee, offset: 0, reliever: true } : { employee, offset }) };
      config.rules = Object.fromEntries([...ruleControls].map(([key, control]) => [key, control.enabled.checked ? Number(control.value.value) : 0]));
      config.rules.weeklyRestDays = Object.fromEntries([...restDays].filter(([id]) => selected.has(id)).map(([id, day]) => [id, Number(day)]));
      if (rotativoSupported) {
        config.rules.restMode = restMode;
        if (restMode === 'rotativo') {
          config.rules.weeklyRestDays = {};
          // Los intercambios ya hechos (plan de descansos) se conservan al cambiar otras reglas.
          const plan = previous?.config.rules?.restPlan;
          if (plan && previous?.config.rules?.restMode === 'rotativo') config.rules.restPlan = plan;
        }
      }
      if (previous?.config.rules?.surplusPlan) config.rules.surplusPlan = previous.config.rules.surplusPlan;
      config.unavailable = unavailable.map(period => ({ ...period }));
      if (unavailable.some(p => !selected.has(p.employee) || !p.from || !p.to || p.to < p.from)) { warning.textContent = 'Revisa las fechas de indisponibilidad y selecciona empleados incluidos en los equipos.'; return; }
      if (!config.members.length || !cycle.some(Boolean)) { warning.textContent = 'Selecciona empleados y al menos un plan de turno.'; return; }
      if (config.end && config.end < config.start) { warning.textContent = 'El fin debe ser posterior al inicio.'; return; }
      save.disabled = true;
      try {
        const id = rulesOnly ? previous.id : await deps.saveShiftRotation(code, name.value.trim(), config);
        if (rulesOnly) await deps.updateShiftRotationRules(id, config.rules, config.unavailable);
        if (disposed || contractFilterCode() !== code) return;
        closeInfoModal(); await refresh();
        await preview({ id, nombre: rulesOnly ? previous.nombre : name.value.trim(), config, estado: rulesOnly ? previous.estado : 'borrador' });
      } catch (error) { warning.textContent = error.message || String(error); }
      finally { save.disabled = false; }
    };
    showInfoModal(rulesOnly ? `Reglas - ${previous.nombre}` : previous ? 'Nueva version de rotacion' : 'Nueva rotacion', [form]);
  }

  async function preview(row) {
    const code = contractFilterCode();
    try { if (!await loadEmployees(code)) return; }
    catch (error) { failure(error); return; }
    const panel = el('div', { className: 'rotation-preview' });
    const firstDay = weekStartIso(row.config.start > todayBogota() ? row.config.start : todayBogota());
    const from = el('input', { type: 'date', className: 'input', value: firstDay, 'aria-label': 'Inicio de vista previa' });
    const content = el('div'); const status = el('p', { role: 'status', className: 'text-muted' });
    const activate = el('button', { type: 'button', className: 'btn btn--primary', disabled: true }, [row.estado === 'activo' ? 'Aplicar a turnos nuevos' : 'Activar rotacion']);
    let queryVersion = 0;
    const restSummary = r => r.restDates.length ? `Descansa: ${r.restDates.map(weekdayName).join(', ')}` : (r.workDays ? 'Sin descanso' : '');
    let currentWeeks = [];
    const REST_LABELS = { semanal: 'Semanal', compensatorio: 'Compensatorio', ciclo: 'Del ciclo', relevo: 'Libre (relevo)' };
    let dragged = null;
    const canMove = cell => editable && row.id && row.config.rules?.restMode === 'rotativo' && typeof deps.moveShiftRotationRestDay === 'function'
      && cell.restType !== 'ciclo' && cell.restType !== 'relevo' && cell.date > todayBogota();
    const canMoveSurplus = cell => editable && row.id && typeof deps.moveShiftRotationSurplus === 'function' && cell.surplus && cell.date > todayBogota();
    // Un sobrante puede ir a cualquier dia libre (descanso de relevo) futuro de la misma semana.
    const canReceiveSurplus = cell => cell.kind === 'rest' && cell.restType === 'relevo' && cell.date > todayBogota();
    // Un dia se puede recibir un descanso si es de trabajo, futuro y de lunes a sabado.
    const canReceiveRest = cell => cell.kind === 'work' && cell.date > todayBogota() && new Date(cell.date + 'T00:00:00Z').getUTCDay() !== 0;
    const canSwap = cell => editable && row.id && row.config.rules?.restMode === 'rotativo' && typeof deps.swapShiftRotationRestDays === 'function'
      && cell.restType !== 'ciclo' && cell.restType !== 'relevo' && cell.date > todayBogota();
    function dayCell(cell, employee) {
      const base = 'rotation-cell';
      if (cell.kind === 'outside') return el('td', { className: base + ' rotation-cell--outside' }, [el('small', {}, ['Fuera de vigencia'])]);
      const alerts = cell.alerts.map(text => el('small', { className: 'rotation-alert' }, [text]));
      if (cell.kind === 'rest') {
        if (canReceiveSurplus(cell)) {
          const free = el('td', { className: base + ' rotation-cell--rest' }, [el('strong', {}, ['Descanso']), el('small', {}, [REST_LABELS.relevo]), ...alerts]);
          const accepts = () => dragged?.surplus && dragged.employee === employee && weekStartIso(dragged.date) === weekStartIso(cell.date);
          free.ondragover = event => { if (accepts()) { event.preventDefault(); free.classList.add('rotation-cell--drop'); } };
          free.ondragleave = () => free.classList.remove('rotation-cell--drop');
          free.ondrop = event => { event.preventDefault(); free.classList.remove('rotation-cell--drop'); if (accepts()) moveSurplus(employee, dragged.date, cell.date); dragged = null; };
          return free;
        }
        const movable = canMove(cell);
        const actions = [...(movable ? [iconButton('Mover descanso', 'move', () => moveRestWithModal(cell, employee))] : []),
          ...(canSwap(cell) ? [iconButton('Intercambiar descanso', 'arrow-left-right', () => swapRest(cell, employee))] : [])];
        const td = el('td', { className: base + ' rotation-cell--rest' + (movable ? ' rotation-cell--draggable' : '') },
          [el('strong', {}, ['Descanso']), el('small', {}, [REST_LABELS[cell.restType] || 'Del ciclo']), ...alerts, ...(actions.length ? [el('div', { className: 'rotation-cell__actions' }, actions)] : [])]);
        if (movable) {
          td.draggable = true;
          td.title = 'Arrastra el descanso a otro dia de trabajo de la misma semana';
          td.ondragstart = event => { dragged = { employee, date: cell.date }; try { event.dataTransfer.setData('text/plain', cell.date); event.dataTransfer.effectAllowed = 'move'; } catch { /* sin dataTransfer */ } };
          td.ondragend = () => { dragged = null; };
        }
        return td;
      }
      const lines = [el('strong', {}, [planName(cell.template)])];
      if (cell.unknown) lines.push(el('small', { className: 'rotation-cell__muted' }, ['Turno sin generar']));
      else {
        cell.shifts.forEach(s => lines.push(el('small', { className: 'rotation-cell__time' }, [`${formatTime(s.starts)} - ${formatTime(s.ends)}`])));
        lines.push(el('small', { className: 'rotation-cell__hours' }, [formatHours(cell.minutes)]));
        if (cell.shifts.some(s => s.lunchMinutes)) lines.push(el('small', { className: 'rotation-cell__muted' }, [`Almuerzo ${cell.shifts.reduce((sum, s) => sum + s.lunchMinutes, 0)} min`]));
      }
      if (cell.surplus) lines.push(el('small', { className: 'rotation-cell__muted' }, ['Sobrante (sobre el cupo)']));
      if (canMoveSurplus(cell)) lines.push(el('div', { className: 'rotation-cell__actions' }, [iconButton('Mover sobrante', 'move', () => moveSurplusWithModal(cell, employee))]));
      const td = el('td', { className: base + (canMoveSurplus(cell) ? ' rotation-cell--draggable' : '') }, [...lines, ...alerts]);
      if (canMoveSurplus(cell)) {
        td.draggable = true;
        td.title = 'Arrastra el sobrante a otro dia libre de la misma semana';
        td.ondragstart = event => { dragged = { employee, date: cell.date, surplus: true }; try { event.dataTransfer.setData('text/plain', cell.date); event.dataTransfer.effectAllowed = 'move'; } catch { /* sin dataTransfer */ } };
        td.ondragend = () => { dragged = null; };
      }
      const accepts = () => dragged && dragged.employee === employee && canReceiveRest(cell) && weekStartIso(dragged.date) === weekStartIso(cell.date);
      td.ondragover = event => { if (accepts()) { event.preventDefault(); td.classList.add('rotation-cell--drop'); } };
      td.ondragleave = () => td.classList.remove('rotation-cell--drop');
      td.ondrop = event => { event.preventDefault(); td.classList.remove('rotation-cell--drop'); if (accepts()) moveRest(employee, dragged.date, cell.date); dragged = null; };
      return td;
    }
    const recordedLabel = rec => rec.overtime_minutes
      ? `Registrado: ${formatHours(rec.worked_minutes)} \u00b7 +${formatHours(rec.overtime_minutes)} extras`
      : `Registrado: ${formatHours(rec.worked_minutes)}`;
    function totalCell(r, limit) {
      if (!r.workDays) return el('td', { className: 'rotation-total' }, [el('small', { className: 'rotation-cell__muted' }, ['Sin turnos en la semana'])]);
      const summary = summarizeWeekRow(r, limit);
      return el('td', { className: `rotation-total rotation-total--${summary.kind}` }, [
        el('strong', {}, [`${r.incomplete ? '≥ ' : ''}${formatHours(r.minutes)}`]),
        el('progress', { value: Math.min(r.minutes, summary.limitMinutes), max: summary.limitMinutes, 'aria-label': `Horas de la semana frente al limite de ${limit} h` }),
        el('small', { className: summary.kind === 'extra' ? 'rotation-alert' : '' }, [summary.label]),
        ...(r.incomplete ? [el('small', { className: 'rotation-cell__muted' }, ['Incluye solo turnos generados'])] : []),
        ...(r.restMinutes ? [el('small', { className: 'rotation-cell__muted' }, ['Dia de descanso (no suma): ' + formatHours(r.restMinutes)])] : []),
        ...(r.recorded ? [el('small', { className: 'rotation-cell__muted' }, [recordedLabel(r.recorded)])] : []),
        ...(r.relief?.extra_days ? [el('small', { className: 'rotation-alert' }, [`Cubrio ${r.relief.extra_days} dia(s) extra: horas extras y descanso pendiente`])] : []),
        ...(r.relief?.pending_rest ? [el('small', { className: 'rotation-alert' }, [`Descanso pendiente: ${r.relief.pending_rest}`])] : []),
        ...(summary.noRest ? [el('small', { className: 'rotation-alert' }, ['Sin dia de descanso'])] : [])
      ]);
    }
    let currentCoverage = null;
    const COVERAGE_LABELS = { ok: 'Cubierto', falta: 'Faltan personas', sobra: 'Sobran personas', sin: 'Sin turno' };
    function coverageTable(plans) {
      if (!plans?.length) return null;
      return el('div', { className: 'table-wrap' }, [el('table', { className: 'table rotation-coverage-table' }, [
        el('thead', {}, [el('tr', {}, [el('th', {}, ['Cobertura de cupos']), ...plans[0].days.map(day => el('th', {}, [formatDayHeader(day.date)]))])]),
        el('tbody', {}, plans.map(plan => el('tr', {}, [el('th', {}, [planName(plan.templateId)]), ...plan.days.map(day => {
          const status = coverageStatus(day);
          const label = day.required === null ? (day.covered ? String(day.covered) : '-') : `${day.covered}/${day.required}`;
          return el('td', { className: `rotation-coverage-cell rotation-coverage-cell--${status}`, title: COVERAGE_LABELS[status] }, [label]);
        })])))
      ])]);
    }
    function weekBlock(week, index) {
      return el('section', { className: 'rotation-week' }, [
        el('div', { className: 'rotation-week__head' }, [el('h4', {}, [`Semana del ${formatRange(week.start, week.end)}`]), el('span', { className: 'badge' }, [`Limite legal: ${week.limit} h`])]),
        ...(week.sameRestDay ? [el('p', { className: 'rotation-alert' }, ['Todo el equipo descansa el mismo dia: distribuye los descansos para no dejar el servicio sin cobertura.'])] : []),
        el('div', { className: 'table-wrap' }, [el('table', { className: 'table rotation-calendar' }, [
          el('thead', {}, [el('tr', {}, [el('th', {}, ['Empleado']), ...week.days.map(d => el('th', {}, [formatDayHeader(d)])), el('th', {}, ['Horas de la semana'])])]),
          el('tbody', {}, week.rows.map(r => el('tr', {}, [
            el('th', {}, [personName(r.employee), ...(r.reliever ? [el('small', { className: 'rotation-cell__muted' }, ['Relevo'])] : []), el('small', { className: 'rotation-rest-days' }, [r.reliever ? '' : restSummary(r)])]),
            ...r.cells.map(cell => dayCell(cell, r.employee)), totalCell(r, week.limit)]))),
          el('tfoot', { className: 'rotation-coverage' }, [el('tr', {}, [el('th', {}, ['Personas en descanso']), ...week.restCounts.map(n => el('td', {}, [String(n)])), el('td', {}, [])])])
        ])]),
        ...(coverageTable(currentCoverage?.[index]) ? [coverageTable(currentCoverage[index])] : [])
      ]);
    }
    async function loadOvertime(start, end) {
      if (typeof deps.listShiftOvertimeWeeks !== 'function') return [];
      try { return (await deps.listShiftOvertimeWeeks(code, weekStartIso(start), end)) || []; }
      catch { return []; }
    }
    async function moveRest(employee, fromDate, toDate) {
      if (fromDate === toDate) return;
      try {
        status.textContent = 'Moviendo el descanso...';
        const changed = await deps.moveShiftRotationRestDay(row.id, employee, fromDate, toDate);
        await deps.addAuditLog?.({ targetType: 'shift_rotation', targetId: row.id, action: 'move_rotation_rest_day',
          after: { employee, from: fromDate, to: toDate, changed } });
        const fresh = (await deps.listShiftRotations(code)).find(item => item.id === row.id);
        if (fresh) row.config = fresh.config;
        await refresh(); await load();
        status.textContent = `Descanso movido de ${formatDayHeader(fromDate)} a ${formatDayHeader(toDate)} (${changed} asignaciones ajustadas).`;
      } catch (error) { status.textContent = error.message || String(error); }
    }
    async function moveSurplus(employee, fromDate, toDate) {
      if (fromDate === toDate) return;
      try {
        status.textContent = 'Moviendo el sobrante...';
        const changed = await deps.moveShiftRotationSurplus(row.id, employee, fromDate, toDate);
        await deps.addAuditLog?.({ targetType: 'shift_rotation', targetId: row.id, action: 'move_rotation_surplus', after: { employee, from: fromDate, to: toDate, changed } });
        const fresh = (await deps.listShiftRotations(code)).find(item => item.id === row.id);
        if (fresh) row.config = fresh.config;
        await refresh(); await load();
        status.textContent = `Sobrante movido de ${formatDayHeader(fromDate)} a ${formatDayHeader(toDate)} (${changed} asignaciones ajustadas).`;
      } catch (error) { status.textContent = error.message || String(error); }
    }
    async function moveSurplusWithModal(cell, employee) {
      const week = currentWeeks.find(item => item.days.includes(cell.date));
      const mine = week?.rows.find(item => item.employee === employee);
      const options = (mine?.cells || []).filter(canReceiveSurplus).map(item => ({ value: item.date, label: formatDayHeader(item.date) }));
      if (!options.length) { status.textContent = 'No hay otro dia libre de esa semana para mover el sobrante.'; return; }
      const modal = await showActionModal({
        title: 'Mover sobrante',
        message: `${personName(employee)} tiene un sobrante el ${formatDayHeader(cell.date)}. Elige el nuevo dia de la semana (de domingo a sabado); si trabaja el domingo, esa misma semana le queda un dia libre entre semana.`,
        confirmText: 'Mover',
        fields: [{ id: 'date', label: 'Nuevo dia', type: 'select', required: true, options: [{ value: '', label: 'Selecciona...' }, ...options] }]
      });
      if (!modal.confirmed || !modal.values?.date || code !== contractFilterCode()) return;
      await moveSurplus(employee, cell.date, modal.values.date);
    }
    async function moveRestWithModal(cell, employee) {
      const week = currentWeeks.find(item => item.days.includes(cell.date));
      const mine = week?.rows.find(item => item.employee === employee);
      const options = (mine?.cells || []).filter(canReceiveRest).map(item => ({ value: item.date, label: formatDayHeader(item.date) }));
      if (!options.length) { status.textContent = 'No hay otro dia de trabajo de esa semana para mover el descanso.'; return; }
      const modal = await showActionModal({
        title: 'Mover descanso',
        message: `${personName(employee)} descansa ${formatDayHeader(cell.date)}. Elige el nuevo dia de descanso de esa semana; el dia actual pasa a ser de trabajo y se recalculan las horas.`,
        confirmText: 'Mover',
        fields: [{ id: 'date', label: 'Nuevo dia de descanso', type: 'select', required: true, options: [{ value: '', label: 'Selecciona...' }, ...options] }]
      });
      if (!modal.confirmed || !modal.values?.date || code !== contractFilterCode()) return;
      await moveRest(employee, cell.date, modal.values.date);
    }
    async function swapRest(cell, employee) {
      const week = currentWeeks.find(item => item.days.includes(cell.date));
      const options = [];
      for (const other of week?.rows || []) {
        if (other.employee === employee) continue;
        for (const candidate of other.cells) {
          if (candidate.kind === 'rest' && candidate.restType !== 'ciclo' && candidate.date > todayBogota()) {
            options.push({ value: `${other.employee}|${candidate.date}`, label: `${personName(other.employee)} - descansa ${formatDayHeader(candidate.date)}` });
          }
        }
      }
      if (!options.length) { status.textContent = 'No hay otro descanso de la misma semana para intercambiar.'; return; }
      const modal = await showActionModal({
        title: 'Intercambiar descanso',
        message: `${personName(employee)} descansa ${formatDayHeader(cell.date)}. Elige con quien intercambiarlo: ambos conservan un descanso en la semana y se recalculan las horas.`,
        confirmText: 'Intercambiar',
        fields: [{ id: 'other', label: 'Empleado y dia de descanso', type: 'select', required: true, options: [{ value: '', label: 'Selecciona...' }, ...options] }]
      });
      if (!modal.confirmed || !modal.values?.other || code !== contractFilterCode()) return;
      const [otherEmployee, otherDate] = modal.values.other.split('|');
      try {
        status.textContent = 'Intercambiando descansos...';
        const changed = await deps.swapShiftRotationRestDays(row.id, employee, cell.date, otherEmployee, otherDate);
        await deps.addAuditLog?.({ targetType: 'shift_rotation', targetId: row.id, action: 'swap_rotation_rest_days',
          after: { employeeA: employee, dateA: cell.date, employeeB: otherEmployee, dateB: otherDate, changed } });
        const fresh = (await deps.listShiftRotations(code)).find(item => item.id === row.id);
        if (fresh) row.config = fresh.config;
        await refresh(); await load();
        status.textContent = `Descansos intercambiados (${changed} asignaciones ajustadas).`;
      } catch (error) { status.textContent = error.message || String(error); }
    }
    async function loadShifts(start, end) {
      if (typeof deps.listScheduledShiftsRange !== 'function') return null;
      try { return await deps.listScheduledShiftsRange(start, end, { contratoCodigo: code, sedeCodigo: row.config.site }); }
      catch { return null; }
    }
    const load = async () => {
      const token = ++queryVersion; activate.disabled = true; status.textContent = 'Validando...';
      const start = from.value; const end = addIsoDays(start, 13);
      try {
        const [results, shifts, overtime] = await Promise.all([deps.previewShiftRotation(code, row.config, start, end), loadShifts(start, end), loadOvertime(start, end)]);
        if (disposed || !panel.isConnected || token !== queryVersion || code !== contractFilterCode()) return;
        const weeks = buildRotationWeeks({ config: row.config, from: start, results, shifts, overtime });
        currentWeeks = weeks;
        if (row.config.members.some(member => member.reliever) && typeof deps.getShiftRotationReliefWeeks === 'function') {
          const reliefWeeks = await deps.getShiftRotationReliefWeeks(row.config, start, end);
          for (const week of weeks) for (const item of week.rows) item.relief = (reliefWeeks || []).find(w => w.employee_id === item.employee && String(w.week_start).slice(0, 10) === week.start) || null;
        }
        currentCoverage = buildCoverage(weeks, shifts, [...new Set(row.config.cycle.filter(Boolean))]);
        const hasWeeklyLimit = Number(row.config.rules?.maxWeeklyHours || 0) > 0;
        content.replaceChildren(
          ...(shifts ? [] : [el('p', { className: 'rotation-alert' }, ['No se pudieron consultar los turnos generados: las horas no estan disponibles.'])]),
          ...(hasWeeklyLimit ? [el('p', { className: 'text-muted rotation-validation-note' }, [
            'La validacion del limite semanal configurado incluye esta rotación y las asignaciones existentes del empleado, incluso en otras sedes o contratos y en días de la misma semana que queden fuera de esta vista.'
          ])] : []),
          ...weeks.map((week, index) => weekBlock(week, index))
        );
        const counts = results.reduce((acc, r) => { acc[r.result] = (acc[r.result] || 0) + 1; return acc; }, {});
        status.textContent = Object.entries(counts).map(([label, count]) => `${label}: ${count}`).join(' | ') || 'Sin resultados en este periodo.';
        activate.disabled = false;
      } catch (error) { status.textContent = error.message || String(error); }
    };
    activate.onclick = async () => {
      // Programacion manual previa de estos empleados: se puede conservar (la rotacion omite los conflictos) o reemplazar.
      let manualCount = 0;
      if (typeof deps.replaceManualShiftAssignments === 'function' && row.id) {
        try { manualCount = Number(await deps.replaceManualShiftAssignments(row.id, true)) || 0; } catch { manualCount = 0; }
      }
      const confirmation = await showActionModal({ title: 'Activar rotacion', fields: manualCount ? [{ id: 'manual', label: `Programacion manual existente (${manualCount} asignaciones)`, type: 'select', required: true, value: 'keep', options: [
        { value: 'keep', label: 'Conservarla: la rotacion omite los dias en conflicto' },
        { value: 'replace', label: 'Reemplazarla por la rotacion: se eliminan esas asignaciones futuras' }] }] : [], message: `Se asignaran los turnos generados de los proximos ${SHIFT_GENERATION_DAYS} dias dentro de la vigencia. La programacion avanza automaticamente sin reiniciar el ciclo. Se conservan las asignaciones existentes y se omiten conflictos. La vista previa muestra dos semanas.`, confirmText: 'Confirmar' });
      if (!confirmation.confirmed || code !== contractFilterCode()) return;
      activate.disabled = true;
      try {
        let replaced = 0;
        if (manualCount && confirmation.values?.manual === 'replace') {
          replaced = Number(await deps.replaceManualShiftAssignments(row.id, false)) || 0;
          await deps.addAuditLog?.({ targetType: 'shift_rotation', targetId: row.id, action: 'replace_manual_assignments', after: { replaced } });
        }
        const count = await deps.applyShiftRotation(row.id, true); row.estado = 'activo'; await refresh(); await load();
        status.textContent = `${count} asignaciones creadas${replaced ? ` (se reemplazaron ${replaced} manuales)` : ''}. Rotacion activa.`;
      }
      catch (error) { status.textContent = error.message || String(error); }
      finally { activate.disabled = false; }
    };
    const moveWindow = days => { from.value = addIsoDays(from.value || firstDay, days); load(); };
    const tools = el('div', { className: 'rotation-heading' }, [el('div', { className: 'rotation-nav' }, [
      iconButton('Semanas anteriores', 'chevron-left', () => moveWindow(-14)), from, iconButton('Semanas siguientes', 'chevron-right', () => moveWindow(14))
    ])]);
    if (editable) {
      tools.append(activate);
      if (row.estado === 'activo') tools.append(iconButton('Pausar nuevas asignaciones', 'pause', async () => {
        const confirm = await showActionModal({ title: 'Pausar rotacion', message: 'Se detendran las nuevas asignaciones automaticas. Las ya creadas se conservan.', confirmText: 'Pausar' });
        if (!confirm.confirmed || code !== contractFilterCode()) return;
        try { await deps.pauseShiftRotation(row.id); closeInfoModal(); await refresh(); } catch (error) { status.textContent = error.message; }
      }));
    }
    from.onchange = () => { from.value = weekStartIso(from.value) || firstDay; load(); }; panel.append(tools, status, content); showInfoModal(row.nombre, [panel]); await load();
  }
  let unSedes = null, unTemplates = null;
  function startCatalogs() {
    unSedes?.(); unTemplates?.();
    const code = contractFilterCode();
    sites = []; plans = [];
    if (!code) { render(); return; }
    unSedes = deps.streamSedes?.(data => { sites = data || []; render(); }, null, null, { contratoCodigo: code }) || null;
    unTemplates = deps.streamShiftTemplates?.(data => { plans = data || []; render(); }, null, null, { contratoCodigo: code }) || null;
  }
  const unsubs = [subscribe('selectedContractCode', () => { employees = []; closeInfoModal(); closeActionModal(); startCatalogs(); refresh(); })];
  startCatalogs();
  refresh();
  return () => { disposed = true; revision++; unSedes?.(); unTemplates?.(); unsubs.forEach(un => un?.()); closeInfoModal(); closeActionModal(); };
}
