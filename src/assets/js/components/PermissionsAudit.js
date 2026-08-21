import { el, qs } from '../utils/dom.js';
import { can, isSuperAdmin, PERMS } from '../permissions.js';
import { createTablePagination } from '../utils/pagination.js';

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

  const ui = el('section', { className: 'main-card' }, [
    el('h2', {}, ['Auditoria']),
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
      activityPaginator = createTablePagination(ui, { id: 'permissionsAuditActivity', after: '#auditActivityList', onChange: renderActivityPage });
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
      closurePaginator = createTablePagination(ui, { id: 'permissionsAuditClosures', after: '#auditClosureList', onChange: renderClosurePage });
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

  function renderAuditItem(it) {
    const date = it.ts?.toDate ? it.ts.toDate() : it.ts || new Date();
    const note = String(it.note || '').trim();
    const beforeText = formatAuditValue(it.before);
    const afterText = formatAuditValue(it.after);
    return el('div', { className: 'card audit-item-card' }, [
      el('div', {}, [el('strong', {}, [it.action || 'accion']), ' - ', new Date(date).toLocaleString()]),
      el('div', { className: 'mt-1 text-muted' }, [`Actor: ${it.actorEmail || it.actorUid || '-'}`]),
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

  mount.replaceChildren(ui);
  if (deps.streamAuditLogsByKind) {
    unAudit = deps.streamAuditLogsByKind('activity', (items) => {
      activityItems = items || [];
      activityPaginator?.reset?.();
      renderActivityPage();
    }, 200) || null;
    unAuditClosures = deps.streamAuditLogsByKind('closure', (items) => {
      closureItems = items || [];
      closurePaginator?.reset?.();
      renderClosurePage();
    }, 200) || null;
  } else {
    unAudit =
      deps.streamAuditLogs?.((items) => {
        const rows = items || [];
        activityItems = rows.filter((row) => !isClosureAudit(row));
        closureItems = rows.filter(isClosureAudit);
        activityPaginator?.reset?.();
        closurePaginator?.reset?.();
        renderActivityPage();
        renderClosurePage();
      }) || null;
  }

  renderActivityPage();
  renderClosurePage();

  return () => clearAuditStream();
};

function isClosureAudit(row = {}) {
  return ['daily_closure', 'shift_closure'].includes(String(row.targetType || '').trim());
}
