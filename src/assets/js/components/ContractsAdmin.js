import { el, qs, infoIcon, moreIcon, lucideInlineIcon } from '../utils/dom.js';
import { showContractImageEditor } from './ContractImageEditor.js';
import { showCatalogDetail } from '../utils/catalogDetail.js';
import { showActionModal } from '../utils/actionModal.js';
import { contractActions } from './contractActions.js';
import { createTablePagination } from '../utils/pagination.js';
import { can, PERMS } from '../permissions.js';

export const ContractsAdmin = (mount, deps = {}) => {
  const { openCreateModal, openEditModal, toggleStatus } = contractActions(deps);
  const canEdit = can(PERMS.EDIT_CONTRACTS);
  const ui = el('section', { className: 'main-card' }, [
    el('h2', {}, ['Contratos']),
    el('div', { id: 'listPanel' }, [
      el('div', { className: 'form-row' }, [
        el('div', {}, [el('label', { className: 'label' }, ['Buscar']), el('input', { id: 'txtSearch', className: 'input', placeholder: 'Codigo, contrato, cliente o NIT...' })]),
        el('div', {}, [el('label', { className: 'label' }, ['Estado']), el('select', { id: 'selStatus', className: 'select' }, [el('option', { value: '' }, ['Todos']), el('option', { value: 'activo' }, ['Activos']), el('option', { value: 'inactivo' }, ['Inactivos'])])])
      ]),
      el('div', { className: 'responsive-records mt-2' }, [
        el('div', { className: 'table-wrap responsive-table-view' }, [
          el('table', { className: 'table', id: 'tbl' }, [
            el('thead', {}, [el('tr', {}, [
              el('th', { 'data-sort': 'nombre', style: 'cursor:pointer' }, ['Contrato']),
              el('th', { 'data-sort': 'numeroContrato', style: 'cursor:pointer' }, ['Numero']),
              el('th', { 'data-sort': 'clienteNombre', style: 'cursor:pointer' }, ['Cliente']),
              el('th', { 'data-sort': 'fechaInicio', style: 'cursor:pointer' }, ['Inicio']),
              el('th', { 'data-sort': 'fechaFin', style: 'cursor:pointer' }, ['Fin']),
              el('th', { 'data-sort': 'estado', style: 'cursor:pointer' }, ['Estado']),
              el('th', {}, ['Acciones'])
            ])]),
            el('tbody', {})
          ])
        ]),
        el('div', { id: 'contractCards', className: 'record-card-list' }, [])
      ])
    ])
  ]);

  let snapshot = [];
  let closeImageEditor = null;
  const tbody = ui.querySelector('tbody');
  const cards = qs('#contractCards', ui);
  let sortKey = '';
  let sortDir = 1;
  const paginator = createTablePagination(ui, { id: 'contracts', after: '#listPanel .responsive-records', onChange: render });

  if (canEdit) {
    const btnOpenCreate = el('button', { id: 'btnOpenCreate', className: 'btn btn--primary right', type: 'button' }, ['Crear contrato']);
    qs('#listPanel .form-row', ui)?.append(btnOpenCreate);
    btnOpenCreate.addEventListener('click', openCreateModal);
  }

  const search = () => qs('#txtSearch', ui).value.trim().toLowerCase();
  const filterStatus = () => qs('#selStatus', ui).value;


  function render() {
    const term = search();
    const st = filterStatus();
    const data = snapshot.filter((contract) => {
      const text = [contract.codigo, contract.nombre, contract.numeroContrato, contract.clienteNombre, contract.clienteNit].join(' ').toLowerCase();
      return (!term || text.includes(term)) && (!st || contract.estado === st);
    });
    const sorted = sortData(data);
    const pageRows = paginator.slice(sorted);
    tbody.replaceChildren(...pageRows.map(row));
    cards.replaceChildren(...(pageRows.length ? pageRows.map(contractCard) : [el('p', { className: 'text-muted record-card__empty' }, ['Sin contratos para mostrar.'])]));
    updateSortIndicators();
  }

  function row(contract) {
    const tr = el('tr', { 'data-id': contract.id });
    tr.append(
      el('td', {}, [contract.nombre || '-']),
      el('td', {}, [contract.numeroContrato || '-']),
      el('td', {}, [contract.clienteNombre || '-']),
      el('td', {}, [contract.fechaInicio || '-']),
      el('td', {}, [contract.fechaFin || '-']),
      el('td', {}, [statusBadge(contract.estado)]),
      el('td', {}, [actionsCell(contract)])
    );
    return tr;
  }

  function contractCard(contract) {
    return recordCard(contract, {
      title: contract.nombre || '-',
      subtitle: `Codigo: ${contract.codigo || '-'}`,
      meta: [
        ['Numero', contract.numeroContrato || '-'],
        ['Cliente', contract.clienteNombre || '-'],
        ['NIT', contract.clienteNit || '-'],
        ['Vigencia', `${contract.fechaInicio || '-'} a ${contract.fechaFin || '-'}`],
        ['Contacto', contract.clienteContacto || contract.clienteEmail || contract.clienteTelefono || '-']
      ],
      actions: actionsCell(contract)
    });
  }

  function actionsCell(contract) {
    const box = el('div', { className: 'row-actions' }, []);
    if (canEdit) {
      const btnMore = el('button', { className: 'btn btn--icon', title: 'Mas opciones', 'aria-label': 'Mas opciones', type: 'button' }, [moreIcon()]);
      btnMore.addEventListener('click', () => openMoreOptionsModal(contract));
      const btnImage = el('button', { className: 'btn btn--icon', title: 'Imagen de referencia', 'aria-label': 'Imagen de referencia', type: 'button' }, [lucideInlineIcon('image', 'IM')]);
      btnImage.addEventListener('click', () => {
        closeImageEditor?.();
        closeImageEditor = showContractImageEditor(contract, deps);
      });
      box.append(btnMore, btnImage);
    }
    const btnInfo = el('button', { className: 'btn btn--icon', title: 'Ver informacion', 'aria-label': 'Ver informacion', type: 'button' }, [infoIcon()]);
    btnInfo.addEventListener('click', () => showCatalogDetail(`Contrato - ${contract.nombre || '-'}`, contract, [
      ['Datos generales', [
        ['Codigo', contract.codigo],
        ['Numero de contrato', contract.numeroContrato],
        ['Estado', statusBadge(contract.estado)],
        ['Vigencia', `${contract.fechaInicio || '-'} a ${contract.fechaFin || '-'}`]
      ]],
      ['Cliente', [
        ['Nombre o razon social', contract.clienteNombre],
        ['NIT', contract.clienteNit]
      ]],
      ['Contacto del cliente', [
        ['Nombre', contract.clienteContacto],
        ['Correo electronico', contract.clienteEmail],
        ['Telefono', contract.clienteTelefono]
      ]]
    ]));
    box.append(btnInfo);
    return box;
  }

  async function openMoreOptionsModal(contract) {
    const modal = await showActionModal({
      title: 'Mas opciones',
      message: `Contrato: ${contract.nombre || '-'}`,
      confirmText: 'Continuar',
      fields: [{
        id: 'action', label: 'Accion', type: 'select', required: true,
        options: [
          { value: '', label: 'Seleccione...' },
          { value: 'edit', label: 'Editar contrato' },
          { value: 'toggle', label: contract.estado === 'activo' ? 'Desactivar contrato' : 'Activar contrato' }
        ]
      }]
    });
    if (!modal.confirmed) return;
    if (modal.values.action === 'edit') return openEditModal(contract);
    if (modal.values.action === 'toggle') return toggleStatus(contract);
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
      el('dl', { className: 'record-card__meta' }, meta.map(([label, value]) => el('div', { className: 'record-card__meta-item' }, [
        el('dt', {}, [label]),
        el('dd', {}, [value || '-'])
      ]))),
      el('div', { className: 'record-card__actions' }, [actions])
    ]);
  }

  function statusBadge(st) {
    return el('span', { className: 'badge ' + (st === 'activo' ? 'badge--ok' : 'badge--off') }, [st || '-']);
  }

  function sortValue(contract, key) {
    return String(contract?.[key] ?? '').toLowerCase();
  }

  function sortData(data) {
    if (!sortKey) return data;
    return [...data].sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      if (av === bv) return 0;
      return av > bv ? sortDir : -sortDir;
    });
  }

  function updateSortIndicators() {
    ui.querySelectorAll('th[data-sort]').forEach((th) => {
      const base = th.dataset.baseLabel || th.textContent.replace(/\s[\^v▲▼]$/, '');
      th.dataset.baseLabel = base;
      const key = th.getAttribute('data-sort');
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

  initSorting();
  qs('#txtSearch', ui).addEventListener('input', () => { paginator.reset(); render(); });
  qs('#selStatus', ui).addEventListener('change', () => { paginator.reset(); render(); });
  const un = deps.streamContracts?.((arr) => { snapshot = arr || []; render(); });
  mount.replaceChildren(ui);
  return () => { un?.(); closeImageEditor?.(); };
};
