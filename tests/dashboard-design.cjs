const {chromium} = require(process.env.PLAYWRIGHT_MODULE);
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const server = http.createServer((req,res)=>{
  const file=path.resolve(root, '.'+decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(root+path.sep)) return res.writeHead(403).end();
  fs.readFile(file,(err,body)=>{if(err)return res.writeHead(404).end();res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(body);});
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    const page=await browser.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('https://**',r=>r.abort());
    await page.route('**/src/assets/js/app.js*',r=>r.fulfill({contentType:'text/javascript',body:''}));
    await page.goto(`http://127.0.0.1:${server.address().port}/app.html`);
    for(const name of ['ContractDashboard','GobiernoDashboard','EmpleadosDashboard','OperacionDashboard','ReportesDashboard','CargueMasivoDashboard','Inventory']) {
      await page.evaluate(async name=>{
        window.cleanup?.();
        const {setState}=await import('/src/assets/js/state.js');
        setState({user:{uid:'test'},userProfile:{role:'superadmin'},selectedContractCode:'A'});
        const stream=(...args)=>{args.find(arg=>typeof arg==='function')?.([]);return ()=>{};};
        const deps=new Proxy({loadInventory:async()=>({products:[],balances:[],events:[],sites:[]})},{get:(obj,key)=>obj[key] || (key.startsWith('stream')?stream:key.startsWith('count')?async()=>5:async()=>[])});
        const mod=await import(`/src/assets/js/components/${['ContractDashboard','Inventory'].includes(name)?'':'dashboards/'}${name}.js`);
        window.cleanup=mod[name](document.querySelector('#app-root'),deps);
      },name);
      await page.locator('.contract-demo__metric').first().waitFor();
      await page.waitForFunction(()=>![...document.querySelectorAll('.metric-tile__value')].some(n=>n.textContent==='...'));
      if(name==='Inventory') {
        assert.equal(await page.locator('.inventory a').count(),0,'dashboard has no module links');
        assert.deepEqual(await page.locator('.inventory button').allTextContents(),['Actualizar']);
      }
      for(const width of [1400,390]) {
        await page.setViewportSize({width,height:950});
        for(const theme of ['light','dark']) {
          await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
          assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name} ${width} ${theme}: overflow`);
          if(process.env.DASHBOARD_SCREENSHOTS){fs.mkdirSync(process.env.DASHBOARD_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.DASHBOARD_SCREENSHOTS,`${name}-${width}-${theme}.png`),fullPage:true,animations:'disabled'});}
        }
      }
      const action=page.locator('a.contract-demo__alert').first();
      if(await action.count()) {const target=await action.getAttribute('href');await action.click();assert.equal(await page.evaluate(()=>location.hash),target);}
    }
    assert.deepEqual(errors,[]);
    await page.evaluate(()=>window.cleanup?.());
    console.log('PASS: all 7 dashboards, resolved metrics, shared Resumen components, action navigation, desktop/mobile and light/dark layouts.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
