-- Phase 67: close three gaps found while reviewing shift rotation against payroll rules.
--   1. employee_shift_status never received the coverage/payroll decision that
--      refresh_employee_daily_status_base already computes correctly per employee/day.
--      "Servicio" (was the shift covered, by whoever) and "nomina" (is THIS employee paid
--      this day, per their own novelty) are kept as two separate signals, exactly as they
--      already are in employee_daily_status: a replaced titular can have servicio = true
--      (the shift was covered, so the client can be billed) and paga_nomina = false/true
--      independently, based on their own novelty classification (public.novedades.nomina).
--   2. shift_overtime_weeks was only ever recomputed from apply_shift_rotation. A manual
--      assignment (no rotation involved) never produced an overtime row even when it pushed
--      an employee over the legal weekly limit.
--   3. preview_shift_rotation is the one entry point that receives a raw, not-yet-saved
--      config straight from the UI; a malformed value crashed with a raw Postgres cast
--      error instead of the same kind of business message the rest of the function uses.
-- Apply after phase 66. Existing data is never rewritten by this migration; the new sync
-- and overtime functions populate rows going forward (and can be re-run per date/employee).
begin;

-- ---------------------------------------------------------------- 1. Servicio vs nomina
alter table public.employee_shift_status
  add column if not exists servicio_cubierto boolean not null default false,
  add column if not exists cuenta_pago_servicio boolean not null default false,
  add column if not exists cuenta_nomina boolean not null default true,
  add column if not exists paga_nomina boolean,
  add column if not exists motivo_nomina text;

-- Propagates the coverage/payroll decision that refresh_employee_daily_status_base already
-- computed for a given date onto the matching employee_shift_status rows of that same date.
-- Matched strictly per employee (employee_id, falling back to documento) so a titular's row
-- is never mixed with the replacement's row: each keeps its own servicio/nomina decision.
-- Fields already carrying real information from the shift itself (a marking, a novedad
-- linked directly to the turno) are never overwritten, only completed.
create or replace function public.sync_shift_status_coverage_from_daily(p_fecha text)
returns integer language plpgsql security definer set search_path = public as $$
declare v_rows integer := 0;
begin
  if p_fecha is null or p_fecha !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Fecha invalida'; end if;
  update public.employee_shift_status es
  set
    servicio_cubierto = ds.servicio_cubierto,
    cuenta_pago_servicio = ds.cuenta_pago_servicio,
    cuenta_nomina = ds.cuenta_nomina,
    paga_nomina = ds.paga_nomina,
    motivo_nomina = ds.motivo_nomina,
    decision_cobertura = case when es.decision_cobertura = 'no_aplica' and ds.decision_cobertura <> 'no_aplica'
      then ds.decision_cobertura else es.decision_cobertura end,
    reemplazado_por_employee_id = case when es.decision_cobertura = 'no_aplica' and ds.decision_cobertura <> 'no_aplica'
      then nullif(ds.reemplazado_por_employee_id,'')::uuid else es.reemplazado_por_employee_id end,
    reemplazado_por_documento = case when es.decision_cobertura = 'no_aplica' and ds.decision_cobertura <> 'no_aplica'
      then ds.reemplazado_por_documento else es.reemplazado_por_documento end,
    reemplazado_por_nombre = case when es.decision_cobertura = 'no_aplica' and ds.decision_cobertura <> 'no_aplica'
      then ds.reemplazado_por_nombre else es.reemplazado_por_nombre end,
    asistio = case when ds.asistio = true and es.asistio = false and es.entrada_at is null then true else es.asistio end,
    novedad_codigo = case when es.novedad_codigo is null and es.novedad_nombre is null then ds.novedad_codigo else es.novedad_codigo end,
    novedad_nombre = case when es.novedad_codigo is null and es.novedad_nombre is null then ds.novedad_nombre else es.novedad_nombre end,
    source_incapacity_id = case when es.novedad_codigo is null and es.novedad_nombre is null and es.source_incapacity_id is null
      and ds.source_incapacity_id ~ '^[0-9a-fA-F-]{36}$' then ds.source_incapacity_id::uuid else es.source_incapacity_id end,
    updated_at = now()
  from public.employee_daily_status ds
  where ds.fecha = p_fecha
    and es.fecha_operativa = p_fecha
    and (
      (es.employee_id is not null and ds.employee_id = es.employee_id::text)
      or (es.employee_id is null and es.documento is not null and ds.documento = es.documento)
    );
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;
revoke all on function public.sync_shift_status_coverage_from_daily(text) from public, anon;
grant execute on function public.sync_shift_status_coverage_from_daily(text) to authenticated, service_role;

-- Run right after the daily pipeline recomputes employee_daily_status, so every normal day
-- close (and every manual re-run) keeps employee_shift_status caught up automatically.
create or replace function public.refresh_operational_snapshots_from_employee_daily_status(p_fecha text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_rows integer := 0;
  v_sedes integer := 0;
  v_contracts integer := 0;
  v_sede_closures integer := 0;
  v_shift_status_rows integer := 0;
  v_metrics public.daily_metrics;
  v_validation jsonb;
begin
  v_employee_rows := public.refresh_employee_daily_status(p_fecha);
  v_sedes := public.recompute_sede_status_from_employee_daily_status(p_fecha);
  v_contracts := public.recompute_daily_contract_metrics_from_employee_daily_status(p_fecha);
  v_metrics := public.recompute_daily_metrics_from_employee_daily_status(p_fecha);
  v_sede_closures := public.recompute_daily_sede_closures_from_sede_status(p_fecha);
  v_shift_status_rows := public.sync_shift_status_coverage_from_daily(p_fecha);
  v_validation := public.validate_daily_contract_metric_consistency(p_fecha);

  if coalesce((v_validation ->> 'ok')::boolean, false) = false then
    raise exception 'Inconsistencia en metricas operativas por contrato para %: %', p_fecha, v_validation;
  end if;

  return jsonb_build_object(
    'fecha', p_fecha,
    'employee_daily_status_rows', v_employee_rows,
    'sede_status_rows', v_sedes,
    'daily_contract_metrics_rows', v_contracts,
    'daily_metrics_id', v_metrics.id,
    'daily_sede_closures_rows', v_sede_closures,
    'employee_shift_status_synced_rows', v_shift_status_rows,
    'attendance_count', v_metrics.attendance_count,
    'expected', v_metrics.expected,
    'planned', v_metrics.planned,
    'validation', v_validation
  );
end;
$$;

-- Also sync the specific shift's date right when it closes, so review screens and any
-- payroll export do not have to wait for the next daily-closure cron run.
create or replace function public.finalize_shift_attendance(p_shift_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_rows jsonb; v_fecha text;
begin
  select fecha_operativa into v_fecha from public.scheduled_shifts where id = p_shift_id and estado <> 'cancelado' for update;
  if not found then raise exception 'attendance_shift_missing'; end if;
  update public.employee_shift_status set
    estado_turno = case
      when (asistio or entrada_at is not null) and salida_at is null
        and estado_turno not in ('ausente_con_novedad','cancelado') then 'salida_pendiente'
      when estado_turno = 'programado' then 'sin_registro' else estado_turno end,
    requires_review = requires_review or ((asistio or entrada_at is not null) and salida_at is null
      and estado_turno not in ('ausente_con_novedad','cancelado')),
    closed = true
  where scheduled_shift_id = p_shift_id;
  update public.scheduled_shifts set estado = 'cerrado', closed_at = coalesce(closed_at, clock_timestamp()) where id = p_shift_id;
  perform public.sync_shift_status_coverage_from_daily(v_fecha);
  select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) into v_rows
    from public.employee_shift_status s where scheduled_shift_id = p_shift_id;
  return v_rows;
end;
$$;
revoke all on function public.finalize_shift_attendance(uuid) from public, anon, authenticated;
grant execute on function public.finalize_shift_attendance(uuid) to service_role;

-- ---------------------------------------------------------------- 2. Overtime, manual too
-- Same weekly totals as record_rotation_overtime, but scoped to one employee and an explicit
-- list of weeks, with no dependency on a shift_rotations row: covers manual assignments too.
create or replace function public.recompute_employee_overtime_weeks(p_employee uuid, p_weeks date[])
returns integer language plpgsql security definer set search_path = public as $$
declare v_from date; v_to date; n integer := 0;
begin
  if p_employee is null or p_weeks is null or cardinality(p_weeks) = 0 then return 0; end if;
  select min(w), max(w) + 6 into v_from, v_to from unnest(p_weeks) w;
  with weeks as (
    select distinct public.rotation_week_start(w) wstart from unnest(p_weeks) w
  ), segments as (
    select a.contrato_codigo, a.sede_codigo, a.rotation_id,
      (s.starts_at at time zone 'America/Bogota')::date local_day,
      extract(epoch from (s.ends_at - s.starts_at)) / 60 * public.shift_net_ratio(s.starts_at,s.ends_at,s.almuerzo_minutos) mins
    from public.shift_assignments a
    join public.scheduled_shifts s on s.id = a.scheduled_shift_id
    where a.employee_id = p_employee
      and a.estado not in ('cancelado','reemplazado') and s.estado <> 'cancelado'
      and s.starts_at < ((v_to + 8)::timestamp at time zone 'America/Bogota')
      and s.ends_at > ((v_from - 8)::timestamp at time zone 'America/Bogota')
  ), totals as (
    select w.wstart,
      coalesce(round(sum(g.mins) filter (where g.local_day between w.wstart and w.wstart + 6)),0)::integer worked,
      (array_agg(g.contrato_codigo order by g.local_day desc) filter (where g.local_day between w.wstart and w.wstart + 6))[1] contrato_codigo,
      (array_agg(g.sede_codigo order by g.local_day desc) filter (where g.local_day between w.wstart and w.wstart + 6))[1] sede_codigo,
      (array_agg(g.rotation_id order by g.local_day desc) filter (where g.local_day between w.wstart and w.wstart + 6 and g.rotation_id is not null))[1] rotation_id
    from weeks w
    left join segments g on true
    group by w.wstart
  )
  insert into public.shift_overtime_weeks(employee_id,contrato_codigo,sede_codigo,rotation_id,week_start,worked_minutes,limit_minutes,overtime_minutes)
  select p_employee, coalesce(t.contrato_codigo, e.contrato_codigo), coalesce(t.sede_codigo, e.sede_codigo),
    t.rotation_id, t.wstart, t.worked, public.colombia_weekly_limit_minutes(t.wstart), greatest(0, t.worked - public.colombia_weekly_limit_minutes(t.wstart))
  from totals t
  join public.employees e on e.id = p_employee
  where coalesce(t.contrato_codigo, e.contrato_codigo) is not null
  on conflict (employee_id, week_start) do update set
    contrato_codigo=excluded.contrato_codigo, sede_codigo=excluded.sede_codigo, rotation_id=excluded.rotation_id,
    worked_minutes=excluded.worked_minutes, limit_minutes=excluded.limit_minutes,
    overtime_minutes=excluded.overtime_minutes, computed_at=now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.recompute_employee_overtime_weeks(uuid,date[]) from public,anon;
grant execute on function public.recompute_employee_overtime_weeks(uuid,date[]) to authenticated,service_role;

-- Fires for every assignment change, manual or from a rotation: the trigger is now the one
-- source of truth for shift_overtime_weeks, so apply_shift_rotation no longer needs its own
-- bulk recompute at the end (removed below), and nothing manual is ever missed.
create or replace function public.trg_recompute_overtime_on_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_shift_id uuid := coalesce(new.scheduled_shift_id, old.scheduled_shift_id);
  v_starts_at timestamptz;
  v_week date;
begin
  select starts_at into v_starts_at from public.scheduled_shifts where id = v_shift_id;
  if v_starts_at is null then return coalesce(new, old); end if;
  v_week := public.rotation_week_start((v_starts_at at time zone 'America/Bogota')::date);
  if tg_op = 'DELETE' then
    if old.employee_id is not null then perform public.recompute_employee_overtime_weeks(old.employee_id, array[v_week]); end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.employee_id is not null and old.employee_id is distinct from new.employee_id then
    perform public.recompute_employee_overtime_weeks(old.employee_id, array[v_week]);
  end if;
  if new.employee_id is not null then
    perform public.recompute_employee_overtime_weeks(new.employee_id, array[v_week]);
  end if;
  return new;
end $$;
drop trigger if exists trg_shift_assignments_overtime on public.shift_assignments;
create trigger trg_shift_assignments_overtime
after insert or update or delete on public.shift_assignments
for each row execute function public.trg_recompute_overtime_on_assignment();

-- A retimed shift (rare, but possible before it opens) must also refresh whoever is on it.
create or replace function public.trg_recompute_overtime_on_shift_retime()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_week_old date; v_week_new date; r record;
begin
  if new.starts_at is not distinct from old.starts_at and new.ends_at is not distinct from old.ends_at
     and new.almuerzo_minutos is not distinct from old.almuerzo_minutos then
    return new;
  end if;
  v_week_old := public.rotation_week_start((old.starts_at at time zone 'America/Bogota')::date);
  v_week_new := public.rotation_week_start((new.starts_at at time zone 'America/Bogota')::date);
  for r in select distinct employee_id from public.shift_assignments
    where scheduled_shift_id = new.id and employee_id is not null and estado <> 'cancelado' loop
    perform public.recompute_employee_overtime_weeks(r.employee_id, array[v_week_old, v_week_new]);
  end loop;
  return new;
end $$;
drop trigger if exists trg_scheduled_shifts_overtime on public.scheduled_shifts;
create trigger trg_scheduled_shifts_overtime
after update on public.scheduled_shifts
for each row execute function public.trg_recompute_overtime_on_shift_retime();

-- record_rotation_overtime is kept as-is for bulk/administrative recompute of a whole
-- rotation; it is no longer the only path that fills shift_overtime_weeks.

-- apply_shift_rotation, identical to phase 66 except the trailing bulk overtime recompute:
-- the trigger above already recomputed overtime for every employee/week actually touched by
-- each insert, so recomputing the whole rotation again here was redundant work.
create or replace function public.apply_shift_rotation(p_id uuid, p_activate boolean default false)
returns integer language plpgsql security definer set search_path=public as $$
declare r public.shift_rotations; x record; e public.employees; s public.scheduled_shifts; n integer:=0; v_count integer; v_expected jsonb;
begin
  -- Serialize rotation runs and protect the check/insert window against manual assignments.
  lock table public.scheduled_shifts in share mode;
  lock table public.employees in share mode;
  lock table public.shift_assignments in share row exclusive mode;
  select * into r from public.shift_rotations where id=p_id for update;
  if r.id is null then raise exception 'Rotacion no encontrada'; end if;
  if coalesce(auth.role(),'')<>'service_role' and not coalesce(public.is_admin_like() and public.can_read_contract_data(r.contrato_codigo),false) then raise exception 'Sin permiso'; end if;
  if r.estado<>'activo' and not p_activate then return 0; end if;
  -- With rotating rests or relievers, shifts this rotation assigned that the plan no longer expects (a day that is now rest,
  -- or a relief no longer needed) are released while not started and without attendance.
  if coalesce(r.config->'rules'->>'restMode','fijo')='rotativo'
     or exists(select 1 from jsonb_array_elements(r.config->'members') m where coalesce((m->>'reliever')::boolean,false)) then
    select coalesce(jsonb_agg(jsonb_build_object('e',p.employee_id,'d',p.fecha,'t',p.template_id)),'[]'::jsonb) into v_expected
    from public.preview_shift_rotation(r.contrato_codigo,r.config,(now() at time zone 'America/Bogota')::date+1,(now() at time zone 'America/Bogota')::date+30) p;
    delete from public.employee_shift_status es using public.shift_assignments a, public.scheduled_shifts sh
      where a.rotation_id=r.id and sh.id=a.scheduled_shift_id and es.scheduled_shift_id=sh.id and es.employee_id=a.employee_id
        and sh.starts_at>now() and es.estado_turno='programado' and coalesce(es.asistio,false)=false
        and sh.fecha_operativa between ((now() at time zone 'America/Bogota')::date+1)::text and ((now() at time zone 'America/Bogota')::date+30)::text
        and not exists(select 1 from jsonb_to_recordset(v_expected) as ex(e uuid,d date,t uuid) where ex.e=a.employee_id and ex.d::text=sh.fecha_operativa and ex.t is not distinct from sh.template_id);
    delete from public.shift_assignments a using public.scheduled_shifts sh
      where a.rotation_id=r.id and sh.id=a.scheduled_shift_id and sh.starts_at>now()
        and sh.fecha_operativa between ((now() at time zone 'America/Bogota')::date+1)::text and ((now() at time zone 'America/Bogota')::date+30)::text
        and not exists(select 1 from public.employee_shift_status es where es.scheduled_shift_id=sh.id and es.employee_id=a.employee_id and (coalesce(es.asistio,false) or es.estado_turno<>'programado'))
        and not exists(select 1 from jsonb_to_recordset(v_expected) as ex(e uuid,d date,t uuid) where ex.e=a.employee_id and ex.d::text=sh.fecha_operativa and ex.t is not distinct from sh.template_id);
  end if;
  for x in select * from public.preview_shift_rotation(r.contrato_codigo,r.config,
    (now() at time zone 'America/Bogota')::date+1,(now() at time zone 'America/Bogota')::date+30) loop
    if x.result not in ('Por asignar','Por asignar (sobrante)') then continue; end if;
    select * into s from public.scheduled_shifts where id=x.shift_id for update;
    select * into e from public.employees where id=x.employee_id;
    if s.starts_at<=now() or s.estado<>'programado' then continue; end if;
    -- Recheck capacity and overlaps after each insert; never overwrite a manual row.
    if exists(select 1 from public.shift_assignments a join public.scheduled_shifts sh on sh.id=a.scheduled_shift_id
      where a.employee_id=e.id and a.estado<>'cancelado' and sh.estado<>'cancelado'
      and sh.starts_at<s.ends_at and sh.ends_at>s.starts_at) then continue; end if;
    if x.result='Por asignar' and (select count(*) from public.shift_assignments a where a.scheduled_shift_id=s.id and a.estado<>'cancelado')>=s.operarios_planeados then continue; end if;
    insert into public.shift_assignments(scheduled_shift_id,employee_id,documento,nombre,cargo_codigo,cargo_nombre,sede_codigo,
      contrato_codigo,contrato_nombre,cliente_nombre_snapshot,cliente_nit_snapshot,rotation_id)
    values(s.id,e.id,e.documento,e.nombre,e.cargo_codigo,e.cargo_nombre,s.sede_codigo,
      s.contrato_codigo,s.contrato_nombre,s.cliente_nombre_snapshot,s.cliente_nit_snapshot,r.id) on conflict do nothing;
    get diagnostics v_count = row_count;
    if v_count=0 then continue; end if;
    n:=n+1;
    insert into public.employee_shift_status(id,scheduled_shift_id,fecha_operativa,employee_id,documento,nombre,sede_codigo,
      contrato_codigo,contrato_nombre,cliente_nombre_snapshot,cliente_nit_snapshot,estado_turno,asistio)
    values(s.id::text||'_'||e.id::text,s.id,s.fecha_operativa,e.id,e.documento,e.nombre,s.sede_codigo,
      s.contrato_codigo,s.contrato_nombre,s.cliente_nombre_snapshot,s.cliente_nit_snapshot,'programado',false) on conflict do nothing;
  end loop;
  if p_activate then update public.shift_rotations set estado='activo' where id=r.id; end if;
  return n;
end $$;

-- ---------------------------------------------------------------- 3. Harden rotation input
-- preview_shift_rotation is the only entry point that receives a raw, not-yet-saved config
-- straight from the UI (every other rotation RPC reads r.config, already validated when it
-- was saved). Identical to phase 66 except the initial cast block, now guarded so a malformed
-- value raises the same kind of business message as the rest of the function instead of a
-- raw Postgres cast error.
create or replace function public.preview_shift_rotation(p_contract text, p_config jsonb, p_from date, p_to date)
returns table(fecha date, employee_id uuid, employee_name text, template_id uuid, shift_id uuid, result text)
language plpgsql security definer set search_path = public as $$
declare
  v_start date; v_end date; v_days integer; v_cycle jsonb; v_member jsonb;
  v_rules jsonb := coalesce(p_config->'rules','{}'::jsonb);
  v_unavailable jsonb := coalesce(p_config->'unavailable','[]'::jsonb);
  v_rest numeric; v_daily numeric; v_weekly numeric; v_consecutive integer; v_period jsonb; v_ops jsonb;
begin
  if coalesce(auth.role(),'') <> 'service_role' and not coalesce(public.is_admin_like() and public.can_read_contract_data(p_contract),false) then
    raise exception 'Sin permiso para administrar rotaciones';
  end if;
  begin
    v_start := (p_config->>'start')::date;
    v_end := nullif(p_config->>'end','')::date;
    v_days := (p_config->>'days')::integer;
    v_cycle := p_config->'cycle';
  exception when others then
    raise exception 'Configuracion de rotacion invalida: %', sqlerrm;
  end;
  if v_start is null or v_days is null or v_days not between 1 and 28
     or jsonb_typeof(v_cycle) is distinct from 'array' then raise exception 'Ciclo invalido'; end if;
  if jsonb_array_length(v_cycle) not between 1 and 28 or (v_end is not null and v_end < v_start)
     or p_from is null or p_to is null or p_to < p_from or p_to-p_from > 370 then raise exception 'Vigencia invalida'; end if;
  if not exists(select 1 from jsonb_array_elements_text(v_cycle) value where value is not null) then raise exception 'El ciclo requiere un plan'; end if;
  if jsonb_typeof(p_config->'members') is distinct from 'array' then raise exception 'Faltan empleados'; end if;
  if jsonb_array_length(p_config->'members') not between 1 and 200 then raise exception 'Selecciona entre 1 y 200 empleados'; end if;
  if not exists(select 1 from public.sedes s where s.codigo=p_config->>'site' and s.contrato_codigo=p_contract and s.estado='activo') then
    raise exception 'La sede no pertenece al contrato activo';
  end if;
  if exists(select 1 from jsonb_array_elements_text(v_cycle) x where x is not null and not exists(
    select 1 from public.shift_templates t where t.id=x::uuid and t.contrato_codigo=p_contract and t.estado='activo')) then
    raise exception 'Un plan no pertenece al contrato o esta inactivo';
  end if;
  if (select count(*) from jsonb_array_elements(p_config->'members')) <>
     (select count(distinct x->>'employee') from jsonb_array_elements(p_config->'members') x) then raise exception 'Empleado duplicado'; end if;
  for v_member in select value from jsonb_array_elements(p_config->'members') loop
    if (v_member->>'offset') is null or (v_member->>'offset')::integer not between 0 and jsonb_array_length(v_cycle)-1 then raise exception 'Posicion de equipo invalida'; end if;
    if not exists(select 1 from public.employees e where e.id=(v_member->>'employee')::uuid
      and e.contrato_codigo=p_contract and e.sede_codigo=p_config->>'site' and e.estado='activo') then
      raise exception 'Empleado fuera de la sede o contrato, o inactivo';
    end if;
  end loop;
  if jsonb_typeof(v_rules) is distinct from 'object' or jsonb_typeof(v_unavailable) is distinct from 'array' then
    raise exception 'Reglas o indisponibilidades invalidas';
  end if;
  if v_rules ? 'weeklyRestDays' then
    if jsonb_typeof(v_rules->'weeklyRestDays') is distinct from 'object' then raise exception 'Descansos semanales invalidos'; end if;
    if exists(select 1 from jsonb_each(v_rules->'weeklyRestDays') d
      where jsonb_typeof(d.value) <> 'number' or d.value::text !~ '^[0-6]$'
        or not exists(select 1 from jsonb_array_elements(p_config->'members') m where m->>'employee'=d.key)) then
      raise exception 'Dia de descanso invalido o empleado fuera del equipo';
    end if;
  end if;
  if exists(select 1 from jsonb_array_elements(p_config->'members') m where m ? 'reliever' and jsonb_typeof(m->'reliever') not in ('boolean','null')) then
    raise exception 'Relevo invalido';
  end if;
  if v_rules ? 'restMode' and v_rules->>'restMode' not in ('fijo','rotativo') then raise exception 'Modo de descanso invalido'; end if;
  if v_rules ? 'restPlan' and jsonb_typeof(v_rules->'restPlan') is distinct from 'object' then raise exception 'Plan de descansos invalido'; end if;
  if v_rules ? 'surplusPlan' and jsonb_typeof(v_rules->'surplusPlan') is distinct from 'object' then raise exception 'Plan de sobrantes invalido'; end if;
  v_rest := coalesce((v_rules->>'minRestHours')::numeric,0);
  v_daily := coalesce((v_rules->>'maxDailyHours')::numeric,0);
  v_weekly := coalesce((v_rules->>'maxWeeklyHours')::numeric,0);
  v_consecutive := coalesce((v_rules->>'maxConsecutiveDays')::integer,0);
  if v_rest not between 0 and 72 or v_daily not between 0 and 24 or v_weekly not between 0 and 168
     or v_consecutive not between 0 and 31 then raise exception 'Limites fuera de rango'; end if;
  if jsonb_array_length(v_unavailable)>200 then raise exception 'Demasiados periodos de indisponibilidad'; end if;
  for v_period in select value from jsonb_array_elements(v_unavailable) loop
    if nullif(v_period->>'from','') is null or nullif(v_period->>'to','') is null
       or (v_period->>'to')::date < (v_period->>'from')::date
       or not exists(select 1 from jsonb_array_elements(p_config->'members') m where m->>'employee'=v_period->>'employee') then
      raise exception 'Periodo de indisponibilidad invalido o empleado fuera del equipo';
    end if;
  end loop;
  select coalesce(jsonb_object_agg(t, to_jsonb(public.shift_template_operating_days(t::uuid))), '{}'::jsonb) into v_ops
  from (select distinct value t from jsonb_array_elements_text(v_cycle) value where value is not null) x;
  return query
  with days as (
    select d::date as work_date from generate_series(greatest(p_from-32,v_start)::timestamp,
      least(p_to+32,coalesce(v_end,p_to+32))::timestamp,interval '1 day') d
  ), rest as materialized (
    select * from public.shift_rotation_rest_days(p_config,greatest(p_from-32,v_start),least(p_to+32,coalesce(v_end,p_to+32)))
  ), relief as materialized (
    select * from public.shift_rotation_relief(p_config,greatest(p_from-32,v_start),least(p_to+32,coalesce(v_end,p_to+32)))
  ), expected as (
    select work_date, e.id eid, e.nombre ename,
      case when coalesce((m->>'reliever')::boolean,false) then
             case when exists(select 1 from relief rf where rf.employee_id=e.id and rf.work_date=days.work_date) then null else 'relevo' end
           else (select r.kind from rest r where r.employee_id=e.id and r.rest_date=work_date limit 1) end rkind,
      coalesce((select rf.surplus from relief rf where rf.employee_id=e.id and rf.work_date=days.work_date limit 1),false) surplus,
      case when coalesce((m->>'reliever')::boolean,false) then (select rf.template_id from relief rf where rf.employee_id=e.id and rf.work_date=days.work_date limit 1)
        when exists(select 1 from rest r where r.employee_id=e.id and r.rest_date=days.work_date) then null
        else (select q.t from (select (v_cycle->>((((days.work_date-public.rotation_cycle_origin(v_start,v_days))/v_days)+(m->>'offset')::integer)%jsonb_array_length(v_cycle)))::uuid t) q
              where coalesce(v_ops->(q.t::text),'[0,1,2,3,4,5,6]'::jsonb) @> to_jsonb(extract(dow from days.work_date)::integer)) end tid
    from days cross join jsonb_array_elements(p_config->'members') m
    join public.employees e on e.id=(m->>'employee')::uuid
  ), candidates as (
    select x.*, s.id sid, s.starts_at, s.ends_at, s.estado, s.operarios_planeados, s.almuerzo_minutos lunch
    from expected x left join public.scheduled_shifts s on s.template_id=x.tid and s.sede_codigo=p_config->>'site'
      and s.contrato_codigo=p_contract and s.fecha_operativa=x.work_date::text and s.estado <> 'cancelado'
  ), workload as materialized (
    -- Include existing assignments across contracts; a person cannot rest twice.
    -- UNION avoids counting an existing assignment again as a proposed shift.
    select c.eid,c.sid,c.starts_at,c.ends_at,c.lunch from candidates c
      where c.sid is not null and c.estado='programado' and c.starts_at>now()
      and not exists(select 1 from rest rd where rd.employee_id=c.eid and rd.rest_date between (c.starts_at at time zone 'America/Bogota')::date and ((c.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date)
      and not exists(select 1 from public.shift_assignments a where a.employee_id=c.eid and a.scheduled_shift_id=c.sid
        and a.estado not in ('cancelado','reemplazado'))
    union
    select a.employee_id,s.id,s.starts_at,s.ends_at,s.almuerzo_minutos
    from public.shift_assignments a join public.scheduled_shifts s on s.id=a.scheduled_shift_id
    where a.estado not in ('cancelado','reemplazado') and s.estado<>'cancelado'
      and a.employee_id in (select (m->>'employee')::uuid from jsonb_array_elements(p_config->'members') m)
      -- Assignments a rotation made on a day that is now a rest day will be replaced: they are reported on their own
      -- ('Revisar asignacion existente') and must not also break the limits of the neighbouring days.
      and not (a.rotation_id is not null and exists(select 1 from rest rd where rd.employee_id=a.employee_id
        and rd.rest_date between (s.starts_at at time zone 'America/Bogota')::date and ((s.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date))
      and s.starts_at < ((p_to+33)::timestamp at time zone 'America/Bogota')
      and s.ends_at > ((p_from-32)::timestamp at time zone 'America/Bogota')
  ), daily as materialized (
    select w.eid,d.work_day::date as local_day,
      sum(extract(epoch from least(w.ends_at,(d.work_day+interval '1 day') at time zone 'America/Bogota')
        - greatest(w.starts_at,d.work_day at time zone 'America/Bogota'))/3600 * public.shift_net_ratio(w.starts_at,w.ends_at,w.lunch)) hours
    from workload w cross join lateral generate_series(
      (w.starts_at at time zone 'America/Bogota')::date::timestamp,
      ((w.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date::timestamp,interval '1 day') d(work_day)
    group by w.eid,d.work_day
  ), weekly as (
    select eid,public.rotation_week_start(local_day) week_start,sum(hours) hours from daily group by eid,public.rotation_week_start(local_day)
  ), streak_days as (
    select eid,local_day,local_day-(row_number() over(partition by eid order by local_day))::integer as streak from daily
  ), streaks as (
    select eid,min(local_day) first_day,max(local_day) last_day,count(*) worked_days from streak_days group by eid,streak
  )
  select c.work_date,c.eid,c.ename,c.tid,c.sid,
    case
      when c.tid is null then case
        when c.rkind is not null then
          case when exists(select 1 from public.shift_assignments a join public.scheduled_shifts sh on sh.id=a.scheduled_shift_id
            where a.employee_id=c.eid and a.estado not in ('cancelado','reemplazado') and sh.estado<>'cancelado'
              and (sh.starts_at at time zone 'America/Bogota')::date = c.work_date)
            then 'Revisar asignacion existente: Descanso ' || c.rkind else 'Descanso ' || c.rkind end
        else 'Descanso' end
      when c.sid is null then 'Sin turno generado'
      when c.starts_at <= now() or c.estado <> 'programado' then 'Historico o iniciado'
      when exists(select 1 from rest rd where rd.employee_id=c.eid and rd.rest_date between (c.starts_at at time zone 'America/Bogota')::date and ((c.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date) then
        case when exists(select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=c.eid and a.estado not in ('cancelado','reemplazado'))
          then 'Revisar asignacion existente: Descanso ' || (select rd.kind from rest rd where rd.employee_id=c.eid
            and rd.rest_date between (c.starts_at at time zone 'America/Bogota')::date and ((c.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date limit 1)
          else 'Descanso ' || (select rd.kind from rest rd where rd.employee_id=c.eid
            and rd.rest_date between (c.starts_at at time zone 'America/Bogota')::date and ((c.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date limit 1) || ' (cruce nocturno)' end
      when exists(select 1 from jsonb_array_elements(v_unavailable) u
        where (u->>'employee')::uuid=c.eid
        and c.starts_at < (((u->>'to')::date+1)::timestamp at time zone 'America/Bogota')
        and c.ends_at > ((u->>'from')::date::timestamp at time zone 'America/Bogota')) then case when exists(select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=c.eid)
          then 'Revisar asignacion existente: Empleado no disponible' else 'Empleado no disponible' end
      when v_rest>0 and exists(select 1 from workload w where w.eid=c.eid and w.sid<>c.sid
        and w.starts_at < c.ends_at+make_interval(secs=>(v_rest*3600)::double precision)
        and w.ends_at > c.starts_at-make_interval(secs=>(v_rest*3600)::double precision)) then case when exists(select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=c.eid)
          then 'Revisar asignacion existente: Descanso minimo insuficiente' else 'Descanso minimo insuficiente' end
      when v_daily>0 and exists(select 1 from daily d where d.eid=c.eid and d.hours>v_daily
        and d.local_day between (c.starts_at at time zone 'America/Bogota')::date
          and ((c.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date) then case when exists(select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=c.eid)
          then 'Revisar asignacion existente: Limite de horas diarias' else 'Limite de horas diarias' end
      when v_weekly>0 and exists(select 1 from weekly w where w.eid=c.eid and w.hours>v_weekly
        and w.week_start between public.rotation_week_start((c.starts_at at time zone 'America/Bogota')::date)
          and public.rotation_week_start(((c.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date)) then
        (case when exists(select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=c.eid)
          then 'Revisar asignacion existente: ' else '' end)
        || 'Limite semanal: '
        || (select trim(to_char(w.hours,'FM999999990.##')) from weekly w
            where w.eid=c.eid and w.hours>v_weekly
              and w.week_start between public.rotation_week_start((c.starts_at at time zone 'America/Bogota')::date)
                and public.rotation_week_start(((c.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date)
            order by w.hours desc limit 1)
        || ' h programadas / ' || trim(to_char(v_weekly,'FM999999990.##')) || ' h permitidas'
      when v_consecutive>0 and exists(select 1 from streaks st where st.eid=c.eid and st.worked_days>v_consecutive
        and st.first_day<=((c.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date
        and st.last_day>=(c.starts_at at time zone 'America/Bogota')::date) then case when exists(select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=c.eid)
          then 'Revisar asignacion existente: ' else '' end
        || 'Limite de dias consecutivos: ' || (select st.worked_days from streaks st where st.eid=c.eid and st.worked_days>v_consecutive and st.first_day<=((c.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date and st.last_day>=(c.starts_at at time zone 'America/Bogota')::date order by st.worked_days desc limit 1) || ' dias seguidos / ' || v_consecutive || ' permitidos'
      when exists(select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=c.eid) then 'Asignacion existente'
      when exists(select 1 from public.shift_assignments a join public.scheduled_shifts s on s.id=a.scheduled_shift_id
        where a.employee_id=c.eid and a.estado not in ('cancelado','reemplazado') and s.estado <> 'cancelado'
        and s.starts_at < c.ends_at and s.ends_at > c.starts_at) then
        'Cruce con otra asignacion: ' || (select coalesce('rotacion ' || ro.nombre, 'asignacion manual') || ' de '
          || to_char(s.starts_at at time zone 'America/Bogota','HH24:MI') || ' a ' || to_char(s.ends_at at time zone 'America/Bogota','HH24:MI')
          || ' (' || to_char(s.starts_at at time zone 'America/Bogota','DD/MM') || ')'
          from public.shift_assignments a join public.scheduled_shifts s on s.id=a.scheduled_shift_id
          left join public.shift_rotations ro on ro.id=a.rotation_id
          where a.employee_id=c.eid and a.estado not in ('cancelado','reemplazado') and s.estado <> 'cancelado'
            and s.starts_at < c.ends_at and s.ends_at > c.starts_at order by s.starts_at limit 1)
      when exists(select 1 from candidates other where other.eid=c.eid and other.sid<>c.sid
        and not exists(select 1 from rest rd where rd.employee_id=other.eid and rd.rest_date between (other.starts_at at time zone 'America/Bogota')::date and ((other.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date)
        and other.starts_at<c.ends_at and other.ends_at>c.starts_at) then 'Cruce dentro del ciclo'
      when not c.surplus and (select count(*) from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.estado not in ('cancelado','reemplazado'))
         + (select count(*) from candidates other where other.sid=c.sid and not other.surplus and not exists(
             select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=other.eid
               and a.estado not in ('cancelado','reemplazado'))
             and not exists(select 1 from rest rd where rd.employee_id=other.eid and rd.rest_date between (other.starts_at at time zone 'America/Bogota')::date and ((other.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date)
             and not exists(select 1 from jsonb_array_elements(v_unavailable) u2 where (u2->>'employee')::uuid=other.eid
               and other.starts_at < (((u2->>'to')::date+1)::timestamp at time zone 'America/Bogota')
               and other.ends_at > ((u2->>'from')::date::timestamp at time zone 'America/Bogota'))) > c.operarios_planeados then
        'Cupo insuficiente: ' || ((select count(*) from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.estado not in ('cancelado','reemplazado'))
           + (select count(*) from candidates other where other.sid=c.sid and not other.surplus and not exists(
               select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=other.eid
                 and a.estado not in ('cancelado','reemplazado'))
               and not exists(select 1 from rest rd where rd.employee_id=other.eid and rd.rest_date between (other.starts_at at time zone 'America/Bogota')::date and ((other.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date))) || ' personas en el turno para ' || c.operarios_planeados || ' cupos'
      when c.surplus then 'Por asignar (sobrante)'
      else 'Por asignar'
    end::text
  from candidates c where c.work_date between p_from and p_to order by c.work_date,c.ename,c.starts_at;
end $$;

revoke all on function public.preview_shift_rotation(text,jsonb,date,date) from public,anon;
grant execute on function public.preview_shift_rotation(text,jsonb,date,date) to authenticated,service_role;
revoke all on function public.apply_shift_rotation(uuid,boolean) from public,anon;
grant execute on function public.apply_shift_rotation(uuid,boolean) to authenticated,service_role;
commit;
