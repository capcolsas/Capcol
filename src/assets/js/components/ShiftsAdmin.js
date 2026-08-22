import { deactivateIcon, editIcon, el, infoIcon, lucideInlineIcon, qs } from '../utils/dom.js';
import { showActionModal } from '../utils/actionModal.js';
import { showInfoModal } from '../utils/infoModal.js';
import { showNotification } from '../utils/notifications.js';
import { addIsoDays, todayBogota } from '../utils/shiftCalendar.js';
import { createTablePagination } from '../utils/pagination.js';
import { can, PERMS } from '../permissions.js';
import { navigate } from '../router.js';

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
const GENERATED_RENEW_KEY = 'rocky_shift_generated_renewed_date';

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
  const title = isGeneratedScreen ? 'Turnos generados' : isReviewScreen ? 'Revision de turnos' : 'Planes de turnos';
  const ui = el('section', { className: 'main-card' }, [
    el('h2', {}, [title]),
    isGeneratedScreen ? generatedPanel() : isReviewScreen ? reviewPanel() : plansPanel()
  ]);

  function plansPanel() {
    return el('div', { id: 'shiftPlansPanel' }, [
      el('div', { className: 'form-row mt-2' }, [
        field('Buscar', el('input', { id: 'shiftSearch', className: 'input', placeholder: 'Nombre o notas del plan...' }))
      ]),
      el('div', { className: 'form-row mt-1' }, [
        el('button', { id: 'btnNewPlan', className: 'btn btn--primary', type: 'button', disabled: !canEdit }, ['Nuevo plan']),
        el('button', { id: 'btnGenerateShifts', className: 'btn', type: 'button', disabled: !canGenerate }, ['Activar plan']),
        el('span', { id: 'shiftMsg', className: 'text-muted' }, [' '])
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
      el('div', { className: 'form-row mt-2' }, [
        field('Sede', el('select', { id: 'generatedSede', className: 'select' }, [el('option', { value: '' }, ['Todas'])])),
        field('Plan', el('select', { id: 'generatedPlan', className: 'select' }, [el('option', { value: '' }, ['Todos'])]))
      ]),
      el('div', { className: 'form-row mt-1' }, [
        el('button', { id: 'btnLoadGeneratedShifts', className: 'btn btn--primary', type: 'button' }, ['Consultar planes activos']),
        el('span', { id: 'generatedShiftMsg', className: 'text-muted' }, ['Sin consulta.'])
      ]),
      el('div', { className: 'responsive-records mt-2' }, [
        el('div', { className: 'table-wrap responsive-table-view shift-generated-table-view' }, [
          el('table', { className: 'table', id: 'tblGeneratedShifts' }, [
            el('thead', {}, [el('tr', {}, [
              el('th', {}, ['Sede']),
              el('th', {}, ['Plan activo']),
              el('th', {}, ['Operarios']),
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
      el('div', { className: 'form-row mt-2' }, [
        field('Desde', el('input', { id: 'shiftReviewFrom', className: 'input', type: 'date', value: addIsoDays(todayBogota(), -7) })),
        field('Hasta', el('input', { id: 'shiftReviewTo', className: 'input', type: 'date', value: todayBogota() })),
        field('Sede', el('select', { id: 'generatedSede', className: 'select' }, [el('option', { value: '' }, ['Todas'])])),
        field('Plan', el('select', { id: 'generatedPlan', className: 'select' }, [el('option', { value: '' }, ['Todos'])]))
      ]),
      el('div', { className: 'form-row mt-1' }, [
        el('button', { id: 'btnLoadShiftReview', className: 'btn btn--primary', type: 'button' }, ['Consultar revision']),
        el('span', { id: 'shiftReviewMsg', className: 'text-muted' }, ['Sin consulta.'])
      ]),
      el('div', { className: 'section-block mt-2' }, [
        el('h3', { className: 'section-title' }, ['Pendientes de revision']),
        el('div', { id: 'shiftReviewRecords', className: 'responsive-records mt-1' }, [
          el('div', { className: 'table-wrap responsive-table-view shift-review-table-view' }, [
            el('table', { className: 'table', id: 'tblShiftReview' }, [
              el('thead', {}, [el('tr', {}, [
                el('th', {}, ['Fecha']),
                el('th', {}, ['Sede']),
                el('th', {}, ['Turno']),
                el('th', {}, ['Empleado']),
                el('th', {}, ['Estado']),
                el('th', {}, ['Tiempo']),
                el('th', {}, ['Acciones'])
              ])]),
              el('tbody', {})
            ])
          ]),
          el('div', { id: 'shiftReviewCards', className: 'record-card-list shift-review-card-list' }, [])
        ])
      ]),
      el('div', { className: 'section-block mt-2' }, [
        el('h3', { className: 'section-title' }, ['Cierres recientes']),
        el('div', { id: 'shiftClosureRecords', className: 'responsive-records mt-1' }, [
          el('div', { className: 'table-wrap responsive-table-view shift-closures-table-view' }, [
            el('table', { className: 'table', id: 'tblShiftClosures' }, [
              el('thead', {}, [el('tr', {}, [
                el('th', {}, ['Fecha']),
                el('th', {}, ['Sede']),
                el('th', {}, ['Turno']),
                el('th', {}, ['Registrados']),
                el('th', {}, ['Faltantes']),
                el('th', {}, ['Salidas pendientes']),
                el('th', {}, ['Acciones'])
              ])]),
              el('tbody', {})
            ])
          ]),
          el('div', { id: 'shiftClosureCards', className: 'record-card-list shift-closure-card-list' }, [])
        ])
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
  let shiftClosureRows = [];
  let reviewShiftById = new Map();
  let reviewLoaded = false;
  let generatedLoaded = false;
  let pendingGeneratedFilters = null;
  let renewGeneratedPromise = null;
  let ruleCounts = new Map();
  let unTemplates = null;
  let unSedes = null;
  let unEmployees = null;
  let disposed = false;

  const planBody = qs('#tblShiftPlans tbody', ui);
  const planCards = qs('#shiftPlanCards', ui);
  const generatedBody = qs('#tblGeneratedShifts tbody', ui);
  const generatedCards = qs('#shiftGeneratedCards', ui);
  const reviewBody = qs('#tblShiftReview tbody', ui);
  const reviewCards = qs('#shiftReviewCards', ui);
  const closureBody = qs('#tblShiftClosures tbody', ui);
  const closureCards = qs('#shiftClosureCards', ui);
  const msg = qs('#shiftMsg', ui);
  const generatedMsg = qs('#generatedShiftMsg', ui);
  const reviewMsg = qs('#shiftReviewMsg', ui);
  const planPaginator = !isGeneratedScreen && !isReviewScreen
    ? createTablePagination(ui, { id: 'shiftPlans', after: '#shiftPlansPanel .responsive-records', onChange: render })
    : null;
  const generatedPaginator = isGeneratedScreen
    ? createTablePagination(ui, { id: 'generatedShifts', after: '#shiftGeneratedPanel .responsive-records', onChange: renderGeneratedShifts })
    : null;
  const reviewPaginator = isReviewScreen
    ? createTablePagination(ui, { id: 'shiftReviewRows', after: '#shiftReviewRecords', onChange: renderShiftReview })
    : null;
  const closurePaginator = isReviewScreen
    ? createTablePagination(ui, { id: 'shiftClosureRows', after: '#shiftClosureRecords', onChange: renderShiftReview })
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
      if (generatedLoaded) loadGeneratedShifts();
      if (reviewLoaded) loadShiftReview({ silent: true });
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
    if (!clean && !name) return '-';
    if (!clean) return name;
    return name ? `${name} (${clean})` : clean;
  }

  function planLabel(id, fallback = '') {
    const clean = String(id || '').trim();
    const plan = templates.find((item) => String(item.id || '').trim() === clean) || null;
    return plan?.nombre || fallback || '-';
  }

  function estadoBadge(estado) {
    const clean = String(estado || '-').trim() || '-';
    const klass = clean === 'cerrado'
      ? 'badge badge--ok'
      : clean === 'cancelado'
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

  function activeGeneratedPlanRows() {
    const filters = generatedFilterValues();
    const shiftsByActivePlan = new Map();
    (scheduledShifts || []).forEach((row) => {
      const key = activePlanKey(row.sedeCodigo, row.templateId);
      if (!key) return;
      if (!shiftsByActivePlan.has(key)) shiftsByActivePlan.set(key, []);
      shiftsByActivePlan.get(key).push(row);
    });
    return (activePlanAssignments || [])
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
          templateId: row.templateId || null,
          nombre: planLabel(row.templateId),
          operariosPlaneados: row.operariosPlaneados ?? 0,
          horizonDays: row.horizonDays || 90,
          estado: row.estado || 'activo',
          estados: [...new Set(items.map((item) => item.estado || 'programado'))],
          count: items.length
        };
      })
      .sort((a, b) => {
        const sedeCompare = String(a.sedeNombre || a.sedeCodigo || '').localeCompare(String(b.sedeNombre || b.sedeCodigo || ''));
        if (sedeCompare) return sedeCompare;
        return String(planLabel(a.templateId, a.nombre)).localeCompare(String(planLabel(b.templateId, b.nombre)));
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
        .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')))
        .map((sede) => ({ value: sede.codigo || '', label: sedeLabel(sede.codigo, sede.nombre) }))
    ]);
    replaceSelectOptions('#generatedPlan', [
      { value: '', label: 'Todos' },
      ...templates
        .filter((row) => String(row.estado || 'activo') !== 'inactivo')
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
      frecuenciaTipo: 'todos',
      frecuenciaSemanas: 1,
      fechaAncla: null,
      semanaMes: null,
      festivoModo: type === 'festivo' ? 'normal' : 'excluir',
      ventanaEntradaAntesMinutos: 30,
      ventanaEntradaDespuesMinutos: 30,
      ventanaSalidaAntesMinutos: 0,
      ventanaSalidaDespuesMinutos: 30,
      ventanaNovedadHoras: 48,
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
      msg.textContent = `${rows.length} planes`;
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
    closurePaginator?.reset();
  }

  async function loadGeneratedShifts({ silent = false } = {}) {
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
    try {
      await ensureActivePlansRenewed({ silent });
      if (!silent) generatedMsg.textContent = 'Consultando planes activos...';
      activePlanAssignments = await deps.listShiftSitePlanAssignments({
        includeInactive: false,
        sedeCodigo: filters.sedeCodigo || null,
        templateId: filters.templateId || null
      }) || [];
      const dateFrom = addIsoDays(todayBogota(), 1);
      const maxHorizonDays = activePlanAssignments.reduce((max, row) => Math.max(max, Number(row.horizonDays || 90)), 90);
      const dateTo = addIsoDays(dateFrom, Math.min(370, Math.max(1, maxHorizonDays)) - 1);
      const rows = activePlanAssignments.length
        ? await deps.listScheduledShiftsRange(dateFrom, dateTo, {
          sedeCodigo: filters.sedeCodigo || null,
          estados: ['programado', 'abierto']
        })
        : [];
      const activeKeys = new Set(activePlanAssignments.map((row) => activePlanKey(row.sedeCodigo, row.templateId)).filter(Boolean));
      scheduledShifts = (rows || [])
        .filter((row) => activeKeys.has(activePlanKey(row.sedeCodigo, row.templateId)))
        .sort((a, b) => {
          if (String(a.fechaOperativa || '') !== String(b.fechaOperativa || '')) return String(a.fechaOperativa || '').localeCompare(String(b.fechaOperativa || ''));
          if (String(a.sedeNombre || a.sedeCodigo || '') !== String(b.sedeNombre || b.sedeCodigo || '')) return String(a.sedeNombre || a.sedeCodigo || '').localeCompare(String(b.sedeNombre || b.sedeCodigo || ''));
          return String(a.startsAt || '').localeCompare(String(b.startsAt || ''));
        });
      const shiftIds = scheduledShifts.map((row) => row.id).filter(Boolean);
      const assignments = typeof deps.listShiftAssignmentsForShifts === 'function'
        ? await deps.listShiftAssignmentsForShifts(shiftIds)
        : [];
      scheduledShiftAssignmentCounts = buildAssignmentCountMap(assignments);
      generatedLoaded = true;
      pendingGeneratedFilters = null;
      generatedPaginator?.reset();
      renderGeneratedShifts();
      const groups = activeGeneratedPlanRows();
      generatedMsg.textContent = `Planes activos filtrados: ${groups.length}.`;
    } catch (error) {
      generatedLoaded = true;
      scheduledShifts = [];
      activePlanAssignments = [];
      scheduledShiftAssignmentCounts = new Map();
      renderGeneratedShifts();
      generatedMsg.textContent = `Error consultando planes activos: ${error?.message || error}`;
    }
  }

  async function loadShiftReview({ silent = false } = {}) {
    if (typeof deps.listEmployeeShiftStatusRange !== 'function' || typeof deps.listShiftClosuresRange !== 'function') {
      reviewLoaded = true;
      shiftReviewRows = [];
      shiftClosureRows = [];
      reviewShiftById = new Map();
      if (reviewMsg) reviewMsg.textContent = 'No esta disponible la revision de turnos.';
      renderShiftReview();
      return;
    }
    const filters = reviewFilterValues();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(filters.dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(filters.dateTo) || filters.dateFrom > filters.dateTo) {
      notify('Selecciona un rango valido para la revision.', 'warning');
      return;
    }
    try {
      if (!silent && reviewMsg) reviewMsg.textContent = 'Consultando revision...';
      const [statusRows, closureRows, shiftRows] = await Promise.all([
        deps.listEmployeeShiftStatusRange(filters.dateFrom, filters.dateTo, {
          sedeCodigo: filters.sedeCodigo || null
        }) || [],
        deps.listShiftClosuresRange(filters.dateFrom, filters.dateTo, {
          sedeCodigo: filters.sedeCodigo || null
        }) || [],
        typeof deps.listScheduledShiftsRange === 'function'
          ? deps.listScheduledShiftsRange(filters.dateFrom, filters.dateTo, {
            sedeCodigo: filters.sedeCodigo || null,
            estados: ['programado', 'abierto', 'cerrado', 'cancelado']
          })
          : []
      ]);
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
      shiftClosureRows = (closureRows || [])
        .filter((row) => !hasPlanFilter || allowedShiftIds.has(String(row.scheduledShiftId || '').trim()))
        .sort((a, b) => {
          const closedCompare = String(b.closedAt || '').localeCompare(String(a.closedAt || ''));
          if (closedCompare) return closedCompare;
          return String(b.fechaOperativa || '').localeCompare(String(a.fechaOperativa || ''));
        });
      reviewLoaded = true;
      renderShiftReview();
      if (reviewMsg) reviewMsg.textContent = `Pendientes: ${shiftReviewRows.length}. Cierres: ${shiftClosureRows.length}.`;
    } catch (error) {
      reviewLoaded = true;
      shiftReviewRows = [];
      shiftClosureRows = [];
      reviewShiftById = new Map();
      renderShiftReview();
      if (reviewMsg) reviewMsg.textContent = `Error consultando revision: ${error?.message || error}`;
    }
  }

  function isReviewableShiftStatus(row = {}) {
    const status = String(row.estadoTurno || '').trim();
    if (status === 'ajustado' && row.requiresReview !== true) return false;
    return row.requiresReview === true
      || ['post_cierre_pendiente', 'salida_pendiente', 'retiro_anticipado', 'trabajado_tardio'].includes(status);
  }

  function renderShiftReview() {
    if (!isReviewScreen || !reviewBody || !closureBody) return;
    if (!reviewLoaded) {
      reviewBody.replaceChildren(el('tr', {}, [el('td', { colSpan: 7, className: 'text-muted' }, ['Usa Consultar revision para ver novedades de turnos cerrados o fuera de ventana.'])]));
      reviewCards?.replaceChildren(el('p', { className: 'text-muted record-card__empty' }, ['Usa Consultar revision para ver novedades de turnos cerrados o fuera de ventana.']));
      closureBody.replaceChildren(el('tr', {}, [el('td', { colSpan: 7, className: 'text-muted' }, ['Usa Consultar revision para ver cierres recientes.'])]));
      closureCards?.replaceChildren(el('p', { className: 'text-muted record-card__empty' }, ['Usa Consultar revision para ver cierres recientes.']));
      reviewPaginator?.slice([]);
      closurePaginator?.slice([]);
      return;
    }
    const reviewPageRows = reviewPaginator?.slice(shiftReviewRows) || shiftReviewRows;
    const closurePageRows = closurePaginator?.slice(shiftClosureRows) || shiftClosureRows;
    reviewBody.replaceChildren(...(reviewPageRows.length ? reviewPageRows.map(shiftReviewRow) : [
      el('tr', {}, [el('td', { colSpan: 7, className: 'text-muted' }, ['Sin pendientes de revision en el rango.'])])
    ]));
    reviewCards?.replaceChildren(...(reviewPageRows.length ? reviewPageRows.map(shiftReviewCard) : [
      el('p', { className: 'text-muted record-card__empty' }, ['Sin pendientes de revision en el rango.'])
    ]));
    closureBody.replaceChildren(...(closurePageRows.length ? closurePageRows.map(shiftClosureRow) : [
      el('tr', {}, [el('td', { colSpan: 7, className: 'text-muted' }, ['Sin cierres de turno en el rango.'])])
    ]));
    closureCards?.replaceChildren(...(closurePageRows.length ? closurePageRows.map(shiftClosureCard) : [
      el('p', { className: 'text-muted record-card__empty' }, ['Sin cierres de turno en el rango.'])
    ]));
  }

  function shiftReviewRow(row) {
    const shift = reviewShiftById.get(String(row.scheduledShiftId || '').trim()) || {};
    return el('tr', {}, [
      el('td', {}, [row.fechaOperativa || '-']),
      el('td', {}, [sedeLabel(row.sedeCodigo || shift.sedeCodigo, shift.sedeNombre)]),
      el('td', {}, [shiftReviewShiftLabel(shift, row)]),
      el('td', {}, [employeeReviewLabel(row)]),
      el('td', {}, [estadoBadge(shiftStatusLabel(row.estadoTurno))]),
      el('td', {}, [shiftReviewTimeSummary(row)]),
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
        estadoBadge(shiftStatusLabel(row.estadoTurno))
      ]),
      el('dl', { className: 'record-card__meta' }, [
        ['Fecha', row.fechaOperativa || '-'],
        ['Sede', sedeLabel(row.sedeCodigo || shift.sedeCodigo, shift.sedeNombre)],
        ['Tiempo', shiftReviewTimeSummary(row)]
      ].map(([label, value]) => el('div', { className: 'record-card__meta-item' }, [
        el('dt', {}, [label]),
        el('dd', {}, [value || '-'])
      ]))),
      el('div', { className: 'record-card__actions' }, [shiftReviewActions(row)])
    ]);
  }

  function shiftClosureRow(row) {
    const shift = reviewShiftById.get(String(row.scheduledShiftId || '').trim()) || row.snapshot?.shift || {};
    return el('tr', {}, [
      el('td', {}, [row.fechaOperativa || '-']),
      el('td', {}, [sedeLabel(row.sedeCodigo || shift.sedeCodigo, shift.sedeNombre)]),
      el('td', {}, [shiftReviewShiftLabel(shift, row)]),
      el('td', {}, [`${row.registrados || 0}/${row.planeados || 0}`]),
      el('td', {}, [String(row.faltantes || 0)]),
      el('td', {}, [String(row.salidasPendientes || 0)]),
      el('td', {}, [shiftClosureActions(row)])
    ]);
  }

  function shiftClosureCard(row) {
    const shift = reviewShiftById.get(String(row.scheduledShiftId || '').trim()) || row.snapshot?.shift || {};
    return el('article', { className: 'record-card shift-closure-card' }, [
      el('div', { className: 'record-card__header' }, [
        el('div', { className: 'record-card__identity' }, [
          el('strong', { className: 'record-card__title' }, [sedeLabel(row.sedeCodigo || shift.sedeCodigo, shift.sedeNombre)]),
          el('span', { className: 'record-card__subtitle' }, [shiftReviewShiftLabel(shift, row)])
        ]),
        el('span', { className: 'badge badge--ok' }, ['cerrado'])
      ]),
      el('dl', { className: 'record-card__meta' }, [
        ['Fecha', row.fechaOperativa || '-'],
        ['Registrados', `${row.registrados || 0}/${row.planeados || 0}`],
        ['Faltantes', String(row.faltantes || 0)],
        ['Salidas pendientes', String(row.salidasPendientes || 0)]
      ].map(([label, value]) => el('div', { className: 'record-card__meta-item' }, [
        el('dt', {}, [label]),
        el('dd', {}, [value || '-'])
      ]))),
      el('div', { className: 'record-card__actions' }, [shiftClosureActions(row)])
    ]);
  }

  function shiftReviewActions(row) {
    const canAuthorize = Boolean(authorizationCandidate(row));
    const actions = el('div', { className: 'row-actions' }, [
      el('button', { className: 'btn btn--icon', type: 'button', title: 'Ver informacion', 'aria-label': 'Ver informacion' }, [infoIcon()]),
      el('button', { className: 'btn btn--icon', type: 'button', disabled: !canReview || !canAuthorize, title: 'Autorizar tiempo', 'aria-label': 'Autorizar tiempo' }, [lucideInlineIcon('clock-check', 'Au', 'app-clock-check-icon')]),
      el('button', { className: 'btn btn--icon', type: 'button', disabled: !canReview, title: 'Marcar revisado', 'aria-label': 'Marcar revisado' }, [lucideInlineIcon('check', 'Ok', 'app-check-icon')])
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

  function shiftClosureActions(row) {
    const actions = el('div', { className: 'row-actions' }, [
      el('button', { className: 'btn btn--icon', type: 'button', title: 'Ver informacion', 'aria-label': 'Ver informacion' }, [infoIcon()])
    ]);
    actions.children[0].addEventListener('click', (ev) => {
      ev.stopPropagation();
      openShiftClosureInfoModal(row);
    });
    return actions;
  }

  function openShiftReviewInfoModal(row = {}) {
    const shift = reviewShiftById.get(String(row.scheduledShiftId || '').trim()) || {};
    showInfoModal(`Revision - ${employeeReviewLabel(row)}`, [
      el('div', { className: 'employee-detail' }, [
        detailSection('Registro', [
          ['Empleado', employeeReviewLabel(row)],
          ['Documento', row.documento],
          ['Estado', shiftStatusLabel(row.estadoTurno)],
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
        detailSection('Tiempos fuera de ventana', [
          ['Entrada anticipada', `${row.earlyEntryMinutes || 0} min`],
          ['Entrada tardia', `${row.lateEntryMinutes || 0} min`],
          ['Salida anticipada', `${row.earlyExitMinutes || 0} min`],
          ['Salida tardia', `${row.lateExitMinutes || 0} min`],
          ['Motivo entrada anticipada', row.earlyEntryReason],
          ['Motivo entrada tardia', row.lateEntryReason],
          ['Motivo salida anticipada', row.earlyExitReason],
          ['Motivo salida tardia', row.lateExitReason]
        ])
      ])
    ]);
  }

  async function authorizeShiftReviewTime(row = {}) {
    if (!canReview) return;
    const candidate = authorizationCandidate(row);
    if (!candidate) {
      notify('Este pendiente no corresponde a una autorizacion de tiempo.', 'warning');
      return;
    }
    const shift = reviewShiftById.get(String(row.scheduledShiftId || '').trim()) || {};
    const modal = await showActionModal({
      title: 'Autorizar tiempo',
      message: `${employeeReviewLabel(row)} - ${candidate.label}.`,
      confirmText: 'Autorizar',
      fields: [
        { id: 'minutes', label: 'Minutos autorizados', type: 'number', min: 1, step: 1, required: true, value: String(candidate.minutes || 0) },
        { id: 'reason', label: 'Motivo', type: 'textarea', required: true, value: defaultReviewReason(row), rows: 3 }
      ]
    });
    if (!modal.confirmed) return;
    const minutes = Math.max(1, Number(modal.values.minutes || 0));
    const reason = String(modal.values.reason || '').trim();
    if (!reason) {
      notify('Registra el motivo de la autorizacion.', 'warning');
      return;
    }
    try {
      const authorization = await deps.createShiftTimeAuthorization?.({
        scheduledShiftId: row.scheduledShiftId || null,
        employeeId: row.employeeId || null,
        documento: row.documento || null,
        authorizationType: candidate.authorizationType,
        authorizedFrom: candidate.authorizedFrom || null,
        authorizedUntil: candidate.authorizedUntil || null,
        minutesAuthorized: minutes,
        reason,
        estado: 'aprobada'
      });
      const remainingIssues = reviewIssueTypes(row).filter((issue) => issue !== candidate.adjustmentType);
      const patch = {
        requiresReview: remainingIssues.length > 0,
        estadoTurno: remainingIssues.length ? row.estadoTurno || 'programado' : 'ajustado'
      };
      Object.assign(patch, reviewReasonPatch(candidate.adjustmentType, reason));
      if (candidate.side === 'entry') patch.entryAuthorizationId = authorization?.id || null;
      if (candidate.side === 'exit') patch.exitAuthorizationId = authorization?.id || null;
      await deps.upsertEmployeeShiftStatus?.([buildShiftStatusUpdate(row, patch)]);
      const after = { ...row, ...patch, authorizationId: authorization?.id || null, motivo: reason };
      await deps.createShiftAdjustment?.({
        scheduledShiftId: row.scheduledShiftId || null,
        employeeId: row.employeeId || null,
        documento: row.documento || null,
        tipo: candidate.adjustmentType,
        estado: 'aprobado',
        beforeSnapshot: { status: row, shift },
        afterSnapshot: after,
        motivo: reason
      });
      await deps.addAuditLog?.({
        targetType: 'employee_shift_status',
        targetId: row.id || null,
        action: 'authorize_shift_review_time',
        before: { status: row, shift },
        after
      });
      notify('Tiempo autorizado y revision cerrada.', 'success');
      await loadShiftReview({ silent: true });
    } catch (error) {
      notify('Error autorizando tiempo: ' + (error?.message || error), 'error');
    }
  }

  async function resolveShiftReview(row = {}) {
    if (!canReview) return;
    const shift = reviewShiftById.get(String(row.scheduledShiftId || '').trim()) || {};
    const modal = await showActionModal({
      title: 'Marcar revisado',
      message: `${employeeReviewLabel(row)} - ${shiftStatusLabel(row.estadoTurno)}.`,
      confirmText: 'Guardar revision',
      fields: [
        { id: 'reason', label: 'Motivo', type: 'textarea', required: true, value: defaultReviewReason(row), rows: 3 }
      ]
    });
    if (!modal.confirmed) return;
    const reason = String(modal.values.reason || '').trim();
    if (!reason) {
      notify('Registra el motivo de la revision.', 'warning');
      return;
    }
    try {
      const patch = {
        requiresReview: false,
        estadoTurno: 'ajustado'
      };
      Object.assign(patch, reviewReasonPatch(adjustmentTypeForReview(row), reason));
      await deps.upsertEmployeeShiftStatus?.([buildShiftStatusUpdate(row, patch)]);
      const after = { ...row, ...patch, motivo: reason };
      await deps.createShiftAdjustment?.({
        scheduledShiftId: row.scheduledShiftId || null,
        employeeId: row.employeeId || null,
        documento: row.documento || null,
        tipo: adjustmentTypeForReview(row),
        estado: 'aprobado',
        beforeSnapshot: { status: row, shift },
        afterSnapshot: after,
        motivo: reason
      });
      await deps.addAuditLog?.({
        targetType: 'employee_shift_status',
        targetId: row.id || null,
        action: 'resolve_shift_review',
        before: { status: row, shift },
        after
      });
      notify('Revision marcada como ajustada.', 'success');
      await loadShiftReview({ silent: true });
    } catch (error) {
      notify('Error guardando revision: ' + (error?.message || error), 'error');
    }
  }

  function authorizationCandidate(row = {}) {
    const shift = reviewShiftById.get(String(row.scheduledShiftId || '').trim()) || {};
    if (Number(row.earlyEntryMinutes || 0) > 0) {
      return {
        authorizationType: 'early_entry',
        adjustmentType: 'entrada_anticipada',
        side: 'entry',
        minutes: Number(row.earlyEntryMinutes || 0),
        authorizedFrom: row.entradaAt || null,
        authorizedUntil: shift.startsAt || null,
        label: `entrada anticipada por ${row.earlyEntryMinutes} minutos`
      };
    }
    if (Number(row.lateExitMinutes || 0) > 0) {
      return {
        authorizationType: 'late_exit',
        adjustmentType: String(row.estadoTurno || '') === 'post_cierre_pendiente' ? 'registro_post_cierre' : 'salida_tardia',
        side: 'exit',
        minutes: Number(row.lateExitMinutes || 0),
        authorizedFrom: shift.endsAt || null,
        authorizedUntil: row.salidaAt || null,
        label: `salida tardia por ${row.lateExitMinutes} minutos`
      };
    }
    if (String(row.estadoTurno || '') === 'post_cierre_pendiente') {
      return {
        authorizationType: 'extended_shift',
        adjustmentType: 'registro_post_cierre',
        side: 'exit',
        minutes: Math.max(1, minutesBetween(shift.endsAt, row.salidaAt)),
        authorizedFrom: shift.endsAt || null,
        authorizedUntil: row.salidaAt || null,
        label: 'registro posterior al cierre'
      };
    }
    return null;
  }

  function adjustmentTypeForReview(row = {}) {
    const status = String(row.estadoTurno || '').trim();
    if (status === 'post_cierre_pendiente') return 'registro_post_cierre';
    if (Number(row.earlyEntryMinutes || 0) > 0) return 'entrada_anticipada';
    if (Number(row.lateEntryMinutes || 0) > 0) return 'entrada_tardia';
    if (Number(row.earlyExitMinutes || 0) > 0) return 'salida_anticipada';
    if (Number(row.lateExitMinutes || 0) > 0) return 'salida_tardia';
    return 'correccion_manual';
  }

  function reviewIssueTypes(row = {}) {
    const status = String(row.estadoTurno || '').trim();
    const issues = [];
    if (status === 'post_cierre_pendiente') issues.push('registro_post_cierre');
    if (status === 'salida_pendiente') issues.push('correccion_manual');
    if (status === 'retiro_anticipado') issues.push('salida_anticipada');
    if (status === 'trabajado_tardio') issues.push('entrada_tardia');
    if (Number(row.earlyEntryMinutes || 0) > 0) issues.push('entrada_anticipada');
    if (Number(row.lateEntryMinutes || 0) > 0) issues.push('entrada_tardia');
    if (Number(row.earlyExitMinutes || 0) > 0) issues.push('salida_anticipada');
    if (Number(row.lateExitMinutes || 0) > 0 && status !== 'post_cierre_pendiente') issues.push('salida_tardia');
    return [...new Set(issues)];
  }

  function reviewReasonPatch(adjustmentType = '', reason = '') {
    const cleanReason = String(reason || '').trim();
    if (!cleanReason) return {};
    const type = String(adjustmentType || '').trim();
    if (type === 'entrada_anticipada') return { earlyEntryReason: cleanReason };
    if (type === 'entrada_tardia') return { lateEntryReason: cleanReason };
    if (type === 'salida_anticipada') return { earlyExitReason: cleanReason };
    if (type === 'salida_tardia' || type === 'registro_post_cierre') return { lateExitReason: cleanReason };
    return {};
  }

  function buildShiftStatusUpdate(row = {}, patch = {}) {
    return {
      id: row.id || null,
      scheduledShiftId: row.scheduledShiftId || null,
      fechaOperativa: row.fechaOperativa || null,
      employeeId: row.employeeId || null,
      documento: row.documento || null,
      nombre: row.nombre || null,
      sedeCodigo: row.sedeCodigo || null,
      estadoTurno: row.estadoTurno || 'programado',
      asistio: row.asistio === true,
      entradaAt: row.entradaAt || null,
      salidaAt: row.salidaAt || null,
      novedadCodigo: row.novedadCodigo || null,
      novedadNombre: row.novedadNombre || null,
      earlyEntryMinutes: row.earlyEntryMinutes || 0,
      lateEntryMinutes: row.lateEntryMinutes || 0,
      earlyExitMinutes: row.earlyExitMinutes || 0,
      lateExitMinutes: row.lateExitMinutes || 0,
      earlyEntryReason: row.earlyEntryReason || null,
      lateEntryReason: row.lateEntryReason || null,
      earlyExitReason: row.earlyExitReason || null,
      lateExitReason: row.lateExitReason || null,
      entryAuthorizationId: row.entryAuthorizationId || null,
      exitAuthorizationId: row.exitAuthorizationId || null,
      requiresReview: row.requiresReview === true,
      requiereReemplazo: row.requiereReemplazo === true,
      decisionCobertura: row.decisionCobertura || 'no_aplica',
      reemplazadoPorEmployeeId: row.reemplazadoPorEmployeeId || null,
      reemplazadoPorDocumento: row.reemplazadoPorDocumento || null,
      reemplazadoPorNombre: row.reemplazadoPorNombre || null,
      closed: row.closed === true,
      sourceAttendanceId: row.sourceAttendanceId || null,
      sourceExitId: row.sourceExitId || null,
      sourceIncapacityId: row.sourceIncapacityId || null,
      sourceReplacementId: row.sourceReplacementId || null,
      ...patch
    };
  }

  function defaultReviewReason(row = {}) {
    return row.lateExitReason || row.earlyExitReason || row.lateEntryReason || row.earlyEntryReason || '';
  }

  function minutesBetween(from, to) {
    const fromMs = new Date(from || '').getTime();
    const toMs = new Date(to || '').getTime();
    if (Number.isNaN(fromMs) || Number.isNaN(toMs) || toMs <= fromMs) return 0;
    return Math.ceil((toMs - fromMs) / 60000);
  }

  function openShiftClosureInfoModal(row = {}) {
    const shift = reviewShiftById.get(String(row.scheduledShiftId || '').trim()) || row.snapshot?.shift || {};
    showInfoModal(`Cierre - ${sedeLabel(row.sedeCodigo || shift.sedeCodigo, shift.sedeNombre)}`, [
      el('div', { className: 'employee-detail' }, [
        detailSection('Cierre automatico', [
          ['Fecha operativa', row.fechaOperativa],
          ['Sede', sedeLabel(row.sedeCodigo || shift.sedeCodigo, shift.sedeNombre)],
          ['Turno', shiftReviewShiftLabel(shift, row)],
          ['Cerrado por', row.closedByEmail || row.closedByUid || '-'],
          ['Cerrado', formatDateTime(row.closedAt)]
        ]),
        detailSection('Resumen', [
          ['Planeados', String(row.planeados || 0)],
          ['Asignados', String(row.asignados || 0)],
          ['Registrados', String(row.registrados || 0)],
          ['Ausencias', String(row.ausencias || 0)],
          ['Reemplazos', String(row.reemplazos || 0)],
          ['Faltantes', String(row.faltantes || 0)],
          ['Sobrantes', String(row.sobrantes || 0)],
          ['Entradas fuera ventana', String(row.entradasFueraVentana || 0)],
          ['Salidas fuera ventana', String(row.salidasFueraVentana || 0)],
          ['Salidas pendientes', String(row.salidasPendientes || 0)],
          ['Autorizaciones pendientes', String(row.autorizacionesPendientes || 0)],
          ['Ajustes pendientes', String(row.ajustesPendientes || 0)]
        ])
      ])
    ]);
  }

  function shiftReviewShiftLabel(shift = {}, fallback = {}) {
    const name = shift.nombre || fallback.nombre || 'Turno';
    const date = shift.fechaOperativa || fallback.fechaOperativa || '';
    const hours = shift.startsAt && shift.endsAt ? shiftTimeLabel(shift) : '';
    return [name, date, hours].filter(Boolean).join(' | ') || '-';
  }

  function employeeReviewLabel(row = {}) {
    return [row.nombre || '-', row.documento ? `(${row.documento})` : ''].filter(Boolean).join(' ');
  }

  function shiftStatusLabel(status) {
    const clean = String(status || '-').trim();
    const labels = {
      programado: 'Programado',
      trabajado: 'Trabajado',
      trabajado_tardio: 'Trabajado tardio',
      ausente_con_novedad: 'Ausente con novedad',
      ausente_sin_reemplazo: 'Ausente sin reemplazo',
      sin_registro: 'Sin registro',
      salida_pendiente: 'Salida pendiente',
      retiro_anticipado: 'Retiro anticipado',
      post_cierre_pendiente: 'Post-cierre pendiente',
      ajustado: 'Ajustado',
      cancelado: 'Cancelado'
    };
    return labels[clean] || clean || '-';
  }

  function shiftReviewTimeSummary(row = {}) {
    const pieces = [];
    if (Number(row.earlyEntryMinutes || 0) > 0) pieces.push(`Entrada anticipada ${row.earlyEntryMinutes}m`);
    if (Number(row.lateEntryMinutes || 0) > 0) pieces.push(`Entrada tardia ${row.lateEntryMinutes}m`);
    if (Number(row.earlyExitMinutes || 0) > 0) pieces.push(`Salida anticipada ${row.earlyExitMinutes}m`);
    if (Number(row.lateExitMinutes || 0) > 0) pieces.push(`Salida tardia ${row.lateExitMinutes}m`);
    if (!pieces.length && String(row.estadoTurno || '') === 'salida_pendiente') pieces.push('Sin salida QR');
    return pieces.join(' | ') || '-';
  }

  async function ensureActivePlansRenewed({ silent = false } = {}) {
    if (typeof deps.renewActiveShiftPlans !== 'function') return null;
    const todayKey = todayBogota();
    try {
      if (sessionStorage.getItem(GENERATED_RENEW_KEY) === todayKey) return null;
    } catch (_) {}
    if (!renewGeneratedPromise) {
      if (!silent) generatedMsg.textContent = 'Renovando turnos futuros...';
      renewGeneratedPromise = deps.renewActiveShiftPlans()
        .then((result) => {
          try {
            sessionStorage.setItem(GENERATED_RENEW_KEY, todayKey);
          } catch (_) {}
          return result;
        })
        .finally(() => {
          renewGeneratedPromise = null;
        });
    }
    try {
      return await renewGeneratedPromise;
    } catch (error) {
      console.warn('No se pudo renovar turnos activos:', error);
      if (!silent) notify('No se pudieron renovar los turnos futuros automaticamente.', 'warning');
      return null;
    }
  }

  function renderGeneratedShifts() {
    if (!generatedLoaded) {
      generatedBody.replaceChildren(el('tr', {}, [el('td', { colSpan: 5, className: 'text-muted' }, ['Usa Consultar planes activos para ver las sedes con planes activos.'])]));
      generatedCards.replaceChildren(el('p', { className: 'text-muted record-card__empty' }, ['Usa Consultar planes activos para ver las sedes con planes activos.']));
      generatedPaginator?.slice([]);
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
        ['Operarios', String(row.operariosPlaneados ?? 0)],
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
        { id: 'operariosPlaneados', label: 'Operarios', type: 'number', min: 0, step: 1, value: String(group.operariosPlaneados ?? 0) },
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
    const todayLimit = todayBogota();
    const targetRows = (group.items || [])
      .filter((row) => row.id && String(row.fechaOperativa || '') > todayLimit)
      .filter((row) => !['cancelado', 'cerrado'].includes(String(row.estado || '').trim()));
    if (!targetRows.length) {
      notify('Este plan activo no tiene turnos futuros disponibles para asignar.', 'warning');
      return;
    }
    const sedeCode = String(group.sedeCodigo || '').trim();
    const availableEmployees = employees
      .filter((emp) => String(emp.estado || 'activo') !== 'inactivo')
      .filter((emp) => !sedeCode || String(emp.sedeCodigo || '').trim() === sedeCode)
      .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')));
    if (!availableEmployees.length) {
      notify('No hay empleados activos de esta sede para asignar.', 'warning');
      return;
    }
    try {
      const existingTargetAssignments = await deps.listShiftAssignmentsForShifts?.(targetRows.map((row) => row.id)) || [];
      const preselected = commonAssignedEmployeeIds(existingTargetAssignments, targetRows);
      const modal = await showActionModal({
        title: 'Asignar empleados',
        message: `Se aplicara a ${targetRows.length} turnos futuros del plan activo. Operarios planeados por turno: ${group.operariosPlaneados ?? 0}.`,
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
      const overlap = await findAssignmentOverlap(targetRows, selectedEmployees);
      if (overlap.length) {
        notify(`Cruce detectado: ${overlap.slice(0, 3).join('; ')}${overlap.length > 3 ? '...' : ''}`, 'warning');
        return;
      }
      const selectedSet = new Set(selectedIds);
      const removals = existingTargetAssignments.filter((row) => row.id && !selectedSet.has(String(row.employeeId || '')));
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
      await loadGeneratedShifts({ silent: true });
    } catch (error) {
      notify('Error: ' + (error?.message || error), 'error');
    }
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
    const allShifts = await deps.listScheduledShiftsRange(dateFrom, dateTo, { estados: ['programado', 'abierto'] }) || [];
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
          ? deps.listShiftSitePlanAssignments({ includeInactive: false, templateId: plan.id }).catch(() => [])
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
        ['Estado', plan.estado || 'activo'],
        ['Horarios activos', String(activeRules.length)],
        ['Horarios inactivos', String(inactiveRules)],
        ['Notas', plan.notasProgramacion],
        ['Creado por', plan.createdByEmail || plan.createdByUid],
        ['Creado', formatDateTime(plan.createdAt)],
        ['Actualizado', formatDateTime(plan.updatedAt)]
      ]),
      detailSection('Horarios', activeRules.length ? activeRules.map((rule) => [
        ruleTitle(rule),
        ruleSummary(rule)
      ]) : [['Horarios', 'Sin horarios activos']]),
      detailSection('Sedes activas', activeAssignments.length ? activeAssignments.map((assignment) => [
        sedeLabel(assignment.sedeCodigo, assignment.sedeNombre),
        `${assignment.operariosPlaneados ?? 0} operarios`
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
        ['Estado', assignment.estado || group.estado || 'activo'],
        ['Operarios', String(group.operariosPlaneados ?? 0)],
        ['Asignacion', `${summary.label} - ${summary.detail}`],
        ['Turnos futuros', String(group.count || 0)],
        ['Activado', formatDateTime(assignment.activatedAt)],
        ['Creado por', assignment.createdByEmail || assignment.createdByUid],
        ['Creado', formatDateTime(assignment.createdAt)],
        ['Actualizado', formatDateTime(assignment.updatedAt)]
      ]),
      detailSection('Informacion del plan', [
        ['Nombre', plan.nombre || group.nombre],
        ['Estado del plan', plan.estado || 'activo'],
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

  function ruleSummary(rule = {}) {
    const pieces = [
      `${String(rule.horaInicio || '').slice(0, 5) || '--:--'} - ${String(rule.horaFin || '').slice(0, 5) || '--:--'}${rule.cruzaDia ? ' (+1)' : ''}`,
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
      el('td', {}, [row.estado || 'activo']),
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
        el('span', { className: 'role-badge' }, [row.estado || 'activo'])
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
      .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')));
    const activeSedes = sedes
      .filter((sede) => String(sede.estado || 'activo') !== 'inactivo')
      .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')));
    let activeAssignments = [];
    try {
      activeAssignments = await deps.listShiftSitePlanAssignments?.({ includeInactive: false }) || [];
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
        horizonDays: modal.values.horizonDays || 90
      });
      await deps.addAuditLog?.({
        targetType: 'shift_site_plan_assignment',
        targetId: null,
        action: 'activate_shift_plan_for_sites',
        after: { templateId: modal.values.templateId || null, sedeCodigos, sedeOperarios: modal.values.sedeOperarios || {}, horizonDays: modal.values.horizonDays || 90, result }
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
        el('p', { className: 'action-modal__message' }, ['Selecciona un plan y las sedes donde quedara activo. La programacion se crea desde manana para no tocar la operacion de hoy.']),
        el('div', { className: 'form-row' }, [
          field('Plan', el('select', { className: 'select', 'data-generate-field': 'templateId' }, optionNodes([
            { value: '', label: 'Selecciona un plan' },
            ...activePlans.map((row) => ({ value: row.id, label: row.nombre || '-' }))
          ]))),
          field('Ventana futura', el('input', { className: 'input', type: 'number', min: '1', max: '370', step: '1', value: '90', 'data-generate-field': 'horizonDays' }))
        ]),
        el('div', { className: 'shift-generate-sites mt-2' }, [
          el('strong', { className: 'shift-section-title' }, ['Sedes y operarios']),
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
          const value = Math.max(0, Number(raw || 0));
          if (!code) return;
          sedeCodigos.push(code);
          sedeOperarios[code] = Number.isFinite(value) ? value : 0;
        });
        return {
          templateId: String(body.querySelector('[data-generate-field="templateId"]')?.value || '').trim(),
          horizonDays: Math.min(370, Math.max(1, Number(body.querySelector('[data-generate-field="horizonDays"]')?.value || 90))),
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
        finish({ confirmed: true, values });
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
        el('span', {}, ['Operarios']),
        input
      ])
    ]);
  }

  async function refreshRuleCounts() {
    if (isGeneratedScreen || isReviewScreen || !deps.listShiftTemplateRules) return;
    const ids = templates.map((row) => row.id).filter(Boolean);
    const entries = await Promise.all(ids.map(async (id) => {
      try {
        const rows = await deps.listShiftTemplateRules(id, { includeInactive: false });
        return [id, (rows || []).filter((row) => row.estado !== 'inactivo').length];
      } catch (_) {
        return [id, null];
      }
    }));
    if (disposed) return;
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
    let modalRules = isNew
      ? []
      : (await deps.listShiftTemplateRules?.(template.id, { includeInactive: true }) || [])
        .filter((row) => row.estado !== 'inactivo')
        .map((row) => ({ ...row, _localId: row.id || `row-${nextLocalId++}` }));
    let removedRuleIds = new Set();
    let dirty = false;
    let confirmingClose = false;

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
        frecuenciaTipo: 'todos',
        frecuenciaSemanas: 2,
        fechaAncla: todayBogota(),
        semanaMes: 1,
        festivoModo: 'excluir',
        ventanaEntradaAntesMinutos: 30,
        ventanaEntradaDespuesMinutos: 30,
        ventanaSalidaAntesMinutos: 0,
        ventanaSalidaDespuesMinutos: 30,
        ventanaNovedadHoras: 48
      };

      return new Promise((resolve) => {
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
          draft.frecuenciaTipo = get('frecuenciaTipo') || 'todos';
          draft.frecuenciaSemanas = Math.max(1, Number(get('frecuenciaSemanas') || 1));
          draft.fechaAncla = get('fechaAncla') || null;
          draft.semanaMes = Number(get('semanaMes') || 1);
          draft.festivoModo = get('festivoModo') || 'excluir';
          draft.ventanaEntradaAntesMinutos = Math.max(0, Number(get('ventanaEntradaAntesMinutos') || 0));
          draft.ventanaEntradaDespuesMinutos = Math.max(0, Number(get('ventanaEntradaDespuesMinutos') || 0));
          draft.ventanaSalidaAntesMinutos = Math.max(0, Number(get('ventanaSalidaAntesMinutos') || 0));
          draft.ventanaSalidaDespuesMinutos = Math.max(0, Number(get('ventanaSalidaDespuesMinutos') || 0));
          draft.ventanaNovedadHoras = Math.max(0, Number(get('ventanaNovedadHoras') || 0));
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
                ]))
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
              el('div', { className: 'shift-rule-group shift-rule-group--wide' }, [
                el('h4', { className: 'shift-rule-group__title' }, ['Ventanas']),
                el('div', { className: 'shift-rule-inline-grid' }, [
                  batchField('Entrada antes', batchInput('ventanaEntradaAntesMinutos', { type: 'number', min: '0', step: '1', value: String(draft.ventanaEntradaAntesMinutos ?? 30) })),
                  batchField('Entrada despues', batchInput('ventanaEntradaDespuesMinutos', { type: 'number', min: '0', step: '1', value: String(draft.ventanaEntradaDespuesMinutos ?? 30) })),
                  batchField('Salida antes', batchInput('ventanaSalidaAntesMinutos', { type: 'number', min: '0', step: '1', value: String(draft.ventanaSalidaAntesMinutos ?? 0) })),
                  batchField('Salida despues', batchInput('ventanaSalidaDespuesMinutos', { type: 'number', min: '0', step: '1', value: String(draft.ventanaSalidaDespuesMinutos ?? 30) })),
                  batchField('Plazo para novedades', batchInput('ventanaNovedadHoras', { type: 'number', min: '0', step: '1', value: String(draft.ventanaNovedadHoras ?? 48) }))
                ])
              ])
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
          readBatchDraft();
          if (!validateBatch()) return;
          ['1', '2', '3', '4', '5'].forEach((day) => {
            modalRules.push({
              ...blankRule(modalRules, 'dia_semana', day),
              nombre: draft.nombre || null,
              horaInicio: draft.horaInicio,
              horaFin: draft.horaFin,
              cruzaDia: draft.cruzaDia,
              frecuenciaTipo: draft.frecuenciaTipo,
              frecuenciaSemanas: draft.frecuenciaTipo === 'cada_n_semanas' ? draft.frecuenciaSemanas : 1,
              fechaAncla: draft.frecuenciaTipo === 'cada_n_semanas' ? draft.fechaAncla : null,
              semanaMes: draft.frecuenciaTipo === 'mensual' ? draft.semanaMes : null,
              festivoModo: draft.festivoModo || 'excluir',
              ventanaEntradaAntesMinutos: draft.ventanaEntradaAntesMinutos,
              ventanaEntradaDespuesMinutos: draft.ventanaEntradaDespuesMinutos,
              ventanaSalidaAntesMinutos: draft.ventanaSalidaAntesMinutos,
              ventanaSalidaDespuesMinutos: draft.ventanaSalidaDespuesMinutos,
              ventanaNovedadHoras: draft.ventanaNovedadHoras
            });
          });
          closeBatch(true);
        }

        function closeBatch(changed = false) {
          document.removeEventListener('keydown', onBatchEsc);
          batchOverlay.remove();
          resolve(changed);
        }

        function onBatchEsc(ev) {
          if (ev.key !== 'Escape') return;
          ev.stopImmediatePropagation();
          closeBatch(false);
        }

        batchFooter.children[0].addEventListener('click', () => closeBatch(false));
        batchFooter.children[1].addEventListener('click', applyBatch);
        batchHeader.querySelector('.action-modal__close')?.addEventListener('click', () => closeBatch(false));
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
            ], row.cruzaDia ? 'true' : 'false')))
          ]),
          el('div', { className: 'shift-rule-group' }, [
            el('h4', { className: 'shift-rule-group__title' }, ['Repeticion']),
            ...recurrenceControls(row)
          ]),
          el('div', { className: 'shift-rule-group shift-rule-group--wide' }, [
            el('h4', { className: 'shift-rule-group__title' }, ['Ventanas']),
            el('div', { className: 'shift-rule-inline-grid' }, [
              smallNumber('Entrada antes', 'ventanaEntradaAntesMinutos', row.ventanaEntradaAntesMinutos),
              smallNumber('Entrada despues', 'ventanaEntradaDespuesMinutos', row.ventanaEntradaDespuesMinutos),
              smallNumber('Salida antes', 'ventanaSalidaAntesMinutos', row.ventanaSalidaAntesMinutos),
              smallNumber('Salida despues', 'ventanaSalidaDespuesMinutos', row.ventanaSalidaDespuesMinutos),
              smallNumber('Plazo para novedades', 'ventanaNovedadHoras', row.ventanaNovedadHoras)
            ])
          ]),
        ])
      ]);
    }

    function labeledControl(label, inputNode) {
      return el('label', { className: 'shift-rule-control' }, [
        el('span', {}, [label]),
        inputNode
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
          _localId: localId,
          nombre: String(get('nombre') || '').trim() || null,
          tipoDia,
          diaSemana: tipoDia === 'festivo' ? null : dayCondition,
          horaInicio: get('horaInicio'),
          horaFin: get('horaFin'),
          cruzaDia: get('cruzaDia') === 'true',
          frecuenciaTipo,
          frecuenciaSemanas: Math.max(1, Number(get('frecuenciaSemanas') || 1)),
          fechaAncla: get('fechaAncla') || null,
          semanaMes: frecuenciaTipo === 'mensual' ? Number(get('semanaMes') || 1) : null,
          festivoModo: tipoDia === 'festivo' ? 'normal' : (get('festivoModo') || 'excluir'),
          ventanaEntradaAntesMinutos: Math.max(0, Number(get('ventanaEntradaAntesMinutos') || 0)),
          ventanaEntradaDespuesMinutos: Math.max(0, Number(get('ventanaEntradaDespuesMinutos') || 0)),
          ventanaSalidaAntesMinutos: Math.max(0, Number(get('ventanaSalidaAntesMinutos') || 0)),
          ventanaSalidaDespuesMinutos: Math.max(0, Number(get('ventanaSalidaDespuesMinutos') || 0)),
          ventanaNovedadHoras: Math.max(0, Number(get('ventanaNovedadHoras') || 0)),
          orden: previous.orden || idx + 1,
          estado: previous.estado || 'activo'
        };
      });
    }

    function addRule(type, day, rerender = true) {
      modalRules.push(blankRule(modalRules, type, day));
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
      modalRules.forEach((row) => {
        if (!/^\d{2}:\d{2}$/.test(String(row.horaInicio || '')) || !/^\d{2}:\d{2}$/.test(String(row.horaFin || ''))) {
          throw new Error('Todos los horarios deben tener hora de inicio y fin.');
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
      try {
        readModalDraft();
        validateDraft();
        const planPayload = {
          nombre: basePlan.nombre,
          notasProgramacion: basePlan.notasProgramacion || null,
          estado: basePlan.estado || 'activo',
          orden: basePlan.orden || nextPlanOrder()
        };
        const savedPlan = basePlan.id
          ? await deps.updateShiftTemplate?.(basePlan.id, planPayload)
          : await deps.createShiftTemplate?.(planPayload);
        const templateId = savedPlan?.id || basePlan.id;
        const rulePayloads = modalRules.map((row) => ({
          id: row.id || null,
          templateId,
          nombre: row.nombre,
          tipoDia: row.tipoDia,
          diaSemana: row.diaSemana,
          horaInicio: row.horaInicio,
          horaFin: row.horaFin,
          cruzaDia: row.cruzaDia,
          frecuenciaTipo: row.frecuenciaTipo,
          frecuenciaSemanas: row.frecuenciaTipo === 'cada_n_semanas' ? row.frecuenciaSemanas : 1,
          fechaAncla: row.frecuenciaTipo === 'cada_n_semanas' ? row.fechaAncla : null,
          semanaMes: row.frecuenciaTipo === 'mensual' ? row.semanaMes : null,
          festivoModo: row.tipoDia === 'festivo' ? 'normal' : row.festivoModo,
          ventanaEntradaAntesMinutos: row.ventanaEntradaAntesMinutos,
          ventanaEntradaDespuesMinutos: row.ventanaEntradaDespuesMinutos,
          ventanaSalidaAntesMinutos: row.ventanaSalidaAntesMinutos,
          ventanaSalidaDespuesMinutos: row.ventanaSalidaDespuesMinutos,
          ventanaNovedadHoras: row.ventanaNovedadHoras,
          orden: row.orden,
          estado: 'activo'
        }));
        if (typeof deps.saveShiftTemplateRules === 'function') {
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
        await deps.addAuditLog?.({
          targetType: 'shift_template',
          targetId: templateId,
          action: basePlan.id ? 'save_shift_plan' : 'create_shift_plan',
          before: template || null,
          after: { plan: planPayload, rules: modalRules.length, removedRules: removedRuleIds.size }
        });
        dirty = false;
        await closeModal(false);
        notify(basePlan.id ? 'Plan de turnos actualizado.' : 'Plan de turnos creado.', 'success');
        await refreshRuleCounts();
      } catch (error) {
        notify('Error: ' + (error?.message || error), 'error');
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
      if (confirmDirty && !(await confirmDiscardChanges())) return false;
      document.removeEventListener('keydown', onEsc);
      overlay.remove();
      return true;
    }

    async function onEsc(ev) {
      if (document.querySelector('.shift-weekday-modal')) return;
      if (ev.key === 'Escape') await closeModal(true);
    }

    footer.children[0].addEventListener('click', () => { closeModal(true); });
    footer.children[1].addEventListener('click', saveModal);
    header.querySelector('.action-modal__close')?.addEventListener('click', () => { closeModal(true); });
    document.addEventListener('keydown', onEsc);

    renderModalBody();
    dialog.append(header, body, footer);
    overlay.append(dialog);
    document.body.append(overlay);
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

  unTemplates = deps.streamShiftTemplates?.((rows) => {
    templates = Array.isArray(rows) ? rows : [];
    render();
    if (!isGeneratedScreen) refreshRuleCounts();
  }) || (() => {});
  unSedes = deps.streamSedes?.((rows) => {
    sedes = Array.isArray(rows) ? rows : [];
    render();
  }) || (() => {});
  unEmployees = deps.streamActiveBaseEmployees?.((rows) => {
    employees = Array.isArray(rows) ? rows : [];
  }) || (() => {});

  mount.replaceChildren(ui);
  applyStoredGeneratedFilters();
  render();
  if (isGeneratedScreen) loadGeneratedShifts({ silent: true });
  if (isReviewScreen) loadShiftReview({ silent: true });
  return () => {
    disposed = true;
    unTemplates?.();
    unSedes?.();
    unEmployees?.();
  };
}

function saveGeneratedFilters(filters = {}) {
  try {
    sessionStorage.setItem(GENERATED_FILTERS_KEY, JSON.stringify(filters || {}));
  } catch (_) {}
}
