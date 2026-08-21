const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const BOGOTA_OFFSET = '-05:00';
const colombiaHolidayCache = new Map();

export function isIsoDate(value) {
  return ISO_DATE_RE.test(String(value || '').trim());
}

export function todayBogota() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
}

export function addIsoDays(isoDate, days) {
  const date = parseIsoDateUtc(isoDate);
  if (!date) return '';
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return formatUtcDate(date);
}

export function listIsoDatesInRange(dateFrom, dateTo, maxDays = 370) {
  const from = String(dateFrom || '').trim();
  const to = String(dateTo || '').trim();
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) {
    throw new Error('Selecciona un rango de fechas valido.');
  }
  const out = [];
  let cursor = from;
  while (cursor <= to) {
    out.push(cursor);
    if (out.length > maxDays) throw new Error(`El rango no puede superar ${maxDays} dias.`);
    cursor = addIsoDays(cursor, 1);
  }
  return out;
}

export function isColombiaHolidayDate(isoDate) {
  const day = String(isoDate || '').trim();
  if (!isIsoDate(day)) return false;
  return getColombiaHolidaySet(Number(day.slice(0, 4))).has(day);
}

export function shiftRuleAppliesOnDate(rule = {}, isoDate = '') {
  const day = String(isoDate || '').trim();
  if (!isIsoDate(day) || String(rule.estado || 'activo') === 'inactivo') return false;

  const isHoliday = isColombiaHolidayDate(day);
  if (rule.tipoDia === 'festivo') return isHoliday;

  const expectedDow = String(rule.diaSemana || '').trim();
  if (!expectedDow || String(weekdayForIsoDate(day)) !== expectedDow) return false;
  if (isHoliday && String(rule.festivoModo || 'excluir') !== 'normal') return false;

  const frecuencia = String(rule.frecuenciaTipo || 'todos').trim();
  if (frecuencia === 'cada_n_semanas') return appliesEveryNWeeks(rule, day);
  if (frecuencia === 'mensual') return appliesMonthly(rule, day);
  return true;
}

export function buildScheduledShiftCandidate({ template = {}, site = {}, rule = {}, fechaOperativa = '' } = {}) {
  const day = String(fechaOperativa || '').trim();
  const startTime = normalizeTime(rule.horaInicio);
  const endTime = normalizeTime(rule.horaFin);
  if (!isIsoDate(day) || !startTime || !endTime) return null;

  const endDate = rule.cruzaDia === true ? addIsoDays(day, 1) : day;
  const startsAt = bogotaLocalToUtcIso(day, startTime);
  const endsAt = bogotaLocalToUtcIso(endDate, endTime);
  if (!startsAt || !endsAt || new Date(endsAt).getTime() <= new Date(startsAt).getTime()) return null;

  return {
    templateId: template.id || site.templateId || rule.templateId || null,
    templateRuleId: rule.id || null,
    fechaOperativa: day,
    sedeCodigo: site.sedeCodigo || null,
    sedeNombre: site.sedeNombre || null,
    nombre: [template.nombre, rule.nombre].map((value) => String(value || '').trim()).filter(Boolean).join(' - ') || 'Turno',
    startsAt,
    endsAt,
    estado: 'programado',
    operariosPlaneados: Number(site.operariosPlaneados || 0)
  };
}

function appliesEveryNWeeks(rule = {}, isoDate = '') {
  const anchor = String(rule.fechaAncla || '').trim();
  const every = Math.max(1, Number(rule.frecuenciaSemanas || 1));
  if (!isIsoDate(anchor) || every < 2 || isoDate < anchor) return false;
  const diffDays = Math.floor((parseIsoDateUtc(isoDate).getTime() - parseIsoDateUtc(anchor).getTime()) / DAY_MS);
  const diffWeeks = Math.floor(diffDays / 7);
  return diffWeeks % every === 0;
}

function appliesMonthly(rule = {}, isoDate = '') {
  const expected = Number(rule.semanaMes || 0);
  if (![1, 2, 3, 4, -1].includes(expected)) return false;
  if (expected === -1) {
    const nextWeek = addIsoDays(isoDate, 7);
    return nextWeek.slice(0, 7) !== isoDate.slice(0, 7);
  }
  const dayOfMonth = Number(isoDate.slice(8, 10));
  return Math.floor((dayOfMonth - 1) / 7) + 1 === expected;
}

function parseIsoDateUtc(isoDate) {
  if (!isIsoDate(isoDate)) return null;
  const [year, month, day] = String(isoDate).split('-').map((value) => Number(value));
  return new Date(Date.UTC(year, month - 1, day));
}

function weekdayForIsoDate(isoDate) {
  return parseIsoDateUtc(isoDate)?.getUTCDay();
}

function normalizeTime(value) {
  const match = String(value || '').trim().match(/^(\d{2}):(\d{2})/);
  if (!match) return '';
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return '';
  return `${match[1]}:${match[2]}`;
}

function bogotaLocalToUtcIso(isoDate, hhmm) {
  const date = new Date(`${isoDate}T${hhmm}:00${BOGOTA_OFFSET}`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function makeUtcDate(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day));
}

function formatUtcDate(date) {
  return date.toISOString().slice(0, 10);
}

function easterSundayUtc(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return makeUtcDate(year, month, day);
}

function moveToFollowingMondayUtc(date) {
  const isoDow = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  if (isoDow === 1) return date;
  return addUtcDays(date, 8 - isoDow);
}

function addUtcDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + Number(days || 0));
  return next;
}

function getColombiaHolidaySet(year) {
  if (colombiaHolidayCache.has(year)) return colombiaHolidayCache.get(year);

  const easter = easterSundayUtc(year);
  const holidays = new Set([
    formatUtcDate(makeUtcDate(year, 1, 1)),
    formatUtcDate(makeUtcDate(year, 5, 1)),
    formatUtcDate(makeUtcDate(year, 7, 20)),
    formatUtcDate(makeUtcDate(year, 8, 7)),
    formatUtcDate(makeUtcDate(year, 12, 8)),
    formatUtcDate(makeUtcDate(year, 12, 25)),
    formatUtcDate(moveToFollowingMondayUtc(makeUtcDate(year, 1, 6))),
    formatUtcDate(moveToFollowingMondayUtc(makeUtcDate(year, 3, 19))),
    formatUtcDate(moveToFollowingMondayUtc(makeUtcDate(year, 6, 29))),
    formatUtcDate(moveToFollowingMondayUtc(makeUtcDate(year, 7, 9))),
    formatUtcDate(moveToFollowingMondayUtc(makeUtcDate(year, 8, 15))),
    formatUtcDate(moveToFollowingMondayUtc(makeUtcDate(year, 10, 12))),
    formatUtcDate(moveToFollowingMondayUtc(makeUtcDate(year, 11, 1))),
    formatUtcDate(moveToFollowingMondayUtc(makeUtcDate(year, 11, 11))),
    formatUtcDate(addUtcDays(easter, -3)),
    formatUtcDate(addUtcDays(easter, -2)),
    formatUtcDate(moveToFollowingMondayUtc(addUtcDays(easter, 39))),
    formatUtcDate(moveToFollowingMondayUtc(addUtcDays(easter, 60))),
    formatUtcDate(moveToFollowingMondayUtc(addUtcDays(easter, 68)))
  ]);

  colombiaHolidayCache.set(year, holidays);
  return holidays;
}
