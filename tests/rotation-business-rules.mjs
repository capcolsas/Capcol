import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
process.on('uncaughtException', error => { console.error(error.message, error.where || '', error.position || ''); process.exit(1); });

const sql = name => fs.readFile(new URL(`../supabase/${name}`, import.meta.url), 'utf8');
const migrations = ['schema_operations_phase50_shift_rotations.sql', 'schema_operations_phase51_rotation_rules.sql',
  'schema_operations_phase52_shift_generation_horizon.sql', 'schema_operations_phase64_rotation_weekly_rest.sql'];
const phase66 = 'schema_operations_phase66_rotation_business_rules.sql';

const SCAFFOLD = `
create role authenticated; create role anon; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql as $$select null::uuid$$;
create function auth.role() returns text language sql as $$select coalesce(current_setting('test.role',true),'authenticated')$$;
create function public.is_admin_like() returns boolean language sql as $$select coalesce(current_setting('test.admin',true),'true')::boolean$$;
create function public.can_read_contract_data(text) returns boolean language sql as $$select $1='A'$$;
create table profiles(id uuid primary key);
create table contracts(codigo text primary key);
create table shift_site_plan_assignments(horizon_days integer default 90);
create table sedes(codigo text primary key,contrato_codigo text,estado text);
create table shift_templates(id uuid primary key,contrato_codigo text,estado text);
create table employees(id uuid primary key,nombre text,documento text,cargo_codigo text,cargo_nombre text,sede_codigo text,contrato_codigo text,estado text);
create table scheduled_shifts(id uuid primary key,template_id uuid,fecha_operativa text,sede_codigo text,contrato_codigo text,contrato_nombre text,cliente_nombre_snapshot text,cliente_nit_snapshot text,starts_at timestamptz,ends_at timestamptz,estado text,operarios_planeados integer);
create table shift_assignments(id uuid primary key default gen_random_uuid(),scheduled_shift_id uuid,employee_id uuid,documento text,nombre text,cargo_codigo text,cargo_nombre text,sede_codigo text,contrato_codigo text,contrato_nombre text,cliente_nombre_snapshot text,cliente_nit_snapshot text,estado text default 'asignado',unique(scheduled_shift_id,employee_id));
create table employee_shift_status(id text primary key,scheduled_shift_id uuid,fecha_operativa text,employee_id uuid,documento text,nombre text,sede_codigo text,contrato_codigo text,contrato_nombre text,cliente_nombre_snapshot text,cliente_nit_snapshot text,estado_turno text,asistio boolean);
`;
async function freshDb() {
  const db = new PGlite();
  await db.exec(SCAFFOLD);
  return db;
}
const q = async (db, text, params) => (await db.query(text, params)).rows;
const one = async (db, text, params) => (await q(db, text, params))[0];
async function expectError(promise, fragment) {
  try { await promise; } catch (error) { assert.match(error.message, fragment); return; }
  assert.fail(`se esperaba un error que coincida con ${fragment}`);
}

const P = '10000000-0000-0000-0000-000000000001';
const emp = n => `20000000-0000-0000-0000-00000000000${n}`;
const db = await freshDb();
await db.exec(`insert into contracts values('A'); insert into sedes values('S','A','activo'),('T','A','activo');
  insert into shift_templates values('${P}','A','activo');`);
for (let n = 1; n <= 6; n += 1) await db.exec(`insert into employees(id,nombre,documento,sede_codigo,contrato_codigo,estado) values('${emp(n)}','Empleado ${n}','D${n}','S','A','activo')`);
await db.exec(`insert into employees(id,nombre,documento,sede_codigo,contrato_codigo,estado) values('${emp(7)}','Otra sede','D7','T','A','activo')`);
for (const file of migrations) await db.exec(await sql(file));
await db.exec(await sql(phase66));

// Domingo futuro (al menos dentro de dos dias): las semanas van de domingo a sabado.
const start = (await one(db, `select (((now() at time zone 'America/Bogota')::date + 2) + ((7 - extract(dow from (now() at time zone 'America/Bogota')::date + 2)::integer) % 7))::text d`)).d;
const day = n => q(db, `select ($1::date + $2::integer)::text d`, [start, n]).then(rows => rows[0].d);
await db.exec(`insert into scheduled_shifts(id,template_id,fecha_operativa,sede_codigo,contrato_codigo,contrato_nombre,starts_at,ends_at,estado,operarios_planeados,almuerzo_minutos)
  select gen_random_uuid(),'${P}',d::date::text,'S','A','Contrato',(d::date::text||'T07:00:00-05:00')::timestamptz,(d::date::text||'T15:00:00-05:00')::timestamptz,'programado',6,60
  from generate_series('${start}'::date,'${start}'::date+84,interval '1 day') d`);
const members = ids => ids.map(n => ({ employee: emp(n), offset: 0 }));
const preview = (config, from, to) => q(db, `select fecha::text, employee_id, template_id, shift_id, result from preview_shift_rotation('A',$1::jsonb,$2::date,$3::date) order by 1,2`, [JSON.stringify(config), from, to]);

// 1) Almuerzo: 8 h de horario con 1 h de almuerzo son 7 h; seis dias suman 42 h y no superan el limite semanal.
const fixed = { site: 'S', start, days: 1, cycle: [P], members: members([1]), rules: { maxWeeklyHours: 42, weeklyRestDays: { [emp(1)]: 0 } } };
let rows = await preview(fixed, start, await day(6));
assert.deepEqual(rows.map(r => r.result), ['Descanso semanal', 'Por asignar', 'Por asignar', 'Por asignar', 'Por asignar', 'Por asignar', 'Por asignar'], '42 h netas cumplen el limite');
await db.exec(`update scheduled_shifts set almuerzo_minutos = 0`);
rows = await preview(fixed, start, await day(6));
assert(rows.slice(1).every(r => r.result.startsWith('Limite semanal: 48 h')), 'sin almuerzo son 48 h y se bloquea');
await db.exec(`update scheduled_shifts set almuerzo_minutos = 60`);
assert.equal(Number((await one(db, `select public.shift_net_ratio('2026-09-28T12:00:00Z','2026-09-28T20:00:00Z',60) r`)).r), 0.875);
assert.equal((await one(db, `select public.colombia_weekly_limit_minutes('2026-07-14') m`)).m, 44 * 60);
assert.equal((await one(db, `select public.colombia_weekly_limit_minutes('2026-07-15') m`)).m, 42 * 60);

// 2) Descansos rotativos: un descanso por semana, distinto cada semana y repartido entre el equipo.
const rotating = { site: 'S', start, days: 1, cycle: [P], members: members([1, 2, 3, 4, 5, 6]), rules: { restMode: 'rotativo' } };
rows = await preview(rotating, start, await day(41));
const restOf = (employee, week) => rows.filter(r => r.employee_id === employee && r.template_id === null && r.fecha >= week.from && r.fecha <= week.to);
const weeks = await Promise.all([0, 1, 2, 3, 4, 5].map(async w => ({ w, from: await day(w * 7), to: await day(w * 7 + 6) })));
const weekdayOf = async iso => Number((await one(db, `select extract(isodow from $1::date)::integer d`, [iso])).d);
const weekdays = new Map();
for (const week of weeks) {
  const used = [];
  for (let n = 1; n <= 6; n += 1) {
    const rest = restOf(emp(n), week);
    assert.equal(rest.length, 1, `empleado ${n} semana ${week.w}: exactamente un dia de descanso`);
    assert.equal(rest[0].result, 'Descanso compensatorio', 'trabajar el domingo genera un descanso compensatorio en esa misma semana');
    const weekday = await weekdayOf(rest[0].fecha);
    assert(weekday >= 1 && weekday <= 6, 'el descanso cae de lunes a sabado');
    used.push(weekday);
    weekdays.set(`${n}|${week.w}`, weekday);
  }
  assert.deepEqual([...used].sort(), [1, 2, 3, 4, 5, 6], `semana ${week.w}: cada dia lo descansa una persona distinta`);
}
for (let n = 1; n <= 6; n += 1) for (let w = 0; w < 5; w += 1) assert.notEqual(weekdays.get(`${n}|${w}`), weekdays.get(`${n}|${w + 1}`), `empleado ${n}: el descanso cambia de semana`);
for (const week of weeks) {
  const worked = rows.filter(r => r.template_id !== null && r.fecha >= week.from && r.fecha <= week.to);
  assert.equal(worked.length, 6 * 6, 'seis dias de trabajo por empleado y semana (42 h netas)');
}

// 3) Si el domingo ya es descanso del ciclo no se agrega otro descanso automatico.
const sundayCycle = { site: 'S', start, days: 1, cycle: [P, P, P, P, P, P, null], members: members([1, 2]), rules: { restMode: 'rotativo' } };
assert.equal((await one(db, `select count(*)::integer n from shift_rotation_rest_days($1::jsonb,$2::date,$3::date)`, [JSON.stringify(sundayCycle), start, await day(41)])).n, 0);
rows = await preview(sundayCycle, start, await day(6));
assert.equal(rows.filter(r => r.result === 'Descanso').length, 2, 'el domingo del ciclo sigue siendo descanso');

// 4) Validacion de reglas nuevas.
await expectError(preview({ ...rotating, rules: { restMode: 'otro' } }, start, start), /Modo de descanso invalido/);
await expectError(preview({ ...rotating, rules: { restMode: 'rotativo', restPlan: [] } }, start, start), /Plan de descansos invalido/);

// 5) Guardar y activar: las asignaciones respetan los descansos rotativos.
const rotationId = (await one(db, `select save_shift_rotation('A','Rotacion',$1::jsonb) id`, [JSON.stringify(rotating)])).id;
const created = (await one(db, `select apply_shift_rotation($1,true) n`, [rotationId])).n;
assert(created >= 6 * 6, 'crea asignaciones para los dias de trabajo');
const monday2 = await day(7);
const restDays = await q(db, `select employee_id, rest_date::text d, kind from shift_rotation_rest_days((select config from shift_rotations where id=$1),$2::date,$3::date) order by employee_id`, [rotationId, monday2, await day(13)]);
assert.equal(restDays.length, 6);
const e1Rest = restDays.find(r => r.employee_id === emp(1));
const e2Rest = restDays.find(r => r.employee_id === emp(2));
const assignedOn = (employee, date) => one(db, `select count(*)::integer n from shift_assignments a join scheduled_shifts s on s.id=a.scheduled_shift_id where a.employee_id=$1 and s.fecha_operativa=$2`, [employee, date]).then(r => r.n);
assert.equal(await assignedOn(emp(1), e1Rest.d), 0, 'el empleado no tiene turno el dia de descanso');
assert.equal(await assignedOn(emp(1), e2Rest.d), 1);

// 5b) Una asignacion vieja de la rotacion sobre un dia que ahora es descanso se reporta aparte y no rompe el limite semanal de los demas dias.
{
  await db.query(`insert into shift_assignments(scheduled_shift_id,employee_id,estado,rotation_id)
    select id,$1,'asignado',$2 from scheduled_shifts where fecha_operativa=$3 and template_id=$4 limit 1`, [emp(1), rotationId, e1Rest.d, P]);
  const limited = { ...(await one(db, `select config from shift_rotations where id=$1`, [rotationId])).config };
  limited.rules = { ...limited.rules, maxWeeklyHours: 42 };
  const rowsWithStale = (await preview(limited, monday2, await day(13))).filter(r => r.employee_id === emp(1));
  assert(rowsWithStale.some(r => r.fecha === e1Rest.d && /^Revisar asignacion existente: Descanso/.test(r.result)), 'el descanso avisa de la asignacion existente');
  assert(!rowsWithStale.some(r => /Limite semanal/.test(r.result)), 'los otros dias no reciben avisos de limite por esa asignacion');
  // Al aplicar la rotacion se libera la asignacion propia sobre el descanso y el aviso desaparece.
  await db.query(`select apply_shift_rotation($1,false)`, [rotationId]);
  assert.equal(await assignedOn(emp(1), e1Rest.d), 0, 'la asignacion sobre el dia de descanso se libera');
  const clean = (await preview(limited, monday2, await day(13))).find(r => r.employee_id === emp(1) && r.fecha === e1Rest.d);
  assert.match(clean.result, /^Descanso (semanal|compensatorio)$/, 'el descanso ya no muestra el aviso de revision');
}

// 6) Intercambio de descansos entre dos empleados de la misma sede.
const swapped = (await one(db, `select swap_shift_rotation_rest_days($1,$2,$3::date,$4,$5::date) n`, [rotationId, emp(1), e1Rest.d, emp(2), e2Rest.d])).n;
assert(swapped >= 4, 'quita los turnos del nuevo descanso y agrega los del dia liberado: ' + swapped);
const plan = (await one(db, `select config->'rules'->'restPlan' plan from shift_rotations where id=$1`, [rotationId])).plan;
assert.equal(plan[emp(1)][monday2][e1Rest.kind], e2Rest.d);
assert.equal(plan[emp(2)][monday2][e2Rest.kind], e1Rest.d);
assert.equal(await assignedOn(emp(1), e2Rest.d), 0, 'el empleado 1 ahora descansa el dia del empleado 2');
assert.equal(await assignedOn(emp(1), e1Rest.d), 1, 'y trabaja el dia que antes descansaba');
assert.equal(await assignedOn(emp(2), e1Rest.d), 0);
assert.equal(await assignedOn(emp(2), e2Rest.d), 1);
const weekCount = employee => one(db, `select count(*)::integer n from shift_assignments a join scheduled_shifts s on s.id=a.scheduled_shift_id where a.employee_id=$1 and s.fecha_operativa between $2 and $3`, [employee, monday2, e2Rest.d > e1Rest.d ? e2Rest.d : e1Rest.d]).then(r => r.n);
const fullWeek = employee => one(db, `select count(*)::integer n from shift_assignments a join scheduled_shifts s on s.id=a.scheduled_shift_id where a.employee_id=$1 and s.fecha_operativa between $2 and ($2::date+6)::text`, [employee, monday2]).then(r => r.n);
assert.equal(await fullWeek(emp(1)), 6, 'los seis dias de trabajo se conservan');
assert.equal(await fullWeek(emp(2)), 6);
void weekCount;
// El calendario recalcula: el descanso nuevo aparece en la vista previa.
const after = await preview((await one(db, `select config from shift_rotations where id=$1`, [rotationId])).config, monday2, await day(13));
assert.equal(after.find(r => r.employee_id === emp(1) && r.fecha === e2Rest.d).template_id, null);
assert.equal(after.find(r => r.employee_id === emp(1) && r.fecha === e1Rest.d).template_id, P);
// Un intercambio repetido de vuelta restablece el estado original.
await db.query(`select swap_shift_rotation_rest_days($1,$2,$3::date,$4,$5::date)`, [rotationId, emp(1), e2Rest.d, emp(2), e1Rest.d]);
assert.equal(await assignedOn(emp(1), e1Rest.d), 0);
assert.equal(await assignedOn(emp(1), e2Rest.d), 1);

// 6b) Mover el descanso de un empleado a otro dia de la misma semana.
const moveTo = (await one(db, `select ($1::date + (case when $2::date = $1::date + 1 then 2 else 1 end))::text d`, [monday2, e1Rest.d])).d;
const moved = (await one(db, `select move_shift_rotation_rest_day($1,$2,$3::date,$4::date) n`, [rotationId, emp(1), e1Rest.d, moveTo])).n;
assert(moved >= 2, 'quita el turno del nuevo descanso y agrega el del dia liberado: ' + moved);
const movedPlan = (await one(db, `select config->'rules'->'restPlan' plan from shift_rotations where id=$1`, [rotationId])).plan;
assert.equal(movedPlan[emp(1)][monday2][e1Rest.kind], moveTo);
assert.equal(await assignedOn(emp(1), moveTo), 0, 'el nuevo dia es de descanso');
assert.equal(await assignedOn(emp(1), e1Rest.d), 1, 'el dia liberado vuelve a tener turno');
assert.equal(await fullWeek(emp(1)), 6, 'sigue con seis dias de trabajo');
assert.equal(await fullWeek(emp(2)), 6, 'los demas no cambian');
await expectError(db.query(`select move_shift_rotation_rest_day($1,$2,$3::date,$4::date)`, [rotationId, emp(1), moveTo, moveTo]), /dia distinto/);
await expectError(db.query(`select move_shift_rotation_rest_day($1,$2,$3::date,$4::date)`, [rotationId, emp(1), e1Rest.d, await day(20)]), /no es un descanso programado|misma semana/);
await expectError(db.query(`select move_shift_rotation_rest_day($1,$2,$3::date,$4::date)`, [rotationId, emp(1), moveTo, monday2]), /lunes a sabado/);
await expectError(db.query(`select move_shift_rotation_rest_day($1,$2,$3::date,$4::date)`, [rotationId, emp(1), '2020-01-06', '2020-01-07']), /futuros/);
await expectError(db.query(`select move_shift_rotation_rest_day($1,$2,$3::date,$4::date)`, [rotationId, emp(7), moveTo, e1Rest.d]), /sede y estar en la rotacion/);
// Volver al descanso original.
await db.query(`select move_shift_rotation_rest_day($1,$2,$3::date,$4::date)`, [rotationId, emp(1), moveTo, e1Rest.d]);
assert.equal(await assignedOn(emp(1), e1Rest.d), 0);
assert.equal(await assignedOn(emp(1), moveTo), 1);

// 7) Rechazos del intercambio.
const week3 = await day(14);
const e3Rest = (await q(db, `select employee_id, rest_date::text d from shift_rotation_rest_days((select config from shift_rotations where id=$1),$2::date,$3::date)`, [rotationId, week3, await day(20)])).find(r => r.employee_id === emp(1));
await expectError(db.query(`select swap_shift_rotation_rest_days($1,$2,$3::date,$4,$5::date)`, [rotationId, emp(1), e1Rest.d, emp(1), e2Rest.d]), /dos empleados distintos/);
await expectError(db.query(`select swap_shift_rotation_rest_days($1,$2,$3::date,$4,$5::date)`, [rotationId, emp(1), e1Rest.d, emp(7), e2Rest.d]), /misma sede y estar en la rotacion/);
await expectError(db.query(`select swap_shift_rotation_rest_days($1,$2,$3::date,$4,$5::date)`, [rotationId, emp(1), e1Rest.d, emp(2), e3Rest.d]), /misma semana/);
await expectError(db.query(`select swap_shift_rotation_rest_days($1,$2,$3::date,$4,$5::date)`, [rotationId, emp(1), e1Rest.d, emp(2), e1Rest.d]), /fechas distintas/);
await expectError(db.query(`select swap_shift_rotation_rest_days($1,$2,$3::date,$4,$5::date)`, [rotationId, emp(1), await day(10), emp(2), await day(11)]), /no es un descanso programado/);
await expectError(db.query(`select swap_shift_rotation_rest_days($1,$2,$3::date,$4,$5::date)`, [rotationId, emp(1), '2020-01-06', emp(2), '2020-01-07']), /futuros/);
const fixedId = (await one(db, `select save_shift_rotation('A','Fija',$1::jsonb) id`, [JSON.stringify(fixed)])).id;
await expectError(db.query(`select swap_shift_rotation_rest_days($1,$2,$3::date,$4,$5::date)`, [fixedId, emp(1), start, emp(2), await day(1)]), /descansos rotativos/);
await db.exec(`select set_config('test.admin','false',false)`);
await expectError(db.query(`select swap_shift_rotation_rest_days($1,$2,$3::date,$4,$5::date)`, [rotationId, emp(1), e1Rest.d, emp(2), e2Rest.d]), /Sin permiso/);
await db.exec(`select set_config('test.admin','true',false)`);

// 7b) Reemplazar la programacion manual: solo asignaciones manuales de los miembros, futuras y dentro de los proximos 30 dias.
{
  const e3 = (await q(db, `select rest_date::text d from shift_rotation_rest_days((select config from shift_rotations where id=$1),$2::date,$3::date) where employee_id=$4`, [rotationId, monday2, await day(13), emp(3)]))[0].d;
  const manual = (date, employee = emp(3)) => db.query(`insert into shift_assignments(scheduled_shift_id,employee_id,estado)
    select id,$1,'asignado' from scheduled_shifts where fecha_operativa=$2 and template_id=$3 limit 1`, [employee, date, P]);
  await manual(e3);
  const far = await day(60);
  await manual(far);
  const before = (await one(db, `select replace_manual_shift_assignments($1,true) n`, [rotationId])).n;
  assert.equal(before, 1, 'solo cuenta la asignacion manual dentro de los proximos 30 dias');
  assert.equal(await assignedOn(emp(3), e3), 1, 'la simulacion no borra nada');
  const done = (await one(db, `select replace_manual_shift_assignments($1,false) n`, [rotationId])).n;
  assert.equal(done, 1);
  assert.equal(await assignedOn(emp(3), e3), 0, 'la asignacion manual fue reemplazada');
  assert.equal(await assignedOn(emp(3), far), 1, 'lo que queda fuera del horizonte no se toca');
  assert.equal((await one(db, `select count(*)::integer n from shift_assignments where rotation_id=$1`, [rotationId])).n > 0, true, 'las asignaciones de la rotacion no se tocan');
  await db.exec(`select set_config('test.admin','false',false)`);
  await expectError(db.query(`select replace_manual_shift_assignments($1,true)`, [rotationId]), /Sin permiso/);
  await db.exec(`select set_config('test.admin','true',false)`);
}

// 8) Horas extra registradas por empleado y semana.
const limitMinutes = 42 * 60;
let overtime = await q(db, `select employee_id, week_start::text w, worked_minutes, limit_minutes, overtime_minutes from shift_overtime_weeks where employee_id=$1 order by week_start`, [emp(1)]);
assert(overtime.length >= 4, 'se registran las semanas de la ventana aplicada');
const horizonEnd = (await one(db, `select ((now() at time zone 'America/Bogota')::date+30)::text d`)).d;
const fullWeeks = (await Promise.all(overtime.map(async r => ({ ...r, end: (await one(db, `select ($1::date+6)::text d`, [r.w])).d })))).filter(r => r.w >= monday2 && r.end <= horizonEnd);
assert(fullWeeks.length >= 2, 'hay varias semanas completas dentro del horizonte');
assert(fullWeeks.every(r => r.worked_minutes === limitMinutes && r.limit_minutes === limitMinutes && r.overtime_minutes === 0), 'seis dias de 7 h son 42 h: sin extras');
// Trabajar el dia de descanso agrega 7 h netas: 49 h, 7 h extra.
const restShift = (await one(db, `select id from scheduled_shifts where fecha_operativa=$1`, [e1Rest.d])).id;
await db.query(`insert into shift_assignments(scheduled_shift_id,employee_id,estado) values($1,$2,'asignado')`, [restShift, emp(1)]);
await db.query(`select record_rotation_overtime($1,$2::date,$3::date)`, [rotationId, monday2, await day(13)]);
overtime = await q(db, `select worked_minutes, overtime_minutes from shift_overtime_weeks where employee_id=$1 and week_start=$2`, [emp(1), monday2]);
assert.deepEqual(overtime, [{ worked_minutes: 49 * 60, overtime_minutes: 7 * 60 }]);
await db.exec(`select set_config('test.admin','false',false)`);
await expectError(db.query(`select record_rotation_overtime($1,$2::date,$3::date)`, [rotationId, monday2, await day(13)]), /Sin permiso/);
await db.exec(`select set_config('test.admin','true',false)`);

// 9) La migracion se puede repetir sin tocar valores ya editados.
await db.exec(`update scheduled_shifts set almuerzo_minutos = 30 where fecha_operativa = '${start}'`);
await db.exec(await sql(phase66));
assert.equal((await one(db, `select almuerzo_minutos m from scheduled_shifts where fecha_operativa=$1 limit 1`, [start])).m, 30);
assert.equal((await one(db, `select shift_rotation_rules_version() v`)).v, 69);

// 9b) Relevos: cubren el turno de quien descansa o no esta disponible; nunca mas de 6 dias salvo necesidad, con descanso pendiente y extras.
{
  await db.exec(`delete from employee_shift_status; delete from shift_assignments; delete from shift_overtime_weeks; update shift_rotations set estado='pausado'`);
  const regulars = [1, 2, 3, 4].map(n => ({ employee: emp(n), offset: 0 }));
  const reliefConfig = { site: 'S', start, days: 1, cycle: [P], members: [...regulars, { employee: emp(5), offset: 0, reliever: true }], rules: { restMode: 'rotativo' } };
  const rowsR = await preview(reliefConfig, start, await day(6));
  const of = (employee, date) => rowsR.find(r => r.employee_id === emp(employee) && r.fecha === date);
  // Semana de domingo a sabado: los titulares descansan de lunes a jueves (compensatorio del domingo); el relevo cubre esos dias.
  for (let d = 1; d <= 4; d += 1) {
    assert.equal(of(d, await day(d)).result, 'Descanso compensatorio', `titular ${d} descansa el dia ${d}`);
    assert.equal(of(5, await day(d)).template_id, P, `el relevo cubre el dia ${d}`);
    assert.equal(of(5, await day(d)).result, 'Por asignar');
  }
  // Cubre 4 dias; para llegar a 6 completa como sobrante (sobre el cupo) el viernes y el sabado y descansa el domingo.
  for (let d = 5; d <= 6; d += 1) { assert.equal(of(5, await day(d)).result, 'Por asignar (sobrante)', `el relevo completa como sobrante el dia ${d}`); assert.equal(of(5, await day(d)).template_id, P); }
  assert.equal(of(5, await day(0)).result, 'Descanso relevo', 'el relevo descansa el domingo, dia natural de descanso');
  // Cada dia hay 4 personas del plan: nadie queda sin cubrir; el sobrante suma una persona mas.
  for (let d = 0; d < 7; d += 1) { const date = await day(d); assert.equal(rowsR.filter(r => r.fecha === date && r.template_id === P).length, d >= 5 ? 5 : 4, `cobertura del dia ${d}`); }
  // Un titular no disponible deja otro hueco; con un solo relevo el septimo dia se cubre y el descanso queda pendiente.
  const busy = { ...reliefConfig, unavailable: [{ employee: emp(2), from: await day(0), to: await day(0) }, { employee: emp(1), from: await day(5), to: await day(6) }] };
  const weeksInfo = await q(db, `select employee_id, week_start::text w, days_worked, extra_days, surplus_days, pending_rest from shift_rotation_relief_weeks($1::jsonb,$2::date,$3::date) order by week_start`, [JSON.stringify(busy), start, await day(13)]);
  assert.equal(weeksInfo.length, 2);
  assert.deepEqual([weeksInfo[0].days_worked, weeksInfo[0].extra_days, weeksInfo[0].pending_rest], [7, 1, 1], 'siete dias: descanso pendiente');
  assert(weeksInfo[1].days_worked === 5 && weeksInfo[1].surplus_days === 1 && weeksInfo[1].pending_rest === 0, 'la semana siguiente devuelve el descanso pendiente: ' + JSON.stringify(weeksInfo[1]));
  const busyRows = await preview(busy, start, await day(6));
  assert.equal(busyRows.filter(r => r.employee_id === emp(5) && r.template_id === P).length, 7, 'el relevo cubre los siete dias');
  assert.equal(busyRows.filter(r => (r.employee_id === emp(1) || r.employee_id === emp(2)) && r.result === 'Empleado no disponible').length, 3);
  assert(!busyRows.some(r => /Cupo insuficiente/.test(r.result)), 'el no disponible no ocupa cupo');
  // Guardar, activar y aplicar: el relevo queda asignado y las horas sobre el limite semanal se registran como extras.
  const reliefId = (await one(db, `select save_shift_rotation('A','Con relevo',$1::jsonb) id`, [JSON.stringify(busy)])).id;
  await db.query(`select apply_shift_rotation($1,true)`, [reliefId]);
  const relieverDays = (await one(db, `select count(*)::integer n from shift_assignments a join scheduled_shifts s on s.id=a.scheduled_shift_id where a.employee_id=$1 and s.fecha_operativa between $2 and $3`, [emp(5), start, await day(6)])).n;
  assert.equal(relieverDays, 7);
  const ot = await one(db, `select worked_minutes w, overtime_minutes o from shift_overtime_weeks where employee_id=$1 and week_start=$2::date`, [emp(5), start]);
  const worked = 7 * 420 + 30; // el primer dia tiene 30 min de almuerzo en esta prueba
  assert.equal(ot.w, worked);
  assert.equal(ot.o, worked - 42 * 60, 'el septimo dia genera horas extras');
  // Mover el descanso de un titular recalcula al relevo: se libera el dia que ya no necesita cubrir.
  const cfg = (await one(db, `select config from shift_rotations where id=$1`, [reliefId])).config;
  const moved = await db.query(`select move_shift_rotation_rest_day($1,$2,$3::date,$4::date)`, [reliefId, emp(2), await day(2), await day(6)]).then(() => true, error => error.message);
  assert.equal(moved, true, String(moved));
  void cfg;
  await expectError(preview({ ...reliefConfig, members: [{ employee: emp(1), offset: 0, reliever: 'si' }] }, start, start), /Relevo invalido/);
  // Sobrante: se asigna por encima del cupo planeado (4) sin marcarlo como cupo insuficiente.
  await db.exec(`delete from employee_shift_status; delete from shift_assignments; update shift_rotations set estado='pausado'`);
  const surplusDay = await day(5);
  await db.exec(`update scheduled_shifts set operarios_planeados = 4 where fecha_operativa = '${surplusDay}'`);
  const surplusRows = await preview(reliefConfig, start, await day(6));
  assert.equal(surplusRows.find(r => r.employee_id === emp(5) && r.fecha === surplusDay).result, 'Por asignar (sobrante)', 'el sobrante no genera cupo insuficiente');
  assert(!surplusRows.some(r => /Cupo insuficiente/.test(r.result)));
  const surplusId = (await one(db, `select save_shift_rotation('A','Sobrante',$1::jsonb) id`, [JSON.stringify(reliefConfig)])).id;
  await db.query(`select apply_shift_rotation($1,true)`, [surplusId]);
  assert.equal(await assignedOn(emp(5), surplusDay), 1, 'el sobrante queda asignado');
  assert.equal((await one(db, `select count(*)::integer n from shift_assignments a join scheduled_shifts s on s.id=a.scheduled_shift_id where s.fecha_operativa=$1`, [surplusDay])).n, 5, 'el turno supera su cupo planeado con el sobrante');
  assert.equal(await assignedOn(emp(5), await day(0)), 0, 'el relevo descansa el domingo, dia sin huecos');
  // Mover el sobrante a cualquier dia libre de la semana; si cae en domingo, ese mismo dia de la semana queda libre entre semana.
  const satDay = await day(6), sunDay = await day(0);
  const movedSurplus = (await one(db, `select move_shift_rotation_surplus($1,$2,$3::date,$4::date) n`, [surplusId, emp(5), satDay, sunDay])).n;
  assert(movedSurplus >= 2, 'quita el turno del dia anterior y agrega el del nuevo dia: ' + movedSurplus);
  assert.equal(await assignedOn(emp(5), satDay), 0, 'el sabado queda libre');
  assert.equal(await assignedOn(emp(5), sunDay), 1, 'el sobrante quedo el domingo');
  const afterMove = await preview((await one(db, `select config from shift_rotations where id=$1`, [surplusId])).config, start, await day(13));
  assert.equal(afterMove.find(r => r.employee_id === emp(5) && r.fecha === sunDay).result, 'Asignacion existente', 'el domingo ya esta asignado');
  assert.equal(afterMove.find(r => r.employee_id === emp(5) && r.fecha === satDay).result, 'Descanso relevo');
  // Trabajar el domingo obliga a un descanso entre semana esa misma semana (a lo sumo 5 dias de lunes a sabado).
  const week0Days = await q(db, `select work_date::text d from shift_rotation_relief((select config from shift_rotations where id=$1),$2::date,$3::date) where employee_id=$4`, [surplusId, start, await day(6), emp(5)]);
  assert(week0Days.some(r => r.d === sunDay), 'trabaja el domingo');
  const weekdaysWorked = week0Days.filter(r => new Date(r.d + 'T00:00:00Z').getUTCDay() !== 0).length;
  assert(weekdaysWorked <= 5, 'tras trabajar el domingo queda un dia libre entre semana: ' + weekdaysWorked);
  await expectError(db.query(`select move_shift_rotation_surplus($1,$2,$3::date,$4::date)`, [surplusId, emp(5), await day(1), await day(6)]), /no es un sobrante/);
  await expectError(db.query(`select move_shift_rotation_surplus($1,$2,$3::date,$4::date)`, [surplusId, emp(5), sunDay, await day(1)]), /No se puede mover|misma semana/);
  await expectError(db.query(`select move_shift_rotation_surplus($1,$2,$3::date,$4::date)`, [surplusId, emp(1), sunDay, await day(6)]), /debe ser un relevo/);
  await expectError(db.query(`select move_shift_rotation_surplus($1,$2,$3::date,$4::date)`, [surplusId, emp(5), '2020-01-06', '2020-01-07']), /futuros/);
  // Un relevo que no trabaja domingo no genera descanso adicional: seis dias cada semana, descansa el domingo.
  await db.exec(`delete from employee_shift_status; delete from shift_assignments; update shift_rotations set estado='pausado'`);
  const w0 = await q(db, `select week_start::text w, days_worked, surplus_days from shift_rotation_relief_weeks($1::jsonb,$2::date,$3::date) order by 1`, [JSON.stringify(reliefConfig), start, await day(13)]);
  assert.deepEqual(w0.map(w => w.days_worked), [6, 6], 'seis dias por semana sin trabajar domingo');
  const noSunday = await q(db, `select work_date::text d from shift_rotation_relief($1::jsonb,$2::date,$3::date) where employee_id=$4`, [JSON.stringify(reliefConfig), start, await day(13), emp(5)]);
  assert(!noSunday.some(r => new Date(r.d + 'T00:00:00Z').getUTCDay() === 0), 'el relevo descansa el domingo');
}

// 9c) Semanas de domingo a sabado: el domingo es el descanso natural. Un plan que no opera domingo no genera descanso en la semana;
// quien trabaja el domingo descansa un dia de esa misma semana y ninguna regla mira la semana anterior.
{
  await db.exec(`create table shift_template_rules(id uuid primary key default gen_random_uuid(), template_id uuid, tipo_dia text default 'dia_semana', dia_semana text, estado text default 'activo',
    hora_inicio time default '07:00', hora_fin time default '15:00', cruza_dia boolean default false, almuerzo_minutos integer not null default 60)`);
  const PS = '10000000-0000-0000-0000-0000000000a1', PN = '10000000-0000-0000-0000-0000000000a2';
  await db.exec(`insert into shift_templates values('${PS}','A','activo'),('${PN}','A','activo')`);
  for (const d of [0, 1, 2, 3, 4, 5, 6]) await db.exec(`insert into shift_template_rules(template_id,dia_semana) values('${PS}','${d}')`);
  for (const d of [1, 2, 3, 4, 5, 6]) await db.exec(`insert into shift_template_rules(template_id,dia_semana) values('${PN}','${d}')`);
  assert.deepEqual((await one(db, `select shift_template_operating_days('${PN}') d`)).d, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual((await one(db, `select shift_template_operating_days('${P}') d`)).d, [0, 1, 2, 3, 4, 5, 6], 'un plan sin reglas opera todos los dias');
  const rests = config => q(db, `select employee_id, rest_date::text d, kind from shift_rotation_rest_days($1::jsonb,$2::date,$3::date) order by 2`, [JSON.stringify(config), start, config.__to]);
  const to = await day(27);
  // (a) Plan de lunes a sabado: no hay descanso en la semana.
  const noSundayPlan = { site: 'S', start, days: 7, cycle: [PN], members: members([1, 2]), rules: { restMode: 'rotativo' }, __to: to };
  assert.equal((await rests(noSundayPlan)).length, 0, 'un plan que no trabaja domingo no tiene descanso entre semana');
  const sundayPlan = { ...noSundayPlan, cycle: [PS] };
  assert.equal((await rests(sundayPlan)).filter(r => r.employee_id === emp(1)).length, 4, 'un plan que si trabaja domingo tiene un descanso por semana');
  // (b) Semana con domingo, semana sin domingo: solo la semana con domingo genera descanso, dentro de esa misma semana.
  const alternating = { ...noSundayPlan, cycle: [PS, PN], members: members([1]) };
  const alternatingRests = await rests(alternating);
  assert.deepEqual(alternatingRests.map(r => r.kind), ['compensatorio', 'compensatorio']);
  assert.deepEqual(alternatingRests.map(r => Math.floor((Date.parse(r.d) - Date.parse(start)) / 86400000 / 7)), [0, 2], 'el descanso cae en la misma semana del domingo trabajado');
  assert(alternatingRests.every(r => new Date(r.d + 'T00:00:00Z').getUTCDay() !== 0), 'de lunes a sabado');
  // La vista previa muestra el domingo del plan de lunes a sabado como descanso simple.
  const previewNoSunday = await preview({ ...noSundayPlan }, start, await day(6));
  const sundayDate = await day(0);
  assert.equal(previewNoSunday.find(r => r.employee_id === emp(1) && r.fecha === sundayDate).result, 'Descanso');
}

// 9d) Inicio en lunes con etapas semanales: el plan cambia el domingo; la vista previa y los descansos coinciden con el calendario.
{
  const P2 = '10000000-0000-0000-0000-0000000000a1'; // plan que opera todos los dias
  const mondayStart = await day(1);
  const twoStages = { site: 'S', start: mondayStart, days: 7, cycle: [P, P2], members: members([1]), rules: { restMode: 'rotativo' } };
  assert.equal((await one(db, `select rotation_cycle_origin($1::date,7) d`, [mondayStart])).d.toISOString?.().slice(0, 10) ?? (await one(db, `select rotation_cycle_origin($1::date,7)::text d`, [mondayStart])).d, start);
  assert.equal((await one(db, `select rotation_cycle_origin($1::date,5)::text d`, [mondayStart])).d, mondayStart, 'etapas que no son semanas completas cuentan desde el inicio');
  const rowsMonday = await preview(twoStages, await day(0), await day(13));
  const templateOn = async n => { const date = await day(n); return rowsMonday.find(r => r.fecha === date)?.template_id; };
  assert.equal(await templateOn(1), P, 'primera semana: plan 1 desde el lunes de inicio');
  assert.equal(await templateOn(6), P, 'el sabado sigue en el plan 1');
  assert.equal(await templateOn(7), P2, 'el domingo siguiente ya es el plan 2');
  assert.equal(await templateOn(13), P2, 'la semana completa es del plan 2');
}

// 10) Migracion sobre datos existentes: el almuerzo se copia de cada regla y los turnos cortos quedan sin almuerzo.
const legacy = new PGlite();
await legacy.exec(SCAFFOLD + `
create table shift_template_rules(id uuid primary key,hora_inicio time not null,hora_fin time not null,cruza_dia boolean not null default false);
alter table scheduled_shifts add column template_rule_id uuid;
insert into shift_template_rules values('30000000-0000-0000-0000-000000000001','07:00','15:00',false),('30000000-0000-0000-0000-000000000002','08:00','12:00',false),('30000000-0000-0000-0000-000000000003','22:00','06:00',true);
insert into scheduled_shifts(id,template_rule_id,starts_at,ends_at,estado) values
 ('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','2026-10-05T12:00:00Z','2026-10-05T20:00:00Z','programado'),
 ('40000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002','2026-10-05T13:00:00Z','2026-10-05T17:00:00Z','programado'),
 ('40000000-0000-0000-0000-000000000003',null,'2026-10-05T13:00:00Z','2026-10-05T17:00:00Z','programado');`);
for (const file of migrations) await legacy.exec(await sql(file));
await legacy.exec(await sql(phase66));
const rules = await q(legacy, `select hora_inicio::text h, almuerzo_minutos m from shift_template_rules order by hora_inicio`);
assert.deepEqual(rules.map(r => r.m), [60, 0, 60], 'la regla de 4 h (08:00) queda sin almuerzo; las de 8 h (07:00 y nocturna) con 60 min');
assert.deepEqual((await q(legacy, `select almuerzo_minutos m from scheduled_shifts order by id`)).map(r => r.m), [60, 0, 0], 'los turnos copian el almuerzo de su regla');
await legacy.exec(`update shift_template_rules set almuerzo_minutos = 45 where hora_inicio = '07:00'`);
await legacy.exec(await sql(phase66));
assert.equal((await one(legacy, `select almuerzo_minutos m from shift_template_rules where hora_inicio='07:00'`)).m, 45, 'repetir la migracion no pisa el almuerzo editado');

console.log('PASS: almuerzo neto, descansos rotativos por semana, compensatorio tras el domingo, intercambio de descansos con recalculo, horas extra registradas y migracion idempotente.');
