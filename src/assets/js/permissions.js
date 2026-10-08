import { getState } from './state.js';
import { PERMISSION_ACTION_VIEW_MAP, ROLES, PERMS, permsForRole } from './roles.js';

// A newer key with no stored value of its own inherits the key it was split from.
export const LEGACY_FALLBACK_BY_NEW = {
  [PERMS.VIEW_INVENTORY]: PERMS.VIEW_CONTRACTS,
  [PERMS.MANAGE_INVENTORY]: PERMS.EDIT_CONTRACTS,
  [PERMS.DISPATCH_INVENTORY]: PERMS.EDIT_CONTRACTS,
  [PERMS.RECEIVE_INVENTORY]: PERMS.EDIT_CONTRACTS,
  [PERMS.VIEW_PERMISSIONS]: PERMS.MANAGE_PERMISSIONS,
  [PERMS.VIEW_AUDIT]: PERMS.MANAGE_PERMISSIONS,
  [PERMS.MANAGE_AUDIT]: PERMS.MANAGE_PERMISSIONS,
  [PERMS.VIEW_USERS]: 'manageUsers',
  [PERMS.EDIT_USERS]: 'manageUsers',
  [PERMS.VIEW_CONTRACTS]: PERMS.VIEW_DEPENDENCIES,
  [PERMS.EDIT_CONTRACTS]: PERMS.EDIT_DEPENDENCIES,
  [PERMS.VIEW_ZONES]: 'manageZones',
  [PERMS.EDIT_ZONES]: 'manageZones',
  [PERMS.VIEW_DEPENDENCIES]: 'manageDependencies',
  [PERMS.EDIT_DEPENDENCIES]: 'manageDependencies',
  [PERMS.VIEW_SEDES]: 'manageSedes',
  [PERMS.EDIT_SEDES]: 'manageSedes',
  [PERMS.VIEW_EMPLOYEES]: 'manageEmployees',
  [PERMS.EDIT_EMPLOYEES]: 'manageEmployees',
  [PERMS.VIEW_EMPLOYEE_NOVELTIES]: PERMS.VIEW_EMPLOYEES,
  [PERMS.MANAGE_EMPLOYEE_SCHEDULES]: 'manageEmployees',
  [PERMS.VIEW_SUPERNUMERARIOS]: 'manageEmployees',
  [PERMS.EDIT_SUPERNUMERARIOS]: 'manageEmployees',
  [PERMS.VIEW_CARGOS]: 'manageEmployees',
  [PERMS.EDIT_CARGOS]: 'manageEmployees',
  [PERMS.VIEW_NOVEDADES]: 'manageEmployees',
  [PERMS.EDIT_NOVEDADES]: 'manageEmployees',
  [PERMS.VIEW_SHIFT_PLANS]: PERMS.VIEW_OPERATION_REGISTRY,
  [PERMS.MANAGE_SHIFT_PLANS]: PERMS.EDIT_SEDES,
  [PERMS.VIEW_GENERATED_SHIFTS]: PERMS.VIEW_OPERATION_REGISTRY,
  [PERMS.MANAGE_GENERATED_SHIFTS]: PERMS.MANAGE_OPERATION_REGISTRY,
  [PERMS.VIEW_SHIFT_REVIEW]: PERMS.VIEW_OPERATION_REGISTRY,
  [PERMS.MANAGE_SHIFT_REVIEW]: PERMS.MANAGE_OPERATION_REGISTRY,
  [PERMS.VIEW_SUPERVISORS]: 'manageSupervisors',
  [PERMS.EDIT_SUPERVISORS]: 'manageSupervisors',
  [PERMS.VIEW_OPERATION_REGISTRY]: PERMS.IMPORT_DATA,
  [PERMS.MANAGE_OPERATION_REGISTRY]: PERMS.IMPORT_DATA,
  [PERMS.VIEW_QR_SCANNER]: PERMS.IMPORT_DATA,
  [PERMS.USE_QR_SCANNER]: PERMS.VIEW_QR_SCANNER,
  [PERMS.VIEW_QR_DAILY_REGISTRY]: PERMS.IMPORT_DATA,
  [PERMS.MANAGE_QR_DAILY_REGISTRY]: PERMS.VIEW_QR_DAILY_REGISTRY,
  [PERMS.VIEW_QR_DEVICES]: PERMS.MANAGE_QR_DEVICES,
  [PERMS.MANAGE_QR_DEVICES]: PERMS.EDIT_SEDES,
  [PERMS.MANAGE_IMPORT_HISTORY]: PERMS.VIEW_IMPORT_HISTORY,
  [PERMS.VIEW_REPORTS_QR_HISTORY]: PERMS.VIEW_QR_DAILY_REGISTRY,
  [PERMS.VIEW_REPORTS_ABSENTEEISM]: PERMS.MANAGE_ABSENTEEISM,
  [PERMS.VIEW_REPORTS_CLIENT]: PERMS.VIEW_REPORTS,
  [PERMS.EXPORT_REPORTS_CLIENT]: PERMS.VIEW_REPORTS_CLIENT,
  [PERMS.EXPORT_REPORTS_QR_HISTORY]: PERMS.VIEW_REPORTS_QR_HISTORY,
  [PERMS.EXPORT_REPORTS_ABSENTEEISM]: PERMS.VIEW_REPORTS_ABSENTEEISM,
  [PERMS.VIEW_REPORTS_COMPANY]: PERMS.VIEW_REPORTS,
  [PERMS.EXPORT_REPORTS_COMPANY]: PERMS.VIEW_REPORTS_COMPANY,
  [PERMS.VIEW_REPORTS_EMPLOYEES]: PERMS.VIEW_REPORTS_COMPANY,
  [PERMS.EXPORT_REPORTS_EMPLOYEES]: PERMS.EXPORT_REPORTS_COMPANY,
  [PERMS.VIEW_REPORTS_HIRING]: PERMS.VIEW_REPORTS_COMPANY,
  [PERMS.EXPORT_REPORTS_HIRING]: PERMS.EXPORT_REPORTS_COMPANY,
  [PERMS.VIEW_REPORTS_NOVELTIES_CONSOLIDATED]: PERMS.VIEW_REPORTS_COMPANY,
  [PERMS.EXPORT_REPORTS_NOVELTIES_CONSOLIDATED]: PERMS.EXPORT_REPORTS_COMPANY,
  [PERMS.VIEW_REPORTS_SERVICES_CONSOLIDATED]: PERMS.VIEW_REPORTS_COMPANY,
  [PERMS.EXPORT_REPORTS_SERVICES_CONSOLIDATED]: PERMS.EXPORT_REPORTS_COMPANY,
  [PERMS.VIEW_BULK_UPLOAD_SEDES]: PERMS.EDIT_SEDES,
  [PERMS.BULK_UPLOAD_SEDES]: PERMS.EDIT_SEDES,
  [PERMS.VIEW_BULK_UPLOAD_EMPLOYEES]: PERMS.EDIT_EMPLOYEES,
  [PERMS.BULK_UPLOAD_EMPLOYEES]: PERMS.EDIT_EMPLOYEES,
  [PERMS.VIEW_INCAPACITIES]: PERMS.UPLOAD_DATA,
  [PERMS.MANAGE_INCAPACITIES]: PERMS.UPLOAD_DATA,
  [PERMS.VIEW_SITE_VISITS]: PERMS.EDIT_CONTRACTS,
  [PERMS.MANAGE_SITE_VISITS]: PERMS.EDIT_CONTRACTS,
  [PERMS.VIEW_SHIFT_ROTATIONS]: PERMS.MANAGE_GENERATED_SHIFTS,
  [PERMS.VIEW_CONTRACT_DASHBOARD]: PERMS.VIEW_REPORTS_CLIENT
};

export function getRole() {
  return getState().userProfile?.role ?? null;
}

export function isSuperAdmin() {
  return getRole() === ROLES.SUPERADMIN;
}

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);

// Effective permissions of a role (plus optional user overrides). A value stored explicitly always wins:
// legacy keys only fill in permissions that neither the overrides nor the role matrix define.
export function resolvePermissions(role, matrix = null, overrides = {}) {
  const roleMatrix = matrix && typeof matrix === 'object' ? matrix : {};
  const userOverrides = overrides && typeof overrides === 'object' ? overrides : {};
  const merged = { ...permsForRole(role), ...roleMatrix, ...userOverrides };
  Object.entries(LEGACY_FALLBACK_BY_NEW).forEach(([newKey, legacyKey]) => {
    if (has(userOverrides, newKey)) return;
    if (has(userOverrides, legacyKey)) { merged[newKey] = userOverrides[legacyKey] === true; return; }
    if (has(roleMatrix, newKey)) return;
    if (has(roleMatrix, legacyKey)) { merged[newKey] = roleMatrix[legacyKey] === true; return; }
    if (merged[legacyKey] === true) merged[newKey] = true;
  });
  Object.entries(PERMISSION_ACTION_VIEW_MAP).forEach(([actionKey, viewKey]) => {
    if (merged[actionKey] === true) merged[viewKey] = true;
  });
  return merged;
}

export function getEffectivePermissions() {
  const s = getState();
  if (!s.user || !s.userProfile?.role) return {};
  if (isSuperAdmin()) return Object.fromEntries(Object.values(PERMS).map((k) => [k, true]));
  const role = s.userProfile.role;
  if (role === ROLES.SUPERVISOR && s.userProfile?.supervisorEligible !== true) return {};
  return resolvePermissions(role, s.roleMatrix?.[role], s.userOverrides);
}

export function can(key) {
  const perms = getEffectivePermissions() || {};
  if (Object.prototype.hasOwnProperty.call(perms, key)) return Boolean(perms[key]);
  const legacyKey = LEGACY_FALLBACK_BY_NEW[key];
  if (legacyKey && Object.prototype.hasOwnProperty.call(perms, legacyKey)) return Boolean(perms[legacyKey]);
  return false;
}

export { PERMS };
