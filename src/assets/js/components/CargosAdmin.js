import { el, qs, infoIcon, moreIcon } from '../utils/dom.js';
import { showCatalogDetail, detailDate } from '../utils/catalogDetail.js';
import { showActionModal, closeActionModal } from '../utils/actionModal.js';
import { createTablePagination } from '../utils/pagination.js';
import { can, PERMS } from '../permissions.js';
import { subscribe } from '../state.js';
import { contractFilterCode } from '../utils/contractScope.js';

export const CargosAdmin = (mount, deps = {}) => {
  const canEdit = can(PERMS.EDIT_CARGOS);
  const crudOptions = [
    { value: 'empleado', label: 'Solo Empleados' },
    { value: 'supervisor', label: 'Supervisor' },
    { value: 'supernumerario', label: 'Supernumerario' }
  ];
  const crudLabel = (value) => crudOptions.find((o) => o.value === value)?.label || 'Solo Empleados';
  const mobilityField = (cargo = {}) => ({ id: 'mobility', label: 'Marcación de asistencia (aplica al cargo en todos los contratos)', type: 'checkboxes', value: cargo.marcacionMovil ? ['enabled'] : [], options: [{ value: 'enabled', label: 'Permitir ingreso y salida en distintas sedes de la zona asignada' }] });
  const mobilityLabel = cargo => cargo.marcacionMovil ? 'Varias Sedes' : 'Sede fija';
  const parseSalary = (value) => {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    const normalized = raw.replace(/[^\d.,-]/g, '').replace(/\./g, '').replace(',', '.');
    const salary = Number(normalized);
    return Number.isFinite(salary) && salary >= 0 ? salary : NaN;
  };
  const salaryInputValue = (value) => {
    if (value == null || value === '') return '';
    const salary = Number(value);
    return Number.isFinite(salary) ? String(salary) : '';
  };
  const formatSalary = (value) => {
    if (value == null || value === '') return '-';
    const salary = Number(value);
    return Number.isFinite(salary) ? salary.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }) : '-';
  };

  const ui = el('section', { className: 'main-card' }, [
    el('h2', {}, ['Cargos']),
    el('div', { id: 'listPanel' }, [
      el('div', { className: 'form-row' }, [
        el('div', {}, [el('label', { className: 'label' }, ['Buscar']), el('input', { id: 'txtSearch', className: 'input', placeholder: 'Codigo o cargo...' })]),
        el('div', {}, [el('label', { className: 'label' }, ['Estado']), el('select', { id: 'selStatus', className: 'select' }, [el('option', { value: '' }, ['Todos']), el('option', { value: 'activo' }, ['Activos']), el('option', { value: 'inactivo' }, ['Inactivos'])])])
      ]),
      el('div', { className: 'responsive-records mt-2' }, [
        el('div', { className: 'table-wrap responsive-table-view' }, [
          el('table', { className: 'table', id: 'tbl' }, [
            el('thead', {}, [el('tr', {}, [
              el('th', { 'data-sort': 'codigo', style: 'cursor:pointer' }, ['Codigo']),
              el('th', { 'data-sort': 'nombre', style: 'cursor:pointer' }, ['Cargo']),
              el('th', { 'data-sort': 'salario', style: 'cursor:pointer' }, ['Salario']),
              el('th', { 'data-sort': 'alineacionCrud', style: 'cursor:pointer' }, ['Vinculacion']),
              el('th', { 'data-sort': 'estado', style: 'cursor:pointer' }, ['Estado']),
              el('th', {}, ['Funciones']),
              el('th', {}, ['Marcación']),
              el('th', {}, ['Acciones'])
            ])]),
            el('tbody', {})
          ])
        ]),
        el('div', { id: 'cargoCards', className: 'record-card-list' }, [])
      ])
    ])
  ]);

  let snapshot = [];
  let contractList = [];
  let contractCargoList = [];
  const tbody = ui.querySelector('tbody');
  const cards = qs('#cargoCards', ui);
  let sortKey = '';
  let sortDir = 1;
  const paginator = createTablePagination(ui, { id: 'cargos', after: '#listPanel .responsive-records', onChange: render });
  const search = () => qs('#txtSearch', ui).value.trim().toLowerCase();
  const filterStatus = () => qs('#selStatus', ui).value;
  const currentContract = () => contractFilterCode();
  const contractNameByCode = (code) => contractList.find((c) => String(c.codigo || '').trim() === String(code || '').trim())?.nombre || '';


  function contractCargoFor(cargo) {
    const code = String(cargo?.codigo || '').trim();
    const contractCode = currentContract();
    if (!code || !contractCode) return null;
    return contractCargoList.find((row) => String(row?.cargoCodigo || '').trim() === code && String(row?.contratoCodigo || '').trim() === contractCode) || null;
  }

  function salaryFor(cargo) {
    const scoped = contractCargoFor(cargo);
    return scoped ? scoped.salario : cargo.salario;
  }

  function salaryColumnLabel() {
    const code = currentContract();
    return code ? `Salario ${contractNameByCode(code) || code}` : 'Salario base';
  }

  async function saveContractSalary(cargoCodigo, salario, contractCode) {
    if (!contractCode || typeof deps.upsertContractCargo !== 'function') return null;
    return deps.upsertContractCargo({ contratoCodigo: contractCode, cargoCodigo, salario });
  }

  async function openCreateModal() {
    const contractCode = currentContract();
    if (!contractCode) return;
    const modal = await showActionModal({
      title: 'Crear cargo',
      message: currentContract() ? `Contrato: ${contractNameByCode(currentContract()) || currentContract()}` : 'Completa la informacion para crear un cargo base.',
      confirmText: 'Crear cargo',
      fields: [
        mobilityField(),
        { id: 'name', label: 'Cargo', type: 'text', required: true, placeholder: 'Nombre del cargo' },
        { id: 'salary', label: salaryColumnLabel(), type: 'number', min: '0', step: '1', placeholder: '0' },
        { id: 'crud', label: 'Vincular en CRUD', type: 'select', value: 'empleado', options: crudOptions.map((o) => ({ value: o.value, label: o.label })) }
      ]
    });
    if (!modal.confirmed || currentContract() !== contractCode) return;
    const name = String(modal.values.name || '').trim();
    const salario = parseSalary(modal.values.salary);
    const alineacionCrud = String(modal.values.crud || 'empleado').trim() || 'empleado';
    const marcacionMovil = modal.values.mobility?.includes('enabled') === true;
    if (!name) return alert('Escribe el cargo.');
    if (Number.isNaN(salario)) return alert('El salario debe ser un numero valido.');
    try {
      const code = await deps.getNextCargoCode?.();
      const id = await deps.createCargo?.({ codigo: code, nombre: name, salario: null, alineacionCrud, marcacionMovil });
      await saveContractSalary(code, salario, contractCode);
      await deps.addAuditLog?.({ targetType: 'cargo', targetId: id, action: 'create_cargo', after: { codigo: code, nombre: name, salario, contratoCodigo: contractCode, alineacionCrud, marcacionMovil, estado: 'activo' } });
      alert('Cargo creado OK');
    } catch (e) {
      alert('Error: ' + (e?.message || e));
    }
  }

  if (canEdit) {
    const btnOpenCreate = el('button', { id: 'btnOpenCreate', className: 'btn btn--primary right', type: 'button' }, ['Crear cargo']);
    qs('#listPanel .form-row', ui)?.append(btnOpenCreate);
    btnOpenCreate.addEventListener('click', openCreateModal);
  }

  function sortVal(c, key) {
    if (key === 'createdAt') {
      try {
        const x = c.createdAt ? new Date(c.createdAt) : null;
        return x ? x.getTime() : 0;
      } catch {
        return 0;
      }
    }
    if (key === 'salario') return Number(salaryFor(c)) || 0;
    return String(c[key] ?? '').toLowerCase();
  }
  function sortData(data) {
    if (!sortKey) return data;
    const out = [...data];
    out.sort((a, b) => {
      const va = sortVal(a, sortKey);
      const vb = sortVal(b, sortKey);
      if (va === vb) return 0;
      return va > vb ? sortDir : -sortDir;
    });
    return out;
  }
  function updateSortIndicators() {
    ui.querySelectorAll('th[data-sort]').forEach((th) => {
      const key = th.getAttribute('data-sort');
      const base = key === 'salario' ? 'Salario' : (th.dataset.baseLabel || th.textContent.replace(/\s[\^v▲▼]$/, ''));
      th.dataset.baseLabel = base;
      th.textContent = sortKey === key ? `${base} ${sortDir === 1 ? '▲' : '▼'}` : base;
    });
  }
  function initSorting() {
    ui.querySelectorAll('th[data-sort]').forEach((th) => th.addEventListener('click', () => {
      const key = th.getAttribute('data-sort');
      if (sortKey === key) sortDir *= -1;
      else {
        sortKey = key;
        sortDir = 1;
      }
      paginator.reset();
      render();
    }));
  }
  function render() {
    const create = qs('#btnOpenCreate', ui);
    if (create) create.disabled = !currentContract();
    const term = search();
    const st = filterStatus();
    const data = snapshot.filter((c) => {
      const text = [c.codigo, c.nombre, salaryFor(c), formatSalary(salaryFor(c)), crudLabel(c.alineacionCrud || 'empleado')].join(' ').toLowerCase();
      return Boolean(currentContract()) && (!term || text.includes(term)) && (!st || c.estado === st);
    });
    const sorted = sortData(data);
    const pageRows = paginator.slice(sorted);
    tbody.replaceChildren(...pageRows.map(row));
    cards.replaceChildren(...(pageRows.length ? pageRows.map((c) => recordCard(c, {
      title: c.nombre || '-',
      subtitle: `Codigo: ${c.codigo || '-'}`,
      meta: [[salaryColumnLabel(), formatSalary(salaryFor(c))], ['Vinculacion', crudLabel(c.alineacionCrud || 'empleado')], ['Estado', c.estado || '-'], ['Funciones', functionsBadge(c)], ['Marcación', mobilityLabel(c)]],
      actions: actionsCell(c)
    })) : [el('p', { className: 'text-muted record-card__empty' }, ['Sin cargos para mostrar.'])]));
    updateSortIndicators();
  }
  function row(c) {
    const tr = el('tr', { 'data-id': c.id });
    tr.append(
      el('td', {}, [c.codigo || '-']),
      el('td', {}, [c.nombre || '-']),
      el('td', {}, [formatSalary(salaryFor(c))]),
      el('td', {}, [crudLabel(c.alineacionCrud || 'empleado')]),
      el('td', {}, [statusBadge(c.estado)]),
      el('td', {}, [functionsBadge(c)]),
      el('td', {}, [mobilityLabel(c)]),
      el('td', {}, [actionsCell(c)])
    );
    return tr;
  }
  function functionsBadge(c) {
    const assigned = Boolean(c.funciones?.trim());
    return el('span', { className: `badge ${assigned ? 'badge--ok' : 'badge--warn'}` }, [assigned ? 'Asignadas' : 'No asignadas']);
  }
  function statusBadge(st) {
    return el('span', { className: 'badge ' + (st === 'activo' ? 'badge--ok' : 'badge--off') }, [st || '-']);
  }
  function actionsCell(c) {
    const box = el('div', { className: 'row-actions' }, []);
    if (canEdit) {
      const btnMore = el('button', { className: 'btn btn--icon', type: 'button', title: 'Mas opciones', 'aria-label': 'Mas opciones' }, [moreIcon()]);
      btnMore.addEventListener('click', () => openMoreOptionsModal(c));
      box.append(btnMore);
    }
    const btnInfo = el('button', { className: 'btn btn--icon', title: 'Ver informacion', 'aria-label': 'Ver informacion' }, [infoIcon()]);
    btnInfo.addEventListener('click', () => {
      const scoped = contractCargoFor(c);
      const code = currentContract();
      showCatalogDetail(`Informacion de cargo y salario - ${c.nombre || '-'}`, c, [
        ['Datos generales', [['Codigo', c.codigo], ['Cargo', c.nombre], ['Estado', statusBadge(c.estado)], ['Vinculacion', crudLabel(c.alineacionCrud)]]],
        ['Funciones del cargo', [['Funciones', el('div', { style: 'white-space:pre-wrap;overflow-wrap:anywhere' }, [c.funciones || 'Sin funciones registradas'])]]],
        ['Asistencia', [['Marcación', mobilityLabel(c)]]],
        ['Salario del contrato', [
          ['Contrato', contractNameByCode(code) || code],
          ['Codigo contrato', code],
          ['Salario', formatSalary(salaryFor(c))],
          ['Origen del salario', scoped ? 'Configurado para el contrato' : 'Salario base del cargo'],
          ['Creado por', scoped?.createdByEmail || scoped?.createdByUid],
          ['Fecha creacion', detailDate(scoped?.createdAt)],
          ['Fecha actualizacion', detailDate(scoped?.updatedAt)]
        ]]
      ]);
    });
    box.append(btnInfo);
    return box;
  }
  async function openMoreOptionsModal(c) {
    const contractCode = currentContract();
    const modal = await showActionModal({
      title: 'Mas opciones',
      message: `Cargo: ${c.nombre || '-'}`,
      confirmText: 'Continuar',
      fields: [{
        id: 'action', label: 'Accion', type: 'select', required: true,
        options: [
          { value: '', label: 'Seleccione...' },
          { value: 'edit', label: 'Editar cargo y salario' },
          { value: 'functions', label: 'Funciones' },
          { value: 'toggle', label: c.estado === 'activo' ? 'Desactivar' : 'Activar' }
        ]
      }]
    });
    if (!modal.confirmed || currentContract() !== contractCode) return;
    if (modal.values.action === 'edit') return openEditModal(c);
    if (modal.values.action === 'functions') return openFunctionsModal(c);
    if (modal.values.action === 'toggle') return openToggleModal(c);
  }
  async function openToggleModal(c) {
    const target = c.estado === 'activo' ? 'inactivo' : 'activo';
    const modal = await showActionModal({
      title: `${target === 'inactivo' ? 'Desactivar' : 'Activar'} cargo`,
      message: `Cargo: ${c.nombre || '-'}`,
      confirmText: target === 'inactivo' ? 'Desactivar' : 'Activar',
      fields: [{ id: 'detail', label: 'Detalle', type: 'textarea', required: true, placeholder: 'Escribe el motivo o detalle de esta accion' }]
    });
    if (!modal.confirmed) return;
    try {
      await deps.setCargoStatus?.(c.id, target);
      await deps.addAuditLog?.({ targetType: 'cargo', targetId: c.id, action: target === 'activo' ? 'activate_cargo' : 'deactivate_cargo', before: { estado: c.estado }, after: { estado: target }, note: modal.values.detail || null });
    } catch (e) {
      alert('Error: ' + (e?.message || e));
    }
  }
  async function openFunctionsModal(c) {
    const contractCode = currentContract();
    const modal = await showActionModal({
      title: `Funciones del cargo: ${c.nombre || c.codigo}`,
      message: 'Escribe una función por línea (máximo 12.000 caracteres). Este texto se incluirá en los certificados de empleados activos e inactivos asociados a este cargo, en todos los contratos.',
      confirmText: 'Guardar funciones',
      fields: [
        { id: 'funciones', label: 'Funciones del cargo', type: 'textarea', rows: 10, value: c.funciones || '', placeholder: 'Escribe una función por línea' },
        { id: 'detail', label: 'Detalle de la modificación', type: 'textarea', required: true }
      ]
    });
    if (!modal.confirmed || currentContract() !== contractCode) return;
    const funciones = String(modal.values.funciones || '').trim();
    if (funciones.length > 12000) return alert('Las funciones no pueden superar los 12.000 caracteres.');
    try {
      await deps.updateCargo(c.id, { funciones });
      await deps.addAuditLog?.({ targetType: 'cargo', targetId: c.id, action: 'update_cargo_functions', before: { funciones: c.funciones || '' }, after: { funciones }, note: modal.values.detail });
    } catch (error) { alert('Error: ' + (error?.message || error)); }
  }
  async function openEditModal(c) {
    const contractCode = currentContract();
    if (!contractCode) return;
    const modal = await showActionModal({
      title: 'Editar cargo',
      message: currentContract() ? `Cargo: ${c.nombre || '-'} | Contrato: ${contractNameByCode(currentContract()) || currentContract()}` : `Cargo: ${c.nombre || '-'}`,
      confirmText: 'Guardar cambios',
      fields: [
        mobilityField(c),
        { id: 'code', label: 'Codigo', type: 'text', required: true, value: c.codigo || '' },
        { id: 'name', label: 'Cargo', type: 'text', required: true, value: c.nombre || '' },
        { id: 'salary', label: salaryColumnLabel(), type: 'number', min: '0', step: '1', value: salaryInputValue(salaryFor(c)) },
        { id: 'crud', label: 'Vincular en CRUD', type: 'select', value: c.alineacionCrud || 'empleado', options: crudOptions.map((o) => ({ value: o.value, label: o.label })) },
        { id: 'detail', label: 'Detalle de la modificacion', type: 'textarea', required: true, placeholder: 'Describe brevemente el cambio realizado' }
      ]
    });
    if (!modal.confirmed || currentContract() !== contractCode) return;
    const newCode = String(modal.values.code || '').trim();
    const newName = String(modal.values.name || '').trim();
    const newSalary = parseSalary(modal.values.salary);
    const newCrud = String(modal.values.crud || 'empleado').trim() || 'empleado';
    const marcacionMovil = modal.values.mobility?.includes('enabled') === true;
    if (!newCode || !newName) return alert('Completa codigo y cargo.');
    if (Number.isNaN(newSalary)) return alert('El salario debe ser un numero valido.');
    try {
      if (newCode !== c.codigo) {
        const dup = await deps.findCargoByCode?.(newCode);
        if (dup && dup.id !== c.id) return alert('Ya existe un cargo con ese codigo.');
      }
      await deps.updateCargo?.(c.id, { codigo: newCode, nombre: newName, salario: undefined, alineacionCrud: newCrud, marcacionMovil });
      await saveContractSalary(newCode, newSalary, contractCode);
      await deps.addAuditLog?.({
        targetType: 'cargo',
        targetId: c.id,
        action: 'update_cargo',
        before: { codigo: c.codigo, nombre: c.nombre, salario: salaryFor(c) ?? null, contratoCodigo: contractCode, alineacionCrud: c.alineacionCrud || 'empleado', marcacionMovil: c.marcacionMovil === true },
        after: { codigo: newCode, nombre: newName, salario: newSalary, contratoCodigo: contractCode, alineacionCrud: newCrud, marcacionMovil },
        note: modal.values.detail || null
      });
    } catch (e) {
      alert('Error: ' + (e?.message || e));
    }
  }
  function recordCard(item, { title, subtitle, meta = [], actions }) {
    return el('article', { className: 'record-card' }, [
      el('div', { className: 'record-card__header' }, [
        el('div', { className: 'record-card__identity' }, [
          el('strong', { className: 'record-card__title' }, [title]),
          el('span', { className: 'record-card__subtitle' }, [subtitle])
        ]),
        statusBadge(item.estado)
      ]),
      el('dl', { className: 'record-card__meta' }, meta.map(([label, value]) => el('div', { className: 'record-card__meta-item' }, [el('dt', {}, [label]), el('dd', {}, [value || '-'])]))),
      el('div', { className: 'record-card__actions' }, [actions])
    ]);
  }

  const unContracts = deps.streamContracts?.((arr) => {
    contractList = (arr || []).filter((c) => c.estado !== 'inactivo');
    paginator.reset();
    render();
  }) || (() => {});
  const unCargos = deps.streamCargos?.((arr) => {
    snapshot = arr || [];
    render();
  }) || (() => {});
  const unContractCargos = deps.streamContractCargos?.((arr) => {
    contractCargoList = arr || [];
    render();
  }) || (() => {});
  qs('#txtSearch', ui).addEventListener('input', () => { paginator.reset(); render(); });
  qs('#selStatus', ui).addEventListener('change', () => { paginator.reset(); render(); });
  initSorting();
  mount.replaceChildren(ui);
  const unSelectedContract = subscribe('selectedContractCode', () => {
    closeActionModal();
    paginator.reset();
    render();
  });
  return () => {
    closeActionModal();
    unCargos?.();
    unContractCargos?.();
    unContracts?.();
    unSelectedContract?.();
  };
};
