// Cupos y cobertura de una rotacion: cuantas personas necesita cada plan y cuantas pone la rotacion cada dia.

const MAX_CYCLE_STEPS = 28;

// Cupos planeados por plan: el mayor numero de operarios planeados entre sus turnos generados (null si no hay turnos).
export function quotasByTemplate(shifts = [], templateIds = []) {
  const quotas = new Map(templateIds.map((id) => [id, null]));
  for (const shift of shifts || []) {
    if (!quotas.has(shift.templateId)) continue;
    const planned = Math.max(0, Number(shift.operariosPlaneados) || 0);
    if (planned > (quotas.get(shift.templateId) ?? 0)) quotas.set(shift.templateId, planned);
  }
  return quotas;
}

// Arma el ciclo repitiendo cada plan tantas veces como cupos tenga (manana 1, tarde 1, noche 2 -> M, T, N, N) y
// asigna a cada persona una posicion distinta: en cada etapa el reparto por plan coincide con los cupos.
//   planIds: planes en el orden deseado; quotas: Map plan -> cupos (null/0 se asume 1); staff: personas disponibles.
export function buildCycleByQuota({ planIds = [], quotas = new Map(), staff = 0, maxSteps = MAX_CYCLE_STEPS }) {
  const plans = [...new Set(planIds.filter(Boolean))];
  const assumed = [];
  const cycle = [];
  for (const id of plans) {
    const quota = Number(quotas.get(id)) || 0;
    if (!quota) assumed.push(id);
    for (let i = 0; i < Math.max(1, quota); i += 1) cycle.push(id);
  }
  const truncated = cycle.length > maxSteps;
  if (truncated) cycle.length = maxSteps;
  const length = cycle.length;
  const placed = Math.min(staff, length);
  return {
    cycle,
    length,
    // Posicion inicial de cada una de las primeras `placed` personas.
    offsets: Array.from({ length: placed }, (_, i) => i),
    missing: Math.max(0, length - staff),
    extra: Math.max(0, staff - length),
    assumed,
    truncated
  };
}

// Cobertura por semana y plan: cupos requeridos (turnos generados) frente a personas de la rotacion en cada dia.
//   weeks: salida de buildRotationWeeks; shifts: turnos generados (templateId, fechaOperativa, operariosPlaneados) o null.
export function buildCoverage(weeks, shifts, templateIds) {
  if (!shifts) return null;
  const required = new Map();
  for (const shift of shifts) {
    if (!templateIds.includes(shift.templateId) || !shift.fechaOperativa) continue;
    const key = `${shift.templateId}|${shift.fechaOperativa}`;
    required.set(key, Math.max(required.get(key) || 0, Math.max(0, Number(shift.operariosPlaneados) || 0)));
  }
  return weeks.map((week) => templateIds.map((templateId) => ({
    templateId,
    days: week.days.map((date) => {
      const need = required.get(`${templateId}|${date}`);
      const covered = week.rows.filter((row) => row.cells.some((cell) => cell.date === date && cell.kind === 'work' && cell.template === templateId)).length;
      return { date, required: need ?? null, covered };
    })
  })).filter((plan) => plan.days.some((day) => day.required !== null || day.covered > 0)));
}

// 'ok' cubierto, 'falta' faltan personas, 'sobra' mas personas que cupos, 'sin' sin turno generado ese dia.
export function coverageStatus(day) {
  if (day.required === null) return day.covered ? 'sobra' : 'sin';
  if (day.covered < day.required) return 'falta';
  if (day.covered > day.required) return 'sobra';
  return 'ok';
}
