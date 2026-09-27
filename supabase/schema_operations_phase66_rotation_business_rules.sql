-- Phase 66: business rules for rotations.
--   1. Lunch per shift rule; shifts keep a copy so hours are net of lunch.
--   2. Weekly rest per week: rotating rest days, compensatory day after Sunday work, swaps between employees and moves.
--   3. Weekly overtime recorded per employee and week (Colombian weekly limit).
--   4. Optional replacement of the manual schedule when a rotation is activated.
-- Weeks run from Sunday to Saturday (42 h: Sunday plus five weekdays). Whoever is planned to work Sunday rests one day of
-- that same week; whoever does not work Sunday already rested and nothing extra is owed: no rule looks at the previous week.
-- Apply after phase 64. Existing rotations keep the fixed weekly rest ("fijo") until switched to "rotativo".
-- Existing assignments are never moved or deleted by this migration.
begin;

-- ---------------------------------------------------------------- 1. Lunch
do $$
begin
  if to_regclass('public.shift_template_rules') is not null
     and not exists (select 1 from information_schema.columns
       where table_schema='public' and table_name='shift_template_rules' and column_name='almuerzo_minutos') then
    alter table public.shift_template_rules
      add column almuerzo_minutos integer not null default 60 check (almuerzo_minutos between 0 and 240);
    -- Short shifts (under 6 hours) normally have no lunch; the administrator can edit the value afterwards.
    update public.shift_template_rules
    set almuerzo_minutos = 0
    where (extract(epoch from (hora_fin - hora_inicio)) + case when cruza_dia then 86400 else 0 end) / 3600 < 6;
  end if;
  if to_regclass('public.scheduled_shifts') is not null
     and not exists (select 1 from information_schema.columns
       where table_schema='public' and table_name='scheduled_shifts' and column_name='almuerzo_minutos') then
    alter table public.scheduled_shifts
      add column almuerzo_minutos integer not null default 0 check (almuerzo_minutos between 0 and 240);
    if to_regclass('public.shift_template_rules') is not null then
      update public.scheduled_shifts s set almuerzo_minutos = r.almuerzo_minutos
      from public.shift_template_rules r
      where s.template_rule_id = r.id and s.almuerzo_minutos is distinct from r.almuerzo_minutos;
    end if;
  end if;
end
$$;

-- Fraction of a shift that is worked time (1 - lunch / duration).
create or replace function public.shift_net_ratio(p_start timestamptz, p_end timestamptz, p_lunch integer)
returns numeric language sql immutable as $$
  select case when p_end <= p_start then 0::numeric
    else greatest(0::numeric, 1 - coalesce(p_lunch,0) * 60.0 / extract(epoch from (p_end - p_start))) end
$$;

-- First day (Sunday) of the week of a date. Weeks run from Sunday to Saturday.
create or replace function public.rotation_week_start(p_date date)
returns date language sql immutable as $$ select p_date - extract(dow from p_date)::integer $$;
revoke all on function public.rotation_week_start(date) from public,anon;
grant execute on function public.rotation_week_start(date) to authenticated,service_role;

-- Where the cycle counts its stages from. Stages of whole weeks (7, 14, 21, 28 days) change on Sunday, the first day of the
-- week, whatever the start date is; the validity (start / end) still uses the real dates.
create or replace function public.rotation_cycle_origin(p_start date, p_days integer)
returns date language sql immutable as $$ select case when p_days % 7 = 0 then public.rotation_week_start(p_start) else p_start end $$;
revoke all on function public.rotation_cycle_origin(date,integer) from public,anon;
grant execute on function public.rotation_cycle_origin(date,integer) to authenticated,service_role;

-- Ordinary weekly limit in Colombia (Law 2101 of 2021), in minutes, for the week starting on p_date.
create or replace function public.colombia_weekly_limit_minutes(p_date date)
returns integer language sql immutable as $$
  select (case when p_date >= date '2026-07-15' then 42 when p_date >= date '2025-07-15' then 44
    when p_date >= date '2024-07-15' then 46 when p_date >= date '2023-07-15' then 47 else 48 end) * 60
$$;
revoke all on function public.shift_net_ratio(timestamptz,timestamptz,integer) from public,anon;
revoke all on function public.colombia_weekly_limit_minutes(date) from public,anon;
grant execute on function public.shift_net_ratio(timestamptz,timestamptz,integer) to authenticated,service_role;
grant execute on function public.colombia_weekly_limit_minutes(date) to authenticated,service_role;

-- ---------------------------------------------------------------- 2. Weekly rest
-- Additional rest days (never the rest days of the cycle itself) as a set: one row per employee and rest date.
--   restMode 'fijo'     legacy: the fixed weekday of rules.weeklyRestDays, every week.
--   restMode 'rotativo' weeks run Sunday to Saturday. An employee planned to work Sunday rests one day of that same week
--                       (Monday to Saturday, different every week and spread across the team): a compensatory rest.
--                       Without Sunday work (Sunday is the natural rest) or with another rest in the week nothing is added.
--   rules.restPlan      explicit overrides { employee: { week_start_sunday: { compensatorio: date } } } (swaps and moves).
-- Weekdays (0 = Sunday ... 6 = Saturday) on which a plan has active schedules. Plans without rules: every day.
create or replace function public.shift_template_operating_days(p_template uuid)
returns integer[] language plpgsql stable set search_path=public as $$
declare v_days integer[];
begin
  if p_template is null or to_regclass('public.shift_template_rules') is null then return array[0,1,2,3,4,5,6]; end if;
  execute 'select array_agg(distinct dia_semana::integer) from public.shift_template_rules where template_id=$1 and estado=''activo'' and tipo_dia=''dia_semana'' and dia_semana is not null'
    into v_days using p_template;
  return coalesce(v_days, array[0,1,2,3,4,5,6]);
end $$;
revoke all on function public.shift_template_operating_days(uuid) from public,anon;
grant execute on function public.shift_template_operating_days(uuid) to authenticated,service_role;

create or replace function public.shift_rotation_rest_days(p_config jsonb, p_from date, p_to date)
returns table(employee_id uuid, rest_date date, kind text)
language plpgsql stable set search_path=public as $$
#variable_conflict use_column
declare
  v_start date := (p_config->>'start')::date;
  v_end date := nullif(p_config->>'end','')::date;
  v_days integer := (p_config->>'days')::integer;
  v_cycle jsonb := p_config->'cycle';
  v_len integer := jsonb_array_length(p_config->'cycle');
  v_rules jsonb := coalesce(p_config->'rules','{}'::jsonb);
  v_plan jsonb := coalesce(p_config->'rules'->'restPlan','{}'::jsonb);
  v_first date := greatest(p_from,(p_config->>'start')::date);
  v_last date := least(p_to,coalesce(nullif(p_config->>'end','')::date,p_to));
  v_ops jsonb;
begin
  if v_first > v_last then return; end if;
  if coalesce(v_rules->>'restMode','fijo') <> 'rotativo' then
    return query
      select (m->>'employee')::uuid, d::date, 'semanal'::text
      from generate_series(v_first::timestamp,v_last::timestamp,interval '1 day') d
      cross join jsonb_array_elements(p_config->'members') m
      where not coalesce((m->>'reliever')::boolean,false)
        and (v_rules->'weeklyRestDays'->>(m->>'employee')) is not null
        and (v_rules->'weeklyRestDays'->>(m->>'employee'))::integer = extract(dow from d)::integer;
    return;
  end if;
  select coalesce(jsonb_object_agg(t, to_jsonb(public.shift_template_operating_days(t::uuid))), '{}'::jsonb) into v_ops
  from (select distinct value t from jsonb_array_elements_text(v_cycle) value where value is not null) x;
  return query
  with members as (
    select m->>'employee' eid, (m->>'offset')::integer off,
      (row_number() over (order by (m->>'offset')::integer, m->>'employee') - 1)::integer idx
    from jsonb_array_elements(p_config->'members') m
    where not coalesce((m->>'reliever')::boolean,false)
  ), weeks as (
    select w::date wstart from generate_series(public.rotation_week_start(v_first)::timestamp,public.rotation_week_start(v_last)::timestamp,interval '7 days') w
  ), mw as (
    select mb.eid, mb.off, mb.idx, wk.wstart, ((wk.wstart - public.rotation_week_start(v_start)) / 7) wknum
    from members mb cross join weeks wk
  ), cyc0 as (
    select mw.eid, mw.wstart, (mw.wstart + g) dia, v_cycle->>((((mw.wstart + g) - public.rotation_cycle_origin(v_start,v_days)) / v_days + mw.off) % v_len) tpl
    from mw cross join generate_series(0,6) g
  ), cyc as (
    -- State of each day for each employee: the Sunday before the week and the week itself. A day is rest when the cycle has
    -- no plan or the plan does not operate that weekday (Sunday is then the natural rest).
    select eid, wstart, dia,
      case when dia < v_start or (v_end is not null and dia > v_end) then 'fuera'
           when tpl is null then 'descanso'
           when not (coalesce(v_ops->tpl,'[0,1,2,3,4,5,6]'::jsonb) @> to_jsonb(extract(dow from dia)::integer)) then 'descanso'
           else 'trabajo' end estado
    from cyc0
  ), slots as (
    select mw.*,
      -- Sunday (first day of the week) worked and no other rest in the week: one compensatory rest from Monday to Saturday.
      case when exists(select 1 from cyc c where c.eid=mw.eid and c.wstart=mw.wstart and c.dia=mw.wstart and c.estado='trabajo')
             and not exists(select 1 from cyc c where c.eid=mw.eid and c.wstart=mw.wstart and c.dia>mw.wstart and c.estado='descanso') then 'compensatorio' end kind
    from mw
  )
  select s.eid::uuid,
    coalesce(nullif(v_plan->s.eid->(s.wstart::text)->>s.kind,'')::date, s.wstart + 1 + ((s.idx + s.wknum) % 6)),
    s.kind
  from slots s
  where s.kind is not null
    and coalesce(nullif(v_plan->s.eid->(s.wstart::text)->>s.kind,'')::date, s.wstart + 1 + ((s.idx + s.wknum) % 6)) between v_first and v_last;
end
$$;
revoke all on function public.shift_rotation_rest_days(jsonb,date,date) from public,anon;
grant execute on function public.shift_rotation_rest_days(jsonb,date,date) to authenticated,service_role;

create or replace function public.shift_rotation_rest_plan_set(p_plan jsonb, p_employee text, p_monday date, p_kind text, p_date date)
returns jsonb language sql immutable as $$
  select jsonb_set(
    jsonb_set(
      jsonb_set(coalesce(p_plan,'{}'::jsonb), array[p_employee], coalesce(p_plan->p_employee,'{}'::jsonb), true),
      array[p_employee, p_monday::text], coalesce(p_plan->p_employee->(p_monday::text),'{}'::jsonb), true),
    array[p_employee, p_monday::text, p_kind], to_jsonb(p_date::text), true)
$$;
revoke all on function public.shift_rotation_rest_plan_set(jsonb,text,date,text,date) from public,anon;

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

-- ---------------------------------------------------------------- 3. Overtime
create table if not exists public.shift_overtime_weeks (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  contrato_codigo text not null,
  sede_codigo text,
  rotation_id uuid references public.shift_rotations(id) on delete set null,
  week_start date not null,
  worked_minutes integer not null check (worked_minutes >= 0),
  limit_minutes integer not null check (limit_minutes > 0),
  overtime_minutes integer not null check (overtime_minutes >= 0),
  computed_at timestamptz not null default now(),
  unique (employee_id, week_start)
);
create index if not exists idx_overtime_weeks_contract_week on public.shift_overtime_weeks(contrato_codigo, week_start);
-- Weeks used to start on Monday; they start on Sunday now. Derived data: rows are recalculated when a rotation is applied.
delete from public.shift_overtime_weeks where extract(dow from week_start) <> 0;
alter table public.shift_overtime_weeks enable row level security;
revoke all on public.shift_overtime_weeks from public, anon, authenticated;
grant select on public.shift_overtime_weeks to authenticated;
grant select, insert, update, delete on public.shift_overtime_weeks to service_role;
drop policy if exists overtime_weeks_read on public.shift_overtime_weeks;
create policy overtime_weeks_read on public.shift_overtime_weeks for select to authenticated
  using (public.is_admin_like() and public.can_read_contract_data(contrato_codigo));

-- Weekly worked time (net of lunch, Sunday to Saturday, all current assignments of each rotation member) against the
-- ordinary weekly limit. Overtime is whatever exceeds it. Recomputed every time the rotation is applied.
create or replace function public.record_rotation_overtime(p_rotation uuid, p_from date, p_to date)
returns integer language plpgsql security definer set search_path=public as $$
declare r public.shift_rotations; n integer := 0;
begin
  select * into r from public.shift_rotations where id=p_rotation;
  if r.id is null then raise exception 'Rotacion no encontrada'; end if;
  if coalesce(auth.role(),'')<>'service_role' and not coalesce(public.is_admin_like() and public.can_read_contract_data(r.contrato_codigo),false) then
    raise exception 'Sin permiso';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 370 then raise exception 'Rango invalido'; end if;
  with members as (
    select (m->>'employee')::uuid eid from jsonb_array_elements(r.config->'members') m
  ), weeks as (
    select w::date wstart from generate_series(public.rotation_week_start(p_from)::timestamp,public.rotation_week_start(p_to)::timestamp,interval '7 days') w
  ), segments as (
    -- The whole shift counts on the day it starts (also overnight shifts), like the calendar shows it.
    select a.employee_id eid, (s.starts_at at time zone 'America/Bogota')::date local_day,
      extract(epoch from (s.ends_at - s.starts_at)) / 60 * public.shift_net_ratio(s.starts_at,s.ends_at,s.almuerzo_minutos) mins
    from public.shift_assignments a
    join public.scheduled_shifts s on s.id=a.scheduled_shift_id
    where a.employee_id in (select eid from members)
      and a.estado not in ('cancelado','reemplazado') and s.estado<>'cancelado'
      and s.starts_at < ((p_to+8)::timestamp at time zone 'America/Bogota')
      and s.ends_at > ((p_from-8)::timestamp at time zone 'America/Bogota')
  ), totals as (
    select m.eid, w.wstart, coalesce(round(sum(g.mins)),0)::integer worked
    from members m cross join weeks w
    left join segments g on g.eid=m.eid and g.local_day between w.wstart and w.wstart+6
    group by m.eid, w.wstart
  )
  insert into public.shift_overtime_weeks(employee_id,contrato_codigo,sede_codigo,rotation_id,week_start,worked_minutes,limit_minutes,overtime_minutes)
  select t.eid, r.contrato_codigo, r.config->>'site', r.id, t.wstart, t.worked,
    public.colombia_weekly_limit_minutes(t.wstart), greatest(0, t.worked - public.colombia_weekly_limit_minutes(t.wstart))
  from totals t
  on conflict (employee_id, week_start) do update set
    contrato_codigo=excluded.contrato_codigo, sede_codigo=excluded.sede_codigo, rotation_id=excluded.rotation_id,
    worked_minutes=excluded.worked_minutes, limit_minutes=excluded.limit_minutes,
    overtime_minutes=excluded.overtime_minutes, computed_at=now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.record_rotation_overtime(uuid,date,date) from public,anon;
grant execute on function public.record_rotation_overtime(uuid,date,date) to authenticated,service_role;

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
  perform public.record_rotation_overtime(r.id,(now() at time zone 'America/Bogota')::date,(now() at time zone 'America/Bogota')::date+30);
  return n;
end $$;

-- ---------------------------------------------------------------- Swap rest days between two employees of the site
-- Both employees keep exactly one rest day in that week; only the dates are exchanged. Assignments the rotation
-- created on the day an employee stops working are removed (future and not started); the other days are filled by
-- the normal application of the rotation. Manual assignments are never touched.
create or replace function public.swap_shift_rotation_rest_days(p_id uuid, p_employee_a uuid, p_date_a date, p_employee_b uuid, p_date_b date)
returns integer language plpgsql security definer set search_path=public as $$
declare
  r public.shift_rotations; v_today date := (now() at time zone 'America/Bogota')::date;
  v_week date; v_kind_a text; v_kind_b text; v_plan jsonb; v_config jsonb; v_removed integer := 0; v_added integer := 0; x record;
begin
  select * into r from public.shift_rotations where id=p_id for update;
  if r.id is null then raise exception 'Rotacion no encontrada'; end if;
  if coalesce(auth.role(),'')<>'service_role' and not coalesce(public.is_admin_like() and public.can_read_contract_data(r.contrato_codigo),false) then
    raise exception 'Sin permiso';
  end if;
  if coalesce(r.config->'rules'->>'restMode','fijo') <> 'rotativo' then
    raise exception 'Activa los descansos rotativos para intercambiar descansos';
  end if;
  if p_employee_a is null or p_employee_b is null or p_employee_a = p_employee_b then raise exception 'Selecciona dos empleados distintos'; end if;
  if p_date_a is null or p_date_b is null or p_date_a = p_date_b then raise exception 'Selecciona dos fechas distintas'; end if;
  if (select count(*) from public.employees e where e.id in (p_employee_a,p_employee_b)
        and e.sede_codigo=r.config->>'site' and e.contrato_codigo=r.contrato_codigo and e.estado='activo') <> 2
     or (select count(*) from jsonb_array_elements(r.config->'members') m where (m->>'employee')::uuid in (p_employee_a,p_employee_b)) <> 2 then
    raise exception 'Los empleados deben ser de la misma sede y estar en la rotacion';
  end if;
  if p_date_a <= v_today or p_date_b <= v_today then raise exception 'Solo se pueden intercambiar descansos futuros'; end if;
  v_week := public.rotation_week_start(p_date_a);
  if public.rotation_week_start(p_date_b) <> v_week then raise exception 'Los descansos deben ser de la misma semana'; end if;
  select d.kind into v_kind_a from public.shift_rotation_rest_days(r.config,v_week,v_week+6) d where d.employee_id=p_employee_a and d.rest_date=p_date_a;
  select d.kind into v_kind_b from public.shift_rotation_rest_days(r.config,v_week,v_week+6) d where d.employee_id=p_employee_b and d.rest_date=p_date_b;
  if v_kind_a is null or v_kind_b is null then
    raise exception 'La fecha no es un descanso programado del empleado; los descansos del ciclo no se intercambian';
  end if;
  -- Each employee must be working the day it receives as rest (not already resting by slot or by the cycle).
  if exists(select 1 from public.preview_shift_rotation(r.contrato_codigo,r.config,least(p_date_a,p_date_b),greatest(p_date_a,p_date_b)) p
      where ((p.employee_id=p_employee_a and p.fecha=p_date_b) or (p.employee_id=p_employee_b and p.fecha=p_date_a)) and p.template_id is null) then
    raise exception 'Un empleado ya descansa ese dia';
  end if;
  v_plan := public.shift_rotation_rest_plan_set(r.config->'rules'->'restPlan',p_employee_a::text,v_week,v_kind_a,p_date_b);
  v_plan := public.shift_rotation_rest_plan_set(v_plan,p_employee_b::text,v_week,v_kind_b,p_date_a);
  v_config := jsonb_set(r.config,'{rules,restPlan}',v_plan,true);
  -- The same validation used when saving.
  perform * from public.preview_shift_rotation(r.contrato_codigo,v_config,v_today+1,v_today+1);
  update public.shift_rotations set config=v_config, rules_updated_at=now(), rules_updated_by=auth.uid() where id=r.id;
  for x in select a.id aid, s.id sid, a.employee_id eid
    from public.shift_assignments a join public.scheduled_shifts s on s.id=a.scheduled_shift_id
    where a.rotation_id=p_id and s.starts_at>now()
      and ((a.employee_id=p_employee_a and s.fecha_operativa=p_date_b::text) or (a.employee_id=p_employee_b and s.fecha_operativa=p_date_a::text)) loop
    delete from public.employee_shift_status where scheduled_shift_id=x.sid and employee_id=x.eid and estado_turno='programado' and coalesce(asistio,false)=false;
    delete from public.shift_assignments where id=x.aid;
    v_removed := v_removed + 1;
  end loop;
  if r.estado='activo' then v_added := public.apply_shift_rotation(p_id,false); end if;
  return v_removed + v_added;
end $$;
revoke all on function public.swap_shift_rotation_rest_days(uuid,uuid,date,uuid,date) from public,anon;
grant execute on function public.swap_shift_rotation_rest_days(uuid,uuid,date,uuid,date) to authenticated,service_role;

-- ---------------------------------------------------------------- Move one employee's rest day inside its week
-- The employee keeps exactly one rest day of that kind in the week; only the date changes (Monday to Saturday, a day
-- currently worked). Rotation assignments on the new rest day are removed (future and not started); the day that stops
-- being rest is filled by the normal application of the rotation. Manual assignments are never touched.
create or replace function public.move_shift_rotation_rest_day(p_id uuid, p_employee uuid, p_from date, p_to date)
returns integer language plpgsql security definer set search_path=public as $$
declare
  r public.shift_rotations; v_today date := (now() at time zone 'America/Bogota')::date;
  v_week date; v_kind text; v_plan jsonb; v_config jsonb; v_removed integer := 0; v_added integer := 0; x record;
begin
  select * into r from public.shift_rotations where id=p_id for update;
  if r.id is null then raise exception 'Rotacion no encontrada'; end if;
  if coalesce(auth.role(),'')<>'service_role' and not coalesce(public.is_admin_like() and public.can_read_contract_data(r.contrato_codigo),false) then
    raise exception 'Sin permiso';
  end if;
  if coalesce(r.config->'rules'->>'restMode','fijo') <> 'rotativo' then
    raise exception 'Activa los descansos rotativos para mover descansos';
  end if;
  if p_employee is null or p_from is null or p_to is null or p_from = p_to then raise exception 'Selecciona un dia distinto'; end if;
  if not exists(select 1 from public.employees e where e.id=p_employee and e.sede_codigo=r.config->>'site'
        and e.contrato_codigo=r.contrato_codigo and e.estado='activo')
     or not exists(select 1 from jsonb_array_elements(r.config->'members') m where (m->>'employee')::uuid=p_employee) then
    raise exception 'El empleado debe ser de la sede y estar en la rotacion';
  end if;
  if p_from <= v_today or p_to <= v_today then raise exception 'Solo se pueden mover descansos futuros'; end if;
  v_week := public.rotation_week_start(p_from);
  if public.rotation_week_start(p_to) <> v_week then raise exception 'El descanso debe quedar en la misma semana'; end if;
  if extract(dow from p_to) = 0 then raise exception 'El descanso se programa de lunes a sabado'; end if;
  select d.kind into v_kind from public.shift_rotation_rest_days(r.config,v_week,v_week+6) d where d.employee_id=p_employee and d.rest_date=p_from;
  if v_kind is null then
    raise exception 'La fecha no es un descanso programado del empleado; los descansos del ciclo no se mueven';
  end if;
  if exists(select 1 from public.preview_shift_rotation(r.contrato_codigo,r.config,p_to,p_to) p
      where p.employee_id=p_employee and p.fecha=p_to and p.template_id is null) then
    raise exception 'El empleado ya descansa ese dia';
  end if;
  v_plan := public.shift_rotation_rest_plan_set(r.config->'rules'->'restPlan',p_employee::text,v_week,v_kind,p_to);
  v_config := jsonb_set(r.config,'{rules,restPlan}',v_plan,true);
  perform * from public.preview_shift_rotation(r.contrato_codigo,v_config,v_today+1,v_today+1);
  update public.shift_rotations set config=v_config, rules_updated_at=now(), rules_updated_by=auth.uid() where id=r.id;
  for x in select a.id aid, s.id sid
    from public.shift_assignments a join public.scheduled_shifts s on s.id=a.scheduled_shift_id
    where a.rotation_id=p_id and a.employee_id=p_employee and s.starts_at>now() and s.fecha_operativa=p_to::text loop
    delete from public.employee_shift_status where scheduled_shift_id=x.sid and employee_id=p_employee and estado_turno='programado' and coalesce(asistio,false)=false;
    delete from public.shift_assignments where id=x.aid;
    v_removed := v_removed + 1;
  end loop;
  if r.estado='activo' then v_added := public.apply_shift_rotation(p_id,false); end if;
  return v_removed + v_added;
end $$;
revoke all on function public.move_shift_rotation_rest_day(uuid,uuid,date,date) from public,anon;
grant execute on function public.move_shift_rotation_rest_day(uuid,uuid,date,date) to authenticated,service_role;

-- ---------------------------------------------------------------- Replace the manual schedule with the rotation
-- Manual assignments (no rotation) of the rotation members, in the rotation's site and contract, inside the next
-- 30 days and the rotation's validity, that have not started and have no attendance. p_dry_run only counts them.
-- The application of the rotation itself never touches manual assignments; this is an explicit administrator action.
create or replace function public.replace_manual_shift_assignments(p_id uuid, p_dry_run boolean default true)
returns integer language plpgsql security definer set search_path=public as $$
declare
  r public.shift_rotations; v_from date := (now() at time zone 'America/Bogota')::date + 1; v_to date := (now() at time zone 'America/Bogota')::date + 30;
  v_start date; v_end date; n integer := 0; x record;
begin
  select * into r from public.shift_rotations where id=p_id for update;
  if r.id is null then raise exception 'Rotacion no encontrada'; end if;
  if coalesce(auth.role(),'')<>'service_role' and not coalesce(public.is_admin_like() and public.can_read_contract_data(r.contrato_codigo),false) then
    raise exception 'Sin permiso';
  end if;
  v_start := (r.config->>'start')::date;
  v_end := nullif(r.config->>'end','')::date;
  v_from := greatest(v_from, v_start);
  v_to := least(v_to, coalesce(v_end, v_to));
  for x in select a.id aid, s.id sid, a.employee_id eid
    from public.shift_assignments a join public.scheduled_shifts s on s.id=a.scheduled_shift_id
    where a.rotation_id is null and a.estado not in ('cancelado','reemplazado') and s.estado<>'cancelado'
      and a.employee_id in (select (m->>'employee')::uuid from jsonb_array_elements(r.config->'members') m)
      and s.sede_codigo=r.config->>'site' and s.contrato_codigo=r.contrato_codigo
      and s.starts_at>now() and s.fecha_operativa between v_from::text and v_to::text
      and not exists(select 1 from public.employee_shift_status es where es.scheduled_shift_id=s.id and es.employee_id=a.employee_id
        and (coalesce(es.asistio,false) or es.estado_turno<>'programado'))
  loop
    n := n + 1;
    if not p_dry_run then
      delete from public.employee_shift_status where scheduled_shift_id=x.sid and employee_id=x.eid and estado_turno='programado' and coalesce(asistio,false)=false;
      delete from public.shift_assignments where id=x.aid;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.replace_manual_shift_assignments(uuid,boolean) from public,anon;
grant execute on function public.replace_manual_shift_assignments(uuid,boolean) to authenticated,service_role;

-- ---------------------------------------------------------------- Relievers (relevos)
-- Members flagged "reliever": true have no fixed cycle. They cover, day by day, the plan of the regular members who are
-- resting (compensatory rest) or unavailable. Rules:
--   * weeks run Sunday to Saturday; a reliever works at most 6 days a week and Sunday is its natural rest;
--   * a reliever that works Sunday must rest one day of that same week, from Monday to Saturday (at most 5 weekdays);
--   * a reliever with a pending rest works at most 5 days until the pending rest is paid back;
--   * when covering does not reach its 6 days (5 with a pending rest) the reliever completes the week as surplus
--     ("sobrante"): assigned above the planned quota to the plan it covered most, on days that plan operates and with no
--     gap to cover. The administrator can move a surplus day to any free day of the week (rules.surplusPlan);
--   * if gaps remain and there is no other reliever, a reliever may cover a 7th day: that week has no rest, the rest
--     becomes pending (paid in a later week) and the hours over the weekly limit are recorded as overtime.
-- Deterministic: recalculated from the configuration, nothing is stored. Result:
--   { assignments: [{employee,date,template,covers,extra,surplus}], weeks: [{employee,week_start,days_worked,extra_days,surplus_days,pending_rest}] }
create or replace function public.shift_rotation_relief_plan(p_config jsonb, p_from date, p_to date)
returns jsonb language plpgsql set search_path=public as $$
#variable_conflict use_column
declare
  v_start date := (p_config->>'start')::date;
  v_end date := nullif(p_config->>'end','')::date;
  v_days integer := (p_config->>'days')::integer;
  v_cycle jsonb := p_config->'cycle';
  v_len integer := jsonb_array_length(p_config->'cycle');
  v_unavailable jsonb := coalesce(p_config->'unavailable','[]'::jsonb);
  v_splan jsonb := coalesce(p_config->'rules'->'surplusPlan','{}'::jsonb);
  v_last date := least(p_to, coalesce(nullif(p_config->>'end','')::date, p_to));
  v_all constant jsonb := '[0,1,2,3,4,5,6]'::jsonb;
  v_ops jsonb;
  v_rel text[];
  v_pending jsonb := '{}'::jsonb;
  v_assign jsonb := '[]'::jsonb;
  v_weeks jsonb := '[]'::jsonb;
  v_week date; v_pass integer; g record; r text; v_pick text; v_pick_count integer; v_count integer; v_cap integer; v_ms integer;
  v_worked jsonb; v_extra jsonb; v_covered jsonb; v_pend integer; v_n integer; v_owes boolean;
  v_wk jsonb; v_gapdays date[]; v_gaptpl jsonb; v_plan text; v_target integer; v_sur integer; v_d date; v_first_plan text; v_explicit jsonb;
begin
  select coalesce(array_agg(m->>'employee' order by coalesce((m->>'offset')::integer,0), m->>'employee'), '{}'::text[]) into v_rel
  from jsonb_array_elements(p_config->'members') m where coalesce((m->>'reliever')::boolean,false);
  if cardinality(v_rel) = 0 or v_start is null or v_last < greatest(p_from, v_start) then
    return jsonb_build_object('assignments','[]'::jsonb,'weeks','[]'::jsonb);
  end if;
  select coalesce(jsonb_object_agg(t, to_jsonb(public.shift_template_operating_days(t::uuid))), '{}'::jsonb) into v_ops
  from (select distinct value t from jsonb_array_elements_text(v_cycle) value where value is not null) x;
  foreach r in array v_rel loop
    v_pending := v_pending || jsonb_build_object(r, 0);
  end loop;
  for v_week in select w::date from generate_series(public.rotation_week_start(v_start)::timestamp, public.rotation_week_start(v_last)::timestamp, interval '7 days') w loop
    v_worked := '{}'::jsonb; v_extra := '{}'::jsonb; v_covered := '{}'::jsonb; v_wk := '[]'::jsonb; v_gapdays := '{}'; v_gaptpl := '{}'::jsonb;
    foreach r in array v_rel loop v_worked := v_worked || jsonb_build_object(r,'[]'::jsonb); v_extra := v_extra || jsonb_build_object(r,0); end loop;
    for v_pass in 1..2 loop
      for g in
        with rd as (select employee_id, rest_date from public.shift_rotation_rest_days(p_config, v_week, v_week+6)),
        raw as (
          select d::date dt, m->>'employee' covers, m,
            v_cycle->>((((d::date - public.rotation_cycle_origin(v_start,v_days)) / v_days) + coalesce((m->>'offset')::integer,0)) % v_len) tpl
          from generate_series(v_week::timestamp, (v_week+6)::timestamp, interval '1 day') d
          cross join jsonb_array_elements(p_config->'members') m
          where not coalesce((m->>'reliever')::boolean,false) and d::date >= v_start and (v_end is null or d::date <= v_end)
        )
        select dt, covers, tpl from raw
        where tpl is not null
          and coalesce(v_ops->tpl, v_all) @> to_jsonb(extract(dow from dt)::integer)
          and (exists(select 1 from rd where rd.employee_id=covers::uuid and rd.rest_date=dt)
            or exists(select 1 from jsonb_array_elements(v_unavailable) u where u->>'employee'=covers
                 and dt between (u->>'from')::date and (u->>'to')::date))
        order by 1, 3, 2
      loop
        if v_pass = 1 then
          v_gapdays := v_gapdays || g.dt;
          v_gaptpl := jsonb_set(v_gaptpl, array[g.tpl], to_jsonb(coalesce((v_gaptpl->>g.tpl)::integer,0)+1), true);
        end if;
        continue when v_covered ? (g.dt::text || '|' || g.covers);
        v_pick := null; v_pick_count := null;
        foreach r in array v_rel loop
          v_count := jsonb_array_length(v_worked->r);
          v_pend := coalesce((v_pending->>r)::integer,0);
          v_ms := v_count - case when (v_worked->r) ? v_week::text then 1 else 0 end;
          v_cap := case when v_pass = 1 then 6 - case when v_pend > 0 then 1 else 0 end else 7 end;
          if v_count >= v_cap then continue; end if;
          -- Working Sunday, one weekday of the same week must stay free (compensatory rest).
          if v_pass = 1 and (v_worked->r) ? v_week::text and extract(dow from g.dt) <> 0 and v_ms >= 5 then continue; end if;
          if (v_worked->r) ? g.dt::text then continue; end if;
          if exists(select 1 from jsonb_array_elements(v_unavailable) u where u->>'employee'=r and g.dt between (u->>'from')::date and (u->>'to')::date) then continue; end if;
          if v_pick is null or v_count < v_pick_count then v_pick := r; v_pick_count := v_count; end if;
        end loop;
        continue when v_pick is null;
        v_worked := jsonb_set(v_worked, array[v_pick], (v_worked->v_pick) || to_jsonb(g.dt::text));
        v_covered := v_covered || jsonb_build_object(g.dt::text || '|' || g.covers, true);
        if v_pass = 2 then v_extra := jsonb_set(v_extra, array[v_pick], to_jsonb(coalesce((v_extra->>v_pick)::integer,0)+1)); end if;
        v_wk := v_wk || jsonb_build_object('employee',v_pick,'date',g.dt,'template',g.tpl,'covers',g.covers,'extra',v_pass=2,'surplus',false);
      end loop;
    end loop;
    -- Surplus: complete the week up to 6 days (5 with a pending rest) above the quota, on days the plan operates and with
    -- nothing to cover. Sunday is filled last: it is the natural rest. An explicit list (moved by the administrator) wins.
    v_first_plan := (select c from jsonb_array_elements_text(v_cycle) c where c is not null limit 1);
    foreach r in array v_rel loop
      v_target := 6 - case when coalesce((v_pending->>r)::integer,0) > 0 then 1 else 0 end;
      v_n := jsonb_array_length(v_worked->r);
      continue when v_n >= v_target;
      v_plan := coalesce(
        (select w->>'template' from jsonb_array_elements(v_wk) w where w->>'employee'=r group by w->>'template' order by count(*) desc, min(w->>'date') limit 1),
        (select k from jsonb_each_text(v_gaptpl) t(k,v) order by v::integer desc, k limit 1),
        v_first_plan);
      continue when v_plan is null;
      v_sur := v_target - v_n;
      v_ms := v_n - case when (v_worked->r) ? v_week::text then 1 else 0 end;
      v_explicit := v_splan->r->(v_week::text);
      for v_d in
        select d::date from generate_series(greatest(v_week,v_start)::timestamp, least(v_week+6, coalesce(v_end,v_week+6))::timestamp, interval '1 day') d
        where not ((v_worked->r) ? d::date::text)
          and coalesce(v_ops->v_plan, v_all) @> to_jsonb(extract(dow from d)::integer)
          and not exists(select 1 from jsonb_array_elements(v_unavailable) u where u->>'employee'=r and d::date between (u->>'from')::date and (u->>'to')::date)
          and (v_explicit is null or jsonb_typeof(v_explicit) <> 'array' or v_explicit ? d::date::text)
        order by (d::date = any(v_gapdays)) desc, (extract(dow from d) = 0), d::date
      loop
        exit when v_sur <= 0;
        if (v_worked->r) ? v_week::text and extract(dow from v_d) <> 0 and v_ms >= 5 then continue; end if;
        v_worked := jsonb_set(v_worked, array[r], (v_worked->r) || to_jsonb(v_d::text));
        v_wk := v_wk || jsonb_build_object('employee',r,'date',v_d,'template',v_plan,'covers',null,'extra',false,'surplus',true);
        v_sur := v_sur - 1;
        if extract(dow from v_d) <> 0 then v_ms := v_ms + 1; end if;
      end loop;
    end loop;
    v_assign := v_assign || coalesce((select jsonb_agg(w) from jsonb_array_elements(v_wk) w where (w->>'date')::date between p_from and p_to),'[]'::jsonb);
    -- Weekly balance: a seventh worked day loses the weekly rest (pending); two rest days pay one back.
    foreach r in array v_rel loop
      v_n := jsonb_array_length(v_worked->r);
      v_pend := coalesce((v_pending->>r)::integer,0);
      if v_n >= 7 then v_pend := v_pend + 1;
      elsif v_n <= 5 and v_pend > 0 then v_pend := v_pend - 1;
      end if;
      v_pending := jsonb_set(v_pending, array[r], to_jsonb(v_pend));
      if v_week + 6 >= p_from and v_week <= p_to then
        v_weeks := v_weeks || jsonb_build_object('employee',r,'week_start',v_week,'days_worked',v_n,
          'extra_days',coalesce((v_extra->>r)::integer,0),
          'surplus_days',(select count(*) from jsonb_array_elements(v_wk) w where w->>'employee'=r and (w->>'surplus')::boolean),'pending_rest',v_pend);
      end if;
    end loop;
  end loop;
  return jsonb_build_object('assignments',v_assign,'weeks',v_weeks);
end
$$;
revoke all on function public.shift_rotation_relief_plan(jsonb,date,date) from public,anon;
grant execute on function public.shift_rotation_relief_plan(jsonb,date,date) to authenticated,service_role;

drop function if exists public.shift_rotation_relief(jsonb,date,date);
create function public.shift_rotation_relief(p_config jsonb, p_from date, p_to date)
returns table(employee_id uuid, work_date date, template_id uuid, covers uuid, extra boolean, surplus boolean)
language sql set search_path=public as $$
  select x.employee, x.date, x.template::uuid, x.covers, x.extra, x.surplus
  from jsonb_to_recordset(public.shift_rotation_relief_plan(p_config,p_from,p_to)->'assignments')
    as x(employee uuid, date date, template text, covers uuid, extra boolean, surplus boolean)
$$;
revoke all on function public.shift_rotation_relief(jsonb,date,date) from public,anon;
grant execute on function public.shift_rotation_relief(jsonb,date,date) to authenticated,service_role;

drop function if exists public.shift_rotation_relief_weeks(jsonb,date,date);
create function public.shift_rotation_relief_weeks(p_config jsonb, p_from date, p_to date)
returns table(employee_id uuid, week_start date, days_worked integer, extra_days integer, surplus_days integer, pending_rest integer)
language sql set search_path=public as $$
  select x.employee, x.week_start, x.days_worked, x.extra_days, x.surplus_days, x.pending_rest
  from jsonb_to_recordset(public.shift_rotation_relief_plan(p_config,p_from,p_to)->'weeks')
    as x(employee uuid, week_start date, days_worked integer, extra_days integer, surplus_days integer, pending_rest integer)
$$;
revoke all on function public.shift_rotation_relief_weeks(jsonb,date,date) from public,anon;
grant execute on function public.shift_rotation_relief_weeks(jsonb,date,date) to authenticated,service_role;

-- ---------------------------------------------------------------- Move a reliever's surplus day inside its week
-- The surplus day goes to any free day of the same week (Monday to Sunday) on which the plan operates. The rule that a
-- Sunday worked owes a weekday rest the following week keeps applying (the planner recalculates it).
create or replace function public.move_shift_rotation_surplus(p_id uuid, p_employee uuid, p_from date, p_to date)
returns integer language plpgsql security definer set search_path=public as $$
declare
  r public.shift_rotations; v_today date := (now() at time zone 'America/Bogota')::date;
  v_week date; v_dates jsonb; v_plan jsonb; v_config jsonb; v_removed integer := 0; v_added integer := 0; x record;
begin
  select * into r from public.shift_rotations where id=p_id for update;
  if r.id is null then raise exception 'Rotacion no encontrada'; end if;
  if coalesce(auth.role(),'')<>'service_role' and not coalesce(public.is_admin_like() and public.can_read_contract_data(r.contrato_codigo),false) then
    raise exception 'Sin permiso';
  end if;
  if p_employee is null or p_from is null or p_to is null or p_from = p_to then raise exception 'Selecciona un dia distinto'; end if;
  if not exists(select 1 from jsonb_array_elements(r.config->'members') m where (m->>'employee')::uuid=p_employee and coalesce((m->>'reliever')::boolean,false)) then
    raise exception 'El empleado debe ser un relevo de la rotacion';
  end if;
  if p_from <= v_today or p_to <= v_today then raise exception 'Solo se pueden mover sobrantes futuros'; end if;
  v_week := public.rotation_week_start(p_from);
  if public.rotation_week_start(p_to) <> v_week then raise exception 'El sobrante debe quedar en la misma semana'; end if;
  select coalesce(jsonb_agg(d.work_date order by d.work_date), '[]'::jsonb) into v_dates
  from public.shift_rotation_relief(r.config,v_week,v_week+6) d where d.employee_id=p_employee and d.surplus;
  if not (v_dates ? p_from::text) then raise exception 'La fecha no es un sobrante del relevo'; end if;
  select coalesce(jsonb_agg(y.dv order by y.dv), '[]'::jsonb) into v_dates
  from (select value as dv from jsonb_array_elements_text(v_dates) value where value <> p_from::text union select p_to::text) y;
  v_plan := coalesce(r.config->'rules'->'surplusPlan','{}'::jsonb);
  v_plan := jsonb_set(v_plan, array[p_employee::text], coalesce(v_plan->p_employee::text,'{}'::jsonb), true);
  v_plan := jsonb_set(v_plan, array[p_employee::text, v_week::text], v_dates, true);
  v_config := jsonb_set(r.config,'{rules,surplusPlan}',v_plan,true);
  -- The destination must become a surplus day of the reliever (free and on a day the plan operates).
  if not exists(select 1 from public.shift_rotation_relief(v_config,v_week,v_week+6) d where d.employee_id=p_employee and d.work_date=p_to and d.surplus) then
    raise exception 'No se puede mover el sobrante a ese dia: esta ocupado, no disponible o el plan no opera ese dia';
  end if;
  perform * from public.preview_shift_rotation(r.contrato_codigo,v_config,v_today+1,v_today+1);
  update public.shift_rotations set config=v_config, rules_updated_at=now(), rules_updated_by=auth.uid() where id=r.id;
  for x in select a.id aid, s.id sid
    from public.shift_assignments a join public.scheduled_shifts s on s.id=a.scheduled_shift_id
    where a.rotation_id=p_id and a.employee_id=p_employee and s.starts_at>now() and s.fecha_operativa=p_from::text loop
    delete from public.employee_shift_status where scheduled_shift_id=x.sid and employee_id=p_employee and estado_turno='programado' and coalesce(asistio,false)=false;
    delete from public.shift_assignments where id=x.aid;
    v_removed := v_removed + 1;
  end loop;
  if r.estado='activo' then v_added := public.apply_shift_rotation(p_id,false); end if;
  return v_removed + v_added;
end $$;
revoke all on function public.move_shift_rotation_surplus(uuid,uuid,date,date) from public,anon;
grant execute on function public.move_shift_rotation_surplus(uuid,uuid,date,date) to authenticated,service_role;

create or replace function public.shift_rotation_rules_version()
returns integer language sql stable as $$select 69$$;
revoke all on function public.shift_rotation_rules_version() from public,anon;
grant execute on function public.shift_rotation_rules_version() to authenticated,service_role;
commit;
