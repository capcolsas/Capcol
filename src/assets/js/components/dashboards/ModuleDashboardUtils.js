import { metricTile, actionTile } from './DashboardUI.js';
import { el } from '../../utils/dom.js';

import { can, isSuperAdmin } from '../../permissions.js';
import { subscribe } from '../../state.js';
import { contractFilterCode, contractMatches } from '../../utils/contractScope.js';

const CONTRACT_SCOPED_COUNTERS = new Set(['countActiveContracts', 'countActiveSedes', 'countActiveEmployees']);

export function renderModuleDashboard(mount, deps = {}, config = {}) {
  const actions = visibleActions(config.actions || []);
  const metrics = config.metrics || [];
  const today = todayBogota();

  const metricsNode = el('div', { className: 'contract-demo__kpis summary-dashboard__kpis' },
    metrics.map((metric) => metricTile(metric.label, '...', metric.tone))
  );
  const actionNodes = actions.map((action) => actionTile(action));
  const emptyActions = el('p', { className: 'text-muted' }, ['No hay accesos disponibles para tu rol en este modulo.']);

  const ui = el('section', { className: `main-card module-dashboard contract-dashboard-demo summary-dashboard ${config.className || ''}` }, [
    el('div', { className: 'contract-demo__header' }, [
      el('div', {}, [
        el('h2', {}, [config.title || 'Dashboard']),
        el('p', { className: 'text-muted' }, [config.lead || ''])
      ]),
      el('span', { className: 'badge' }, [`Corte: ${today}`])
    ]),
    metricsNode,
    el('div', { className: 'section-block module-dashboard__insights' }, [
      el('h3', { className: 'section-title' }, [config.sectionTitle || 'Resumen']),
      el('div', { className: 'module-dashboard__insight-list' }, (config.insights || []).map((text) =>
        el('p', { className: 'module-dashboard__insight' }, [text])
      ))
    ]),
    el('div', { className: 'section-block' }, [
      el('h3', { className: 'section-title' }, ['Accesos del modulo']),
      el('div', { className: 'module-dashboard__actions' }, actionNodes.length ? actionNodes : [emptyActions])
    ])
  ]);

  const columns = el('div', { className: 'contract-demo__columns' });
  columns.append(...ui.querySelectorAll(':scope > .section-block'));
  ui.append(columns);
  mount.replaceChildren(ui);
  const reloadMetrics = () => loadMetrics(metricsNode, metrics, deps, actions);
  reloadMetrics();
  const unSelectedContract = subscribe('selectedContractCode', reloadMetrics);
  return () => {
    try { unSelectedContract?.(); } catch {}
  };
}

export function visibleActions(actions = []) {
  return actions.filter((action) => {
    if (action.perm === 'superadmin') return isSuperAdmin();
    return !action.perm || can(action.perm);
  });
}

export function isActive(row = {}) {
  return String(row?.estado || 'activo').trim().toLowerCase() === 'activo';
}

export function countStream(streamFn, predicate = null) {
  if (typeof streamFn !== 'function') return 0;
  return streamOnce(streamFn).then((rows) => predicate ? rows.filter(predicate).length : rows.length);
}

export function countActiveMetric(deps = {}, counterName = '', fallbackStream = null) {
  const contratoCodigo = contractFilterCode();
  if (contratoCodigo && CONTRACT_SCOPED_COUNTERS.has(counterName) && typeof fallbackStream === 'function') {
    return countStream(fallbackStream, (row) => isActive(row) && metricContractMatches(row, counterName, contratoCodigo));
  }
  if (counterName && typeof deps[counterName] === 'function') return deps[counterName]();
  return countStream(fallbackStream, isActive);
}

function metricContractMatches(row = {}, counterName = '', contratoCodigo = '') {
  if (counterName === 'countActiveContracts') {
    return String(row?.codigo || row?.contratoCodigo || row?.contrato_codigo || '').trim() === contratoCodigo;
  }
  return contractMatches(row, contratoCodigo);
}

export async function countIncapacitiesToday(deps = {}) {
  const today = todayBogota();
  const rows = await deps.listIncapacidadesRange?.(today, today, { contratoCodigo: contractFilterCode() });
  return Array.isArray(rows) ? rows.length : 0;
}

export async function dailyMetric(deps = {}, field = '') {
  const today = todayBogota();
  const contratoCodigo = contractFilterCode();
  if (contratoCodigo && typeof deps.listDailyContractMetricsRange === 'function') {
    const rows = await deps.listDailyContractMetricsRange(today, today, { contratoCodigo });
    const row = Array.isArray(rows) ? rows.find((item) => String(item?.fecha || '').trim() === today) : null;
    const mappedField = dailyContractField(field);
    return Number(row?.[mappedField] || 0);
  }
  const rows = await deps.listDailyMetricsRange?.(today, today);
  const row = Array.isArray(rows) ? rows.find((item) => String(item?.fecha || '').trim() === today) : null;
  return Number(row?.[field] || 0);
}

export async function countCurrentMonthMetrics(deps = {}) {
  const today = todayBogota();
  const contratoCodigo = contractFilterCode();
  const rows = contratoCodigo && typeof deps.listDailyContractMetricsRange === 'function'
    ? await deps.listDailyContractMetricsRange(monthStartBogota(today), today, { contratoCodigo })
    : await deps.listDailyMetricsRange?.(monthStartBogota(today), today);
  return Array.isArray(rows) ? rows.length : 0;
}

function dailyContractField(field = '') {
  return ({
    planned: 'planeados',
    expected: 'contratados',
    unique: 'asistencias',
    attendanceCount: 'asistencias',
    missing: 'faltan',
    absenteeism: 'ausentismos',
    paidServices: 'pagados',
    noContracted: 'noContratados'
  })[field] || field;
}

export function daysElapsedInMonth() {
  return Number(todayBogota().slice(8, 10) || 0);
}





async function loadMetrics(container, metrics, deps, actions) {
  const tiles = Array.from(container.querySelectorAll('.metric-tile__value'));
  await Promise.all(metrics.map(async (metric, index) => {
    try {
      const value = await metric.load?.(deps, actions);
      if (tiles[index]) tiles[index].textContent = formatNumber(value);
    } catch (_) {
      if (tiles[index]) tiles[index].textContent = '-';
    }
  }));
}

function streamOnce(streamFn, timeoutMs = 10000) {
  return new Promise((resolve) => {
    let settled = false;
    let unsub = () => {};
    const finish = (rows) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { unsub?.(); } catch {}
      resolve(Array.isArray(rows) ? rows : []);
    };
    const timer = setTimeout(() => finish([]), timeoutMs);
    try {
      unsub = streamFn((rows) => finish(rows), () => finish([]));
      if (settled) {
        try { unsub?.(); } catch {}
      }
    } catch (_) {
      finish([]);
    }
  });
}

function todayBogota() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
}

function monthStartBogota(today) {
  const [year, month] = String(today || todayBogota()).split('-');
  return `${year}-${month}-01`;
}

function formatNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? new Intl.NumberFormat('es-CO').format(number) : '-';
}
