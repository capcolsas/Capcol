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
