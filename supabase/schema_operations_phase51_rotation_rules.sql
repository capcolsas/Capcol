-- Phase 51: configurable rotation limits. Apply after phase 50.
-- Existing configurations remain valid: missing limits mean disabled (zero).
-- No assignments or saved configurations are modified.
begin;
create or replace function public.preview_shift_rotation(p_contract text, p_config jsonb, p_from date, p_to date)
returns table(fecha date, employee_id uuid, employee_name text, template_id uuid, shift_id uuid, result text)
language plpgsql security definer set search_path = public as $$
declare
  v_start date; v_end date; v_days integer; v_cycle jsonb; v_member jsonb;
  v_rules jsonb := coalesce(p_config->'rules','{}'::jsonb);
  v_unavailable jsonb := coalesce(p_config->'unavailable','[]'::jsonb);
  v_rest numeric; v_daily numeric; v_weekly numeric; v_consecutive integer; v_period jsonb;
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
  return query
  with days as (
    select d::date as work_date from generate_series(greatest(p_from-32,v_start)::timestamp,
      least(p_to+32,coalesce(v_end,p_to+32))::timestamp,interval '1 day') d
  ), expected as (
    select work_date, e.id eid, e.nombre ename,
      (v_cycle->>((((work_date-v_start)/v_days)+(m->>'offset')::integer)%jsonb_array_length(v_cycle)))::uuid tid
    from days cross join jsonb_array_elements(p_config->'members') m
    join public.employees e on e.id=(m->>'employee')::uuid
  ), candidates as (
    select x.*, s.id sid, s.starts_at, s.ends_at, s.estado, s.operarios_planeados
    from expected x left join public.scheduled_shifts s on s.template_id=x.tid and s.sede_codigo=p_config->>'site'
      and s.contrato_codigo=p_contract and s.fecha_operativa=x.work_date::text and s.estado <> 'cancelado'
  ), workload as materialized (
    -- Include existing assignments across contracts; a person cannot rest twice.
    -- UNION avoids counting an existing assignment again as a proposed shift.
    select c.eid,c.sid,c.starts_at,c.ends_at from candidates c
      where c.sid is not null and c.estado='programado' and c.starts_at>now()
      and not exists(select 1 from public.shift_assignments a where a.employee_id=c.eid and a.scheduled_shift_id=c.sid)
    union
    select a.employee_id,s.id,s.starts_at,s.ends_at
    from public.shift_assignments a join public.scheduled_shifts s on s.id=a.scheduled_shift_id
    where a.estado<>'cancelado' and s.estado<>'cancelado'
      and a.employee_id in (select (m->>'employee')::uuid from jsonb_array_elements(p_config->'members') m)
      and s.starts_at < ((p_to+33)::timestamp at time zone 'America/Bogota')
      and s.ends_at > ((p_from-32)::timestamp at time zone 'America/Bogota')
  ), daily as materialized (
    select w.eid,d.work_day::date as local_day,
      sum(extract(epoch from least(w.ends_at,(d.work_day+interval '1 day') at time zone 'America/Bogota')
        - greatest(w.starts_at,d.work_day at time zone 'America/Bogota'))/3600) hours
    from workload w cross join lateral generate_series(
      (w.starts_at at time zone 'America/Bogota')::date::timestamp,
      ((w.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date::timestamp,interval '1 day') d(work_day)
    group by w.eid,d.work_day
  ), weekly as (
    select eid,date_trunc('week',local_day)::date week_start,sum(hours) hours from daily group by eid,date_trunc('week',local_day)
  ), streak_days as (
    select eid,local_day,local_day-(row_number() over(partition by eid order by local_day))::integer as streak from daily
  ), streaks as (
    select eid,min(local_day) first_day,max(local_day) last_day,count(*) worked_days from streak_days group by eid,streak
  )
  select c.work_date,c.eid,c.ename,c.tid,c.sid,
    case
      when c.tid is null then 'Descanso'
      when c.sid is null then 'Sin turno generado'
      when c.starts_at <= now() or c.estado <> 'programado' then 'Historico o iniciado'
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
        and w.week_start between date_trunc('week',c.starts_at at time zone 'America/Bogota')::date
          and date_trunc('week',(c.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date) then case when exists(select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=c.eid)
          then 'Revisar asignacion existente: Limite de horas semanales' else 'Limite de horas semanales' end
      when v_consecutive>0 and exists(select 1 from streaks st where st.eid=c.eid and st.worked_days>v_consecutive
        and st.first_day<=((c.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date
        and st.last_day>=(c.starts_at at time zone 'America/Bogota')::date) then case when exists(select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=c.eid)
          then 'Revisar asignacion existente: Limite de dias consecutivos' else 'Limite de dias consecutivos' end
      when exists(select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=c.eid) then 'Asignacion existente'
      when exists(select 1 from public.shift_assignments a join public.scheduled_shifts s on s.id=a.scheduled_shift_id
        where a.employee_id=c.eid and a.estado <> 'cancelado' and s.estado <> 'cancelado'
        and s.starts_at < c.ends_at and s.ends_at > c.starts_at) then 'Cruce con otra asignacion'
      when exists(select 1 from candidates other where other.eid=c.eid and other.sid<>c.sid
        and other.starts_at<c.ends_at and other.ends_at>c.starts_at) then 'Cruce dentro del ciclo'
      when (select count(*) from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.estado<>'cancelado')
         + (select count(*) from candidates other where other.sid=c.sid and not exists(
             select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=other.eid)) > c.operarios_planeados then 'Cupo insuficiente'
      else 'Por asignar'
    end::text
  from candidates c where c.work_date between p_from and p_to order by c.work_date,c.ename,c.starts_at;
end $$;


-- The existing save/apply RPCs call this same preview function, so validation
-- is enforced during creation, activation and automatic renewal.
alter table public.shift_rotations add column if not exists rules_updated_at timestamptz;
alter table public.shift_rotations add column if not exists rules_updated_by uuid;
create or replace function public.update_shift_rotation_rules(p_id uuid,p_rules jsonb,p_unavailable jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare r public.shift_rotations; v_config jsonb;
begin
  select * into r from public.shift_rotations where id=p_id for update;
  if r.id is null then raise exception 'Rotacion no encontrada'; end if;
  v_config := r.config || jsonb_build_object('rules',p_rules,'unavailable',p_unavailable);
  perform * from public.preview_shift_rotation(r.contrato_codigo,v_config,
    (now() at time zone 'America/Bogota')::date+1,(now() at time zone 'America/Bogota')::date+1);
  update public.shift_rotations set config=v_config,rules_updated_at=now(),rules_updated_by=auth.uid() where id=r.id;
end $$;
revoke all on function public.update_shift_rotation_rules(uuid,jsonb,jsonb) from public,anon;
grant execute on function public.update_shift_rotation_rules(uuid,jsonb,jsonb) to authenticated,service_role;

create or replace function public.apply_shift_rotation(p_id uuid, p_activate boolean default false)
returns integer language plpgsql security definer set search_path=public as $$
declare r public.shift_rotations; x record; e public.employees; s public.scheduled_shifts; n integer:=0; v_count integer;
begin
  -- Serialize rotation runs and protect the check/insert window against manual assignments.
  lock table public.scheduled_shifts in share mode;
  lock table public.employees in share mode;
  lock table public.shift_assignments in share row exclusive mode;
  select * into r from public.shift_rotations where id=p_id for update;
  if r.id is null then raise exception 'Rotacion no encontrada'; end if;
  if coalesce(auth.role(),'')<>'service_role' and not coalesce(public.is_admin_like() and public.can_read_contract_data(r.contrato_codigo),false) then raise exception 'Sin permiso'; end if;
  if r.estado<>'activo' and not p_activate then return 0; end if;
  for x in select * from public.preview_shift_rotation(r.contrato_codigo,r.config,
    (now() at time zone 'America/Bogota')::date+1,(now() at time zone 'America/Bogota')::date+370) loop
    if x.result<>'Por asignar' then continue; end if;
    select * into s from public.scheduled_shifts where id=x.shift_id for update;
    select * into e from public.employees where id=x.employee_id;
    if s.starts_at<=now() or s.estado<>'programado' then continue; end if;
    -- Recheck capacity and overlaps after each insert; never overwrite a manual row.
    if exists(select 1 from public.shift_assignments a join public.scheduled_shifts sh on sh.id=a.scheduled_shift_id
      where a.employee_id=e.id and a.estado<>'cancelado' and sh.estado<>'cancelado'
      and sh.starts_at<s.ends_at and sh.ends_at>s.starts_at) then continue; end if;
    if (select count(*) from public.shift_assignments a where a.scheduled_shift_id=s.id and a.estado<>'cancelado')>=s.operarios_planeados then continue; end if;
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

create or replace function public.shift_rotation_rules_version()
returns integer language sql stable as $$ select 51 $$;
revoke all on function public.shift_rotation_rules_version() from public,anon;
grant execute on function public.shift_rotation_rules_version() to authenticated,service_role;
commit;
