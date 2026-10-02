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
// The shift rule's entry window is a review threshold (applied when the mark is registered), never a
// gate: an early entry is still matched to its shift and the registration RPC flags it for review.
// An upcoming shift is only considered within MAX_ENTRY_LOOKAHEAD_MINUTES so a mark made the evening
// before cannot silently attach to tomorrow's shift.
export const MAX_ENTRY_LOOKAHEAD_MINUTES = 12 * 60;

export function selectAttendanceShift(shifts, eventAt = new Date()) {
  const time = new Date(eventAt).getTime();
  const pending = [...new Map(shifts.filter(shift => shift?.id && ['programado', 'abierto'].includes(shift.estado)
    && time < new Date(shift.endsAt).getTime()).map(shift => [shift.id, shift])).values()];
  const active = pending.filter(shift => time >= new Date(shift.startsAt).getTime());
  let candidates = active;
  if (!candidates.length) {
    const upcoming = pending.filter(shift => new Date(shift.startsAt).getTime() - time <= MAX_ENTRY_LOOKAHEAD_MINUTES * 60000);
    const first = Math.min(...upcoming.map(shift => new Date(shift.startsAt).getTime()));
    candidates = upcoming.filter(shift => new Date(shift.startsAt).getTime() === first);
  }
  if (candidates.length > 1) throw new Error('attendance_shift_ambiguous');
  if (!candidates.length) throw new Error('attendance_shift_missing');
  return candidates[0];
}
