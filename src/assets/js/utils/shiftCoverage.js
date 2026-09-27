const clean = value => String(value || '').trim();
const empty = () => ({ assigned: 0, attended: 0, replaced: 0, absent: 0, pending: 0, covered: 0 });
const attended = row => row?.asistio === true || Boolean(row?.entradaAt);
const isReplacement = row => row?.decisionCobertura === 'reemplazo'
  || Boolean(row?.reemplazadoPorEmployeeId || row?.reemplazadoPorDocumento || row?.reemplazadoPorNombre);
const isUnjustified = row => {
  const code = clean(row?.novedadCodigo);
  const name = clean(row?.novedadNombre).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  return code === '8' || name === 'AUSENCIA NO JUSTIFICADA'
    || (row?.closed === true && row?.estadoTurno === 'sin_registro' && !code && !name && !row?.sourceIncapacityId);
};

// Each original person/shift assignment is one slot. A replacement covers that
// slot; it does not create a second slot even when it has its own assignment.
export function summarizeShiftCoverage(dates, shifts = [], assignments = [], statuses = []) {
  const rows = dates.map(date => ({ date, ...empty() }));
  const byDate = new Map(rows.map(row => [row.date, row]));
  const absencePeople = new Map();
  const unjustifiedPeople = new Map();
  const siteDays = new Map();
  const byShift = new Map(shifts.filter(shift => shift.estado !== 'cancelado' && byDate.has(shift.fechaOperativa))
    .map(shift => [shift.id, { shift, assignments: [], statuses: [] }]));
  for (const row of assignments) {
    if (row.estado !== 'cancelado') byShift.get(row.scheduledShiftId)?.assignments.push(row);
  }
  for (const row of statuses) {
    if (row.estadoTurno !== 'cancelado') byShift.get(row.scheduledShiftId)?.statuses.push(row);
  }
  for (const { shift, assignments: assigned, statuses: observed } of byShift.values()) {
    const day = empty();
    const byId = new Map(observed.filter(row => clean(row.employeeId)).map(row => [clean(row.employeeId), row]));
    const byDoc = new Map(observed.filter(row => clean(row.documento)).map(row => [clean(row.documento), row]));
    const statusFor = row => byId.get(clean(row.employeeId)) || byDoc.get(clean(row.documento));
    const replacementIds = new Set(), replacementDocs = new Set();
    for (const assignment of assigned) {
      const status = statusFor(assignment);
      if (!status || attended(status) || !isReplacement(status)) continue;
      if (clean(status.reemplazadoPorEmployeeId)) replacementIds.add(clean(status.reemplazadoPorEmployeeId));
      if (clean(status.reemplazadoPorDocumento)) replacementDocs.add(clean(status.reemplazadoPorDocumento));
    }
    const seen = new Set();
    for (const assignment of assigned) {
      const status = statusFor(assignment);
      const id = clean(assignment.employeeId || status?.employeeId);
      const doc = clean(assignment.documento || status?.documento);
      const key = doc ? `doc:${doc}` : id ? `id:${id}` : `assignment:${assignment.id}`;
      if (seen.has(key) || replacementIds.has(id) || replacementDocs.has(doc)) continue;
      seen.add(key);
      day.assigned++;
      let absenceType = null;
      if (attended(status)) day.attended++;
      else if (isReplacement(status)) { day.replaced++; absenceType = 'replaced'; }
      else if (status && (status.closed || ['ausente_con_novedad', 'ausente_sin_reemplazo'].includes(status.estadoTurno))) { day.absent++; absenceType = 'absent'; }
      else day.pending++;
      if (absenceType) {
        if (!absencePeople.has(key)) absencePeople.set(key, {
          employeeId: id, documento: doc, nombre: status?.nombre || assignment.nombre || 'Nombre no registrado',
          total: 0, replaced: 0, absent: 0, dates: new Set()
        });
        const person = absencePeople.get(key);
        person.total++;
        person[absenceType]++;
        person.dates.add(shift.fechaOperativa);
        if (isUnjustified(status)) {
          if (!unjustifiedPeople.has(key)) unjustifiedPeople.set(key, {
            employeeId: id, documento: doc, nombre: person.nombre, total: 0, replaced: 0, absent: 0, dates: new Set()
          });
          const unjustified = unjustifiedPeople.get(key);
          unjustified.total++;
          unjustified[absenceType]++;
          unjustified.dates.add(shift.fechaOperativa);
        }
      }
    }
    day.covered = day.attended + day.replaced;
    const dateTotal = byDate.get(shift.fechaOperativa);
    for (const key of Object.keys(day)) dateTotal[key] += day[key];
    const siteCode = clean(shift.sedeCodigo);
    const siteName = clean(shift.sedeNombre);
    if (siteCode || siteName) {
      const siteKey = JSON.stringify([shift.fechaOperativa, siteCode || siteName]);
      if (!siteDays.has(siteKey)) siteDays.set(siteKey, {
        date: shift.fechaOperativa, sedeCodigo: siteCode, sedeNombre: siteName || siteCode, ...empty()
      });
      const siteDay = siteDays.get(siteKey);
      for (const key of Object.keys(day)) siteDay[key] += day[key];
    }
  }
  const total = rows.reduce((sum, row) => {
    for (const key of Object.keys(sum)) sum[key] += row[key];
    return sum;
  }, empty());
  const unjustifiedRows = [...unjustifiedPeople.values()]
    .map(person => ({ ...person, dates: [...person.dates].sort() }))
    .sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre) || a.documento.localeCompare(b.documento));
  const unattendedSiteDays = [...siteDays.values()]
    .filter(day => day.assigned > 0 && day.absent === day.assigned)
    .sort((a, b) => a.date.localeCompare(b.date) || a.sedeNombre.localeCompare(b.sedeNombre) || a.sedeCodigo.localeCompare(b.sedeCodigo));
  return { rows, total, unattendedSiteDays,
    unattendedDayCount: new Set(unattendedSiteDays.map(day => day.date)).size,
    unjustifiedPeople: unjustifiedRows,
    unjustifiedCount: unjustifiedRows.reduce((sum, person) => sum + person.total, 0),
    absencePeople: [...absencePeople.values()]
    .map(person => ({ ...person, dates: [...person.dates].sort() }))
    .sort((a, b) => b.absent - a.absent || b.total - a.total || a.nombre.localeCompare(b.nombre) || a.documento.localeCompare(b.documento)) };
}
