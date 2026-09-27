import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../src/assets/js/components/Sidebar.js', import.meta.url), 'utf8');
const extract = name => {
  const start = source.indexOf(`function ${name}(`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
};
let allowed = new Set();
const context = vm.createContext({
  PERMS: new Proxy({}, {get: (_, key) => key}),
  can: key => allowed.has(key), isSuperAdmin: () => false,
  navLink: (label, route, options) => ({label, route, options}),
  // El titulo de cada grupo abre su dashboard y expande o recoge sus modulos.
  subSection: (title, links, key, route, options) => ({title, links, route, options}),
  section: (title, links, key, route, options) => ({title, links, route, options})
});
vm.runInContext(extract('buildContractProjectLinks') + '\n' + extract('buildSettingsSections'), context);
const dashboards = {
  '/empleados-dashboard': ['VIEW_EMPLOYEES','VIEW_EMPLOYEE_NOVELTIES','VIEW_SUPERVISORS','VIEW_INCAPACITIES'],
  '/operacion-dashboard': ['VIEW_OPERATION_REGISTRY','VIEW_QR_DAILY_REGISTRY','VIEW_SUPERNUMERARIOS','VIEW_IMPORT_HISTORY'],
  '/reportes-dashboard': ['VIEW_REPORTS_CLIENT','VIEW_REPORTS_QR_HISTORY','VIEW_REPORTS_ABSENTEEISM','VIEW_REPORTS_EMPLOYEES','VIEW_REPORTS_HIRING','VIEW_REPORTS_NOVELTIES_CONSOLIDATED','VIEW_REPORTS_SERVICES_CONSOLIDATED'],
  '/cargue-masivo-dashboard': ['VIEW_BULK_UPLOAD_SEDES','VIEW_BULK_UPLOAD_EMPLOYEES']
};
for (const permission of new Set(Object.values(dashboards).flat())) {
  allowed = new Set([permission]);
  const groups = context.buildContractProjectLinks('A');
  for (const [route, permissions] of Object.entries(dashboards)) {
    const matches = groups.filter(group => group.route === route);
    assert.equal(matches.length, permissions.includes(permission) ? 1 : 0, `${permission}: ${route}`);
    if (matches.length) {
      assert.equal(matches[0].options.contractCode, 'A');
      assert.equal(matches[0].options.sidebarContext, 'contract');
      // El dashboard ya no es un modulo adicional dentro de la lista.
      assert(!matches[0].links.some(link => /dashboard/i.test(link.route || '')), `${route} no se repite como enlace hijo`);
    }
  }
}
// Quien solo puede ver un dashboard (sin modulos hijos) conserva el grupo para abrirlo.
for (const permission of ['VIEW_SUPERNUMERARIOS', 'VIEW_REPORTS_NOVELTIES_CONSOLIDATED', 'VIEW_REPORTS_SERVICES_CONSOLIDATED']) {
  allowed = new Set([permission]);
  const groups = context.buildContractProjectLinks('A');
  assert(groups.some(group => group.route === (permission === 'VIEW_SUPERNUMERARIOS' ? '/operacion-dashboard' : '/reportes-dashboard')), `${permission} mantiene el acceso a su dashboard`);
}
allowed = new Set();
assert.equal(context.buildContractProjectLinks('A').length, 0);
assert.equal(context.buildSettingsSections().length, 0);
for (const permission of ['VIEW_USERS','VIEW_PERMISSIONS','VIEW_AUDIT']) {
  allowed = new Set([permission]);
  const governance = context.buildSettingsSections()[0];
  assert.equal(governance.route, '/gobierno-dashboard');
  assert.equal(governance.options.sidebarContext, 'settings');
  assert(!governance.links.some(link => link.route === '/gobierno-dashboard'), 'gobierno no repite su dashboard como modulo');
}
console.log('PASS: group titles open their dashboard, preserve contract/context, match route permissions (including dashboard-only roles) and no longer add a duplicate Dashboard module.');
