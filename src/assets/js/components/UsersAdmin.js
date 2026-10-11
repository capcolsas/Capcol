import { el, qs, infoIcon, moreIcon } from '../utils/dom.js';
import { PERMS, can, isSuperAdmin } from '../permissions.js';
import { getState } from '../state.js';
import { ALL_ROLES, ROLE_LABELS } from '../roles.js';
import { showActionModal } from '../utils/actionModal.js';
import { showInfoModal } from '../utils/infoModal.js';
import { createTablePagination } from '../utils/pagination.js';

const STATUS = ['activo', 'inactivo', 'eliminado'];

export const UsersAdmin = (mount, deps = {}) => {
  if (!can(PERMS.VIEW_USERS)) {
    return mount.replaceChildren(
      el('section', { className: 'main-card' }, [
        el('h2', {}, ['Usuarios']),
        el('p', {}, ['No tienes permiso para consultar usuarios.'])
      ])
    );
  }
  const canEditUsers = can(PERMS.EDIT_USERS);

  const ui = el('section', { className: 'main-card' }, [
    el('h2', {}, ['Gestion de usuarios']),
    el('div', { className: 'form-row' }, [
      el('div', {}, [el('label', { className: 'label' }, ['Buscar']), el('input', { id: 'search', className: 'input', placeholder: 'Correo, nombre o documento...' })]),
      el('div', {}, [el('label', { className: 'label' }, ['Rol']), el('select', { id: 'roleFilter', className: 'select' }, [])]),
      el('div', {}, [el('label', { className: 'label' }, ['Estado']), el('select', { id: 'statusFilter', className: 'select' }, [])]),
      el('span', { className: 'right text-muted' }, [canEditUsers ? 'Administra rol y estado de acceso.' : 'Modo consulta: sin permisos de edicion.'])
    ]),
    el('div', { className: 'users-results mt-2' }, [
      el('div', { className: 'table-wrap users-table-view' }, [
        el('table', { className: 'table', id: 'tbl' }, [
          el('thead', {}, [el('tr', {}, [el('th', {}, ['Usuario']), el('th', {}, ['Correo']), el('th', {}, ['Rol']), el('th', {}, ['Estado']), el('th', {}, ['Contratos']), el('th', {}, ['Acciones'])])]),
          el('tbody', {})
        ])
      ]),
      el('div', { id: 'userCards', className: 'users-card-list' }, [])
    ]),
    el('p', { id: 'msg', className: 'mt-2 text-muted' }, [' '])
  ]);

  const roleFilter = qs('#roleFilter', ui);
  let accessProfiles = [];
  const roleFilterOptions = () => [
    el('option', { value: '' }, ['Todos']),
    ...ALL_ROLES.map((r) => el('option', { value: r }, [roleLabel(r)])),
    ...accessProfiles.map((profile) => el('option', { value: `profile:${profile.id}` }, [`Perfil: ${profile.nombre}`]))
  ];
  roleFilter.append(...roleFilterOptions());
  const statusFilter = qs('#statusFilter', ui);
  statusFilter.append(el('option', { value: '' }, ['Todos']), ...STATUS.map((s) => el('option', { value: s }, [s])));

  const msg = qs('#msg', ui);
  const tbody = qs('tbody', ui);
  const cards = qs('#userCards', ui);
  const paginator = createTablePagination(ui, { id: 'users', after: '.users-results', onChange: renderRows });
  let data = [];
  let contractList = [];
  let contractAccessRows = [];

  function statusOf(u) {
    const raw = String(u?.estado || 'activo').trim().toLowerCase();
    if (raw === 'inactivo' || raw === 'eliminado') return raw;
    return 'activo';
  }

  function statusBadge(st) {
    const cls = st === 'activo' ? 'badge--ok' : 'badge--off';
    return el('span', { className: `badge ${cls}` }, [st]);
  }

  function formatDate(ts) {
    try {
      const d = ts ? new Date(ts) : null;
      return d ? new Date(d).toLocaleString() : '-';
    } catch {
      return '-';
    }
  }

  function infoData(u) {
    return [
      `UID: ${u.uid || '-'}`,
      `Documento: ${u.documento || '-'}`,
      `Estado: ${statusOf(u)}`,
      `Supervisor elegible: ${u.supervisorEligible === true ? 'Si' : 'No'}`,
      `Zona perfil: ${u.zonaCodigo || '-'}`,
      `Zonas permitidas: ${(u.zonasPermitidas || []).join(', ') || '-'}`,
      `Contratos permitidos: ${contractSummaryForUser(u.uid)}`,
      `Creado por: ${u.createdByEmail || u.createdByUid || '-'}`,
      `Creado el: ${formatDate(u.createdAt)}`,
      `Ultimo cambio por: ${u.lastModifiedByEmail || u.lastModifiedByUid || '-'}`,
      `Ultimo cambio: ${formatDate(u.lastModifiedAt)}`,
      `Eliminado por: ${u.deletedByEmail || u.deletedByUid || '-'}`,
      `Eliminado el: ${formatDate(u.deletedAt)}`
    ];
  }

  function setMsg(text) {
    msg.textContent = text || ' ';
  }

  function roleLabel(role) {
    return ROLE_LABELS[role] || role || '-';
  }

  function normalizeCode(value) {
    return String(value || '').trim();
  }

  function activeContractRows() {
    return (contractList || [])
      .filter((contract) => String(contract?.estado || 'activo').trim().toLowerCase() === 'activo')
      .sort((a, b) => String(a.nombre || a.codigo || '').localeCompare(String(b.nombre || b.codigo || '')));
  }

  function contractByCode(code) {
    const clean = normalizeCode(code);
    return (contractList || []).find((contract) => normalizeCode(contract.codigo) === clean) || null;
  }

  function contractCodesForUser(uid) {
    const targetUid = normalizeCode(uid);
    if (!targetUid) return [];
    const profile = (data || []).find((user) => normalizeCode(user.uid) === targetUid) || {};
    const profileCodes = [
      profile.contratoCodigo,
      ...(Array.isArray(profile.contratosPermitidos) ? profile.contratosPermitidos : [])
    ];
    const accessCodes = (contractAccessRows || [])
      .filter((row) => normalizeCode(row.userId) === targetUid)
      .filter((row) => String(row.estado || 'activo').trim().toLowerCase() === 'activo')
      .map((row) => normalizeCode(row.contratoCodigo))
      .filter(Boolean);
    return [...new Set([...profileCodes, ...accessCodes].map(normalizeCode).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
  }

  function contractLabel(code) {
    const contract = contractByCode(code);
    const clean = normalizeCode(code);
    if (!contract) return clean || '-';
    const name = String(contract.nombre || '').trim();
    return name && clean ? `${name} (${clean})` : name || clean || '-';
  }

  function contractSummaryForUser(uid) {
    const labels = contractCodesForUser(uid).map(contractLabel).filter(Boolean);
    if (!labels.length) return '-';
    if (labels.length <= 2) return labels.join(', ');
    return `${labels.length} contratos: ${labels.slice(0, 2).join(', ')}...`;
  }

  // Active contracts plus inactive ones already assigned, so saving does not silently drop them.
  // contractList only holds the contracts the current admin can see.
  function contractOptions(assignedCodes = []) {
    const assigned = new Set(assignedCodes.map(normalizeCode));
    const inactiveAssigned = (contractList || [])
      .filter((contract) => String(contract?.estado || 'activo').trim().toLowerCase() !== 'activo')
      .filter((contract) => assigned.has(normalizeCode(contract.codigo)));
    return [...activeContractRows(), ...inactiveAssigned].map((contract) => {
      const code = normalizeCode(contract.codigo);
      const name = String(contract.nombre || '').trim();
      const label = name && code ? `${name} (${code})` : name || code;
      const inactive = String(contract?.estado || 'activo').trim().toLowerCase() !== 'activo';
      return { value: code, label: inactive ? `${label} - inactivo` : label };
    }).filter((opt) => opt.value);
  }

  // A user's access is a system role or a custom profile ("profile:<id>", built on a base role).
  function accessValue(user) {
    return user.accessProfileId ? `profile:${user.accessProfileId}` : (user.role || 'empleado');
  }

  function accessProfileById(id) {
    return accessProfiles.find((profile) => String(profile.id) === String(id)) || null;
  }

  function accessLabel(value) {
    if (String(value || '').startsWith('profile:')) {
      const profile = accessProfileById(value.slice('profile:'.length));
      return profile ? `Perfil: ${profile.nombre}` : 'Perfil personalizado';
    }
    return roleLabel(value);
  }

  // Only a superadmin grants SuperAdmin; inactive profiles stay listed only for whoever holds them.
  function accessOptions(currentValue = '') {
    const roles = ALL_ROLES
      .filter((role) => role !== 'superadmin' || isSuperAdmin() || currentValue === 'superadmin')
      .map((role) => ({ value: role, label: roleLabel(role) }));
    const profiles = [...accessProfiles]
      .filter((profile) => profile.estado === 'activo' || `profile:${profile.id}` === currentValue)
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
      .map((profile) => ({ value: `profile:${profile.id}`, label: `Perfil: ${profile.nombre} (${roleLabel(profile.baseRole)})` }));
    return [...roles, ...profiles];
  }

  async function handleRoleChange(user, sel) {
    const prev = accessValue(user);
    const next = String(sel.value || '').trim();
    if (!next || next === prev) return;
    try {
      await updateUserAccess(user, prev, next);
    } catch {
      sel.value = prev;
    }
  }

  async function changeRole(user) {
    const prev = accessValue(user);
    const modal = await showActionModal({
      title: 'Cambiar rol o perfil',
      message: `Usuario: ${user.email || user.uid}`,
      confirmText: 'Guardar',
      fields: [{
        id: 'role',
        label: 'Rol o perfil',
        type: 'select',
        required: true,
        value: prev,
        options: accessOptions(prev)
      }]
    });
    if (!modal?.confirmed) return;
    const next = String(modal.values.role || '').trim();
    if (!next || next === prev) return;
    try {
      await updateUserAccess(user, prev, next);
    } catch {}
  }

  async function updateUserAccess(user, prev, next) {
    try {
      if (next.startsWith('profile:')) {
        const profile = accessProfileById(next.slice('profile:'.length));
        if (!profile) throw new Error('El perfil seleccionado ya no existe.');
        await deps.setUserAccessProfile?.(user.uid, profile);
      } else {
        await deps.setUserRole?.(user.uid, next);
      }
      await deps.addAuditLog?.({
        targetType: 'user',
        targetId: user.uid,
        action: 'update_user_role',
        before: { role: user.role || 'empleado', accessProfileId: user.accessProfileId || null },
        after: next.startsWith('profile:') ? { accessProfileId: next.slice('profile:'.length) } : { role: next, accessProfileId: null }
      });
      setMsg(`Acceso actualizado para ${user.email || user.uid}: ${accessLabel(next)}`);
    } catch (e) {
      setMsg(`Error al actualizar rol o perfil: ${e?.message || e}`);
      throw e;
    }
  }

  async function changeStatus(user, target) {
    const currentStatus = statusOf(user);
    const title = target === 'inactivo' ? 'Desactivar usuario' : 'Activar usuario';
    const modal = await showActionModal({
      title,
      message: `Usuario: ${user.email || user.uid}`,
      confirmText: target === 'inactivo' ? 'Desactivar' : 'Activar',
      fields: [{ id: 'detail', label: 'Detalle', type: 'textarea', required: true, placeholder: 'Escribe el motivo de esta accion' }]
    });
    if (!modal.confirmed) return;
    await deps.setUserStatus?.(user.uid, target);
    await deps.addAuditLog?.({
      targetType: 'user',
      targetId: user.uid,
      action: target === 'inactivo' ? 'deactivate_user' : 'activate_user',
      before: { estado: currentStatus },
      after: { estado: target },
      note: modal.values.detail || null
    });
    setMsg(`Usuario ${target === 'inactivo' ? 'desactivado' : 'activado'}: ${user.email || user.uid}`);
  }

  function actionsCell(u) {
    const box = el('div', { className: 'row-actions' }, []);
    const btnMore = el('button', { className: 'btn btn--icon', type: 'button', title: 'Mas opciones', 'aria-label': 'Mas opciones' }, [moreIcon()]);
    btnMore.addEventListener('click', () => openMoreOptionsModal(u));
    box.append(btnMore);

    const btnInfo = el('button', { className: 'btn btn--icon', type: 'button', title: 'Ver informacion', 'aria-label': 'Ver informacion' }, [infoIcon()]);
    btnInfo.addEventListener('click', () => showInfoModal('Informacion del usuario', infoData(u)));
    box.append(btnInfo);

    return box;
  }

  async function openMoreOptionsModal(u) {
    const currentUid = getState()?.user?.uid || '';
    const isSelf = String(currentUid || '') === String(u.uid || '');
    const st = statusOf(u);
    const isSupervisor = String(u.role || '').trim().toLowerCase() === 'supervisor';
    const options = [{ value: '', label: 'Seleccione...' }];
    if (canEditUsers) {
      options.push({ value: 'change_role', label: 'Cambiar rol o perfil' });
    }
    if (st !== 'eliminado' && canEditUsers && isSupervisor) {
      options.push({ value: 'sync_supervisor', label: 'Sincronizar acceso supervisor' });
    }
    // Superadmin always works on every contract: there is nothing to assign.
    if (st !== 'eliminado' && canEditUsers && String(u.role || '').trim().toLowerCase() !== 'superadmin') {
      options.push({ value: 'assign_contracts', label: 'Asignar contratos' });
    }
    if (st !== 'eliminado' && canEditUsers && !isSelf) {
      options.push({ value: 'toggle_status', label: st === 'activo' ? 'Desactivar usuario' : 'Activar usuario' });
    } else if (st === 'eliminado' && canEditUsers && !isSelf) {
      options.push({ value: 'toggle_status', label: 'Activar usuario' });
    }
    if (options.length === 1) {
      showInfoModal('Mas opciones', ['No hay acciones disponibles para este usuario.']);
      return;
    }

    const modal = await showActionModal({
      title: 'Mas opciones',
      message: `Usuario: ${u.email || u.uid || '-'}`,
      confirmText: 'Continuar',
      fields: [{
        id: 'action',
        label: 'Accion',
        type: 'select',
        required: true,
        options
      }]
    });
    if (!modal?.confirmed) return;
    if (modal.values.action === 'change_role') return changeRole(u);
    if (modal.values.action === 'sync_supervisor') return syncSupervisorAccess(u);
    if (modal.values.action === 'assign_contracts') return assignContracts(u);
    if (modal.values.action === 'toggle_status') return toggleUserStatus(u, st);
  }

  async function assignContracts(u) {
    const options = contractOptions(contractCodesForUser(u.uid));
    if (!options.length) {
      showInfoModal('Asignar contratos', ['No hay contratos activos disponibles para asignar.']);
      return;
    }
    // Contracts outside the current admin's scope are neither shown nor touched when saving.
    const visibleCodes = new Set(options.map((opt) => opt.value));
    const currentCodes = contractCodesForUser(u.uid).filter((code) => visibleCodes.has(code));
    const modal = await showActionModal({
      title: 'Asignar contratos',
      message: `Usuario: ${u.email || u.uid || '-'}`,
      confirmText: 'Guardar contratos',
      fields: [{
        id: 'contracts',
        label: 'Contratos permitidos',
        type: 'checkboxes',
        value: currentCodes,
        options
      }]
    });
    if (!modal?.confirmed) return;
    const nextCodes = [...new Set((modal.values.contracts || []).map(normalizeCode).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    try {
      await deps.setUserContractAccess?.(u.uid, nextCodes);
      await deps.addAuditLog?.({
        targetType: 'user',
        targetId: u.uid,
        action: 'update_user_contract_access',
        before: { contratoCodigos: currentCodes },
        after: { contratoCodigos: nextCodes }
      });
      setMsg(`Contratos actualizados para ${u.email || u.uid}: ${nextCodes.length}`);
    } catch (e) {
      setMsg(`Error al actualizar contratos: ${e?.message || e}`);
    }
  }

  async function syncSupervisorAccess(u) {
    try {
      await deps.syncSupervisorAccessForUser?.(u.uid);
      await deps.addAuditLog?.({
        targetType: 'user',
        targetId: u.uid,
        action: 'sync_supervisor_access',
        before: {
          supervisorEligible: u.supervisorEligible === true,
          zonaCodigo: u.zonaCodigo || null,
          zonasPermitidas: u.zonasPermitidas || []
        }
      });
      setMsg(`Acceso supervisor sincronizado: ${u.email || u.uid}`);
    } catch (e) {
      setMsg(`Error al sincronizar supervisor: ${e?.message || e}`);
    }
  }

  async function toggleUserStatus(u, st) {
    try {
      await changeStatus(u, st === 'activo' ? 'inactivo' : 'activo');
    } catch (e) {
      setMsg(`Error al actualizar estado: ${e?.message || e}`);
    }
  }

  function roleSelect(u) {
    const current = accessValue(u);
    const sel = el(
      'select',
      { className: 'select', disabled: !canEditUsers },
      accessOptions(current).map((opt) => el('option', { value: opt.value, selected: current === opt.value }, [opt.label]))
    );
    if (canEditUsers) sel.addEventListener('change', () => handleRoleChange(u, sel));
    return sel;
  }

  function renderRow(u) {
    const st = statusOf(u);
    const tr = el('tr', { 'data-id': u.uid || '' });
    tr.append(
      el('td', {}, [u.displayName || '-']),
      el('td', {}, [u.email || '-']),
      el('td', {}, [roleSelect(u)]),
      el('td', {}, [statusBadge(st)]),
      el('td', {}, [contractSummaryForUser(u.uid)]),
      el('td', {}, [actionsCell(u)])
    );
    return tr;
  }

  function renderUserCard(u) {
    const st = statusOf(u);
    const lastChange = formatDate(u.lastModifiedAt || u.createdAt);
    return el('article', { className: 'user-card' }, [
      el('div', { className: 'user-card__header' }, [
        el('div', { className: 'user-card__identity' }, [
          el('strong', { className: 'user-card__name' }, [u.displayName || '-']),
          el('span', { className: 'user-card__email' }, [u.email || '-'])
        ]),
        statusBadge(st)
      ]),
      el('dl', { className: 'user-card__meta' }, [
        metaItem('Rol', accessLabel(accessValue(u))),
        metaItem('Documento', u.documento || '-'),
        metaItem('Contratos', contractSummaryForUser(u.uid)),
        metaItem('Ultimo cambio', lastChange)
      ]),
      el('div', { className: 'user-card__actions' }, [actionsCell(u)])
    ]);
  }

  function metaItem(label, value) {
    return el('div', { className: 'user-card__meta-item' }, [
      el('dt', {}, [label]),
      el('dd', {}, [value || '-'])
    ]);
  }

  function renderRows() {
    const term = String(qs('#search', ui).value || '').trim().toLowerCase();
    const rf = String(qs('#roleFilter', ui).value || '').trim();
    const sf = String(qs('#statusFilter', ui).value || '').trim();
    const rows = (data || [])
      .filter((u) => {
        const text = `${u.email || ''} ${u.displayName || ''} ${u.documento || ''} ${contractSummaryForUser(u.uid)}`.toLowerCase();
        return (!term || text.includes(term)) && (!rf || (u.role || 'empleado') === rf || accessValue(u) === rf) && (!sf || statusOf(u) === sf);
      })
      .sort((a, b) => String(a.email || '').localeCompare(String(b.email || '')));
    const pageRows = paginator.slice(rows);

    tbody.replaceChildren(...pageRows.map((u) => renderRow(u)));
    cards.replaceChildren(...(pageRows.length
      ? pageRows.map((u) => renderUserCard(u))
      : [el('p', { className: 'text-muted user-card__empty' }, ['Sin usuarios para mostrar.'])]));
  }

  qs('#search', ui).addEventListener('input', () => { paginator.reset(); renderRows(); });
  qs('#roleFilter', ui).addEventListener('change', () => { paginator.reset(); renderRows(); });
  qs('#statusFilter', ui).addEventListener('change', () => { paginator.reset(); renderRows(); });

  const unUsers = deps.streamUsers?.((users) => {
    data = users || [];
    renderRows();
  });
  const unContracts = deps.streamContracts?.((contracts) => {
    contractList = contracts || [];
    renderRows();
  });
  const unContractAccess = deps.streamProfileContractAccess?.((rows) => {
    contractAccessRows = rows || [];
    renderRows();
  });
  const unAccessProfiles = deps.streamAccessProfiles?.((rows) => {
    accessProfiles = rows || [];
    const keep = roleFilter.value;
    roleFilter.replaceChildren(...roleFilterOptions());
    roleFilter.value = keep;
    renderRows();
  });

  mount.replaceChildren(ui);
  return () => {
    unUsers?.();
    unContracts?.();
    unContractAccess?.();
    unAccessProfiles?.();
  };
};
