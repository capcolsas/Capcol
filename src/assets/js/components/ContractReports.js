import { el, qs } from '../utils/dom.js';
import { subscribe } from '../state.js';
import { contractFilterCode, selectedContractLabel } from '../utils/contractScope.js';
import { downloadCsv } from '../utils/csv.js';

export const ContractReports = (mount, deps = {}) => {
  const today = todayBogota();
  const monthStart = today.slice(0, 8) + '01';
  let contracts = [];
  let rows = [];
  let loading = false;

  const ui = el('section', { className: 'main-card' }, [
    el('h2', {}, ['Reportes por contrato']),
    el('p', { id: 'contractReportScope', className: 'text-muted' }, [' ']),
    el('div', { className: 'form-row mt-2' }, [
      fieldDate('contractReportFrom', 'Desde', monthStart),
      fieldDate('contractReportTo', 'Hasta', today),
      el('button', { id: 'btnContractReportLoad', className: 'btn btn--primary', type: 'button' }, ['Consultar']),
      el('button', { id: 'btnContractReportExport', className: 'btn', type: 'button', disabled: true }, ['Exportar CSV']),
      el('span', { id: 'contractReportMsg', className: 'text-muted' }, [' '])
    ]),
    el('section', { className: 'wa-stats wa-stats--summary mt-2' }, [
      metricCard('Planeados', 'contractReportTotalPlanned'),
      metricCard('Contratados', 'contractReportTotalExpected'),
      metricCard('Asistencias', 'contractReportTotalAttendance'),
      metricCard('Ausentismos', 'contractReportTotalAbsenteeism'),
      metricCard('Pagados', 'contractReportTotalPaid'),
      metricCard('No contratados', 'contractReportTotalNoContracted')
    ]),
    tableSection('Resumen por cliente', 'contractReportClientBody', ['Cliente', 'Contratos', 'Planeados', 'Contratados', 'Asistencias', 'Ausentismos', 'Pagados']),
    tableSection('Detalle diario por contrato', 'contractReportBody', ['Fecha', 'Contrato', 'Cliente', 'Planeados', 'Contratados', 'Asistencias', 'Ausentismos', 'Pagados', 'No contratados', 'Faltan', 'Sobran', 'Cerrado'])
  ]);

  qs('#btnContractReportLoad', ui)?.addEventListener('click', () => load());
  qs('#btnContractReportExport', ui)?.addEventListener('click', () => exportCsv(rows));
  [qs('#contractReportFrom', ui), qs('#contractReportTo', ui)].forEach((input) => input?.addEventListener('change', () => load()));

  const unSelectedContract = subscribe('selectedContractCode', () => load());
  const unContracts = deps.streamContracts?.((items) => {
    contracts = items || [];
    renderScope();
  }) || (() => {});

  mount.replaceChildren(ui);
  load();

  return () => {
    unSelectedContract?.();
    unContracts?.();
  };

  async function load() {
    const from = String(qs('#contractReportFrom', ui)?.value || monthStart).trim();
    const to = String(qs('#contractReportTo', ui)?.value || from).trim();
    loading = true;
    render();
    try {
      rows = await deps.listDailyContractMetricsRange?.(from, to, { contratoCodigo: contractFilterCode() }) || [];
    } catch (error) {
      rows = [];
      qs('#contractReportMsg', ui).textContent = `Error cargando reporte: ${error?.message || error}`;
    } finally {
      loading = false;
      render();
    }
  }

  function render() {
    renderScope();
    const totals = sumRows(rows);
    setText('contractReportTotalPlanned', String(totals.planeados));
    setText('contractReportTotalExpected', String(totals.contratados));
    setText('contractReportTotalAttendance', String(totals.asistencias));
    setText('contractReportTotalAbsenteeism', String(totals.ausentismos));
    setText('contractReportTotalPaid', String(totals.pagados));
    setText('contractReportTotalNoContracted', String(totals.noContratados));
    qs('#contractReportClientBody', ui)?.replaceChildren(...renderClientRows());
    qs('#contractReportBody', ui)?.replaceChildren(...renderDetailRows());
    qs('#btnContractReportExport', ui).disabled = !rows.length;
    qs('#contractReportMsg', ui).textContent = loading ? 'Cargando reporte...' : `${rows.length} fila(s) visibles.`;
  }

  function renderScope() {
    const label = selectedContractLabel(contracts) || (contractFilterCode() ? contractFilterCode() : 'Todos los contratos');
    qs('#contractReportScope', ui).textContent = `Alcance actual: ${label}`;
  }

  function renderClientRows() {
    const groups = groupByClient(rows);
    if (!groups.length) return [el('tr', {}, [el('td', { colSpan: 7, className: 'text-muted' }, [loading ? 'Cargando resumen...' : 'Sin datos para el rango seleccionado.'])])];
    return groups.map((group) => el('tr', {}, [
      el('td', {}, [group.cliente]),
      el('td', {}, [String(group.contracts.size)]),
      el('td', {}, [String(group.planeados)]),
      el('td', {}, [String(group.contratados)]),
      el('td', {}, [String(group.asistencias)]),
      el('td', {}, [String(group.ausentismos)]),
      el('td', {}, [String(group.pagados)])
    ]));
  }

  function renderDetailRows() {
    if (!rows.length) return [el('tr', {}, [el('td', { colSpan: 12, className: 'text-muted' }, [loading ? 'Cargando detalle...' : 'Sin detalle diario para mostrar.'])])];
    return rows.map((row) => el('tr', {}, [
      el('td', {}, [row.fecha || '-']),
      el('td', {}, [row.contratoNombre || row.contratoCodigo || '-']),
      el('td', {}, [row.clienteNombreSnapshot || '-']),
      el('td', {}, [String(row.planeados || 0)]),
      el('td', {}, [String(row.contratados || 0)]),
      el('td', {}, [String(row.asistencias || 0)]),
      el('td', {}, [String(row.ausentismos || 0)]),
      el('td', {}, [String(row.pagados || 0)]),
      el('td', {}, [String(row.noContratados || 0)]),
      el('td', {}, [String(row.faltan || 0)]),
      el('td', {}, [String(row.sobran || 0)]),
      el('td', {}, [row.closed ? 'Si' : 'No'])
    ]));
  }

  function setText(id, text) {
    const node = qs(`#${id}`, ui);
    if (node) node.textContent = text;
  }
};

function fieldDate(id, label, value) {
  return el('div', {}, [
    el('label', { className: 'label', for: id }, [label]),
    el('input', { id, className: 'input', type: 'date', value })
  ]);
}

function metricCard(label, id) {
  return el('article', { className: 'wa-stat card' }, [
    el('small', { className: 'wa-stat__label' }, [label]),
    el('strong', { id, className: 'wa-stat__value' }, ['0'])
  ]);
}

function tableSection(title, bodyId, headers) {
  return el('section', { className: 'section-block mt-2' }, [
    el('h3', { className: 'section-title' }, [title]),
    el('div', { className: 'table-wrap' }, [
      el('table', { className: 'table' }, [
        el('thead', {}, [el('tr', {}, headers.map((header) => el('th', {}, [header])))]),
        el('tbody', { id: bodyId }, [])
      ])
    ])
  ]);
}

function todayBogota() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
}

function emptyTotals() {
  return { planeados: 0, contratados: 0, asistencias: 0, ausentismos: 0, pagados: 0, noContratados: 0, faltan: 0, sobran: 0 };
}

function sumRows(rows = []) {
  return rows.reduce((acc, row) => {
    acc.planeados += Number(row?.planeados || 0);
    acc.contratados += Number(row?.contratados || 0);
    acc.asistencias += Number(row?.asistencias || 0);
    acc.ausentismos += Number(row?.ausentismos || 0);
    acc.pagados += Number(row?.pagados || 0);
    acc.noContratados += Number(row?.noContratados || 0);
    acc.faltan += Number(row?.faltan || 0);
    acc.sobran += Number(row?.sobran || 0);
    return acc;
  }, emptyTotals());
}

function groupByClient(rows = []) {
  const map = new Map();
  rows.forEach((row) => {
    const key = String(row?.clienteNombreSnapshot || 'Sin cliente').trim() || 'Sin cliente';
    if (!map.has(key)) map.set(key, { cliente: key, contracts: new Set(), ...emptyTotals() });
    const group = map.get(key);
    if (row?.contratoCodigo) group.contracts.add(row.contratoCodigo);
    const totals = sumRows([group, row]);
    Object.assign(group, totals);
  });
  return [...map.values()].sort((a, b) => a.cliente.localeCompare(b.cliente));
}

function exportCsv(rows = []) {
  if (!rows.length) return;
  const headers = ['Fecha', 'Contrato codigo', 'Contrato nombre', 'Cliente', 'Planeados', 'Contratados', 'Asistencias', 'Ausentismos', 'Pagados', 'No contratados', 'Faltan', 'Sobran', 'Cerrado'];
  const body = rows.map((row) => [
    row.fecha,
    row.contratoCodigo,
    row.contratoNombre,
    row.clienteNombreSnapshot,
    row.planeados,
    row.contratados,
    row.asistencias,
    row.ausentismos,
    row.pagados,
    row.noContratados,
    row.faltan,
    row.sobran,
    row.closed ? 'Si' : 'No'
  ]);
  downloadCsv(`reporte_contratos_${todayBogota()}.csv`, [headers, ...body]);
}
