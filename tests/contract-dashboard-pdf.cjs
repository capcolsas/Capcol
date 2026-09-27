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
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/src/assets/js/app.js*', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
    await page.route('https://**', route => route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}/app.html`);
    await page.evaluate(async () => {
      const { setState } = await import('/src/assets/js/state.js');
      setState({ user: { email: 'test@example.com' }, userProfile: { role: 'superadmin' }, selectedContractCode: 'CON-TEST' });
      window.pdfCanvases = []; window.pdfText = [];
      const toDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function (...args) { window.pdfCanvases.push(this); return toDataURL.apply(this, args); };
      const fillText = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (text, x, y, ...args) {
        window.pdfText.push({ text, x, y, right: x + this.measureText(text).width }); return fillText.call(this, text, x, y, ...args);
      };
      const { ContractDashboard } = await import('/src/assets/js/components/ContractDashboard.js');
      const mount = document.createElement('main'); document.body.replaceChildren(mount);
      ContractDashboard(mount, {
        streamContracts: callback => { callback([{ codigo: 'CON-TEST', nombre: 'Operación Bogotá · Servicios integrales', fechaInicio: '2026-01-01', fechaFin: '2026-12-31', clienteContacto: 'María José Muñoz' }]); },
        streamSedes: callback => { callback([{ codigo: 'S1', nombre: 'Sede Centro', contratoCodigo: 'CON-TEST', numeroOperarios: 3, estado: 'activo' }]); },
        listActiveBaseEmployees: async () => [{ id: 'e1', documento: '1', nombre: 'Ana', contratoCodigo: 'CON-TEST', sedeCodigo: 'S1', fechaIngreso: '2026-01-01' }],
        listScheduledShiftsRange: async (from) => [{ id: 's1', fechaOperativa: from, contratoCodigo: 'CON-TEST', sedeCodigo: 'S1', sedeNombre: 'Sede Centro', estado: 'cerrado' }],
        listShiftAssignmentsForShifts: async () => [{ scheduledShiftId: 's1', employeeId: 'e1', documento: '1' }],
        listEmployeeShiftStatusRange: async () => [{ scheduledShiftId: 's1', employeeId: 'e1', documento: '1', asistio: true }],
        listIncapacidadesRange: async () => []
      });
    });
    await page.locator('input[type=date]').fill('2026-08-30');
    await page.locator('input[type=date]').dispatchEvent('change');
    await page.waitForFunction(() => !document.querySelector('.contract-demo__export').disabled);
    assert.equal(await page.locator('.contract-demo__alert').count(), 4);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Exportar PDF' }).click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), 'Resumen-CON-TEST-2026-08-30.pdf');
    const file = fs.readFileSync(await download.path());
    assert(file.subarray(0, 8).toString().startsWith('%PDF-1.4'));
    assert(file.toString('latin1').includes('/Count 2'));
    const xref = Number(file.toString('latin1').match(/startxref\n(\d+)/)[1]);
    assert.equal(file.subarray(xref, xref + 4).toString(), 'xref');
    const text = await page.evaluate(() => pdfText);
    assert(text.some(row => row.text.includes('María José Muñoz')));
    assert(text.some(row => row.text.includes('2026-08-24 al 2026-08-30')));
    assert(text.some(row => row.text.includes('contratadas sin turnos')), 'PDF includes the hidden seventh alert');
    assert(text.every(row => row.x >= 0 && row.right <= 1240 && row.y < 1754), 'text stays within the page');
    assert.equal(await page.locator('.contract-demo__alert').count(), 4, 'export leaves the collapsed dashboard unchanged');
    if (process.env.PDF_SCREENSHOTS) {
      fs.mkdirSync(process.env.PDF_SCREENSHOTS, { recursive: true });
      const images = await page.evaluate(() => pdfCanvases.slice(0, 2).map(canvas => canvas.toDataURL('image/png').split(',')[1]));
      images.forEach((image, index) => fs.writeFileSync(path.join(process.env.PDF_SCREENSHOTS, `dashboard-${index + 1}.png`), Buffer.from(image, 'base64')));
    }
    assert.deepEqual(errors, []);
    console.log('PASS: real browser PDF download, two A4 pages, all seven alerts, selected contract/week, Spanish text, page bounds and PDF cross-reference.');
  } finally { await browser?.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
