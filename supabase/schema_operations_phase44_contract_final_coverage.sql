-- Phase 44: final multi-contract coverage for shift operations and helper RPCs.
-- Apply after phase 43.

alter table public.shift_site_plan_assignments
  add column if not exists contrato_codigo text,
  add column if not exists contrato_nombre text,
  add column if not exists cliente_nombre_snapshot text,
  add column if not exists cliente_nit_snapshot text;

alter table public.scheduled_shifts
  add column if not exists contrato_codigo text,
  add column if not exists contrato_nombre text,
  add column if not exists cliente_nombre_snapshot text,
  add column if not exists cliente_nit_snapshot text;

alter table public.shift_assignments
  add column if not exists contrato_codigo text,
  add column if not exists contrato_nombre text,
  add column if not exists cliente_nombre_snapshot text,
  add column if not exists cliente_nit_snapshot text;

alter table public.shift_time_authorizations
  add column if not exists contrato_codigo text,
  add column if not exists contrato_nombre text,
  add column if not exists cliente_nombre_snapshot text,
  add column if not exists cliente_nit_snapshot text;

alter table public.shift_closures
  add column if not exists contrato_codigo text,
  add column if not exists contrato_nombre text,
  add column if not exists cliente_nombre_snapshot text,
  add column if not exists cliente_nit_snapshot text;

alter table public.shift_adjustments
  add column if not exists contrato_codigo text,
  add column if not exists contrato_nombre text,
  add column if not exists cliente_nombre_snapshot text,
  add column if not exists cliente_nit_snapshot text;

create or replace function public.resolve_shift_contract_context(
  p_scheduled_shift_id uuid default null,
  p_sede_codigo text default null,
  p_employee_id uuid default null,
  p_documento text default null
)
returns table (
  contrato_codigo text,
  contrato_nombre text,
  cliente_nombre_snapshot text,
  cliente_nit_snapshot text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(ss.contrato_codigo, s.contrato_codigo, e.contrato_codigo) as contrato_codigo,
    coalesce(ss.contrato_nombre, s.contrato_nombre, e.contrato_nombre) as contrato_nombre,
    coalesce(ss.cliente_nombre_snapshot, s.cliente_nombre_snapshot, e.cliente_nombre_snapshot) as cliente_nombre_snapshot,
    coalesce(ss.cliente_nit_snapshot, s.cliente_nit_snapshot, e.cliente_nit_snapshot) as cliente_nit_snapshot
  from (select 1) base
  left join lateral (
    select
      scheduled.contrato_codigo,
      scheduled.contrato_nombre,
      scheduled.cliente_nombre_snapshot,
      scheduled.cliente_nit_snapshot,
      scheduled.sede_codigo
    from public.scheduled_shifts scheduled
    where p_scheduled_shift_id is not null
      and scheduled.id = p_scheduled_shift_id
    limit 1
  ) ss on true
  left join lateral (
    select
      sede.contrato_codigo,
      sede.contrato_nombre,
      sede.cliente_nombre_snapshot,
      sede.cliente_nit_snapshot
    from public.sedes sede
    where sede.codigo = coalesce(nullif(trim(p_sede_codigo), ''), ss.sede_codigo)
    limit 1
  ) s on true
  left join lateral (
    select
      emp.contrato_codigo,
      emp.contrato_nombre,
      emp.cliente_nombre_snapshot,
      emp.cliente_nit_snapshot
    from public.employees emp
    where (p_employee_id is not null and emp.id = p_employee_id)
       or (nullif(trim(p_documento), '') is not null and emp.documento = nullif(trim(p_documento), ''))
    limit 1
  ) e on true;
$$;

create or replace function public.fill_shift_sede_contract_context()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
begin
  select * into v_ctx
  from public.resolve_shift_contract_context(null, new.sede_codigo, null, null);

  new.contrato_codigo = coalesce(v_ctx.contrato_codigo, new.contrato_codigo);
  new.contrato_nombre = coalesce(v_ctx.contrato_nombre, new.contrato_nombre);
  new.cliente_nombre_snapshot = coalesce(v_ctx.cliente_nombre_snapshot, new.cliente_nombre_snapshot);
  new.cliente_nit_snapshot = coalesce(v_ctx.cliente_nit_snapshot, new.cliente_nit_snapshot);
  return new;
end;
$$;

create or replace function public.fill_shift_detail_contract_context()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
begin
  select * into v_ctx
  from public.resolve_shift_contract_context(new.scheduled_shift_id, new.sede_codigo, new.employee_id, new.documento);

  new.contrato_codigo = coalesce(v_ctx.contrato_codigo, new.contrato_codigo);
  new.contrato_nombre = coalesce(v_ctx.contrato_nombre, new.contrato_nombre);
  new.cliente_nombre_snapshot = coalesce(v_ctx.cliente_nombre_snapshot, new.cliente_nombre_snapshot);
  new.cliente_nit_snapshot = coalesce(v_ctx.cliente_nit_snapshot, new.cliente_nit_snapshot);
  return new;
end;
$$;

create or replace function public.fill_shift_authorization_contract_context()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
begin
  select * into v_ctx
  from public.resolve_shift_contract_context(new.scheduled_shift_id, null, new.employee_id, new.documento);

  new.contrato_codigo = coalesce(v_ctx.contrato_codigo, new.contrato_codigo);
  new.contrato_nombre = coalesce(v_ctx.contrato_nombre, new.contrato_nombre);
  new.cliente_nombre_snapshot = coalesce(v_ctx.cliente_nombre_snapshot, new.cliente_nombre_snapshot);
  new.cliente_nit_snapshot = coalesce(v_ctx.cliente_nit_snapshot, new.cliente_nit_snapshot);
  return new;
end;
$$;

create or replace function public.fill_shift_closure_contract_context()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
begin
  select * into v_ctx
  from public.resolve_shift_contract_context(new.scheduled_shift_id, new.sede_codigo, null, null);

  new.contrato_codigo = coalesce(v_ctx.contrato_codigo, new.contrato_codigo);
  new.contrato_nombre = coalesce(v_ctx.contrato_nombre, new.contrato_nombre);
  new.cliente_nombre_snapshot = coalesce(v_ctx.cliente_nombre_snapshot, new.cliente_nombre_snapshot);
  new.cliente_nit_snapshot = coalesce(v_ctx.cliente_nit_snapshot, new.cliente_nit_snapshot);
  return new;
end;
$$;

drop trigger if exists trg_shift_site_plan_assignments_contract_context on public.shift_site_plan_assignments;
create trigger trg_shift_site_plan_assignments_contract_context
before insert or update of sede_codigo, contrato_codigo, contrato_nombre, cliente_nombre_snapshot, cliente_nit_snapshot
on public.shift_site_plan_assignments
for each row execute function public.fill_shift_sede_contract_context();

drop trigger if exists trg_scheduled_shifts_contract_context on public.scheduled_shifts;
create trigger trg_scheduled_shifts_contract_context
before insert or update of sede_codigo, contrato_codigo, contrato_nombre, cliente_nombre_snapshot, cliente_nit_snapshot
on public.scheduled_shifts
for each row execute function public.fill_shift_sede_contract_context();

drop trigger if exists trg_shift_assignments_contract_context on public.shift_assignments;
create trigger trg_shift_assignments_contract_context
before insert or update of scheduled_shift_id, employee_id, documento, sede_codigo, contrato_codigo, contrato_nombre, cliente_nombre_snapshot, cliente_nit_snapshot
on public.shift_assignments
for each row execute function public.fill_shift_detail_contract_context();

drop trigger if exists trg_employee_shift_status_contract_context on public.employee_shift_status;
create trigger trg_employee_shift_status_contract_context
before insert or update of scheduled_shift_id, employee_id, documento, sede_codigo, contrato_codigo, contrato_nombre, cliente_nombre_snapshot, cliente_nit_snapshot
on public.employee_shift_status
for each row execute function public.fill_shift_detail_contract_context();

drop trigger if exists trg_shift_time_authorizations_contract_context on public.shift_time_authorizations;
create trigger trg_shift_time_authorizations_contract_context
before insert or update of scheduled_shift_id, employee_id, documento, contrato_codigo, contrato_nombre, cliente_nombre_snapshot, cliente_nit_snapshot
on public.shift_time_authorizations
for each row execute function public.fill_shift_authorization_contract_context();

drop trigger if exists trg_shift_closures_contract_context on public.shift_closures;
create trigger trg_shift_closures_contract_context
before insert or update of scheduled_shift_id, sede_codigo, contrato_codigo, contrato_nombre, cliente_nombre_snapshot, cliente_nit_snapshot
on public.shift_closures
for each row execute function public.fill_shift_closure_contract_context();

drop trigger if exists trg_shift_adjustments_contract_context on public.shift_adjustments;
create trigger trg_shift_adjustments_contract_context
before insert or update of scheduled_shift_id, employee_id, documento, contrato_codigo, contrato_nombre, cliente_nombre_snapshot, cliente_nit_snapshot
on public.shift_adjustments
for each row execute function public.fill_shift_authorization_contract_context();

with resolved as (
  select row.id, ctx.*
  from public.shift_site_plan_assignments row
  cross join lateral public.resolve_shift_contract_context(null, row.sede_codigo, null, null) ctx
  where row.contrato_codigo is null
)
update public.shift_site_plan_assignments row
set
  contrato_codigo = coalesce(resolved.contrato_codigo, row.contrato_codigo),
  contrato_nombre = coalesce(resolved.contrato_nombre, row.contrato_nombre),
  cliente_nombre_snapshot = coalesce(resolved.cliente_nombre_snapshot, row.cliente_nombre_snapshot),
  cliente_nit_snapshot = coalesce(resolved.cliente_nit_snapshot, row.cliente_nit_snapshot)
from resolved
where row.id = resolved.id;

with resolved as (
  select row.id, ctx.*
  from public.scheduled_shifts row
  cross join lateral public.resolve_shift_contract_context(row.id, row.sede_codigo, null, null) ctx
  where row.contrato_codigo is null
)
update public.scheduled_shifts row
set
  contrato_codigo = coalesce(resolved.contrato_codigo, row.contrato_codigo),
  contrato_nombre = coalesce(resolved.contrato_nombre, row.contrato_nombre),
  cliente_nombre_snapshot = coalesce(resolved.cliente_nombre_snapshot, row.cliente_nombre_snapshot),
  cliente_nit_snapshot = coalesce(resolved.cliente_nit_snapshot, row.cliente_nit_snapshot)
from resolved
where row.id = resolved.id;

with resolved as (
  select row.id, ctx.*
  from public.shift_assignments row
  cross join lateral public.resolve_shift_contract_context(row.scheduled_shift_id, row.sede_codigo, row.employee_id, row.documento) ctx
  where row.contrato_codigo is null
)
update public.shift_assignments row
set
  contrato_codigo = coalesce(resolved.contrato_codigo, row.contrato_codigo),
  contrato_nombre = coalesce(resolved.contrato_nombre, row.contrato_nombre),
  cliente_nombre_snapshot = coalesce(resolved.cliente_nombre_snapshot, row.cliente_nombre_snapshot),
  cliente_nit_snapshot = coalesce(resolved.cliente_nit_snapshot, row.cliente_nit_snapshot)
from resolved
where row.id = resolved.id;

with resolved as (
  select row.id, ctx.*
  from public.employee_shift_status row
  cross join lateral public.resolve_shift_contract_context(row.scheduled_shift_id, row.sede_codigo, row.employee_id, row.documento) ctx
  where row.contrato_codigo is null
)
update public.employee_shift_status row
set
  contrato_codigo = coalesce(resolved.contrato_codigo, row.contrato_codigo),
  contrato_nombre = coalesce(resolved.contrato_nombre, row.contrato_nombre),
  cliente_nombre_snapshot = coalesce(resolved.cliente_nombre_snapshot, row.cliente_nombre_snapshot),
  cliente_nit_snapshot = coalesce(resolved.cliente_nit_snapshot, row.cliente_nit_snapshot)
from resolved
where row.id = resolved.id;

with resolved as (
  select row.id, ctx.*
  from public.shift_time_authorizations row
  cross join lateral public.resolve_shift_contract_context(row.scheduled_shift_id, null, row.employee_id, row.documento) ctx
  where row.contrato_codigo is null
)
update public.shift_time_authorizations row
set
  contrato_codigo = coalesce(resolved.contrato_codigo, row.contrato_codigo),
  contrato_nombre = coalesce(resolved.contrato_nombre, row.contrato_nombre),
  cliente_nombre_snapshot = coalesce(resolved.cliente_nombre_snapshot, row.cliente_nombre_snapshot),
  cliente_nit_snapshot = coalesce(resolved.cliente_nit_snapshot, row.cliente_nit_snapshot)
from resolved
where row.id = resolved.id;

with resolved as (
  select row.id, ctx.*
  from public.shift_closures row
  cross join lateral public.resolve_shift_contract_context(row.scheduled_shift_id, row.sede_codigo, null, null) ctx
  where row.contrato_codigo is null
)
update public.shift_closures row
set
  contrato_codigo = coalesce(resolved.contrato_codigo, row.contrato_codigo),
  contrato_nombre = coalesce(resolved.contrato_nombre, row.contrato_nombre),
  cliente_nombre_snapshot = coalesce(resolved.cliente_nombre_snapshot, row.cliente_nombre_snapshot),
  cliente_nit_snapshot = coalesce(resolved.cliente_nit_snapshot, row.cliente_nit_snapshot)
from resolved
where row.id = resolved.id;

with resolved as (
  select row.id, ctx.*
  from public.shift_adjustments row
  cross join lateral public.resolve_shift_contract_context(row.scheduled_shift_id, null, row.employee_id, row.documento) ctx
  where row.contrato_codigo is null
)
update public.shift_adjustments row
set
  contrato_codigo = coalesce(resolved.contrato_codigo, row.contrato_codigo),
  contrato_nombre = coalesce(resolved.contrato_nombre, row.contrato_nombre),
  cliente_nombre_snapshot = coalesce(resolved.cliente_nombre_snapshot, row.cliente_nombre_snapshot),
  cliente_nit_snapshot = coalesce(resolved.cliente_nit_snapshot, row.cliente_nit_snapshot)
from resolved
where row.id = resolved.id;

create index if not exists idx_shift_site_plan_assignments_contrato
  on public.shift_site_plan_assignments (contrato_codigo, sede_codigo);
create index if not exists idx_scheduled_shifts_fecha_contrato
  on public.scheduled_shifts (fecha_operativa, contrato_codigo);
create index if not exists idx_shift_assignments_contrato
  on public.shift_assignments (contrato_codigo, scheduled_shift_id);
create index if not exists idx_shift_time_authorizations_contrato
  on public.shift_time_authorizations (contrato_codigo, scheduled_shift_id);
create index if not exists idx_shift_closures_fecha_contrato
  on public.shift_closures (fecha_operativa, contrato_codigo);
create index if not exists idx_shift_adjustments_contrato
  on public.shift_adjustments (contrato_codigo, scheduled_shift_id);

create or replace function public.can_read_shift_contract_data(
  p_contrato_codigo text default null,
  p_scheduled_shift_id uuid default null,
  p_sede_codigo text default null,
  p_employee_id uuid default null,
  p_documento text default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_profile_is_internal_user()
    or (
      nullif(trim(p_contrato_codigo), '') is not null
      and public.can_read_contract_data(p_contrato_codigo)
    )
    or public.can_read_sede_data(p_sede_codigo)
    or public.can_read_employee_data(p_employee_id, p_documento)
    or exists (
      select 1
      from public.scheduled_shifts ss
      where p_scheduled_shift_id is not null
        and ss.id = p_scheduled_shift_id
        and (
          public.can_read_contract_data(ss.contrato_codigo)
          or public.can_read_sede_data(ss.sede_codigo)
        )
    );
$$;

drop policy if exists "shift_site_plan_assignments_read_authenticated" on public.shift_site_plan_assignments;
create policy "shift_site_plan_assignments_read_authenticated"
on public.shift_site_plan_assignments
for select
to authenticated
using (public.can_read_shift_contract_data(contrato_codigo, null, sede_codigo, null, null));

drop policy if exists "scheduled_shifts_read_authenticated" on public.scheduled_shifts;
create policy "scheduled_shifts_read_authenticated"
on public.scheduled_shifts
for select
to authenticated
using (public.can_read_shift_contract_data(contrato_codigo, null, sede_codigo, null, null));

drop policy if exists "shift_assignments_read_authenticated" on public.shift_assignments;
create policy "shift_assignments_read_authenticated"
on public.shift_assignments
for select
to authenticated
using (public.can_read_shift_contract_data(contrato_codigo, scheduled_shift_id, sede_codigo, employee_id, documento));

drop policy if exists "shift_time_authorizations_read_authenticated" on public.shift_time_authorizations;
create policy "shift_time_authorizations_read_authenticated"
on public.shift_time_authorizations
for select
to authenticated
using (public.can_read_shift_contract_data(contrato_codigo, scheduled_shift_id, null, employee_id, documento));

drop policy if exists "employee_shift_status_read_authenticated" on public.employee_shift_status;
create policy "employee_shift_status_read_authenticated"
on public.employee_shift_status
for select
to authenticated
using (public.can_read_shift_contract_data(contrato_codigo, scheduled_shift_id, sede_codigo, employee_id, documento));

drop policy if exists "shift_closures_read_authenticated" on public.shift_closures;
create policy "shift_closures_read_authenticated"
on public.shift_closures
for select
to authenticated
using (public.can_read_shift_contract_data(contrato_codigo, scheduled_shift_id, sede_codigo, null, null));

drop policy if exists "shift_adjustments_read_authenticated" on public.shift_adjustments;
create policy "shift_adjustments_read_authenticated"
on public.shift_adjustments
for select
to authenticated
using (public.can_read_shift_contract_data(contrato_codigo, scheduled_shift_id, null, employee_id, documento));

drop function if exists public.list_supernumerarios_for_current_supervisor();
drop function if exists public.list_supernumerarios_for_current_supervisor(text);

create or replace function public.list_supernumerarios_for_current_supervisor()
returns table (
  id uuid,
  codigo text,
  documento text,
  nombre text,
  telefono text,
  estado text,
  cargo_codigo text,
  cargo_nombre text,
  sede_codigo text,
  sede_nombre text,
  contrato_codigo text,
  contrato_nombre text,
  cliente_nombre_snapshot text,
  cliente_nit_snapshot text,
  fecha_ingreso date,
  fecha_retiro date
)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.id,
    e.codigo,
    e.documento,
    e.nombre,
    e.telefono,
    e.estado,
    e.cargo_codigo,
    e.cargo_nombre,
    e.sede_codigo,
    e.sede_nombre,
    e.contrato_codigo,
    e.contrato_nombre,
    e.cliente_nombre_snapshot,
    e.cliente_nit_snapshot,
    e.fecha_ingreso::date,
    e.fecha_retiro::date
  from public.employees e
  left join public.cargos c on c.codigo = e.cargo_codigo
  where coalesce(e.estado, 'activo') <> 'inactivo'
    and public.can_read_employee_data(e.id, e.documento)
    and (
      lower(coalesce(c.alineacion_crud, '')) = 'supernumerario'
      or lower(coalesce(c.nombre, '')) like '%supernumer%'
      or lower(coalesce(e.cargo_nombre, '')) like '%supernumer%'
    )
    and (
      public.current_profile_is_active_non_supervisor()
      or exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and p.estado = 'activo'
          and p.role::text = 'supervisor'
          and p.supervisor_eligible = true
      )
    )
  order by e.nombre asc;
$$;

create or replace function public.list_supernumerarios_for_current_supervisor(p_fecha text)
returns table (
  id uuid,
  codigo text,
  documento text,
  nombre text,
  telefono text,
  estado text,
  cargo_codigo text,
  cargo_nombre text,
  sede_codigo text,
  sede_nombre text,
  contrato_codigo text,
  contrato_nombre text,
  cliente_nombre_snapshot text,
  cliente_nit_snapshot text,
  fecha_ingreso date,
  fecha_retiro date
)
language sql
stable
security definer
set search_path = public
as $$
  with params as (
    select nullif(trim(p_fecha), '')::date as day
  )
  select
    e.id,
    e.codigo,
    e.documento,
    e.nombre,
    e.telefono,
    e.estado,
    coalesce(a.cargo_codigo, e.cargo_codigo) as cargo_codigo,
    coalesce(a.cargo_nombre, e.cargo_nombre) as cargo_nombre,
    coalesce(a.sede_codigo, e.sede_codigo) as sede_codigo,
    coalesce(a.sede_nombre, e.sede_nombre) as sede_nombre,
    coalesce(a.contrato_codigo, e.contrato_codigo) as contrato_codigo,
    coalesce(a.contrato_nombre, e.contrato_nombre) as contrato_nombre,
    coalesce(a.cliente_nombre_snapshot, e.cliente_nombre_snapshot) as cliente_nombre_snapshot,
    coalesce(a.cliente_nit_snapshot, e.cliente_nit_snapshot) as cliente_nit_snapshot,
    coalesce(a.fecha_ingreso::date, e.fecha_ingreso::date) as fecha_ingreso,
    coalesce(a.fecha_retiro::date, e.fecha_retiro::date) as fecha_retiro
  from params
  join public.employees e on params.day is not null
  left join lateral (
    select h.*
    from public.employee_cargo_history h
    where h.employee_id = e.id
      and h.fecha_ingreso::date <= params.day
      and (h.fecha_retiro is null or h.fecha_retiro::date >= params.day)
    order by h.fecha_ingreso desc nulls last, h.created_at desc nulls last, h.id desc
    limit 1
  ) a on true
  left join public.cargos c on c.codigo = coalesce(a.cargo_codigo, e.cargo_codigo)
  where (
      coalesce(e.estado, 'activo') <> 'inactivo'
      or (e.fecha_retiro is not null and e.fecha_retiro::date >= params.day)
    )
    and public.can_read_employee_data(e.id, e.documento)
    and coalesce(a.fecha_ingreso::date, e.fecha_ingreso::date) <= params.day
    and (
      lower(coalesce(c.alineacion_crud, '')) = 'supernumerario'
      or lower(coalesce(c.nombre, '')) like '%supernumer%'
      or lower(coalesce(a.cargo_nombre, e.cargo_nombre, '')) like '%supernumer%'
    )
    and (
      public.current_profile_is_active_non_supervisor()
      or exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and p.estado = 'activo'
          and p.role::text = 'supervisor'
          and p.supervisor_eligible = true
      )
    )
  order by e.nombre asc;
$$;

grant execute on function public.resolve_shift_contract_context(uuid, text, uuid, text) to authenticated;
grant execute on function public.can_read_shift_contract_data(text, uuid, text, uuid, text) to authenticated;
grant execute on function public.list_supernumerarios_for_current_supervisor() to authenticated;
grant execute on function public.list_supernumerarios_for_current_supervisor(text) to authenticated;
