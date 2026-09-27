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
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(body);
  });
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({channel:'msedge',headless:true});
    for (const width of [390,1400]) {
      const page = await browser.newPage({viewport:{width,height:900}});
      const errors = []; page.on('pageerror',error=>errors.push(error.message));
      await page.route('https://**',route=>route.abort());
      await page.route('**/src/assets/js/app.js*',route=>route.fulfill({contentType:'text/javascript',body:''}));
      await page.goto(`http://127.0.0.1:${server.address().port}/app.html`);
      await page.evaluate(async () => {
        const {setState} = await import('/src/assets/js/state.js');
        const {Sidebar} = await import('/src/assets/js/components/Sidebar.js');
        setState({user:{uid:'test'},userProfile:{role:'superadmin'},selectedContractCode:'A',sidebarContext:'contract'});
        window.selectContract = code=>setState({selectedContractCode:code,sidebarContext:'contract'});
        window.setSidebarContext = context=>setState({sidebarContext:context});
        window.imageSigns=[];
        window.contracts=[{id:'A',codigo:'A',nombre:'Contrato A',estado:'activo',referenceImagePath:'A/image.webp'},{id:'B',codigo:'B',nombre:'Contrato B',estado:'activo',referenceImagePath:'B/image.webp'}];
        window.sidebar = Sidebar({streamContracts(cb){window.contractSnapshot=cb;cb(window.contracts);return ()=>{};},getContractReferenceImageUrl:async path=>{
          window.imageSigns.push(path);
          return 'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="teal"/></svg>');
        }});
        document.querySelector('#app-sidebar').replaceChildren(window.sidebar);
      });
      await page.waitForFunction(()=>document.querySelectorAll('.sidebar__contract-image').length===2);
      for (const route of ['/empleados-dashboard','/operacion-dashboard','/reportes-dashboard','/cargue-masivo-dashboard','/inventory']) {
        const link = page.locator(`.sidebar__subnav a[href="#${route}"]`);
        assert.equal(await link.count(),1);
        await link.evaluate(node=>{
          const group=node.closest('.sidebar__subsection');
          const toggle=group.querySelector('.sidebar__subsection-toggle');
          if (!group.classList.contains('is-collapsed')) toggle.click();
        });
        const before = await page.evaluate(()=>location.hash);
        await link.evaluate(node=>node.closest('.sidebar__subsection').querySelector('.sidebar__subsection-toggle').click());
        assert.equal(await page.evaluate(()=>location.hash),before,'expanding a group does not navigate');
        await link.evaluate(node=>node.click());
        await page.waitForFunction(route=>location.hash===`#${route}`,route);
        await page.waitForFunction(route=>document.querySelector(`a[href="#${route}"]`).getAttribute('aria-current')==='page',route);
      }
      await page.evaluate(()=>window.setSidebarContext('settings'));
      assert.equal(await page.locator('.sidebar__nav a[href="#/gobierno-dashboard"]').count(),1);
      await page.evaluate(()=>window.setSidebarContext('contract'));
      await page.evaluate(()=>{
        window.originalRail=document.querySelector('.sidebar__rail');
        window.originalButtons=[...document.querySelectorAll('[data-contract-code]')];
        window.originalImages=[...document.querySelectorAll('.sidebar__contract-image')];
        window.selectContract('B');window.selectContract('A');window.selectContract('B');
        window.setSidebarContext('settings');window.setSidebarContext('contract');
      });
      assert.deepEqual(await page.evaluate(()=>window.imageSigns),['A/image.webp','B/image.webp']);
      assert.ok(await page.evaluate(()=>window.originalRail===document.querySelector('.sidebar__rail')));
      assert.ok(await page.evaluate(()=>window.originalButtons.every(node=>node===document.querySelector(`[data-contract-code="${node.dataset.contractCode}"]`))));
      assert.ok(await page.evaluate(()=>window.originalImages.every(node=>node.isConnected && [...document.querySelectorAll('.sidebar__contract-image')].includes(node))));
      assert.equal(await page.locator('[data-contract-code="B"]').getAttribute('aria-pressed'),'true');
      assert.equal(await page.locator('[data-contract-code="A"]').getAttribute('aria-pressed'),'false');
      assert.equal(await page.locator('.sidebar__project-title').textContent(),'Contrato B');
      await page.evaluate(()=>{window.contracts[1]={...window.contracts[1],referenceImagePath:'B/new.webp'};window.contractSnapshot(window.contracts);});
      await page.waitForFunction(()=>window.imageSigns.includes('B/new.webp'));
      await page.waitForFunction(()=>document.querySelectorAll('.sidebar__contract-image').length===2);
      assert.deepEqual(errors,[]);
      await page.evaluate(()=>window.sidebar._cleanup());
      await page.close();
    }
    console.log('PASS: contract/context switches preserve rail, buttons and loaded image nodes with no new signing calls; selection updates and changed images refresh.');
  } finally {await browser?.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
