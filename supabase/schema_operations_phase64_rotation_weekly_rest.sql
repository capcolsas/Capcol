-- Phase 64: weekly rest, deletion of unused rotations and future rest-change requests.
-- Apply after phase 63. Existing configurations and assignments are preserved.
begin;
create or replace function public.shift_rotation_rest_overlap(p_config jsonb, p_employee uuid, p_start timestamptz, p_end timestamptz)
returns boolean language sql stable set search_path=public as $$
  select exists(select 1 from generate_series(
    (p_start at time zone 'America/Bogota')::date::timestamp,
    ((p_end-interval '1 microsecond') at time zone 'America/Bogota')::date::timestamp,interval '1 day') d
    where extract(dow from d)::integer = (p_config->'rules'->'weeklyRestDays'->>p_employee::text)::integer)
$$;
revoke all on function public.shift_rotation_rest_overlap(jsonb,uuid,timestamptz,timestamptz) from public,anon;
grant execute on function public.shift_rotation_rest_overlap(jsonb,uuid,timestamptz,timestamptz) to authenticated,service_role;

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
  if v_rules ? 'weeklyRestDays' then
    if jsonb_typeof(v_rules->'weeklyRestDays') is distinct from 'object' then raise exception 'Descansos semanales invalidos'; end if;
    if exists(select 1 from jsonb_each(v_rules->'weeklyRestDays') d
      where jsonb_typeof(d.value) <> 'number' or d.value::text !~ '^[0-6]$'
        or not exists(select 1 from jsonb_array_elements(p_config->'members') m where m->>'employee'=d.key)) then
      raise exception 'Dia de descanso invalido o empleado fuera del equipo';
    end if;
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
    select c.eid,c.sid,c.starts_at,c.ends_at from candidates c
      where c.sid is not null and c.estado='programado' and c.starts_at>now()
      and not public.shift_rotation_rest_overlap(p_config,c.eid,c.starts_at,c.ends_at)
      and not exists(select 1 from public.shift_assignments a where a.employee_id=c.eid and a.scheduled_shift_id=c.sid
        and a.estado not in ('cancelado','reemplazado'))
    union
    select a.employee_id,s.id,s.starts_at,s.ends_at
    from public.shift_assignments a join public.scheduled_shifts s on s.id=a.scheduled_shift_id
    where a.estado not in ('cancelado','reemplazado') and s.estado<>'cancelado'
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
          and date_trunc('week',(c.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date) then
        (case when exists(select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=c.eid)
          then 'Revisar asignacion existente: ' else '' end)
        || 'Limite semanal: '
        || (select trim(to_char(w.hours,'FM999999990.##')) from weekly w
            where w.eid=c.eid and w.hours>v_weekly
              and w.week_start between date_trunc('week',c.starts_at at time zone 'America/Bogota')::date
                and date_trunc('week',(c.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date
            order by w.hours desc limit 1)
        || ' h programadas / ' || trim(to_char(v_weekly,'FM999999990.##')) || ' h permitidas'
      when v_consecutive>0 and exists(select 1 from streaks st where st.eid=c.eid and st.worked_days>v_consecutive
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



create or replace function public.shift_rotation_rules_version()
returns integer language sql stable as $$select 64$$;
revoke all on function public.shift_rotation_rules_version() from public,anon;
grant execute on function public.shift_rotation_rules_version() to authenticated,service_role;
-- Future WhatsApp/web rest-day requests.
-- These records do not modify shifts or weekly rules automatically.

create table if not exists public.shift_rest_change_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  rotation_id uuid not null references public.shift_rotations(id),
  contrato_codigo text not null references public.contracts(codigo),
  sede_codigo text not null references public.sedes(codigo),
  fecha_descanso_original date not null,
  fecha_descanso_solicitada date not null,
  motivo text not null check (length(trim(motivo)) between 1 and 2000),
  estado text not null default 'pendiente' check (estado in ('pendiente','aprobada','rechazada','cancelada')),
  origen text not null check (origen in ('whatsapp','web','administracion')),
  -- Provider message ID, not a telephone number; used to deduplicate webhooks.
  source_message_id text,
  requested_by_uid uuid references public.profiles(id) on delete set null,
  requested_at timestamptz not null default now(),
  rotation_config_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(rotation_config_snapshot)='object'),
  resolved_by_uid uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  resolution_reason text,
  -- Approval and application are separate. Future transactional application
  -- records the affected assignments here; approval alone never moves a shift.
  applied_at timestamptz,
  applied_changes jsonb not null default '{}'::jsonb check (jsonb_typeof(applied_changes)='object'),
  updated_at timestamptz not null default now(),
  check (fecha_descanso_original <> fecha_descanso_solicitada),
  check (source_message_id is null or length(trim(source_message_id)) > 0),
  check (origen <> 'whatsapp' or source_message_id is not null),
  check ((estado='pendiente' and resolved_at is null) or (estado<>'pendiente' and resolved_at is not null)),
  check (estado <> 'rechazada' or nullif(trim(resolution_reason),'') is not null),
  check (applied_at is null or (estado='aprobada' and applied_changes <> '{}'::jsonb)),
  check (applied_at is not null or applied_changes = '{}'::jsonb)
);

create unique index if not exists idx_rest_change_source_message
  on public.shift_rest_change_requests(origen,source_message_id) where source_message_id is not null;
-- One open request per original rest date, even across rotation versions.
create unique index if not exists idx_rest_change_pending_date
  on public.shift_rest_change_requests(employee_id,fecha_descanso_original)
  where estado='pendiente' or (estado='aprobada' and applied_at is null);
create index if not exists idx_rest_change_employee_dates
  on public.shift_rest_change_requests(employee_id,fecha_descanso_solicitada,requested_at desc);
create index if not exists idx_rest_change_contract_status
  on public.shift_rest_change_requests(contrato_codigo,estado,requested_at desc);
create index if not exists idx_rest_change_rotation on public.shift_rest_change_requests(rotation_id);

create or replace function public.validate_rest_change_request()
returns trigger language plpgsql set search_path=public as $$
declare r public.shift_rotations; e public.employees;
begin
  if tg_op='INSERT' then
    select * into r from public.shift_rotations where id=new.rotation_id;
    select * into e from public.employees where id=new.employee_id;
    if r.id is null or e.id is null or r.contrato_codigo is distinct from new.contrato_codigo
      or e.contrato_codigo is distinct from new.contrato_codigo
      or r.config->>'site' is distinct from new.sede_codigo or e.sede_codigo is distinct from new.sede_codigo
      or not exists(select 1 from jsonb_array_elements(r.config->'members') m where m->>'employee'=new.employee_id::text) then
      raise exception 'Empleado, sede y contrato no corresponden a la rotacion';
    end if;
    if new.estado<>'pendiente' or new.applied_at is not null or new.resolved_by_uid is not null then
      raise exception 'La solicitud debe crearse pendiente';
    end if;
    new.rotation_config_snapshot := r.config;
    new.requested_at := clock_timestamp();
  else
    if row(new.employee_id,new.rotation_id,new.contrato_codigo,new.sede_codigo,
        new.fecha_descanso_original,new.fecha_descanso_solicitada,new.motivo,new.origen,new.source_message_id,
        new.requested_at,new.requested_by_uid,new.rotation_config_snapshot)
      is distinct from row(old.employee_id,old.rotation_id,old.contrato_codigo,old.sede_codigo,
        old.fecha_descanso_original,old.fecha_descanso_solicitada,old.motivo,old.origen,old.source_message_id,
        old.requested_at,old.requested_by_uid,old.rotation_config_snapshot) then
      raise exception 'Los datos originales de la solicitud no se pueden modificar';
    end if;
    if old.estado<>'pendiente' and row(new.estado,new.resolved_by_uid,new.resolved_at,new.resolution_reason)
      is distinct from row(old.estado,old.resolved_by_uid,old.resolved_at,old.resolution_reason) then
      raise exception 'La solicitud ya fue resuelta';
    end if;
    if old.applied_at is not null and row(new.applied_at,new.applied_changes) is distinct from row(old.applied_at,old.applied_changes) then
      raise exception 'La aplicacion del cambio ya fue registrada';
    end if;
    if new.estado is distinct from old.estado then
      if new.estado in ('aprobada','rechazada') and new.resolved_by_uid is null then
        raise exception 'Falta el responsable de la decision';
      end if;
      new.resolved_at := clock_timestamp();
    end if;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end $$;
drop trigger if exists trg_validate_rest_change_request on public.shift_rest_change_requests;
create trigger trg_validate_rest_change_request before insert or update on public.shift_rest_change_requests
  for each row execute function public.validate_rest_change_request();

alter table public.shift_rest_change_requests enable row level security;
revoke all on public.shift_rest_change_requests from public,anon,authenticated;
grant select on public.shift_rest_change_requests to authenticated;
-- Employee identity/phone ownership must be verified by the future backend.
-- Browser clients cannot create, approve, apply or delete requests directly.
grant select,insert,update on public.shift_rest_change_requests to service_role;
drop policy if exists rest_change_requests_read on public.shift_rest_change_requests;
create policy rest_change_requests_read on public.shift_rest_change_requests for select to authenticated
  using (public.is_admin_like() and public.can_read_contract_data(contrato_codigo));

create or replace function public.delete_shift_rotation(p_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare r public.shift_rotations;
begin
  select * into r from public.shift_rotations where id=p_id for update;
  if r.id is null then raise exception 'Rotacion no encontrada'; end if;
  if coalesce(auth.role(),'')<>'service_role' and not coalesce(public.is_admin_like() and public.can_read_contract_data(r.contrato_codigo),false) then raise exception 'Sin permiso'; end if;
  if r.estado='activo' then raise exception 'Pausa la rotacion antes de eliminarla'; end if;
  if exists(select 1 from public.shift_assignments where rotation_id=p_id)
    or exists(select 1 from public.shift_rest_change_requests where rotation_id=p_id) then
    raise exception 'La rotacion tiene asignaciones o solicitudes. Conservala pausada para mantener el historial';
  end if;
  delete from public.shift_rotations where id=p_id;
end $$;
revoke all on function public.delete_shift_rotation(uuid) from public,anon;
grant execute on function public.delete_shift_rotation(uuid) to authenticated,service_role;
commit;

