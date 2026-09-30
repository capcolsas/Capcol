import { deactivateIcon, editIcon, el, infoIcon, lucideInlineIcon, qs } from '../utils/dom.js';
import { showActionModal } from '../utils/actionModal.js';
import { showInfoModal } from '../utils/infoModal.js';
import { showNotification } from '../utils/notifications.js';
import { addIsoDays, todayBogota, SHIFT_GENERATION_DAYS } from '../utils/shiftCalendar.js';
import { createTablePagination } from '../utils/pagination.js';
import { can, PERMS } from '../permissions.js';
import { navigate } from '../router.js';
import { subscribe } from '../state.js';
import { contractFilterCode, contractMatches } from '../utils/contractScope.js';
import { shiftPlanCapacity, validateShiftPlanCapacity } from '../utils/shiftPlanCapacity.js';
import { netRuleMinutes, formatHours, STANDARD_DAILY_MINUTES } from '../utils/rotationHours.js';
import { isReviewableShiftStatus, entryMinutesFromStart, shiftReviewLabel, shiftReviewTone, shiftReviewItems, pendingShiftReviewItems, shiftReviewDecisionLabel, shiftReviewSuggestedMinutes } from '../utils/shiftReview.js';

const DAY_OPTIONS = [
  { value: '1', label: 'Lunes' },
  { value: '2', label: 'Martes' },
  { value: '3', label: 'Miercoles' },
  { value: '4', label: 'Jueves' },
  { value: '5', label: 'Viernes' },
  { value: '6', label: 'Sabado' },
  { value: '0', label: 'Domingo' }
];

const DAY_CONDITION_OPTIONS = [
  ...DAY_OPTIONS,
  { value: 'festivo', label: 'Festivo' }
];

const FREQUENCY_OPTIONS = [
  { value: 'todos', label: 'Siempre' },
  { value: 'cada_n_semanas', label: 'Cada N semanas' },
  { value: 'mensual', label: 'Una vez al mes' }
];

const MONTH_WEEK_OPTIONS = [
  { value: '1', label: 'Primer' },
  { value: '2', label: 'Segundo' },
  { value: '3', label: 'Tercer' },
  { value: '4', label: 'Cuarto' },
  { value: '-1', label: 'Ultimo' }
];

const HOLIDAY_MODE_OPTIONS = [
  { value: 'excluir', label: 'No trabajar festivos' },
  { value: 'normal', label: 'Trabajar si es festivo' }
];

let nextLocalId = 1;
const GENERATED_FILTERS_KEY = 'rocky_shift_generated_filters';
const DEFAULT_WINDOW_ENTRY_BEFORE_MINUTES = 60;
const DEFAULT_WINDOW_ENTRY_AFTER_MINUTES = 30;
const DEFAULT_WINDOW_EXIT_BEFORE_MINUTES = 30;
const DEFAULT_WINDOW_EXIT_AFTER_MINUTES = 60;
const DEFAULT_ALERT_MINUTES = 30;
const DEFAULT_NOVELTY_WINDOW_HOURS = 48;

export const ShiftsAdmin = (mount, deps = {}) => ShiftPlansAdmin(mount, deps);

export const ShiftPlansAdmin = (mount, deps = {}) => renderShiftScreen(mount, deps, { mode: 'plans' });

export const GeneratedShiftsAdmin = (mount, deps = {}) => renderShiftScreen(mount, deps, { mode: 'generated' });

export const ShiftReviewAdmin = (mount, deps = {}) => renderShiftScreen(mount, deps, { mode: 'review' });

function renderShiftScreen(mount, deps = {}, { mode = 'plans' } = {}) {
  const isGeneratedScreen = mode === 'generated';
  const isReviewScreen = mode === 'review';
  const canEdit = can(PERMS.MANAGE_SHIFT_PLANS);
  const canGenerate = can(PERMS.MANAGE_GENERATED_SHIFTS);
  const canAssign = can(PERMS.MANAGE_GENERATED_SHIFTS);
  const canReview = can(PERMS.MANAGE_SHIFT_REVIEW);
  // El almuerzo por regla existe desde la fase SQL 66; sin ella no se muestra ni se envia.
  let lunchSupported = false;
  Promise.resolve(deps.getShiftRotationRulesVersion?.()).then((version) => { lunchSupported = Number(version) >= 66; }).catch(() => {});
  const DEFAULT_LUNCH_MINUTES = 60;
  const title = isGeneratedScreen ? 'Turnos generados' : isReviewScreen ? 'Revision de turnos' : 'Planes de turnos';
  const ui = el('section', { className: 'main-card' }, [
    el('h2', {}, [title]),
    isGeneratedScreen ? generatedPanel() : isReviewScreen ? reviewPanel() : plansPanel()
  ]);

  function plansPanel() {
    return el('div', { id: 'shiftPlansPanel' }, [
      el('div', { className: 'form-row shift-plans-toolbar' }, [
        field('Buscar', el('input', { id: 'shiftSearch', className: 'input', placeholder: 'Nombre o notas del plan...' })),
        el('div', { className: 'shift-plans-toolbar__actions' }, [
          el('button', { id: 'btnNewPlan', className: 'btn btn--primary', type: 'button', disabled: !canEdit }, ['Nuevo plan']),
          el('button', { id: 'btnGenerateShifts', className: 'btn', type: 'button', disabled: !canGenerate }, ['Activar plan'])
        ])
      ]),
      el('div', { className: 'responsive-records mt-2' }, [
        el('div', { className: 'table-wrap responsive-table-view shift-plans-table-view' }, [
          el('table', { className: 'table', id: 'tblShiftPlans' }, [
            el('thead', {}, [el('tr', {}, [
              el('th', {}, ['Plan']),
              el('th', {}, ['Horarios']),
              el('th', {}, ['Estado']),
              el('th', {}, ['Acciones'])
            ])]),
            el('tbody', {})
          ])
        ]),
        el('div', { id: 'shiftPlanCards', className: 'record-card-list shift-plan-card-list' }, [])
      ])
    ]);
  }

  function generatedPanel() {
    return el('div', { id: 'shiftGeneratedPanel' }, [
      el('div', { className: 'form-row shift-module-toolbar' }, [
        field('Sede', el('select', { id: 'generatedSede', className: 'select' }, [el('option', { value: '' }, ['Todas'])])),
        field('Plan', el('select', { id: 'generatedPlan', className: 'select' }, [el('option', { value: '' }, ['Todos'])])),
        el('button', { id: 'btnLoadGeneratedShifts', className: 'btn btn--primary right', type: 'button' }, ['Consultar planes activos'])
      ]),
      el('div', { id: 'generatedShiftMsg', className: 'text-muted shift-module-message', role: 'status' }, []),
      el('div', { className: 'responsive-records mt-2' }, [
        el('div', { className: 'table-wrap responsive-table-view shift-generated-table-view' }, [
          el('table', { className: 'table', id: 'tblGeneratedShifts' }, [
            el('thead', {}, [el('tr', {}, [
              el('th', {}, ['Sede']),
              el('th', {}, ['Plan activo']),
              el('th', {}, ['Empleados']),
              el('th', {}, ['Asignacion']),
              el('th', {}, ['Acciones'])
            ])]),
            el('tbody', {})
          ])
        ]),
        el('div', { id: 'shiftGeneratedCards', className: 'record-card-list shift-generated-card-list' }, [])
      ])
    ]);
  }

  function reviewPanel() {
    return el('div', { id: 'shiftReviewPanel' }, [
      el('div', { className: 'form-row shift-module-toolbar' }, [
        field('Desde', el('input', { id: 'shiftReviewFrom', className: 'input', type: 'date', value: addIsoDays(todayBogota(), -7) })),
        field('Hasta', el('input', { id: 'shiftReviewTo', className: 'input', type: 'date', value: todayBogota() })),
        field('Sede', el('select', { id: 'generatedSede', className: 'select' }, [el('option', { value: '' }, ['Todas'])])),
        field('Plan', el('select', { id: 'generatedPlan', className: 'select' }, [el('option', { value: '' }, ['Todos'])])),
        el('button', { id: 'btnLoadShiftReview', className: 'btn btn--primary right', type: 'button' }, ['Consultar revision'])
      ]),
      el('div', { id: 'shiftReviewMsg', className: 'text-muted shift-module-message', role: 'status' }, []),
      el('div', { id: 'shiftReviewRecords', className: 'responsive-records mt-2' }, [
        el('div', { className: 'table-wrap responsive-table-view shift-review-table-view' }, [
          el('table', { className: 'table', id: 'tblShiftReview' }, [
            el('thead', {}, [el('tr', {}, [
              el('th', {}, ['Fecha']),
              el('th', {}, ['Sede']),
              el('th', {}, ['Turno']),
              el('th', {}, ['Empleado']),
              el('th', {}, ['Por revisar']),
              el('th', {}, ['Tiempo']),
              el('th', {}, ['Acciones'])
            ])]),
            el('tbody', {})
          ])
        ]),
        el('div', { id: 'shiftReviewCards', className: 'record-card-list shift-review-card-list' }, [])
      ])
    ]);
  }

  let templates = [];
  let sedes = [];
  let employees = [];
  let scheduledShifts = [];
  let activePlanAssignments = [];
  let scheduledShiftAssignmentCounts = new Map();
  let shiftReviewRows = [];
  let reviewShiftById = new Map();
  let reviewLoaded = false;
  let generatedLoaded = false;
  let pendingGeneratedFilters = null;
  let generatedRevision = 0;
  let reviewRevision = 0;
  let ruleRevision = 0;
  let catalogRevision = 0;
  let observedContractCode = currentContractCode();
  let ruleCounts = new Map();
  let unTemplates = null;
  let unSedes = null;
  let unSelectedContract = null;
  let disposed = false;

  const planBody = qs('#tblShiftPlans tbody', ui);
  const planCards = qs('#shiftPlanCards', ui);
  const generatedBody = qs('#tblGeneratedShifts tbody', ui);
  const generatedCards = qs('#shiftGeneratedCards', ui);
  const reviewBody = qs('#tblShiftReview tbody', ui);
  const reviewCards = qs('#shiftReviewCards', ui);
  const generatedMsg = qs('#generatedShiftMsg', ui);
  const reviewMsg = qs('#shiftReviewMsg', ui);
  const planPaginator = !isGeneratedScreen && !isReviewScreen
    ? createTablePagination(ui, { id: 'shiftPlans', after: '#shiftPlansPanel .responsive-records', onChange: render })
    : null;
  const generatedPaginator = isGeneratedScreen
    ? createTablePagination(ui, { id: 'generatedShifts', after: '#shiftGeneratedPanel .responsive-records', defaultPageSize: 25, onChange: () => loadGeneratedShifts({ resetPage: false }) })
    : null;
  const reviewPaginator = isReviewScreen
    ? createTablePagination(ui, { id: 'shiftReviewRows', after: '#shiftReviewRecords', onChange: renderShiftReview })
    : null;
  qs('#btnNewPlan', ui)?.addEventListener('click', () => openPlanModal(null));
  qs('#btnGenerateShifts', ui)?.addEventListener('click', openGenerateShiftsModal);
  qs('#shiftSearch', ui)?.addEventListener('input', () => {
    planPaginator?.reset();
    render();
  });
  qs('#btnLoadGeneratedShifts', ui)?.addEventListener('click', () => loadGeneratedShifts());
  qs('#btnLoadShiftReview', ui)?.addEventListener('click', () => {
    resetReviewPaginators();
    loadShiftReview();
  });
  ['#generatedSede', '#generatedPlan'].forEach((selector) => {
    qs(selector, ui)?.addEventListener('change', () => {
      generatedPaginator?.reset();
      resetReviewPaginators();
      if (isGeneratedScreen) loadGeneratedShifts();
      if (isReviewScreen) loadShiftReview({ silent: true });
    });
  });
  ['#shiftReviewFrom', '#shiftReviewTo'].forEach((selector) => {
    qs(selector, ui)?.addEventListener('change', resetReviewPaginators);
  });

  function notify(message, type = 'info') {
    showNotification(message, { type });
  }

  function normalize(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function field(label, inputNode) {
    return el('div', {}, [
      el('label', { className: 'label' }, [label]),
      inputNode
    ]);
  }

  function optionNodes(options = [], selectedValue = '') {
    return options.map((opt) => el('option', { value: String(opt.value), selected: String(opt.value) === String(selectedValue) }, [opt.label || String(opt.value)]));
  }

  function replaceSelectOptions(selector, options = []) {
    const node = qs(selector, ui);
    if (!node) return;
    const current = String(node.value || '');
    node.replaceChildren(...optionNodes(options, current));
    if (options.some((opt) => String(opt.value) === current)) node.value = current;
  }

  function sedeLabel(code, fallback = '') {
    const clean = String(code || '').trim();
    const sede = sedes.find((item) => String(item.codigo || '').trim() === clean) || null;
    const name = String(sede?.nombre || fallback || '').trim();
    return name || clean || '-';
  }

  function currentContractCode() {
    return contractFilterCode();
  }

  function visibleSedes() {
    return (sedes || []).filter((sede) => contractMatches(sede));
  }

  function visibleEmployees() {
    return (employees || []).filter((employee) => contractMatches(employee));
  }

  function planLabel(id, fallback = '') {
    const clean = String(id || '').trim();
    const plan = templates.find((item) => String(item.id || '').trim() === clean) || null;
    return plan?.nombre || fallback || '-';
  }

  function contractLabel(row = {}, fallback = {}) {
    return row.contratoNombre || row.contratoCodigo || row.clienteNombreSnapshot || fallback.contratoNombre || fallback.contratoCodigo || fallback.clienteNombreSnapshot || '-';
  }

  function estadoBadge(estado) {
    const clean = String(estado || '-').trim() || '-';
    const klass = clean === 'cerrado' || clean === 'activo'
      ? 'badge badge--ok'
      : clean === 'cancelado' || clean === 'inactivo'
      ? 'badge badge--off'
      : clean === 'abierto'
      ? 'badge badge--busy'
      : 'badge badge--warn';
    return el('span', { className: klass }, [clean]);
  }

  function formatBogotaTime(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return new Intl.DateTimeFormat('es-CO', {
      timeZone: 'America/Bogota',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(date);
  }

  function inputTimeFromBogota(value) {
    const time = formatBogotaTime(value);
    return /^\d{2}:\d{2}$/.test(time) ? time : '';
  }

  function formatBogotaDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(date);
  }

  function shiftTimeLabel(row = {}) {
    const start = formatBogotaTime(row.startsAt);
    const end = formatBogotaTime(row.endsAt);
    const startDay = formatBogotaDate(row.startsAt);
    const endDay = formatBogotaDate(row.endsAt);
    const suffix = startDay && endDay && endDay > startDay ? ' (+1)' : '';
    return `${start} - ${end}${suffix}`;
  }

  function shiftCrossesDay(row = {}) {
    const startDay = formatBogotaDate(row.startsAt);
    const endDay = formatBogotaDate(row.endsAt);
    return Boolean(startDay && endDay && endDay > startDay);
  }

  function bogotaLocalToUtcIso(isoDate, hhmm) {
    const date = new Date(`${isoDate}T${hhmm}:00-05:00`);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
  }

  function activeGeneratedPlanRows(planAssignments = activePlanAssignments, shifts = scheduledShifts) {
    const filters = generatedFilterValues();
    const shiftsByActivePlan = new Map();
    (shifts || []).forEach((row) => {
      const key = activePlanKey(row.sedeCodigo, row.templateId);
      if (!key) return;
      if (!shiftsByActivePlan.has(key)) shiftsByActivePlan.set(key, []);
      shiftsByActivePlan.get(key).push(row);
    });
    return (planAssignments || [])
      .filter((row) => String(row.estado || 'activo') !== 'inactivo')
      .filter((row) => !filters.sedeCodigo || String(row.sedeCodigo || '').trim() === filters.sedeCodigo)
      .filter((row) => !filters.templateId || String(row.templateId || '').trim() === filters.templateId)
      .map((row) => {
        const key = activePlanKey(row.sedeCodigo, row.templateId);
        const items = (shiftsByActivePlan.get(key) || []).sort((a, b) => {
          if (String(a.fechaOperativa || '') !== String(b.fechaOperativa || '')) return String(a.fechaOperativa || '').localeCompare(String(b.fechaOperativa || ''));
          return String(a.startsAt || '').localeCompare(String(b.startsAt || ''));
        });
        return {
          id: key,
          assignmentId: row.id || null,
          assignment: row,
          items,
          sedeCodigo: row.sedeCodigo || null,
          sedeNombre: row.sedeNombre || null,
          contratoCodigo: row.contratoCodigo || null,
          contratoNombre: row.contratoNombre || null,
          clienteNombreSnapshot: row.clienteNombreSnapshot || null,
          clienteNitSnapshot: row.clienteNitSnapshot || null,
          templateId: row.templateId || null,
          nombre: planLabel(row.templateId),
          operariosPlaneados: row.operariosPlaneados ?? 0,
          horizonDays: SHIFT_GENERATION_DAYS,
          estado: row.estado || 'activo',
          estados: [...new Set(items.map((item) => item.estado || 'programado'))],
          count: items.length
        };
      })
      .sort((a, b) => {
        const sedeCompare = String(a.sedeNombre || a.sedeCodigo || '').localeCompare(String(b.sedeNombre || b.sedeCodigo || ''));
        if (sedeCompare) return sedeCompare;
        // Keep page membership stable while the template catalog loads.
        return String(a.templateId || '').localeCompare(String(b.templateId || ''));
      });
  }

  function activePlanKey(sedeCodigo, templateId) {
    const sede = String(sedeCodigo || '').trim();
    const template = String(templateId || '').trim();
    return sede && template ? `${sede}|${template}` : '';
  }

  function refreshGeneratedFilterOptions() {
    replaceSelectOptions('#generatedSede', [
      { value: '', label: 'Todas' },
      ...sedes
        .filter((sede) => String(sede.estado || 'activo') !== 'inactivo')
        .filter((sede) => contractMatches(sede))
        .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')))
        .map((sede) => ({ value: sede.codigo || '', label: sedeLabel(sede.codigo, sede.nombre) }))
    ]);
    replaceSelectOptions('#generatedPlan', [
      { value: '', label: 'Todos' },
      ...templates
        .filter((row) => String(row.estado || 'activo') !== 'inactivo')
        .filter((row) => !currentContractCode() || !row.contratoCodigo || contractMatches(row))
        .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')))
        .map((row) => ({ value: row.id || '', label: row.nombre || '-' }))
    ]);
    if (pendingGeneratedFilters) {
      if (pendingGeneratedFilters.sedeCodigo && qs('#generatedSede', ui)) qs('#generatedSede', ui).value = pendingGeneratedFilters.sedeCodigo;
      if (pendingGeneratedFilters.templateId && qs('#generatedPlan', ui)) qs('#generatedPlan', ui).value = pendingGeneratedFilters.templateId;
    }
  }

  function nextPlanOrder() {
    return templates.reduce((max, row) => Math.max(max, Number(row.orden || 0)), 0) + 1;
  }

  function nextRuleOrder(rows, tipoDia = 'dia_semana', diaSemana = null) {
    return rows
      .filter((row) => row.estado !== 'inactivo')
      .filter((row) => String(row.tipoDia || '') === String(tipoDia || '') && String(row.diaSemana || '') === String(diaSemana || ''))
      .reduce((max, row) => Math.max(max, Number(row.orden || 0)), 0) + 1;
  }

  function blankRule(rows, type = 'dia_semana', day = '1') {
    return {
      _localId: `new-${nextLocalId++}`,
      id: null,
      nombre: '',
      tipoDia: type,
      diaSemana: type === 'festivo' ? null : day,
      horaInicio: '',
      horaFin: '',
      cruzaDia: false,
      ...(lunchSupported ? { almuerzoMinutos: DEFAULT_LUNCH_MINUTES } : {}),
      frecuenciaTipo: 'todos',
      frecuenciaSemanas: 1,
      fechaAncla: null,
      semanaMes: null,
      festivoModo: type === 'festivo' ? 'normal' : 'excluir',
      ventanaEntradaAntesMinutos: DEFAULT_WINDOW_ENTRY_BEFORE_MINUTES,
      alertaEntradaAntesMinutos: DEFAULT_ALERT_MINUTES,
      ventanaEntradaDespuesMinutos: DEFAULT_WINDOW_ENTRY_AFTER_MINUTES,
      alertaEntradaDespuesMinutos: DEFAULT_ALERT_MINUTES,
      ventanaSalidaAntesMinutos: DEFAULT_WINDOW_EXIT_BEFORE_MINUTES,
      alertaSalidaAntesMinutos: DEFAULT_ALERT_MINUTES,
      ventanaSalidaDespuesMinutos: DEFAULT_WINDOW_EXIT_AFTER_MINUTES,
      alertaSalidaDespuesMinutos: DEFAULT_ALERT_MINUTES,
      ventanaNovedadHoras: DEFAULT_NOVELTY_WINDOW_HOURS,
      orden: nextRuleOrder(rows, type, type === 'festivo' ? null : day),
      notas: '',
      estado: 'activo'
    };
  }

  function filteredTemplates() {
    const term = normalize(qs('#shiftSearch', ui)?.value || '');
    return templates
      .filter((row) => {
        if (String(row.estado || 'activo') === 'inactivo') return false;
        if (currentContractCode() && row.contratoCodigo && !contractMatches(row)) return false;
        if (!term) return true;
        return normalize([row.nombre, row.notasProgramacion].join(' ')).includes(term);
      })
      .sort((a, b) => {
        if (Number(a.orden || 0) !== Number(b.orden || 0)) return Number(a.orden || 0) - Number(b.orden || 0);
        return String(a.nombre || '').localeCompare(String(b.nombre || ''));
      });
  }

  function render() {
    refreshGeneratedFilterOptions();
    if (!isGeneratedScreen && !isReviewScreen) {
      const rows = filteredTemplates();
      const pageRows = planPaginator?.slice(rows) || rows;
      planBody.replaceChildren(...(pageRows.length ? pageRows.map(planRow) : [
        el('tr', {}, [el('td', { colSpan: 4, className: 'text-muted' }, ['Sin planes de turno.'])])
      ]));
      planCards.replaceChildren(...(pageRows.length ? pageRows.map(planCard) : [
        el('p', { className: 'text-muted record-card__empty' }, ['Sin planes de turno.'])
      ]));
    }
    if (isGeneratedScreen) renderGeneratedShifts();
    if (isReviewScreen) renderShiftReview();
  }

  function generatedFilterValues() {
    return {
      sedeCodigo: String(qs('#generatedSede', ui)?.value || pendingGeneratedFilters?.sedeCodigo || '').trim(),
      templateId: String(qs('#generatedPlan', ui)?.value || pendingGeneratedFilters?.templateId || '').trim()
    };
  }

  function reviewFilterValues() {
    return {
      ...generatedFilterValues(),
      dateFrom: String(qs('#shiftReviewFrom', ui)?.value || addIsoDays(todayBogota(), -7)).trim(),
      dateTo: String(qs('#shiftReviewTo', ui)?.value || todayBogota()).trim()
    };
  }

  function resetReviewPaginators() {
    reviewPaginator?.reset();
  }

  async function loadGeneratedShifts({ silent = false, resetPage = true } = {}) {
    const revision = ++generatedRevision;
    if (typeof deps.listShiftSitePlanAssignments !== 'function' || typeof deps.listScheduledShiftsRange !== 'function') {
      generatedLoaded = true;
      scheduledShifts = [];
      activePlanAssignments = [];
      scheduledShiftAssignmentCounts = new Map();
      generatedMsg.textContent = 'No esta disponible la consulta de planes activos.';
      renderGeneratedShifts();
      return;
    }
    const filters = generatedFilterValues();
    const contratoCodigo = currentContractCode();
    if (!contratoCodigo) {
      activePlanAssignments = [];
      scheduledShifts = [];
      scheduledShiftAssignmentCounts = new Map();
      generatedLoaded = true;
      renderGeneratedShifts();
      generatedMsg.textContent = 'Selecciona un contrato para consultar sus turnos generados.';
      generatedBody.inert = false;
      generatedCards.inert = false;
      return;
    }
    try {
      generatedMsg.textContent = 'Consultando planes activos...';
      generatedBody.inert = true;
      generatedCards.inert = true;
      if (!generatedLoaded) renderGeneratedShifts();
      const activeRows = await deps.listShiftSitePlanAssignments({
        includeInactive: false,
        sedeCodigo: filters.sedeCodigo || null,
        templateId: filters.templateId || null,
        contratoCodigo
      }) || [];
      if (disposed || revision !== generatedRevision) return;
      if (resetPage) generatedPaginator?.reset();
      const groups = activeGeneratedPlanRows(activeRows, []);
      const pageGroups = generatedPaginator?.slice(groups) || groups;
      const dateFrom = addIsoDays(todayBogota(), 1);
      const dateTo = addIsoDays(dateFrom, SHIFT_GENERATION_DAYS - 1);
      const rows = pageGroups.length
        ? await deps.listScheduledShiftsRange(dateFrom, dateTo, {
          sedeCodigo: filters.sedeCodigo || null,
          sedeTemplatePairs: pageGroups.map(row => ({ sedeCodigo: row.sedeCodigo, templateId: row.templateId })),
          contratoCodigo,
          estados: ['programado', 'abierto']
        })
        : [];
      if (disposed || revision !== generatedRevision) return;
      const activeKeys = new Set(pageGroups.map((row) => activePlanKey(row.sedeCodigo, row.templateId)).filter(Boolean));
      const nextShifts = (rows || [])
        .filter((row) => activeKeys.has(activePlanKey(row.sedeCodigo, row.templateId)))
        .sort((a, b) => {
          if (String(a.fechaOperativa || '') !== String(b.fechaOperativa || '')) return String(a.fechaOperativa || '').localeCompare(String(b.fechaOperativa || ''));
          if (String(a.sedeNombre || a.sedeCodigo || '') !== String(b.sedeNombre || b.sedeCodigo || '')) return String(a.sedeNombre || a.sedeCodigo || '').localeCompare(String(b.sedeNombre || b.sedeCodigo || ''));
          return String(a.startsAt || '').localeCompare(String(b.startsAt || ''));
        });
      const shiftIds = nextShifts.map((row) => row.id).filter(Boolean);
      const assignments = typeof deps.listShiftAssignmentsForShifts === 'function'
        ? await deps.listShiftAssignmentsForShifts(shiftIds, { summaryOnly: true })
        : [];
      if (disposed || revision !== generatedRevision) return;
      activePlanAssignments = activeRows;
      scheduledShifts = nextShifts;
      scheduledShiftAssignmentCounts = buildAssignmentCountMap(assignments);
      generatedLoaded = true;
      pendingGeneratedFilters = null;
      renderGeneratedShifts();
      generatedMsg.textContent = '';
    } catch (error) {
      if (disposed || revision !== generatedRevision) return;
      generatedLoaded = true;
      scheduledShifts = [];
      activePlanAssignments = [];
      scheduledShiftAssignmentCounts = new Map();
      renderGeneratedShifts();
      generatedMsg.textContent = `Error consultando planes activos: ${error?.message || error}`;
    } finally {
      if (!disposed && revision === generatedRevision) {
        generatedBody.inert = false;
        generatedCards.inert = false;
      }
    }
  }

  async function loadShiftReview({ silent = false } = {}) {
    const revision = ++reviewRevision;
    if (typeof deps.listEmployeeShiftStatusRange !== 'function') {
      reviewLoaded = true;
      shiftReviewRows = [];
      reviewShiftById = new Map();
      if (reviewMsg) reviewMsg.textContent = 'No esta disponible la revision de turnos.';
      renderShiftReview();
      return;
    }
    const filters = reviewFilterValues();
    const contratoCodigo = currentContractCode();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(filters.dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(filters.dateTo) || filters.dateFrom > filters.dateTo) {
      notify('Selecciona un rango valido para la revision.', 'warning');
      return;
    }
    try {
      if (reviewMsg) reviewMsg.textContent = 'Consultando revision...';
      const [statusRows, shiftRows] = await Promise.all([
        deps.listEmployeeShiftStatusRange(filters.dateFrom, filters.dateTo, {
          sedeCodigo: filters.sedeCodigo || null,
          reviewableOnly: true,
          contratoCodigo
        }) || [],
        typeof deps.listScheduledShiftsRange === 'function'
          ? deps.listScheduledShiftsRange(filters.dateFrom, filters.dateTo, {
            sedeCodigo: filters.sedeCodigo || null,
            contratoCodigo,
            estados: ['programado', 'abierto', 'cerrado', 'cancelado']
          })
          : []
      ]);
      if (disposed || revision !== reviewRevision) return;
      reviewShiftById = new Map((shiftRows || []).map((row) => [String(row.id || '').trim(), row]));
      const allowedShiftIds = new Set((shiftRows || [])
        .filter((row) => !filters.templateId || String(row.templateId || '').trim() === filters.templateId)
        .map((row) => String(row.id || '').trim())
        .filter(Boolean));
      const hasPlanFilter = Boolean(filters.templateId);
      shiftReviewRows = (statusRows || [])
        .filter((row) => !hasPlanFilter || allowedShiftIds.has(String(row.scheduledShiftId || '').trim()))
        .filter(isReviewableShiftStatus)
        .sort((a, b) => {
          if (String(a.fechaOperativa || '') !== String(b.fechaOperativa || '')) return String(b.fechaOperativa || '').localeCompare(String(a.fechaOperativa || ''));
          return String(a.nombre || '').localeCompare(String(b.nombre || ''));
        });
      reviewLoaded = true;
      renderShiftReview();
      if (reviewMsg) reviewMsg.textContent = '';
    } catch (error) {
      if (disposed || revision !== reviewRevision) return;
      reviewLoaded = true;
      shiftReviewRows = [];
      reviewShiftById = new Map();
      renderShiftReview();
      if (reviewMsg) reviewMsg.textContent = `Error consultando revision: ${error?.message || error}`;
    }
  }

  function renderShiftReview() {
    if (!isReviewScreen || !reviewBody) return;
    if (!reviewLoaded) {
      reviewBody.replaceChildren(el('tr', {}, [el('td', { colSpan: 7, className: 'text-muted' }, ['Usa Consultar revision para ver novedades de turnos cerrados o fuera de ventana.'])]));
      reviewCards?.replaceChildren(el('p', { className: 'text-muted record-card__empty' }, ['Usa Consultar revision para ver novedades de turnos cerrados o fuera de ventana.']));
      reviewPaginator?.slice([]);
      return;
    }
    const reviewPageRows = reviewPaginator?.slice(shiftReviewRows) || shiftReviewRows;
    reviewBody.replaceChildren(...(reviewPageRows.length ? reviewPageRows.map(shiftReviewRow) : [
      el('tr', {}, [el('td', { colSpan: 7, className: 'text-muted' }, ['Sin pendientes de revision en el rango.'])])
    ]));
    reviewCards?.replaceChildren(...(reviewPageRows.length ? reviewPageRows.map(shiftReviewCard) : [
      el('p', { className: 'text-muted record-card__empty' }, ['Sin pendientes de revision en el rango.'])
    ]));
  }

  function shiftReviewRow(row) {
    const shift = reviewShiftById.get(String(row.scheduledShiftId || '').trim()) || {};
    return el('tr', {}, [
      el('td', {}, [row.fechaOperativa || '-']),
      el('td', {}, [sedeLabel(row.sedeCodigo || shift.sedeCodigo, shift.sedeNombre)]),
      el('td', {}, [shiftReviewShiftLabel(shift, row)]),
      el('td', {}, [employeeReviewLabel(row)]),
      el('td', {}, [shiftReviewColoredValues(row)]),
      el('td', {}, [shiftReviewColoredValues(row, true)]),
      el('td', {}, [shiftReviewActions(row)])
    ]);
  }

  function shiftReviewCard(row) {
    const shift = reviewShiftById.get(String(row.scheduledShiftId || '').trim()) || {};
    return el('article', { className: 'record-card shift-review-card' }, [
      el('div', { className: 'record-card__header' }, [
        el('div', { className: 'record-card__identity' }, [
          el('strong', { className: 'record-card__title' }, [employeeReviewLabel(row)]),
          el('span', { className: 'record-card__subtitle' }, [shiftReviewShiftLabel(shift, row)])
        ]),
        shiftReviewColoredValues(row)
      ]),
      el('dl', { className: 'record-card__meta' }, [
        ['Fecha', row.fechaOperativa || '-'],
        ['Sede', sedeLabel(row.sedeCodigo || shift.sedeCodigo, shift.sedeNombre)],
        ['Contrato', contractLabel(row, shift)],
        ['Tiempo', shiftReviewColoredValues(row, true)]
      ].map(([label, value]) => el('div', { className: 'record-card__meta-item' }, [
        el('dt', {}, [label]),
        el('dd', {}, [value || '-'])
      ]))),
      el('div', { className: 'record-card__actions' }, [shiftReviewActions(row)])
    ]);
  }

  function shiftReviewColoredValues(row, timeOnly = false) {
    const items = shiftReviewItems(row);
    const times = timeOnly ? shiftReviewTimeSummary(row).split(' · ') : [];
    return el('span', { className: 'shift-review-values' }, items.length
      ? items.flatMap(({ label: circumstance, decision }, index) => {
        const tone = shiftReviewTone(row, circumstance);
        const value = el('span', {
          className: `shift-review-value${tone ? ` shift-review-value--${tone}` : ''}`,
          title: decision ? `${shiftReviewDecisionLabel(decision)}: ${decision.minutes} min. ${decision.reason}` : circumstance
        }, [timeOnly ? times[index] || '-' : circumstance + (decision ? ` — ${shiftReviewDecisionLabel(decision)}` : '')]);
        return index ? [' · ', value] : [value];
      })
      : ['-']);
  }

  function shiftReviewActions(row) {
    const canAuthorize = pendingShiftReviewItems(row).some(item => item.effect);
    const actions = el('div', { className: 'row-actions' }, [
      el('button', { className: 'btn btn--icon', type: 'button', title: 'Ver informacion', 'aria-label': 'Ver informacion' }, [infoIcon()]),
      el('button', { className: 'btn btn--icon', type: 'button', disabled: !canReview || !canAuthorize, title: 'Autorizar ajuste de tiempo', 'aria-label': 'Autorizar ajuste de tiempo' }, [lucideInlineIcon('clock-check', 'Au', 'app-clock-check-icon')]),
      el('button', { className: 'btn btn--icon', type: 'button', disabled: !canReview, title: 'Aprobar sin ajuste de tiempo', 'aria-label': 'Aprobar sin ajuste de tiempo' }, [lucideInlineIcon('check', 'Ok', 'app-check-icon')])
    ]);
    actions.children[0].addEventListener('click', (ev) => {
      ev.stopPropagation();
      openShiftReviewInfoModal(row);
    });
    actions.children[1].addEventListener('click', (ev) => {
      ev.stopPropagation();
      authorizeShiftReviewTime(row);
    });
    actions.children[2].addEventListener('click', (ev) => {
      ev.stopPropagation();
      resolveShiftReview(row);
    });
    return actions;
  }

  function openShiftReviewInfoModal(row = {}) {
    const shift = reviewShiftById.get(String(row.scheduledShiftId || '').trim()) || {};
    const entryMinutes = entryMinutesFromStart(row, shift);
    const entryLabel = minutes => minutes == null ? 'No calculable' : `${minutes} min`;
    showInfoModal(`Revision - ${employeeReviewLabel(row)}`, [
      el('div', { className: 'employee-detail' }, [
        detailSection('Registro', [
          ['Empleado', employeeReviewLabel(row)],
          ['Documento', row.documento],
          ['Por revisar', shiftReviewLabel(row)],
          ['Requiere revision', row.requiresReview ? 'Si' : 'No'],
          ['Entrada', formatDateTime(row.entradaAt)],
          ['Salida', formatDateTime(row.salidaAt)],
          ['Novedad', [row.novedadCodigo, row.novedadNombre].filter(Boolean).join(' - ')],
          ['Cerrado', row.closed ? 'Si' : 'No']
        ]),
        detailSection('Turno', [
          ['Fecha operativa', row.fechaOperativa],
          ['Sede', sedeLabel(row.sedeCodigo || shift.sedeCodigo, shift.sedeNombre)],
          ['Turno', shiftReviewShiftLabel(shift, row)],
          ['Estado turno generado', shift.estado],
          ['Inicio', formatDateTime(shift.startsAt)],
          ['Fin', formatDateTime(shift.endsAt)]
        ]),
        detailSection('Entrada respecto al inicio del turno', [
          ['Entrada anticipada', entryLabel(entryMinutes.earlyEntryMinutes)],
          ['Entrada tardia', entryLabel(entryMinutes.lateEntryMinutes)],
          ['Motivo entrada anticipada', row.earlyEntryReason],
          ['Motivo entrada tardia', row.lateEntryReason]
        ]),
        detailSection('Salida fuera de ventana', [
          ['Salida anticipada', `${row.earlyExitMinutes || 0} min`],
          ['Salida tardia', `${row.lateExitMinutes || 0} min`],
          ['Motivo salida anticipada', row.earlyExitReason],
          ['Motivo salida tardia', row.lateExitReason]
        ]),
        detailSection('Decisiones registradas', shiftReviewItems(row).filter(item => item.decision).map(item => [
          item.label, `${shiftReviewDecisionLabel(item.decision)} · ${item.decision.minutes} min · ${item.decision.reason}`
        ]))
      ])
    ]);
  }

  async function chooseReviewCircumstance(row, adjustment) {
    const items = pendingShiftReviewItems(row).filter(item => !adjustment || item.effect);
    if (!items.length) {
      notify('No hay circunstancias pendientes para esta accion.', 'warning');
      return null;
    }
    if (items.length === 1) return items[0];
    const selection = await showActionModal({
      title: adjustment ? 'Autorizar ajuste de tiempo' : 'Aprobar sin ajuste de tiempo',
      message: employeeReviewLabel(row),
      confirmText: 'Continuar',
      fields: [{ id: 'circumstance', label: 'Circunstancia por gestionar', type: 'select',
        value: items[0].key, required: true,
        options: items.map(item => ({ value: item.key, label: item.label })) }]
    });
    return selection.confirmed ? items.find(item => item.key === selection.values.circumstance) || null : null;
  }

  async function authorizeShiftReviewTime(row = {}) {
    await saveShiftReviewDecision(row, true);
  }

  async function resolveShiftReview(row = {}) {
    await saveShiftReviewDecision(row, false);
  }

  const savingShiftReviews = new Set();
  async function saveShiftReviewDecision(row, adjustment) {
    if (!canReview || savingShiftReviews.has(row.id)) return;
    savingShiftReviews.add(row.id);
    try {
      if (typeof deps.resolveShiftReviewDecision !== 'function') throw new Error('No esta disponible el guardado de decisiones.');
      const item = await chooseReviewCircumstance(row, adjustment);
      if (!item) return;
      const shift = reviewShiftById.get(String(row.scheduledShiftId || '').trim()) || {};
      const effect = adjustment ? item.effect : 'none';
      const suggested = shiftReviewSuggestedMinutes(row, shift, item.key);
      const action = effect === 'addition' ? 'Autorizar adicion' : effect === 'deduction' ? 'Autorizar descuento' : 'Aprobar sin ajuste';
      const fields = adjustment ? [{ id: 'minutes', label: effect === 'addition' ? 'Minutos por adicionar' : 'Minutos por descontar',
        type: 'number', min: 1, step: 1, required: true, value: suggested > 0 ? String(suggested) : '' }] : [];
      fields.push({ id: 'reason', label: 'Motivo de la decision', type: 'textarea', required: true,
        value: item.reasonField ? row[item.reasonField] || '' : '', rows: 3 });
      const modal = await showActionModal({
        title: adjustment ? 'Autorizar ajuste de tiempo' : 'Aprobar sin ajuste de tiempo',
        message: employeeReviewLabel(row) + ' — ' + item.label + '. ' + (adjustment
          ? (effect === 'addition' ? 'Adicionar tiempo.' : 'Descontar tiempo.')
          : 'Se cerrara esta circunstancia sin adicionar ni descontar minutos.'),
        confirmText: action, fields
      });
      if (!modal.confirmed) return;
      const minutes = adjustment ? Number(modal.values.minutes) : 0;
      const reason = String(modal.values.reason || '').trim();
      if (!reason || !Number.isSafeInteger(minutes) || (adjustment && minutes <= 0)) {
        notify('Registra un motivo y, para ajustes, una cantidad entera positiva de minutos.', 'warning');
        return;
      }
      await deps.resolveShiftReviewDecision({
        statusId: row.id, circumstance: item.key, effect, minutes, reason,
        expectedUpdatedAt: row.updatedAt || null
      });
      notify('Decision guardada para ' + item.label.toLowerCase() + '.', 'success');
      await loadShiftReview({ silent: true });
    } catch (error) {
      notify('No se pudo guardar la decision: ' + (error?.message || error), 'error');
    } finally {
      savingShiftReviews.delete(row.id);
    }
  }

  function shiftReviewShiftLabel(shift = {}, fallback = {}) {
    return shift.nombre || fallback.turnoNombre || fallback.shiftNombre || 'Turno';
  }

  function employeeReviewLabel(row = {}) {
    return [row.nombre || '-', row.documento ? `(${row.documento})` : ''].filter(Boolean).join(' ');
  }

  function shiftReviewTimeSummary(row = {}) {
    const shift = reviewShiftById.get(String(row.scheduledShiftId || '').trim()) || {};
    const entryMinutes = entryMinutesFromStart(row, shift);
    const alerts = row.timingAlerts || {};
    const minutesByCircumstance = {
      'Entrada anticipada': entryMinutes.earlyEntryMinutes ?? alerts.entrada_anticipada,
      'Llegada tarde': entryMinutes.lateEntryMinutes ?? alerts.entrada_tardia,
      'Salida anticipada': Number(row.earlyExitMinutes || 0) || alerts.salida_anticipada,
      'Salida tardia': Number(row.lateExitMinutes || 0) || alerts.salida_tardia
    };
    return shiftReviewItems(row).map(({ label: circumstance }) => {
      const minutes = minutesByCircumstance[circumstance];
      return minutes == null ? '-' : `${minutes} min`;
    }).join(' · ') || '-';
  }

  function renderGeneratedShifts() {
    if (!generatedLoaded) {
      const loadingText = generatedRevision ? 'Consultando planes activos...' : 'Usa Consultar planes activos para ver las sedes con planes activos.';
      generatedBody.replaceChildren(el('tr', {}, [el('td', { colSpan: 5, className: 'text-muted' }, [loadingText])]));
      generatedCards.replaceChildren(el('p', { className: 'text-muted record-card__empty' }, [loadingText]));
      if (!activePlanAssignments.length) generatedPaginator?.slice([]);
      return;
    }
    const groupedRows = activeGeneratedPlanRows();
    const pageRows = generatedPaginator?.slice(groupedRows) || groupedRows;
    generatedBody.replaceChildren(...(pageRows.length ? pageRows.map(generatedShiftGroupRow) : [
      el('tr', {}, [el('td', { colSpan: 5, className: 'text-muted' }, ['Sin planes activos para los filtros seleccionados.'])])
    ]));
    generatedCards.replaceChildren(...(pageRows.length ? pageRows.map(generatedShiftGroupCard) : [
      el('p', { className: 'text-muted record-card__empty' }, ['Sin planes activos para los filtros seleccionados.'])
    ]));
  }

  function generatedShiftGroupRow(row) {
    return el('tr', {}, [
      el('td', {}, [sedeLabel(row.sedeCodigo, row.sedeNombre)]),
      el('td', {}, [planLabel(row.templateId, row.nombre)]),
      el('td', {}, [String(row.operariosPlaneados ?? 0)]),
      el('td', {}, [assignmentSummaryNode(row)]),
      el('td', {}, [generatedGroupActions(row)])
    ]);
  }

  function generatedShiftGroupCard(row) {
    return el('article', { className: 'record-card shift-generated-card' }, [
      el('div', { className: 'record-card__header' }, [
        el('div', { className: 'record-card__identity' }, [
          el('strong', { className: 'record-card__title' }, [sedeLabel(row.sedeCodigo, row.sedeNombre)]),
          el('span', { className: 'record-card__subtitle' }, [planLabel(row.templateId, row.nombre)])
        ])
      ]),
      el('dl', { className: 'record-card__meta' }, [
        ['Empleados', String(row.operariosPlaneados ?? 0)],
        ['Contrato', contractLabel(row)],
        ['Asignacion', assignmentSummaryNode(row)],
        ['Turnos futuros', String(row.count || 0)]
      ].map(([label, value]) => el('div', { className: 'record-card__meta-item' }, [
        el('dt', {}, [label]),
        el('dd', {}, [value || '-'])
      ]))),
      el('div', { className: 'record-card__actions' }, [generatedGroupActions(row)])
    ]);
  }

  function buildAssignmentCountMap(assignments = []) {
    const byShift = new Map();
    (assignments || [])
      .filter((row) => String(row.estado || 'asignado') !== 'cancelado')
      .forEach((row) => {
        const shiftId = String(row.scheduledShiftId || '').trim();
        if (!shiftId) return;
        const employeeKey = String(row.employeeId || row.documento || row.id || '').trim();
        if (!employeeKey) return;
        if (!byShift.has(shiftId)) byShift.set(shiftId, new Set());
        byShift.get(shiftId).add(employeeKey);
      });
    return new Map(Array.from(byShift.entries()).map(([shiftId, employeeKeys]) => [shiftId, employeeKeys.size]));
  }

  function assignmentSummary(group = {}) {
    const counts = (group.items || [])
      .map((row) => scheduledShiftAssignmentCounts.get(String(row.id || '')) || 0);
    const planned = Math.max(0, Number(group.operariosPlaneados || 0));
    if (!counts.length) return { label: `0/${planned}`, detail: 'Sin turnos', status: 'warn' };
    const min = counts.reduce((value, count) => Math.min(value, count), counts[0]);
    const max = counts.reduce((value, count) => Math.max(value, count), counts[0]);
    const label = min === max ? `${min}/${planned}` : `${min}-${max}/${planned}`;
    const missingMin = Math.max(planned - max, 0);
    const missingMax = Math.max(planned - min, 0);
    const surplusMin = Math.max(min - planned, 0);
    const surplusMax = Math.max(max - planned, 0);
    if (missingMax > 0 && surplusMax > 0) return { label, detail: 'Revisar', status: 'warn' };
    if (surplusMax > 0) {
      const detail = surplusMin === surplusMax ? `Sobran ${surplusMax}` : `Sobran hasta ${surplusMax}`;
      return { label, detail, status: 'off' };
    }
    if (missingMax > 0) {
      const detail = missingMin === missingMax ? `Faltan ${missingMax}` : `Faltan hasta ${missingMax}`;
      return { label, detail, status: 'warn' };
    }
    return { label, detail: 'Completo', status: 'ok' };
  }

  function assignmentSummaryNode(group = {}) {
    const summary = assignmentSummary(group);
    return el('span', { className: 'shift-assignment-summary' }, [
      el('strong', {}, [summary.label]),
      el('span', { className: `badge badge--${summary.status}` }, [summary.detail])
    ]);
  }

  function generatedGroupActions(group) {
    const todayLimit = todayBogota();
    const hasAssignableRows = (group.items || []).some((row) => row.id && String(row.fechaOperativa || '') > todayLimit && !['cancelado', 'cerrado'].includes(String(row.estado || '').trim()));
    const actions = el('div', { className: 'row-actions' }, [
      el('button', { className: 'btn btn--icon', type: 'button', disabled: !canAssign || !hasAssignableRows, title: 'Asignar empleados', 'aria-label': 'Asignar empleados' }, [lucideInlineIcon('users', 'As', 'app-users-icon')]),
      el('button', { className: 'btn btn--icon', type: 'button', title: 'Ver informacion', 'aria-label': 'Ver informacion' }, [infoIcon()])
    ]);
    actions.children[0].addEventListener('click', (ev) => {
      ev.stopPropagation();
      openAssignEmployeesModal(group);
    });
    actions.children[1].addEventListener('click', (ev) => {
      ev.stopPropagation();
      openGeneratedPlanInfoModal(group);
    });
    return actions;
  }

  async function openGeneratedPlanInfoModal(group = {}) {
    const templateId = String(group.templateId || '').trim();
    const plan = templates.find((row) => String(row.id || '') === templateId) || {
      id: templateId,
      nombre: group.nombre || planLabel(templateId)
    };
    try {
      const rules = templateId && typeof deps.listShiftTemplateRules === 'function'
        ? await deps.listShiftTemplateRules(templateId, { includeInactive: true })
        : [];
      showInfoModal(`Informacion - ${sedeLabel(group.sedeCodigo, group.sedeNombre)}`, [
        generatedPlanInfoContent(group, plan, rules || [])
      ]);
    } catch (error) {
      notify('No se pudo cargar la informacion del plan activo: ' + (error?.message || error), 'error');
    }
  }

  function generatedGroupAuditSnapshot(group = {}) {
    return {
      assignmentId: group.assignmentId || null,
      sedeCodigo: group.sedeCodigo || null,
      sedeNombre: group.sedeNombre || null,
      templateId: group.templateId || null,
      nombre: group.nombre || null,
      operariosPlaneados: group.operariosPlaneados ?? 0,
      estado: group.estado || null,
      estados: Array.isArray(group.estados) ? group.estados : [],
      count: group.count || 0,
      shiftIds: (group.items || []).map((row) => row.id).filter(Boolean)
    };
  }

  async function openGeneratedGroupModal(group) {
    if (!canGenerate) return;
    const todayLimit = todayBogota();
    const minEditableDate = addIsoDays(todayLimit, 1);
    const editableItems = (group.items || []).filter((row) => String(row.fechaOperativa || '') > todayLimit);
    if (!editableItems.length) {
      notify('Este rango no tiene turnos futuros para editar.', 'warning');
      return;
    }
    const defaultDateFrom = group.dateFrom && group.dateFrom > todayLimit ? group.dateFrom : minEditableDate;
    const defaultDateTo = group.dateTo && group.dateTo >= defaultDateFrom ? group.dateTo : defaultDateFrom;
    const first = editableItems[0] || {};
    const modal = await showActionModal({
      title: 'Editar rango programado',
      message: `Se actualizaran solo turnos futuros. Las fechas hasta ${todayLimit} no se modifican.`,
      confirmText: 'Guardar cambios',
      fields: [
        { id: 'dateFrom', label: 'Desde', type: 'date', required: true, min: minEditableDate, value: defaultDateFrom },
        { id: 'dateTo', label: 'Hasta', type: 'date', required: true, min: minEditableDate, value: defaultDateTo },
        { id: 'nombre', label: 'Nombre', type: 'text', value: group.nombre || '' },
        { id: 'horaInicio', label: 'Inicio', type: 'time', required: true, value: inputTimeFromBogota(first.startsAt) },
        { id: 'horaFin', label: 'Fin', type: 'time', required: true, value: inputTimeFromBogota(first.endsAt) },
        { id: 'cruzaDia', label: 'Cruce de dia', type: 'select', value: shiftCrossesDay(first) ? 'true' : 'false', options: [
          { value: 'false', label: 'Mismo dia' },
          { value: 'true', label: 'Pasa al dia siguiente' }
        ] },
        ...(lunchSupported ? [{ id: 'almuerzoMinutos', label: 'Almuerzo (min)', type: 'number', min: 0, max: 240, step: 5, value: String(first.almuerzoMinutos ?? 0) }] : []),
        { id: 'operariosPlaneados', label: 'Empleados', type: 'number', min: 0, max: group.operariosPlaneados ?? 0, step: 1, value: String(group.operariosPlaneados ?? 0) },
        { id: 'estado', label: 'Estado', type: 'select', value: group.estado || 'programado', options: [
          { value: 'programado', label: 'Programado' },
          { value: 'abierto', label: 'Abierto' },
          { value: 'cerrado', label: 'Cerrado' },
          { value: 'cancelado', label: 'Cancelado' }
        ] }
      ]
    });
    if (!modal.confirmed) return;
    try {
      const dateFrom = String(modal.values.dateFrom || '').trim();
      const operarios = Number(modal.values.operariosPlaneados);
      if (!Number.isInteger(operarios) || operarios < 0 || operarios > Number(group.operariosPlaneados || 0)) {
        notify('Los empleados del turno no pueden superar el cupo del plan. Ajusta primero la activacion del plan.', 'warning');
        return;
      }
      const dateTo = String(modal.values.dateTo || '').trim();
      const horaInicio = String(modal.values.horaInicio || '').trim();
      const horaFin = String(modal.values.horaFin || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo) || dateFrom > dateTo) {
        notify('Selecciona una vigencia valida para el rango.', 'warning');
        return;
      }
      if (dateFrom <= todayLimit) {
        notify('El desde debe ser posterior a hoy para no afectar historicos.', 'warning');
        return;
      }
      if (!/^\d{2}:\d{2}$/.test(horaInicio) || !/^\d{2}:\d{2}$/.test(horaFin)) {
        notify('Define hora de inicio y fin validas.', 'warning');
        return;
      }
      const cruzaDia = modal.values.cruzaDia === 'true';
      const skippedHistorical = (group.items || []).filter((row) => String(row.fechaOperativa || '') <= todayLimit).length;
      const updates = editableItems.filter((row) => row.id && row.fechaOperativa).map((row) => {
        const fecha = row.fechaOperativa;
        const outsideNewRange = fecha < dateFrom || fecha > dateTo;
        const isClosed = String(row.estado || '').trim() === 'cerrado';
        const endDate = cruzaDia ? addIsoDays(fecha, 1) : fecha;
        return {
          row,
          payload: {
            nombre: String(modal.values.nombre || '').trim() || row.nombre || 'Turno',
            startsAt: bogotaLocalToUtcIso(fecha, horaInicio),
            endsAt: bogotaLocalToUtcIso(endDate, horaFin),
            operariosPlaneados: Math.max(0, Number(modal.values.operariosPlaneados || 0)),
            ...(lunchSupported ? { almuerzoMinutos: Math.min(240, Math.max(0, Math.round(Number(modal.values.almuerzoMinutos) || 0))) } : {}),
            estado: outsideNewRange && !isClosed ? 'cancelado' : (String(modal.values.estado || row.estado || 'programado').trim() || 'programado')
          },
          outsideNewRange,
          isClosed
        };
      });
      const writableUpdates = updates.filter((item) => !(item.outsideNewRange && item.isClosed));
      if (writableUpdates.some((item) => !item.payload.startsAt || !item.payload.endsAt || new Date(item.payload.endsAt).getTime() <= new Date(item.payload.startsAt).getTime())) {
        notify('El horario final debe ser mayor al horario inicial.', 'warning');
        return;
      }
      for (const item of writableUpdates) {
        await deps.updateScheduledShift?.(item.row.id, item.payload);
      }
      const canceledOutside = updates.filter((item) => item.outsideNewRange && !item.isClosed).length;
      const skippedClosedOutside = updates.filter((item) => item.outsideNewRange && item.isClosed).length;
      const updatedInside = updates.length - canceledOutside - skippedClosedOutside;
      await deps.addAuditLog?.({
        targetType: 'scheduled_shift',
        targetId: null,
        action: 'update_scheduled_shift_group',
        before: generatedGroupAuditSnapshot(group),
        after: { count: writableUpdates.length, updatedInside, canceledOutside, skippedClosedOutside, skippedHistorical, values: modal.values }
      });
      notify(`Rango actualizado. Vigentes: ${updatedInside}. Cancelados fuera de vigencia: ${canceledOutside}. Historicos omitidos: ${skippedHistorical}.`, 'success');
      await loadGeneratedShifts({ silent: true });
    } catch (error) {
      notify('Error: ' + (error?.message || error), 'error');
    }
  }

  async function cancelGeneratedGroup(group) {
    if (!canGenerate) return;
    const todayLimit = todayBogota();
    const cancelableRows = (group.items || []).filter((row) => row.id && String(row.fechaOperativa || '') > todayLimit && String(row.estado || '') !== 'cerrado');
    if (!cancelableRows.length) {
      notify('Este rango no tiene turnos futuros disponibles para cancelar.', 'warning');
      return;
    }
    const modal = await showActionModal({
      title: 'Cancelar rango programado',
      message: `Se cancelaran ${cancelableRows.length} turnos futuros. Las fechas hasta ${todayLimit} y los turnos cerrados no se modifican.`,
      confirmText: 'Cancelar rango',
      cancelText: 'Volver'
    });
    if (!modal.confirmed) return;
    try {
      for (const row of cancelableRows) {
        await deps.setScheduledShiftStatus?.(row.id, 'cancelado');
      }
      const skippedHistorical = (group.items || []).filter((row) => String(row.fechaOperativa || '') <= todayLimit).length;
      const skippedClosed = (group.items || []).filter((row) => String(row.fechaOperativa || '') > todayLimit && String(row.estado || '') === 'cerrado').length;
      await deps.addAuditLog?.({
        targetType: 'scheduled_shift',
        targetId: null,
        action: 'cancel_scheduled_shift_group',
        before: generatedGroupAuditSnapshot(group),
        after: { estado: 'cancelado', count: cancelableRows.length, skippedHistorical, skippedClosed }
      });
      notify(`Rango cancelado. Turnos afectados: ${cancelableRows.length}. Historicos omitidos: ${skippedHistorical}.`, 'success');
      await loadGeneratedShifts({ silent: true });
    } catch (error) {
      notify('Error: ' + (error?.message || error), 'error');
    }
  }

  async function openAssignEmployeesModal(group) {
    if (!canAssign) return;
    const contractCode = currentContractCode();
    try {
      employees = await deps.listActiveBaseEmployees({ contratoCodigo: group.contratoCodigo || contractCode || undefined, sedeCodigo: group.sedeCodigo });
    } catch (error) {
      notify(`No se pudieron cargar los empleados: ${error?.message || error}`, 'error');
      return;
    }
    if (disposed || contractCode !== currentContractCode()) return;
    const todayLimit = todayBogota();
    const targetRows = (group.items || [])
      .filter((row) => row.id && String(row.fechaOperativa || '') > todayLimit)
      .filter((row) => !['cancelado', 'cerrado'].includes(String(row.estado || '').trim()));
    if (!targetRows.length) {
      notify('Este plan activo no tiene turnos futuros disponibles para asignar.', 'warning');
      return;
    }
    const sedeCode = String(group.sedeCodigo || '').trim();
    const rawAvailableEmployees = visibleEmployees()
      .filter((emp) => String(emp.estado || 'activo') !== 'inactivo')
      .filter((emp) => !sedeCode || String(emp.sedeCodigo || '').trim() === sedeCode)
      .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')));
    if (!rawAvailableEmployees.length) {
      notify('No hay empleados activos de esta sede para asignar.', 'warning');
      return;
    }
    try {
      const existingTargetAssignments = await deps.listShiftAssignmentsForShifts?.(targetRows.map((row) => row.id)) || [];
      const assignedToTarget = employeeRefsFromAssignments(existingTargetAssignments);
      const assignedToOtherSiteShifts = await employeeRefsAssignedToOtherSiteShifts(targetRows, group);
      const availableEmployees = rawAvailableEmployees.filter((emp) => {
        if (employeeInRefSet(emp, assignedToTarget)) return true;
        return !employeeInRefSet(emp, assignedToOtherSiteShifts);
      });
      if (!availableEmployees.length) {
        notify('No hay empleados disponibles: los empleados activos de esta sede ya estan asignados a otros turnos generados.', 'warning');
        return;
      }
      const preselected = commonAssignedEmployeeIds(existingTargetAssignments, targetRows);
      const modal = await showActionModal({
        title: 'Asignar empleados',
        message: `Se aplicara a ${targetRows.length} turnos futuros del plan activo. Empleados planeados por turno: ${group.operariosPlaneados ?? 0}.`,
        confirmText: 'Guardar asignacion',
        fields: [
          { id: 'employeeIds', label: 'Empleados', type: 'checkboxes', required: true, value: preselected, options: availableEmployees.map((emp) => ({
            value: emp.id,
            label: `${emp.nombre || '-'} - ${emp.documento || emp.codigo || '-'}`
          })) }
        ]
      });
      if (!modal.confirmed) return;
      const selectedIds = Array.isArray(modal.values.employeeIds) ? modal.values.employeeIds.map((id) => String(id || '').trim()).filter(Boolean) : [];
      if (!selectedIds.length) {
        notify('Selecciona al menos un empleado.', 'warning');
        return;
      }
      const selectedEmployees = selectedIds
        .map((id) => availableEmployees.find((emp) => String(emp.id || '') === id))
        .filter(Boolean);
      const latestAssignedToOtherSiteShifts = await employeeRefsAssignedToOtherSiteShifts(targetRows, group);
      const blockedSelectedEmployees = selectedEmployees.filter((emp) => employeeInRefSet(emp, latestAssignedToOtherSiteShifts));
      if (blockedSelectedEmployees.length) {
        notify(`Empleado ya asignado en otro turno de la sede: ${blockedSelectedEmployees.map((emp) => emp.nombre || emp.documento || '-').slice(0, 3).join(', ')}.`, 'warning');
        if (generatedMsg) generatedMsg.textContent = 'Asignacion pendiente por empleados ya asignados en la sede.';
        return;
      }
      if (generatedMsg) generatedMsg.textContent = 'Validando cruces de asignacion...';
      const overlap = await findAssignmentOverlap(targetRows, selectedEmployees);
      if (overlap.length) {
        notify(`Cruce detectado: ${overlap.slice(0, 3).join('; ')}${overlap.length > 3 ? '...' : ''}`, 'warning');
        if (generatedMsg) generatedMsg.textContent = 'Asignacion pendiente por cruce de horarios.';
        return;
      }
      const selectedSet = new Set(selectedIds);
      const removals = existingTargetAssignments.filter((row) => row.id && !selectedSet.has(String(row.employeeId || '')));
      if (generatedMsg) generatedMsg.textContent = 'Guardando asignacion de empleados...';
      if (removals.length && typeof deps.removeShiftAssignments === 'function') {
        await deps.removeShiftAssignments(removals.map((row) => row.id));
      } else {
        for (const row of removals) {
          await deps.removeShiftAssignment?.(row.id);
        }
      }
      const assignments = [];
      targetRows.forEach((shift) => {
        selectedEmployees.forEach((emp) => {
          assignments.push({
            scheduledShiftId: shift.id,
            employeeId: emp.id || null,
            documento: emp.documento || null,
            nombre: emp.nombre || null,
            cargoCodigo: emp.cargoCodigo || null,
            cargoNombre: emp.cargoNombre || null,
            sedeCodigo: shift.sedeCodigo || emp.sedeCodigo || null,
            contratoCodigo: shift.contratoCodigo || emp.contratoCodigo || group.contratoCodigo || null,
            contratoNombre: shift.contratoNombre || emp.contratoNombre || group.contratoNombre || null,
            clienteNombreSnapshot: shift.clienteNombreSnapshot || emp.clienteNombreSnapshot || group.clienteNombreSnapshot || null,
            clienteNitSnapshot: shift.clienteNitSnapshot || emp.clienteNitSnapshot || group.clienteNitSnapshot || null,
            estado: 'asignado'
          });
        });
      });
      const result = await deps.upsertShiftAssignments?.(assignments);
      await deps.addAuditLog?.({
        targetType: 'shift_assignment',
        targetId: null,
        action: 'assign_scheduled_shift_group',
        before: { group: generatedGroupAuditSnapshot(group), previousAssignments: existingTargetAssignments.length },
        after: { shifts: targetRows.length, employees: selectedEmployees.length, removed: removals.length, saved: result?.saved || assignments.length }
      });
      notify(`Asignacion guardada. Turnos: ${targetRows.length}. Empleados: ${selectedEmployees.length}.`, 'success');
      updateLocalAssignmentCounts(targetRows, selectedEmployees.length);
      renderGeneratedShifts();
      if (generatedMsg) generatedMsg.textContent = `Asignacion guardada. Turnos: ${targetRows.length}. Empleados: ${selectedEmployees.length}.`;
    } catch (error) {
      notify('Error: ' + (error?.message || error), 'error');
      if (generatedMsg) generatedMsg.textContent = 'No se pudo guardar la asignacion.';
    }
  }

  async function employeeRefsAssignedToOtherSiteShifts(targetRows = [], group = {}) {
    if (!targetRows.length || typeof deps.listScheduledShiftsRange !== 'function' || typeof deps.listShiftAssignmentsForShifts !== 'function') {
      return { ids: new Set(), docs: new Set() };
    }
    const sedeCode = String(group.sedeCodigo || targetRows[0]?.sedeCodigo || '').trim();
    if (!sedeCode) return { ids: new Set(), docs: new Set() };
    const dateFrom = targetRows.reduce((min, row) => !min || row.fechaOperativa < min ? row.fechaOperativa : min, '');
    const dateTo = targetRows.reduce((max, row) => !max || row.fechaOperativa > max ? row.fechaOperativa : max, '');
    const targetIds = new Set(targetRows.map((row) => String(row.id || '').trim()).filter(Boolean));
    const otherShifts = await deps.listScheduledShiftsRange(dateFrom, dateTo, {
      sedeCodigo: sedeCode,
      contratoCodigo: currentContractCode() || group.contratoCodigo || null,
      estados: ['programado', 'abierto']
    }) || [];
    const otherShiftIds = otherShifts
      .map((row) => String(row.id || '').trim())
      .filter((id) => id && !targetIds.has(id));
    if (!otherShiftIds.length) return { ids: new Set(), docs: new Set() };
    const assignments = await deps.listShiftAssignmentsForShifts(otherShiftIds) || [];
    return employeeRefsFromAssignments(assignments.filter((row) => String(row.estado || 'asignado') !== 'cancelado'));
  }

  function employeeRefsFromAssignments(assignments = []) {
    const ids = new Set();
    const docs = new Set();
    (assignments || []).forEach((row) => {
      const employeeId = String(row.employeeId || '').trim();
      const documento = String(row.documento || '').trim();
      if (employeeId) ids.add(employeeId);
      if (documento) docs.add(documento);
    });
    return { ids, docs };
  }

  function employeeInRefSet(employee = {}, refs = {}) {
    const id = String(employee.id || '').trim();
    const doc = String(employee.documento || '').trim();
    return Boolean((id && refs.ids?.has(id)) || (doc && refs.docs?.has(doc)));
  }

  function updateLocalAssignmentCounts(targetRows = [], count = 0) {
    scheduledShiftAssignmentCounts = new Map(scheduledShiftAssignmentCounts);
    targetRows.forEach((row) => {
      const id = String(row?.id || '').trim();
      if (id) scheduledShiftAssignmentCounts.set(id, Math.max(0, Number(count || 0)));
    });
  }

  function commonAssignedEmployeeIds(assignments = [], shifts = []) {
    const shiftIds = shifts.map((row) => String(row.id || '')).filter(Boolean);
    if (!shiftIds.length) return [];
    const byShift = new Map(shiftIds.map((id) => [id, new Set()]));
    (assignments || []).forEach((row) => {
      const shiftId = String(row.scheduledShiftId || '');
      const employeeId = String(row.employeeId || '');
      if (!shiftId || !employeeId || !byShift.has(shiftId)) return;
      byShift.get(shiftId).add(employeeId);
    });
    const commonSet = Array.from(byShift.values()).reduce((common, set, idx) => {
      if (idx === 0) return new Set(set);
      return new Set(Array.from(common).filter((id) => set.has(id)));
    }, new Set());
    return Array.from(commonSet);
  }

  async function findAssignmentOverlap(targetRows = [], selectedEmployees = []) {
    if (!targetRows.length || !selectedEmployees.length || typeof deps.listScheduledShiftsRange !== 'function') return [];
    const dateFrom = targetRows.reduce((min, row) => !min || row.fechaOperativa < min ? row.fechaOperativa : min, '');
    const dateTo = targetRows.reduce((max, row) => !max || row.fechaOperativa > max ? row.fechaOperativa : max, '');
    if (typeof deps.listShiftAssignmentOverlapCandidates === 'function') {
      const candidates = await deps.listShiftAssignmentOverlapCandidates({
        dateFrom,
        dateTo,
        contratoCodigo: currentContractCode(),
        employeeIds: selectedEmployees.map((emp) => emp.id).filter(Boolean),
        documentos: selectedEmployees.map((emp) => emp.documento).filter(Boolean),
        excludeShiftIds: targetRows.map((row) => row.id).filter(Boolean)
      }) || [];
      const conflicts = [];
      candidates.forEach(({ assignment, shift }) => {
        const employee = selectedEmployees.find((emp) => String(emp.id || '') === String(assignment?.employeeId || '') || String(emp.documento || '') === String(assignment?.documento || ''));
        if (!employee || !shift) return;
        const hasOverlap = targetRows.some((target) => intervalsOverlap(target.startsAt, target.endsAt, shift.startsAt, shift.endsAt));
        if (!hasOverlap) return;
        conflicts.push(`${employee.nombre || assignment.nombre || '-'} con ${sedeLabel(shift.sedeCodigo, shift.sedeNombre)} ${shift.fechaOperativa || ''} ${shiftTimeLabel(shift)}`);
      });
      return [...new Set(conflicts)];
    }
    const allShifts = await deps.listScheduledShiftsRange(dateFrom, dateTo, { contratoCodigo: currentContractCode(), estados: ['programado', 'abierto'] }) || [];
    const targetIds = new Set(targetRows.map((row) => String(row.id || '')).filter(Boolean));
    const otherShifts = allShifts.filter((row) => row.id && !targetIds.has(String(row.id)));
    if (!otherShifts.length) return [];
    const otherAssignments = await deps.listShiftAssignmentsForShifts?.(otherShifts.map((row) => row.id)) || [];
    const selectedIds = new Set(selectedEmployees.map((emp) => String(emp.id || '')).filter(Boolean));
    const selectedDocs = new Set(selectedEmployees.map((emp) => String(emp.documento || '')).filter(Boolean));
    const assignedOtherShiftIds = new Set(otherAssignments
      .filter((row) => String(row.estado || 'asignado') !== 'cancelado')
      .filter((row) => selectedIds.has(String(row.employeeId || '')) || selectedDocs.has(String(row.documento || '')))
      .map((row) => String(row.scheduledShiftId || ''))
      .filter(Boolean));
    if (!assignedOtherShiftIds.size) return [];
    const otherById = new Map(otherShifts.map((row) => [String(row.id || ''), row]));
    const conflicts = [];
    otherAssignments.forEach((assignment) => {
      const other = otherById.get(String(assignment.scheduledShiftId || ''));
      if (!other || !assignedOtherShiftIds.has(String(other.id || ''))) return;
      const employee = selectedEmployees.find((emp) => String(emp.id || '') === String(assignment.employeeId || '') || String(emp.documento || '') === String(assignment.documento || ''));
      if (!employee) return;
      const hasOverlap = targetRows.some((target) => intervalsOverlap(target.startsAt, target.endsAt, other.startsAt, other.endsAt));
      if (!hasOverlap) return;
      conflicts.push(`${employee.nombre || assignment.nombre || '-'} con ${sedeLabel(other.sedeCodigo, other.sedeNombre)} ${other.fechaOperativa || ''} ${shiftTimeLabel(other)}`);
    });
    return [...new Set(conflicts)];
  }

  function intervalsOverlap(startA, endA, startB, endB) {
    const a1 = new Date(startA).getTime();
    const a2 = new Date(endA).getTime();
    const b1 = new Date(startB).getTime();
    const b2 = new Date(endB).getTime();
    if ([a1, a2, b1, b2].some((value) => Number.isNaN(value))) return false;
    return a1 < b2 && b1 < a2;
  }

  function planActions(row) {
    const actions = el('div', { className: 'row-actions' }, [
      el('button', { className: 'btn btn--icon', type: 'button', disabled: !canEdit, title: 'Editar plan', 'aria-label': 'Editar plan' }, [editIcon()]),
      el('button', { className: 'btn btn--icon btn--danger', type: 'button', disabled: !canEdit, title: 'Eliminar plan', 'aria-label': 'Eliminar plan' }, [deactivateIcon()]),
      el('button', { className: 'btn btn--icon', type: 'button', title: 'Ver informacion', 'aria-label': 'Ver informacion' }, [infoIcon()])
    ]);
    actions.children[0].addEventListener('click', (ev) => {
      ev.stopPropagation();
      openPlanModal(row);
    });
    actions.children[1].addEventListener('click', (ev) => {
      ev.stopPropagation();
      deletePlan(row);
    });
    actions.children[2].addEventListener('click', (ev) => {
      ev.stopPropagation();
      openPlanInfoModal(row);
    });
    return actions;
  }

  async function openPlanInfoModal(plan) {
    if (!plan?.id) return;
    try {
      const [rules, activeAssignments] = await Promise.all([
        deps.listShiftTemplateRules?.(plan.id, { includeInactive: true }) || [],
        typeof deps.listShiftSitePlanAssignments === 'function'
          ? deps.listShiftSitePlanAssignments({ includeInactive: false, templateId: plan.id, contratoCodigo: currentContractCode() }).catch(() => [])
          : []
      ]);
      showInfoModal(`Informacion del plan - ${plan.nombre || '-'}`, [
        planInfoContent(plan, rules || [], activeAssignments || [])
      ]);
    } catch (error) {
      notify('No se pudo cargar la informacion del plan: ' + (error?.message || error), 'error');
    }
  }

  function planInfoContent(plan = {}, rules = [], activeAssignments = []) {
    const activeRules = (rules || []).filter((row) => String(row.estado || 'activo') !== 'inactivo');
    const inactiveRules = Math.max(0, (rules || []).length - activeRules.length);
    const audit = planAuditInfo(plan);
    return el('div', { className: 'employee-detail' }, [
      detailSection('Datos generales', [
        ['Evento', audit.action],
        ['Usuario', audit.user],
        ['Fecha', audit.date],
        ['Nombre', plan.nombre],
        ['Estado', estadoBadge(plan.estado || 'activo')],
        ['Horarios activos', String(activeRules.length)],
        ['Horarios inactivos', String(inactiveRules)],
        ['Notas', plan.notasProgramacion],
        ['Creado por', plan.createdByEmail || plan.createdByUid],
        ['Creado', formatDateTime(plan.createdAt)],
        ['Actualizado', formatDateTime(plan.updatedAt)]
      ]),
      detailSection('Contrato y cliente', [
        ['Contrato', plan.contratoNombre || plan.contratoCodigo || 'Sin contrato asignado'],
        ['Codigo contrato', plan.contratoCodigo],
        ['Cliente', plan.clienteNombreSnapshot],
        ['NIT cliente', plan.clienteNitSnapshot]
      ]),
      detailSection('Horarios', activeRules.length ? activeRules.map((rule) => [
        ruleTitle(rule),
        ruleSummary(rule)
      ]) : [['Horarios', 'Sin horarios activos']]),
      detailSection('Sedes activas', activeAssignments.length ? activeAssignments.map((assignment) => [
        sedeLabel(assignment.sedeCodigo, assignment.sedeNombre),
        `${assignment.operariosPlaneados ?? 0} empleados`
      ]) : [['Sedes', 'Sin sedes activas']])
    ]);
  }

  function generatedPlanInfoContent(group = {}, plan = {}, rules = []) {
    const activeRules = (rules || []).filter((row) => String(row.estado || 'activo') !== 'inactivo');
    const inactiveRules = Math.max(0, (rules || []).length - activeRules.length);
    const assignment = group.assignment || {};
    const summary = assignmentSummary(group);
    return el('div', { className: 'employee-detail' }, [
      detailSection('Datos generales', [
        ['Sede', sedeLabel(group.sedeCodigo, group.sedeNombre)],
        ['Plan', planLabel(group.templateId, plan.nombre || group.nombre)],
        ['Estado', estadoBadge(assignment.estado || group.estado || 'activo')],
        ['Empleados', String(group.operariosPlaneados ?? 0)],
        ['Asignacion', `${summary.label} - ${summary.detail}`],
        ['Turnos futuros', String(group.count || 0)],
        ['Activado', formatDateTime(assignment.activatedAt)],
        ['Creado por', assignment.createdByEmail || assignment.createdByUid],
        ['Creado', formatDateTime(assignment.createdAt)],
        ['Actualizado', formatDateTime(assignment.updatedAt)]
      ]),
      detailSection('Informacion del plan', [
        ['Nombre', plan.nombre || group.nombre],
        ['Estado del plan', estadoBadge(plan.estado || 'activo')],
        ['Horarios activos', String(activeRules.length)],
        ['Horarios inactivos', String(inactiveRules)],
        ['Notas', plan.notasProgramacion]
      ]),
      detailSection('Horarios del plan', activeRules.length ? activeRules.map((rule) => [
        ruleTitle(rule),
        ruleSummary(rule)
      ]) : [['Horarios', 'Sin horarios activos']])
    ]);
  }

  function planAuditInfo(plan = {}) {
    const createdAt = plan.createdAt ? new Date(plan.createdAt).getTime() : 0;
    const updatedAt = plan.updatedAt ? new Date(plan.updatedAt).getTime() : 0;
    const hasUpdate = updatedAt && createdAt && Math.abs(updatedAt - createdAt) > 1000;
    return {
      action: hasUpdate ? 'Ultima modificacion' : 'Creacion',
      user: plan.createdByEmail || plan.createdByUid || '-',
      date: formatDateTime(hasUpdate ? plan.updatedAt : plan.createdAt)
    };
  }

  function detailSection(title, items = []) {
    return el('section', { className: 'employee-detail__section' }, [
      el('h4', { className: 'employee-detail__heading' }, [title]),
      el('dl', { className: 'employee-detail__grid' }, items.map(([label, value]) => el('div', { className: 'employee-detail__item' }, [
        el('dt', {}, [label]),
        el('dd', {}, [detailValue(value)])
      ])))
    ]);
  }

  function detailValue(value) {
    if (value?.nodeType) return value;
    const text = String(value ?? '').trim();
    return text || '-';
  }

  function formatDateTime(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return new Intl.DateTimeFormat('es-CO', {
      timeZone: 'America/Bogota',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(date);
  }

  function ruleTitle(rule = {}) {
    if (rule.tipoDia === 'festivo') return 'Festivo';
    return DAY_OPTIONS.find((day) => day.value === String(rule.diaSemana || ''))?.label || 'Dia';
  }

  function ruleNetLabel(rule = {}) {
    if (rule.almuerzoMinutos === undefined) return '';
    const net = netRuleMinutes(rule.horaInicio, rule.horaFin, rule.cruzaDia, rule.almuerzoMinutos);
    return net === null ? '' : `${formatHours(net)} netas (almuerzo ${rule.almuerzoMinutos} min)`;
  }

  function ruleSummary(rule = {}) {
    const pieces = [
      `${String(rule.horaInicio || '').slice(0, 5) || '--:--'} - ${String(rule.horaFin || '').slice(0, 5) || '--:--'}${rule.cruzaDia ? ' (+1)' : ''}`,
      ruleNetLabel(rule),
      recurrenceLabel(rule),
      `Entrada -${rule.ventanaEntradaAntesMinutos ?? 0}/+${rule.ventanaEntradaDespuesMinutos ?? 0} min`,
      `Salida -${rule.ventanaSalidaAntesMinutos ?? 0}/+${rule.ventanaSalidaDespuesMinutos ?? 0} min`,
      `Novedades ${rule.ventanaNovedadHoras ?? 0} h`
    ];
    if (rule.nombre) pieces.unshift(rule.nombre);
    return pieces.filter(Boolean).join(' | ');
  }

  function recurrenceLabel(rule = {}) {
    const type = String(rule.frecuenciaTipo || 'todos');
    if (rule.tipoDia === 'festivo') return 'Festivos';
    if (type === 'cada_n_semanas') return `Cada ${rule.frecuenciaSemanas || 1} semanas desde ${rule.fechaAncla || '-'}`;
    if (type === 'mensual') {
      const label = MONTH_WEEK_OPTIONS.find((item) => String(item.value) === String(rule.semanaMes))?.label || 'Semana';
      return `${label} del mes`;
    }
    return 'Siempre';
  }

  function planRow(row) {
    const count = ruleCounts.get(row.id);

    const tr = el('tr', {}, [
      el('td', {}, [row.nombre || '-']),
      el('td', {}, [count == null ? '-' : String(count)]),
      el('td', {}, [estadoBadge(row.estado || 'activo')]),
      el('td', {}, [planActions(row)])
    ]);
    tr.addEventListener('dblclick', () => openPlanModal(row));
    return tr;
  }

  function planCard(row) {
    const count = ruleCounts.get(row.id);
    return el('article', { className: 'record-card shift-plan-card' }, [
      el('div', { className: 'record-card__header' }, [
        el('div', { className: 'record-card__identity' }, [
          el('strong', { className: 'record-card__title' }, [row.nombre || '-']),
          el('span', { className: 'record-card__subtitle' }, [row.notasProgramacion || 'Plan de turnos'])
        ]),
        estadoBadge(row.estado || 'activo')
      ]),
      el('dl', { className: 'record-card__meta' }, [
        el('div', { className: 'record-card__meta-item' }, [
          el('dt', {}, ['Horarios']),
          el('dd', {}, [count == null ? '-' : String(count)])
        ])
      ]),
      el('div', { className: 'record-card__actions' }, [planActions(row)])
    ]);
  }

  async function openGenerateShiftsModal() {
    if (!canGenerate) return;
    const activePlans = templates
      .filter((row) => String(row.estado || 'activo') !== 'inactivo')
      .filter((row) => !currentContractCode() || !row.contratoCodigo || contractMatches(row))
      .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')));
    const activeSedes = visibleSedes()
      .filter((sede) => String(sede.estado || 'activo') !== 'inactivo')
      .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')));
    let activeAssignments = [];
    try {
      activeAssignments = await deps.listShiftSitePlanAssignments?.({ includeInactive: false, contratoCodigo: currentContractCode() }) || [];
    } catch (error) {
      notify('Ejecuta primero el SQL actualizado de turnos para activar planes por sede.', 'error');
      return;
    }

    const modal = await showGenerateShiftsModal({ activePlans, activeSedes, activeAssignments });
    if (!modal.confirmed) return;
    try {
      const sedeCodigos = Array.isArray(modal.values.sedeCodigos) ? modal.values.sedeCodigos : [];
      if (!sedeCodigos.length) {
        notify('Selecciona al menos una sede.', 'warning');
        return;
      }
      const result = await deps.activateShiftPlanForSites?.({
        templateId: modal.values.templateId || null,
        sedeCodigos,
        sedeOperarios: modal.values.sedeOperarios || {},
        contratoCodigo: currentContractCode() || null
      });
      await deps.addAuditLog?.({
        targetType: 'shift_site_plan_assignment',
        targetId: null,
        action: 'activate_shift_plan_for_sites',
        after: { templateId: modal.values.templateId || null, sedeCodigos, sedeOperarios: modal.values.sedeOperarios || {}, horizonDays: SHIFT_GENERATION_DAYS, result }
      });
      const generation = result?.generation || {};
      notify(`Plan activado. Turnos generados: ${generation.created || 0}. Ya existentes: ${generation.skippedExisting || 0}.`, 'success');
      saveGeneratedFilters({
        templateId: modal.values.templateId || '',
        sedeCodigo: sedeCodigos.length === 1 ? sedeCodigos[0] : ''
      });
      navigate('/turnos-generados');
    } catch (error) {
      notify('Error: ' + (error?.message || error), 'error');
    }
  }

  function showGenerateShiftsModal({ activePlans = [], activeSedes = [], activeAssignments = [] } = {}) {
    return new Promise((resolve) => {
      const activeBySede = new Map();
      (activeAssignments || []).forEach((row) => {
        const code = String(row.sedeCodigo || '').trim();
        if (!code) return;
        if (!activeBySede.has(code)) activeBySede.set(code, []);
        activeBySede.get(code).push(row);
      });
      const overlay = el('div', { className: 'action-modal__overlay' }, []);
      const dialog = el('div', {
        className: 'action-modal shift-generate-modal',
        role: 'dialog',
        'aria-modal': 'true'
      }, []);
      const header = el('div', { className: 'action-modal__header' }, [
        el('h3', { className: 'action-modal__title' }, ['Activar plan en sedes']),
        el('button', { className: 'btn action-modal__close', type: 'button', 'aria-label': 'Cerrar' }, ['x'])
      ]);
      const body = el('div', { className: 'action-modal__body' }, [
        el('p', { className: 'action-modal__message' }, [`Selecciona un plan y las sedes donde quedara activo. Se generan los proximos ${SHIFT_GENERATION_DAYS} dias desde manana. La programacion avanza automaticamente y conserva el ciclo de las rotaciones.`]),
        el('div', { className: 'form-row' }, [
          field('Plan', el('select', { className: 'select', 'data-generate-field': 'templateId' }, optionNodes([
            { value: '', label: 'Selecciona un plan' },
            ...activePlans.map((row) => ({ value: row.id, label: row.nombre || '-' }))
          ])))
        ]),
        el('div', { className: 'shift-generate-sites mt-2' }, [
          el('strong', { className: 'shift-section-title' }, ['Sedes y empleados']),
          el('div', { className: 'shift-generate-sites__list mt-1' }, activeSedes.length ? activeSedes.map((sede) => generateSiteRow(sede, activeBySede.get(String(sede.codigo || '').trim()) || [])) : [
            el('p', { className: 'text-muted shift-rules-empty' }, ['No hay sedes activas disponibles.'])
          ])
        ])
      ]);
      const footer = el('div', { className: 'action-modal__footer' }, [
        el('button', { className: 'btn', type: 'button' }, ['Cancelar']),
        el('button', { className: 'btn btn--primary', type: 'button' }, ['Activar'])
      ]);

      function finish(out) {
        document.removeEventListener('keydown', onEsc);
        overlay.remove();
        resolve(out);
      }

      function readValues() {
        const selectedRows = Array.from(body.querySelectorAll('[data-sede-row]')).filter((row) => row.querySelector('[data-sede-check]')?.checked);
        const sedeCodigos = [];
        const sedeOperarios = {};
        selectedRows.forEach((row) => {
          const code = String(row.getAttribute('data-sede-row') || '').trim();
          const raw = row.querySelector('[data-sede-operarios]')?.value ?? '0';
          const value = Number(raw);
          if (!code) return;
          sedeCodigos.push(code);
          sedeOperarios[code] = value;
        });
        return {
          templateId: String(body.querySelector('[data-generate-field="templateId"]')?.value || '').trim(),
          sedeCodigos,
          sedeOperarios
        };
      }

      function confirm() {
        const values = readValues();
        if (!values.templateId) {
          notify('Selecciona un plan.', 'warning');
          return;
        }
        if (!values.sedeCodigos.length) {
          notify('Selecciona al menos una sede.', 'warning');
          return;
        }
        try {
          for (const code of values.sedeCodigos) {
            validateShiftPlanCapacity(activeSedes.find(sede => sede.codigo === code), activeAssignments, values.templateId, values.sedeOperarios[code]);
          }
        } catch (error) {
          notify(error.message, 'warning');
          return;
        }
        finish({ confirmed: true, values });
      }

      function refreshAvailableEmployees() {
        const templateId = String(body.querySelector('[data-generate-field="templateId"]')?.value || '').trim();
        Array.from(body.querySelectorAll('[data-sede-row]')).forEach(row => {
          const code = row.getAttribute('data-sede-row');
          const assignments = activeBySede.get(code) || [];
          const capacity = shiftPlanCapacity(activeSedes.find(sede => sede.codigo === code), assignments, templateId);
          const input = row.querySelector('[data-sede-operarios]');
          const selected = row.querySelector('[data-sede-check]').checked;
          const current = assignments.find(item => item.templateId === templateId);
          // Unchecking a site does not deactivate its existing plan.
          const requested = selected ? Number(input.value || 0) : Number(current?.operariosPlaneados || 0);
          const remaining = capacity.available - Math.max(0, Number.isFinite(requested) ? requested : 0);
          input.max = String(capacity.available);
          row.querySelector('[data-sede-capacity]').textContent = remaining < 0
            ? `Disponibles: 0 · Excede por ${Math.abs(remaining)}`
            : `Disponibles: ${remaining}`;
        });
      }

      function applyPlanSelection() {
        const templateId = String(body.querySelector('[data-generate-field="templateId"]')?.value || '').trim();
        Array.from(body.querySelectorAll('[data-sede-row]')).forEach((row) => {
          const code = String(row.getAttribute('data-sede-row') || '').trim();
          const assignments = activeBySede.get(code) || [];
          const check = row.querySelector('[data-sede-check]');
          const input = row.querySelector('[data-sede-operarios]');
          if (!check || !input) return;
          const samePlan = assignments.find((item) => templateId && String(item?.templateId || '') === templateId) || null;
          if (!samePlan) {
            check.checked = false;
            input.disabled = true;
            input.value = '0';
            return;
          }
          check.checked = true;
          input.disabled = false;
          input.value = String(samePlan.operariosPlaneados ?? 0);
        });
        refreshAvailableEmployees();
      }

      function cancel() {
        finish({ confirmed: false, values: {} });
      }

      function onEsc(ev) {
        if (ev.key === 'Escape') cancel();
      }

      footer.children[0].addEventListener('click', cancel);
      footer.children[1].addEventListener('click', confirm);
      header.querySelector('.action-modal__close')?.addEventListener('click', cancel);
      body.querySelector('[data-generate-field="templateId"]')?.addEventListener('change', applyPlanSelection);
      body.addEventListener('input', refreshAvailableEmployees);
      body.addEventListener('change', refreshAvailableEmployees);
      applyPlanSelection();
      document.addEventListener('keydown', onEsc);
      dialog.append(header, body, footer);
      overlay.append(dialog);
      document.body.append(overlay);
    });
  }

  function generateSiteRow(sede, activeAssignments = []) {
    const code = String(sede.codigo || '').trim();
    const input = el('input', { className: 'input', type: 'number', min: '0', step: '1', value: '0', 'data-sede-operarios': code, disabled: true });
    const check = el('input', { type: 'checkbox', 'data-sede-check': code });
    check.addEventListener('change', () => {
      input.disabled = !check.checked;
      if (check.checked) input.focus();
    });
    const activeLabels = (activeAssignments || [])
      .map((assignment) => planLabel(assignment.templateId, 'Plan activo'))
      .filter(Boolean);
    const currentPlan = activeLabels.length ? `Activos: ${activeLabels.join(', ')}` : 'Sin planes activos';
    return el('div', { className: 'shift-generate-site-row', 'data-sede-row': code }, [
      el('label', { className: 'shift-generate-site-row__name' }, [
        el('span', { className: 'shift-generate-site-row__check' }, [check]),
        el('span', {}, [
          sedeLabel(code, sede.nombre),
          el('small', { className: 'text-muted', style: 'display:block;font-weight:500;margin-top:.15rem;' }, [currentPlan])
        ])
      ]),
      el('label', { className: 'shift-generate-site-row__field' }, [
        el('span', { style: 'display:flex;align-items:center;justify-content:space-between;gap:.75rem;flex-wrap:wrap;' }, [
          'Empleados',
          el('small', { className: 'text-muted', 'data-sede-capacity': '', 'aria-live': 'polite' }, [])
        ]),
        input
      ])
    ]);
  }

  async function refreshRuleCounts() {
    if (isGeneratedScreen || isReviewScreen || !deps.listShiftTemplateRuleCounts) return;
    const revision = ++ruleRevision;
    const ids = templates.filter(row => !row.contratoCodigo || contractMatches(row)).map((row) => row.id).filter(Boolean);
    let entries;
    try {
      entries = (await deps.listShiftTemplateRuleCounts(ids)).map(row => [row.templateId, row.count]);
    } catch (_) {
      entries = ids.map(id => [id, null]);
    }
    if (disposed || revision !== ruleRevision) return;
    ruleCounts = new Map(entries);
    render();
  }

  async function openPlanModal(template = null) {
    if (!canEdit) return;
    const isNew = !template?.id;
    const basePlan = {
      id: template?.id || null,
      nombre: template?.nombre || '',
      notasProgramacion: template?.notasProgramacion || '',
      estado: template?.estado || 'activo',
      orden: template?.orden || nextPlanOrder()
    };
    const originalPlan = { ...basePlan };
    const initialRuleSnapshots = new Map();
    let modalRules = isNew
      ? []
      : (await deps.listShiftTemplateRules?.(template.id, { includeInactive: true }) || [])
        .filter((row) => row.estado !== 'inactivo')
        .map((row) => ({ ...row, _localId: row.id || `row-${nextLocalId++}` }));
    const controlSource = modalRules[0] || blankRule([], 'dia_semana', '1');
    const planControls = { ventanaNovedadHoras: controlSource.ventanaNovedadHoras ?? DEFAULT_NOVELTY_WINDOW_HOURS };
    for (const [side, fallback] of [
      ['EntradaAntes', DEFAULT_WINDOW_ENTRY_BEFORE_MINUTES],
      ['EntradaDespues', DEFAULT_WINDOW_ENTRY_AFTER_MINUTES],
      ['SalidaAntes', DEFAULT_WINDOW_EXIT_BEFORE_MINUTES],
      ['SalidaDespues', DEFAULT_WINDOW_EXIT_AFTER_MINUTES]
    ]) {
      planControls[`ventana${side}Minutos`] = controlSource[`ventana${side}Minutos`] ?? fallback;
      planControls[`alerta${side}Minutos`] = controlSource[`alerta${side}Minutos`] ?? DEFAULT_ALERT_MINUTES;
    }
    const hasDifferentControls = modalRules.some(row => Object.entries(planControls).some(([name, value]) =>
      Number(row[name] ?? (name.startsWith('alerta') ? row[name.replace('alerta', 'ventana')] : value)) !== Number(value)
    ));
    let removedRuleIds = new Set();
    let dirty = false;
    let confirmingClose = false;
    let saving = false;

    const overlay = el('div', { className: 'action-modal__overlay' }, []);
    const dialog = el('div', {
      className: 'action-modal shift-plan-modal',
      role: 'dialog',
      'aria-modal': 'true'
    }, []);
    const header = el('div', { className: 'action-modal__header' }, [
      el('h3', { className: 'action-modal__title' }, [isNew ? 'Crear plan de turnos' : 'Editar plan de turnos']),
      el('button', { className: 'btn action-modal__close', type: 'button', 'aria-label': 'Cerrar' }, ['x'])
    ]);
    const body = el('div', { className: 'action-modal__body' }, []);
    const footer = el('div', { className: 'action-modal__footer' }, [
      el('button', { className: 'btn', type: 'button' }, ['Cancelar']),
      el('button', { className: 'btn btn--primary', type: 'button' }, [isNew ? 'Crear plan' : 'Guardar cambios'])
    ]);
    const btnCancel = footer.children[0];
    const btnSave = footer.children[1];
    const btnClose = header.querySelector('.action-modal__close');

    function setModalSaving(isSaving) {
      saving = isSaving === true;
      btnSave.disabled = saving;
      btnCancel.disabled = saving;
      if (btnClose) btnClose.disabled = saving;
      btnSave.textContent = saving ? 'Guardando...' : (isNew ? 'Crear plan' : 'Guardar cambios');
    }

    function renderModalBody() {
      const visibleRows = modalRules.filter((row) => row.estado !== 'inactivo');
      body.replaceChildren(
        el('div', { className: 'form-row' }, [
          field('Nombre del plan', el('input', { className: 'input', value: basePlan.nombre || '', 'data-plan-field': 'nombre', required: true })),
          field('Estado', el('select', { className: 'select', 'data-plan-field': 'estado' }, optionNodes([
            { value: 'activo', label: 'Activo' },
            { value: 'inactivo', label: 'Inactivo' }
          ], basePlan.estado || 'activo')))
        ]),
        field('Notas', el('textarea', { className: 'input', rows: 2, 'data-plan-field': 'notasProgramacion' }, [basePlan.notasProgramacion || ''])),
        sectionHeader('Control de horario del plan'),
        el('p', { className: 'text-muted' }, ['Esta configuración aplica a todos los días y horarios del plan, incluidos los festivos.']),
        ...(hasDifferentControls ? [el('p', { className: 'text-muted' }, ['Este plan tenía controles diferentes por día. Se muestran los del primer horario; al guardar, los valores elegidos se aplicarán a todos.'])] : []),
        scheduleControlSections(),
        sectionHeader('Horarios del plan', [
          actionButton('Agregar horario', () => addRule('dia_semana', '1', false)),
          actionButton('Agregar lunes-viernes', openWeekdayBatchModal)
        ]),
        rulesTable(visibleRows)
      );
      attachModalInputListeners();
      body.querySelectorAll('[data-remove-rule]').forEach((btn) => {
        btn.addEventListener('click', () => removeRule(btn.getAttribute('data-remove-rule')));
      });
    }

    function sectionHeader(title, buttons = []) {
      return el('div', { className: 'shift-section-header mt-2' }, [
        el('strong', { className: 'shift-section-title' }, [title]),
        el('div', { className: 'shift-section-actions' }, buttons)
      ]);
    }

    function actionButton(label, onClick) {
      const btn = el('button', { className: 'btn', type: 'button' }, [label]);
      btn.addEventListener('click', async () => {
        readModalDraft();
        const changed = await onClick();
        if (changed === false) return;
        dirty = true;
        renderModalBody();
      });
      return btn;
    }

    function openWeekdayBatchModal() {
      const draft = {
        nombre: '',
        horaInicio: '',
        horaFin: '',
        cruzaDia: false,
        almuerzoMinutos: DEFAULT_LUNCH_MINUTES,
        frecuenciaTipo: 'todos',
        frecuenciaSemanas: 2,
        fechaAncla: todayBogota(),
        semanaMes: 1,
        festivoModo: 'excluir',
      };

      return new Promise((resolve) => {
        let batchApplied = false;
        const batchOverlay = el('div', { className: 'action-modal__overlay shift-weekday-overlay' }, []);
        const batchDialog = el('div', { className: 'action-modal shift-weekday-modal', role: 'dialog', 'aria-modal': 'true' }, []);
        const batchHeader = el('div', { className: 'action-modal__header' }, [
          el('h3', { className: 'action-modal__title' }, ['Agregar lunes-viernes']),
          el('button', { className: 'btn action-modal__close', type: 'button', 'aria-label': 'Cerrar' }, ['x'])
        ]);
        const batchBody = el('div', { className: 'action-modal__body' }, []);
        const batchFooter = el('div', { className: 'action-modal__footer' }, [
          el('button', { className: 'btn', type: 'button' }, ['Cancelar']),
          el('button', { className: 'btn btn--primary', type: 'button' }, ['Agregar 5 horarios'])
        ]);
        const btnBatchCancel = batchFooter.children[0];
        const btnBatchApply = batchFooter.children[1];
        const btnBatchClose = batchHeader.querySelector('.action-modal__close');

        function batchField(label, node) {
          return el('label', { className: 'shift-rule-control' }, [
            el('span', {}, [label]),
            node
          ]);
        }

        function batchInput(fieldName, attrs = {}) {
          return el('input', { className: 'input', 'data-weekday-field': fieldName, ...attrs });
        }

        function batchSelect(fieldName, value, options = []) {
          return el('select', { className: 'select', 'data-weekday-field': fieldName }, optionNodes(options, value));
        }

        function readBatchDraft() {
          const get = (fieldName) => batchDialog.querySelector(`[data-weekday-field="${fieldName}"]`)?.value ?? '';
          draft.nombre = String(get('nombre') || '').trim();
          draft.horaInicio = get('horaInicio');
          draft.horaFin = get('horaFin');
          draft.cruzaDia = get('cruzaDia') === 'true';
          if (lunchSupported) draft.almuerzoMinutos = Math.min(240, Math.max(0, Math.round(Number(get('almuerzoMinutos')) || 0)));
          draft.frecuenciaTipo = get('frecuenciaTipo') || 'todos';
          draft.frecuenciaSemanas = Math.max(1, Number(get('frecuenciaSemanas') || 1));
          draft.fechaAncla = get('fechaAncla') || null;
          draft.semanaMes = Number(get('semanaMes') || 1);
          draft.festivoModo = get('festivoModo') || 'excluir';
        }

        function renderBatchBody() {
          batchBody.replaceChildren(
            el('p', { className: 'action-modal__message' }, ['Captura los datos una sola vez. Se crearan horarios iguales para lunes, martes, miercoles, jueves y viernes.']),
            el('div', { className: 'shift-weekday-grid' }, [
              el('div', { className: 'shift-rule-group' }, [
                el('h4', { className: 'shift-rule-group__title' }, ['Horario']),
                batchField('Nombre opcional', batchInput('nombre', { placeholder: 'Nombre opcional', value: draft.nombre || '' })),
                batchField('Inicio', batchInput('horaInicio', { type: 'time', value: draft.horaInicio || '' })),
                batchField('Fin', batchInput('horaFin', { type: 'time', value: draft.horaFin || '' })),
                batchField('Cruce de dia', batchSelect('cruzaDia', draft.cruzaDia ? 'true' : 'false', [
                  { value: 'false', label: 'Mismo dia' },
                  { value: 'true', label: 'Pasa al dia siguiente' }
                ])),
                ...(lunchSupported ? [batchField('Almuerzo (min)', batchInput('almuerzoMinutos', { type: 'number', min: '0', max: '240', step: '5', value: String(draft.almuerzoMinutos ?? DEFAULT_LUNCH_MINUTES) }))] : [])
              ]),
              el('div', { className: 'shift-rule-group' }, [
                el('h4', { className: 'shift-rule-group__title' }, ['Repeticion']),
                batchField('Repeticion', batchSelect('frecuenciaTipo', draft.frecuenciaTipo || 'todos', FREQUENCY_OPTIONS)),
                ...(draft.frecuenciaTipo === 'cada_n_semanas' ? [
                  batchField('Cada cuantas semanas', batchInput('frecuenciaSemanas', { type: 'number', min: '2', step: '1', value: String(draft.frecuenciaSemanas || 2) })),
                  batchField('Fecha de referencia', batchInput('fechaAncla', { type: 'date', value: draft.fechaAncla || todayBogota() }))
                ] : []),
                ...(draft.frecuenciaTipo === 'mensual' ? [
                  batchField('Semana del mes', batchSelect('semanaMes', draft.semanaMes == null ? '1' : String(draft.semanaMes), MONTH_WEEK_OPTIONS))
                ] : []),
                batchField('Si cae festivo', batchSelect('festivoModo', draft.festivoModo || 'excluir', HOLIDAY_MODE_OPTIONS))
              ]),

            ])
          );
          batchBody.querySelector('[data-weekday-field="frecuenciaTipo"]')?.addEventListener('change', () => {
            readBatchDraft();
            renderBatchBody();
          });
        }

        function validateBatch() {
          if (!/^\d{2}:\d{2}$/.test(String(draft.horaInicio || '')) || !/^\d{2}:\d{2}$/.test(String(draft.horaFin || ''))) {
            notify('Define la hora de inicio y fin para lunes-viernes.', 'warning');
            return false;
          }
          if (draft.frecuenciaTipo === 'cada_n_semanas' && (!draft.fechaAncla || Number(draft.frecuenciaSemanas || 0) < 2)) {
            notify('Cada N semanas necesita frecuencia mayor a 1 y fecha de referencia.', 'warning');
            return false;
          }
          if (draft.frecuenciaTipo === 'mensual' && ![-1, 1, 2, 3, 4].includes(Number(draft.semanaMes))) {
            notify('Selecciona una semana del mes valida.', 'warning');
            return false;
          }
          return true;
        }

        function applyBatch() {
          if (batchApplied) return;
          readBatchDraft();
          if (!validateBatch()) return;
          batchApplied = true;
          btnBatchApply.disabled = true;
          btnBatchCancel.disabled = true;
          if (btnBatchClose) btnBatchClose.disabled = true;
          ['1', '2', '3', '4', '5'].forEach((day) => {
            modalRules.push({
              ...blankRule(modalRules, 'dia_semana', day),
              ...planControls,
              nombre: draft.nombre || null,
              horaInicio: draft.horaInicio,
              horaFin: draft.horaFin,
              cruzaDia: draft.cruzaDia,
              ...(lunchSupported ? { almuerzoMinutos: draft.almuerzoMinutos } : {}),
              frecuenciaTipo: draft.frecuenciaTipo,
              frecuenciaSemanas: draft.frecuenciaTipo === 'cada_n_semanas' ? draft.frecuenciaSemanas : 1,
              fechaAncla: draft.frecuenciaTipo === 'cada_n_semanas' ? draft.fechaAncla : null,
              semanaMes: draft.frecuenciaTipo === 'mensual' ? draft.semanaMes : null,
              festivoModo: draft.festivoModo || 'excluir',
            });
          });
          closeBatch(true);
        }

        function closeBatch(changed = false) {
          if (batchApplied && !changed) return;
          document.removeEventListener('keydown', onBatchEsc);
          batchOverlay.remove();
          resolve(changed);
        }

        function onBatchEsc(ev) {
          if (ev.key !== 'Escape') return;
          ev.stopImmediatePropagation();
          if (batchApplied) return;
          closeBatch(false);
        }

        btnBatchCancel.addEventListener('click', () => closeBatch(false));
        btnBatchApply.addEventListener('click', applyBatch);
        btnBatchClose?.addEventListener('click', () => closeBatch(false));
        document.addEventListener('keydown', onBatchEsc);
        batchDialog.append(batchHeader, batchBody, batchFooter);
        batchOverlay.append(batchDialog);
        document.body.append(batchOverlay);
        renderBatchBody();
      });
    }

    function rulesTable(rows = []) {
      return el('div', { className: 'shift-rules-list mt-1' }, rows.length ? rows.map(ruleRow) : [
        el('p', { className: 'text-muted shift-rules-empty' }, ['Sin horarios configurados.'])
      ]);
    }

    function ruleRow(row) {
      const id = row._localId;
      const title = row.tipoDia === 'festivo'
        ? 'Festivo'
        : (DAY_OPTIONS.find((day) => day.value === String(row.diaSemana || ''))?.label || 'Horario');
      return el('section', { className: 'shift-rule-card shift-rule-row', 'data-local-id': id }, [
        el('div', { className: 'shift-rule-card__header' }, [
          el('strong', { className: 'shift-rule-card__title' }, [title]),
          el('button', { className: 'btn btn--danger', type: 'button', 'data-remove-rule': id }, ['Quitar'])
        ]),
        el('div', { className: 'shift-rule-card__grid' }, [
          el('div', { className: 'shift-rule-group' }, [
            el('h4', { className: 'shift-rule-group__title' }, ['Dia / condicion']),
            labeledControl('Dia / condicion', el('select', { className: 'select', 'data-field': 'dayCondition' }, optionNodes(DAY_CONDITION_OPTIONS, row.tipoDia === 'festivo' ? 'festivo' : (row.diaSemana || '1')))),
            labeledControl('Nombre opcional', el('input', { className: 'input', placeholder: 'Nombre opcional', value: row.nombre || '', 'data-field': 'nombre' }))
          ]),
          el('div', { className: 'shift-rule-group' }, [
            el('h4', { className: 'shift-rule-group__title' }, ['Horario']),
            labeledControl('Inicio', el('input', { className: 'input', type: 'time', value: String(row.horaInicio || '').slice(0, 5), 'data-field': 'horaInicio' })),
            labeledControl('Fin', el('input', { className: 'input', type: 'time', value: String(row.horaFin || '').slice(0, 5), 'data-field': 'horaFin' })),
            labeledControl('Cruce de dia', el('select', { className: 'select', 'data-field': 'cruzaDia' }, optionNodes([
              { value: 'false', label: 'Mismo dia' },
              { value: 'true', label: 'Pasa al dia siguiente' }
            ], row.cruzaDia ? 'true' : 'false'))),
            ...lunchControls(row)
          ]),
          el('div', { className: 'shift-rule-group' }, [
            el('h4', { className: 'shift-rule-group__title' }, ['Repeticion']),
            ...recurrenceControls(row)
          ]),

        ])
      ]);
    }

    // Almuerzo (minutos) y horas netas del horario; el estandar en Colombia es 7 h netas de lunes a sabado.
    function lunchControls(row) {
      if (!lunchSupported) return [];
      const lunch = el('input', { className: 'input', type: 'number', min: '0', max: '240', step: '5', value: String(row.almuerzoMinutos ?? DEFAULT_LUNCH_MINUTES), 'data-field': 'almuerzoMinutos' });
      const hint = el('small', { className: 'text-muted', 'data-net-hours': row._localId }, []);
      const refresh = () => {
        const card = lunch.closest?.('.shift-rule-row');
        const get = (name) => card?.querySelector(`[data-field="${name}"]`)?.value ?? '';
        const net = netRuleMinutes(get('horaInicio') || row.horaInicio, get('horaFin') || row.horaFin, (get('cruzaDia') || String(row.cruzaDia)) === 'true', lunch.value);
        const day = get('dayCondition') || row.diaSemana || '';
        const standardDay = ['1', '2', '3', '4', '5', '6'].includes(String(day));
        hint.textContent = net === null ? '' : `Horas netas: ${formatHours(net)}${standardDay && net !== STANDARD_DAILY_MINUTES ? ' (se esperan 7 h de lunes a sabado)' : ''}`;
      };
      lunch.addEventListener?.('input', refresh);
      refresh();
      return [labeledControl('Almuerzo (min)', lunch), hint];
    }

    function labeledControl(label, inputNode) {
      return el('label', { className: 'shift-rule-control' }, [
        el('span', {}, [label]),
        inputNode
      ]);
    }

    function scheduleControlSections() {
      const section = (title, description, fields) => el('fieldset', { className: 'shift-rule-control-section' }, [
        el('legend', {}, [title]),
        el('p', { className: 'text-muted' }, [description]),
        el('div', { className: 'shift-rule-inline-grid' }, fields.map(([label, name]) =>
          labeledControl(label, el('input', {
            className: 'input', type: 'number', min: '0', step: '1',
            value: String(planControls[name]), 'data-plan-control': name
          }))
        ))
      ]);
      return el('div', { className: 'shift-rule-control-sections' }, [
        section('Solo comentarios', 'Minutos desde la hora programada para solicitar un motivo.', [
          ['Entrada anticipada', 'alertaEntradaAntesMinutos'],
          ['Entrada tardía', 'alertaEntradaDespuesMinutos'],
          ['Salida anticipada', 'alertaSalidaAntesMinutos'],
          ['Salida tardía', 'alertaSalidaDespuesMinutos']
        ]),
        section('Control de ingreso y salida', 'Minutos desde la hora programada para activar también el control de horas.', [
          ['Entrada anticipada', 'ventanaEntradaAntesMinutos'],
          ['Entrada tardía', 'ventanaEntradaDespuesMinutos'],
          ['Salida anticipada', 'ventanaSalidaAntesMinutos'],
          ['Salida tardía', 'ventanaSalidaDespuesMinutos']
        ]),
        section('Novedad posterior', 'Tiempo disponible para registrar novedades, en horas.', [
          ['Plazo', 'ventanaNovedadHoras']
        ])
      ]);
    }

    function smallNumber(label, fieldName, value, attrs = {}) {
      return el('label', { className: 'shift-rule-control' }, [
        el('span', {}, [label]),
        el('input', { className: 'input', type: 'number', min: '0', step: '1', value: String(value ?? 0), 'data-field': fieldName, ...attrs })
      ]);
    }

    function smallSelect(label, fieldName, value, options = [], attrs = {}) {
      return el('label', { className: 'shift-rule-control' }, [
        el('span', {}, [label]),
        el('select', { className: 'select', 'data-field': fieldName, ...attrs }, optionNodes(options, value))
      ]);
    }

    function recurrenceControls(row) {
      if (row.tipoDia === 'festivo') {
        return [
          el('label', { className: 'shift-rule-control' }, [
            el('span', {}, ['Aplica']),
            el('input', { className: 'input', value: 'Todos los festivos', disabled: true })
          ])
        ];
      }

      const frecuenciaTipo = row.frecuenciaTipo || 'todos';
      const controls = [
        smallSelect('Repeticion', 'frecuenciaTipo', frecuenciaTipo, FREQUENCY_OPTIONS),
        smallSelect('Si cae festivo', 'festivoModo', row.festivoModo || 'excluir', HOLIDAY_MODE_OPTIONS)
      ];
      if (frecuenciaTipo === 'cada_n_semanas') {
        controls.splice(
          1,
          0,
          smallNumber('Cada cuantas semanas', 'frecuenciaSemanas', row.frecuenciaSemanas || 2, { min: '1' }),
          el('label', { className: 'shift-rule-control' }, [
            el('span', {}, ['Fecha de referencia']),
            el('input', { className: 'input', type: 'date', value: row.fechaAncla || '', 'data-field': 'fechaAncla' })
          ])
        );
      }
      if (frecuenciaTipo === 'mensual') {
        controls.splice(
          1,
          0,
          smallSelect('Semana del mes', 'semanaMes', row.semanaMes == null ? '1' : String(row.semanaMes), MONTH_WEEK_OPTIONS)
        );
      }
      return controls;
    }

    function attachModalInputListeners() {
      body.querySelectorAll('input, select, textarea').forEach((node) => {
        if (['dayCondition', 'frecuenciaTipo'].includes(node.getAttribute('data-field'))) {
          node.addEventListener('change', () => {
            dirty = true;
            readModalDraft();
            renderModalBody();
          });
          return;
        }
        node.addEventListener('input', () => { dirty = true; });
        node.addEventListener('change', () => { dirty = true; });
      });
    }

    function readModalDraft() {
      for (const name of Object.keys(planControls)) {
        const input = dialog.querySelector(`[data-plan-control="${name}"]`);
        if (input) planControls[name] = input.value === '' ? NaN : Number(input.value);
      }
      basePlan.nombre = String(qs('[data-plan-field="nombre"]', dialog)?.value || '').trim();
      basePlan.estado = String(qs('[data-plan-field="estado"]', dialog)?.value || 'activo').trim();
      basePlan.notasProgramacion = String(qs('[data-plan-field="notasProgramacion"]', dialog)?.value || '').trim();
      modalRules = Array.from(dialog.querySelectorAll('.shift-rule-row')).map((tr, idx) => {
        const localId = tr.getAttribute('data-local-id');
        const previous = modalRules.find((row) => String(row._localId) === String(localId)) || {};
        const get = (name) => tr.querySelector(`[data-field="${name}"]`)?.value ?? '';
        const dayCondition = get('dayCondition') || previous.diaSemana || '1';
        const tipoDia = dayCondition === 'festivo' ? 'festivo' : 'dia_semana';
        const frecuenciaTipo = tipoDia === 'festivo' ? 'todos' : (get('frecuenciaTipo') || 'todos');
        return {
          ...previous,
          ...planControls,
          _localId: localId,
          nombre: String(get('nombre') || '').trim() || null,
          tipoDia,
          diaSemana: tipoDia === 'festivo' ? null : dayCondition,
          horaInicio: get('horaInicio'),
          horaFin: get('horaFin'),
          cruzaDia: get('cruzaDia') === 'true',
          ...(lunchSupported ? { almuerzoMinutos: Math.min(240, Math.max(0, Math.round(Number(get('almuerzoMinutos')) || 0))) } : {}),
          frecuenciaTipo,
          frecuenciaSemanas: Math.max(1, Number(get('frecuenciaSemanas') || 1)),
          fechaAncla: get('fechaAncla') || null,
          semanaMes: frecuenciaTipo === 'mensual' ? Number(get('semanaMes') || 1) : null,
          festivoModo: tipoDia === 'festivo' ? 'normal' : (get('festivoModo') || 'excluir'),
          orden: previous.orden || idx + 1,
          estado: previous.estado || 'activo'
        };
      });
    }

    function addRule(type, day, rerender = true) {
      modalRules.push({ ...blankRule(modalRules, type, day), ...planControls });
      if (rerender) renderModalBody();
    }

    function removeRule(localId) {
      readModalDraft();
      const row = modalRules.find((item) => String(item._localId) === String(localId));
      if (row?.id) removedRuleIds.add(row.id);
      modalRules = modalRules.filter((item) => String(item._localId) !== String(localId));
      dirty = true;
      renderModalBody();
    }

    function validateDraft() {
      if (!basePlan.nombre) throw new Error('Escribe el nombre del plan.');
      if (!modalRules.length) throw new Error('Agrega al menos un horario al plan.');
      for (const side of ['EntradaAntes', 'EntradaDespues', 'SalidaAntes', 'SalidaDespues']) {
        const alert = planControls[`alerta${side}Minutos`];
        const control = planControls[`ventana${side}Minutos`];
        if (!Number.isInteger(alert) || alert < 0 || !Number.isInteger(control) || control < alert) {
          throw new Error('El umbral de comentario debe ser un entero entre cero y el umbral de control de horas.');
        }
      }
      if (!Number.isInteger(planControls.ventanaNovedadHoras) || planControls.ventanaNovedadHoras < 0) {
        throw new Error('El plazo para novedades debe ser un número entero de horas mayor o igual a cero.');
      }
      modalRules.forEach((row) => {
        if (!/^\d{2}:\d{2}$/.test(String(row.horaInicio || '')) || !/^\d{2}:\d{2}$/.test(String(row.horaFin || ''))) {
          throw new Error('Todos los horarios deben tener hora de inicio y fin.');
        }
        const netMinutes = lunchSupported ? netRuleMinutes(row.horaInicio, row.horaFin, row.cruzaDia, row.almuerzoMinutos) : 1;
        if (netMinutes === null || netMinutes <= 0) {
          throw new Error('Revisa el horario: el almuerzo no puede ser mayor o igual a la duracion del turno.');
        }
        if (row.frecuenciaTipo === 'cada_n_semanas' && (!row.fechaAncla || Number(row.frecuenciaSemanas || 0) < 2)) {
          throw new Error('Los horarios cada N semanas necesitan frecuencia mayor a 1 y fecha de referencia.');
        }
        if (row.frecuenciaTipo === 'mensual' && ![-1, 1, 2, 3, 4].includes(Number(row.semanaMes))) {
          throw new Error('Los horarios mensuales necesitan una semana del mes valida.');
        }
      });
    }

    async function saveModal() {
      if (saving) return;
      try {
        setModalSaving(true);
        readModalDraft();
        validateDraft();
        const planPayload = {
          nombre: basePlan.nombre,
          contratoCodigo: currentContractCode() || template?.contratoCodigo || null,
          contratoNombre: template?.contratoNombre || null,
          clienteNombreSnapshot: template?.clienteNombreSnapshot || null,
          clienteNitSnapshot: template?.clienteNitSnapshot || null,
          notasProgramacion: basePlan.notasProgramacion || null,
          estado: basePlan.estado || 'activo',
          orden: basePlan.orden || nextPlanOrder()
        };
        const planChanged = !basePlan.id || ['nombre', 'notasProgramacion', 'estado', 'orden']
          .some(name => basePlan[name] !== originalPlan[name]);
        const savedPlan = !basePlan.id
          ? await deps.createShiftTemplate?.(planPayload)
          : planChanged ? await deps.updateShiftTemplate?.(basePlan.id, planPayload) : template;
        const templateId = savedPlan?.id || basePlan.id;
        const changedRules = modalRules.filter(row => !row.id || hasDifferentControls || initialRuleSnapshots.get(row.id) !== JSON.stringify(row));
        const rulePayloads = changedRules.map((row) => ({
          id: row.id || null,
          templateId,
          nombre: row.nombre,
          tipoDia: row.tipoDia,
          diaSemana: row.diaSemana,
          horaInicio: row.horaInicio,
          horaFin: row.horaFin,
          cruzaDia: row.cruzaDia,
          ...(lunchSupported ? { almuerzoMinutos: row.almuerzoMinutos } : {}),
          frecuenciaTipo: row.frecuenciaTipo,
          frecuenciaSemanas: row.frecuenciaTipo === 'cada_n_semanas' ? row.frecuenciaSemanas : 1,
          fechaAncla: row.frecuenciaTipo === 'cada_n_semanas' ? row.fechaAncla : null,
          semanaMes: row.frecuenciaTipo === 'mensual' ? row.semanaMes : null,
          festivoModo: row.tipoDia === 'festivo' ? 'normal' : row.festivoModo,
          ventanaEntradaAntesMinutos: row.ventanaEntradaAntesMinutos,
          alertaEntradaAntesMinutos: row.alertaEntradaAntesMinutos,
          ventanaEntradaDespuesMinutos: row.ventanaEntradaDespuesMinutos,
          alertaEntradaDespuesMinutos: row.alertaEntradaDespuesMinutos,
          ventanaSalidaAntesMinutos: row.ventanaSalidaAntesMinutos,
          alertaSalidaAntesMinutos: row.alertaSalidaAntesMinutos,
          ventanaSalidaDespuesMinutos: row.ventanaSalidaDespuesMinutos,
          alertaSalidaDespuesMinutos: row.alertaSalidaDespuesMinutos,
          ventanaNovedadHoras: row.ventanaNovedadHoras,
          orden: row.orden,
          estado: 'activo'
        }));
        if ((rulePayloads.length || removedRuleIds.size) && typeof deps.saveShiftTemplateRules === 'function') {
          await deps.saveShiftTemplateRules({
            templateId,
            rules: rulePayloads,
            inactiveRuleIds: Array.from(removedRuleIds)
          });
        } else {
          for (const payload of rulePayloads) {
            if (payload.id) await deps.updateShiftTemplateRule?.(payload.id, payload);
            else await deps.createShiftTemplateRule?.(payload);
          }
          for (const ruleId of removedRuleIds) {
            await deps.setShiftTemplateRuleStatus?.(ruleId, 'inactivo');
          }
        }
        if (planChanged || rulePayloads.length || removedRuleIds.size) await deps.addAuditLog?.({
          targetType: 'shift_template',
          targetId: templateId,
          action: basePlan.id ? 'save_shift_plan' : 'create_shift_plan',
          before: template || null,
          after: { plan: planPayload, rules: modalRules.length, removedRules: removedRuleIds.size }
        });
        dirty = false;
        setModalSaving(false);
        await closeModal(false);
        notify(basePlan.id ? 'Plan de turnos actualizado.' : 'Plan de turnos creado.', 'success');
        // The saved draft already contains the count; avoid querying every plan.
        ruleRevision++;
        ruleCounts.set(templateId, modalRules.length);
        if (!disposed) render();
      } catch (error) {
        notify('Error: ' + (error?.message || error), 'error');
        if (overlay.isConnected) setModalSaving(false);
      }
    }

    async function confirmDiscardChanges() {
      if (!dirty) return true;
      if (confirmingClose) return false;
      confirmingClose = true;
      const modal = await showActionModal({
        title: 'Descartar cambios',
        message: 'Hay cambios sin guardar. Deseas descartarlos?',
        confirmText: 'Descartar',
        cancelText: 'Seguir editando'
      });
      confirmingClose = false;
      return modal.confirmed === true;
    }

    async function closeModal(confirmDirty = true) {
      if (saving) return false;
      if (confirmDirty && !(await confirmDiscardChanges())) return false;
      document.removeEventListener('keydown', onEsc);
      overlay.remove();
      return true;
    }

    async function onEsc(ev) {
      if (document.querySelector('.shift-weekday-modal')) return;
      if (saving) return;
      if (ev.key === 'Escape') await closeModal(true);
    }

    btnCancel.addEventListener('click', () => { closeModal(true); });
    btnSave.addEventListener('click', saveModal);
    btnClose?.addEventListener('click', () => { closeModal(true); });
    document.addEventListener('keydown', onEsc);

    renderModalBody();
    dialog.append(header, body, footer);
    overlay.append(dialog);
    document.body.append(overlay);
    // Compare normalized form values so opening an existing plan is not an edit.
    readModalDraft();
    for (const row of modalRules) if (row.id) initialRuleSnapshots.set(row.id, JSON.stringify(row));
    qs('[data-plan-field="nombre"]', dialog)?.focus();
  }

  async function deletePlan(template) {
    if (!canEdit || !template?.id) return;
    const modal = await showActionModal({
      title: 'Eliminar plan',
      message: `El plan "${template.nombre || '-'}" se desactivara. Los turnos ya generados conservaran su historico.`,
      confirmText: 'Eliminar',
      cancelText: 'Cancelar'
    });
    if (!modal.confirmed) return;
    try {
      await deps.setShiftTemplateStatus?.(template.id, 'inactivo');
      await deps.addAuditLog?.({
        targetType: 'shift_template',
        targetId: template.id,
        action: 'delete_shift_plan',
        before: { plan: template },
        after: { estado: 'inactivo' }
      });
      notify('Plan eliminado.', 'success');
    } catch (error) {
      notify('Error: ' + (error?.message || error), 'error');
    }
  }

  function applyStoredGeneratedFilters() {
    if (!isGeneratedScreen) return;
    let filters = null;
    try {
      filters = JSON.parse(sessionStorage.getItem(GENERATED_FILTERS_KEY) || 'null');
      sessionStorage.removeItem(GENERATED_FILTERS_KEY);
    } catch (_) {
      filters = null;
    }
    if (!filters || typeof filters !== 'object') return;
    pendingGeneratedFilters = filters;
    if (filters.templateId && qs('#generatedPlan', ui)) qs('#generatedPlan', ui).value = filters.templateId;
    if (filters.sedeCodigo && qs('#generatedSede', ui)) qs('#generatedSede', ui).value = filters.sedeCodigo;
  }

  function startCatalogs() {
    const revision = ++catalogRevision;
    unTemplates?.();
    unSedes?.();
    templates = [];
    sedes = [];
    // Turnos screens are always scoped to the active contract; a future screen will handle global catalogs.
    const options = { contratoCodigo: currentContractCode() };
    if (!options.contratoCodigo) {
      if (isGeneratedScreen) refreshGeneratedFilterOptions();
      else render();
      return;
    }
    unTemplates = deps.streamShiftTemplates?.((rows) => {
      if (disposed || revision !== catalogRevision) return;
      templates = Array.isArray(rows) ? rows : [];
      if (isGeneratedScreen) {
        refreshGeneratedFilterOptions();
        if (generatedLoaded && !generatedBody.inert) renderGeneratedShifts();
      }
      else { render(); refreshRuleCounts(); }
    }, null, null, options) || (() => {});
    unSedes = deps.streamSedes?.((rows) => {
      if (disposed || revision !== catalogRevision) return;
      sedes = Array.isArray(rows) ? rows : [];
      if (isGeneratedScreen) {
        refreshGeneratedFilterOptions();
        if (generatedLoaded && !generatedBody.inert) renderGeneratedShifts();
      }
      else render();
    }, null, null, options) || (() => {});
  }

  unSelectedContract = subscribe('selectedContractCode', () => {
    const code = currentContractCode();
    if (code === observedContractCode) return;
    observedContractCode = code;
    generatedRevision++;
    reviewRevision++;
    employees = [];
    if (isGeneratedScreen) {
      pendingGeneratedFilters = null;
      qs('#generatedSede', ui).value = '';
      qs('#generatedPlan', ui).value = '';
      activePlanAssignments = [];
      scheduledShifts = [];
      scheduledShiftAssignmentCounts = new Map();
      generatedLoaded = false;
      startCatalogs();
    }
    refreshGeneratedFilterOptions();
    generatedPaginator?.reset();
    resetReviewPaginators();
    if (isGeneratedScreen) loadGeneratedShifts({ silent: true });
    if (isReviewScreen) loadShiftReview({ silent: true });
    refreshRuleCounts();
    render();
  });

  mount.replaceChildren(ui);
  applyStoredGeneratedFilters();
  startCatalogs();
  render();
  if (isGeneratedScreen) loadGeneratedShifts({ silent: true });
  if (isReviewScreen) loadShiftReview({ silent: true });
  return () => {
    disposed = true;
    unTemplates?.();
    unSedes?.();
    unSelectedContract?.();
  };
}

function saveGeneratedFilters(filters = {}) {
  try {
    sessionStorage.setItem(GENERATED_FILTERS_KEY, JSON.stringify(filters || {}));
  } catch (_) {}
}
