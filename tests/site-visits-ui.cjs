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
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    for (const width of [390, 1400]) {
      const page = await browser.newPage({ viewport: { width, height: 950 } });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.route('https://**', route => route.abort());
      await page.route('**/src/assets/js/supervisor-app.js*', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
      await page.goto(`http://127.0.0.1:${server.address().port}/supervisor.html`);
      await page.evaluate(async () => {
        const { SiteVisits } = await import('/src/assets/js/components/SiteVisits.js');
        const { visitToday } = await import('/src/assets/js/utils/visits.js');
        const day = visitToday();
        const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
        window.calls = []; window.failUpload = true; window.failGps = true;
        navigator.geolocation.getCurrentPosition = (resolve, reject) => window.failGps ? reject({ message: 'GPS denegado' }) : resolve({coords:{latitude:4.7,longitude:-74.1,accuracy:15}});
        window.visitData = {cycles:[{id:'C',contract_name:'Contrato Norte',starts_on:day,ends_on:day,radius_m:200,accuracy_m:100}],assignments:[{id:'A',cycle_id:'C',sede_name:'Sede Norte',sede_codigo:'S1',zone_code:'Z1',supervisor_id:'U',supervisor_name:'Ana'}],visits:[],settings:null};
        window.visitDeps = {
          loadVisits: async () => structuredClone(window.visitData),
          beginVisit: async (id, assignment, gps) => { window.calls.push({type:'begin',id,assignment,gps}); window.currentVisit=id; },
          uploadVisitPhoto: async (id, file) => { window.calls.push({type:'upload',id,name:file.name}); if(window.failUpload){window.failUpload=false;throw Error('Sin conexión');} return 'photo/'+id+'/'+file.name; },
          submitVisit: async (id, data) => { window.calls.push({type:'submit',id,data}); window.visitData.visits.push({id,assignment_id:'A',...data,status:'review',submitted_at:new Date().toISOString(),latitude:4.7,longitude:-74.1,accuracy_m:15,distance_m:300,gps_issue:'Fuera del radio de la sede.'}); return 'review'; },
          getVisitPhotoUrl: async () => png,
          saveVisitSettings: async (contract, settings) => { window.calls.push({type:'settings',contract,settings}); window.visitData.settings=settings; },
          reviewVisit: async (id, accept, note) => { window.calls.push({type:'review',id,accept,note}); window.visitData.visits.find(row=>row.id===id).status=accept?'valid':'rejected'; }
        };
        const host = document.querySelector('#supervisor-root'); host.style.cssText='max-width:1000px;margin:auto;padding:16px;box-sizing:border-box';
        window.mountVisits = admin => { window.visitCleanup?.(); window.visitCleanup=SiteVisits(host,window.visitDeps,admin?{admin:true,contract:'N'}:{}); };
        window.mountVisits(false);
      });
      await page.getByRole('button', { name:'Registrar visita', exact:true }).click();
      await page.getByText(/No se pudo iniciar la visita: GPS denegado/).waitFor();
      assert.equal(await page.evaluate(()=>window.calls.length),0);
      await page.evaluate(()=>{window.failGps=false;});
      await page.getByRole('button', { name:'Registrar visita', exact:true }).click();
      await page.getByRole('heading',{name:'Visita · Sede Norte'}).waitFor();
      await page.getByLabel('¿Encontraste novedades?').selectOption('yes');
      await page.getByLabel('Descripción de las novedades').fill('Fuga de agua');
      await page.getByLabel('Recomendaciones',{exact:true}).fill('Reparar la llave');
      await page.getByLabel('Observaciones',{exact:true}).fill('Se informó al encargado');
      await page.getByLabel(/Fotos de la visita/).setInputFiles({name:'evidencia.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64')});
      await page.getByRole('button',{name:'Enviar visita',exact:true}).click();
      await page.getByText(/No se pudo enviar: Sin conexión/).waitFor();
      assert.equal(await page.getByLabel('Descripción de las novedades').inputValue(),'Fuga de agua');
      await page.getByRole('button',{name:'Enviar visita',exact:true}).click();
      await page.getByText('Visita enviada. La evidencia GPS requiere revisión administrativa.',{exact:true}).waitFor();
      assert.equal(await page.evaluate(()=>window.calls.filter(row=>row.type==='begin').length),1);
      assert.equal(await page.evaluate(()=>window.calls.find(row=>row.type==='submit').data.findings),'Fuga de agua');
      await page.getByRole('button',{name:'Historial (1)',exact:true}).click();
      await page.getByText('Novedades: Fuga de agua',{exact:true}).waitFor();
      await page.getByAltText('Evidencia de la visita').waitFor();
      assert.equal(await page.getByRole('button',{name:'Aprobar visita',exact:true}).count(),0);
      await page.evaluate(()=>window.mountVisits(true));
      await page.getByRole('button',{name:'Historial (1)',exact:true}).click();
      await page.getByRole('button',{name:'Aprobar visita',exact:true}).click();
      await page.getByText('Registra el motivo de la decisión.',{exact:true}).waitFor();
      await page.getByLabel('Motivo de la revisión').fill('Fotografías y ubicación revisadas');
      await page.getByRole('button',{name:'Aprobar visita',exact:true}).click();
      await page.getByText('1 de 1 asignaciones cumplidas',{exact:true}).waitFor();
      assert.equal(await page.evaluate(()=>window.calls.find(row=>row.type==='review').accept),true);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow');
      await page.evaluate(()=>{window.visitData.cycles=[];window.visitData.assignments=[];window.mountVisits(true);});
      await page.getByLabel('Frecuencia',{exact:true}).selectOption('monthly');
      assert.ok((await page.getByLabel('Inicio (mensual: día 1)',{exact:true}).inputValue()).endsWith('-01'));
      await page.getByRole('button',{name:'Guardar programación',exact:true}).click();
      await page.waitForFunction(()=>window.calls.some(row=>row.type==='settings'));
      assert.equal(await page.evaluate(()=>window.calls.find(row=>row.type==='settings').contract),'N');
      await page.evaluate(() => {
        const originalLoad = window.visitDeps.loadVisits;
        const originalSave = window.visitDeps.saveVisitSettings;
        window.visitDeps.saveVisitSettings = async (...args) => { await originalSave(...args); window.failNextRead=true; };
        window.visitDeps.loadVisits = async (...args) => {
          if(window.failNextRead){window.failNextRead=false;throw Error('TypeError: Failed to fetch');}
          return originalLoad(...args);
        };
      });
      await page.getByRole('button',{name:'Guardar programación',exact:true}).click();
      await page.getByText(/Programación guardada correctamente\. No se pudo actualizar la vista/).waitFor();
      await page.getByLabel('Frecuencia',{exact:true}).waitFor();
      const savedCount = await page.evaluate(()=>window.calls.filter(row=>row.type==='settings').length);
      await page.getByRole('button',{name:'Reintentar',exact:true}).click();
      await page.getByText('Programación guardada correctamente.',{exact:true}).waitFor();
      assert.equal(await page.evaluate(()=>window.calls.filter(row=>row.type==='settings').length),savedCount,'Retry reloads instead of saving again');
      await page.evaluate(async () => {
        window.visitCleanup();
        const { setState } = await import('/src/assets/js/state.js');
        const { SiteVisitsAdmin } = await import('/src/assets/js/components/SiteVisitsAdmin.js');
        window.selectVisitContract = code => setState({ selectedContractCode: code });
        window.selectVisitContract('');
        window.contractLoads = [];
        const originalLoad = window.visitDeps.loadVisits;
        window.visitDeps.loadVisits = async contract => { window.contractLoads.push(contract); return originalLoad(contract); };
        window.visitCleanup = SiteVisitsAdmin(document.querySelector('#supervisor-root'), window.visitDeps);
      });
      await page.getByText('Selecciona un contrato en la barra lateral para programar y consultar sus visitas.', {exact:true}).waitFor();
      assert.deepEqual(await page.evaluate(()=>window.contractLoads), []);
      await page.evaluate(()=>window.selectVisitContract('N'));
      await page.getByLabel('Frecuencia',{exact:true}).waitFor();
      await page.evaluate(()=>window.selectVisitContract('M'));
      await page.getByLabel('Frecuencia',{exact:true}).waitFor();
      assert.deepEqual(await page.evaluate(()=>window.contractLoads), ['N','M']);
      await page.evaluate(()=>{window.visitCleanup();window.selectVisitContract('Q');});
      assert.deepEqual(await page.evaluate(()=>window.contractLoads), ['N','M'], 'Leaving the module removes its contract subscription');
      assert.deepEqual(errors,[]);
      await page.close();
    }
    console.log('PASS: visits UI at mobile/desktop, denied GPS, photo upload retry, form preservation, findings, evidence history, review and contract configuration.');
  } finally { await browser?.close(); server.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
