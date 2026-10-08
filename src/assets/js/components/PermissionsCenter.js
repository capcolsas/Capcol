import { el } from '../utils/dom.js';
import { showActionModal } from '../utils/actionModal.js';
import { showInfoModal } from '../utils/infoModal.js';
import { can, isSuperAdmin, resolvePermissions } from '../permissions.js';
import { ALL_ROLES, PERMISSION_ACTION_VIEW_MAP, ROLE_LABELS, ROLES, PERMS } from '../roles.js';
import { getState } from '../state.js';

// Every module the app routes to has a row here. A row without `action` is consult-only: the module has
// no actions of its own. `note` lists the other screens the same permission opens.
const PERMISSION_SECTIONS = [
  {
    title: 'Administracion',
    description: 'Contratos, catalogos base, estructura operativa y configuracion QR.',
    items: [
      { label: 'Contratos', view: PERMS.VIEW_CONTRACTS, action: PERMS.EDIT_CONTRACTS, actionLabel: 'Edicion', note: 'Consulta tambien habilita: Detalle de contrato y el selector de contrato del menu.' },
      { label: 'Zonas', view: PERMS.VIEW_ZONES, action: PERMS.EDIT_ZONES, actionLabel: 'Edicion' },
      { label: 'Inventarios', view: PERMS.VIEW_INVENTORY, action: PERMS.MANAGE_INVENTORY, actionLabel: 'Ingresos y ajustes' },
      { label: 'Entregas de inventario', view: PERMS.VIEW_INVENTORY, action: PERMS.DISPATCH_INVENTORY, actionLabel: 'Despachar' },
      { label: 'Recibidos de inventario', view: PERMS.VIEW_INVENTORY, action: PERMS.RECEIVE_INVENTORY, actionLabel: 'Registrar firma' },
      { label: 'Dependencias', view: PERMS.VIEW_DEPENDENCIES, action: PERMS.EDIT_DEPENDENCIES, actionLabel: 'Edicion' },
      { label: 'Sedes', view: PERMS.VIEW_SEDES, action: PERMS.EDIT_SEDES, actionLabel: 'Edicion', note: 'Tambien habilita: Ubicacion sedes.' },
      { label: 'Lector QR', view: PERMS.VIEW_QR_SCANNER, action: PERMS.USE_QR_SCANNER, actionLabel: 'Usar lector' },
      { label: 'Tablets QR', view: PERMS.VIEW_QR_DEVICES, action: PERMS.MANAGE_QR_DEVICES, actionLabel: 'Administrar' },
      { label: 'Cargos', view: PERMS.VIEW_CARGOS, action: PERMS.EDIT_CARGOS, actionLabel: 'Edicion' },
      { label: 'Novedades', view: PERMS.VIEW_NOVEDADES, action: PERMS.EDIT_NOVEDADES, actionLabel: 'Edicion' }
    ]
  },
  {
    title: 'Empleados',
    description: 'Base de personal, historial laboral, supervisores e incapacidades.',
    items: [
      { label: 'Empleados', view: PERMS.VIEW_EMPLOYEES, action: PERMS.EDIT_EMPLOYEES, actionLabel: 'Edicion' },
      { label: 'Novedades empleados', view: PERMS.VIEW_EMPLOYEE_NOVELTIES, action: PERMS.MANAGE_EMPLOYEE_SCHEDULES, actionLabel: 'Programar' },
      { label: 'Supervisores', view: PERMS.VIEW_SUPERVISORS, action: PERMS.EDIT_SUPERVISORS, actionLabel: 'Edicion' },
      { label: 'Incapacidades', view: PERMS.VIEW_INCAPACITIES, action: PERMS.MANAGE_INCAPACITIES, actionLabel: 'Gestionar' }
    ]
  },
  {
    title: 'Turnos',
    description: 'Planes, turnos activos, rotaciones, visitas y revision de novedades por turno.',
    items: [
      { label: 'Planes de turnos', view: PERMS.VIEW_SHIFT_PLANS, action: PERMS.MANAGE_SHIFT_PLANS, actionLabel: 'Gestionar' },
      { label: 'Turnos generados', view: PERMS.VIEW_GENERATED_SHIFTS, action: PERMS.MANAGE_GENERATED_SHIFTS, actionLabel: 'Gestionar', note: 'Consulta tambien habilita: Calendario.' },
      { label: 'Rotaciones', view: PERMS.VIEW_SHIFT_ROTATIONS, note: 'Crear y editar rotaciones queda reservado a Administrativo y SuperAdmin.' },
      { label: 'Revision de turnos', view: PERMS.VIEW_SHIFT_REVIEW, action: PERMS.MANAGE_SHIFT_REVIEW, actionLabel: 'Gestionar' },
      { label: 'Visitas', view: PERMS.VIEW_SITE_VISITS, action: PERMS.MANAGE_SITE_VISITS, actionLabel: 'Programar y revisar' }
    ]
  },
  {
    title: 'Operacion',
    description: 'Registro diario, supernumerarios e historial.',
    items: [
      { label: 'Registro diario y sede', view: PERMS.VIEW_OPERATION_REGISTRY, action: PERMS.MANAGE_OPERATION_REGISTRY, actionLabel: 'Gestionar', note: 'Tambien habilita: Registro Sede y Reemplazos.' },
      { label: 'Registro diario (solo QR)', view: PERMS.VIEW_QR_DAILY_REGISTRY, note: 'Abre Registro Diario en consulta. Para gestionar novedades usa "Registro diario y sede".' },
      { label: 'Supernumerarios', view: PERMS.VIEW_SUPERNUMERARIOS, action: PERMS.EDIT_SUPERNUMERARIOS, actionLabel: 'Edicion' },
      { label: 'Historial', view: PERMS.VIEW_IMPORT_HISTORY }
    ]
  },
  {
    title: 'Reportes',
    description: 'Resumen de contrato, historicos diarios, QR, empleados, contratacion y consolidados.',
    items: [
      { label: 'Resumen de contrato', view: PERMS.VIEW_CONTRACT_DASHBOARD },
      { label: 'Historico Registro Diario', view: PERMS.VIEW_REPORTS_CLIENT, action: PERMS.EXPORT_REPORTS_CLIENT, actionLabel: 'Exportar', note: 'Consulta tambien habilita: Reporte Contratos.' },
      { label: 'Historico Registro QR', view: PERMS.VIEW_REPORTS_QR_HISTORY, action: PERMS.EXPORT_REPORTS_QR_HISTORY, actionLabel: 'Exportar' },
      { label: 'Ausentismo', view: PERMS.VIEW_REPORTS_ABSENTEEISM, action: PERMS.EXPORT_REPORTS_ABSENTEEISM, actionLabel: 'Exportar' },
      { label: 'Empleados', view: PERMS.VIEW_REPORTS_EMPLOYEES, action: PERMS.EXPORT_REPORTS_EMPLOYEES, actionLabel: 'Exportar' },
      { label: 'Contratacion por Sedes', view: PERMS.VIEW_REPORTS_HIRING, action: PERMS.EXPORT_REPORTS_HIRING, actionLabel: 'Exportar' },
      { label: 'Consolidado Novedades', view: PERMS.VIEW_REPORTS_NOVELTIES_CONSOLIDATED, action: PERMS.EXPORT_REPORTS_NOVELTIES_CONSOLIDATED, actionLabel: 'Exportar' },
      { label: 'Consolidado Servicios', view: PERMS.VIEW_REPORTS_SERVICES_CONSOLIDATED, action: PERMS.EXPORT_REPORTS_SERVICES_CONSOLIDATED, actionLabel: 'Exportar' }
    ]
  },
  {
    title: 'Cargue masivo',
    description: 'Plantillas y cargues masivos de sedes y empleados.',
    items: [
      { label: 'Cargue sedes', view: PERMS.VIEW_BULK_UPLOAD_SEDES, action: PERMS.BULK_UPLOAD_SEDES, actionLabel: 'Importar' },
      { label: 'Cargue empleados', view: PERMS.VIEW_BULK_UPLOAD_EMPLOYEES, action: PERMS.BULK_UPLOAD_EMPLOYEES, actionLabel: 'Importar', note: 'Tambien habilita: Actualizar empleados.' }
    ]
  },
  {
    title: 'Gobierno',
    description: 'Usuarios, auditoria y administracion de permisos.',
    items: [
      { label: 'Centro de permisos', view: PERMS.VIEW_PERMISSIONS, action: PERMS.MANAGE_PERMISSIONS, actionLabel: 'Editar' },
      { label: 'Auditoria', view: PERMS.VIEW_AUDIT },
      { label: 'Usuarios', view: PERMS.VIEW_USERS, action: PERMS.EDIT_USERS, actionLabel: 'Edicion', note: 'Edicion incluye asignar contratos a cada usuario.' }
    ]
  }
];

export const PermissionsCenter = (mount, deps = {}) => {
  const canViewPermissions = isSuperAdmin() || can(PERMS.VIEW_PERMISSIONS);
  const canManagePermissions = isSuperAdmin() || can(PERMS.MANAGE_PERMISSIONS);
  if (!canViewPermissions) {
    mount.replaceChildren(
      el('section', { className: 'main-card' }, [
        el('h2', {}, ['Centro de Permisos']),
        el('p', {}, ['No tienes permiso para consultar permisos.'])
      ])
    );
    return;
  }

  let selectedRole = ROLES.ADMIN;

  const ui = el('section', { className: 'main-card' }, [
    el('h2', {}, ['Centro de Permisos']),
    renderRolesTab()
  ]);

  function renderRolesTab() {
    const panel = el('div', {}, []);
    const roleSel = el(
      'select',
      { className: 'select', style: 'max-width:260px' },
      ALL_ROLES.map((r) => el('option', { value: r, selected: r === selectedRole }, [ROLE_LABELS[r] || r]))
    );
    roleSel.addEventListener('change', () => {
      selectedRole = roleSel.value;
      panel.replaceWith(renderRolesTab());
    });

    const s = getState();
    const matrix = s.roleMatrix || {};
    const computedBase = resolvePermissions(selectedRole, matrix[selectedRole] || null);
    const original = JSON.parse(JSON.stringify(computedBase));
    const base = JSON.parse(JSON.stringify(computedBase));
    const editingSuperAdmin = selectedRole === ROLES.SUPERADMIN;
    const readOnly = editingSuperAdmin || !canManagePermissions;

    const groups = el(
      'div',
      { className: 'permissions-center__modules' },
      PERMISSION_SECTIONS.map((sectionDef, index) => permissionSection(sectionDef, index, base, readOnly))
    );

    const warnSA = editingSuperAdmin
      ? el('p', { className: 'warn mt-1' }, ['Edicion de SuperAdmin bloqueada (solo lectura).'])
      : !canManagePermissions
        ? el('p', { className: 'warn mt-1' }, ['Modo consulta: no tienes permiso para guardar cambios.'])
      : null;

    const actions = el('div', { className: 'mt-2' }, [
      el(
        'button',
        {
          className: 'btn btn--primary',
          disabled: readOnly,
          onclick: async () => {
            if (readOnly) return;
            const roleLabel = ROLE_LABELS[selectedRole] || selectedRole;
            const modal = await showActionModal({
              title: 'Guardar permisos del rol',
              message: `Vas a guardar los cambios de permisos para el rol "${roleLabel}".`,
              confirmText: 'Guardar cambios',
              cancelText: 'Cancelar'
            });
            if (!modal?.confirmed) return;
            try {
              await deps.setRolePermissions?.(selectedRole, base);
              await deps.addAuditLog?.({
                targetType: 'role',
                targetId: selectedRole,
                action: 'update_role_matrix',
                before: original,
                after: base
              });
              showInfoModal('Permisos actualizados', [
                `Los permisos del rol "${roleLabel}" se guardaron correctamente.`
              ]);
            } catch (e) {
              showInfoModal('No fue posible guardar', [
                String(e?.message || e || 'Error desconocido.')
              ]);
            }
          }
        },
        ['Guardar cambios del rol']
      )
    ]);

    panel.replaceChildren(el('label', { className: 'label' }, ['Selecciona un rol']), roleSel, ...[warnSA, groups, actions].filter(Boolean));
    return panel;
  }

  function permissionSection(sectionDef, index, base, disabled) {
    const items = (sectionDef.items || []).map(normalizePermissionPair);
    const activeCount = countActive(items, base);
    const totalCount = countTotal(items);
    return el('section', { className: 'permissions-center__module', 'data-permission-section-index': String(index) }, [
      el('div', { className: 'permissions-center__module-head' }, [
        el('div', {}, [
          el('h3', { className: 'permissions-center__module-title' }, [sectionDef.title]),
          el('p', { className: 'permissions-center__module-description' }, [sectionDef.description || ''])
        ]),
        el('span', { className: 'badge permissions-center__module-count' }, [`${activeCount}/${totalCount}`])
      ]),
      el(
        'div',
        { className: 'permission-pairs' },
        items.map((item) => permissionPair(item, base, (key, ch) => {
          base[key] = ch;
          syncPermissionCheckboxes(key, ch);
          if (key === item.action && ch && base[item.view] !== true) {
            base[item.view] = true;
            syncPermissionCheckboxes(item.view, true);
          }
          if (key === item.view && !ch) {
            Object.entries(PERMISSION_ACTION_VIEW_MAP).forEach(([action, view]) => {
              if (view === key) { base[action] = false; syncPermissionCheckboxes(action, false); }
            });
          }
          syncPermissionSectionCounts(base);
        }, disabled))
      )
    ]);
  }

  function normalizePermissionPair(item) {
    return {
      label: item.label || 'Permiso',
      view: item.view,
      action: item.action || null,
      viewLabel: item.viewLabel || 'Consulta',
      actionLabel: item.actionLabel || 'Accion',
      note: item.note || ''
    };
  }

  function countActive(items, base) {
    return items.reduce((acc, item) => acc + (base[item.view] === true ? 1 : 0) + (item.action && base[item.action] === true ? 1 : 0), 0);
  }

  function countTotal(items) {
    return items.reduce((acc, item) => acc + (item.action ? 2 : 1), 0);
  }

  function syncPermissionCheckboxes(key, checked) {
    ui.querySelectorAll(`input[data-perm-key="${key}"]`).forEach((input) => {
      input.checked = checked;
    });
  }

  function syncPermissionSectionCounts(base) {
    ui.querySelectorAll('[data-permission-section-index]').forEach((node) => {
      const index = Number(node.getAttribute('data-permission-section-index'));
      const sectionDef = PERMISSION_SECTIONS[index];
      if (!sectionDef) return;
      const items = (sectionDef.items || []).map(normalizePermissionPair);
      const activeCount = countActive(items, base);
      const count = node.querySelector('.permissions-center__module-count');
      if (count) count.textContent = `${activeCount}/${countTotal(items)}`;
    });
  }

  function permissionPair(item, base, onChange, disabled) {
    return el('article', { className: 'permission-pair' }, [
      el('div', { className: 'permission-pair__title' }, [item.label]),
      el('div', { className: 'permission-pair__checks' }, [
        permCheckbox({ key: item.view, label: item.viewLabel }, base[item.view] === true, (checked) => onChange(item.view, checked), disabled),
        item.action
          ? permCheckbox({ key: item.action, label: item.actionLabel }, base[item.action] === true, (checked) => onChange(item.action, checked), disabled)
          : el('span', { className: 'text-muted' }, ['Sin acciones'])
      ]),
      ...(item.note ? [el('p', { className: 'text-muted permission-pair__note' }, [item.note])] : [])
    ]);
  }

  function permCheckbox(item, val, onChange, disabled) {
    const key = item.key;
    const id = `perm_${key}_${Math.random().toString(36).slice(2, 6)}`;
    const label = item.label || key;
    const w = el('label', { className: 'perm-item', title: disabled ? 'Solo lectura' : '' }, [
      el('input', { type: 'checkbox', id, checked: !!val, disabled: !!disabled, 'data-perm-key': key }),
      el('span', {}, [label])
    ]);
    if (!disabled) {
      w.querySelector('input').addEventListener('change', (e) => onChange(e.target.checked));
    }
    return w;
  }

  mount.replaceChildren(ui);
  return () => {};
};
