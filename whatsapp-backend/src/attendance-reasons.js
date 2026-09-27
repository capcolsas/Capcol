export const ATTENDANCE_REASON_MIN_LENGTH = 5;
export const ATTENDANCE_REASON_MAX_LENGTH = 200;
export const ATTENDANCE_REASON_LABELS = {
  entrada_tardia: 'llegada tarde',
  entrada_anticipada: 'ingreso temprano',
  salida_anticipada: 'salida temprano',
  salida_tardia: 'salida tarde'
};

export function attendanceReasonPrompt(request) {
  const at = new Date(request.event_at);
  const time = Number.isNaN(at.getTime()) ? '' : `\nRegistro: ${at.toLocaleString('es-CO', { timeZone: 'America/Bogota', hour12: false })}.`;
  return `Por favor escribe el motivo de: ${ATTENDANCE_REASON_LABELS[request.alert_type] || 'la marcación fuera de horario'}.${time}\nEscribe entre ${ATTENDANCE_REASON_MIN_LENGTH} y ${ATTENDANCE_REASON_MAX_LENGTH} caracteres.`;
}

export function validateAttendanceReason(message) {
  if (message?.type !== 'text') return { error: 'Responde con un mensaje de texto.' };
  const reason = String(message.text?.body || '').trim();
  const length = Array.from(reason).length;
  if (length < ATTENDANCE_REASON_MIN_LENGTH) return { error: `Escribe un motivo de al menos ${ATTENDANCE_REASON_MIN_LENGTH} caracteres.` };
  if (length > ATTENDANCE_REASON_MAX_LENGTH) return { error: `El motivo tiene ${length} caracteres. Escribe como máximo ${ATTENDANCE_REASON_MAX_LENGTH}.` };
  if (/^(hola|menu|menú)$/iu.test(reason)) return { error: 'Tienes una explicación pendiente para completar tu registro.' };
  return { reason };
}
