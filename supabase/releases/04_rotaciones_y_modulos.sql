-- ============================================================
-- Rocky | 04 Rotaciones, asistencia por turno, retiros, inventario y visitas
-- Generado por supabase/build_release_bundles.mjs. NO editar a mano.
--
-- Idempotente: sirve para un proyecto nuevo y para actualizar uno existente.
-- Ejecutar en orden 01 -> 05 en el editor SQL de Supabase (o con psql).
-- Fuentes incluidas (10):
--   schema_operations_phase50_shift_rotations.sql
--   schema_operations_phase51_rotation_rules.sql
--   schema_operations_phase52_shift_generation_horizon.sql
--   schema_operations_phase53_shift_planned_capacity.sql
--   schema_operations_phase54_shift_attendance.sql
--   schema_operations_phase55_employee_retirements.sql
--   schema_operations_phase56_retired_certificates.sql
--   schema_operations_phase57_cargo_functions.sql
--   schema_operations_phase58_inventory.sql
--   schema_operations_phase59_site_visits.sql
-- ============================================================

-- >>>>>>>>>> schema_operations_phase50_shift_rotations.sql
-- Apply after phase 49. No existing assignment is changed by this migration.
begin;
create table if not exists public.shift_rotations (
  id uuid primary key default gen_random_uuid(),
  contrato_codigo text not null references public.contracts(codigo),
  nombre text not null check (length(trim(nombre)) > 0),
  config jsonb not null,
  estado text not null default 'borrador' check (estado in ('borrador','activo','pausado')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.shift_assignments add column if not exists rotation_id uuid references public.shift_rotations(id);
alter table public.shift_rotations enable row level security;
drop policy if exists rotations_read on public.shift_rotations;
drop policy if exists rotations_read on public.shift_rotations;
create policy rotations_read on public.shift_rotations for select to authenticated
using (public.can_read_contract_data(contrato_codigo));
-- All writes go through checked RPCs. Direct table writes are intentionally unavailable.
revoke insert, update, delete on public.shift_rotations from authenticated, anon;
grant select on public.shift_rotations to authenticated;

create or replace function public.preview_shift_rotation(p_contract text, p_config jsonb, p_from date, p_to date)
returns table(fecha date, employee_id uuid, employee_name text, template_id uuid, shift_id uuid, result text)
language plpgsql security definer set search_path = public as $$
declare
  v_start date; v_end date; v_days integer; v_cycle jsonb; v_member jsonb;
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
  return query
  with days as (
    select d::date as work_date from generate_series(greatest(p_from,v_start)::timestamp,
      least(p_to,coalesce(v_end,p_to))::timestamp,interval '1 day') d
  ), expected as (
    select work_date, e.id eid, e.nombre ename,
      (v_cycle->>((((work_date-v_start)/v_days)+(m->>'offset')::integer)%jsonb_array_length(v_cycle)))::uuid tid
    from days cross join jsonb_array_elements(p_config->'members') m
    join public.employees e on e.id=(m->>'employee')::uuid
  ), candidates as (
    select x.*, s.id sid, s.starts_at, s.ends_at, s.estado, s.operarios_planeados
    from expected x left join public.scheduled_shifts s on s.template_id=x.tid and s.sede_codigo=p_config->>'site'
      and s.contrato_codigo=p_contract and s.fecha_operativa=x.work_date::text and s.estado <> 'cancelado'
  )
  select c.work_date,c.eid,c.ename,c.tid,c.sid,
    case
      when c.tid is null then 'Descanso'
      when c.sid is null then 'Sin turno generado'
      when c.starts_at <= now() or c.estado <> 'programado' then 'Historico o iniciado'
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
  from candidates c order by c.work_date,c.ename,c.starts_at;
end $$;

create or replace function public.save_shift_rotation(p_contract text, p_name text, p_config jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  perform * from public.preview_shift_rotation(p_contract,p_config,(p_config->>'start')::date,(p_config->>'start')::date);
  insert into public.shift_rotations(contrato_codigo,nombre,config) values(p_contract,p_name,p_config) returning id into v_id;
  return v_id;
end $$;

create or replace function public.apply_shift_rotation(p_id uuid, p_activate boolean default false)
returns integer language plpgsql security definer set search_path=public as $$
declare r public.shift_rotations; x record; e public.employees; s public.scheduled_shifts; n integer:=0; v_count integer;
begin
  -- Serialize rotation runs and protect the check/insert window against manual assignments.
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

create or replace function public.pause_shift_rotation(p_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare r public.shift_rotations;
begin
  select * into r from public.shift_rotations where id=p_id for update;
  if r.id is null or not coalesce(public.is_admin_like() and public.can_read_contract_data(r.contrato_codigo),false) then raise exception 'Sin permiso'; end if;
  update public.shift_rotations set estado='pausado' where id=p_id;
end $$;

revoke all on function public.preview_shift_rotation(text,jsonb,date,date), public.save_shift_rotation(text,text,jsonb),
  public.apply_shift_rotation(uuid,boolean),public.pause_shift_rotation(uuid) from public,anon;
grant execute on function public.preview_shift_rotation(text,jsonb,date,date), public.save_shift_rotation(text,text,jsonb),
  public.apply_shift_rotation(uuid,boolean),public.pause_shift_rotation(uuid) to authenticated,service_role;
commit;

-- >>>>>>>>>> schema_operations_phase51_rotation_rules.sql
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

-- >>>>>>>>>> schema_operations_phase52_shift_generation_horizon.sql
-- Fixed horizon: 30 future days. Apply after phase 51.
-- Existing shifts and assignments are preserved, including dates beyond this horizon.
begin;
alter table public.shift_site_plan_assignments alter column horizon_days set default 30;
update public.shift_site_plan_assignments set horizon_days=30 where horizon_days is distinct from 30;

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
    (now() at time zone 'America/Bogota')::date+1,(now() at time zone 'America/Bogota')::date+30) loop
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


commit;

-- >>>>>>>>>> schema_operations_phase53_shift_planned_capacity.sql
-- The site's planned staffing is the shared budget for its active plans.
-- Apply after phase 52. Existing records are not deleted or reduced.
begin;

create or replace function public.enforce_shift_plan_capacity()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_planned integer; v_allocated bigint;
begin
  if new.estado <> 'activo' then return new; end if;
  -- Serialize activations for the same site, including different plans.
  select coalesce(numero_operarios,0) into v_planned
    from public.sedes where codigo=new.sede_codigo for update;
  if not found then raise exception 'Sede no encontrada: %',new.sede_codigo; end if;
  select coalesce(sum(operarios_planeados),0) into v_allocated
    from public.shift_site_plan_assignments
    where sede_codigo=new.sede_codigo and estado='activo' and id is distinct from new.id;
  if new.operarios_planeados + v_allocated > v_planned then
    raise exception 'Sede %: % operarios planeados, % en otros planes activos. Disponible para este plan: %.',
      new.sede_codigo,v_planned,v_allocated,greatest(0,v_planned-v_allocated);
  end if;
  return new;
end $$;

drop trigger if exists trg_shift_plan_capacity on public.shift_site_plan_assignments;
drop trigger if exists trg_shift_plan_capacity on public.shift_site_plan_assignments;
create trigger trg_shift_plan_capacity before insert or update of operarios_planeados,estado,sede_codigo
on public.shift_site_plan_assignments for each row execute function public.enforce_shift_plan_capacity();

create or replace function public.enforce_sede_planned_shift_capacity()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_allocated bigint;
begin
  if new.numero_operarios is not distinct from old.numero_operarios then return new; end if;
  select coalesce(sum(operarios_planeados),0) into v_allocated
    from public.shift_site_plan_assignments where sede_codigo=old.codigo and estado='activo';
  if coalesce(new.numero_operarios,0) < v_allocated then
    raise exception 'Sede %: hay % operarios distribuidos en planes activos. Ajusta los planes antes de reducir los planeados a %.',
      old.codigo,v_allocated,coalesce(new.numero_operarios,0);
  end if;
  return new;
end $$;

drop trigger if exists trg_sede_planned_shift_capacity on public.sedes;
drop trigger if exists trg_sede_planned_shift_capacity on public.sedes;
create trigger trg_sede_planned_shift_capacity before update of numero_operarios on public.sedes
for each row execute function public.enforce_sede_planned_shift_capacity();

create or replace function public.enforce_scheduled_shift_capacity()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_planned integer; v_plan_capacity integer;
begin
  if new.estado in ('cerrado','cancelado') then return new; end if;
  if tg_op='UPDATE' then
    if new.operarios_planeados is not distinct from old.operarios_planeados
       and new.template_id is not distinct from old.template_id
       and new.sede_codigo is not distinct from old.sede_codigo
       and old.estado not in ('cerrado','cancelado') then return new; end if;
  end if;
  select coalesce(numero_operarios,0) into v_planned
    from public.sedes where codigo=new.sede_codigo for update;
  if not found then raise exception 'Sede no encontrada: %',new.sede_codigo; end if;
  select operarios_planeados into v_plan_capacity from public.shift_site_plan_assignments
    where sede_codigo=new.sede_codigo and template_id=new.template_id and estado='activo';
  if v_plan_capacity is null then raise exception 'Activa el plan en la sede antes de programar turnos.'; end if;
  if new.operarios_planeados > least(v_planned,v_plan_capacity) then
    raise exception 'Sede %: el turno no puede superar los % operarios autorizados en el plan y la sede.',
      new.sede_codigo,least(v_planned,v_plan_capacity);
  end if;
  return new;
end $$;

drop trigger if exists trg_scheduled_shift_capacity on public.scheduled_shifts;
drop trigger if exists trg_scheduled_shift_capacity on public.scheduled_shifts;
create trigger trg_scheduled_shift_capacity before insert or update of operarios_planeados,template_id,sede_codigo,estado
on public.scheduled_shifts for each row execute function public.enforce_scheduled_shift_capacity();

revoke all on function public.enforce_shift_plan_capacity() from public;
revoke all on function public.enforce_sede_planned_shift_capacity() from public;
revoke all on function public.enforce_scheduled_shift_capacity() from public;
commit;

-- Review old excesses without modifying schedules or assignments.
select s.codigo,s.nombre,coalesce(s.numero_operarios,0) as planeados,
  sum(a.operarios_planeados) as distribuidos_en_planes
from public.sedes s join public.shift_site_plan_assignments a on a.sede_codigo=s.codigo and a.estado='activo'
group by s.codigo,s.nombre,s.numero_operarios
having sum(a.operarios_planeados)>coalesce(s.numero_operarios,0);

-- >>>>>>>>>> schema_operations_phase54_shift_attendance.sql
-- Apply after phase 53, before deploying the new backend.
begin;
do $radius$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sedes' and column_name = 'qr_radius_meters' and column_default like '500%') then
    update public.sedes set qr_radius_meters = 200 where qr_radius_meters = 500;
  end if;
end
$radius$;
alter table public.sedes alter column qr_radius_meters set default 200;

-- Keep legacy daily records unique, while allowing separate worked shifts.
drop index if exists public.attendance_unique_fecha_documento;
create unique index if not exists attendance_unique_fecha_documento
  on public.attendance(fecha, documento) where documento is not null and turno_id is null;
create unique index if not exists attendance_unique_turno_documento
  on public.attendance(turno_id, documento) where turno_id is not null and documento is not null;
drop index if exists public.employee_daily_exits_unique_fecha_documento;
create unique index if not exists employee_daily_exits_unique_fecha_documento
  on public.employee_daily_exits(fecha, documento) where documento is not null and turno_id is null;
create unique index if not exists employee_daily_exits_unique_turno_documento
  on public.employee_daily_exits(turno_id, documento) where turno_id is not null and documento is not null;

-- Evidence belongs to the marking, independently of QR tokens. No historical backfill.
alter table public.attendance
  add column if not exists marking_method text,
  add column if not exists request_latitude double precision,
  add column if not exists request_longitude double precision,
  add column if not exists request_distance_meters integer,
  add column if not exists location_verified_at timestamptz,
  add column if not exists phone_number text;
alter table public.employee_daily_exits
  add column if not exists marking_method text,
  add column if not exists request_latitude double precision,
  add column if not exists request_longitude double precision,
  add column if not exists request_distance_meters integer,
  add column if not exists location_verified_at timestamptz,
  add column if not exists phone_number text;

create or replace function public.register_shift_attendance(p_event jsonb)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_shift public.scheduled_shifts%rowtype;
  v_site public.sedes%rowtype;
  v_employee public.employees%rowtype;
  v_token public.attendance_qr_tokens%rowtype;
  v_entry public.attendance%rowtype;
  v_status public.employee_shift_status%rowtype;
  v_action text := p_event->>'action';
  v_method text := p_event->>'method';
  v_emp uuid := (p_event->>'employee_id')::uuid;
  v_shift_id uuid := (p_event->>'turno_id')::uuid;
  v_token_id uuid := (p_event->>'qr_token_id')::uuid;
  v_device_id uuid := (p_event->>'device_id')::uuid;
  v_at timestamptz := clock_timestamp();
  v_lat double precision;
  v_lng double precision;
  v_distance double precision;
  v_verified timestamptz;
  v_record_id text;
  v_class text := p_event->'classification'->>'status';
  v_minutes integer := coalesce((p_event->'classification'->>'minutes')::integer, 0);
  v_review boolean := coalesce((p_event->'classification'->>'requiresReview')::boolean, false);
  v_state text;
begin
  if v_action is null or v_action not in ('entry','exit') or v_method is null or v_method not in ('qr','location') then
    raise exception 'invalid_marking';
  end if;
  -- Same lock order as shift closure: lock the shift before employee status.
  select * into v_shift from public.scheduled_shifts where id = v_shift_id for update;
  if not found or v_shift.estado = 'cancelado' then raise exception 'attendance_shift_missing'; end if;
  select * into v_employee from public.employees where id = v_emp for share;
  if not found or lower(v_employee.estado) <> 'activo' then raise exception 'employee_inactive'; end if;
  select * into v_site from public.sedes where codigo = v_shift.sede_codigo for share;
  if not found or lower(v_site.estado) <> 'activo' then raise exception 'attendance_shift_missing'; end if;
  if p_event->>'sede_codigo' is distinct from v_shift.sede_codigo then raise exception 'sede_mismatch'; end if;
  if v_method = 'qr' then
    if not v_site.qr_enabled then raise exception 'qr_disabled'; end if;
    select * into v_token from public.attendance_qr_tokens where id = v_token_id for update;
    if not found then raise exception 'qr_not_found'; end if;
    if v_token.used_at is not null then raise exception 'qr_used'; end if;
    if v_token.expires_at <= v_at then raise exception 'qr_expired'; end if;
    if v_token.turno_id is distinct from v_shift_id or v_token.employee_id is distinct from v_emp
      or v_token.action is distinct from v_action or v_token.sede_codigo is distinct from v_shift.sede_codigo then
      raise exception 'sede_mismatch';
    end if;
    if not exists(select 1 from public.sede_devices d where d.id = v_device_id and d.estado = 'activo' and d.revoked_at is null
      and (d.sede_codigo = v_shift.sede_codigo or exists(select 1 from public.sede_device_sites ds where ds.device_id = d.id and ds.sede_codigo = v_shift.sede_codigo))) then
      raise exception 'device_inactive';
    end if;
    v_lat := v_token.request_latitude;
    v_lng := v_token.request_longitude;
    v_verified := v_token.location_verified_at;
  else
    if v_site.qr_enabled then raise exception 'qr_disabled'; end if;
    v_lat := (p_event->>'request_latitude')::double precision;
    v_lng := (p_event->>'request_longitude')::double precision;
    v_verified := (p_event->>'location_verified_at')::timestamptz;
  end if;
  if v_lat is null or v_lng is null or not (v_lat between -90 and 90) or not (v_lng between -180 and 180)
    or v_site.qr_latitude is null or v_site.qr_longitude is null
    or not (v_site.qr_latitude between -90 and 90) or not (v_site.qr_longitude between -180 and 180)
    or (abs(v_site.qr_latitude) < 0.000001 and abs(v_site.qr_longitude) < 0.000001)
    or v_verified is null or v_verified > v_at + interval '1 minute'
    or (v_method = 'location' and v_verified < v_at - interval '5 minutes') then
    raise exception 'location_required';
  end if;
  v_distance := 6371000 * 2 * asin(sqrt(least(1.0,
    power(sin(radians(v_lat - v_site.qr_latitude) / 2), 2)
    + cos(radians(v_site.qr_latitude)) * cos(radians(v_lat))
    * power(sin(radians(v_lng - v_site.qr_longitude) / 2), 2))));
  if v_distance > coalesce(nullif(v_site.qr_radius_meters, 0), 200) then raise exception 'location_outside'; end if;

  select * into v_entry from public.attendance where turno_id = v_shift_id and documento = v_employee.documento and asistio = true;
  select * into v_status from public.employee_shift_status where scheduled_shift_id = v_shift_id and employee_id = v_emp for update;
  v_record_id := v_shift_id::text || '_' || v_emp::text;
  if v_action = 'entry' then
    if v_entry.id is not null or v_status.entrada_at is not null then raise exception 'entry_exists'; end if;
    if v_shift.estado = 'cerrado' or v_at >= v_shift.ends_at then raise exception 'attendance_shift_missing'; end if;
    insert into public.attendance(id, fecha, empleado_id, documento, nombre, sede_codigo, sede_nombre,
      asistio, novedad, turno_id, fecha_operativa, reported_at, registro_estado, requires_review,
      early_entry_minutes, late_entry_minutes, marking_method, request_latitude, request_longitude,
      request_distance_meters, location_verified_at, phone_number,
      contrato_codigo, contrato_nombre, cliente_nombre_snapshot, cliente_nit_snapshot)
    values(v_record_id, v_shift.fecha_operativa, v_emp, v_employee.documento, v_employee.nombre,
      v_shift.sede_codigo, v_shift.sede_nombre, true, '1', v_shift_id, v_shift.fecha_operativa, v_at,
      v_class, v_review, case when v_class = 'entrada_anticipada' then v_minutes else 0 end,
      case when v_class = 'entrada_tardia' then v_minutes else 0 end, v_method, v_lat, v_lng,
      round(v_distance)::integer, v_verified, p_event->>'phone_number',
      p_event->>'contrato_codigo', p_event->>'contrato_nombre', p_event->>'cliente_nombre_snapshot', p_event->>'cliente_nit_snapshot');
    v_state := case when v_class = 'entrada_tardia' then 'trabajado_tardio' else 'trabajado' end;
    insert into public.employee_shift_status(id, scheduled_shift_id, fecha_operativa, employee_id, documento,
      nombre, sede_codigo, estado_turno, asistio, entrada_at, source_attendance_id, novedad_codigo, novedad_nombre,
      early_entry_minutes, late_entry_minutes, requires_review,
      contrato_codigo, contrato_nombre, cliente_nombre_snapshot, cliente_nit_snapshot)
    values(coalesce(v_status.id, v_record_id), v_shift_id, v_shift.fecha_operativa, v_emp, v_employee.documento,
      v_employee.nombre, v_shift.sede_codigo, v_state, true, v_at, v_record_id, '1', 'Trabajando',
      case when v_class = 'entrada_anticipada' then v_minutes else 0 end,
      case when v_class = 'entrada_tardia' then v_minutes else 0 end, v_review,
      p_event->>'contrato_codigo', p_event->>'contrato_nombre', p_event->>'cliente_nombre_snapshot', p_event->>'cliente_nit_snapshot')
    on conflict(id) do update set estado_turno = excluded.estado_turno, asistio = true, entrada_at = v_at,
      source_attendance_id = v_record_id, novedad_codigo = '1', novedad_nombre = 'Trabajando',
      early_entry_minutes = excluded.early_entry_minutes, late_entry_minutes = excluded.late_entry_minutes,
      requires_review = employee_shift_status.requires_review or excluded.requires_review;
    update public.scheduled_shifts set estado = 'abierto', opened_at = coalesce(opened_at, v_at) where id = v_shift_id and estado = 'programado';
  else
    if v_entry.id is null or v_status.entrada_at is null then raise exception 'exit_requires_entry'; end if;
    if v_status.salida_at is not null or exists(select 1 from public.employee_daily_exits where turno_id = v_shift_id and documento = v_employee.documento) then
      raise exception 'exit_exists';
    end if;
    insert into public.employee_daily_exits(id, fecha, employee_id, documento, nombre, sede_codigo, sede_nombre,
      qr_token_id, device_id, entry_attendance_id, exit_at, turno_id, fecha_operativa, registro_estado, requires_review,
      early_exit_minutes, late_exit_minutes, marking_method, request_latitude, request_longitude,
      request_distance_meters, location_verified_at, phone_number,
      contrato_codigo, contrato_nombre, cliente_nombre_snapshot, cliente_nit_snapshot)
    values(v_record_id, v_shift.fecha_operativa, v_emp, v_employee.documento, v_employee.nombre,
      v_shift.sede_codigo, v_shift.sede_nombre, v_token_id, v_device_id, v_entry.id, v_at,
      v_shift_id, v_shift.fecha_operativa, v_class, v_review or v_shift.estado = 'cerrado',
      case when v_class = 'salida_anticipada' then v_minutes else 0 end,
      case when v_class = 'salida_tardia' then v_minutes else 0 end, v_method, v_lat, v_lng,
      round(v_distance)::integer, v_verified, p_event->>'phone_number',
      p_event->>'contrato_codigo', p_event->>'contrato_nombre', p_event->>'cliente_nombre_snapshot', p_event->>'cliente_nit_snapshot');
    update public.employee_shift_status set salida_at = v_at, source_exit_id = v_record_id,
      early_exit_minutes = case when v_class = 'salida_anticipada' then v_minutes else 0 end,
      late_exit_minutes = case when v_class = 'salida_tardia' then v_minutes else 0 end,
      requires_review = requires_review or v_review or v_shift.estado = 'cerrado',
      estado_turno = case when v_shift.estado = 'cerrado' then 'post_cierre_pendiente'
        when v_class = 'salida_anticipada' then 'retiro_anticipado'
        when late_entry_minutes > 0 then 'trabajado_tardio' else 'trabajado' end
    where id = v_status.id;
  end if;
  if v_method = 'qr' then
    update public.attendance_qr_tokens set used_at = v_at, used_by_device_id = v_device_id where id = v_token_id;
  end if;
  return jsonb_build_object('status', case when v_action = 'entry' then 'entry_registered' else 'exit_registered' end,
    'attendanceId', case when v_action = 'entry' then v_record_id else v_entry.id end,
    'exitId', case when v_action = 'exit' then v_record_id else null end, 'eventAt', v_at);
end;
$$;
revoke all on function public.register_shift_attendance(jsonb) from public, anon, authenticated;
grant execute on function public.register_shift_attendance(jsonb) to service_role;

-- Serialize closure with marking so a stale snapshot cannot erase a real exit.
create or replace function public.finalize_shift_attendance(p_shift_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_rows jsonb;
begin
  perform 1 from public.scheduled_shifts where id = p_shift_id and estado <> 'cancelado' for update;
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
  select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) into v_rows
    from public.employee_shift_status s where scheduled_shift_id = p_shift_id;
  return v_rows;
end;
$$;
revoke all on function public.finalize_shift_attendance(uuid) from public, anon, authenticated;
grant execute on function public.finalize_shift_attendance(uuid) to service_role;
commit;

-- >>>>>>>>>> schema_operations_phase55_employee_retirements.sql
-- Apply before deploying the employee retirement UI. Existing retirees remain valid.
begin;

alter table public.employees add column if not exists retiro_motivo text;
alter table public.employees add column if not exists retiro_observacion text;

create table if not exists public.employee_retirements (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  documento text,
  contrato_codigo text,
  fecha_ingreso timestamptz,
  fecha_retiro timestamptz not null,
  motivo text not null check (motivo in (
    'renuncia','mutuo_acuerdo','vencimiento_contrato','finalizacion_obra_labor',
    'despido_justa_causa','despido_sin_justa_causa','fallecimiento',
    'liquidacion_empresa','abandono_cargo','sentencia_judicial','pension_jubilacion','periodo_prueba'
  )),
  observacion text not null check (observacion ~ '[^[:space:]]'),
  created_by_uid uuid,
  created_by_email text,
  created_at timestamptz not null default now()
);
create index if not exists employee_retirements_employee_created_idx
  on public.employee_retirements(employee_id, created_at desc);
alter table public.employee_retirements enable row level security;
drop policy if exists employee_retirements_read on public.employee_retirements;
drop policy if exists employee_retirements_read on public.employee_retirements;
create policy employee_retirements_read on public.employee_retirements
  for select to authenticated using (
    public.can_read_contract_data(contrato_codigo)
    or public.can_read_employee_data(employee_id, documento)
  );
grant select on public.employee_retirements to authenticated;
revoke insert, update, delete on public.employee_retirements from anon, authenticated;

-- The employee UPDATE and the history INSERT commit or roll back together.
-- A trigger covers rehireEmployee, imports and all other employee write paths.
create or replace function public.prepare_employee_retirement()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.estado = 'inactivo' and (tg_op = 'INSERT' or old.estado is distinct from 'inactivo') then
    if new.retiro_motivo is null or new.retiro_motivo not in (
      'renuncia','mutuo_acuerdo','vencimiento_contrato','finalizacion_obra_labor',
      'despido_justa_causa','despido_sin_justa_causa','fallecimiento',
      'liquidacion_empresa','abandono_cargo','sentencia_judicial','pension_jubilacion','periodo_prueba'
    ) then
      raise exception 'Selecciona un motivo de retiro válido desde Empleados > Retirar empleado.';
    end if;
    new.retiro_observacion := btrim(new.retiro_observacion);
    if new.retiro_observacion is null or new.retiro_observacion !~ '[^[:space:]]' then
      raise exception 'Escribe la observación del retiro.';
    end if;
    if new.fecha_retiro is null or new.fecha_retiro < new.fecha_ingreso then
      raise exception 'La fecha de retiro es obligatoria y no puede ser anterior al ingreso.';
    end if;
  elsif new.estado = 'activo' then
    new.retiro_motivo := null;
    new.retiro_observacion := null;
  elsif tg_op = 'UPDATE' and old.estado = 'inactivo' and new.estado = 'inactivo'
    and (new.retiro_motivo is distinct from old.retiro_motivo
      or new.retiro_observacion is distinct from old.retiro_observacion) then
    raise exception 'El motivo y la observación del retiro registrado no se pueden sobrescribir.';
  end if;
  return new;
end;
$$;

create or replace function public.record_employee_retirement()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'inactivo' and (tg_op = 'INSERT' or old.estado is distinct from 'inactivo') then
    insert into public.employee_retirements (
      employee_id, documento, contrato_codigo, fecha_ingreso, fecha_retiro,
      motivo, observacion, created_by_uid, created_by_email
    ) values (
      new.id, new.documento, new.contrato_codigo, new.fecha_ingreso, new.fecha_retiro,
      new.retiro_motivo, new.retiro_observacion, auth.uid(), auth.jwt()->>'email'
    );
  end if;
  return new;
end;
$$;
revoke all on function public.record_employee_retirement() from public;
drop trigger if exists prepare_employee_retirement on public.employees;
drop trigger if exists prepare_employee_retirement on public.employees;
create trigger prepare_employee_retirement before insert or update on public.employees
  for each row execute function public.prepare_employee_retirement();
drop trigger if exists record_employee_retirement on public.employees;
drop trigger if exists record_employee_retirement on public.employees;
create trigger record_employee_retirement after insert or update on public.employees
  for each row execute function public.record_employee_retirement();

commit;

-- >>>>>>>>>> schema_operations_phase56_retired_certificates.sql
-- Apply before deploying the backend that emits retirement certificates.
begin;
alter table public.employee_certificate_audit
  drop constraint if exists employee_certificate_audit_certificate_type_check;
alter table public.employee_certificate_audit
  add constraint employee_certificate_audit_certificate_type_check
  check (certificate_type in ('basic', 'with_salary', 'retired'));
commit;

-- >>>>>>>>>> schema_operations_phase57_cargo_functions.sql
-- Apply before deploying the cargo editor and certificates with functions.
begin;
alter table public.cargos add column if not exists funciones text not null default '';
alter table public.cargos drop constraint if exists cargos_funciones_length_check;
alter table public.cargos add constraint cargos_funciones_length_check check (char_length(funciones) <= 12000);
comment on column public.cargos.funciones is 'Funciones del cargo incluidas en los certificados laborales; texto plano, una función por línea.';
alter table public.employee_certificate_audit drop constraint if exists employee_certificate_audit_certificate_type_check;
alter table public.employee_certificate_audit add constraint employee_certificate_audit_certificate_type_check
  check (certificate_type in ('basic', 'with_salary', 'retired', 'with_functions', 'retired_with_functions'));
commit;

-- >>>>>>>>>> schema_operations_phase58_inventory.sql
-- Inventory: apply after phase 57. All mutations are transactional RPCs.
begin;
create table if not exists public.inventory_products (
 id uuid primary key default gen_random_uuid(), contrato_codigo text not null references public.contracts(codigo),
 code text not null, name text not null, unit text not null, category text not null default '',
 kind text not null check(kind in ('consumible','bien')), minimum numeric(14,3) not null default 0 check(minimum>=0),
 created_at timestamptz not null default now(), created_by uuid not null default auth.uid(),
 unique(contrato_codigo,code), check(length(trim(code))>0 and length(trim(name))>0 and length(trim(unit))>0)
);
create table if not exists public.inventory_events (
 id uuid primary key, number bigint generated always as identity unique,
 contrato_codigo text not null references public.contracts(codigo),
 type text not null check(type in ('ingreso','borrador','despacho','recepcion','devolucion','ajuste')),
 parent_id uuid references public.inventory_events(id), data jsonb not null,
 created_at timestamptz not null default now(), created_by uuid not null default auth.uid()
);
create index if not exists inventory_events_contract on public.inventory_events(contrato_codigo,number);
create index if not exists inventory_events_parent on public.inventory_events(parent_id);
create table if not exists public.inventory_balances (
 contrato_codigo text not null references public.contracts(codigo), product_id uuid not null references public.inventory_products(id),
 location text not null, quantity numeric(14,3) not null default 0 check(quantity>=0),
 primary key(contrato_codigo,product_id,location)
);
-- Explicit new keys can be overridden in the permissions center; existing defaults are preserved.
create or replace function public.inventory_permission(p_key text) returns boolean
language sql stable security definer set search_path=public as $$
 select public.current_profile_has_permission(p_key, case when p_key='viewInventory' then 'viewContracts' else 'editContracts' end)
$$;
do $$ declare t text; begin
 foreach t in array array['inventory_products','inventory_events','inventory_balances'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon, authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('drop policy if exists inventory_read on public.%I',t);
 execute format('create policy inventory_read on public.%I for select to authenticated using (public.can_read_contract_data(contrato_codigo) and (public.inventory_permission(''viewInventory'') or public.inventory_permission(''manageInventory'') or public.inventory_permission(''dispatchInventory'') or public.inventory_permission(''receiveInventory'')))',t);
 end loop;
end $$;

create or replace function public.inventory_product_create(p_contract text,p_data jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
declare v_id uuid; begin
 if not coalesce(public.can_read_contract_data(p_contract) and public.inventory_permission('manageInventory'),false) then raise exception 'Sin permiso'; end if;
 if coalesce((p_data->>'minimum')::numeric,0)::text in ('NaN','Infinity','-Infinity') then raise exception 'Mínimo inválido'; end if;
 insert into inventory_products(contrato_codigo,code,name,unit,category,kind,minimum)
 values(p_contract,trim(p_data->>'code'),trim(p_data->>'name'),trim(p_data->>'unit'),coalesce(p_data->>'category',''),p_data->>'kind',coalesce((p_data->>'minimum')::numeric,0)) returning id into v_id;
 return v_id;
end $$;

create or replace function public.inventory_post(p_contract text,p_id uuid,p_type text,p_data jsonb,p_parent uuid default null) returns uuid
language plpgsql security definer set search_path=public as $$
declare
 v_parent inventory_events; v_product inventory_products; v_line jsonb; v_lines jsonb := '[]';
 v_qty numeric; v_total numeric; v_previous numeric; v_location text; v_delta numeric;
 v_permission text; v_snapshot jsonb; v_existing inventory_events;
begin
 v_permission := case when p_type in ('borrador','despacho') then 'dispatchInventory' when p_type='recepcion' then 'receiveInventory' else 'manageInventory' end;
 if not coalesce(public.can_read_contract_data(p_contract) and public.inventory_permission(v_permission),false) then raise exception 'Sin permiso'; end if;
 -- Serialize within a contract, including retries and concurrent dispatches.
 perform 1 from contracts where codigo=p_contract for update;
 if not found then raise exception 'Contrato inexistente'; end if;
 select * into v_existing from inventory_events where id=p_id;
 if found then
   if v_existing.contrato_codigo<>p_contract or v_existing.type<>p_type or v_existing.parent_id is distinct from p_parent then raise exception 'Identificador ya utilizado'; end if;
   return p_id;
 end if;
 if p_type not in ('ingreso','borrador','despacho','recepcion','devolucion','ajuste') then raise exception 'Movimiento invalido'; end if;
 if p_parent is not null then
   select * into v_parent from inventory_events where id=p_parent and contrato_codigo=p_contract;
   if not found then raise exception 'Documento fuera del contrato'; end if;
 end if;
 if p_type='despacho' and p_parent is not null then
   if v_parent.type<>'borrador' or exists(select 1 from inventory_events where parent_id=p_parent and type='despacho') then raise exception 'Borrador ya despachado o invalido'; end if;
   p_data := v_parent.data;
 elsif p_type='devolucion' and p_parent is not null then
   if v_parent.type<>'despacho' then raise exception 'Selecciona un despacho'; end if;
   p_data:=p_data || jsonb_build_object('location',v_parent.data->>'location','site',v_parent.data->>'site');
 elsif p_type='recepcion' then
   if p_parent is null or v_parent.type<>'despacho' then raise exception 'Selecciona un despacho'; end if;
   if not exists(select 1 from jsonb_array_elements(v_parent.data->'lines') x where
     (x->>'quantity')::numeric > coalesce((select sum((y->>'quantity')::numeric) from inventory_events e cross join lateral jsonb_array_elements(e.data->'lines') y where e.parent_id=p_parent and e.type in ('recepcion','devolucion') and y->>'product'=x->>'product'),0)) then raise exception 'El despacho no tiene cantidades pendientes'; end if;
   if coalesce(p_data->>'receiver','')='' or coalesce(p_data->>'document','')='' or coalesce(p_data->>'position','')='' or coalesce((p_data->>'accepted')::boolean,false) is not true
      or coalesce(p_data->>'signature','') !~ '^data:image/png;base64,[A-Za-z0-9+/=]+$' or length(p_data->>'signature') not between 200 and 500000
      or coalesce(p_data->>'result','') not in ('satisfaccion','novedades','rechazado') then raise exception 'Completa receptor, conformidad y firma'; end if;
   if p_data->>'result'<>'satisfaccion' and length(trim(coalesce(p_data->>'notes','')))=0 then raise exception 'Describe la novedad'; end if;
 elsif p_parent is not null then raise exception 'Referencia invalida';
 end if;
 if p_type in ('ingreso','ajuste','devolucion') and length(trim(coalesce(p_data->>'reference','')))=0 then raise exception 'Indica factura o motivo'; end if;
 if p_type='ingreso' and length(trim(coalesce(p_data->>'supplier','')))=0 then raise exception 'Indica proveedor'; end if;
 if p_type='ingreso' then
   p_data:=p_data || jsonb_build_object('date',coalesce(nullif(p_data->>'date','')::date,(now() at time zone 'America/Bogota')::date));
 end if;
 if p_type in ('borrador','despacho') then
   if not exists(select 1 from sedes where codigo=p_data->>'site' and contrato_codigo=p_contract and estado='activo') then raise exception 'Sede fuera del contrato o inactiva'; end if;
   if length(trim(coalesce(p_data->>'recipient','')))=0 then raise exception 'Indica destinatario'; end if;
 end if;
 v_location:=trim(p_data->>'location');
 if p_type<>'recepcion' and coalesce(v_location,'')='' then raise exception 'Indica ubicacion de almacenamiento'; end if;
 if jsonb_typeof(p_data->'lines') is distinct from 'array' then raise exception 'Agrega productos'; end if;
 if jsonb_array_length(p_data->'lines') not between 1 and 100 then raise exception 'Agrega entre 1 y 100 productos'; end if;
 if (select count(*) from jsonb_array_elements(p_data->'lines'))<>(select count(distinct x->>'product') from jsonb_array_elements(p_data->'lines') x) then raise exception 'Producto duplicado'; end if;
 for v_line in select value from jsonb_array_elements(p_data->'lines') loop
   select * into v_product from inventory_products where id=(v_line->>'product')::uuid and contrato_codigo=p_contract;
   if not found then raise exception 'Producto fuera del contrato'; end if;
   v_qty:=(v_line->>'quantity')::numeric;
   if v_qty is null or v_qty::text in ('NaN','Infinity','-Infinity') or abs(v_qty)>99999999999 or v_qty<>round(v_qty,3)
      or (p_type='recepcion' and v_qty<0) or (p_type not in ('recepcion','ajuste') and v_qty<=0) or (p_type='ajuste' and v_qty=0) then raise exception 'Cantidad invalida'; end if;
   if p_type='ingreso' and (coalesce((v_line->>'cost')::numeric,-1)<0 or ((v_line->>'cost')::numeric)::text in ('NaN','Infinity','-Infinity')) then raise exception 'Costo invalido'; end if;
   if p_type='recepcion' or (p_type='devolucion' and p_parent is not null) then
     select (x->>'quantity')::numeric into v_total from jsonb_array_elements(v_parent.data->'lines') x where x->>'product'=v_product.id::text;
     if v_total is null then raise exception 'Producto no despachado'; end if;
     select coalesce(sum((x->>'quantity')::numeric),0) into v_previous from inventory_events e cross join lateral jsonb_array_elements(e.data->'lines') x
       where e.parent_id=p_parent and e.type in ('recepcion','devolucion') and x->>'product'=v_product.id::text;
     if v_qty>v_total-v_previous then raise exception 'Cantidad superior al pendiente'; end if;
     if p_data->>'result'='satisfaccion' and v_qty<>v_total-v_previous then raise exception 'Registra la recepción parcial como novedad'; end if;
     if p_data->>'result'='rechazado' and v_qty<>0 then raise exception 'Un rechazo no recibe unidades'; end if;
   end if;
   v_lines:=v_lines || jsonb_build_array(v_line || jsonb_build_object('code',v_product.code,'name',v_product.name,'unit',v_product.unit,'quantity',v_qty));
   if p_type in ('ingreso','despacho','devolucion','ajuste') then
     v_delta:=case when p_type='despacho' then -v_qty else v_qty end;
     insert into inventory_balances(contrato_codigo,product_id,location,quantity) values(p_contract,v_product.id,v_location,0) on conflict do nothing;
     update inventory_balances set quantity=quantity+v_delta where contrato_codigo=p_contract and product_id=v_product.id and location=v_location and quantity+v_delta>=0;
     if not found then raise exception 'Existencia insuficiente para %',v_product.name; end if;
   end if;
 end loop;
 if p_type='recepcion' and p_data->>'result'='satisfaccion' then
   if exists(select 1 from jsonb_array_elements(v_parent.data->'lines') x where
     (x->>'quantity')::numeric > coalesce((select sum((y->>'quantity')::numeric) from inventory_events e cross join lateral jsonb_array_elements(e.data->'lines') y where e.parent_id=p_parent and e.type in ('recepcion','devolucion') and y->>'product'=x->>'product'),0)
     and not exists(select 1 from jsonb_array_elements(v_lines) y where y->>'product'=x->>'product')) then raise exception 'Revisa todos los productos pendientes'; end if;
 end if;
 select jsonb_build_object('code',codigo,'name',nombre,'client',cliente_nombre,'nit',cliente_nit) into v_snapshot from contracts where codigo=p_contract;
 insert into inventory_events(id,contrato_codigo,type,parent_id,data) values(p_id,p_contract,p_type,p_parent,
   p_data || jsonb_build_object('lines',v_lines,'contract',case when p_type='recepcion' then v_parent.data->'contract' else v_snapshot end,
   'site',case when p_type='recepcion' then v_parent.data->>'site' else p_data->>'site' end,
   'consent',case when p_type='recepcion' then 'Confirmo las cantidades y el resultado registrados en esta acta y autorizo incorporar mi firma como constancia de esta recepción.' else null end));
 return p_id;
end $$;
revoke all on function public.inventory_permission(text), public.inventory_product_create(text,jsonb), public.inventory_post(text,uuid,text,jsonb,uuid) from public,anon;
grant execute on function public.inventory_permission(text), public.inventory_product_create(text,jsonb), public.inventory_post(text,uuid,text,jsonb,uuid) to authenticated;
commit;

-- >>>>>>>>>> schema_operations_phase59_site_visits.sql
-- Apply after phase 58. Private evidence and server-validated, immutable submissions.
begin;
create table if not exists public.visit_settings (
 contrato_codigo text primary key references public.contracts(codigo),
 frequency text not null check(frequency in ('weekly','fortnightly','monthly')),
 starts_on date not null, enabled boolean not null default true,
 radius_m integer not null default 200 check(radius_m between 20 and 2000),
 accuracy_m integer not null default 100 check(accuracy_m between 5 and 500),
 updated_at timestamptz not null default now(), updated_by uuid not null default auth.uid(),
 check(frequency <> 'monthly' or extract(day from starts_on)=1)
);
create table if not exists public.visit_cycles (
 id uuid primary key default gen_random_uuid(), contrato_codigo text not null references public.contracts(codigo),
 contract_name text not null, starts_on date not null, ends_on date not null,
 radius_m integer not null, accuracy_m integer not null,
 created_at timestamptz not null default now(), unique(contrato_codigo,starts_on), check(ends_on>=starts_on)
);
create table if not exists public.visit_assignments (
 id uuid primary key default gen_random_uuid(), cycle_id uuid not null references public.visit_cycles(id),
 contrato_codigo text not null, sede_codigo text not null, sede_name text not null, zone_code text,
 supervisor_id uuid, supervisor_name text not null, latitude double precision, longitude double precision,
 unique(cycle_id,sede_codigo,supervisor_id)
);
create table if not exists public.site_visits (
 id uuid primary key, assignment_id uuid not null references public.visit_assignments(id),
 created_by uuid not null default auth.uid(), started_at timestamptz not null default now(),
 latitude double precision not null, longitude double precision not null, accuracy_m double precision not null,
 distance_m double precision, gps_issue text not null default '',
 status text not null default 'draft' check(status in ('draft','valid','review','rejected')),
 has_findings boolean, findings text not null default '', recommendations text not null default '', observations text not null default '',
 photos text[] not null default '{}', submitted_at timestamptz,
 reviewed_by uuid, reviewed_at timestamptz, review_note text,
 check(latitude between -90 and 90 and longitude between -180 and 180 and accuracy_m between 0 and 100000)
);
create index if not exists visit_assignments_supervisor on public.visit_assignments(supervisor_id,cycle_id);
create index if not exists site_visits_assignment on public.site_visits(assignment_id,submitted_at);

create or replace function public.visit_admin(p_contract text) returns boolean language sql stable security definer set search_path=public as $$
 select coalesce(public.can_read_contract_data(p_contract) and public.current_profile_has_permission('editContracts','editContracts'),false)
$$;
create or replace function public.visit_active_user() returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from profiles where id=auth.uid() and estado='activo')
$$;
create or replace function public.visit_assignment_read(p_assignment uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from visit_assignments a where a.id=p_assignment and
 (visit_admin(a.contrato_codigo) or (a.supervisor_id=auth.uid() and visit_active_user())))
$$;
create or replace function public.visit_period_end(p_start date,p_frequency text) returns date language plpgsql immutable set search_path=public as $$
begin
 if p_frequency='weekly' then return p_start+6;
 elsif p_frequency='fortnightly' then return p_start+13;
 elsif p_frequency='monthly' then return (date_trunc('month',p_start)+interval '1 month - 1 day')::date;
 else raise exception 'Frecuencia inválida'; end if;
end $$;

-- Called on module load, at schedule creation, and BEFORE assignment changes.
-- Backfill sees the assignment state that existed before each change, never new assignments for old cycles.
create or replace function public.visit_sync_cycles() returns void language plpgsql security definer set search_path=public as $$
declare s visit_settings; d date; e date; cid uuid; today date := (now() at time zone 'America/Bogota')::date;
begin
 perform pg_advisory_xact_lock(590059);
 for s in select vs.* from visit_settings vs join contracts c on c.codigo=vs.contrato_codigo where vs.enabled and c.estado='activo' loop
   select coalesce(max(ends_on)+1,s.starts_on) into d from visit_cycles where contrato_codigo=s.contrato_codigo;
   while d<=today loop
     e := visit_period_end(d,s.frequency);
     insert into visit_cycles(contrato_codigo,contract_name,starts_on,ends_on,radius_m,accuracy_m)
     select s.contrato_codigo,coalesce(nombre,codigo),d,e,s.radius_m,s.accuracy_m from contracts where codigo=s.contrato_codigo returning id into cid;
     insert into visit_assignments(cycle_id,contrato_codigo,sede_codigo,sede_name,zone_code,supervisor_id,supervisor_name,latitude,longitude)
     select cid,s.contrato_codigo,site.codigo,coalesce(site.nombre,site.codigo),site.zona_codigo,p.id,
       coalesce(to_jsonb(p)->>'nombre',p.email,'Sin supervisor'),site.qr_latitude,site.qr_longitude
     from sedes site left join profiles p on p.role::text='supervisor' and p.estado='activo' and p.supervisor_eligible=true
       and (site.zona_codigo=p.zona_codigo or site.zona_codigo=any(coalesce(p.zonas_permitidas,'{}'::text[])))
     where site.contrato_codigo=s.contrato_codigo and site.estado='activo';
     d := e+1;
   end loop;
 end loop;
end $$;
create or replace function public.visit_before_scope_change() returns trigger language plpgsql security definer set search_path=public as $$
begin perform visit_sync_cycles(); return null; end $$;
drop trigger if exists visit_sede_snapshot on public.sedes;
create trigger visit_sede_snapshot before insert or update or delete on public.sedes for each statement execute function public.visit_before_scope_change();
drop trigger if exists visit_profile_snapshot on public.profiles;
create trigger visit_profile_snapshot before insert or update or delete on public.profiles for each statement execute function public.visit_before_scope_change();
drop trigger if exists visit_contract_snapshot on public.contracts;
create trigger visit_contract_snapshot before update or delete on public.contracts for each statement execute function public.visit_before_scope_change();

create or replace function public.visit_save_settings(p_contract text,p_frequency text,p_start date,p_radius integer,p_accuracy integer) returns void
language plpgsql security definer set search_path=public as $$
declare old visit_settings; today date := (now() at time zone 'America/Bogota')::date;
begin
 if not visit_admin(p_contract) then raise exception 'Sin permiso para programar visitas'; end if;
 perform pg_advisory_xact_lock(590059);
 select * into old from visit_settings where contrato_codigo=p_contract;
 perform visit_sync_cycles();
 if exists(select 1 from visit_cycles where contrato_codigo=p_contract) and (old.frequency<>p_frequency or old.starts_on<>p_start) then
   raise exception 'El calendario ya inició. Se conservan su frecuencia y fecha; puedes ajustar los criterios GPS de los próximos ciclos.';
 end if;
 if old.contrato_codigo is null or old.starts_on<>p_start then
   if p_start < (case when p_frequency='monthly' then date_trunc('month',today)::date else today end) then raise exception 'La programación no puede iniciar en un periodo anterior'; end if;
 end if;
 insert into visit_settings(contrato_codigo,frequency,starts_on,radius_m,accuracy_m) values(p_contract,p_frequency,p_start,p_radius,p_accuracy)
 on conflict(contrato_codigo) do update set frequency=excluded.frequency,starts_on=excluded.starts_on,radius_m=excluded.radius_m,accuracy_m=excluded.accuracy_m,updated_at=now(),updated_by=auth.uid();
 perform visit_sync_cycles();
end $$;

create or replace function public.visit_begin(p_id uuid,p_assignment uuid,p_lat double precision,p_lng double precision,p_accuracy double precision) returns uuid
language plpgsql security definer set search_path=public as $$
declare a visit_assignments; c visit_cycles; v site_visits; dist double precision; issue text := ''; today date := (now() at time zone 'America/Bogota')::date;
begin
 select * into a from visit_assignments where id=p_assignment;
 if not found or a.supervisor_id is distinct from auth.uid() or not visit_active_user() or not current_supervisor_can_read_zone(a.zone_code) then raise exception 'Sede fuera de tus asignaciones'; end if;
 select * into c from visit_cycles where id=a.cycle_id;
 if today not between c.starts_on and c.ends_on then raise exception 'El ciclo no está vigente'; end if;
 if p_lat is null or p_lng is null or p_accuracy is null or not (p_lat between -90 and 90 and p_lng between -180 and 180 and p_accuracy between 0 and 100000) or (p_lat=0 and p_lng=0) then raise exception 'GPS inválido'; end if;
 select * into v from site_visits where id=p_id;
 if found then
   if v.assignment_id<>p_assignment or v.created_by<>auth.uid() then raise exception 'Identificador ya utilizado'; end if;
   return p_id;
 end if;
 if a.latitude is null or a.longitude is null or not(a.latitude between -90 and 90 and a.longitude between -180 and 180) or (a.latitude=0 and a.longitude=0) then
   issue := 'Sede sin coordenadas válidas. ';
 else
   dist := 6371000*2*asin(sqrt(least(1.0,power(sin(radians(p_lat-a.latitude)/2),2)+cos(radians(a.latitude))*cos(radians(p_lat))*power(sin(radians(p_lng-a.longitude)/2),2))));
   if dist>c.radius_m then issue := issue || 'Fuera del radio de la sede. '; end if;
 end if;
 if p_accuracy>c.accuracy_m then issue := issue || 'Precisión GPS insuficiente. '; end if;
 insert into site_visits(id,assignment_id,latitude,longitude,accuracy_m,distance_m,gps_issue)
 values(p_id,p_assignment,p_lat,p_lng,p_accuracy,dist,trim(issue));
 return p_id;
end $$;

create or replace function public.visit_submit(p_id uuid,p_findings boolean,p_description text,p_recommendations text,p_observations text,p_photos text[]) returns text
language plpgsql security definer set search_path=public as $$
declare v site_visits; a visit_assignments; c visit_cycles; photo text;
begin
 select * into v from site_visits where id=p_id for update;
 if not found or v.created_by is distinct from auth.uid() or not visit_active_user() then raise exception 'Sin permiso'; end if;
 if v.status<>'draft' then return v.status; end if;
 select * into a from visit_assignments where id=v.assignment_id;
 select * into c from visit_cycles where id=a.cycle_id;
 if not current_supervisor_can_read_zone(a.zone_code) then raise exception 'Tu zona asignada cambió'; end if;
 if (now() at time zone 'America/Bogota')::date not between c.starts_on and c.ends_on then raise exception 'El ciclo ya cerró'; end if;
 if now()-v.started_at>interval '30 minutes' then raise exception 'La captura GPS venció. Inicia una nueva visita.'; end if;
 if p_findings is null or (p_findings and length(trim(coalesce(p_description,'')))=0) then raise exception 'Describe las novedades encontradas'; end if;
 if greatest(length(p_description),length(p_recommendations),length(p_observations))>5000 then raise exception 'Máximo 5000 caracteres por campo'; end if;
 if coalesce(cardinality(p_photos),0) not between 1 and 6 or cardinality(p_photos)<>(select count(distinct x) from unnest(p_photos) x) then raise exception 'Adjunta entre 1 y 6 fotos diferentes'; end if;
 foreach photo in array p_photos loop
   if photo not like auth.uid()::text || '/' || p_id::text || '/%' or not exists(select 1 from storage.objects where bucket_id='visit-evidence' and name=photo) then raise exception 'Evidencia no disponible'; end if;
 end loop;
 update site_visits set status=case when gps_issue='' then 'valid' else 'review' end,has_findings=p_findings,
 findings=case when p_findings then trim(p_description) else '' end,recommendations=trim(coalesce(p_recommendations,'')),observations=trim(coalesce(p_observations,'')),photos=p_photos,submitted_at=now() where id=p_id returning status into v.status;
 return v.status;
end $$;
create or replace function public.visit_review(p_id uuid,p_accept boolean,p_note text) returns void language plpgsql security definer set search_path=public as $$
declare v site_visits; a visit_assignments;
begin
 select * into v from site_visits where id=p_id for update;
 select * into a from visit_assignments where id=v.assignment_id;
 if not coalesce(visit_admin(a.contrato_codigo),false) then raise exception 'Sin permiso'; end if;
 if v.status<>'review' then raise exception 'La visita no está pendiente de revisión'; end if;
 if p_accept is null or length(trim(coalesce(p_note,''))) not between 1 and 5000 then raise exception 'Registra el motivo de la decisión'; end if;
 update site_visits set status=case when p_accept then 'valid' else 'rejected' end,reviewed_by=auth.uid(),reviewed_at=now(),review_note=trim(p_note) where id=p_id;
end $$;

alter table public.visit_settings enable row level security;
alter table public.visit_cycles enable row level security;
alter table public.visit_assignments enable row level security;
alter table public.site_visits enable row level security;
revoke all on public.visit_settings,public.visit_cycles,public.visit_assignments,public.site_visits from anon,authenticated;
grant select on public.visit_settings,public.visit_cycles,public.visit_assignments,public.site_visits to authenticated;
drop policy if exists visit_settings_read on public.visit_settings;
create policy visit_settings_read on public.visit_settings for select to authenticated using(visit_admin(contrato_codigo));
drop policy if exists visit_assignments_read on public.visit_assignments;
create policy visit_assignments_read on public.visit_assignments for select to authenticated using(visit_assignment_read(id));
drop policy if exists visit_cycles_read on public.visit_cycles;
create policy visit_cycles_read on public.visit_cycles for select to authenticated using(visit_admin(contrato_codigo) or exists(select 1 from visit_assignments a where a.cycle_id=visit_cycles.id and a.supervisor_id=auth.uid()));
drop policy if exists site_visits_read on public.site_visits;
create policy site_visits_read on public.site_visits for select to authenticated using(visit_assignment_read(assignment_id));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('visit-evidence','visit-evidence',false,8388608,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create or replace function public.visit_photo_write(p_name text) returns boolean language sql stable security definer set search_path=public as $$
 select visit_active_user() and exists(select 1 from site_visits v where v.created_by=auth.uid() and v.status='draft' and now()-v.started_at<interval '30 minutes'
 and split_part(p_name,'/',1)=auth.uid()::text and split_part(p_name,'/',2)=v.id::text)
$$;
drop policy if exists visit_photo_insert on storage.objects;
create policy visit_photo_insert on storage.objects for insert to authenticated with check(bucket_id='visit-evidence' and visit_photo_write(name));
-- No browser update/delete policy: uploaded evidence cannot race with final submission.
drop policy if exists visit_photo_read on storage.objects;
create policy visit_photo_read on storage.objects for select to authenticated using(bucket_id='visit-evidence' and exists(
 select 1 from public.site_visits v where v.id::text=split_part(name,'/',2) and name=any(v.photos) and public.visit_assignment_read(v.assignment_id)
));

-- No default PUBLIC execution on security-definer functions.
do $$ declare f record; begin
 for f in select oid::regprocedure sig from pg_proc where pronamespace='public'::regnamespace and proname like 'visit_%' loop
   execute format('revoke all on function %s from public,anon',f.sig);
   execute format('grant execute on function %s to authenticated',f.sig);
 end loop;
end $$;
-- Optional scheduler: sync on reads and scope changes remains available without pg_cron.
do $$ begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
   perform cron.schedule('site-visit-cycles','5 5 * * *','select public.visit_sync_cycles()');
 end if;
end $$;
commit;
