export function shiftPlanCapacity(sede = {}, assignments = [], templateId = '') {
  const planned = Math.max(0, Math.floor(Number(sede.numeroOperarios) || 0));
  const allocated = assignments
    .filter(row => row.estado !== 'inactivo' && row.sedeCodigo === sede.codigo && row.templateId !== templateId)
    .reduce((total, row) => total + Math.max(0, Number(row.operariosPlaneados) || 0), 0);
  return { planned, allocated, available: Math.max(0, planned - allocated) };
}

export function validateShiftPlanCapacity(sede, assignments, templateId, requested) {
  const capacity = shiftPlanCapacity(sede, assignments, templateId);
  const count = Number(requested);
  if (!Number.isInteger(count) || count < 0) throw new Error('El numero de operarios debe ser un entero mayor o igual a cero.');
  if (count + capacity.allocated > capacity.planned) {
    throw new Error(`${sede.nombre || sede.codigo}: ${capacity.planned} operarios planeados, ${capacity.allocated} en otros planes activos. Disponible para este plan: ${capacity.available}.`);
  }
  return capacity;
}
