export function pendingLines(delivery, events) {
  return delivery.data.lines.map(line => {
    const received = events.filter(e => ['recepcion', 'devolucion'].includes(e.type) && e.parent_id === delivery.id)
      .flatMap(e => e.data.lines).filter(l => l.product === line.product)
      .reduce((sum, l) => sum + Number(l.quantity), 0);
    return { ...line, quantity: Math.max(0, Math.round((Number(line.quantity) - received) * 1000) / 1000) };
  });
}
export function deliveryStatus(delivery, events) {
  if (delivery.type === 'borrador') return events.some(e => e.parent_id === delivery.id && e.type === 'despacho') ? 'Despachado' : 'Borrador';
  const receptions = events.filter(e => e.type === 'recepcion' && e.parent_id === delivery.id);
  if (!pendingLines(delivery, events).some(l => l.quantity > 0)) return events.some(e => e.type === 'devolucion' && e.parent_id === delivery.id) ? 'Cerrado con devolución' : 'Recibido';
  if (receptions.some(e => e.data.result === 'rechazado')) return 'Pendiente · rechazo registrado';
  return receptions.length ? 'Recepción parcial / con novedades' : 'Pendiente de recepción';
}
export function downloadCsv(name, headers, rows) {
  const cell = value => '"' + String(value ?? '').replace(/^[=+@-]/, "'$&").replaceAll('"', '""') + '"';
  const blob = new Blob(['\uFEFF', [headers, ...rows].map(row => row.map(cell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
