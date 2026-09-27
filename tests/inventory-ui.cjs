const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(body);
  });
});
(async () => {
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
 const browser = await chromium.launch({ channel: 'msedge', headless: true });
 try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const screenshot = async name => {
    if (!process.env.INVENTORY_SCREENSHOTS) return;
    fs.mkdirSync(process.env.INVENTORY_SCREENSHOTS, {recursive:true});
    await page.screenshot({path:path.join(process.env.INVENTORY_SCREENSHOTS, `${name}.png`),fullPage:true,animations:'disabled'});
  };
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/src/assets/js/app.js*', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.route('https://**', r => r.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}/app.html`);
  await page.evaluate(async () => {
    const {setState} = await import('/src/assets/js/state.js');
    setState({user:{email:'test@example.com'},userProfile:{role:'superadmin'},selectedContractCode:'A'});
    const {Inventory} = await import('/src/assets/js/components/Inventory.js');
    window.data = { products:[{id:'P',code:'J',name:'Jabón',unit:'Botella 500 ml',minimum:2,kind:'consumible'}],balances:[{product_id:'P',location:'Bodega',quantity:10}],events:[],sites:[{codigo:'S',nombre:'Sede Norte',estado:'activo'}] };
    window.calls = [];
    const deps = {
      loadInventory: async c => c==='A' ? structuredClone(window.data) : {products:[],balances:[],events:[],sites:[]},
      createInventoryProduct: async (c, p) => { window.calls.push({c,p}); window.data.products.push({...p,id:'P2'}); },
      postInventory: async (c,id,type,data,parent_id) => {
        if(type==='despacho')data=window.data.events.find(e=>e.id===parent_id).data;
        data={...data,contract:{name:'Contrato A',code:'A',client:'Cliente'},consent:'Confirmo las cantidades y el resultado registrados en esta acta.',lines:data.lines.map(l=>({...l,name:'Jabón',code:'J',unit:'Botella 500 ml'}))};
        window.data.events.push({id,type,data,parent_id,number:window.data.events.length+1,created_at:new Date().toISOString(),created_by:'Usuario de prueba'});
      }
    };
    const {addRoute, startRouter} = await import('/src/assets/js/router.js');
    for (const [route, view] of [['/inventory','dashboard'], ['/inventory/products','products'], ['/inventory/deliveries','deliveries']]) {
      addRoute(route, () => Inventory(document.querySelector('#app-root'), deps, view));
    }
    history.replaceState(null, '', '#/inventory');
    startRouter();
  });
  await page.getByRole('heading',{name:'Dashboard de inventarios',exact:true}).waitFor();
  assert.deepEqual(await page.locator('.inventory-metric strong').allTextContents(), ['1','0','0','0']);
  await screenshot('dashboard-light');
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');
  await screenshot('dashboard-dark');
  await page.evaluate(()=>document.documentElement.dataset.theme='light');
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await screenshot('dashboard-mobile');
  await page.setViewportSize({width:1400,height:950});
  await page.evaluate(()=>location.hash='/inventory/products');
  await page.getByRole('button',{name:'Nuevo producto',exact:true}).waitFor();
  await screenshot('products');
  await page.getByRole('button',{name:'Nuevo producto',exact:true}).click();
  await screenshot('product-form');
  await page.getByLabel('Código',{exact:true}).fill('E');
  await page.getByLabel('Nombre',{exact:true}).fill('Escoba');
  await page.getByLabel('Presentación / unidad (ej. botella de 500 ml)',{exact:true}).fill('Unidad');
  await page.getByRole('button',{name:'Guardar',exact:true}).click();
  await page.waitForFunction(()=>window.calls.length===1);
  await page.getByRole('button',{name:'Registrar ingreso',exact:true}).click();
  await page.getByLabel('Ubicación de almacenamiento').fill('Bodega');
  await page.getByLabel('Factura / referencia del soporte').fill('F-1');
  await page.getByLabel('Proveedor',{exact:true}).fill('Proveedor A');
  await page.getByLabel('Cantidad',{exact:true}).fill('10');
  await page.getByLabel('Costo unitario',{exact:true}).fill('500');
  await page.getByRole('button',{name:'Guardar',exact:true}).click();
  await page.waitForFunction(()=>window.data.events.length===1);
  assert.match(await page.evaluate(()=>window.data.events[0].data.date),/^\d{4}-\d{2}-\d{2}$/);
  await page.evaluate(()=>location.hash='/inventory/deliveries');
  await page.getByRole('button',{name:'Preparar entrega',exact:true}).click();
  await page.getByLabel('Ubicación de almacenamiento').fill('Bodega');
  await page.getByLabel('Sede de destino').selectOption('S');
  await page.getByLabel('Destinatario',{exact:true}).fill('Ana');
  await page.getByLabel('Cantidad',{exact:true}).fill('8');
  await page.getByRole('button',{name:'Guardar',exact:true}).click();
  await page.waitForFunction(()=>window.data.events.length===2);
  await page.evaluate(()=>location.hash='/inventory');
  await page.getByRole('heading',{name:'Dashboard de inventarios',exact:true}).waitFor();
  assert.deepEqual(await page.locator('.inventory-metric strong').allTextContents(), ['2','1','1','0']);
  await page.evaluate(()=>location.hash='/inventory/deliveries');
  await page.getByRole('button',{name:'Entregas',exact:true}).click();
  await page.getByRole('button',{name:'Despachar',exact:true}).click();
  await page.getByRole('button',{name:'Guardar',exact:true}).click();
  await page.waitForFunction(()=>window.data.events.length===3);
  await page.evaluate(()=>location.hash='/inventory');
  await page.getByRole('heading',{name:'Dashboard de inventarios',exact:true}).waitFor();
  assert.deepEqual(await page.locator('.inventory-metric strong').allTextContents(), ['2','1','0','1']);
  await page.evaluate(()=>location.hash='/inventory/deliveries');
  await page.getByRole('button',{name:'Registrar recibido',exact:true}).click();
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');
  await screenshot('receipt-dark');
  await page.evaluate(()=>document.documentElement.dataset.theme='light');
  await page.getByLabel('Nombre de quien recibe').fill('Ana Pérez');
  await page.getByLabel('Documento',{exact:true}).fill('12345');
  await page.getByLabel('Cargo',{exact:true}).fill('Coordinadora');
  await page.getByRole('checkbox').check();
  await page.getByRole('button',{name:'Guardar',exact:true}).click();
  assert.match(await page.getByRole('alert').textContent(),/dibujar su firma/);
  const box = await page.locator('canvas').boundingBox();
  await page.mouse.move(box.x+30,box.y+60); await page.mouse.down();
  await page.mouse.move(box.x+130,box.y+100,{steps:12}); await page.mouse.move(box.x+210,box.y+50,{steps:12}); await page.mouse.up();
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.getByRole('button',{name:'Guardar',exact:true}).click();
  await page.waitForFunction(()=>window.data.events.length===4);
  await page.getByRole('button',{name:'Actas',exact:true}).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button',{name:'Descargar PDF',exact:true}).click();
  const download = await downloadPromise;
  const pdf = fs.readFileSync(await download.path());
  assert.equal(pdf.subarray(0,8).toString(),'%PDF-1.4');
  assert.match(pdf.toString('latin1'),/\/Type \/Page /);
  const source = pdf.toString('latin1');
  const start = Number(source.match(/startxref\n(\d+)/)[1]);
  assert.equal(source.slice(start,start+4),'xref');
  const xrefs = source.slice(start).split('\n');
  const count=Number(xrefs[1].split(' ')[1]);
  for(let i=1;i<count;i++) assert.ok(source.slice(Number(xrefs[i+2].slice(0,10))).startsWith(`${i} 0 obj`));
  await page.evaluate(async()=> (await import('/src/assets/js/state.js')).setState({selectedContractCode:'B'}));
  await page.waitForFunction(()=>document.querySelector('.inventory').textContent.includes('Contrato B'));
  assert.equal(await page.getByRole('button',{name:'Descargar PDF',exact:true}).count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: browser draft, dispatch, receiver form, signature requirement/drawing, mobile layout, PDF download/xref and contract switch.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
