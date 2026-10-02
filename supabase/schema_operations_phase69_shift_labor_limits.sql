-- Phase 69: opt-in labor-compliance limits per shift plan (weekly hours, minimum rest,
-- max consecutive work days, weekly-rest alert), applied to ANY shift regardless of
-- whether a rotation exists.
-- Apply after phase 68. Existing configurations and assignments are preserved.
--
-- These columns mirror the existing ventana_*/alerta_* per-plan-control pattern on
-- shift_template_rules: they are set once per plan (ShiftsAdmin.js openPlanModal) and
-- stamped on every rule row of that plan. limite_horas_semanales/limite_descanso_horas/
-- limite_dias_consecutivos are nullable with no default: unconfigured (NULL) means
-- "use the Colombian legal weekly default (colombia_weekly_limit) for hours, or no
-- limit at all for rest/consecutive days" -- see preview_shift_rotation below and
-- checkShiftLaborLimits in ShiftsAdmin.js (client side), which both apply the exact
-- same fallback so every plan is protected even if nobody configured it.
--
-- Rotaciones no longer keeps its own separate minRestHours/maxWeeklyHours/
-- maxConsecutiveDays in shift_rotations.config->rules: preview_shift_rotation now
-- resolves these from the plan(s) used in the rotation's cycle instead, so there is a
-- single source of truth. maxDailyHours is removed without replacement (shift duration
-- is already bounded by hora_inicio/hora_fin at plan level). weeklyRestDays (fixed rest
-- day per employee, for team coverage) is untouched -- that is a rotation-only concern.
begin;

alter table public.shift_template_rules
  add column if not exists limite_horas_semanales numeric,
  add column if not exists limite_descanso_horas numeric,
  add column if not exists limite_dias_consecutivos integer,
  add column if not exists alerta_descanso_semanal boolean not null default false;

alter table public.shift_template_rules
  drop constraint if exists shift_template_rules_limite_horas_semanales_check,
  drop constraint if exists shift_template_rules_limite_descanso_horas_check,
  drop constraint if exists shift_template_rules_limite_dias_consecutivos_check;

alter table public.shift_template_rules
  add constraint shift_template_rules_limite_horas_semanales_check
    check (limite_horas_semanales is null or limite_horas_semanales between 1 and 168),
  add constraint shift_template_rules_limite_descanso_horas_check
    check (limite_descanso_horas is null or limite_descanso_horas between 0 and 72),
  add constraint shift_template_rules_limite_dias_consecutivos_check
    check (limite_dias_consecutivos is null or limite_dias_consecutivos between 1 and 31);

-- Mirrors src/assets/js/utils/rotationHours.js COLOMBIA_WEEKLY_LIMITS / colombiaWeeklyLimit.
-- Keep both in sync: this is a duplicated legal constant (Ley 2101 de 2021), not
-- duplicated business logic -- the JS copy drives the browser UI, this one drives
-- preview_shift_rotation server-side.
create or replace function public.colombia_weekly_limit(p_date date)
returns numeric language sql immutable as $$
  select case
    when p_date >= '2026-07-15' then 42
    when p_date >= '2025-07-15' then 44
    when p_date >= '2024-07-15' then 46
    when p_date >= '2023-07-15' then 47
    else 48
  end
$$;
revoke all on function public.colombia_weekly_limit(date) from public,anon;
grant execute on function public.colombia_weekly_limit(date) to authenticated,service_role;

create or replace function public.preview_shift_rotation(p_contract text, p_config jsonb, p_from date, p_to date)
returns table(fecha date, employee_id uuid, employee_name text, template_id uuid, shift_id uuid, result text)
language plpgsql security definer set search_path = public as $$
declare
  v_start date; v_end date; v_days integer; v_cycle jsonb; v_member jsonb;
  v_rules jsonb := coalesce(p_config->'rules','{}'::jsonb);
  v_unavailable jsonb := coalesce(p_config->'unavailable','[]'::jsonb);
  v_period jsonb;
begin
  if coalesce(auth.role(),'') <> 'service_role' and not coalesce(public.is_admin_like() and public.can_read_contract_data(p_contract),false) then
    raise exception 'Sin permiso para administrar rotaciones';
  end if;
  v_start := (p_config->>'start')::date;
  v_end := nullif(p_config->>'end','')::date;
  v_days := (p_config->>'days')::integer;
  v_cycle := p_config->'cycle';
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
  if jsonb_array_length(v_unavailable)>200 then raise exception 'Demasiados periodos de indisponibilidad'; end if;
  for v_period in select value from jsonb_array_elements(v_unavailable) loop
    if nullif(v_period->>'from','') is null or nullif(v_period->>'to','') is null
       or (v_period->>'to')::date < (v_period->>'from')::date
       or not exists(select 1 from jsonb_array_elements(p_config->'members') m where m->>'employee'=v_period->>'employee') then
      raise exception 'Periodo de indisponibilidad invalido o empleado fuera del equipo';
    end if;
  end loop;
  return query
  with days as (
    select d::date as work_date from generate_series(greatest(p_from-32,v_start)::timestamp,
      least(p_to+32,coalesce(v_end,p_to+32))::timestamp,interval '1 day') d
  ), expected as (
    select work_date, e.id eid, e.nombre ename,
      case when (v_rules->'weeklyRestDays'->>(m->>'employee'))::integer = extract(dow from work_date)::integer then null
        else (v_cycle->>((((work_date-v_start)/v_days)+(m->>'offset')::integer)%jsonb_array_length(v_cycle)))::uuid end tid
    from days cross join jsonb_array_elements(p_config->'members') m
    join public.employees e on e.id=(m->>'employee')::uuid
  ), candidates as (
    select x.*, s.id sid, s.starts_at, s.ends_at, s.estado, s.operarios_planeados
    from expected x left join public.scheduled_shifts s on s.template_id=x.tid and s.sede_codigo=p_config->>'site'
      and s.contrato_codigo=p_contract and s.fecha_operativa=x.work_date::text and s.estado <> 'cancelado'
  ), workload as materialized (
    -- Include existing assignments across contracts; a person cannot rest twice.
    -- UNION avoids counting an existing assignment again as a proposed shift.
    select c.eid,c.sid,c.starts_at,c.ends_at,c.tid from candidates c
      where c.sid is not null and c.estado='programado' and c.starts_at>now()
      and not public.shift_rotation_rest_overlap(p_config,c.eid,c.starts_at,c.ends_at)
      and not exists(select 1 from public.shift_assignments a where a.employee_id=c.eid and a.scheduled_shift_id=c.sid
        and a.estado not in ('cancelado','reemplazado'))
    union
    select a.employee_id,s.id,s.starts_at,s.ends_at,s.template_id
    from public.shift_assignments a join public.scheduled_shifts s on s.id=a.scheduled_shift_id
    where a.estado not in ('cancelado','reemplazado') and s.estado<>'cancelado'
      and a.employee_id in (select (m->>'employee')::uuid from jsonb_array_elements(p_config->'members') m)
      and s.starts_at < ((p_to+33)::timestamp at time zone 'America/Bogota')
      and s.ends_at > ((p_from-32)::timestamp at time zone 'America/Bogota')
  ), template_limits as (
    -- Resolves the labor limits from the plan(s) actually touched by this employee's
    -- workload (cycle candidates + real existing assignments), not only p_config. A
    -- plan's limits are stamped identically on every one of its shift_template_rules
    -- rows, so min() here just collapses to one row per template_id.
    select w.tid as template_id,
      min(r.limite_horas_semanales) as limite_horas_semanales,
      min(r.limite_descanso_horas) as limite_descanso_horas,
      min(r.limite_dias_consecutivos) as limite_dias_consecutivos
    from (select distinct tid from workload where tid is not null) w
    left join public.shift_template_rules r on r.template_id=w.tid and r.estado='activo'
    group by w.tid
  ), daily as materialized (
    select w.eid,d.work_day::date as local_day,
      sum(extract(epoch from least(w.ends_at,(d.work_day+interval '1 day') at time zone 'America/Bogota')
        - greatest(w.starts_at,d.work_day at time zone 'America/Bogota'))/3600) hours
    from workload w cross join lateral generate_series(
      (w.starts_at at time zone 'America/Bogota')::date::timestamp,
      ((w.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date::timestamp,interval '1 day') d(work_day)
    group by w.eid,d.work_day
  ), daily_templates as materialized (
    select distinct w.eid, d.work_day::date as local_day, w.tid
    from workload w cross join lateral generate_series(
      (w.starts_at at time zone 'America/Bogota')::date::timestamp,
      ((w.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date::timestamp,interval '1 day') d(work_day)
    where w.tid is not null
  ), weekly as (
    select d.eid,date_trunc('week',d.local_day)::date week_start,sum(d.hours) hours,
      coalesce(min(tl.limite_horas_semanales),public.colombia_weekly_limit(date_trunc('week',d.local_day)::date)) as limite
    from daily d
    left join daily_templates dt on dt.eid=d.eid and dt.local_day=d.local_day
    left join template_limits tl on tl.template_id=dt.tid
    group by d.eid,date_trunc('week',d.local_day)
  ), streak_days as (
    select eid,local_day,local_day-(row_number() over(partition by eid order by local_day))::integer as streak from daily
  ), streaks as (
    select eid,min(local_day) first_day,max(local_day) last_day,count(*) worked_days from streak_days group by eid,streak
  )
  select c.work_date,c.eid,c.ename,c.tid,c.sid,
    case
      when c.tid is null then case
        when (v_rules->'weeklyRestDays'->>c.eid::text)::integer = extract(dow from c.work_date)::integer then
          case when exists(select 1 from public.shift_assignments a join public.scheduled_shifts sh on sh.id=a.scheduled_shift_id
            where a.employee_id=c.eid and a.estado not in ('cancelado','reemplazado') and sh.estado<>'cancelado'
              and sh.starts_at < ((c.work_date+1)::timestamp at time zone 'America/Bogota')
              and sh.ends_at > (c.work_date::timestamp at time zone 'America/Bogota'))
            then 'Revisar asignacion existente: Descanso semanal' else 'Descanso semanal' end
        else 'Descanso' end
      when c.sid is null then 'Sin turno generado'
      when c.starts_at <= now() or c.estado <> 'programado' then 'Historico o iniciado'
      when public.shift_rotation_rest_overlap(p_config,c.eid,c.starts_at,c.ends_at) then
        case when exists(select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=c.eid and a.estado not in ('cancelado','reemplazado'))
          then 'Revisar asignacion existente: Descanso semanal' else 'Descanso semanal (cruce nocturno)' end
      when exists(select 1 from jsonb_array_elements(v_unavailable) u
        where (u->>'employee')::uuid=c.eid
        and c.starts_at < (((u->>'to')::date+1)::timestamp at time zone 'America/Bogota')
        and c.ends_at > ((u->>'from')::date::timestamp at time zone 'America/Bogota')) then case when exists(select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=c.eid)
          then 'Revisar asignacion existente: Empleado no disponible' else 'Empleado no disponible' end
      when exists(select 1 from workload w where w.eid=c.eid and w.sid<>c.sid
        and w.starts_at < c.ends_at+make_interval(secs=>((select tl.limite_descanso_horas from template_limits tl where tl.template_id=c.tid)*3600)::double precision)
        and w.ends_at > c.starts_at-make_interval(secs=>((select tl.limite_descanso_horas from template_limits tl where tl.template_id=c.tid)*3600)::double precision)) then case when exists(select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=c.eid)
          then 'Revisar asignacion existente: Descanso minimo insuficiente' else 'Descanso minimo insuficiente' end
      when exists(select 1 from weekly w where w.eid=c.eid and w.hours>w.limite+colombia_max_weekly_overtime()
        and w.week_start between date_trunc('week',c.starts_at at time zone 'America/Bogota')::date
          and date_trunc('week',(c.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date) then
        (case when exists(select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=c.eid)
          then 'Revisar asignacion existente: ' else '' end)
        || 'Limite semanal: '
        || (select trim(to_char(w.hours,'FM999999990.##')) from weekly w
            where w.eid=c.eid and w.hours>w.limite+colombia_max_weekly_overtime()
              and w.week_start between date_trunc('week',c.starts_at at time zone 'America/Bogota')::date
                and date_trunc('week',(c.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date
            order by w.hours desc limit 1)
        || ' h programadas / ' || (select trim(to_char(w.limite+colombia_max_weekly_overtime(),'FM999999990.##')) from weekly w
              where w.eid=c.eid and w.hours>w.limite+colombia_max_weekly_overtime()
                and w.week_start between date_trunc('week',c.starts_at at time zone 'America/Bogota')::date
                  and date_trunc('week',(c.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date
              order by w.hours desc limit 1) || ' h permitidas'
      when exists(select 1 from streaks st where st.eid=c.eid
        and st.worked_days > (select min(tl.limite_dias_consecutivos) from daily_templates dt join template_limits tl on tl.template_id=dt.tid
            where dt.eid=st.eid and dt.local_day between st.first_day and st.last_day)
        and st.first_day<=((c.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date
        and st.last_day>=(c.starts_at at time zone 'America/Bogota')::date) then case when exists(select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=c.eid)
          then 'Revisar asignacion existente: Limite de dias consecutivos' else 'Limite de dias consecutivos' end
      when exists(select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=c.eid) then 'Asignacion existente'
      when exists(select 1 from public.shift_assignments a join public.scheduled_shifts s on s.id=a.scheduled_shift_id
        where a.employee_id=c.eid and a.estado not in ('cancelado','reemplazado') and s.estado <> 'cancelado'
        and s.starts_at < c.ends_at and s.ends_at > c.starts_at) then 'Cruce con otra asignacion'
      when exists(select 1 from candidates other where other.eid=c.eid and other.sid<>c.sid
        and not public.shift_rotation_rest_overlap(p_config,other.eid,other.starts_at,other.ends_at)
        and other.starts_at<c.ends_at and other.ends_at>c.starts_at) then 'Cruce dentro del ciclo'
      when (select count(*) from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.estado not in ('cancelado','reemplazado'))
         + (select count(*) from candidates other where other.sid=c.sid and not exists(
             select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=other.eid
               and a.estado not in ('cancelado','reemplazado'))
             and not public.shift_rotation_rest_overlap(p_config,other.eid,other.starts_at,other.ends_at)) > c.operarios_planeados then 'Cupo insuficiente'
      else 'Por asignar'
    end::text
  from candidates c where c.work_date between p_from and p_to order by c.work_date,c.ename,c.starts_at;
end $$;

-- Small helper so the CASE expression above stays readable; mirrors
-- COLOMBIA_MAX_WEEKLY_OVERTIME in rotationHours.js (Art. 22 Ley 50 de 1990).
create or replace function public.colombia_max_weekly_overtime()
returns numeric language sql immutable as $$ select 12 $$;
revoke all on function public.colombia_max_weekly_overtime() from public,anon;
grant execute on function public.colombia_max_weekly_overtime() to authenticated,service_role;

create or replace function public.shift_rotation_rules_version()
returns integer language sql stable as $$select 70$$;
revoke all on function public.shift_rotation_rules_version() from public,anon;
grant execute on function public.shift_rotation_rules_version() to authenticated,service_role;

commit;
