import { addIsoDays } from './shiftCalendar.js';
import { cycleEntries } from './rotationCycle.js';

// Jornada maxima semanal ordinaria en Colombia, reduccion gradual de la Ley 2101 de 2021.
// Cada par es [vigente desde, horas por semana]; antes de 2023-07-15 rigen 48 h.
export const COLOMBIA_WEEKLY_LIMITS = [['2026-07-15', 42], ['2025-07-15', 44], ['2024-07-15', 46], ['2023-07-15', 47]];
export const COLOMBIA_LEGACY_WEEKLY_LIMIT = 48;
// Tope legal de horas extra por semana (Art. 22 Ley 50 de 1990).
export const COLOMBIA_MAX_WEEKLY_OVERTIME = 12;
// Resultados de la validacion que no representan un problema para la celda.
export const NEUTRAL_RESULTS = new Set(['Por asignar', 'Asignacion existente', 'Historico o iniciado', 'Descanso', 'Descanso semanal', 'Descanso compensatorio', 'Descanso relevo', 'Por asignar (sobrante)', 'Sin turno generado']);

const BOGOTA_OFFSET_MS = 5 * 3600000;
const DAY_NAMES = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

export function colombiaWeeklyLimit(isoDate) {
  const found = COLOMBIA_WEEKLY_LIMITS.find(([from]) => String(isoDate) >= from);
  return found ? found[1] : COLOMBIA_LEGACY_WEEKLY_LIMIT;
}

export function weekStartIso(isoDate) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return '';
  return addIsoDays(isoDate, -date.getUTCDay());
}

// Minutos que aporta un turno a cada dia calendario de America/Bogota (UTC-5, sin horario de verano).
export function minutesByLocalDay(startsAt, endsAt) {
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  const out = new Map();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return out;
  let cursor = start;
  while (cursor < end) {
    const day = new Date(cursor - BOGOTA_OFFSET_MS).toISOString().slice(0, 10);
    const nextMidnight = Date.parse(`${day}T00:00:00-05:00`) + 86400000;
    const segmentEnd = Math.min(end, nextMidnight);
    out.set(day, (out.get(day) || 0) + Math.round((segmentEnd - cursor) / 60000));
    cursor = segmentEnd;
  }
  return out;
}

export function formatHours(minutes) {
  return `${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 }).format((Number(minutes) || 0) / 60)} h`;
}

export function formatTime(isoTimestamp) {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return '--:--';
  return new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

export function weekdayName(isoDate) {
  return DAY_NAMES[new Date(`${isoDate}T00:00:00Z`).getUTCDay()];
}

export function formatDayHeader(isoDate) {
  return `${weekdayName(isoDate)} ${new Date(`${isoDate}T00:00:00Z`).getUTCDate()}`;
}

export function formatRange(from, to) {
  const fmt = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `${fmt.format(new Date(`${from}T00:00:00Z`)).replace('.', '')} al ${fmt.format(new Date(`${to}T00:00:00Z`)).replace('.', '')}`;
}

const REST_RESULT = /^(?:Revisar asignacion existente: )?Descanso/;
export const isRestResult = (result) => REST_RESULT.test(String(result || ''));
// 'Descanso semanal' | 'Descanso compensatorio' | 'Descanso' (del ciclo), segun lo que calcula el servidor.
export function restTypeFromResult(result) {
  const text = String(result || '');
  return text.includes('compensatorio') ? 'compensatorio' : text.includes('semanal') ? 'semanal' : text.includes('relevo') ? 'relevo' : 'ciclo';
}

// Arma semanas completas (lunes a domingo) con horas netas por turno, total semanal, descansos y alertas.
//   results: filas de preview_shift_rotation (tambien indican el tipo de descanso de cada dia);
//   shifts: turnos generados (id, startsAt, endsAt, almuerzoMinutos) o null si no se pudieron consultar;
//   overtime: horas extra ya registradas (shift_overtime_weeks).
export function buildRotationWeeks({ config, from, results = [], shifts = null, overtime = [], weeks = 2 }) {
  const days = cycleEntries(config, from, weeks * 7);
  const shiftsById = shifts ? new Map(shifts.map((s) => [s.id, s])) : null;
  const checksByCell = new Map();
  for (const item of results) {
    const key = `${item.fecha}|${item.employee_id}`;
    if (!checksByCell.has(key)) checksByCell.set(key, []);
    checksByCell.get(key).push(item);
  }
  const recorded = new Map(overtime.map((o) => [`${o.employee_id}|${String(o.week_start).slice(0, 10)}`, o]));
  const weeklyRest = config.rules?.weeklyRestDays || {};
  const relievers = new Set(config.members.filter((m) => m.reliever).map((m) => m.employee));
  const weekday = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();

  // Primero cada empleado en toda la ventana: un turno nocturno reparte sus minutos entre dos dias,
  // que pueden caer en semanas distintas (domingo a lunes).
  const perMember = config.members.map((member) => {
    const minutesByDay = new Map();
    const cells = days.map((day) => {
      const entry = day.entries.find((e) => e.employee === member.employee);
      const date = day.date;
      const checks = checksByCell.get(`${date}|${member.employee}`) || [];
      if (entry.template === undefined) return { date, kind: 'outside', alerts: [] };
      const restCheck = checks.find((c) => c.template_id == null && isRestResult(c.result));
      if (entry.template === null || restCheck) {
        const legacyWeekly = String(weeklyRest[member.employee]) === String(weekday(date));
        const restType = restCheck ? restTypeFromResult(restCheck.result) : legacyWeekly ? 'semanal' : 'ciclo';
        return { date, kind: 'rest', restType, alerts: checks.map((c) => c.result).filter((r) => r.startsWith('Revisar')) };
      }
      const shiftChecks = checks.filter((c) => c.shift_id);
      const known = shiftsById ? shiftChecks.map((c) => shiftsById.get(c.shift_id)).filter(Boolean) : [];
      const complete = Boolean(shiftsById) && shiftChecks.length > 0 && known.length === shiftChecks.length;
      const cellShifts = known.map((s) => {
        const grossMinutes = Math.round((Date.parse(s.endsAt) - Date.parse(s.startsAt)) / 60000);
        const lunchMinutes = Math.min(grossMinutes, Math.max(0, Number(s.almuerzoMinutos) || 0));
        return { starts: s.startsAt, ends: s.endsAt, grossMinutes, lunchMinutes, minutes: grossMinutes - lunchMinutes };
      });
      // Todo el turno cuenta en el dia en que inicia (tambien los turnos nocturnos que terminan al dia siguiente),
      // para que la suma de las celdas coincida con el total de la semana.
      minutesByDay.set(date, (minutesByDay.get(date) || 0) + cellShifts.reduce((sum, shift) => sum + shift.minutes, 0));
      const minutes = cellShifts.reduce((sum, shift) => sum + shift.minutes, 0);
      return {
        date, kind: 'work', template: entry.template, unknown: !complete, shifts: cellShifts, minutes,
        surplus: checks.some((c) => c.result === 'Por asignar (sobrante)'),
        alerts: checks.map((c) => c.result).filter((r) => !NEUTRAL_RESULTS.has(r))
      };
    });
    return { employee: member.employee, cells, minutesByDay };
  });

  return Array.from({ length: weeks }, (_, w) => {
    const weekDays = days.slice(w * 7, w * 7 + 7).map((d) => d.date);
    const start = weekDays[0];
    const end = weekDays[6];
    const rows = perMember.map(({ employee, cells, minutesByDay }) => {
      const weekCells = cells.slice(w * 7, w * 7 + 7);
      const isReliever = relievers.has(employee);
      const restDates = weekCells.filter((c) => c.kind === 'rest').map((c) => c.date);
      // Los descansos semanal y compensatorio no cuentan hacia el limite semanal: sus horas (p. ej. el tramo de un
      // turno nocturno que termina ese dia) se informan aparte. El descanso del ciclo si suma lo trabajado.
      const excluded = weekCells.filter((c) => c.kind === 'rest' && c.restType !== 'ciclo').map((c) => c.date);
      let minutes = 0;
      let restMinutes = 0;
      for (const date of weekDays) {
        const dayMinutes = minutesByDay.get(date) || 0;
        if (excluded.includes(date)) restMinutes += dayMinutes;
        else minutes += dayMinutes;
      }
      return {
        employee, cells: weekCells,
        minutes, restMinutes,
        incomplete: weekCells.some((c) => c.kind === 'work' && c.unknown),
        workDays: weekCells.filter((c) => c.kind === 'work').length,
        restDates, reliever: isReliever,
        recorded: recorded.get(`${employee}|${start}`) || null
      };
    });
    // Cobertura: cuantas personas descansan cada dia y si todo el equipo comparte un unico dia de descanso.
    // Los dias libres de un relevo no son descansos de cobertura: solo cuentan los titulares.
    const holders = rows.filter((r) => !r.reliever);
    const restCounts = weekDays.map((date) => holders.filter((r) => r.restDates.includes(date)).length);
    const restDays = holders.map((r) => r.restDates).filter((dates) => dates.length);
    const sameRestDay = holders.length > 1 && restDays.length === holders.length && restDays.every((dates) => dates.length === 1 && dates[0] === restDays[0][0]);
    return { start, end, limit: colombiaWeeklyLimit(start), days: weekDays, rows, restCounts, sameRestDay };
  });
}

// Estado de un empleado en una semana frente al limite legal.
export function summarizeWeekRow(row, limit) {
  const limitMinutes = limit * 60;
  const overtimeMinutes = Math.max(0, row.minutes - limitMinutes);
  const remainingMinutes = Math.max(0, limitMinutes - row.minutes);
  const kind = overtimeMinutes > 0 ? 'extra' : remainingMinutes === 0 && row.minutes > 0 ? 'completo' : 'faltan';
  let label;
  if (kind === 'extra') {
    label = `+${formatHours(overtimeMinutes)} extras sobre ${limit} h`;
    if (overtimeMinutes > COLOMBIA_MAX_WEEKLY_OVERTIME * 60) label += ` · supera el maximo de ${COLOMBIA_MAX_WEEKLY_OVERTIME} h extras`;
  } else if (kind === 'completo') label = `Jornada completa (${limit} h)`;
  else if (row.reliever) label = row.minutes ? `Relevo: cubre ${formatHours(row.minutes)}` : 'Relevo: sin descansos por cubrir';
  else label = `Faltan ${formatHours(remainingMinutes)} para ${limit} h`;
  return {
    kind, label, limitMinutes, overtimeMinutes, remainingMinutes,
    overMaxOvertime: overtimeMinutes > COLOMBIA_MAX_WEEKLY_OVERTIME * 60,
    noRest: row.workDays > 0 && row.restDates.length === 0
  };
}

// Dias elegibles para el descanso semanal: de lunes a sabado, para mantener cubierto el servicio del domingo.
export const DEFAULT_REST_DAYS = [1, 2, 3, 4, 5, 6];

function lexLess(a, b) {
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

// Reparte un dia de descanso semanal por empleado, lo mas parejo posible entre los dias elegibles y dentro
// de cada equipo (misma etapa inicial): asi el plan de cada equipo no queda sin personal ningun dia.
//   members: [{ employee, offset }] en el orden deseado; devuelve { [employee]: diaDeLaSemana (0=domingo) }.
export function distributeWeeklyRestDays(members, days = DEFAULT_REST_DAYS) {
  const totals = new Map(days.map((day) => [day, 0]));
  const result = {};
  const teams = [...new Set(members.map((m) => m.offset))].sort((a, b) => a - b);
  teams.forEach((offset, teamIndex) => {
    const inTeam = new Map(days.map((day) => [day, 0]));
    for (const member of members.filter((m) => m.offset === offset)) {
      let best = null;
      days.forEach((day, index) => {
        const score = [totals.get(day), inTeam.get(day), (index + teamIndex) % days.length];
        if (!best || lexLess(score, best.score)) best = { day, score };
      });
      result[member.employee] = best.day;
      totals.set(best.day, totals.get(best.day) + 1);
      inTeam.set(best.day, inTeam.get(best.day) + 1);
    }
  });
  return result;
}

// Jornada diaria ordinaria en Colombia: 7 h netas de lunes a sabado (42 h por semana).
export const STANDARD_DAILY_MINUTES = 420;

// Minutos netos de un horario de plan (hora de inicio y fin, con cruce de dia opcional) descontando el almuerzo.
export function netRuleMinutes(horaInicio, horaFin, cruzaDia = false, almuerzoMinutos = 0) {
  const toMinutes = (value) => { const match = /^(\d{2}):(\d{2})/.exec(String(value || '')); return match ? Number(match[1]) * 60 + Number(match[2]) : null; };
  const start = toMinutes(horaInicio);
  const end = toMinutes(horaFin);
  if (start === null || end === null) return null;
  const span = end - start + (cruzaDia ? 1440 : 0);
  if (span <= 0) return null;
  return Math.max(0, span - Math.max(0, Number(almuerzoMinutos) || 0));
}
