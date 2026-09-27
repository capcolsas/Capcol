import { el } from './dom.js';

// Render only persisted receipt snapshots; never use editable product/catalog data.
export function printInventoryAct(receipt, delivery) {
  const win = window.open('', '_blank');
  if (!win) throw new Error('Permite abrir la ventana del acta para imprimir o guardar el PDF.');
  const d = receipt.data;
  const root = el('main', {}, [
    el('h1', {}, [`Acta de recepción INV-${receipt.number}`]),
    el('p', {}, [`Contrato: ${d.contract?.name || ''} (${d.contract?.code || ''})`]),
    el('p', {}, [`Cliente: ${d.contract?.client || ''} · NIT: ${d.contract?.nit || ''}`]),
    el('p', {}, [`Sede: ${d.site || ''} · Despacho INV-${delivery?.number || ''}`]),
    el('p', {}, [`Fecha: ${new Date(receipt.created_at).toLocaleString('es-CO', { timeZone: 'America/Bogota' })} (Colombia)`]),
    el('p', {}, [`Entregado por: ${delivery?.data?.responsible || delivery?.created_by || ''}`]),
    el('table', {}, [el('thead', {}, [el('tr', {}, ['Código', 'Producto', 'Presentación', 'Recibido'].map(t => el('th', {}, [t])))]),
      el('tbody', {}, d.lines.map(l => el('tr', {}, [l.code, l.name, l.unit, l.quantity].map(t => el('td', {}, [t])))))]),
    el('p', {}, [`Resultado: ${{ satisfaccion: 'Recibido a satisfacción', novedades: 'Recibido con novedades', rechazado: 'Rechazado' }[d.result]}`]),
    el('p', {}, [`Observaciones: ${d.notes || 'Sin observaciones'}`]),
    el('p', {}, [`Recibe: ${d.receiver} · Documento: ${d.document} · Cargo: ${d.position}`]),
    el('p', {}, [d.consent]),
    el('img', { src: d.signature, alt: 'Firma de quien recibe', width: 360, height: 140 }),
    el('p', {}, [`Registro: ${receipt.id} · Registrado por: ${receipt.created_by}`]),
    el('button', { onclick: () => win.print() }, ['Imprimir / guardar como PDF'])
  ]);
  win.document.title = `Acta INV-${receipt.number}`;
  const style = win.document.createElement('style');
  style.textContent = 'body{font:14px Arial;color:#17212f;margin:36px}table{width:100%;border-collapse:collapse}td,th{padding:10px;border:1px solid #bbb;text-align:left}img{object-fit:contain}tr{break-inside:avoid}@media print{button{display:none}}';
  win.document.head.append(style); win.document.body.append(root);
}
