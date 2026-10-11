import { activateIcon, deactivateIcon, editIcon, el, lucideInlineIcon, qs } from '../utils/dom.js';
import { showActionModal } from '../utils/actionModal.js';
import { showInfoModal } from '../utils/infoModal.js';
import { can, isSuperAdmin, resolvePermissions } from '../permissions.js';
import { ALL_ROLES, PERMS, ROLE_LABELS, ROLES } from '../roles.js';
import { getState, setState, subscribe } from '../state.js';
import { navigate } from '../router.js';

// Roles a custom profile can be built on: they keep that role's contract and zone behaviour.
export const PROFILE_BASE_ROLES = [ROLES.ADMIN, ROLES.EDITOR, ROLES.CONSULTOR, ROLES.SUPERVISOR];

const BASE_ROLE_HINTS = {
  [ROLES.ADMIN]: 'Puede crear y editar datos de sus contratos.',
  [ROLES.EDITOR]: 'Opera turnos y registros de sus contratos.',
  [ROLES.CONSULTOR]: 'Consulta y reporta sus contratos.',
  [ROLES.SUPERVISOR]: 'Trabaja solo en sus zonas, dentro de sus contratos.'
};

const SYSTEM_ROLE_HINTS = {
  ...BASE_ROLE_HINTS,
  [ROLES.SUPERADMIN]: 'Acceso total a todos los contratos.',
  [ROLES.TABLET_QR]: 'Solo el lector QR de las tablets.',
  [ROLES.EMPLEADO]: 'Portal del empleado.'
};

// Perfiles manages the profiles themselves (name, base role, state, users). Their modules are
// granted in the Centro de Permisos, the only place where permissions are edited.
export const AccessProfilesAdmin = (mount, deps = {}) => {
  if (!isSuperAdmin() && !can(PERMS.VIEW_PERMISSIONS)) {
    mount.replaceChildren(el('section', { className: 'main-card' }, [
      el('h2', {}, ['Perfiles']),
      el('p', {}, ['No tienes permiso para consultar perfiles.'])
    ]));
    return () => {};
  }
  // Like the role matrix, only a superadmin defines profiles (enforced by RLS).
  const canManage = isSuperAdmin();

  let profiles = [];
  let users = [];
  let selectedId = '';

  const ui = el('section', { className: 'main-card' }, [
    el('h2', {}, ['Perfiles']),
    el('div', { className: 'form-row' }, [
      canManage
        ? el('button', { className: 'btn btn--primary right', type: 'button', id: 'btnNewProfile' }, ['Nuevo perfil'])
        : el('span', { className: 'right text-muted' }, ['Modo consulta: solo un SuperAdmin crea o edita perfiles.'])
    ]),
    el('div', { className: 'table-wrap mt-2' }, [
      el('table', { className: 'table' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', {}, ['Perfil']),
          el('th', {}, ['Rol base']),
          el('th', {}, ['Modulos']),
          el('th', {}, ['Usuarios']),
          el('th', {}, ['Estado']),
          el('th', {}, ['Acciones'])
        ])]),
        el('tbody', { id: 'profilesBody' })
      ])
    ]),
    el('div', { id: 'profileEditor', className: 'mt-2' }),
    el('p', { id: 'msg', className: 'mt-2 text-muted' }, [' '])
  ]);

  const body = qs('#profilesBody', ui);
  const editor = qs('#profileEditor', ui);
  const msg = qs('#msg', ui);
  const setMsg = (text) => { msg.textContent = text || ' '; };

  function roleLabel(role) {
    return ROLE_LABELS[role] || role || '-';
  }

  // The built-in roles are listed as profiles too; their modules live in the role matrix.
  function systemProfiles() {
    const matrix = getState().roleMatrix || {};
    return ALL_ROLES.map((role) => ({
      id: `role:${role}`,
      system: true,
      nombre: roleLabel(role),
      descripcion: SYSTEM_ROLE_HINTS[role] || '',
      baseRole: role,
      permissions: resolvePermissions(role, matrix[role] || null),
      estado: 'activo'
    }));
  }

  function allProfiles() {
    return [...systemProfiles(), ...[...profiles].sort((a, b) => a.nombre.localeCompare(b.nombre))];
  }

  // A system role counts the users that hold it without a custom profile on top.
  function usersOf(profile) {
    if (profile.system) return users.filter((u) => !u.accessProfileId && (u.role || 'empleado') === profile.baseRole);
    return users.filter((u) => String(u.accessProfileId || '') === String(profile.id));
  }

  // Modules the profile's users actually get (a custom profile layers over its base role).
  function activeModules(profile) {
    const permissions = profile.system
      ? profile.permissions
      : resolvePermissions(profile.baseRole, getState().roleMatrix?.[profile.baseRole] || null, {}, profile.permissions);
    return Object.entries(permissions).filter(([key, value]) => value === true && key.startsWith('view')).length;
  }

  function statusBadge(estado) {
    return el('span', { className: `badge ${estado === 'activo' ? 'badge--ok' : 'badge--off'}` }, [estado]);
  }

  function openPermissions(profile) {
    setState({
      permissionsTarget: profile.system ? profile.id : `profile:${profile.id}`,
      sidebarContext: 'settings'
    });
    navigate('/permissions');
  }

  function renderRows() {
    body.replaceChildren(...allProfiles().map((profile) => {
      const actions = el('div', { className: 'row-actions' }, []);
      if (canManage && !profile.system) {
        const btnEdit = el('button', { className: 'btn btn--icon', type: 'button', title: 'Editar perfil', 'aria-label': 'Editar perfil' }, [editIcon()]);
        btnEdit.addEventListener('click', () => openEditor(profile.id));
        actions.append(btnEdit);
      }
      const btnPerms = el('button', {
        className: 'btn btn--icon',
        type: 'button',
        title: 'Permisos: asignar modulos en el Centro de Permisos',
        'aria-label': 'Permisos del perfil'
      }, [lucideInlineIcon('shield-check', 'PE')]);
      btnPerms.addEventListener('click', () => openPermissions(profile));
      actions.append(btnPerms);
      if (canManage && !profile.system) {
        const target = profile.estado === 'activo' ? 'inactivo' : 'activo';
        const label = target === 'inactivo' ? 'Desactivar perfil' : 'Activar perfil';
        const btnStatus = el('button', {
          className: `btn btn--icon${target === 'inactivo' ? ' btn--danger' : ''}`,
          type: 'button',
          title: label,
          'aria-label': label
        }, [target === 'inactivo' ? deactivateIcon() : activateIcon()]);
        btnStatus.addEventListener('click', () => changeStatus(profile, target));
        actions.append(btnStatus);
      }
      return el('tr', { className: profile.id === selectedId ? 'is-selected' : '' }, [
        el('td', {}, [
          el('strong', {}, [profile.nombre]),
          profile.system ? el('span', { className: 'badge', style: 'margin-left:.4rem' }, ['Sistema']) : '',
          profile.descripcion ? el('div', { className: 'text-muted' }, [profile.descripcion]) : ''
        ]),
        el('td', {}, [profile.system ? '-' : roleLabel(profile.baseRole)]),
        el('td', {}, [String(activeModules(profile))]),
        el('td', {}, [String(usersOf(profile).length)]),
        el('td', {}, [statusBadge(profile.estado)]),
        el('td', {}, [actions])
      ]);
    }));
  }

  function closeEditor() {
    selectedId = '';
    editor.replaceChildren();
    renderRows();
  }

  function openEditor(id) {
    const profile = profiles.find((row) => row.id === id);
    if (!profile || !canManage) return;
    selectedId = id;

    const name = el('input', { className: 'input', value: profile.nombre });
    const description = el('input', { className: 'input', value: profile.descripcion || '', placeholder: 'Para que se usa este perfil' });
    const hasUsers = usersOf(profile).length > 0;
    const baseRole = el('select', { className: 'select', disabled: hasUsers },
      PROFILE_BASE_ROLES.map((role) => el('option', { value: role, selected: role === profile.baseRole }, [roleLabel(role)])));
    const baseHint = el('p', { className: 'text-muted' }, [
      hasUsers
        ? `${BASE_ROLE_HINTS[profile.baseRole] || ''} El rol base no se puede cambiar mientras el perfil tenga usuarios.`
        : BASE_ROLE_HINTS[profile.baseRole] || ''
    ]);
    baseRole.addEventListener('change', () => { baseHint.textContent = BASE_ROLE_HINTS[baseRole.value] || ''; });

    const btnSave = el('button', { className: 'btn btn--primary', type: 'button' }, ['Guardar perfil']);
    const btnClose = el('button', { className: 'btn', type: 'button' }, ['Cerrar']);
    btnClose.addEventListener('click', closeEditor);
    btnSave.addEventListener('click', async () => {
      const next = { nombre: name.value, descripcion: description.value, baseRole: baseRole.value };
      try {
        await deps.updateAccessProfile?.(profile.id, next);
        await deps.addAuditLog?.({
          targetType: 'access_profile',
          targetId: profile.id,
          action: 'update_access_profile',
          before: { nombre: profile.nombre, descripcion: profile.descripcion || '', baseRole: profile.baseRole },
          after: next,
          contratoCodigo: null
        });
        setMsg(`Perfil guardado: ${next.nombre}`);
        closeEditor();
      } catch (e) {
        const text = String(e?.message || e || '');
        showInfoModal('No fue posible guardar', [
          /duplicate|unique/i.test(text) ? 'Ya existe un perfil con ese nombre.' : text || 'Error desconocido.'
        ]);
      }
    });

    editor.replaceChildren(el('section', { className: 'main-card' }, [
      el('h3', {}, [`Editar perfil: ${profile.nombre}`]),
      el('div', { className: 'form-row' }, [
        el('div', {}, [el('label', { className: 'label' }, ['Nombre']), name]),
        el('div', {}, [el('label', { className: 'label' }, ['Descripcion']), description]),
        el('div', {}, [el('label', { className: 'label' }, ['Rol base']), baseRole])
      ]),
      baseHint,
      el('div', { className: 'mt-2 row-actions' }, [btnSave, btnClose])
    ]));
    renderRows();
  }

  async function createProfile() {
    const copyOptions = [
      { value: '', label: 'Permisos por defecto del rol base' },
      ...allProfiles()
        .filter((profile) => profile.baseRole !== ROLES.SUPERADMIN)
        .map((profile) => ({ value: profile.id, label: `Copiar de: ${profile.nombre}${profile.system ? ' (sistema)' : ''}` }))
    ];
    const modal = await showActionModal({
      title: 'Nuevo perfil',
      message: 'El rol base define el alcance: contratos asignados y, para supervisores, sus zonas. Despues ajustas sus modulos en el Centro de Permisos.',
      confirmText: 'Crear perfil',
      fields: [
        { id: 'nombre', label: 'Nombre', required: true, placeholder: 'Ej: Coordinador de turnos' },
        { id: 'descripcion', label: 'Descripcion', type: 'textarea', rows: 2 },
        {
          id: 'baseRole',
          label: 'Rol base',
          type: 'select',
          required: true,
          value: ROLES.CONSULTOR,
          options: PROFILE_BASE_ROLES.map((role) => ({ value: role, label: `${roleLabel(role)} - ${BASE_ROLE_HINTS[role]}` }))
        },
        { id: 'copyFrom', label: 'Permisos iniciales', type: 'select', options: copyOptions }
      ]
    });
    if (!modal?.confirmed) return;
    const { nombre, descripcion, baseRole, copyFrom } = modal.values;
    const source = allProfiles().find((profile) => profile.id === copyFrom);
    const permissions = resolvePermissions(baseRole, getState().roleMatrix?.[baseRole] || null, {}, source?.permissions || null);
    try {
      const created = await deps.createAccessProfile?.({ nombre, descripcion, baseRole, permissions });
      await deps.addAuditLog?.({
        targetType: 'access_profile',
        targetId: created?.id || null,
        action: 'create_access_profile',
        after: { nombre, baseRole, permissions },
        contratoCodigo: null
      });
      // Next step: grant its modules.
      if (created?.id) openPermissions(created);
      else setMsg(`Perfil creado: ${nombre}. Asigna sus modulos en el Centro de Permisos.`);
    } catch (e) {
      const text = String(e?.message || e || '');
      showInfoModal('No fue posible crear el perfil', [
        /duplicate|unique/i.test(text) ? 'Ya existe un perfil con ese nombre.' : text || 'Error desconocido.'
      ]);
    }
  }

  async function changeStatus(profile, target) {
    const assigned = usersOf(profile).length;
    const modal = await showActionModal({
      title: target === 'inactivo' ? 'Desactivar perfil' : 'Activar perfil',
      message: target === 'inactivo' && assigned
        ? `${assigned} usuario(s) tienen este perfil. Mientras este inactivo usaran los permisos de su rol base.`
        : `Perfil: ${profile.nombre}`,
      confirmText: target === 'inactivo' ? 'Desactivar' : 'Activar'
    });
    if (!modal?.confirmed) return;
    try {
      await deps.setAccessProfileStatus?.(profile.id, target);
      await deps.addAuditLog?.({
        targetType: 'access_profile',
        targetId: profile.id,
        action: target === 'inactivo' ? 'deactivate_access_profile' : 'activate_access_profile',
        before: { estado: profile.estado },
        after: { estado: target },
        contratoCodigo: null
      });
      setMsg(`Perfil ${target === 'inactivo' ? 'desactivado' : 'activado'}: ${profile.nombre}`);
    } catch (e) {
      showInfoModal('No fue posible actualizar el perfil', [String(e?.message || e || 'Error desconocido.')]);
    }
  }

  qs('#btnNewProfile', ui)?.addEventListener('click', createProfile);

  const unProfiles = deps.streamAccessProfiles?.((rows) => {
    profiles = rows || [];
    renderRows();
    if (selectedId && !profiles.some((row) => row.id === selectedId)) closeEditor();
  });
  const unUsers = deps.streamUsers?.((rows) => {
    users = rows || [];
    renderRows();
  });
  const unRoleMatrix = subscribe('roleMatrix', renderRows);

  renderRows();
  mount.replaceChildren(ui);
  return () => {
    unRoleMatrix?.();
    unProfiles?.();
    unUsers?.();
  };
};
