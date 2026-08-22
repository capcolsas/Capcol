import { el, qs } from '../utils/dom.js';
import { can, PERMS } from '../permissions.js';
import { createTablePagination } from '../utils/pagination.js';

const CLEAR_VALUE = '__CLEAR__';
const UPDATE_FIELDS = [
  ['nombre', 'Nombre'],
  ['telefono', 'Telefono'],
  ['fechaNacimiento', 'Fecha nacimiento'],
  ['eps', 'EPS'],
  ['afp', 'AFP'],
  ['arlRiesgo', 'Riesgo ARL'],
  ['dotacionCamisa', 'Camisa'],
  ['dotacionPantalon', 'Pantalon'],
  ['dotacionZapatos', 'Zapatos']
];

export const EmployeeBulkUpdateAdmin = (mount, deps = {}) => {
  const canImport = can(PERMS.BULK_UPLOAD_EMPLOYEES);
  const ui = el('section', { className: 'main-card' }, [
    el('h2', {}, ['Actualizacion masiva de empleados']),
    el('p', { className: 'text-muted mt-2' }, [`Usa documento como llave. Solo se actualizan las columnas presentes con valor; para limpiar un dato usa ${CLEAR_VALUE}.`]),
    el('div', { className: 'form-row mt-2' }, [
      el('button', { id: 'btnTemplate', className: 'btn', type: 'button' }, ['Descargar plantilla CSV']),
      el('input', { id: 'fileInput', className: 'input', type: 'file', accept: '.csv,.xls,.xlsx' }),
      el('button', { id: 'btnValidate', className: 'btn btn--primary', type: 'button' }, ['Validar archivo']),
      el('button', { id: 'btnUpdate', className: 'btn', type: 'button', disabled: true, title: canImport ? '' : 'Modo consulta: no puedes actualizar empleados.' }, ['Actualizar empleados']),
      el('span', { id: 'msg', className: 'text-muted' }, [' '])
    ]),
    el('div', { id: 'importProgress', className: 'bulk-progress hidden', 'aria-live': 'polite' }, [
      el('div', { className: 'bulk-progress__meta' }, [
        el('span', { id: 'progressLabel', className: 'bulk-progress__label' }, ['Listo para actualizar']),
        el('span', { id: 'progressNumbers', className: 'bulk-progress__numbers text-muted' }, ['0 / 0'])
      ]),
      el('div', { className: 'bulk-progress__track', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0', 'aria-label': 'Progreso de actualizacion' }, [
        el('div', { id: 'progressFill', className: 'bulk-progress__fill', style: 'width:0%' })
      ])
    ]),
    el('div', { className: 'divider' }),
    el('div', { className: 'form-row' }, [
      el('div', {}, [el('label', { className: 'label' }, ['Filas leidas']), el('input', { id: 'sumRows', className: 'input', disabled: true })]),
      el('div', {}, [el('label', { className: 'label' }, ['Validas']), el('input', { id: 'sumOk', className: 'input', disabled: true })]),
      el('div', {}, [el('label', { className: 'label' }, ['Errores']), el('input', { id: 'sumErr', className: 'input', disabled: true })])
    ]),
    el('div', { className: 'responsive-records mt-2' }, [
      el('div', { className: 'table-wrap responsive-table-view' }, [
        el('table', { className: 'table', id: 'tblPreview' }, [
          el('thead', {}, [el('tr', {}, [
            el('th', {}, ['Documento']),
            el('th', {}, ['Empleado actual']),
            el('th', {}, ['Campos a actualizar']),
            el('th', {}, ['Estado'])
          ])]),
          el('tbody', {})
        ])
      ]),
      el('div', { id: 'previewCards', className: 'record-card-list' }, [])
    ]),
    el('div', { className: 'responsive-records mt-2' }, [
      el('div', { className: 'table-wrap responsive-table-view' }, [
        el('table', { className: 'table', id: 'tblErrors' }, [
          el('thead', {}, [el('tr', {}, [el('th', {}, ['Fila']), el('th', {}, ['Error'])])]),
          el('tbody', {})
        ])
      ]),
      el('div', { id: 'errorCards', className: 'record-card-list' }, [])
    ])
  ]);

  const msg = qs('#msg', ui);
  const btnUpdate = qs('#btnUpdate', ui);
  const btnValidate = qs('#btnValidate', ui);
  const btnTemplate = qs('#btnTemplate', ui);
  const fileInput = qs('#fileInput', ui);
  const progressBox = qs('#importProgress', ui);
  const progressLabel = qs('#progressLabel', ui);
  const progressNumbers = qs('#progressNumbers', ui);
  const progressFill = qs('#progressFill', ui);
  const progressTrack = ui.querySelector('.bulk-progress__track');
  const previewCards = qs('#previewCards', ui);
  const errorCards = qs('#errorCards', ui);
  const previewPaginator = createTablePagination(ui, { id: 'bulkEmployeeUpdatesPreview', after: '#previewCards', onChange: () => renderPreview() });
  const errorsPaginator = createTablePagination(ui, { id: 'bulkEmployeeUpdatesErrors', after: '#errorCards', onChange: () => renderErrors() });

  let employees = [];
  let validRows = [];
  let previewRows = [];
  let errorRows = [];
  const unEmp = deps.streamEmployees?.((arr) => { employees = arr || []; }) || (() => {});

  btnValidate.addEventListener('click', async () => {
    msg.textContent = 'Validando archivo...';
    btnUpdate.disabled = true;
    validRows = [];
    try {
      const file = fileInput.files?.[0];
      if (!file) {
        msg.textContent = 'Selecciona un archivo CSV/XLS/XLSX.';
        return;
      }
      resetProgress();
      const rows = await readInputFile(file);
      const result = validateRows(rows, employees);
      renderSummary(result.rows.length, result.valid.length, result.errors.length);
      renderPreview(result.preview);
      renderErrors(result.errors);
      validRows = result.valid;
      btnUpdate.disabled = !canImport || !result.valid.length;
      msg.textContent = result.errors.length
        ? 'Validacion finalizada con errores.'
        : canImport ? 'Archivo valido. Puedes actualizar.' : 'Archivo valido. Modo consulta: no tienes permiso para actualizar.';
    } catch (error) {
      msg.textContent = 'Error: ' + (error?.message || error);
    }
  });

  btnUpdate.addEventListener('click', async () => {
    if (!canImport) {
      msg.textContent = 'No tienes permiso para actualizar empleados.';
      return;
    }
    if (!validRows.length) {
      msg.textContent = 'No hay filas validas para actualizar.';
      return;
    }
    btnUpdate.disabled = true;
    btnValidate.disabled = true;
    btnTemplate.disabled = true;
    fileInput.disabled = true;
    updateProgress({ created: 0, total: validRows.length, percent: 0, phase: 'preparing' });
    msg.textContent = 'Actualizando empleados...';
    try {
      const out = await deps.updateEmployeesBulk?.(validRows, { onProgress: updateProgress });
      await deps.addAuditLog?.({
        targetType: 'employee',
        action: 'bulk_update_employees',
        after: { total: out?.updated || validRows.length, skipped: out?.skipped || 0 }
      });
      msg.textContent = `Actualizacion completada. Actualizados: ${out?.updated || validRows.length}`;
      validRows = [];
    } catch (error) {
      msg.textContent = 'Error al actualizar: ' + (error?.message || error);
      btnUpdate.disabled = false;
      updateProgress({ created: 0, total: validRows.length, percent: 0, phase: 'error' });
    } finally {
      btnValidate.disabled = false;
      btnTemplate.disabled = false;
      fileInput.disabled = false;
    }
  });

  btnTemplate.addEventListener('click', () => {
    const headers = ['documento', 'nombre', 'telefono', 'fecha nacimiento', 'eps', 'afp', 'riesgo arl', 'camisa', 'pantalon', 'zapatos'];
    const sampleA = ['10000001', 'Empleado ejemplo', '573000000000', '1990-05-10', 'Sura', 'Proteccion', '1', 'M', '32', '40'];
    const sampleB = ['10000002', '', '', '', CLEAR_VALUE, '', '', '', '', ''];
    downloadCsv('plantilla_actualizacion_empleados.csv', [headers, sampleA, sampleB]);
  });

  function validateRows(rows, employeesList) {
    const employeeByDoc = new Map((employeesList || []).map((emp) => [String(emp.documento || '').trim(), emp]));
    const localDocs = new Set();
    const valid = [];
    const errors = [];
    const preview = [];
    rows.forEach((raw, index) => {
      const rowNum = index + 2;
      const documento = String(raw.documento || '').trim();
      const employee = employeeByDoc.get(documento) || null;
      const issues = [];
      const patch = {};
      if (!documento) issues.push('Documento requerido.');
      if (documento && !employee) issues.push('Documento no existe en empleados.');
      if (documento && localDocs.has(documento)) issues.push('Documento duplicado en archivo.');
      if (documento) localDocs.add(documento);
      UPDATE_FIELDS.forEach(([key]) => {
        if (!raw.presentFields?.has(key)) return;
        const value = String(raw[key] ?? '').trim();
        if (!value) return;
        if (key === 'fechaNacimiento') {
          const normalized = value === CLEAR_VALUE ? CLEAR_VALUE : normalizeDate(value);
          if (value !== CLEAR_VALUE && !normalized) issues.push('Fecha nacimiento invalida.');
          else if (normalized && normalized !== CLEAR_VALUE && normalized > todayIsoDate()) issues.push('La fecha de nacimiento no puede ser futura.');
          else patch[key] = normalized;
          return;
        }
        patch[key] = value;
      });
      if (!Object.keys(patch).length) issues.push('No hay campos con valor para actualizar.');
      const fieldSummary = formatFieldSummary(patch);
      if (issues.length) {
        errors.push({ row: rowNum, message: issues.join(' ') });
        preview.push({ documento, employee, fields: fieldSummary, ok: false });
        return;
      }
      valid.push({ id: employee.id, documento, ...patch });
      preview.push({ documento, employee, fields: fieldSummary, ok: true });
    });
    return { rows, valid, errors, preview };
  }

  function formatFieldSummary(patch = {}) {
    return UPDATE_FIELDS
      .filter(([key]) => patch[key] !== undefined)
      .map(([key, label]) => `${label}: ${patch[key] === CLEAR_VALUE ? 'Limpiar' : patch[key]}`)
      .join(' | ') || '-';
  }

  function renderSummary(total, ok, err) {
    qs('#sumRows', ui).value = String(total || 0);
    qs('#sumOk', ui).value = String(ok || 0);
    qs('#sumErr', ui).value = String(err || 0);
  }

  function renderPreview(rows) {
    if (Array.isArray(rows)) {
      previewRows = rows;
      previewPaginator.reset();
    }
    const pageRows = previewPaginator.slice(previewRows);
    qs('#tblPreview tbody', ui).replaceChildren(...pageRows.map((row) => el('tr', {}, [
      el('td', {}, [row.documento || '-']),
      el('td', {}, [row.employee?.nombre || '-']),
      el('td', {}, [row.fields || '-']),
      el('td', {}, [row.ok ? 'OK' : 'ERROR'])
    ])));
    previewCards.replaceChildren(...(pageRows.length ? pageRows.map(previewCard) : [el('p', { className: 'text-muted record-card__empty' }, ['Sin filas para previsualizar.'])]));
  }

  function renderErrors(errors) {
    if (Array.isArray(errors)) {
      errorRows = errors;
      errorsPaginator.reset();
    }
    const pageRows = errorsPaginator.slice(errorRows);
    qs('#tblErrors tbody', ui).replaceChildren(...pageRows.map((err) => el('tr', {}, [
      el('td', {}, [String(err.row)]),
      el('td', {}, [err.message || 'Error'])
    ])));
    errorCards.replaceChildren(...(pageRows.length ? pageRows.map(errorCard) : [el('p', { className: 'text-muted record-card__empty' }, ['Sin errores para mostrar.'])]));
  }

  function previewCard(row) {
    return el('article', { className: 'record-card' }, [
      el('div', { className: 'record-card__header' }, [
        el('div', { className: 'record-card__identity' }, [
          el('strong', { className: 'record-card__title' }, [row.employee?.nombre || row.documento || '-']),
          el('span', { className: 'record-card__subtitle' }, [`Documento: ${row.documento || '-'}`])
        ]),
        el('span', { className: `badge ${row.ok ? 'badge--ok' : 'badge--off'}` }, [row.ok ? 'OK' : 'ERROR'])
      ]),
      el('dl', { className: 'record-card__meta' }, [
        el('div', { className: 'record-card__meta-item' }, [el('dt', {}, ['Campos']), el('dd', {}, [row.fields || '-'])])
      ])
    ]);
  }

  function errorCard(err) {
    return el('article', { className: 'record-card' }, [
      el('div', { className: 'record-card__header' }, [
        el('div', { className: 'record-card__identity' }, [
          el('strong', { className: 'record-card__title' }, [`Fila ${String(err.row || '-')}`]),
          el('span', { className: 'record-card__subtitle' }, ['Validacion'])
        ]),
        el('span', { className: 'badge badge--off' }, ['Error'])
      ]),
      el('dl', { className: 'record-card__meta' }, [
        el('div', { className: 'record-card__meta-item' }, [el('dt', {}, ['Detalle']), el('dd', {}, [err.message || 'Error'])])
      ])
    ]);
  }

  async function readInputFile(file) {
    const name = (file.name || '').toLowerCase();
    if (name.endsWith('.csv')) return parseCSVRows(await file.text());
    if (name.endsWith('.xls') || name.endsWith('.xlsx')) {
      const mod = await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');
      const buff = await file.arrayBuffer();
      const wb = mod.read(buff, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = mod.utils.sheet_to_json(ws, { defval: '' });
      return rows.map((row) => normalizeInputRow(row, Object.keys(row || {})));
    }
    throw new Error('Formato no soportado. Usa CSV/XLS/XLSX.');
  }

  function parseCSVRows(text) {
    const rows = [];
    let row = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      const next = text[i + 1];
      if (ch === '"') {
        if (inQuotes && next === '"') { cur += '"'; i += 1; } else inQuotes = !inQuotes;
      } else if ((ch === ',' || ch === ';' || ch === '\t') && !inQuotes) {
        row.push(cur);
        cur = '';
      } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
        if (cur !== '' || row.length) { row.push(cur); rows.push(row); row = []; cur = ''; }
      } else cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    if (!rows.length) return [];
    const headers = rows[0].map((header) => String(header || '').trim());
    return rows.slice(1).map((cols) => {
      const obj = {};
      headers.forEach((header, index) => { obj[header] = cols[index] ?? ''; });
      return normalizeInputRow(obj, headers);
    });
  }

  function normalizeInputRow(obj, headers = []) {
    const out = { documento: '', presentFields: new Set() };
    const presentHeaders = new Set((headers || Object.keys(obj || {})).map(normalizeHeaderKey));
    Object.keys(obj || {}).forEach((keyName) => {
      const key = normalizeHeaderKey(keyName);
      const value = String(obj[keyName] ?? '').trim();
      if (key === 'documento' || key === 'doc') out.documento = value;
      fieldAliases().forEach(([field, aliases]) => {
        if (!aliases.includes(key)) return;
        out.presentFields.add(field);
        out[field] = value;
      });
    });
    fieldAliases().forEach(([field, aliases]) => {
      if (aliases.some((alias) => presentHeaders.has(alias))) out.presentFields.add(field);
    });
    return out;
  }

  function fieldAliases() {
    return [
      ['nombre', ['nombre', 'nombre completo']],
      ['telefono', ['telefono', 'celular', 'numero cel']],
      ['fechaNacimiento', ['fecha nacimiento', 'nacimiento']],
      ['eps', ['eps']],
      ['afp', ['afp']],
      ['arlRiesgo', ['riesgo arl', 'arl riesgo', 'arl']],
      ['dotacionCamisa', ['camisa', 'dotacion camisa', 'talla camisa']],
      ['dotacionPantalon', ['pantalon', 'dotacion pantalon', 'talla pantalon']],
      ['dotacionZapatos', ['zapatos', 'dotacion zapatos', 'talla zapatos', 'calzado']]
    ];
  }

  function normalizeHeaderKey(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  }

  function normalizeDate(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      const excelEpoch = Date.UTC(1899, 11, 30);
      const date = new Date(excelEpoch + Math.round(value) * 86400000);
      return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
    }
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const parts = raw.split(/[\/\-.]/).map((part) => part.trim()).filter(Boolean);
    if (parts.length !== 3) return '';
    let d = parts[0]; let m = parts[1]; let y = parts[2];
    if (parts[0].length === 4) { y = parts[0]; m = parts[1]; d = parts[2]; }
    let yy = Number(y);
    const dd = Number(d);
    const mm = Number(m);
    if (!Number.isFinite(yy) || !Number.isFinite(dd) || !Number.isFinite(mm)) return '';
    if (y.length === 2) yy = 2000 + yy;
    if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return '';
    return `${String(yy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  }

  function todayIsoDate() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
  }

  function updateProgress({ created = 0, total = 0, percent = 0, phase = 'updating' } = {}) {
    const labels = {
      preparing: 'Preparando actualizacion...',
      updating: 'Actualizando empleados...',
      refreshing: 'Actualizando vista...',
      completed: 'Actualizacion completada',
      error: 'Actualizacion interrumpida'
    };
    progressBox.classList.remove('hidden');
    const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
    progressLabel.textContent = labels[phase] || 'Actualizando empleados...';
    progressNumbers.textContent = `${created} / ${total}`;
    progressFill.style.width = `${safePercent}%`;
    progressTrack?.setAttribute('aria-valuenow', String(safePercent));
  }

  function resetProgress() {
    progressLabel.textContent = 'Listo para actualizar';
    progressNumbers.textContent = '0 / 0';
    progressFill.style.width = '0%';
    progressTrack?.setAttribute('aria-valuenow', '0');
  }

  function downloadCsv(filename, rows) {
    const csv = rows.map((row) => row.map(csvCell).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function csvCell(value) {
    const raw = String(value ?? '');
    return raw.includes(',') || raw.includes('"') || raw.includes('\n') ? `"${raw.replace(/"/g, '""')}"` : raw;
  }

  mount.replaceChildren(ui);
  resetProgress();
  return () => unEmp?.();
};
