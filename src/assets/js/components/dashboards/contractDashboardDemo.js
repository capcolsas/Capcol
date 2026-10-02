// Visual prototype fixtures. No operational records are read or written.
export const DEMO_WEEK = '2026-08-31';
export const DEMO_CONTRACT = { start: '2026-01-01', end: '2026-12-31', administrator: 'Andrea Velez', requirement: 156 };
export const DEMO_ALERTS = [
  { icon: 'bell-ring', tone: 'danger', title: '7 novedades abiertas', detail: 'Incidencias que requieren atencion', priority: 'Alta', lines: ['3 incapacidades pendientes de validar.', '2 cambios de turno solicitados.', '2 ausencias pendientes de justificar.'] },
  { icon: 'triangle-alert', tone: 'warning', title: '2 turnos prioritarios por cubrir', detail: 'Sede Centro y Sede Norte', priority: 'Media', lines: ['Sede Centro: jornada de 06:00 a 14:00.', 'Sede Norte: jornada de 14:00 a 22:00.', 'Estos turnos forman parte de los pendientes de la semana.'] },
  { icon: 'file-clock', tone: 'blue', title: '3 documentos proximos a vencer', detail: 'Documentacion del personal', priority: 'Baja', lines: ['Laura Martinez: certificado de formacion.', 'Carlos Ramirez: examen ocupacional.', 'Diana Lopez: certificado de competencias.'] },
  { icon: 'calendar-check', tone: 'teal', title: '4 recordatorios programados', detail: 'Compromisos de esta semana', lines: ['Lunes: revision de programacion.', 'Martes: entrega de dotacion.', 'Jueves: visita de supervision.', 'Viernes: cierre de novedades.'] },
  { icon: 'users', tone: 'teal', title: 'Induccion de personal', detail: 'Miercoles · Sede Norte', lines: ['Induccion programada para dos nuevos colaboradores.'] },
  { icon: 'clipboard-check', tone: 'green', title: 'Revision de cobertura', detail: 'Viernes · Equipo de operaciones', lines: ['Validar la programacion de la siguiente semana.'] }
];
export function dateAt(iso, offset = 0) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date;
}
export function isoDate(date) { return date.toISOString().slice(0, 10); }
// Weeks run Sunday to Saturday, matching public.rotation_week_start and weekStartIso.
export function sundayOf(iso) {
  const date = dateAt(iso);
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return isoDate(date);
}
export function demoWeek(start) {
  const offset = Math.round((dateAt(start) - dateAt(DEMO_WEEK)) / 604800000);
  const variation = ((offset % 3) + 3) % 3;
  return [24, 24, 24, 24, 24, 18, 18].map((planned, index) => {
    const confirmed = [23, 22, 23, 24, 23, 17, 10][index] - (index === 0 ? variation : 0);
    const attended = confirmed - (index === 2 ? 0 : 1);
    return { date: isoDate(dateAt(start, index)), planned, confirmed, attended, pending: planned - confirmed };
  });
}
