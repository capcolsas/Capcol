import { el } from '../utils/dom.js';
import { showActionModal } from '../utils/actionModal.js';
import { showInfoModal } from '../utils/infoModal.js';
import { can, isSuperAdmin, resolvePermissions } from '../permissions.js';
import { ALL_ROLES, ROLE_LABELS, ROLES, PERMS } from '../roles.js';
import { permissionMatrix } from './permissionMatrix.js';
import { getState, setState } from '../state.js';

// The one place where modules are granted: to the system profiles (role matrix) and to the custom
// profiles managed in Perfiles. A target is "role:<role>" or "profile:<id>".
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

  // Perfiles opens this screen on a given profile through permissionsTarget.
  let selected = String(getState().permissionsTarget || '').trim() || `role:${ROLES.ADMIN}`;
  if (getState().permissionsTarget) setState({ permissionsTarget: null });
  let accessProfiles = [];
  let profilesLoaded = typeof deps.streamAccessProfiles !== 'function';
  let current = null;

  const ui = el('section', { className: 'main-card' }, [
    el('h2', {}, ['Centro de Permisos']),
    el('p', { className: 'text-muted' }, [
      'Asigna los modulos y acciones de cada perfil. Los perfiles se crean y administran en Perfiles.'
    ])
  ]);
  let panel = el('div', {}, []);
  ui.append(panel);

  function roleLabel(role) {
    return ROLE_LABELS[role] || role || '-';
  }

  function profileById(id) {
    return accessProfiles.find((profile) => String(profile.id) === String(id)) || null;
  }

  function targetOptions() {
    const system = el('optgroup', { label: 'Perfiles del sistema' },
      ALL_ROLES.map((role) => el('option', { value: `role:${role}`, selected: selected === `role:${role}` }, [roleLabel(role)])));
    const custom = [...accessProfiles].sort((a, b) => a.nombre.localeCompare(b.nombre));
    if (!custom.length) return [system];
    return [system, el('optgroup', { label: 'Perfiles personalizados' }, custom.map((profile) => el('option', {
      value: `profile:${profile.id}`,
      selected: selected === `profile:${profile.id}`
    }, [`${profile.nombre}${profile.estado === 'activo' ? '' : ' (inactivo)'}`])))];
  }

  // Effective permissions of the target: a custom profile starts from its base role so keys it never
  // stored show the value its users actually get.
  function describeTarget() {
    const matrix = getState().roleMatrix || {};
    if (selected.startsWith('profile:')) {
      const profile = profileById(selected.slice('profile:'.length));
      if (!profile) return null;
      return {
        kind: 'profile',
        profile,
        label: profile.nombre,
        permissions: resolvePermissions(profile.baseRole, matrix[profile.baseRole] || null, {}, profile.permissions),
        note: `Perfil personalizado sobre ${roleLabel(profile.baseRole)}${profile.estado === 'activo' ? '' : '. Esta inactivo: sus usuarios usan los permisos del rol base'}.`
      };
    }
    const role = selected.slice('role:'.length);
    return {
      kind: 'role',
      role,
      label: roleLabel(role),
      permissions: resolvePermissions(role, matrix[role] || null),
      note: 'Perfil del sistema: aplica a todos sus usuarios sin perfil personalizado.'
    };
  }

  function isDirty() {
    return Boolean(current) && JSON.stringify(current.base) !== JSON.stringify(current.original);
  }

  function render() {
    const target = describeTarget();
    if (!target && !profilesLoaded) {
      const next = el('p', { className: 'text-muted' }, ['Cargando perfiles...']);
      panel.replaceWith(next);
      panel = next;
      return;
    }
    if (!target) selected = `role:${ROLES.ADMIN}`;
    const info = target || describeTarget();
    const base = JSON.parse(JSON.stringify(info.permissions));
    current = { info, base, original: JSON.parse(JSON.stringify(base)) };

    const targetSel = el('select', { className: 'select', style: 'max-width:320px' }, targetOptions());
    targetSel.addEventListener('change', () => {
      selected = targetSel.value;
      render();
    });

    const editingSuperAdmin = info.kind === 'role' && info.role === ROLES.SUPERADMIN;
    const readOnly = editingSuperAdmin || !canManagePermissions;
    const warn = editingSuperAdmin
      ? el('p', { className: 'warn mt-1' }, ['Edicion de SuperAdmin bloqueada (solo lectura).'])
      : !canManagePermissions
        ? el('p', { className: 'warn mt-1' }, ['Modo consulta: no tienes permiso para guardar cambios.'])
        : null;

    const btnSave = el('button', { className: 'btn btn--primary', type: 'button', disabled: readOnly }, ['Guardar permisos del perfil']);
    btnSave.addEventListener('click', () => save(readOnly));

    const next = el('div', {}, [
      el('label', { className: 'label' }, ['Selecciona un perfil']),
      targetSel,
      el('p', { className: 'text-muted mt-1' }, [info.note]),
      ...[warn].filter(Boolean),
      permissionMatrix(base, { readOnly }),
      el('div', { className: 'mt-2' }, [btnSave])
    ]);
    panel.replaceWith(next);
    panel = next;
  }

  async function save(readOnly) {
    if (readOnly || !current) return;
    const { info, base, original } = current;
    const modal = await showActionModal({
      title: 'Guardar permisos del perfil',
      message: `Vas a guardar los cambios de permisos para el perfil "${info.label}".`,
      confirmText: 'Guardar cambios',
      cancelText: 'Cancelar'
    });
    if (!modal?.confirmed) return;
    try {
      if (info.kind === 'profile') {
        await deps.updateAccessProfile?.(info.profile.id, { permissions: base });
        await deps.addAuditLog?.({
          targetType: 'access_profile',
          targetId: info.profile.id,
          action: 'update_access_profile_permissions',
          before: original,
          after: base,
          contratoCodigo: null
        });
      } else {
        await deps.setRolePermissions?.(info.role, base);
        await deps.addAuditLog?.({
          targetType: 'role',
          targetId: info.role,
          action: 'update_role_matrix',
          before: original,
          after: base,
          contratoCodigo: null
        });
      }
      current.original = JSON.parse(JSON.stringify(base));
      showInfoModal('Permisos actualizados', [`Los permisos del perfil "${info.label}" se guardaron correctamente.`]);
    } catch (e) {
      showInfoModal('No fue posible guardar', [String(e?.message || e || 'Error desconocido.')]);
    }
  }

  // New or renamed profiles refresh the screen, but never over unsaved checkbox changes.
  const unProfiles = deps.streamAccessProfiles?.((rows) => {
    accessProfiles = rows || [];
    profilesLoaded = true;
    if (!isDirty()) render();
  });

  render();
  mount.replaceChildren(ui);
  return () => {
    unProfiles?.();
  };
};
