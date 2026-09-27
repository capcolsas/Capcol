// A self-contained PDF with rasterized pages keeps Unicode names and the drawn signature intact.
export async function downloadInventoryPdf(receipt, delivery) {
  const d = receipt.data, pages = []; let canvas, ctx, y;
  function page() {
    canvas = document.createElement('canvas'); canvas.width = 1240; canvas.height = 1754;
    ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1240, 1754);
    ctx.fillStyle = '#17212f'; ctx.font = '24px Arial'; y = 85; pages.push(canvas);
  }
  function line(text, bold = false) {
    ctx.font = `${bold ? 'bold ' : ''}24px Arial`;
    const words = String(text ?? '').split(/\s+/); let current = '';
    for (const word of words) {
      if (ctx.measureText(current + ' ' + word).width > 1060 && current) { write(current); current = ''; }
      current += (current ? ' ' : '') + word;
    }
    write(current); y += 10;
    function write(value) { if (y > 1640) { page(); ctx.font = `${bold ? 'bold ' : ''}24px Arial`; } ctx.fillText(value, 85, y); y += 34; }
  }
  page();
  line(`ACTA DE RECEPCIÓN INV-${receipt.number}`, true);
  line(`Contrato: ${d.contract?.name || ''} (${d.contract?.code || ''})`);
  line(`Cliente: ${d.contract?.client || ''} · NIT: ${d.contract?.nit || ''}`);
  line(`Sede: ${d.site || ''} · Despacho INV-${delivery?.number || ''}`);
  line(`Fecha: ${new Date(receipt.created_at).toLocaleString('es-CO', { timeZone: 'America/Bogota' })} (Colombia)`);
  line(`Entregado por: ${delivery?.data?.responsible || delivery?.created_by || ''}`);
  line('PRODUCTOS RECIBIDOS', true);
  d.lines.forEach(l => line(`${l.code} · ${l.name} · ${l.unit} · Cantidad recibida: ${l.quantity}`));
  line(`Resultado: ${{ satisfaccion: 'Recibido a satisfacción', novedades: 'Recibido con novedades', rechazado: 'Rechazado' }[d.result]}`, true);
  line(`Observaciones: ${d.notes || 'Sin observaciones'}`);
  line(`Recibe: ${d.receiver} · Documento: ${d.document} · Cargo: ${d.position}`);
  line(d.consent);
  if (y > 1300) page();
  const signature = new Image();
  await new Promise((resolve, reject) => { signature.onload = resolve; signature.onerror = () => reject(new Error('No se pudo cargar la firma.')); signature.src = d.signature; });
  ctx.drawImage(signature, 85, y, 720, 252); y += 275;
  line(`Registro: ${receipt.id}`); line(`Registrado por: ${receipt.created_by}`);
  const bytes = value => Uint8Array.from(value, c => c.charCodeAt(0));
  const chunks = [], offsets = [0]; let size = 0;
  const append = value => { const chunk = typeof value === 'string' ? bytes(value) : value; chunks.push(chunk); size += chunk.length; };
  function object(id, body, stream) {
    offsets[id] = size; append(`${id} 0 obj\n${body}`);
    if (stream) { append('\nstream\n'); append(stream); append('\nendstream'); }
    append('\nendobj\n');
  }
  append('%PDF-1.4\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${3+i*3} 0 R`).join(' ')}] >>`);
  pages.forEach((p, i) => {
    const id = 3+i*3;
    const jpg = bytes(atob(p.toDataURL('image/jpeg', .9).split(',')[1]));
    const content = bytes('q 595.28 0 0 841.89 0 0 cm /PageImage Do Q');
    object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /PageImage ${id+1} 0 R >> >> /Contents ${id+2} 0 R >>`);
    object(id+1, `<< /Type /XObject /Subtype /Image /Width 1240 /Height 1754 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>`, jpg);
    object(id+2, `<< /Length ${content.length} >>`, content);
  });
  const xref = size;
  append(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  offsets.slice(1).forEach(offset => append(`${String(offset).padStart(10, '0')} 00000 n \n`));
  append(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  const url = URL.createObjectURL(new Blob(chunks, { type: 'application/pdf' }));
  const a = document.createElement('a'); a.href = url; a.download = `Acta-INV-${receipt.number}.pdf`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
