import { el, qs } from '../utils/dom.js';
import { createTablePagination } from '../utils/pagination.js';

export const QrDailyRegistry = (mount, deps = {}) => {
  let rows = [];
  let pendingRows = [];
  let selectedDate = todayBogota();
  let unsubscribe = null;
  let searchTerm = '';
  let pendingZone = 'all';
  let sortKey = 'entryAt';
  let sortDir = -1;
  let pendingSortKey = 'zona';
  let pendingSortDir = 1;
  let cardFilter = 'all';

  const ui = el('div', {}, [
    el('section', { className: 'main-card' }, [
      el('section', { className: 'wa-header' }, [
        el('div', { className: 'wa-header__left' }, [
          el('div', { className: 'wa-header__top' }, [
            el('h2', {}, ['Registro diario QR']),
            el('div', { className: 'wa-date-pill' }, [
              el('span', { className: 'wa-date-pill__label' }, ['Fecha']),
              el('strong', { id: 'qrDailyDateLabel', className: 'wa-date-pill__value' }, [selectedDate])
            ])
          ]),
          el('div', { className: 'wa-filters wa-filters--wide' }, [
            el('div', { className: 'wa-field wa-field--search' }, [
              el('label', { className: 'label', for: 'qrSearch' }, ['Buscar']),
              el('input', { id: 'qrSearch', className: 'input wa-input', placeholder: 'Cedula, nombre, sede o celular...' })
            ])
          ])
        ])
      ]),
      el('section', { className: 'wa-stats wa-stats--nov wa-stats--qr-registry mt-2' }, [
        statCard('Programados QR', 'qrScheduled', '0', 'scheduled'),
        statCard('Ingresos QR', 'qrTotal', '0', 'entries'),
        statCard('Con salida', 'qrWithExit', '0', 'exits'),
        statCard('Sin ingreso QR', 'qrPending', '0', 'pending'),
        statCard('Alertas celular', 'qrPhoneAlerts', '0', 'alerts')
      ]),
      el('div', { className: 'mt-2 table-wrap' }, [
        el('table', { id: 'qrDailyTable', className: 'table wa-live-table' }, [
          el('thead', {}, [
            el('tr', {}, [
              el('th', { 'data-sort': 'documento', style: 'cursor:pointer' }, ['Cedula']),
              el('th', { 'data-sort': 'nombre', style: 'cursor:pointer' }, ['Nombre']),
              el('th', { 'data-sort': 'sede', style: 'cursor:pointer' }, ['Sede']),
              el('th', { 'data-sort': 'entryAt', style: 'cursor:pointer' }, ['Ingreso']),
              el('th', { 'data-sort': 'exitAt', style: 'cursor:pointer' }, ['Salida']),
              el('th', { 'data-sort': 'employeePhone', style: 'cursor:pointer' }, ['Celular empleado']),
              el('th', { 'data-sort': 'entryPhone', style: 'cursor:pointer' }, ['Celular ingreso']),
              el('th', { 'data-sort': 'exitPhone', style: 'cursor:pointer' }, ['Celular salida']),
              el('th', { 'data-sort': 'distance', style: 'cursor:pointer' }, ['Distancia']),
              el('th', { 'data-sort': 'alert', style: 'cursor:pointer' }, ['Alerta'])
            ])
          ]),
          el('tbody', { id: 'qrDailyTbody' }, [
            el('tr', {}, [el('td', { colSpan: 10, className: 'text-muted' }, ['Consulta una fecha para ver registros QR.'])])
          ])
        ])
      ]),
      el('p', { id: 'qrDailyMsg', className: 'text-muted mt-2' }, [' '])
    ]),
    el('section', { className: 'main-card section-block mt-2' }, [
      el('h3', { className: 'section-title', style: 'margin:0;width:100%;' }, ['Sin ingreso QR / novedades']),
      el('div', { style: 'display:flex;justify-content:space-between;gap:.75rem;align-items:center;flex-wrap:wrap;' }, [
        el('span', { id: 'qrPendingSummary', className: 'text-muted', style: 'font-size:.86rem;' }, ['0 empleados pendientes']),
        el('div', { className: 'wa-field', style: 'min-width:220px;' }, [
          el('label', { className: 'label', for: 'qrPendingZoneFilter' }, ['Zona']),
          el('select', { id: 'qrPendingZoneFilter', className: 'input wa-input' }, [
            el('option', { value: 'all' }, ['Todas las zonas'])
          ])
        ])
      ]),
      el('div', { id: 'qrPendingEmpty', className: 'text-muted mt-1', style: 'display:none;' }, ['Todos los empleados de sedes QR ya registraron ingreso o no tienen novedades.']),
      el('div', { id: 'qrPendingWrap', className: 'mt-1 table-wrap' }, [
        el('table', { id: 'qrPendingTable', className: 'table wa-live-table' }, [
          el('thead', {}, [
            el('tr', {}, [
              el('th', { 'data-pending-sort': 'documento', style: 'cursor:pointer' }, ['Cedula']),
              el('th', { 'data-pending-sort': 'nombre', style: 'cursor:pointer' }, ['Nombre']),
              el('th', { 'data-pending-sort': 'telefono', style: 'cursor:pointer' }, ['Telefono']),
              el('th', { 'data-pending-sort': 'sede', style: 'cursor:pointer' }, ['Sede']),
              el('th', { 'data-pending-sort': 'estado', style: 'cursor:pointer' }, ['Estado / novedad']),
              el('th', { 'data-pending-sort': 'dependencia', style: 'cursor:pointer' }, ['Dependencia']),
              el('th', { 'data-pending-sort': 'zona', style: 'cursor:pointer' }, ['Zona'])
            ])
          ]),
          el('tbody', { id: 'qrPendingTbody' })
        ])
      ])
    ])
  ]);

  const recordsPaginator = createTablePagination(ui, { id: 'qrDailyRecords', after: '#qrDailyTable', onChange: render });
  const pendingPaginator = createTablePagination(ui, { id: 'qrDailyPending', after: '#qrPendingTable', onChange: render });

  function statCard(label, id, value, filterKey = '') {
    const attrs = { className: 'wa-stat card', role: 'button', tabindex: '0' };
    if (filterKey) attrs['data-card-filter'] = filterKey;
    return el('article', attrs, [
      el('small', { className: 'wa-stat__label' }, [label]),
      el('strong', { id, className: 'wa-stat__value' }, [value])
    ]);
  }

  function todayBogota() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
  }

  function normalize(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function formatHour(value) {
    try {
      const date = value ? new Date(value) : null;
      if (!date || Number.isNaN(date.getTime())) return '-';
      return date.toLocaleTimeString('es-CO', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch (_) {
      return '-';
    }
  }

  function phone(value) {
    return String(value || '').trim() || '-';
  }

  function distanceLabel(row = {}) {
    const values = [row.entryDistanceMeters, row.exitDistanceMeters]
      .filter((value) => Number.isFinite(Number(value)))
      .map((value) => `${Number(value)} m`);
    return values.length ? values.join(' / ') : '-';
  }

  function alertBadge(row = {}) {
    if (!row.phoneDifferent) return el('span', { className: 'badge badge--ok' }, ['OK']);
    const detail = [
      row.entryPhoneDifferent ? 'Ingreso' : '',
      row.exitPhoneDifferent ? 'Salida' : ''
    ].filter(Boolean).join(' y ');
    return el('span', { className: 'badge badge--off', title: detail || 'Celular diferente' }, ['Celular diferente']);
  }

  function recordSearchText(row = {}) {
    return normalize([
      row.documento,
      row.nombre,
      row.sedeNombre,
      row.sedeCodigo,
      row.employeePhone,
      row.entryPhone,
      row.exitPhone
    ].join(' '));
  }

  function pendingSearchText(row = {}) {
    return normalize([
      row.documento,
      row.nombre,
      row.telefono,
      row.sedeNombre,
      row.sedeCodigo,
      pendingStatusText(row),
      row.dependenciaNombre,
      row.zonaNombre
    ].join(' '));
  }

  function sortValue(row = {}, key) {
    if (key === 'sede') return normalize(row.sedeNombre || row.sedeCodigo);
    if (key === 'distance') return Math.max(Number(row.entryDistanceMeters || 0), Number(row.exitDistanceMeters || 0));
    if (key === 'alert') return row.phoneDifferent ? 1 : 0;
    return normalize(row[key]);
  }

  function pendingSortValue(row = {}, key) {
    if (key === 'sede') return normalize(row.sedeNombre || row.sedeCodigo);
    if (key === 'estado') return normalize(pendingStatusText(row));
    if (key === 'dependencia') return normalize(row.dependenciaNombre || row.dependenciaCodigo);
    if (key === 'zona') return normalize(row.zonaNombre || row.zonaCodigo);
    return normalize(row[key]);
  }

  function sortRows(list, key, dir, getter = sortValue) {
    return [...(list || [])].sort((a, b) => {
      const va = getter(a, key);
      const vb = getter(b, key);
      if (va === vb) return 0;
      return va > vb ? dir : -dir;
    });
  }

  function updateZoneOptions(sourceRows = []) {
    const select = qs('#qrPendingZoneFilter', ui);
    if (!select) return;
    const current = String(select.value || pendingZone || 'all').trim();
    const zones = [...new Set(sourceRows.map((row) => String(row.zonaNombre || row.zonaCodigo || '').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
    select.replaceChildren(
      el('option', { value: 'all' }, ['Todas las zonas']),
      ...zones.map((zone) => el('option', { value: zone }, [zone]))
    );
    select.value = zones.includes(current) ? current : 'all';
    pendingZone = String(select.value || 'all').trim();
  }

  function renderStats(filteredRecords = rows, filteredPending = pendingRows) {
    const entries = rows.filter((row) => row.entryAt).length;
    qs('#qrScheduled', ui).textContent = String(entries + pendingRows.length);
    qs('#qrTotal', ui).textContent = String(entries);
    qs('#qrWithExit', ui).textContent = String(rows.filter((row) => row.exitAt).length);
    qs('#qrPending', ui).textContent = String(pendingRows.length);
    qs('#qrPhoneAlerts', ui).textContent = String(rows.filter((row) => row.phoneDifferent).length);
    qs('#qrDailyMsg', ui).textContent = `Registro QR en vivo. Registros filtrados: ${filteredRecords.length}. Sin ingreso QR/novedades filtrados: ${filteredPending.length}.`;
  }

  function applyCardFilter(recordList = [], pendingList = []) {
    if (cardFilter === 'entries') return { records: recordList.filter((row) => row.entryAt), pending: [] };
    if (cardFilter === 'exits') return { records: recordList.filter((row) => row.exitAt), pending: [] };
    if (cardFilter === 'pending') return { records: [], pending: pendingList };
    if (cardFilter === 'alerts') return { records: recordList.filter((row) => row.phoneDifferent), pending: [] };
    return { records: recordList, pending: pendingList };
  }

  function setCardFilter(next) {
    cardFilter = cardFilter === next ? 'all' : next;
    recordsPaginator.reset();
    pendingPaginator.reset();
    render();
  }

  function paintCard(cardEl, active) {
    if (!cardEl) return;
    cardEl.style.cursor = 'pointer';
    cardEl.style.outline = active ? '2px solid #0ea5e9' : 'none';
    cardEl.style.outlineOffset = active ? '2px' : '0';
    cardEl.style.background = active ? '#eef8ff' : '';
  }

  function updateCardFilterUI() {
    ui.querySelectorAll('[data-card-filter]').forEach((card) => {
      paintCard(card, cardFilter === String(card.getAttribute('data-card-filter') || '').trim());
    });
  }

  function pendingStatusText(row = {}) {
    const novedad = [row.novedadCodigo, row.novedadNombre].filter(Boolean).join(' - ');
    if (novedad) return novedad;
    const estado = String(row.estadoDia || '').trim();
    if (!estado) return row.servicioProgramado === false ? 'No programado' : 'Pendiente ingreso';
    const labels = {
      ausente_con_novedad: 'Ausente con novedad',
      ausente_sin_reemplazo: 'Ausente sin reemplazo',
      incapacidad: 'Incapacidad',
      vacaciones: 'Vacaciones',
      compensatorio: 'Compensatorio',
      sin_registro: 'Pendiente ingreso',
      no_programado: 'No programado'
    };
    return labels[estado] || estado.replace(/_/g, ' ');
  }

  function renderRecords(filteredRecords) {
    const tbody = qs('#qrDailyTbody', ui);
    const pageRows = recordsPaginator.slice(filteredRecords);
    if (!pageRows.length) {
      tbody.replaceChildren(el('tr', {}, [el('td', { colSpan: 10, className: 'text-muted' }, ['Sin registros QR para los filtros actuales.'])]));
      return;
    }
    tbody.replaceChildren(...pageRows.map((row) => el('tr', { className: row.phoneDifferent ? 'table-row-warning' : '' }, [
      el('td', {}, [row.documento || '-']),
      el('td', {}, [row.nombre || '-']),
      el('td', {}, [row.sedeNombre || row.sedeCodigo || '-']),
      el('td', {}, [formatHour(row.entryAt)]),
      el('td', {}, [formatHour(row.exitAt)]),
      el('td', {}, [phone(row.employeePhone)]),
      el('td', { className: row.entryPhoneDifferent ? 'text-danger' : '' }, [phone(row.entryPhone)]),
      el('td', { className: row.exitPhoneDifferent ? 'text-danger' : '' }, [phone(row.exitPhone)]),
      el('td', {}, [distanceLabel(row)]),
      el('td', {}, [alertBadge(row)])
    ])));
  }

  function pendingEmptyText() {
    if (!['all', 'scheduled', 'pending'].includes(cardFilter)) return 'El filtro actual no incluye empleados sin ingreso QR.';
    if (pendingZone === 'all') return 'Todos los empleados programados en sedes QR ya registraron ingreso.';
    return 'No hay pendientes de ingreso QR para la zona seleccionada.';
  }

  function renderPending(filteredPending) {
    const tbody = qs('#qrPendingTbody', ui);
    const pageRows = pendingPaginator.slice(filteredPending);
    const empty = qs('#qrPendingEmpty', ui);
    const wrap = qs('#qrPendingWrap', ui);
    if (!pageRows.length) {
      tbody.replaceChildren();
      if (empty) {
        empty.textContent = pendingEmptyText();
        empty.style.display = '';
      }
      if (wrap) wrap.style.display = 'none';
    } else {
      if (empty) empty.style.display = 'none';
      if (wrap) wrap.style.display = '';
      tbody.replaceChildren(...pageRows.map((row) => el('tr', {}, [
        el('td', {}, [row.documento || '-']),
        el('td', {}, [row.nombre || '-']),
        el('td', {}, [phone(row.telefono)]),
        el('td', {}, [row.sedeNombre || row.sedeCodigo || '-']),
        el('td', {}, [pendingStatusText(row)]),
        el('td', {}, [row.dependenciaNombre || row.dependenciaCodigo || '-']),
        el('td', {}, [row.zonaNombre || row.zonaCodigo || '-'])
      ])));
    }
    const total = pendingRows.length;
    const visible = filteredPending.length;
    qs('#qrPendingSummary', ui).textContent = pendingZone === 'all'
      ? `${total} empleado${total === 1 ? '' : 's'} sin ingreso QR o con novedad`
      : `${visible} de ${total} empleado${total === 1 ? '' : 's'} sin ingreso QR o con novedad`;
  }

  function render() {
    const term = normalize(searchTerm);
    const searchedRecords = term ? rows.filter((row) => recordSearchText(row).includes(term)) : rows;
    const searchedPending = term ? pendingRows.filter((row) => pendingSearchText(row).includes(term)) : pendingRows;
    const cardFiltered = applyCardFilter(searchedRecords, searchedPending);
    updateZoneOptions(cardFiltered.pending);
    const zoneFilteredPending = cardFiltered.pending.filter((row) => (
      pendingZone === 'all' || String(row.zonaNombre || row.zonaCodigo || '').trim() === pendingZone
    ));
    const sortedRecords = sortRows(cardFiltered.records, sortKey, sortDir);
    const sortedPending = sortRows(zoneFilteredPending, pendingSortKey, pendingSortDir, pendingSortValue);
    renderRecords(sortedRecords);
    renderPending(sortedPending);
    renderStats(sortedRecords, sortedPending);
    updateSortIndicators();
    updateCardFilterUI();
  }

  function updateSortIndicators() {
    ui.querySelectorAll('th[data-sort]').forEach((th) => {
      const base = th.dataset.baseLabel || th.textContent.replace(/\s[\^v▲▼]$/, '');
      th.dataset.baseLabel = base;
      const key = th.getAttribute('data-sort');
      th.textContent = sortKey === key ? `${base} ${sortDir === 1 ? '▲' : '▼'}` : base;
    });
    ui.querySelectorAll('th[data-pending-sort]').forEach((th) => {
      const base = th.dataset.baseLabel || th.textContent.replace(/\s[\^v▲▼]$/, '');
      th.dataset.baseLabel = base;
      const key = th.getAttribute('data-pending-sort');
      th.textContent = pendingSortKey === key ? `${base} ${pendingSortDir === 1 ? '▲' : '▼'}` : base;
    });
  }

  function subscribeRows() {
    selectedDate = todayBogota();
    qs('#qrDailyDateLabel', ui).textContent = selectedDate;
    qs('#qrDailyMsg', ui).textContent = 'Conectando registro QR en vivo...';
    try { unsubscribe?.(); } catch (_) {}
    unsubscribe = null;
    if (typeof deps.streamDailyQrRecords !== 'function') {
      rows = [];
      pendingRows = [];
      render();
      qs('#qrDailyMsg', ui).textContent = 'No esta disponible la suscripcion del registro QR.';
      return;
    }
    unsubscribe = deps.streamDailyQrRecords(
      selectedDate,
      (summary = {}) => {
        const next = Array.isArray(summary) ? { rows: summary, pendingRows: [] } : (summary || {});
        rows = next.rows || [];
        pendingRows = next.pendingRows || [];
        render();
      },
      (error) => {
        rows = [];
        pendingRows = [];
        render();
        qs('#qrDailyMsg', ui).textContent = `Error consultando registro QR: ${error?.message || error}`;
      },
      (status) => {
        if (status === 'SUBSCRIBED') render();
      }
    ) || null;
  }

  qs('#qrSearch', ui)?.addEventListener('input', (event) => {
    searchTerm = event.target.value || '';
    recordsPaginator.reset();
    pendingPaginator.reset();
    render();
  });
  qs('#qrPendingZoneFilter', ui)?.addEventListener('change', (event) => {
    pendingZone = String(event.target.value || 'all').trim();
    pendingPaginator.reset();
    render();
  });
  ui.querySelectorAll('th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const key = String(th.getAttribute('data-sort') || '').trim();
      if (!key) return;
      if (sortKey === key) sortDir *= -1;
      else { sortKey = key; sortDir = 1; }
      recordsPaginator.reset();
      render();
    });
  });
  ui.querySelectorAll('th[data-pending-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const key = String(th.getAttribute('data-pending-sort') || '').trim();
      if (!key) return;
      if (pendingSortKey === key) pendingSortDir *= -1;
      else { pendingSortKey = key; pendingSortDir = 1; }
      pendingPaginator.reset();
      render();
    });
  });
  ui.querySelectorAll('[data-card-filter]').forEach((card) => {
    const key = String(card.getAttribute('data-card-filter') || '').trim();
    if (!key) return;
    card.addEventListener('click', () => setCardFilter(key));
    card.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      ev.preventDefault();
      setCardFilter(key);
    });
  });

  mount.replaceChildren(ui);
  subscribeRows();
  return () => {
    try { unsubscribe?.(); } catch (_) {}
    unsubscribe = null;
  };
};
