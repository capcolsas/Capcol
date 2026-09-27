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
