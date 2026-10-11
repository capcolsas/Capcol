import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const { setState } = await import('../src/assets/js/state.js');
const { can } = await import('../src/assets/js/permissions.js');
const { contractRowsForProfile } = await import('../src/assets/js/utils/contractScope.js');
const { PERMS } = await import('../src/assets/js/roles.js');

const contracts = [{ codigo: 'A', nombre: 'A' }, { codigo: 'B', nombre: 'B' }];
const consultor = { role: 'consultor', estado: 'activo', contratoCodigo: 'A', contratosPermitidos: ['A'] };

// The bug: the session profile had no contract fields, so every contract was filtered out and the
// sidebar showed no modules. The loader must now carry them.
const legacy = await fs.readFile(new URL('../src/assets/js/services/supabase/legacy.js', import.meta.url), 'utf8');
const loader = legacy.slice(legacy.indexOf('export async function loadUserProfile'), legacy.indexOf('export async function getUserOverrides'));
for (const field of ['contratoCodigo: data.contrato_codigo', 'contratosPermitidos:', 'accessProfileId: data.access_profile_id']) {
  assert.ok(loader.includes(field), `loadUserProfile maps ${field}`);
}

setState({ user: { uid: 'u' }, userProfile: consultor, roleMatrix: {}, userOverrides: {}, accessProfiles: [] });
assert.deepEqual(contractRowsForProfile(contracts).map((c) => c.codigo), ['A'], 'consultor works on its assigned contract');
assert.deepEqual(contractRowsForProfile(contracts, { role: 'admin' }).map((c) => c.codigo), [], 'admin without assignments sees none');
assert.deepEqual(contractRowsForProfile(contracts, { role: 'superadmin' }).map((c) => c.codigo), ['A', 'B']);
assert.equal(can(PERMS.VIEW_SEDES), true, 'consultor default modules');
assert.equal(can(PERMS.VIEW_SHIFT_REVIEW), false);

// A custom profile adds and removes modules over the base role; overrides still win.
const profile = { id: 'p1', estado: 'activo', permissions: { [PERMS.VIEW_SHIFT_REVIEW]: true, [PERMS.VIEW_SEDES]: false } };
setState({ userProfile: { ...consultor, accessProfileId: 'p1' }, accessProfiles: [profile] });
assert.equal(can(PERMS.VIEW_SHIFT_REVIEW), true);
assert.equal(can(PERMS.VIEW_SEDES), false);
assert.equal(can(PERMS.VIEW_EMPLOYEES), true, 'keys the profile does not define keep the base role value');
setState({ userOverrides: { [PERMS.VIEW_SEDES]: true } });
assert.equal(can(PERMS.VIEW_SEDES), true);

// An inactive profile stops applying, as in SQL.
setState({ userOverrides: {}, accessProfiles: [{ ...profile, estado: 'inactivo' }] });
assert.equal(can(PERMS.VIEW_SHIFT_REVIEW), false);
assert.equal(can(PERMS.VIEW_SEDES), true);

console.log('PASS: session profile carries contract scope, profile modules layer over the base role, overrides win, inactive profiles fall back.');
