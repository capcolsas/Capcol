import { el, lucideInlineIcon } from '../utils/dom.js';
import { subscribe } from '../state.js';
import { contractFilterCode, contractMatches } from '../utils/contractScope.js';
import { summaryMetric } from './dashboards/DashboardUI.js';
import { summarizeShiftCoverage } from '../utils/shiftCoverage.js';
import { isReviewableShiftStatus, entryMinutesFromStart } from '../utils/shiftReview.js';
import { showInfoModal, closeInfoModal } from '../utils/infoModal.js';
import { downloadContractDashboardPdf } from '../utils/contractDashboardPdf.js';
import { dateAt, isoDate, mondayOf } from './dashboards/contractDashboardDemo.js';

const formatDate = (iso, options = {}) => new Intl.DateTimeFormat('es-CO', { timeZone: 'UTC', day: 'numeric', month: 'short', ...options }).format(dateAt(iso));
const percent = (part, total) => `${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 }).format(total ? part / total * 100 : 0)} %`;

export const ContractDashboard = (mount, deps = {}) => {
  let week = mondayOf(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date()));
  let allAlerts = false;
  let incapacityPeople = [];
  let incapacitiesLoad = 'loading';
  let incapacityRequest = 0;
  let contracts = [];
  let contractLoad = deps.streamContracts ? 'loading' : 'error';
  let failedLoad = false;
  let sites = [];
  let sitesLoad = deps.streamSedes ? 'loading' : 'error';
  let sitesFailedLoad = false;
  let employees = [];
  let employeesLoad = 'loading';
  let employeeRequest = 0;
  let assignments = [];
  let assignmentsLoad = 'loading';
  let assignmentRequest = 0;
  let coverage = { rows: [], total: {} };
  let coverageLoad = 'loading';
  let coverageRequest = 0;
  let calendarRequest = 0;
  let disposed = false;
  const ui = el('section', { className: 'main-card contract-dashboard-demo' });
  mount.replaceChildren(ui);
  render();
  const unSelected = subscribe('selectedContractCode', () => reloadWeek());
  const unContracts = deps.streamContracts?.(rows => {
    if (disposed) return;
    if (failedLoad) { failedLoad = false; return; }
    contracts = rows || [];
    contractLoad = 'ready';
    render();
  }, (_error, reason) => {
    if (disposed || (reason !== 'LOAD_ERROR' && contractLoad === 'ready')) return;
    failedLoad = reason === 'LOAD_ERROR';
    contractLoad = 'error';
    render();
  });
  const unSites = deps.streamSedes?.(rows => {
    if (disposed) return;
    if (sitesFailedLoad) { sitesFailedLoad = false; return; }
    sites = rows || [];
    sitesLoad = 'ready';
    render();
  }, (_error, reason) => {
    if (disposed || (reason !== 'LOAD_ERROR' && sitesLoad === 'ready')) return;
    sitesFailedLoad = reason === 'LOAD_ERROR';
    sitesLoad = 'error';
    render();
  });
  const unEmployees = deps.watchEmployeesAdminChanges?.(() => loadEmployees());
  loadEmployees();
  loadAssignments();
  loadCoverage();
  loadIncapacities();
  return () => { disposed = true; unSelected(); unContracts?.(); unSites?.(); unEmployees?.(); closeInfoModal(); };

  async function loadIncapacities() {
    const request = ++incapacityRequest;
    const code = contractFilterCode();
    const from = week, to = isoDate(dateAt(week, 6));
    incapacityPeople = [];
    incapacitiesLoad = 'loading';
    render();
    if (!code || disposed) return;
    try {
      if (!deps.listIncapacidadesRange) throw new Error('Consulta no disponible');
      const rows = await deps.listIncapacidadesRange(from, to, { contratoCodigo: code });
      if (disposed || request !== incapacityRequest) return;
      const people = new Map(), seen = new Set();
      for (const row of rows || []) {
        const source = String(row.source || '').trim().toLowerCase();
        if (row.contratoCodigo !== code || row.fechaInicio > to || row.fechaFin < from || !row.fechaInicio || !row.fechaFin
          || String(row.estado || 'activo').trim().toLowerCase() !== 'activo'
          || (source && !['enfermedad general', 'accidente laboral'].includes(source))
          || [row.soporteUrl, row.soporteStoragePath].some(value => String(value || '').trim())) continue;
        if (row.id && seen.has(row.id)) continue;
        if (row.id) seen.add(row.id);
        const doc = String(row.documento || '').trim();
        const key = doc ? `doc:${doc}` : row.employeeId ? `id:${row.employeeId}` : `record:${row.id}`;
        if (!people.has(key)) people.set(key, { nombre: row.nombre || 'Nombre no registrado', documento: doc, count: 0 });
        people.get(key).count++;
      }
      incapacityPeople = [...people.values()].sort((a, b) => b.count - a.count || a.nombre.localeCompare(b.nombre) || a.documento.localeCompare(b.documento));
      incapacitiesLoad = 'ready';
    } catch (_error) {
      if (disposed || request !== incapacityRequest) return;
      incapacitiesLoad = 'error';
    }
    render();
  }

  async function loadEmployees() {
    const request = ++employeeRequest;
    const code = contractFilterCode();
    employees = [];
    employeesLoad = 'loading';
    render();
    if (!code || disposed) return;
    try {
      if (!deps.listActiveBaseEmployees) throw new Error('Consulta no disponible');
      const rows = await deps.listActiveBaseEmployees({ contratoCodigo: code, fecha: isoDate(dateAt(week, 6)) });
      if (disposed || request !== employeeRequest) return;
      employees = rows || [];
      employeesLoad = 'ready';
    } catch (_error) {
      if (disposed || request !== employeeRequest) return;
      employeesLoad = 'error';
    }
    render();
  }

  async function loadAssignments() {
    const request = ++assignmentRequest;
    const code = contractFilterCode();
    const from = week, to = isoDate(dateAt(week, 6));
    assignments = [];
    assignmentsLoad = 'loading';
    render();
    if (!code || disposed) return;
    try {
      if (!deps.listScheduledShiftsRange || !deps.listShiftAssignmentsForShifts) throw new Error('Consulta no disponible');
      const shifts = await deps.listScheduledShiftsRange(from, to, {
        contratoCodigo: code, estados: ['programado', 'abierto', 'cerrado']
      });
      if (disposed || request !== assignmentRequest) return;
      const ids = new Set((shifts || []).filter(shift => shift.contratoCodigo === code
        && shift.fechaOperativa >= from && shift.fechaOperativa <= to && shift.estado !== 'cancelado')
        .map(shift => shift.id).filter(Boolean));
      const rows = ids.size ? await deps.listShiftAssignmentsForShifts([...ids], { summaryOnly: true }) : [];
      if (disposed || request !== assignmentRequest) return;
      assignments = (rows || []).filter(row => ids.has(row.scheduledShiftId)
        && !['cancelado', 'reemplazado'].includes(String(row.estado || 'asignado').trim().toLowerCase()));
      assignmentsLoad = 'ready';
    } catch (_error) {
      if (disposed || request !== assignmentRequest) return;
      assignmentsLoad = 'error';
    }
    render();
  }

  async function loadCoverage() {
    const request = ++coverageRequest;
    const code = contractFilterCode();
    const from = week, to = isoDate(dateAt(week, 6));
    coverage = { rows: [], total: {} };
    coverageLoad = 'loading';
    render();
    if (!code || disposed) return;
    try {
      const result = await readCoverage(from, to, code, () => !disposed && request === coverageRequest);
      if (disposed || request !== coverageRequest) return;
      coverage = result;
      coverageLoad = 'ready';
    } catch (_error) {
      if (disposed || request !== coverageRequest) return;
      coverageLoad = 'error';
    }
    render();
  }
  async function readCoverage(from, to, code, isCurrent) {
    if (!deps.listScheduledShiftsRange || !deps.listShiftAssignmentsForShifts || !deps.listEmployeeShiftStatusRange) throw new Error('Consulta no disponible');
    const [shifts, rawStatuses, dailyStatuses] = await Promise.all([
      deps.listScheduledShiftsRange(from, to, { contratoCodigo: code, estados: ['programado', 'abierto', 'cerrado', 'cancelado'] }),
      deps.listEmployeeShiftStatusRange(from, to, { contratoCodigo: code }),
      deps.listEmployeeDailyStatusRange ? deps.listEmployeeDailyStatusRange(from, to, { contratoCodigo: code }) : Promise.resolve([])
    ]);
    if (!isCurrent()) return null;
    // The replacement decision for a novelty (reemplazo/ausentismo) is recorded on employee_daily_status, not on
    // employee_shift_status, so shift coverage otherwise never sees it and counts every replaced absence as a plain
    // absence instead. Overlay it here from the same-day daily status of that person.
    const dailyStatusByKey = new Map();
    (dailyStatuses || []).forEach(row => {
      if (!row.employeeId && !row.documento) return;
      dailyStatusByKey.set(`${row.employeeId || row.documento}|${row.fecha}`, row);
    });
    const statuses = (rawStatuses || []).map(status => {
      if (!status.employeeId && !status.documento) return status;
      const daily = dailyStatusByKey.get(`${status.employeeId || status.documento}|${status.fechaOperativa}`);
      if (!daily) return status;
      let next = status;
      if (daily.decisionCobertura !== 'no_aplica' && next.decisionCobertura === 'no_aplica') {
        next = { ...next,
          decisionCobertura: daily.decisionCobertura,
          reemplazadoPorEmployeeId: daily.reemplazadoPorEmployeeId,
          reemplazadoPorDocumento: daily.reemplazadoPorDocumento,
          reemplazadoPorNombre: daily.reemplazadoPorNombre
        };
      }
      // The person genuinely reported being present that day (e.g. a compensatory day reported before this shift
      // was linked to novelties other than "Trabajando") but this shift-specific row was never marked attended.
      // Do not let a known-present person show as pending/absent here.
      if (daily.asistio === true && next.asistio !== true && !next.entradaAt) next = { ...next, asistio: true };
      // The novelty code/name (vacaciones, incapacidad, licencia...) and the incapacity record it came from also
      // only live on employee_daily_status. Without them, a justified absence whose shift was auto-closed with
      // nothing of its own reported looks exactly like "nada reportado" and gets miscounted as unjustified below.
      if (!next.novedadCodigo && !next.novedadNombre && (daily.novedadCodigo || daily.novedadNombre)) {
        next = { ...next, novedadCodigo: daily.novedadCodigo, novedadNombre: daily.novedadNombre,
          sourceIncapacityId: next.sourceIncapacityId || daily.sourceIncapacityId };
      }
      return next;
    });
    const scoped = (shifts || []).filter(shift => shift.contratoCodigo === code && shift.fechaOperativa >= from
      && shift.fechaOperativa <= to && shift.estado !== 'cancelado');
    const ids = [...new Set(scoped.map(shift => shift.id).filter(Boolean))];
    const assigned = ids.length ? await deps.listShiftAssignmentsForShifts(ids, { summaryOnly: true }) : [];
    if (!isCurrent()) return null;
    const days = Math.round((dateAt(to) - dateAt(from)) / 86400000) + 1;
    const shiftById = new Map((shifts || []).map(shift => [shift.id, shift]));
    const reviewRows = (statuses || []).filter(isReviewableShiftStatus)
      .map(row => ({ ...row, shift: shiftById.get(row.scheduledShiftId) || {} }))
      .sort((a, b) => String(b.fechaOperativa || '').localeCompare(String(a.fechaOperativa || ''))
        || String(a.nombre || '').localeCompare(String(b.nombre || '')));
    return {
      ...summarizeShiftCoverage(Array.from({ length: days }, (_, index) => isoDate(dateAt(from, index))), scoped, assigned || [], statuses || []),
      reviewCount: reviewRows.length,
      reviewRows
    };
  }
  function coverageMessage() {
    if (!contractFilterCode()) return 'Selecciona un contrato';
    if (coverageLoad === 'loading') return 'Cargando cobertura...';
    if (coverageLoad === 'error') return 'No se pudo cargar la cobertura';
    return '';
  }
  function coverageMetric() {
    const message = coverageMessage();
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
    const currentWeek = week <= today && today <= isoDate(dateAt(week, 6));
    const total = currentWeek ? coverage.rows.filter(row => row.date <= today).reduce((sum, row) => ({
      assigned: sum.assigned + row.assigned, covered: sum.covered + row.covered
    }), { assigned: 0, covered: 0 }) : coverage.total;
    return metric('Cobertura de turnos', message || !total.assigned ? '—' : percent(total.covered, total.assigned), 'clock-3', 'blue',
      message || (total.assigned ? `${total.covered} de ${total.assigned} turnos${currentWeek ? ' hasta hoy' : ''}` : `Sin turnos asignados${currentWeek ? ' hasta hoy' : ''}`));
  }
  function openNoveltiesMetric() {
    const card = (value, detail) => metric('Novedades abiertas', value, 'triangle-alert', 'danger', detail);
    if (!contractFilterCode()) return card('—', 'Selecciona un contrato');
    if (coverageLoad === 'loading') return card('—', 'Cargando novedades...');
    if (coverageLoad === 'error') return card('—', 'No se pudo cargar las novedades');
    return card(coverage.reviewCount, coverage.reviewCount ? 'Pendientes en revision de turnos' : 'Sin pendientes de revision');
  }
  function absenteeismMetric() {
    const card = (value, detail) => metric('Ausentismo semanal', value, 'user-round-minus', 'violet', detail);
    if (!contractFilterCode()) return card('—', 'Selecciona un contrato');
    if (coverageLoad === 'loading') return card('—', 'Cargando ausentismo...');
    if (coverageLoad === 'error') return card('—', 'No se pudo cargar el ausentismo');
    const total = coverage.total;
    if (!total.assigned) return card('—', 'Sin turnos asignados');
    const absences = total.absent;
    const node = card(percent(absences, total.assigned), `${absences} ${absences === 1 ? 'ausencia' : 'ausencias'} sin reemplazo`);
    // The KPI already covers what the removed "Ausentismo semanal" alert showed; keep its per-person/date detail
    // reachable by making the card itself open the same breakdown, instead of duplicating the count as an alert.
    if (coverage.absencePeople?.length) {
      node.onclick = openAbsenteeismDetails;
      if (node.style) node.style.cursor = 'pointer';
      node.role = 'button';
      node.tabIndex = 0;
      node.ariaLabel = `Ausentismo semanal, ${absences} ${absences === 1 ? 'ausencia' : 'ausencias'} sin reemplazo. Ver detalle.`;
    }
    return node;
  }
  function openAbsenteeismDetails() {
    if (!contractFilterCode() || coverageLoad !== 'ready' || !coverage.absencePeople?.length) return;
    const total = coverage.total;
    const content = el('div', {}, [
      el('p', { className: 'text-muted' }, [`${total.absent + total.replaced} faltas: ${total.replaced} con reemplazo y ${total.absent} sin reemplazo. Ordenado por ausencias sin reemplazo, de mayor a menor.`]),
      el('div', { className: 'table-wrap' }, [el('table', { className: 'table', 'aria-label': 'Detalle de ausentismo semanal' }, [
        el('thead', {}, [el('tr', {}, ['Persona', 'Total faltas', 'Con reemplazo', 'Sin reemplazo', 'Fechas'].map(label => el('th', { scope: 'col' }, [label])))]),
        el('tbody', {}, coverage.absencePeople.map(person => el('tr', {}, [
          el('th', { scope: 'row' }, [[person.nombre, person.documento ? `(${person.documento})` : ''].filter(Boolean).join(' ')]),
          ...[person.total, person.replaced, person.absent].map(value => el('td', {}, [String(value)])),
          el('td', {}, [person.dates.map(date => formatDate(date)).join(', ')])
        ]))),
        el('tfoot', {}, [el('tr', {}, [el('th', { scope: 'row' }, ['Total']),
          ...[total.absent + total.replaced, total.replaced, total.absent].map(value => el('td', {}, [String(value)])), el('td', {}, [''])])])
      ])])
    ]);
    showInfoModal('Ausentismo semanal · Detalle de faltas', [content]);
  }
  function reviewAlert() {
    const ready = Boolean(contractFilterCode()) && coverageLoad === 'ready';
    const count = ready ? coverage.reviewCount : 0;
    const title = !contractFilterCode() ? 'Selecciona un contrato'
      : coverageLoad === 'loading' ? 'Cargando pendientes de revision...'
        : coverageLoad === 'error' ? 'No se pudieron cargar los pendientes'
          : count ? `${count} ${count === 1 ? 'pendiente' : 'pendientes'} de revision de turnos` : 'Sin pendientes de revision';
    return el('button', { type: 'button', className: 'contract-demo__alert', 'data-alert': 'review', disabled: !ready || !count, onclick: openReviewDetails }, [
      iconTile('clipboard-check', count ? 'danger' : 'teal'),
      el('span', { className: 'contract-demo__alert-copy' }, [el('strong', {}, [title]),
        el('span', {}, [count ? 'Ver fecha, persona, sede y motivo' : 'Contrato y semana seleccionados'])]),
      ...(count ? [lucideInlineIcon('chevron-right', '>')] : [])
    ]);
  }
  function hiringPendingData() {
    const code = contractFilterCode();
    if (!code) return { message: 'Selecciona un contrato' };
    if (employeesLoad === 'error' || sitesLoad === 'error') return { message: 'No se pudieron cargar los pendientes de contratacion' };
    if (employeesLoad !== 'ready' || sitesLoad !== 'ready') return { message: 'Cargando pendientes de contratacion...' };
    const activeSites = sites.filter(site => contractMatches(site, code)
      && String(site.estado || 'activo').trim().toLowerCase() === 'activo');
    if (activeSites.some(site => site.numeroOperarios == null || String(site.numeroOperarios).trim() === ''
      || !Number.isInteger(Number(site.numeroOperarios)) || Number(site.numeroOperarios) < 0)) {
      return { message: 'Hay sedes sin requerimiento valido' };
    }
    const bySite = new Map();
    for (const employee of employees) {
      if (String(employee.contratoCodigo || '').trim() !== code) continue;
      const site = String(employee.sedeCodigo || '').trim();
      if (site) bySite.set(site, (bySite.get(site) || 0) + 1);
    }
    const rows = activeSites.map(site => {
      const contracted = bySite.get(String(site.codigo || '').trim()) || 0;
      const planned = Number(site.numeroOperarios);
      return { name: site.nombre || site.codigo || 'Sede sin nombre', planned, contracted, pending: Math.max(0, planned - contracted) };
    }).filter(row => row.pending > 0).sort((a, b) => a.name.localeCompare(b.name));
    return { rows, total: rows.reduce((sum, row) => sum + row.pending, 0) };
  }
  function hiringAlert() {
    const data = hiringPendingData();
    const title = data.message || (data.total ? `${data.total} ${data.total === 1 ? 'persona pendiente' : 'personas pendientes'} de contratar` : 'Sin pendientes de contratacion');
    const detail = data.message ? 'Contrato y semana seleccionados'
      : !data.total ? 'Requerimiento cubierto en las sedes activas'
        : data.rows.length <= 3 ? data.rows.map(row => `${row.name}: ${row.pending}`).join(' · ') : 'Ver mas';
    return el('button', { type: 'button', className: 'contract-demo__alert', 'data-alert': 'hiring', disabled: Boolean(data.message) || !data.total, onclick: openHiringDetails }, [
      iconTile('users', data.total ? 'warning' : 'green'),
      el('span', { className: 'contract-demo__alert-copy' }, [el('strong', {}, [title]), el('span', {}, [detail])]),
      ...(data.total ? [lucideInlineIcon('chevron-right', '>')] : [])
    ]);
  }
  function openHiringDetails() {
    const data = hiringPendingData();
    if (data.message || !data.total) return;
    showInfoModal('Pendientes de contratacion por sede', [
      el('div', { className: 'table-wrap' }, [el('table', { className: 'table', 'aria-label': 'Pendientes de contratacion por sede' }, [
        el('thead', {}, [el('tr', {}, ['Sede', 'Planeados', 'Contratados', 'Pendientes'].map(label => el('th', { scope: 'col' }, [label])))]),
        el('tbody', {}, data.rows.map(row => el('tr', {}, [
          el('th', { scope: 'row' }, [row.name]), ...[row.planned, row.contracted, row.pending].map(value => el('td', {}, [String(value)]))
        ]))),
        el('tfoot', {}, [el('tr', {}, [el('th', { scope: 'row', colSpan: 3 }, ['Total pendiente']), el('td', {}, [String(data.total)])])])
      ])])
    ]);
  }
  function unjustifiedAlert() {
    const ready = Boolean(contractFilterCode()) && coverageLoad === 'ready';
    const count = ready ? coverage.unjustifiedCount : 0;
    // Unlike "Ausentismo semanal" (only absences without replacement), this includes unjustified absences that
    // were replaced too, so the count is not directly comparable to that other KPI. Break it down the same way
    // absenteeismAlert does, so a bigger number here than "sin reemplazo" reads as consistent, not as an error.
    const replaced = ready ? coverage.unjustifiedPeople.reduce((sum, person) => sum + person.replaced, 0) : 0;
    const absent = ready ? coverage.unjustifiedPeople.reduce((sum, person) => sum + person.absent, 0) : 0;
    const title = !contractFilterCode() ? 'Selecciona un contrato'
      : coverageLoad === 'loading' ? 'Cargando ausencias no justificadas...'
        : coverageLoad === 'error' ? 'No se pudieron cargar las ausencias no justificadas'
          : `${count} ${count === 1 ? 'ausencia no justificada' : 'ausencias no justificadas'} en la semana`;
    return el('button', { type: 'button', className: 'contract-demo__alert', 'data-alert': 'unjustified', disabled: !ready || !count, onclick: openUnjustifiedDetails }, [
      iconTile('user-round-x', count ? 'danger' : 'teal'),
      el('span', { className: 'contract-demo__alert-copy' }, [el('strong', {}, [title]),
        el('span', {}, [count ? `${replaced} con reemplazo · ${absent} sin reemplazo · Ver detalle`
          : ready ? 'Sin ausencias no justificadas' : 'Contrato y semana seleccionados'])]),
      ...(count ? [lucideInlineIcon('chevron-right', '>')] : [])
    ]);
  }
  function openUnjustifiedDetails() {
    if (!contractFilterCode() || coverageLoad !== 'ready' || !coverage.unjustifiedCount) return;
    const content = el('div', {}, [
      el('p', { className: 'text-muted' }, ['Incluye las que ya tienen reemplazo: por eso el total puede ser mayor que "Ausentismo semanal", que solo cuenta las que quedaron sin reemplazo.']),
      el('div', { className: 'table-wrap' }, [el('table', { className: 'table', 'aria-label': 'Detalle de ausencias no justificadas' }, [
        el('thead', {}, [el('tr', {}, ['Persona', 'Ausencias no justificadas', 'Con reemplazo', 'Sin reemplazo', 'Fechas'].map(label => el('th', { scope: 'col' }, [label])))]),
        el('tbody', {}, coverage.unjustifiedPeople.map(person => el('tr', {}, [
          el('th', { scope: 'row' }, [[person.nombre, person.documento ? `(${person.documento})` : ''].filter(Boolean).join(' ')]),
          ...[person.total, person.replaced, person.absent].map(value => el('td', {}, [String(value)])),
          el('td', {}, [person.dates.map(date => formatDate(date)).join(', ')])
        ]))),
        el('tfoot', {}, [el('tr', {}, [el('th', { scope: 'row' }, ['Total']),
          el('td', {}, [String(coverage.unjustifiedCount)]),
          ...['replaced', 'absent'].map(key => el('td', {}, [String(coverage.unjustifiedPeople.reduce((sum, person) => sum + person[key], 0))])),
          el('td', {}, [''])])])
      ])])
    ]);
    showInfoModal('Ausencias no justificadas', [content]);
  }
  function unattendedAlert() {
    const ready = Boolean(contractFilterCode()) && coverageLoad === 'ready';
    const count = ready ? coverage.unattendedDayCount : 0;
    const title = !contractFilterCode() ? 'Selecciona un contrato'
      : coverageLoad === 'loading' ? 'Cargando sedes sin atencion...'
        : coverageLoad === 'error' ? 'No se pudieron cargar las sedes sin atencion'
          : `${count} ${count === 1 ? 'dia' : 'dias'} con sedes sin atencion en la semana`;
    return el('button', { type: 'button', className: 'contract-demo__alert', 'data-alert': 'unattended', disabled: !ready || !count, onclick: openUnattendedDetails }, [
      iconTile('building-2', count ? 'danger' : 'teal'),
      el('span', { className: 'contract-demo__alert-copy' }, [el('strong', {}, [title]),
        el('span', {}, [count ? 'Ver fechas y sedes sin atencion' : ready ? 'Sin sedes con falta de atencion confirmada' : 'Contrato y semana seleccionados'])]),
      ...(count ? [lucideInlineIcon('chevron-right', '>')] : [])
    ]);
  }
  function openUnattendedDetails() {
    if (!contractFilterCode() || coverageLoad !== 'ready' || !coverage.unattendedDayCount) return;
    showInfoModal('Sedes sin atencion', [
      el('div', { className: 'table-wrap' }, [el('table', { className: 'table', 'aria-label': 'Detalle de sedes sin atencion' }, [
        el('thead', {}, [el('tr', {}, ['Fecha', 'Sede'].map(label => el('th', { scope: 'col' }, [label])))]),
        el('tbody', {}, coverage.unattendedSiteDays.map(day => el('tr', {}, [
          el('td', {}, [formatDate(day.date)]), el('td', {}, [day.sedeNombre])
        ])))
      ])])
    ]);
  }
  function incapacityAlert() {
    const ready = Boolean(contractFilterCode()) && incapacitiesLoad === 'ready';
    const count = incapacityPeople.reduce((sum, person) => sum + person.count, 0);
    const title = !contractFilterCode() ? 'Selecciona un contrato'
      : incapacitiesLoad === 'loading' ? 'Cargando incapacidades sin soporte...'
        : incapacitiesLoad === 'error' ? 'No se pudieron cargar las incapacidades sin soporte'
          : `${count} ${count === 1 ? 'incapacidad' : 'incapacidades'} sin soporte`;
    return el('button', { type: 'button', className: 'contract-demo__alert', 'data-alert': 'incapacity', disabled: !ready || !count, onclick: openIncapacityDetails }, [
      iconTile('file-clock', count ? 'warning' : 'teal'),
      el('span', { className: 'contract-demo__alert-copy' }, [el('strong', {}, [title]),
        el('span', {}, [count ? 'Ver personas con soportes pendientes' : ready ? 'Sin soportes pendientes en la semana' : 'Contrato y semana seleccionados'])]),
      ...(count ? [lucideInlineIcon('chevron-right', '>')] : [])
    ]);
  }
  function openIncapacityDetails() {
    if (!contractFilterCode() || incapacitiesLoad !== 'ready' || !incapacityPeople.length) return;
    showInfoModal('Incapacidades sin soporte', [
      el('div', { className: 'table-wrap' }, [el('table', { className: 'table', 'aria-label': 'Detalle de incapacidades sin soporte' }, [
        el('thead', {}, [el('tr', {}, ['Persona', 'Incapacidades sin soporte'].map(label => el('th', { scope: 'col' }, [label])))]),
        el('tbody', {}, incapacityPeople.map(person => el('tr', {}, [
          el('th', { scope: 'row' }, [[person.nombre, person.documento ? `(${person.documento})` : ''].filter(Boolean).join(' ')]),
          el('td', {}, [String(person.count)])
        ]))),
        el('tfoot', {}, [el('tr', {}, [el('th', { scope: 'row' }, ['Total']),
          el('td', {}, [String(incapacityPeople.reduce((sum, person) => sum + person.count, 0))])])])
      ])])
    ]);
  }
  function unassignedPersonnelData() {
    const code = contractFilterCode();
    if (!code) return { message: 'Selecciona un contrato' };
    if (employeesLoad === 'error' || assignmentsLoad === 'error') return { message: 'No se pudo cargar el personal sin turnos' };
    if (employeesLoad !== 'ready' || assignmentsLoad !== 'ready') return { message: 'Cargando personal sin turnos...' };
    const ids = new Set(assignments.map(row => String(row.employeeId || '').trim()).filter(Boolean));
    const docs = new Set(assignments.map(row => String(row.documento || '').trim()).filter(Boolean));
    const seen = new Set();
    const rows = employees.filter(person => {
      const id = String(person.id || '').trim(), doc = String(person.documento || '').trim();
      const key = doc ? `doc:${doc}` : `id:${id}`;
      if (String(person.contratoCodigo || '').trim() !== code || (!id && !doc) || seen.has(key) || ids.has(id) || docs.has(doc)) return false;
      seen.add(key);
      return true;
    });
    const end = isoDate(dateAt(week, 6));
    const ranked = rows.map(person => {
      const ingreso = String(person.fechaIngreso || '').trim();
      const valid = /^\d{4}-\d{2}-\d{2}$/.test(ingreso) && Number.isFinite(dateAt(ingreso).getTime()) && isoDate(dateAt(ingreso)) === ingreso;
      const from = valid ? (ingreso > week ? ingreso : week) : null;
      const days = from ? Math.max(0, Math.round((dateAt(end) - dateAt(from)) / 86400000) + 1) : null;
      return { ...person, days, from };
    }).sort((a, b) => (b.days ?? -1) - (a.days ?? -1) || String(a.nombre || '').localeCompare(String(b.nombre || '')) || String(a.documento || '').localeCompare(String(b.documento || '')));
    return { rows: ranked, total: ranked.length };
  }
  function unassignedPersonnelAlert() {
    const data = unassignedPersonnelData();
    const title = data.message || `${data.total} ${data.total === 1 ? 'persona contratada sin turnos asignados' : 'personas contratadas sin turnos asignados'}`;
    return el('button', { type: 'button', className: 'contract-demo__alert', 'data-alert': 'unassigned', disabled: Boolean(data.message) || !data.total, onclick: openUnassignedPersonnelDetails }, [
      iconTile('calendar-x', data.total ? 'warning' : 'teal'),
      el('span', { className: 'contract-demo__alert-copy' }, [el('strong', {}, [title]),
        el('span', {}, [data.total ? 'Ver personas y dias sin turnos' : 'Contrato y semana seleccionados'])]),
      ...(data.total ? [lucideInlineIcon('chevron-right', '>')] : [])
    ]);
  }
  function openUnassignedPersonnelDetails() {
    const data = unassignedPersonnelData();
    if (data.message || !data.total) return;
    showInfoModal('Personas contratadas sin turnos asignados', [
      el('div', { className: 'table-wrap' }, [el('table', { className: 'table', 'aria-label': 'Detalle de personas sin turnos asignados' }, [
        el('thead', {}, [el('tr', {}, ['Persona', 'Sede', 'Desde', 'Dias sin turnos en la semana'].map(label => el('th', { scope: 'col' }, [label])))]),
        el('tbody', {}, data.rows.map(person => el('tr', {}, [
          el('th', { scope: 'row' }, [[person.nombre || 'Nombre no registrado', person.documento ? `(${person.documento})` : ''].filter(Boolean).join(' ')]),
          el('td', {}, [person.sedeNombre || person.sedeCodigo || 'Sin sede registrada']),
          el('td', {}, [person.from ? formatDate(person.from) : 'Ingreso no registrado']),
          el('td', {}, [person.days == null ? 'No disponible' : String(person.days)])
        ])))
      ])])
    ]);
  }
  function rankedAlerts(includeAll = allAlerts) {
    const ready = Boolean(contractFilterCode()) && coverageLoad === 'ready';
    const hiring = hiringPendingData();
    const unassigned = unassignedPersonnelData();
    return [
      { count: ready ? coverage.reviewCount : -1, render: reviewAlert },
      { count: hiring.message ? -1 : hiring.total, render: hiringAlert },
      // "Ausentismo semanal" already has its own KPI card above (absenteeismMetric); showing it again here too was
      // redundant.
      { count: ready ? coverage.unjustifiedCount : -1, render: unjustifiedAlert },
      { count: ready ? coverage.unattendedDayCount : -1, render: unattendedAlert },
      { count: contractFilterCode() && incapacitiesLoad === 'ready' ? incapacityPeople.reduce((sum, person) => sum + person.count, 0) : -1, render: incapacityAlert },
      { count: unassigned.message ? -1 : unassigned.total, render: unassignedPersonnelAlert }
    ].sort((a, b) => b.count - a.count)
      .slice(0, includeAll ? undefined : 4).map(alert => alert.render());
  }
  function openReviewDetails() {
    if (!contractFilterCode() || coverageLoad !== 'ready' || !coverage.reviewRows?.length) return;
    const content = el('div', {}, [
      el('div', { className: 'table-wrap' }, [el('table', { className: 'table', 'aria-label': 'Pendientes de revision de turnos' }, [
        el('thead', {}, [el('tr', {}, ['Fecha', 'Persona', 'Sede', 'Motivo'].map(label => el('th', { scope: 'col' }, [label])))]),
        el('tbody', {}, coverage.reviewRows.map(row => el('tr', {}, [
          el('td', {}, [row.fechaOperativa || row.shift.fechaOperativa || 'No registrada']),
          el('td', {}, [[row.nombre || 'Nombre no registrado', row.documento ? `(${row.documento})` : ''].filter(Boolean).join(' ')]),
          el('td', {}, [row.shift.sedeNombre || row.sedeCodigo || row.shift.sedeCodigo || 'No registrada']),
          el('td', {}, [reviewReason(row)])
        ])))
      ])])
    ]);
    showInfoModal('Pendientes de revision de turnos', [content]);
  }
  function reviewReason(row) {
    const reasons = [];
    const entryMinutes = entryMinutesFromStart(row, row.shift);
    const states = {
      post_cierre_pendiente: 'Registro posterior al cierre', salida_pendiente: 'Salida pendiente',
      retiro_anticipado: 'Retiro anticipado', trabajado_tardio: 'Entrada tardia'
    };
    const state = String(row.estadoTurno || '').trim();
    if (states[state]) reasons.push(states[state]);
    for (const [field, label] of [['earlyEntryMinutes', 'Entrada anticipada'], ['lateEntryMinutes', 'Entrada tardia'],
      ['earlyExitMinutes', 'Salida anticipada'], ['lateExitMinutes', 'Salida tardia']]) {
      const minutes = Number(row[field] || 0);
      if (minutes > 0) {
        const displayedMinutes = field in entryMinutes ? entryMinutes[field] : minutes;
        const description = `${label}: ${displayedMinutes == null ? 'No calculable' : `${displayedMinutes} min`}`;
        const index = reasons.indexOf(label);
        if (index >= 0) reasons[index] = description;
        else reasons.push(description);
      }
    }
    return reasons.join(' · ') || 'Requiere revision';
  }

  function exportDashboard() {
    if (!contractFilterCode() || exportLoading()) return;
    try {
      const text = (node, selector) => node.querySelector(selector)?.textContent.trim() || '';
      const contract = contracts.find(row => String(row.codigo || '').trim() === contractFilterCode());
      downloadContractDashboardPdf({
        code: contractFilterCode(), name: contract?.nombre || '', from: week, to: isoDate(dateAt(week, 6)),
        metrics: [...ui.querySelectorAll('.contract-demo__metric')].map(node => ({
          label: text(node, '.contract-demo__metric-label'), value: text(node, '.metric-tile__value'), detail: text(node, '.contract-demo__metric-detail')
        })),
        schedule: [...ui.querySelectorAll('.contract-demo__table tr')].map(row => [...row.querySelectorAll('th, td')].map(cell => cell.textContent.trim().replace('Hoy ·', ' · Hoy ·'))),
        scheduleMessage: coverageMessage() || (!coverage.total.assigned ? 'No hay turnos asignados para esta semana.' : ''),
        facts: [...ui.querySelectorAll('.contract-demo__fact')].map(node => ({ label: text(node, '.text-muted'), value: text(node, '.contract-demo__fact-value') })),
        alerts: rankedAlerts(true).map(node => {
          const detail = text(node, '.contract-demo__alert-copy > span');
          return { title: text(node, 'strong'), detail: /^Ver /i.test(detail) ? '' : detail.replace(/ · Ver detalle$/, '') };
        })
      });
    } catch (_error) {
      showInfoModal('No se pudo generar el PDF', ['Vuelve a intentar la exportacion.']);
    }
  }
  function exportLoading() {
    return [contractLoad, sitesLoad, employeesLoad, assignmentsLoad, coverageLoad, incapacitiesLoad].includes('loading');
  }
  function render() {
    if (disposed) return;
    const weekEnd = isoDate(dateAt(week, 6));
    const picker = el('input', { className: 'input contract-demo__date', type: 'date', value: weekEnd, 'aria-label': 'Fecha final de la semana', min: '2020-01-12', max: '2035-12-30' });
    picker.addEventListener('change', () => {
      if (!picker.value || !picker.validity.valid) { picker.value = weekEnd; return; }
      week = mondayOf(picker.value); reloadWeek();
    });
    ui.replaceChildren(
      el('header', { className: 'contract-demo__header' }, [
        el('div', {}, [
          el('div', { className: 'contract-demo__heading' }, [el('h2', {}, ['Resumen del contrato'])])
        ]),
        el('div', { className: 'contract-demo__tools' }, [
          iconButton('chevron-left', 'Semana anterior', () => shiftWeek(-7)), picker,
          iconButton('chevron-right', 'Semana siguiente', () => shiftWeek(7)),
          el('button', { className: 'btn contract-demo__export', type: 'button', disabled: !contractFilterCode() || exportLoading(), onclick: exportDashboard }, [lucideInlineIcon('download', 'D'), 'Exportar PDF'])
        ])
      ]),
      el('div', { className: 'contract-demo__kpis' }, [
        contractedPersonnel(),
        confirmedPersonnel(),
        coverageMetric(),
        openNoveltiesMetric(),
        absenteeismMetric()
      ]),
      el('div', { className: 'contract-demo__columns' }, [
        el('section', { className: 'contract-demo__schedule', 'aria-labelledby': 'demo-schedule-title' }, [
          el('div', { className: 'contract-demo__section-head' }, [
            el('h3', { id: 'demo-schedule-title' }, ['Programacion de turnos']),
            el('span', { className: 'text-muted' }, [`${formatDate(week)} - ${formatDate(isoDate(dateAt(week, 6)))}`])
          ]),
          coverageMessage() ? el('p', { className: 'text-muted', role: 'status' }, [coverageMessage()])
            : !coverage.total.assigned ? el('p', { className: 'text-muted', role: 'status' }, ['No hay turnos asignados para este contrato en la semana seleccionada.'])
              : scheduleTable(coverage.rows, coverage.total),
          el('button', { type: 'button', className: 'contract-demo__text-link', onclick: openCalendar }, ['Ver calendario', lucideInlineIcon('arrow-right', '>')])
        ]),
        el('section', { className: 'contract-demo__alerts', 'aria-labelledby': 'demo-alert-title' }, [
          el('div', { className: 'contract-demo__section-head' }, [
            el('h3', { id: 'demo-alert-title' }, ['Alertas y novedades']),
            el('button', { className: 'contract-demo__text-link', type: 'button', 'aria-controls': 'contract-alert-list', 'aria-expanded': String(allAlerts), onclick: () => { allAlerts = !allAlerts; render(); } }, [allAlerts ? 'Ver menos' : 'Ver más'])
          ]),
          el('div', { id: 'contract-alert-list', className: 'contract-demo__alert-list' }, rankedAlerts())
        ])
      ]),
      contractStatus(),
      el('div', { className: 'contract-demo__footnote' }, [
        el('span', {}, [`Corte: ${formatDate(isoDate(dateAt(week, 6)), { year: 'numeric' })}`])
      ])
    );
  }
  function reloadWeek() { allAlerts = false; calendarRequest++; closeInfoModal(); loadEmployees(); loadAssignments(); loadCoverage(); loadIncapacities(); }
  function shiftWeek(days) { week = isoDate(dateAt(week, days)); reloadWeek(); }
  function confirmedPersonnel() {
    const card = (value, detail) => metric('Personal confirmado', value, 'circle-check', 'green', detail);
    const code = contractFilterCode();
    if (!code) return card('—', 'Selecciona un contrato');
    if (employeesLoad === 'error' || assignmentsLoad === 'error') return card('—', 'No se pudo cargar el personal con turnos');
    if (employeesLoad === 'loading' || assignmentsLoad === 'loading') return card('—', 'Cargando personal con turnos...');
    const contracted = employees.filter(employee => String(employee.contratoCodigo || '').trim() === code);
    const ids = new Set(assignments.map(row => String(row.employeeId || '').trim()).filter(Boolean));
    const documents = new Set(assignments.map(row => String(row.documento || '').trim()).filter(Boolean));
    const confirmed = new Set(contracted.filter(employee => ids.has(String(employee.id || '').trim())
      || documents.has(String(employee.documento || '').trim()))
      .map(employee => String(employee.documento || employee.id || '').trim()).filter(Boolean)).size;
    return card(confirmed, contracted.length ? `${percent(confirmed, contracted.length)} de ${contracted.length} contratados`
      : '0 contratados · Porcentaje no disponible');
  }
  function contractedPersonnel() {
    const card = (value, detail) => metric('Personal contratado', value, 'users', 'teal', detail);
    const code = contractFilterCode();
    if (!code) return card('—', 'Selecciona un contrato');
    if (employeesLoad === 'loading') return card('—', 'Cargando personal contratado...');
    if (employeesLoad === 'error') return card('—', 'No se pudo cargar el personal contratado');
    const contracted = employees.filter(employee => String(employee.contratoCodigo || '').trim() === code).length;
    if (sitesLoad === 'loading') return card(contracted, 'Cargando personal planeado...');
    if (sitesLoad === 'error') return card(contracted, 'Porcentaje no disponible: error al cargar el planeado');
    const activeSites = sites.filter(site => contractMatches(site, code)
      && String(site.estado || 'activo').trim().toLowerCase() === 'activo');
    const missing = activeSites.some(site => site.numeroOperarios == null || String(site.numeroOperarios).trim() === ''
      || !Number.isInteger(Number(site.numeroOperarios)) || Number(site.numeroOperarios) < 0);
    if (missing) return card(contracted, 'Porcentaje no disponible: hay sedes sin requerimiento valido');
    const total = activeSites.reduce((sum, site) => sum + Number(site.numeroOperarios), 0);
    return card(contracted, total > 0 ? `${percent(contracted, total)} de ${total} planeados` : '0 planeados · Porcentaje no disponible');
  }
  function contractField(field, format = value => value) {
    const code = contractFilterCode();
    if (!code) return 'Selecciona un contrato';
    if (contractLoad === 'loading') return 'Cargando...';
    if (contractLoad === 'error') return 'No se pudo cargar';
    const contract = contracts.find(item => String(item.codigo || '').trim() === code);
    if (!contract) return 'Contrato no disponible';
    const value = String(contract[field] || '').trim();
    return value ? format(value) : 'No registrado';
  }
  function contractDate(field, format = date => formatDate(date, { year: 'numeric' })) {
    return contractField(field, date => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(dateAt(date).getTime()) || isoDate(dateAt(date)) !== date) return 'Fecha no valida';
      return format(date);
    });
  }
  function contractValidity() {
    return contractDate('fechaFin', end => {
      const today = isoDate(dateAt(week, 6));
      const days = Math.max(0, Math.round((dateAt(end) - dateAt(today)) / 86400000));
      return days === 1 ? '1 dia restante' : `${days} dias restantes`;
    });
  }
  function contractTemporalStatus() {
    return contractDate('fechaInicio', start => contractDate('fechaFin', end => {
      if (end < start) return 'Fechas inconsistentes';
      const today = isoDate(dateAt(week, 6));
      return today < start ? 'Por iniciar' : today > end ? 'Finalizado' : 'Activo';
    }));
  }
  function contractProgress() {
    return contractDate('fechaInicio', start => contractDate('fechaFin', end => {
      if (end < start) return 'Fechas inconsistentes';
      const today = isoDate(dateAt(week, 6));
      // For a same-day contract, reaching its end date represents 100%.
      const progress = today >= end ? 100 : today <= start ? 0
        : Math.max(0, Math.min(100, Math.round((dateAt(today) - dateAt(start)) / (dateAt(end) - dateAt(start)) * 100)));
      return el('span', { className: 'contract-demo__execution' }, [
        el('strong', {}, [`${progress} %`]), el('progress', { value: progress, max: 100, 'aria-label': 'Ejecucion temporal del contrato' })
      ]);
    }));
  }
  function contractStatus() {
    const status = contractTemporalStatus();
    return el('section', { className: 'contract-demo__status', 'aria-labelledby': 'demo-status-title' }, [
      el('h3', { id: 'demo-status-title' }, ['Estado del contrato']),
      el('div', { className: 'contract-demo__facts' }, [
        fact('file-check', 'Estado', el('span', { className: status === 'Activo' ? 'badge badge--ok' : 'badge', title: 'Estado al cierre de la semana seleccionada' }, [status])),
        fact('calendar', 'Inicio', contractDate('fechaInicio')),
        fact('calendar-check', 'Fin', contractDate('fechaFin')),
        fact('clock-3', 'Vigencia', contractValidity()),
        fact('chart-no-axes-combined', 'Ejecucion temporal', contractProgress()),
        fact('user-round', 'Supervisor(a)', contractField('clienteContacto'))
      ])
    ]);
  }
  async function openCalendar() {
    const request = ++calendarRequest;
    const code = contractFilterCode();
    const weekEnd = isoDate(dateAt(week, 6));
    const month = weekEnd.slice(0, 7);
    const first = `${month}-01`;
    const start = mondayOf(first);
    const host = el('div', { role: 'status' }, [code ? 'Cargando calendario...' : 'Selecciona un contrato para ver el calendario.']);
    showInfoModal(`Calendario · ${new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(dateAt(first))}`, [host]);
    if (!code) return;
    const isCurrent = () => !disposed && request === calendarRequest && host.isConnected;
    try {
      const result = await readCoverage(start, isoDate(dateAt(start, 41)), code, isCurrent);
      if (!isCurrent()) return;
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
      const detail = el('p', { className: 'text-muted', 'aria-live': 'polite' }, ['Selecciona un dia para ver su detalle.']);
      const grid = el('div', { className: 'contract-demo__calendar' }, ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom'].map(day => el('strong', {}, [day])));
      for (const row of result.rows) {
        const isToday = row.date === today;
        const description = `${formatDate(row.date, { weekday: 'long', year: 'numeric' })}: ${row.assigned} asignados, ${row.attended} asistencias, ${row.replaced} reemplazos, ${row.absent} ausencias, ${row.pending} pendientes. Cobertura: ${row.assigned ? percent(row.covered, row.assigned) : 'sin turnos asignados'}.${isToday ? ' Hoy: datos parciales.' : ''}`;
        grid.append(el('button', {
          type: 'button', className: `contract-demo__calendar-day${row.date.slice(0, 7) !== month ? ' is-outside' : ''}${row.date >= week && row.date <= weekEnd ? ' is-selected-week' : ''}${isToday ? ' is-today' : ''}`,
          title: description, 'aria-label': description, 'aria-current': isToday ? 'date' : null,
          onclick: () => detail.replaceChildren(description)
        }, [el('strong', {}, [String(dateAt(row.date).getUTCDate())]),
          el('small', {}, [row.assigned ? `${row.covered}/${row.assigned}` : '—']),
          ...(isToday ? [el('small', {}, ['Hoy · Parcial'])] : [])]));
      }
      host.replaceChildren(el('p', { className: 'text-muted' }, ['Turnos cubiertos / asignados · Borde azul: semana seleccionada · Ambar: hoy, datos parciales']), grid, detail);
    } catch (_error) {
      if (isCurrent()) host.replaceChildren('No se pudo cargar el calendario. Cierra y vuelve a abrir para reintentar.');
    }
  }
};
function iconButton(icon, title, onClick) { return el('button', { className: 'btn btn--icon', type: 'button', title, 'aria-label': title, onclick: onClick }, [lucideInlineIcon(icon, '>')]); }
function iconTile(icon, tone) { return el('span', { className: `contract-demo__icon is-${tone}` }, [lucideInlineIcon(icon, 'i')]); }
function metric(label, value, icon, tone, detail) {
  return summaryMetric(label, value, icon, tone, detail);
}
function fact(icon, label, value) {
  return el('div', { className: 'contract-demo__fact' }, [lucideInlineIcon(icon, 'i'),
    el('div', {}, [el('span', { className: 'text-muted' }, [label]), el('div', { className: 'contract-demo__fact-value' }, [value])])]);
}
function scheduleTable(rows, total) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
  const values = row => [row.assigned, row.attended, row.replaced, row.absent, row.pending, row.assigned ? percent(row.covered, row.assigned) : '—'];
  return el('div', { className: 'contract-demo__table-wrap', tabindex: 0, role: 'region', 'aria-label': 'Programacion semanal' }, [
    el('table', { className: 'contract-demo__table' }, [
      el('thead', {}, [el('tr', {}, ['Fecha', 'Asignados', 'Asistencias', 'Reemplazo', 'Ausencia', 'Pendientes', 'Cobertura'].map(label => el('th', { scope: 'col' }, [label])))]),
      el('tbody', {}, rows.map(row => el('tr', {
        className: row.date === today ? 'contract-demo__today' : '',
        'aria-current': row.date === today ? 'date' : null,
        title: row.date === today ? 'Dia actual: los datos pueden estar incompletos' : null
      }, [
        el('th', { scope: 'row' }, [formatDate(row.date, { weekday: 'short' }),
          ...(row.date === today ? [el('small', { className: 'contract-demo__today-note' }, ['Hoy · Datos parciales'])] : [])]),
        ...values(row).map(value => el('td', {}, [String(value)]))
      ]))),
      el('tfoot', {}, [el('tr', {}, [el('th', { scope: 'row' }, ['Total']), ...values(total).map(value => el('td', {}, [String(value)]))])])
    ])
  ]);
}
