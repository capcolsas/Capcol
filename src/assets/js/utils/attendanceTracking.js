export function markingMethodLabel(method) {
  if (method === 'qr') return 'QR';
  if (method === 'location' || method === 'whatsapp') return 'WhatsApp';
  return 'Sin Identificar';
}

export function markingDateTime(value) {
  if (!value || Number.isNaN(new Date(value).getTime())) return '-';
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).format(new Date(value));
}

export function trackingKey(row) {
  return `${row.turnoId || 'legacy'}:${row.empleadoId || row.employeeId || row.documento || ''}`;
}

export function carryOverMarkings(rows, date) {
  return rows.filter(row => row.turnoId && row.entryAt && !row.entryLabel && (!row.exitAt
    || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date(row.exitAt)) === date));
}

export function mergeAttendanceTracking(attendance, markings, date) {
  const byKey = new Map(markings.map(row => [trackingKey(row), row]));
  const seen = new Set();
  const rows = attendance.map(row => {
    const key = trackingKey(row);
    seen.add(key);
    const tracking = byKey.get(key);
    // A novelty's report time is not an attendance entry.
    const novelty = String(row.novedadCodigo || row.novedad || '').trim();
    if (!row.asistio || tracking?.entryLabel || (/^\d+$/.test(novelty) && novelty !== '1')) return { ...row, tracking: null };
    return { ...row, tracking: tracking || {
      entryAt: row.reportedAt || row.createdAt, entryMethod: row.markingMethod || null,
      entryReason: row.employeeReason || row.earlyEntryReason || row.lateEntryReason || null,
      entryTimingAlert: row.timingAlertType || (row.earlyEntryMinutes > 0 ? 'entrada_anticipada' : row.lateEntryMinutes > 0 ? 'entrada_tardia' : null),
      entryControlRequired: row.timingControlRequired === true || row.earlyEntryMinutes > 0 || row.lateEntryMinutes > 0
    } };
  });
  for (const tracking of markings) {
    if (seen.has(trackingKey(tracking)) || !tracking.entryAt || tracking.entryLabel) continue;
    rows.push({ id: tracking.attendanceId || trackingKey(tracking), fecha: date, fechaOperativa: tracking.fechaOperativa || date,
      empleadoId: tracking.employeeId, documento: tracking.documento, nombre: tracking.nombre,
      sedeCodigo: tracking.sedeCodigo, sedeNombre: tracking.sedeNombre,
      contratoCodigo: tracking.contratoCodigo, contratoNombre: tracking.contratoNombre,
      turnoId: tracking.turnoId, asistio: true, novedad: '1', novedadCodigo: '1', tracking });
  }
  return rows;
}

export function phoneInconsistencyDetail(row = {}) {
  row = row || {};
  const details = [];
  if (row.entryPhoneDifferent) details.push(`Ingreso: ${row.entryPhone || '-'}`);
  if (row.exitPhoneDifferent) details.push(`Salida: ${row.exitPhone || '-'}`);
  return details.length
    ? `Celular diferente al registrado para la persona (${row.employeePhone || '-'}). ${details.join('. ')}.`
    : '';
}

export function markingSitesLabel(row = {}) {
  const tracking = row.tracking || row;
  const entry = tracking.entrySiteName || tracking.entrySiteCode;
  const exit = tracking.exitSiteName || tracking.exitSiteCode;
  return [entry ? `Sede de ingreso: ${entry}` : '', exit ? `Sede de salida: ${exit}` : ''].filter(Boolean).join(' · ');
}

export function markingPhoneDetail(tracking = {}, action = 'entry') {
  if (!tracking[`${action}At`]) return 'Sin registro';
  if (!tracking[`${action}Phone`]) return 'Sin Identificar: celular de la marcación no disponible';
  if (!tracking.employeePhone) return 'No se puede comparar: la persona no tiene celular registrado';
  return tracking[`${action}PhoneDifferent`]
    ? 'Celular diferente al registrado'
    : 'Sin diferencia detectada';
}

export function markingTimingDetail(tracking = {}, action = 'entry') {
  const type = tracking[`${action}TimingAlert`];
  const control = tracking[`${action}ControlRequired`] === true;
  if (!type && !control) return null;
  const labels = { entrada_tardia: 'Llegada tarde', entrada_anticipada: 'Ingreso temprano',
    salida_anticipada: 'Salida temprano', salida_tardia: 'Salida tarde' };
  const label = labels[type] || 'Marcación fuera de horario';
  const reason = tracking[`${action}Reason`] || 'Pendiente de explicación por WhatsApp.';
  const level = control ? 'control' : 'comment';
  const title = `${label} · ${control ? 'Atención del turno' : 'Solo explicación'}\nMotivo: ${reason}`;
  return { level, label, reason, title };
}
