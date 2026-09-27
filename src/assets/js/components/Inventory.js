import { el, lucideInlineIcon } from '../utils/dom.js';
import { can, PERMS } from '../permissions.js';
import { subscribe, getState } from '../state.js';
import { contractFilterCode } from '../utils/contractScope.js';
import { pendingLines, deliveryStatus, downloadCsv } from '../utils/inventory.js';
import { printInventoryAct } from '../utils/inventoryAct.js';
import { downloadInventoryPdf } from '../utils/inventoryPdf.js';
import { summaryMetric } from './dashboards/DashboardUI.js';

export function Inventory(mount, deps = {}, view = 'dashboard') {
  const ui = el('section', { className: `main-card module-dashboard inventory${view === 'dashboard' ? ' contract-dashboard-demo summary-dashboard' : ''}` }); mount.replaceChildren(ui);
  let data = { products: [], balances: [], events: [], sites: [] }, tab = view === 'deliveries' ? 'Entregas' : 'Productos', version = 0, disposed = false;
  const titles = { dashboard: 'Dashboard de inventarios', products: 'Bienes y productos', deliveries: 'Gestión de entregas' };
  if (view === 'products' && new URLSearchParams(window.location.hash.split('?')[1]).get('tab') === 'stock') tab = 'Existencias';
  let closeDialog = () => {};
  const btn = (label, onclick, primary = false) => el('button', { type: 'button', className: `btn${primary ? ' btn--primary' : ''}`, onclick }, [label]);
  const message = el('p', { role: 'status', className: 'text-muted' });
  const field = (label, props = {}, options) => {
    const input = options ? el('select', { className: 'select', ...props }, options.map(([value, text]) => el('option', { value }, [text]))) : el('input', { className: 'input', required: true, ...props });
    return { input, node: el('label', { className: 'action-modal__field inventory-field' }, [el('span', { className: 'label' }, [label]), input]) };
  };
  function table(headers, rows) {
    return el('div', { className: 'table-wrap' }, [el('table', { className: 'table' }, [
      el('thead', {}, [el('tr', {}, headers.map(h => el('th', {}, [h])))]),
      el('tbody', {}, rows.length ? rows.map(row => el('tr', {}, row.map(c => el('td', {}, [c])))) : [el('tr', {}, [el('td', { colSpan: headers.length }, ['Sin registros'])])])
    ])]);
  }
  async function load() {
    closeDialog(); const current = ++version; const contract = contractFilterCode();
    ui.replaceChildren(el('h2', {}, [titles[view]]), message);
    message.textContent = contract ? 'Cargando inventario…' : 'Selecciona un contrato para consultar su inventario.';
    if (!contract) return;
    try {
      const loaded = await deps.loadInventory(contract);
      if (disposed || current !== version) return;
      data = loaded; render();
    } catch (error) { if (!disposed && current === version) message.textContent = `No se pudo cargar el inventario: ${error.message}`; }
  }
  function dialog(title, build, submit) {
    closeDialog(); const contract = contractFilterCode();
    const modal = el('dialog', { className: 'action-modal inventory-dialog', 'aria-label': title });
    const form = el('form', { className: 'inventory-dialog-form' });
    const body = el('div', { className: 'action-modal__body' });
    form.append(el('div', { className: 'action-modal__header' }, [el('h3', { className: 'action-modal__title' }, [title])]), body);
    const error = el('p', { role: 'alert' }); const save = el('button', { className: 'btn btn--primary', type: 'submit' }, ['Guardar']);
    const read = build(body);
    body.append(error);
    form.append(el('div', { className: 'action-modal__footer' }, [btn('Cancelar', () => modal.close()), save]));
    let busy = false;
    form.onsubmit = async event => {
      event.preventDefault(); if (busy) return;
      try {
        const payload = read(); busy = true; save.disabled = true; error.textContent = 'Guardando…';
        await submit(contract, payload);
        if (!disposed && contract === contractFilterCode()) { modal.close(); await load(); }
      } catch (e) { error.textContent = e.message; } finally { busy = false; save.disabled = false; }
    };
    modal.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    modal.append(form); document.body.append(modal); modal.showModal();
    modal.addEventListener('close', () => modal.remove()); closeDialog = () => modal.remove();
  }
  function productForm() {
    dialog('Nuevo producto o bien', form => {
      const fields = { code: field('Código'), name: field('Nombre'), unit: field('Presentación / unidad (ej. botella de 500 ml)'), category: field('Categoría', { required: false }),
        kind: field('Tipo', {}, [['consumible', 'Consumible'], ['bien', 'Bien reutilizable']]), minimum: field('Existencia mínima', { type: 'number', min: 0, step: '.001', value: 0 }) };
      form.append(...Object.values(fields).map(f => f.node));
      return () => Object.fromEntries(Object.entries(fields).map(([key, f]) => [key, f.input.value.trim()]));
    }, (contract, payload) => deps.createInventoryProduct(contract, payload));
  }
  function movementForm(type, draft) {
    const id = crypto.randomUUID();
    dialog({ ingreso: 'Registrar ingreso', borrador: 'Preparar entrega', despacho: 'Confirmar despacho', devolucion: 'Registrar devolución', ajuste: 'Ajustar existencias' }[type], form => {
      if (draft) {
        form.append(el('p', {}, [`Despachar INV-${draft.number} a ${draft.data.recipient}, sede ${draft.data.site}, desde ${draft.data.location}.`]), table(['Producto', 'Cantidad'], draft.data.lines.map(l => [l.name, l.quantity])));
        return () => ({});
      }
      const location = field('Ubicación de almacenamiento', { placeholder: 'Ej. Bodega central / Sede Norte', list: 'inventory-locations' });
      form.append(location.node, el('datalist', { id: 'inventory-locations' }, [...new Set(data.balances.map(b => b.location))].map(value => el('option', { value }))));
      const fields = { location };
      if (type === 'borrador') {
        fields.site = field('Sede de destino', { required: true }, [['', 'Selecciona una sede'], ...data.sites.filter(s => s.estado === 'activo').map(s => [s.codigo, `${s.nombre} (${s.codigo})`])]);
        fields.recipient = field('Destinatario'); fields.responsible = field('Responsable de entrega', { value: getState().user?.email || '' });
      } else {
        fields.reference = field(type === 'ingreso' ? 'Factura / referencia del soporte' : 'Motivo y referencia del movimiento');
        if (type === 'ingreso') {
          fields.supplier = field('Proveedor');
          fields.date = field('Fecha de ingreso', { type: 'date', value: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date()) });
        }
      }
      fields.notes = field('Observaciones', { required: false });
      form.append(...Object.entries(fields).filter(([k]) => k !== 'location').map(([, f]) => f.node));
      const lines = [], container = el('div');
      function add() {
        const product = field('Producto', {}, data.products.map(p => [p.id, `${p.code} · ${p.name} · ${p.unit}`]));
        const quantity = field('Cantidad', { type: 'number', step: '.001', min: type === 'ajuste' ? undefined : '.001' });
        const cost = type === 'ingreso' ? field('Costo unitario', { type: 'number', step: '.01', min: 0 }) : null;
        const row = el('div', { className: 'inventory-line' }, [product.node, quantity.node, ...(cost ? [cost.node] : [])]);
        const item = { product, quantity, cost, row }; lines.push(item);
        row.append(btn('Quitar', () => { lines.splice(lines.indexOf(item), 1); row.remove(); })); container.append(row);
      }
      add(); form.append(container, btn('Agregar producto', add));
      return () => {
        if (!lines.length) throw new Error('Agrega al menos un producto.');
        const payload = Object.fromEntries(Object.entries(fields).map(([key, f]) => [key, f.input.value.trim()]));
        payload.lines = lines.map(l => ({ product: l.product.input.value, quantity: Number(l.quantity.input.value), ...(l.cost ? { cost: Number(l.cost.input.value) } : {}) }));
        if (new Set(payload.lines.map(l => l.product)).size !== lines.length) throw new Error('Agrupa las cantidades del mismo producto en una sola línea.');
        return payload;
      };
    }, (contract, payload) => deps.postInventory(contract, id, type, payload, draft?.id || null));
  }
  function receive(delivery) {
    const id = crypto.randomUUID();
    dialog(`Recibir despacho INV-${delivery.number}`, form => {
      const lines = pendingLines(delivery, data.events).filter(l => l.quantity > 0);
      form.append(el('p', {}, [`Sede: ${delivery.data.site} · Destinatario: ${delivery.data.recipient}`]));
      const quantities = lines.map(l => field(`${l.name} · ${l.unit} · Pendiente: ${l.quantity}`, { type: 'number', min: 0, max: l.quantity, step: '.001', value: l.quantity }));
      form.append(...quantities.map(f => f.node));
      const fields = { receiver: field('Nombre de quien recibe'), document: field('Documento'), position: field('Cargo'),
        result: field('Resultado', {}, [['satisfaccion', 'Recibido a satisfacción'], ['novedades', 'Recibido con novedades'], ['rechazado', 'Rechazado']]), notes: field('Observaciones', { required: false }) };
      form.append(...Object.values(fields).map(f => f.node));
      fields.result.input.onchange = () => { if (fields.result.input.value === 'rechazado') quantities.forEach(f => { f.input.value = 0; }); };
      const canvas = el('canvas', { width: 800, height: 280, className: 'inventory-signature', 'aria-label': 'Dibuja aquí la firma de quien recibe' });
      const ctx = canvas.getContext('2d'); ctx.lineWidth = 3; ctx.lineCap = 'round';
      let drawing = false, strokes = 0;
      const point = e => { const r = canvas.getBoundingClientRect(); return [(e.clientX-r.left)*canvas.width/r.width, (e.clientY-r.top)*canvas.height/r.height]; };
      canvas.onpointerdown = e => { drawing = true; canvas.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.moveTo(...point(e)); };
      canvas.onpointermove = e => { if (!drawing) return; ctx.lineTo(...point(e)); ctx.stroke(); strokes++; };
      canvas.onpointerup = canvas.onpointercancel = () => { drawing = false; };
      const accepted = field('Confirmo las cantidades y el resultado registrados en esta acta y autorizo incorporar mi firma como constancia de esta recepción.', { type: 'checkbox', required: true });
      form.append(el('p', {}, ['Firma de quien recibe']), canvas, btn('Limpiar firma', () => { ctx.clearRect(0, 0, canvas.width, canvas.height); strokes = 0; }), accepted.node);
      return () => {
        if (strokes < 3) throw new Error('La persona que recibe debe dibujar su firma.');
        return { ...Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, f.input.value.trim()])), signature: canvas.toDataURL('image/png'), accepted: accepted.input.checked,
          lines: lines.map((l, i) => ({ product: l.product, quantity: Number(quantities[i].input.value) })) };
      };
    }, (contract, payload) => deps.postInventory(contract, id, 'recepcion', payload, delivery.id));
  }
  function returnPending(delivery) {
    const id = crypto.randomUUID();
    dialog(`Devolver pendientes de INV-${delivery.number}`, form => {
      form.append(el('p', {}, [`Registra solo productos que regresaron físicamente a ${delivery.data.location}.` ]));
      const lines = pendingLines(delivery, data.events).filter(l => l.quantity > 0);
      const quantities = lines.map(l => field(`${l.name} · Pendiente: ${l.quantity}`, { type: 'number', min: 0, max: l.quantity, step: '.001', value: l.quantity }));
      const reference = field('Motivo de devolución'); form.append(...quantities.map(f => f.node), reference.node);
      return () => ({ reference: reference.input.value.trim(), lines: lines.map((l, i) => ({ product: l.product, quantity: Number(quantities[i].input.value) })).filter(l => l.quantity > 0) });
    }, (contract, payload) => deps.postInventory(contract, id, 'devolucion', payload, delivery.id));
  }
  function renderDashboard(pending) {
    const stock = data.products.flatMap(product => {
      const balances = data.balances.filter(b => b.product_id === product.id);
      return (balances.length ? balances : [{ location: 'Sin ingresos', quantity: 0 }]).map(balance => ({ product, ...balance }));
    });
    const low = stock.filter(b => Number(b.quantity) <= Number(b.product.minimum));
    const drafts = data.events.filter(e => e.type === 'borrador' && deliveryStatus(e, data.events) === 'Borrador');
    const metrics = [
      ['Productos registrados', data.products.length, `${data.products.filter(p => p.kind === 'bien').length} bienes reutilizables`],
      ['Alertas de existencias', low.length, 'Productos por ubicación en mínimo o por debajo'],
      ['Entregas por despachar', drafts.length, 'Borradores que aún no descuentan inventario'],
      ['Despachos pendientes', pending.length, 'Con cantidades por recibir o devolver']
    ];
    ui.append(el('div', { className: 'contract-demo__kpis summary-dashboard__kpis' }, metrics.map(([label, value, detail], index) => {
      const metric = summaryMetric(label, value, ['package', 'triangle-alert', 'truck', 'clock-3'][index], ['teal', 'danger', 'blue', 'violet'][index], detail);
      metric.classList.add('inventory-metric');
      return metric;
    })));
    const alerts = el('article', { className: 'section-block inventory-panel' }, [el('h3', { className: 'section-title' }, ['Atención a existencias']), el('p', { className: 'text-muted' }, ['Alertas por producto y ubicación de almacenamiento.'])]);
    alerts.append(low.length ? table(['Producto', 'Ubicación', 'Disponible / mínimo'], low.slice(0, 5).map(b => [b.product.name, b.location, `${b.quantity} / ${b.product.minimum} ${b.product.unit}`])) : el('p', { className: 'inventory-empty' }, [data.products.length ? 'No hay existencias por debajo o en el mínimo.' : 'Crea el primer bien o producto para comenzar.']));
    const deliveries = el('article', { className: 'section-block inventory-panel' }, [el('h3', { className: 'section-title' }, ['Entregas pendientes de recepción'])]);
    deliveries.append(pending.length ? table(['Despacho', 'Sede', 'Estado'], [...pending].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5).map(e => [`INV-${e.number}`, e.data.site, deliveryStatus(e, data.events)])) : el('p', { className: 'inventory-empty' }, ['No hay despachos pendientes de recepción.']));
    ui.append(el('div', { className: 'module-dashboard__charts' }, [alerts, deliveries]));
    const recent = [...data.events].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 6);
    const labels = { ingreso: 'Ingreso', borrador: 'Entrega preparada', despacho: 'Despacho', recepcion: 'Recepción', devolucion: 'Devolución', ajuste: 'Ajuste' };
    ui.append(el('article', { className: 'section-block inventory-panel' }, [el('h3', { className: 'section-title' }, ['Actividad reciente']), recent.length ? table(['Referencia', 'Fecha', 'Actividad', 'Ubicación / sede'], recent.map(e => [`INV-${e.number}`, new Date(e.created_at).toLocaleString('es-CO', { timeZone: 'America/Bogota' }), labels[e.type] || e.type, e.data.site || e.data.location || '—'])) : el('p', { className: 'inventory-empty' }, ['Los movimientos del contrato aparecerán aquí.'])]));
  }
  function render() {
    const actions = el('div', { className: 'inventory-actions' });
    if (view === 'products' && can(PERMS.MANAGE_INVENTORY)) actions.append(btn('Nuevo producto', productForm, true), btn('Registrar ingreso', () => movementForm('ingreso')), btn('Devolución', () => movementForm('devolucion')), btn('Ajuste', () => movementForm('ajuste')));
    if (view === 'deliveries' && can(PERMS.DISPATCH_INVENTORY)) actions.append(btn('Preparar entrega', () => movementForm('borrador'), true));
    actions.append(btn('Actualizar', load));
    const pending = data.events.filter(e => e.type === 'despacho' && pendingLines(e, data.events).some(l => l.quantity > 0));
    ui.replaceChildren(el('div', { className: 'module-dashboard__header' }, [el('div', {}, [el('p', { className: 'module-dashboard__eyebrow' }, [view === 'dashboard' ? 'Dashboard de módulo' : 'Inventarios']), el('h2', {}, [titles[view]]), el('p', { className: 'text-muted' }, [`Contrato ${contractFilterCode()} · ${data.products.length} productos · ${pending.length} entregas pendientes`])]), actions]));
    if (view === 'dashboard') {
      ui.querySelector('.module-dashboard__header').className = 'contract-demo__header';
      ui.querySelector('.module-dashboard__eyebrow').remove();

      renderDashboard(pending); return;
    }
    ui.append(el('div', { className: 'inventory-tabs', role: 'navigation', 'aria-label': 'Secciones del módulo' }, [...(view === 'products' ? ['Productos', 'Existencias', 'Ingresos y movimientos'] : ['Entregas', 'Actas']).map(name => {
        const b = btn(name, () => { tab = name; render(); }, tab === name); b.setAttribute('aria-current', String(tab === name)); return b;
      }), el('a', {
        className: 'btn',
        href: 'https://account.siigo.com/siigob2cco.onmicrosoft.com/b2c_1a_col_pd_ssosiigo/oauth2/v2.0/authorize?client_id=c0f95d00-a5b7-4cfc-a84c-7fc1be2a6720&redirect_uri=https%3A%2F%2Fsiigonube.siigo.com%2Fopenid-callback&response_type=code&scope=openid+profile+https%3A%2F%2Fsiigob2cco.onmicrosoft.com%2Fshell-pd-col%2Fbasic+offline_access&state=732e498176b54f6a87bdee11bce53b57&code_challenge=UCoBkS_9ePaLa6micYLnFSD9FMG3Gpbs7JQR6C4mIS4&code_challenge_method=S256&response_mode=fragment',
        target: '_blank',
        rel: 'noopener noreferrer',
        title: 'Abrir contabilidad en Siigo (nueva pestaña)',
        'aria-label': 'Contabilidad en Siigo (abre en una nueva pestaña)'
      }, [lucideInlineIcon('calculator', '▦'), 'Contabilidad'])]));
    let headers, rows;
    if (tab === 'Existencias') {
      headers = ['Producto', 'Presentación', 'Ubicación', 'Disponible', 'Mínimo', 'Estado'];
      rows = data.products.flatMap(p => {
        const balances = data.balances.filter(b => b.product_id === p.id);
        return (balances.length ? balances : [{ location: 'Sin ingresos', quantity: 0 }]).map(b => [p.name, p.unit, b.location, b.quantity, p.minimum, Number(b.quantity) <= Number(p.minimum) ? 'Existencia baja' : 'Disponible']);
      });
    } else if (tab === 'Productos') {
      headers = ['Código', 'Nombre', 'Presentación', 'Categoría', 'Tipo']; rows = data.products.map(p => [p.code, p.name, p.unit, p.category, p.kind]);
    } else if (tab === 'Ingresos y movimientos') {
      headers = ['Consecutivo', 'Fecha', 'Tipo', 'Ubicación / sede', 'Producto', 'Cantidad', 'Costo unitario', 'Proveedor / referencia'];
      rows = data.events.filter(e => e.type !== 'borrador').flatMap(e => e.data.lines.map(l => [`INV-${e.number}`, e.data.date || new Date(e.created_at).toLocaleDateString('es-CO', { timeZone: 'America/Bogota' }), e.type, e.data.location || e.data.site, l.name, l.quantity, l.cost ?? '', [e.data.supplier, e.data.reference].filter(Boolean).join(' · ')]));
    } else if (tab === 'Entregas') {
      headers = ['Consecutivo', 'Sede', 'Destinatario', 'Productos', 'Estado', 'Acciones'];
      rows = data.events.filter(e => ['borrador', 'despacho'].includes(e.type)).reverse().map(e => {
        const tools = el('div', { className: 'inventory-actions' }); const status = deliveryStatus(e, data.events);
        if (e.type === 'borrador' && status === 'Borrador' && can(PERMS.DISPATCH_INVENTORY)) tools.append(btn('Despachar', () => movementForm('despacho', e)));
        if (e.type === 'despacho' && pendingLines(e, data.events).some(l => l.quantity > 0) && can(PERMS.RECEIVE_INVENTORY)) tools.append(btn('Registrar recibido', () => receive(e)));
        if (e.type === 'despacho' && pendingLines(e, data.events).some(l => l.quantity > 0) && can(PERMS.MANAGE_INVENTORY)) tools.append(btn('Devolver pendientes', () => returnPending(e)));
        return [`INV-${e.number}`, e.data.site, e.data.recipient, e.data.lines.map(l => `${l.name}: ${l.quantity} ${l.unit}`).join('; '), status, tools];
      });
    } else {
      headers = ['Acta', 'Fecha', 'Sede', 'Recibe', 'Resultado', 'Documento'];
      rows = data.events.filter(e => e.type === 'recepcion').reverse().map(e => [`INV-${e.number}`, new Date(e.created_at).toLocaleString('es-CO'), e.data.site, e.data.receiver, e.data.result,
        el('div', { className: 'inventory-actions' }, [
          btn('Ver acta', () => { try { printInventoryAct(e, data.events.find(d => d.id === e.parent_id)); } catch (err) { alert(err.message); } }),
          btn('Descargar PDF', async () => { try { await downloadInventoryPdf(e, data.events.find(d => d.id === e.parent_id)); } catch (err) { alert(err.message); } })
        ])]);
    }
    const search = field('Buscar en esta sección', { type: 'search', required: false, placeholder: 'Producto, sede, persona o referencia…' });
    const listing = el('div'); let filtered = rows;
    const text = c => c?.nodeType ? c.textContent : String(c ?? '');
    function show() { const term = search.input.value.toLocaleLowerCase(); filtered = rows.filter(row => row.some(c => text(c).toLocaleLowerCase().includes(term))); listing.replaceChildren(table(headers, filtered)); }
    search.input.oninput = show; show();
    ui.append(el('div', { className: 'form-row inventory-filters' }, [search.node, btn('Exportar CSV', () => downloadCsv(`inventario-${contractFilterCode()}-${tab}.csv`, headers, filtered.map(row => row.map(text))))]), listing);
  }
  const unsub = subscribe('selectedContractCode', load); load();
  return () => { disposed = true; version++; unsub(); closeDialog(); };
}
