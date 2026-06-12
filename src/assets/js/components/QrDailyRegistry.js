import { el, qs } from '../utils/dom.js';

export const QrDailyRegistry = (mount, deps = {}) => {
  let rows = [];
  let selectedDate = todayBogota();

  const ui = el('section', { className: 'main-card' }, [
    el('div', { className: 'wa-header__top' }, [
      el('h2', {}, ['Registro diario QR']),
      el('div', { className: 'wa-date-pill' }, [
        el('span', { className: 'wa-date-pill__label' }, ['Fecha']),
        el('strong', { id: 'qrDailyDateLabel', className: 'wa-date-pill__value' }, [selectedDate])
      ])
    ]),
    el('div', { className: 'form-row mt-2' }, [
      el('div', {}, [
        el('label', { className: 'label' }, ['Fecha']),
        el('input', { id: 'qrDailyDate', className: 'input', type: 'date', value: selectedDate })
      ]),
      el('button', { id: 'btnLoadQrDaily', className: 'btn btn--primary', type: 'button' }, ['Consultar'])
    ]),
    el('section', { className: 'wa-stats wa-stats--nov mt-2' }, [
      statCard('Registros QR', 'qrTotal', '0'),
      statCard('Con salida', 'qrWithExit', '0'),
      statCard('Alertas celular', 'qrPhoneAlerts', '0')
    ]),
    el('div', { className: 'mt-2 table-wrap' }, [
      el('table', { className: 'table wa-live-table' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', {}, ['Cedula']),
            el('th', {}, ['Nombre']),
            el('th', {}, ['Sede']),
            el('th', {}, ['Ingreso']),
            el('th', {}, ['Salida']),
            el('th', {}, ['Celular empleado']),
            el('th', {}, ['Celular ingreso']),
            el('th', {}, ['Celular salida']),
            el('th', {}, ['Distancia']),
            el('th', {}, ['Alerta'])
          ])
        ]),
        el('tbody', { id: 'qrDailyTbody' }, [
          el('tr', {}, [el('td', { colSpan: 10, className: 'text-muted' }, ['Consulta una fecha para ver registros QR.'])])
        ])
      ])
    ]),
    el('p', { id: 'qrDailyMsg', className: 'text-muted mt-2' }, [' '])
  ]);

  function statCard(label, id, value) {
    return el('article', { className: 'wa-stat card' }, [
      el('small', { className: 'wa-stat__label' }, [label]),
      el('strong', { id, className: 'wa-stat__value' }, [value])
    ]);
  }

  function todayBogota() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
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

  function renderStats() {
    qs('#qrTotal', ui).textContent = String(rows.length);
    qs('#qrWithExit', ui).textContent = String(rows.filter((row) => row.exitAt).length);
    qs('#qrPhoneAlerts', ui).textContent = String(rows.filter((row) => row.phoneDifferent).length);
  }

  function renderRows() {
    const tbody = qs('#qrDailyTbody', ui);
    if (!rows.length) {
      tbody.replaceChildren(el('tr', {}, [el('td', { colSpan: 10, className: 'text-muted' }, ['Sin registros QR para la fecha seleccionada.'])]));
      renderStats();
      return;
    }
    tbody.replaceChildren(...rows.map((row) => el('tr', { className: row.phoneDifferent ? 'table-row-warning' : '' }, [
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
    renderStats();
  }

  async function loadRows() {
    selectedDate = String(qs('#qrDailyDate', ui)?.value || todayBogota()).trim();
    qs('#qrDailyDateLabel', ui).textContent = selectedDate;
    qs('#qrDailyMsg', ui).textContent = 'Consultando registros QR...';
    try {
      rows = await deps.listDailyQrRecords?.(selectedDate) || [];
      renderRows();
      qs('#qrDailyMsg', ui).textContent = `Registros cargados: ${rows.length}`;
    } catch (error) {
      rows = [];
      renderRows();
      qs('#qrDailyMsg', ui).textContent = `Error consultando registro QR: ${error?.message || error}`;
    }
  }

  qs('#btnLoadQrDaily', ui)?.addEventListener('click', loadRows);
  qs('#qrDailyDate', ui)?.addEventListener('change', loadRows);

  mount.replaceChildren(ui);
  loadRows();
};
