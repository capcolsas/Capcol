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
