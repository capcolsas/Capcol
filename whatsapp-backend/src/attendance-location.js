export const DEFAULT_ATTENDANCE_RADIUS_METERS = 200;

export function attendanceRadius(sede = {}) {
  const radius = Number(sede.qr_radius_meters ?? DEFAULT_ATTENDANCE_RADIUS_METERS);
  return Number.isFinite(radius) && radius > 0 ? radius : DEFAULT_ATTENDANCE_RADIUS_METERS;
}

function coordinate(value, limit) {
  if (value == null || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= limit ? number : null;
}

export function validateAttendanceLocation(location, sede) {
  const lat = coordinate(sede?.qr_latitude, 90);
  const lng = coordinate(sede?.qr_longitude, 180);
  const userLat = coordinate(location?.latitude, 90);
  const userLng = coordinate(location?.longitude, 180);
  if (lat === null || lng === null || (Math.abs(lat) < 0.000001 && Math.abs(lng) < 0.000001)) {
    return { ok: false, message: 'La sede no tiene una ubicacion valida configurada. Comunicate con el supervisor.' };
  }
  if (userLat === null || userLng === null) {
    return { ok: false, message: 'No pudimos leer tu ubicacion. Comparte tu ubicacion actual desde WhatsApp.' };
  }
  const rad = value => value * Math.PI / 180;
  const a = Math.sin(rad(userLat - lat) / 2) ** 2
    + Math.cos(rad(lat)) * Math.cos(rad(userLat)) * Math.sin(rad(userLng - lng) / 2) ** 2;
  const distance = 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, a)));
  const distanceMeters = Math.round(distance);
  const radius = attendanceRadius(sede);
  return distance <= radius
    ? { ok: true, distanceMeters }
    : { ok: false, distanceMeters, message: `Tu ubicacion esta a ${distanceMeters} metros de la sede. El maximo permitido es ${radius} metros. Comparte tu ubicacion actual cuando estes en la sede.` };
}

// Deliberately reject ambiguity instead of choosing a shift by proximity alone.
export function selectAttendanceShift(shifts, eventAt = new Date()) {
  const time = new Date(eventAt).getTime();
  const candidates = [...new Map(shifts.filter(shift => {
    if (!shift?.id || !['programado', 'abierto'].includes(shift.estado)) return false;
    const early = Number((shift.rule || shift.template)?.ventanaEntradaAntesMinutos || 0);
    return time >= new Date(shift.startsAt).getTime() - early * 60000
      && time < new Date(shift.endsAt).getTime();
  }).map(shift => [shift.id, shift])).values()];
  if (candidates.length > 1) throw new Error('attendance_shift_ambiguous');
  if (!candidates.length) throw new Error('attendance_shift_missing');
  return candidates[0];
}
