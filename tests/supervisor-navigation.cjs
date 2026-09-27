const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
  fs.readFile(file, (error, body) => {
    if (error) return res.writeHead(404).end();
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(body);
  });
});
const backend = `
export const authState = callback => { window.signOutTest = () => callback(null); callback({uid:'supervisor-test'}); };
export const ensureUserProfile = async () => {};
export const loadUserProfile = async () => ({role:'supervisor',supervisorEligible:true,zonaCodigo:'Z1',nombre:'Supervisor prueba'});
export const listSupervisorAvailableSupernumerarios = async () => [];
export const loadVisits = async () => ({cycles:[],assignments:[],visits:[],settings:null});
export const listSupervisorDailyRegistry = async (fecha,zones,options) => {
  window.registryScope = {zones,options};
  return {fecha,sedes:[
    {id:'S1',codigo:'S1',nombre:'Sede Norte',zonaCodigo:'Z1',zonaNombre:'Norte',dependenciaCodigo:'D1',dependenciaNombre:'Operaciones',estado:'activo',qrLatitude:4.7,qrLongitude:-74.1},
    {id:'S2',codigo:'S2',nombre:'Sede sin ubicación',zonaCodigo:'Z1',estado:'activo'}
  ],employees:[
    {id:'E1',documento:'1',nombre:'Ana Pendiente',sedeCodigo:'S1',sedeNombre:'Sede Norte'},
    {id:'E2',documento:'2',nombre:'Luis Presente',sedeCodigo:'S1',sedeNombre:'Sede Norte'},
    {id:'E3',documento:'3',nombre:'Marta Ausente',sedeCodigo:'S1',sedeNombre:'Sede Norte'}
  ],attendance:[{id:'A1',documento:'2',nombre:'Luis Presente'},{id:'A2',documento:'3',nombre:'Marta Ausente',novedadNombre:'Ausencia'}]};
};`;
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    for (const width of [390, 1400]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('https://**', route => route.request().url().startsWith('https://unpkg.com/lucide@') ? route.continue() : route.abort());
      await page.route('**/src/assets/js/supabase.js', route => route.fulfill({contentType:'text/javascript',body:backend}));
      await page.goto(`http://127.0.0.1:${server.address().port}/supervisor.html`);
      const active = page.locator('.supervisor-panel.is-active');
      await active.getByText('Ana Pendiente', {exact:true}).waitFor();
      assert.deepEqual(await page.locator('.supervisor-nav-btn__label').allTextContents(), ['Pendientes','Registros','Sedes','Supernum.']);
      assert.deepEqual(await page.evaluate(() => window.registryScope), {zones:['Z1'],options:{allZones:false}});
      await page.locator('.supervisor-bottom-nav').getByRole('button', {name:/^Registros -/}).click();
      await active.getByText('Ana Pendiente', {exact:true}).waitFor();
      const dropdown = page.locator('#supervisor-submenu-registry');
      const popupBox = await dropdown.boundingBox();
      const navBox = await page.locator('.supervisor-bottom-nav').boundingBox();
      assert.ok(popupBox.y + popupBox.height < navBox.y, 'Submenu opens upward');
      assert.ok(popupBox.x >= 0 && popupBox.x + popupBox.width <= width, 'Submenu fits viewport');
      await page.keyboard.press('Escape');
      assert.equal(await dropdown.isVisible(), false);
      await page.locator('.supervisor-bottom-nav').getByRole('button', {name:/^Registros -/}).click();
      await page.getByRole('button',{name:'Registro diario',exact:true}).click();
      assert.equal(await dropdown.isVisible(), false);
      assert.equal(await active.locator('h1').textContent(), 'Registro diario');
      await active.getByText('Luis Presente', {exact:true}).waitFor();
      assert.equal(await active.getByText('Ana Pendiente', {exact:true}).count(), 0);
      await page.locator('.supervisor-bottom-nav').getByRole('button', {name:/^Registros -/}).click();
      await page.getByRole('button', {name:'Novedades',exact:true}).click();
      assert.equal(await active.locator('h1').textContent(), 'Novedades');
      assert.equal(await page.locator('.supervisor-main .supervisor-panel').count(), 1);
      assert.equal(await page.locator('.supervisor-subnav').count(), 0);
      assert.equal(await page.locator('.supervisor-nav-btn.is-active .supervisor-nav-btn__label').textContent(), 'Registros');
      await active.getByText('Marta Ausente', {exact:true}).waitFor();
      assert.equal(await active.getByText('Luis Presente', {exact:true}).count(), 0);
      await page.getByRole('button', {name:'Sedes',exact:true}).click();
      await active.locator('h1').click();
      assert.equal(await page.locator('#supervisor-submenu-sites').isVisible(), false);
      await page.getByRole('button', {name:'Sedes',exact:true}).click();
      await page.getByRole('button', {name:'Ubicación de sedes',exact:true}).click();
      assert.equal(await active.locator('h1').textContent(), 'Ubicación de sedes');
      await page.locator('#sedeLocationStatLocated').getByText('1',{exact:true}).waitFor();
      assert.equal(await page.locator('#sedeLocationStatMissing').textContent(), '1');
      assert.ok(await page.locator('#supervisor-sites-mount a[href*="google.com/maps"]').count());
      for (const label of ['Abrir en Google Maps', 'Abrir en Waze', 'Ver en mapa', 'No tienes permiso para editar sedes']) {
        const action = page.locator(`#supervisor-sites-mount [aria-label="${label}"]:visible`).first();
        await action.locator('svg').waitFor({state:'visible'});
        assert.equal(await action.locator('.app-inline-icon__fallback').isVisible(), false, `${label} displays its icon`);
      }
      assert.equal(await page.locator('#supervisor-sites-mount button[aria-label="Editar sede"]').count(), 0);
      await page.locator('#sedeLocationSearch').fill('Norte');
      await active.getByRole('button',{name:'Actualizar sedes',exact:true}).click();
      assert.equal(await page.locator('#sedeLocationSearch').inputValue(), 'Norte');
      assert.equal(await page.locator('#sedeLocationStatMissing').textContent(), '0');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow');
      await page.getByRole('button', {name:'Sedes',exact:true}).click();
      await page.getByRole('button',{name:'Registro de visitas',exact:true}).click();
      assert.equal(await active.locator('h1').textContent(), 'Registro de visitas');
      assert.equal(await page.locator('.supervisor-nav-btn.is-active .supervisor-nav-btn__label').textContent(), 'Sedes');
      await active.getByText('No tienes ciclos de visitas asignados. Las sedes aparecerán cuando inicie la programación del contrato.',{exact:true}).waitFor();
      assert.equal(await page.locator('#sedeLocationMap').count(), 0);
      await page.getByRole('button', {name:'Sedes',exact:true}).click();
      await page.getByRole('button',{name:'Ubicación de sedes',exact:true}).click();
      await page.locator('#sedeLocationStatLocated').getByText('1',{exact:true}).waitFor();
      await page.getByRole('button',{name:/^Supernumerarios/}).click();
      await active.getByText('No hay supernumerarios para mostrar.',{exact:true}).waitFor();
      assert.equal(await page.locator('#sedeLocationMap').count(), 0);
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('Supervisor navigation passed at mobile and desktop widths.');
  } finally {
    await browser?.close();
    server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
