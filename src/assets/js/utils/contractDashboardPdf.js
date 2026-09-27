// Canvas pages preserve Spanish text without external fonts or network requests.
export function downloadContractDashboardPdf(report) {
  const pages = [], width = 1240, height = 1754, margin = 60, contentWidth = width - margin * 2;
  const ink = '#172c43', muted = '#53677b', teal = '#087f8c';
  const generated = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
  let canvas, ctx, y;
  function font(size = 22, bold = false) { ctx.font = `${bold ? 'bold ' : ''}${size}px Arial`; }
  function lines(value, maxWidth, size = 22, bold = false) {
    font(size, bold);
    const result = [];
    let line = '';
    for (const word of String(value || '—').split(/\s+/)) {
      if (line && ctx.measureText(`${line} ${word}`).width > maxWidth) { result.push(line); line = ''; }
      for (const char of (line ? ' ' : '') + word) {
        if (ctx.measureText(line + char).width > maxWidth && line) { result.push(line); line = ''; }
        line += char;
      }
    }
    if (line) result.push(line);
    return result;
  }
  function drawLines(values, x, top, size = 22, bold = false, color = ink) {
    font(size, bold); ctx.fillStyle = color;
    values.forEach((value, i) => ctx.fillText(value, x, top + i * (size + 8)));
  }
  function newPage(section) {
    canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas no disponible');
    pages.push(canvas);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = teal; ctx.fillRect(0, 0, width, 12);
    drawLines(['RESUMEN DEL CONTRATO'], margin, 78, 32, true);
    const title = lines(`${report.code}${report.name ? ` · ${report.name}` : ''}`, contentWidth, 24, true);
    drawLines(title, margin, 120, 24, true); y = 120 + title.length * 32;
    drawLines([`Semana: ${report.from} al ${report.to} · Corte: ${report.to}`], margin, y + 12, 21, false, muted);
    y += 62;
    if (section) heading(section);
  }
  function ensure(space, section) { if (y + space > height - 120) newPage(section); }
  function heading(title) { drawLines([title], margin, y, 27, true, teal); y += 44; }
  function cards(items, columns, valueSize) {
    const gap = 16, cellWidth = (contentWidth - gap * (columns - 1)) / columns;
    for (let i = 0; i < items.length; i += columns) {
      const batch = items.slice(i, i + columns).map(item => ({
        label: lines(item.label, cellWidth - 32, 19, true),
        value: lines(item.value, cellWidth - 32, valueSize, true),
        detail: item.detail ? lines(item.detail, cellWidth - 32, 18) : []
      }));
      const rowHeight = Math.max(...batch.map(item => 40 + item.label.length * 27 + item.value.length * (valueSize + 8) + item.detail.length * 26));
      ensure(rowHeight + gap);
      batch.forEach((item, index) => {
        const x = margin + index * (cellWidth + gap);
        ctx.fillStyle = '#f0f6f8'; ctx.fillRect(x, y, cellWidth, rowHeight);
        let top = y + 28;
        drawLines(item.label, x + 16, top, 19, true, muted); top += item.label.length * 27 + 8;
        drawLines(item.value, x + 16, top, valueSize, true); top += item.value.length * (valueSize + 8);
        drawLines(item.detail, x + 16, top, 18, false, muted);
      });
      y += rowHeight + gap;
    }
    y += 20;
  }
  newPage();
  heading('Indicadores de la semana');
  cards(report.metrics, 5, 32);
  heading('Programación de turnos');
  if (report.schedule.length) {
    const widths = [232, 143, 149, 145, 138, 153, 160];
    function tableRow(row, header = false, total = false) {
      const cells = row.map((value, index) => lines(value, widths[index] - 18, 18, header || total));
      const rowHeight = Math.max(50, ...cells.map(cell => cell.length * 26 + 20));
      if (y + rowHeight > height - 120) {
        newPage('Programación de turnos (continuación)');
        if (!header) tableRow(report.schedule[0], true);
      }
      ctx.fillStyle = header ? ink : total ? '#e1f1f1' : row[0]?.includes('Hoy ·') ? '#fff1cf' : '#f5f8fa'; ctx.fillRect(margin, y, contentWidth, rowHeight - 2);
      let x = margin;
      cells.forEach((cell, index) => { drawLines(cell, x + 9, y + 29, 18, header || total, header ? '#ffffff' : ink); x += widths[index]; });
      y += rowHeight;
    }
    report.schedule.forEach((row, index) => tableRow(row, index === 0, index === report.schedule.length - 1));
  } else {
    const message = lines(report.scheduleMessage, contentWidth);
    drawLines(message, margin, y); y += message.length * 30;
  }
  y += 45;
  ensure(260);
  heading('Estado del contrato');
  cards(report.facts, 3, 23);
  newPage('Alertas y novedades');
  for (const alert of report.alerts) {
    const title = lines(alert.title, contentWidth - 44, 24, true);
    const detail = alert.detail ? lines(alert.detail, contentWidth - 44, 20) : [];
    const blockHeight = title.length * 32 + detail.length * 28 + 40;
    ensure(blockHeight + 18, 'Alertas y novedades (continuación)');
    ctx.fillStyle = '#f0f6f8'; ctx.fillRect(margin, y, contentWidth, blockHeight);
    ctx.fillStyle = teal; ctx.fillRect(margin, y, 5, blockHeight);
    drawLines(title, margin + 22, y + 32, 24, true);
    drawLines(detail, margin + 22, y + 42 + title.length * 32, 20, false, muted);
    y += blockHeight + 18;
  }
  pages.forEach((page, index) => {
    ctx = page.getContext('2d');
    ctx.fillStyle = '#d7e2e8'; ctx.fillRect(margin, height - 83, contentWidth, 1);
    drawLines([`Generado: ${generated} (Colombia)`], margin, height - 48, 18, false, muted);
    drawLines([`${index + 1} / ${pages.length}`], width - 125, height - 48, 18, false, muted);
  });
  const blob = canvasPagesPdf(pages);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Resumen-${String(report.code).replace(/[^a-zA-Z0-9_-]/g, '_')}-${report.to}.pdf`;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Same JPEG-page PDF format used by the inventory receipt export.
export function canvasPagesPdf(pages) {
  const bytes = value => Uint8Array.from(value, char => char.charCodeAt(0));
  const chunks = [], offsets = [0]; let size = 0;
  const append = value => { const chunk = typeof value === 'string' ? bytes(value) : value; chunks.push(chunk); size += chunk.length; };
  function object(id, body, stream) {
    offsets[id] = size; append(`${id} 0 obj\n${body}`);
    if (stream) { append('\nstream\n'); append(stream); append('\nendstream'); }
    append('\nendobj\n');
  }
  append('%PDF-1.4\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] >>`);
  pages.forEach((page, i) => {
    const id = 3 + i * 3;
    const jpg = bytes(atob(page.toDataURL('image/jpeg', 0.94).split(',')[1]));
    const content = bytes('q 595.28 0 0 841.89 0 0 cm /PageImage Do Q');
    object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /PageImage ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>`);
    object(id + 1, `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>`, jpg);
    object(id + 2, `<< /Length ${content.length} >>`, content);
  });
  const xref = size;
  append(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  offsets.slice(1).forEach(offset => append(`${String(offset).padStart(10, '0')} 00000 n \n`));
  append(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(chunks, { type: 'application/pdf' });
}
