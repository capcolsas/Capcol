import assert from 'node:assert/strict';
import {
  netRuleMinutes, isRestResult, restTypeFromResult, distributeWeeklyRestDays, colombiaWeeklyLimit, weekStartIso, minutesByLocalDay, formatHours, formatTime, formatDayHeader,
  buildRotationWeeks, summarizeWeekRow
} from '../src/assets/js/utils/rotationHours.js';

// Limite semanal legal en Colombia (Ley 2101 de 2021), en cada fecha de cambio.
assert.equal(colombiaWeeklyLimit('2023-07-14'), 48);
assert.equal(colombiaWeeklyLimit('2023-07-15'), 47);
assert.equal(colombiaWeeklyLimit('2024-07-15'), 46);
assert.equal(colombiaWeeklyLimit('2025-07-14'), 46);
assert.equal(colombiaWeeklyLimit('2025-07-15'), 44);
assert.equal(colombiaWeeklyLimit('2026-07-14'), 44);
assert.equal(colombiaWeeklyLimit('2026-07-15'), 42);
assert.equal(colombiaWeeklyLimit('2026-09-26'), 42);

assert.equal(weekStartIso('2026-09-27'), '2026-09-27', 'el domingo abre su semana');
assert.equal(weekStartIso('2026-09-28'), '2026-09-27');
assert.equal(weekStartIso('2026-10-03'), '2026-09-27', 'el sabado la cierra');
assert.equal(weekStartIso('2026-10-04'), '2026-10-04');

// Un turno nocturno reparte sus minutos entre los dos dias calendario de Bogota.
assert.deepEqual([...minutesByLocalDay('2026-09-27T22:00:00-05:00', '2026-09-28T06:00:00-05:00')], [['2026-09-27', 120], ['2026-09-28', 360]]);
assert.deepEqual([...minutesByLocalDay('2026-09-28T07:00:00-05:00', '2026-09-28T15:00:00-05:00')], [['2026-09-28', 480]]);
assert.equal(minutesByLocalDay('2026-09-28T15:00:00-05:00', '2026-09-28T07:00:00-05:00').size, 0);

assert.equal(formatHours(480), '8 h');
assert.equal(formatHours(90), '1,5 h');
assert.equal(formatTime('2026-09-28T12:00:00Z'), '07:00');
assert.equal(formatDayHeader('2026-09-28'), 'lun 28');

const shift = (id, day, from, to) => ({ id, startsAt: `${day}T${from}:00-05:00`, endsAt: `${day}T${to}:00-05:00` });
const weekStart = '2026-09-27'; // domingo: las semanas van de domingo a sabado
const days = Array.from({ length: 14 }, (_, i) => { const d = new Date(`${weekStart}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10); });

// Ciclo de 6 dias de 8 h y el domingo de descanso: 48 h, 6 sobre el limite legal de 42 h.
const config = { start: weekStart, days: 1, cycle: [null, 'P', 'P', 'P', 'P', 'P', 'P'], members: [{ employee: 'E', offset: 0 }], rules: {} };
const shifts = days.map((day, i) => shift(`S${i}`, day, '07:00', '15:00'));
const results = days.map((day, i) => ({ fecha: day, employee_id: 'E', template_id: 'P', shift_id: `S${i}`, result: 'Por asignar' }));
let [week1, week2] = buildRotationWeeks({ config, from: weekStart, results, shifts });
assert.equal(week1.limit, 42);
assert.equal(week1.rows[0].minutes, 48 * 60);
assert.equal(week1.rows[0].incomplete, false);
assert.deepEqual(week1.rows[0].restDates, ['2026-09-27'], 'el descanso del ciclo cae el domingo, primer dia de la semana');
assert.equal(week1.rows[0].cells[0].kind, 'rest');
assert.equal(week1.rows[0].cells[0].restType, 'ciclo');
assert.equal(week1.rows[0].cells[1].shifts[0].minutes, 480);
let summary = summarizeWeekRow(week1.rows[0], week1.limit);
assert.equal(summary.kind, 'extra');
assert.equal(summary.overtimeMinutes, 6 * 60);
assert.equal(summary.label, '+6 h extras sobre 42 h');
assert.equal(summary.noRest, false);
assert.equal(week2.start, '2026-10-04');

// Exactamente el limite: jornada completa, sin extras. Faltantes y exceso del maximo legal de extras.
assert.equal(summarizeWeekRow({ minutes: 42 * 60, workDays: 5, restDates: ['x'] }, 42).kind, 'completo');
assert.equal(summarizeWeekRow({ minutes: 40 * 60, workDays: 5, restDates: ['x'] }, 42).label, 'Faltan 2 h para 42 h');
const heavy = summarizeWeekRow({ minutes: 55 * 60, workDays: 7, restDates: [] }, 42);
assert.equal(heavy.overMaxOvertime, true);
assert.equal(heavy.noRest, true, 'una semana sin ningun dia de descanso se marca');
assert.match(heavy.label, /supera el maximo de 12 h extras/);

// Descanso semanal configurado: se distingue del descanso del ciclo.
const weeklyConfig = { ...config, cycle: ['P'], days: 1, rules: { weeklyRestDays: { E: 0 } } };
[week1] = buildRotationWeeks({ config: weeklyConfig, from: weekStart, results: [], shifts });
assert.equal(week1.rows[0].cells[0].kind, 'rest');
assert.equal(week1.rows[0].cells[0].restType, 'semanal');

// Turno nocturno del sabado que termina el domingo: cuenta completo en la semana donde inicia (la suma de las celdas coincide con el total).
const overnight = [shift('N', '2026-10-03', '22:00', '23:59')];
overnight[0].endsAt = '2026-10-04T06:00:00-05:00';
const nightConfig = { start: weekStart, days: 1, cycle: [null, null, null, null, null, null, 'P'], members: [{ employee: 'E', offset: 0 }], rules: {} };
[week1, week2] = buildRotationWeeks({ config: nightConfig, from: weekStart, results: [{ fecha: '2026-10-03', employee_id: 'E', template_id: 'P', shift_id: 'N', result: 'Por asignar' }], shifts: overnight });
assert.equal(week1.rows[0].minutes, 480);
assert.equal(week2.rows[0].minutes, 0, 'el tramo del domingo no se cuenta otra vez en la semana siguiente');
assert.equal(week1.rows[0].cells[6].minutes, 8 * 60, 'la celda muestra la duracion completa del turno');

// Sin turnos generados o sin poder consultarlos, las horas quedan marcadas como incompletas.
[week1] = buildRotationWeeks({ config, from: weekStart, results: [{ fecha: days[1], employee_id: 'E', template_id: 'P', shift_id: null, result: 'Sin turno generado' }], shifts });
assert.equal(week1.rows[0].cells[1].unknown, true);
assert.equal(week1.rows[0].incomplete, true);
[week1] = buildRotationWeeks({ config, from: weekStart, results, shifts: null });
assert.equal(week1.rows[0].incomplete, true);
assert.equal(week1.rows[0].minutes, 0);

// Bloqueos de la validacion se muestran como alertas; los resultados normales no.
[week1] = buildRotationWeeks({ config, from: weekStart, shifts, results: [
  { fecha: days[1], employee_id: 'E', template_id: 'P', shift_id: 'S1', result: 'Cupo insuficiente' },
  { fecha: days[2], employee_id: 'E', template_id: 'P', shift_id: 'S2', result: 'Por asignar' }] });
assert.deepEqual(week1.rows[0].cells[1].alerts, ['Cupo insuficiente']);
assert.deepEqual(week1.rows[0].cells[2].alerts, []);

// Fuera de vigencia: antes del inicio no hay turnos ni descansos.
[week1] = buildRotationWeeks({ config: { ...config, start: days[3] }, from: weekStart, results: [], shifts });
assert.equal(week1.rows[0].cells[0].kind, 'outside');
assert.equal(week1.rows[0].cells[4].kind, 'work');

// 7 h x 6 dias = 42 h: con el domingo de descanso semanal la semana queda completa, sin extras.
const sevenHour = days.map((day, i) => shift('H' + i, day, '07:00', '14:00'));
const weeklyRestConfig = { start: '2026-09-21', days: 1, cycle: ['P'], members: [{ employee: 'E', offset: 0 }], rules: { weeklyRestDays: { E: 0 } } };
const sevenResults = days.map((day, i) => ({ day, i })).filter(({ i }) => i % 7 !== 0).map(({ day, i }) => ({ fecha: day, employee_id: 'E', template_id: 'P', shift_id: 'H' + i, result: 'Por asignar' }));
[week1, week2] = buildRotationWeeks({ config: weeklyRestConfig, from: weekStart, results: sevenResults, shifts: sevenHour });
assert.equal(week1.rows[0].minutes, 42 * 60);
assert.equal(summarizeWeekRow(week1.rows[0], week1.limit).kind, 'completo');
assert.equal(week2.rows[0].minutes, 42 * 60);
assert.equal(week1.rows[0].minutes + week2.rows[0].minutes, 84 * 60);

// Un turno nocturno del sabado que termina en el domingo de descanso cuenta completo el sabado.
const satNight = shift('SN', '2026-10-03', '22:00', '23:00');
satNight.endsAt = '2026-10-04T05:00:00-05:00';
const nightRest = { ...weeklyRestConfig, rules: { weeklyRestDays: { E: 0 } } };
[week1] = buildRotationWeeks({ config: nightRest, from: weekStart, results: [{ fecha: '2026-10-03', employee_id: 'E', template_id: 'P', shift_id: 'SN', result: 'Por asignar' }], shifts: [satNight] });
assert.equal(week1.rows[0].minutes, 7 * 60, 'las 7 h cuentan el sabado, dia en que inicia el turno');
assert.equal(week1.rows[0].restMinutes, 0);

// Reparto del descanso semanal: no todos el mismo dia y lo mas parejo posible.
const count = (assigned) => Object.values(assigned).reduce((acc, day) => { acc[day] = (acc[day] || 0) + 1; return acc; }, {});
const six = Array.from({ length: 6 }, (_, i) => ({ employee: 'E' + i, offset: 0 }));
assert.deepEqual(count(distributeWeeklyRestDays(six)), { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1 }, '6 personas: un descanso por dia de lunes a sabado');
const twelve = Array.from({ length: 12 }, (_, i) => ({ employee: 'E' + i, offset: i % 2 }));
const spread = count(distributeWeeklyRestDays(twelve));
assert.deepEqual(Object.values(spread), [2, 2, 2, 2, 2, 2], '12 personas: dos por dia');
assert.ok(!(0 in spread), 'el domingo se deja para cubrir el servicio');
const twoTeams = [...Array.from({ length: 3 }, (_, i) => ({ employee: 'A' + i, offset: 0 })), ...Array.from({ length: 3 }, (_, i) => ({ employee: 'B' + i, offset: 1 }))];
const teamAssign = distributeWeeklyRestDays(twoTeams);
for (const prefix of ['A', 'B']) {
  const days3 = Object.entries(teamAssign).filter(([id]) => id.startsWith(prefix)).map(([, day]) => day);
  assert.equal(new Set(days3).size, 3, 'dentro de un equipo nadie comparte el dia de descanso: ' + prefix);
}
assert.equal(Math.max(...Object.values(count(teamAssign))), 1, 'dos equipos de 3 tampoco repiten dia entre equipos');
assert.deepEqual(distributeWeeklyRestDays([{ employee: 'X', offset: 0 }]), { X: 1 });
assert.deepEqual(distributeWeeklyRestDays([]), {});

// Cobertura semanal: personas en descanso por dia y alerta si todo el equipo descansa el mismo dia.
const trio = { start: '2026-09-21', days: 1, cycle: ['P'], members: ['A', 'B', 'C'].map(employee => ({ employee, offset: 0 })), rules: { weeklyRestDays: { A: 2, B: 3, C: 4 } } };
[week1] = buildRotationWeeks({ config: trio, from: weekStart, results: [], shifts: [] });
assert.deepEqual(week1.restCounts, [0, 0, 1, 1, 1, 0, 0], 'martes, miercoles y jueves con una persona cada uno');
assert.equal(week1.sameRestDay, false);
assert.ok(week1.rows.every(r => r.restDates.length === 1), 'cada empleado tiene exactamente un descanso');
trio.rules.weeklyRestDays = { A: 3, B: 3, C: 3 };
[week1] = buildRotationWeeks({ config: trio, from: weekStart, results: [], shifts: [] });
assert.equal(week1.sameRestDay, true, 'se alerta cuando todos descansan el mismo dia');
assert.deepEqual(week1.restCounts, [0, 0, 0, 3, 0, 0, 0], 'los 3 descansan el miercoles');

// Almuerzo: 8 h de horario con 1 h de almuerzo son 7 h netas; seis dias suman 42 h y no generan extras.
assert.equal(netRuleMinutes('07:00', '15:00', false, 60), 420);
assert.equal(netRuleMinutes('22:00', '06:00', true, 60), 420, 'un turno nocturno tambien descuenta el almuerzo');
assert.equal(netRuleMinutes('07:00', '15:00', false, 0), 480);
assert.equal(netRuleMinutes('07:00', '08:00', false, 90), 0, 'el almuerzo no puede dejar horas negativas');
assert.equal(netRuleMinutes('', '15:00', false, 60), null);
const lunchConfig = { start: '2026-09-21', days: 1, cycle: ['P'], members: [{ employee: 'E', offset: 0 }], rules: { restMode: 'rotativo' } };
const withLunch = (lunch) => days.map((day, i) => ({ ...shift('L' + i, day, '07:00', '15:00'), almuerzoMinutos: lunch }));
const workResults = days.map((day, i) => ({ fecha: day, employee_id: 'E', template_id: 'P', shift_id: 'L' + i, result: 'Por asignar' }));
const wednesdayRest = { fecha: days[2], employee_id: 'E', template_id: null, shift_id: null, result: 'Descanso compensatorio' };
const restedResults = [...workResults.filter((r) => r.fecha !== days[2]), wednesdayRest];
[week1] = buildRotationWeeks({ config: lunchConfig, from: weekStart, results: restedResults, shifts: withLunch(60) });
assert.equal(week1.rows[0].cells[2].kind, 'rest', 'el servidor marca el descanso aunque el ciclo tenga plan ese dia');
assert.equal(week1.rows[0].cells[2].restType, 'compensatorio');
assert.equal(week1.rows[0].minutes, 42 * 60, 'seis dias de 7 h netas');
assert.equal(summarizeWeekRow(week1.rows[0], week1.limit).kind, 'completo');
assert.equal(week1.rows[0].cells[0].minutes, 420);
assert.equal(week1.rows[0].cells[0].shifts[0].lunchMinutes, 60);
assert.deepEqual(week1.restCounts, [0, 0, 1, 0, 0, 0, 0]);
[week1] = buildRotationWeeks({ config: lunchConfig, from: weekStart, results: restedResults, shifts: withLunch(0) });
assert.equal(week1.rows[0].minutes, 48 * 60, 'sin almuerzo las mismas jornadas suman 48 h');
assert.equal(summarizeWeekRow(week1.rows[0], week1.limit).label, '+6 h extras sobre 42 h');
assert.equal(isRestResult('Revisar asignacion existente: Descanso semanal'), true);
assert.equal(isRestResult('Por asignar'), false);
assert.equal(restTypeFromResult('Descanso compensatorio'), 'compensatorio');
assert.equal(restTypeFromResult('Descanso semanal (cruce nocturno)'), 'semanal');
assert.equal(restTypeFromResult('Descanso'), 'ciclo');

// Un turno nocturno que termina el dia de descanso cuenta completo el dia en que inicia.
const nightWork = { ...shift('NW', days[1], '22:00', '23:00'), almuerzoMinutos: 60 };
nightWork.endsAt = days[2] + 'T05:00:00-05:00';
[week1] = buildRotationWeeks({ config: lunchConfig, from: weekStart, results: [{ fecha: days[1], employee_id: 'E', template_id: 'P', shift_id: 'NW', result: 'Por asignar' }, wednesdayRest], shifts: [nightWork] });
assert.equal(week1.rows[0].restMinutes, 0);
assert.equal(week1.rows[0].minutes, 360, '7 h brutas menos 1 h de almuerzo, en el dia de inicio');

// Horas extra ya registradas por el servidor se muestran junto a la estimacion.
[week1, week2] = buildRotationWeeks({ config: lunchConfig, from: weekStart, results: restedResults, shifts: withLunch(60),
  overtime: [{ employee_id: 'E', week_start: weekStart, worked_minutes: 49 * 60, limit_minutes: 42 * 60, overtime_minutes: 7 * 60 }] });
assert.equal(week1.rows[0].recorded.overtime_minutes, 420);
assert.equal(week2.rows[0].recorded, null);

// Relevos: sus dias libres no cuentan como descansos de cobertura y su fila se resume como relevo.
{
  const reliefConfig = { start: weekStart, days: 1, cycle: ['P'], members: [{ employee: 'E', offset: 0 }, { employee: 'R', offset: 0, reliever: true }], rules: {} };
  const reliefResults = days.flatMap((day, i) => i > 6 ? [] : [
    { fecha: day, employee_id: 'E', template_id: i === 1 ? null : 'P', shift_id: i === 1 ? null : 'H' + i, result: i === 1 ? 'Descanso semanal' : 'Por asignar' },
    { fecha: day, employee_id: 'R', template_id: i === 1 ? 'P' : null, shift_id: i === 1 ? 'H1' : null, result: i === 1 ? 'Por asignar' : 'Descanso relevo' }]);
  const [reliefWeek] = buildRotationWeeks({ config: reliefConfig, from: weekStart, results: reliefResults, shifts: sevenHour });
  const relieverRow = reliefWeek.rows.find(r => r.employee === 'R');
  assert.equal(relieverRow.reliever, true);
  assert.equal(relieverRow.workDays, 1);
  assert.equal(relieverRow.cells[0].restType, 'relevo');
  assert.deepEqual(reliefWeek.restCounts, [0, 1, 0, 0, 0, 0, 0], 'solo el descanso del titular cuenta en la cobertura');
  assert.equal(reliefWeek.sameRestDay, false);
  assert.equal(summarizeWeekRow(relieverRow, reliefWeek.limit).label, 'Relevo: cubre 7 h');
  assert.equal(restTypeFromResult('Descanso relevo'), 'relevo');
  assert.equal(isRestResult('Descanso relevo'), true);
  // Sobrante: se marca en la celda y no es una alerta.
  const surplusResults = reliefResults.map((r) => (r.employee_id === 'R' && r.fecha === days[2]) ? { ...r, template_id: 'P', shift_id: 'H2', result: 'Por asignar (sobrante)' } : r);
  const [surplusWeek] = buildRotationWeeks({ config: reliefConfig, from: weekStart, results: surplusResults, shifts: sevenHour });
  const surplusCell = surplusWeek.rows.find(r => r.employee === 'R').cells[2];
  assert.equal(surplusCell.surplus, true);
  assert.deepEqual(surplusCell.alerts, [], 'el sobrante no es una alerta');
}

// Inicio en lunes con etapas semanales: el plan cambia el domingo, primer dia de la semana (no el lunes).
{
  const mondayStart = '2026-09-28';
  const stages = { start: mondayStart, days: 7, cycle: ['M', 'T'], members: [{ employee: 'E', offset: 0 }], rules: {} };
  const [w1, w2] = buildRotationWeeks({ config: stages, from: '2026-09-27', results: [], shifts: [] });
  assert.equal(w1.rows[0].cells[0].kind, 'outside', 'el domingo anterior al inicio queda fuera de vigencia');
  assert.deepEqual(w1.rows[0].cells.slice(1).map(c => c.template), ['M', 'M', 'M', 'M', 'M', 'M'], 'primera semana: plan M de lunes a sabado');
  assert.deepEqual(w2.rows[0].cells.map(c => c.template), ['T', 'T', 'T', 'T', 'T', 'T', 'T'], 'el plan cambia el domingo y toda la semana es T');
}

console.log('PASS: limite legal por fecha, semanas domingo-sabado, horas por turno, cruce de medianoche, extras, descansos, reparto de descansos y cobertura.');
