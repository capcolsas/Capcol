import { getState, setState } from '../state.js';

export const ALL_CONTRACTS_VALUE = '__all__';
const INTERNAL_ROLES = new Set(['superadmin', 'admin', 'editor']);

export function isInternalProfile(profile = getState().userProfile) {
  return INTERNAL_ROLES.has(String(profile?.role || '').trim().toLowerCase());
}

export function allowedContractCodes(profile = getState().userProfile) {
  return [...new Set([
    profile?.contratoCodigo,
    ...(Array.isArray(profile?.contratosPermitidos) ? profile.contratosPermitidos : [])
  ].map((value) => String(value || '').trim()).filter(Boolean))];
}

export function selectedContractCode() {
  return String(getState().selectedContractCode || '').trim();
}

export function contractFilterCode() {
  const selected = selectedContractCode();
  return selected && selected !== ALL_CONTRACTS_VALUE ? selected : '';
}

export function contractMatches(row = {}, code = contractFilterCode()) {
  const target = String(code || '').trim();
  if (!target) return true;
  if (String(row?.contratoCodigo || row?.contrato_codigo || '').trim() === target) return true;
  return contractCoverageCodes(row).includes(target);
}

export function contractCoverageCodes(row = {}) {
  return [...new Set([
    ...(Array.isArray(row?.contratosHabilitados) ? row.contratosHabilitados : []),
    ...(Array.isArray(row?.contratos_habilitados) ? row.contratos_habilitados : []),
    ...(Array.isArray(row?.contratosCobertura) ? row.contratosCobertura : [])
  ].map((value) => String(value || '').trim()).filter(Boolean))];
}

export function canCoverContract(row = {}, code = contractFilterCode()) {
  const target = String(code || '').trim();
  if (!target) return true;
  if (String(row?.contratoCodigo || row?.contrato_codigo || '').trim() === target) return true;
  return contractCoverageCodes(row).includes(target);
}

export function contractOptionsForProfile(contracts = [], profile = getState().userProfile) {
  const rows = contractRowsForProfile(contracts, profile);
  const options = rows.map((contract) => contractOption(contract));
  return isInternalProfile(profile) && rows.length > 1
    ? [{ value: ALL_CONTRACTS_VALUE, label: 'Todos los contratos' }, ...options]
    : options;
}

export function contractRowsForProfile(contracts = [], profile = getState().userProfile) {
  const internal = isInternalProfile(profile);
  const allowed = new Set(allowedContractCodes(profile));
  return (contracts || [])
    .filter((contract) => String(contract?.estado || 'activo').trim().toLowerCase() !== 'inactivo')
    .filter((contract) => internal || allowed.has(String(contract?.codigo || '').trim()))
    .sort((a, b) => String(a?.nombre || a?.codigo || '').localeCompare(String(b?.nombre || b?.codigo || '')));
}

export function contractOption(contract = {}) {
  const code = String(contract?.codigo || '').trim();
  const name = String(contract?.nombre || code || 'Contrato').trim();
  const client = String(contract?.clienteNombre || contract?.cliente_nombre || '').trim();
  return {
    value: code,
    label: client ? `${name} (${code}) - ${client}` : `${name} (${code})`
  };
}

export function latestCurrentContractCode(contracts = [], today = todayBogota()) {
  const rows = (contracts || []).filter((contract) => String(contract?.codigo || '').trim());
  if (!rows.length) return '';
  const vigente = rows
    .filter((contract) => String(contract?.estado || 'activo').trim().toLowerCase() !== 'inactivo')
    .filter((contract) => {
      const start = toIsoDate(contract?.fechaInicio || contract?.fecha_inicio);
      const end = toIsoDate(contract?.fechaFin || contract?.fecha_fin);
      return (!start || start <= today) && (!end || end >= today);
    });
  const active = rows.filter((contract) => String(contract?.estado || 'activo').trim().toLowerCase() !== 'inactivo');
  return sortContractsLatestFirst(vigente.length ? vigente : (active.length ? active : rows))[0]?.codigo || '';
}

export function sortContractsLatestFirst(contracts = []) {
  return [...(contracts || [])].sort((a, b) => {
    const aStart = toIsoDate(a?.fechaInicio || a?.fecha_inicio);
    const bStart = toIsoDate(b?.fechaInicio || b?.fecha_inicio);
    if (aStart !== bStart) return String(bStart || '').localeCompare(String(aStart || ''));
    return String(b?.createdAt || b?.created_at || '').localeCompare(String(a?.createdAt || a?.created_at || ''));
  });
}

export function normalizeSelectedContract(contracts = [], profile = getState().userProfile) {
  const options = contractOptionsForProfile(contracts, profile);
  const current = selectedContractCode();
  if (!options.length) {
    if (current) setState({ selectedContractCode: '' });
    return '';
  }
  if (current && options.some((option) => option.value === current)) return current;
  const next = isInternalProfile(profile) && options.length > 1 ? ALL_CONTRACTS_VALUE : options[0].value;
  setState({ selectedContractCode: next });
  return next;
}

export function selectedContractLabel(contracts = [], profile = getState().userProfile) {
  const code = selectedContractCode();
  const options = contractOptionsForProfile(contracts, profile);
  return options.find((option) => option.value === code)?.label || '';
}

function todayBogota() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
}

function toIsoDate(value) {
  if (!value) return '';
  if (typeof value === 'string') {
    const raw = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
  }
  const parsed = value instanceof Date ? value : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : '';
}
