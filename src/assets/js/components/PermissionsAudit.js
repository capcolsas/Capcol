import { el, qs } from '../utils/dom.js';
import { can, isSuperAdmin, PERMS } from '../permissions.js';
import { createTablePagination } from '../utils/pagination.js';
import { contractOption, sortContractsLatestFirst } from '../utils/contractScope.js';

// Same value as AUDIT_COMPANY_WIDE in the audit service: entries without contract.
const COMPANY_WIDE = '__company__';

export const PermissionsAudit = (mount, deps = {}) => {
  if (!isSuperAdmin() && !can(PERMS.VIEW_AUDIT)) {
    mount.replaceChildren(
      el('section', { className: 'main-card' }, [
        el('h2', {}, ['Auditoria']),
        el('p', {}, ['No tienes permiso para consultar la auditoria.'])
      ])
    );
    return;
  }

  let unAudit = null;
  let unAuditClosures = null;
  let activityItems = [];
  let closureItems = [];
  let activityPaginator = null;
  let closurePaginator = null;
  let contracts = [];
  let contractFilter = '';

  const ui = el('section', { className: 'main-card' }, [
    el('h2', {}, ['Auditoria']),
    el('div', { className: 'form-row' }, [
      el('div', {}, [
        el('label', { className: 'label' }, ['Contrato']),
        el('select', { id: 'auditContract', className: 'select' }, [])
      ])
    ]),
    el('div', { className: 'audit-columns mt-2' }, [
      auditColumn('Actividades', 'Cambios de usuarios, permisos, catalogos, sedes, empleados y turnos.', 'auditActivityList'),
      auditColumn('Cierres', 'Registros generados por cierres diarios y cierres de turno.', 'auditClosureList')
    ])
  ]);

  function clearAuditStream() {
    if (typeof unAudit === 'function') {
      try {
        unAudit();
      } catch {}
      unAudit = null;
    }
    if (typeof unAuditClosures === 'function') {
      try {
        unAuditClosures();
      } catch {}
      unAuditClosures = null;
    }
  }

  function renderActivityPage() {
    const list = qs('#auditActivityList', ui);
    if (!list) return;
    if (!activityPaginator || !ui.contains(activityPaginator.controls)) {
      activityPaginator = createTablePagination(ui, { id: 'permissionsAuditActivity', after: '#auditActivityList', compactNav: true, onChange: renderActivityPage });
    }
    const pageItems = activityPaginator.slice(activityItems);
    list.replaceChildren(...(pageItems.length
      ? pageItems.map((it) => renderAuditItem(it))
      : [el('p', { className: 'text-muted' }, ['Sin actividades normales para mostrar.'])]
    ));
  }

  function renderClosurePage() {
    const list = qs('#auditClosureList', ui);
    if (!list) return;
    if (!closurePaginator || !ui.contains(closurePaginator.controls)) {
      closurePaginator = createTablePagination(ui, { id: 'permissionsAuditClosures', after: '#auditClosureList', compactNav: true, onChange: renderClosurePage });
    }
    const pageItems = closurePaginator.slice(closureItems);
    list.replaceChildren(...(pageItems.length
      ? pageItems.map((it) => renderAuditItem(it))
      : [el('p', { className: 'text-muted' }, ['Sin cierres registrados para mostrar.'])]
    ));
  }

  function auditColumn(title, subtitle, listId) {
    return el('article', { className: 'audit-column' }, [
      el('div', { className: 'audit-column__header' }, [
        el('strong', {}, [title]),
        el('span', { className: 'text-muted' }, [subtitle])
      ]),
      el('div', { id: listId, className: 'audit-column__list' }, [])
    ]);
  }

  // Only the contracts the user works on (the contract stream is already scoped by RLS).
  function renderContractOptions() {
    const select = qs('#auditContract', ui);
    const options = [
      { value: '', label: 'Todos mis contratos' },
      ...sortContractsLatestFirst(contracts).map((contract) => contractOption(contract)).filter((opt) => opt.value),
      { value: COMPANY_WIDE, label: 'Generales (usuarios, perfiles y catalogos)' }
    ];
    if (!options.some((opt) => opt.value === contractFilter)) contractFilter = '';
    select.replaceChildren(...options.map((opt) => el('option', { value: opt.value, selected: opt.value === contractFilter }, [opt.label])));
  }

  function contractLabel(code) {
    if (!code) return 'General';
    const contract = contracts.find((row) => String(row.codigo || '').trim() === code);
    return contract ? contractOption(contract).label : code;
  }

  function renderAuditItem(it) {
    const date = it.ts || new Date();
    const note = String(it.note || '').trim();
    const beforeText = formatAuditValue(it.before);
    const afterText = formatAuditValue(it.after);
    return el('div', { className: 'card audit-item-card' }, [
      el('div', {}, [el('strong', {}, [it.action || 'accion']), ' - ', new Date(date).toLocaleString()]),
      el('div', { className: 'mt-1 text-muted' }, [`Actor: ${it.actorEmail || it.actorUid || '-'}`]),
      el('div', { className: 'mt-1' }, [`Contrato: ${contractLabel(it.contratoCodigo)}`]),
      el('div', { className: 'mt-1' }, [`Target: ${it.targetType || '-'}/${it.targetId || '-'}`]),
      el('div', { className: 'mt-1' }, [`Observacion: ${note || '-'}`]),
      el('details', { className: 'mt-1' }, [
        el('summary', {}, ['Ver cambios (Antes / Despues)']),
        el('div', { className: 'mt-1' }, [
          el('div', {}, [el('strong', {}, ['Antes'])]),
          el(
            'pre',
            { className: 'mt-1', style: 'white-space:pre-wrap;word-break:break-word;background:#f7f7f7;padding:.5rem;border-radius:.375rem' },
            [beforeText]
          ),
          el('div', { className: 'mt-1' }, [el('strong', {}, ['Despues'])]),
          el(
            'pre',
            { className: 'mt-1', style: 'white-space:pre-wrap;word-break:break-word;background:#f7f7f7;padding:.5rem;border-radius:.375rem' },
            [afterText]
          )
        ])
      ])
    ]);
  }

  function formatAuditValue(value) {
    if (value == null) return '-';
    if (typeof value === 'string') return value.trim() || '-';
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  function startAuditStreams() {
    clearAuditStream();
    const options = { contratoCodigo: contractFilter };
    if (deps.streamAuditLogsByKind) {
      unAudit = deps.streamAuditLogsByKind('activity', (items) => {
        activityItems = items || [];
        activityPaginator?.reset?.();
        renderActivityPage();
      }, 200, options) || null;
      unAuditClosures = deps.streamAuditLogsByKind('closure', (items) => {
        closureItems = items || [];
        closurePaginator?.reset?.();
        renderClosurePage();
      }, 200, options) || null;
    } else {
      unAudit =
        deps.streamAuditLogs?.((items) => {
          const rows = (items || []).filter((row) => matchesContract(row));
          activityItems = rows.filter((row) => !isClosureAudit(row));
          closureItems = rows.filter(isClosureAudit);
          activityPaginator?.reset?.();
          closurePaginator?.reset?.();
          renderActivityPage();
          renderClosurePage();
        }) || null;
    }
  }

  function matchesContract(row = {}) {
    if (!contractFilter) return true;
    if (contractFilter === COMPANY_WIDE) return !row.contratoCodigo;
    return row.contratoCodigo === contractFilter;
  }

  mount.replaceChildren(ui);
  renderContractOptions();
  qs('#auditContract', ui).addEventListener('change', (event) => {
    contractFilter = String(event.target.value || '');
    startAuditStreams();
  });
  const unContracts = deps.streamContracts?.((rows) => {
    contracts = rows || [];
    renderContractOptions();
    renderActivityPage();
    renderClosurePage();
  });
  startAuditStreams();

  renderActivityPage();
  renderClosurePage();

  return () => {
    clearAuditStream();
    unContracts?.();
  };
};

function isClosureAudit(row = {}) {
  return ['daily_closure', 'shift_closure'].includes(String(row.targetType || '').trim());
}
