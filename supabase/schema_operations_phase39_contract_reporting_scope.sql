-- Phase 39: contract scope for operational snapshots and historical reporting.
-- Daily closures keep their current global behavior; contract-level statistics are
-- materialized in daily_contract_metrics.

alter table public.employee_daily_status
  add column if not exists contrato_codigo text,
  add column if not exists contrato_nombre text,
  add column if not exists cliente_nombre_snapshot text,
  add column if not exists cliente_nit_snapshot text;

alter table public.daily_sede_closures
  add column if not exists contrato_codigo text,
  add column if not exists contrato_nombre text,
  add column if not exists cliente_nombre_snapshot text,
  add column if not exists cliente_nit_snapshot text;

alter table public.sede_status
  add column if not exists contrato_codigo text,
  add column if not exists contrato_nombre text,
  add column if not exists cliente_nombre_snapshot text,
  add column if not exists cliente_nit_snapshot text;

alter table public.attendance
  add column if not exists contrato_codigo text,
  add column if not exists contrato_nombre text,
  add column if not exists cliente_nombre_snapshot text,
  add column if not exists cliente_nit_snapshot text;

alter table public.absenteeism
  add column if not exists contrato_codigo text,
  add column if not exists contrato_nombre text,
  add column if not exists cliente_nombre_snapshot text,
  add column if not exists cliente_nit_snapshot text;

alter table public.import_replacements
  add column if not exists contrato_codigo text,
  add column if not exists contrato_nombre text,
  add column if not exists cliente_nombre_snapshot text,
  add column if not exists cliente_nit_snapshot text;

create or replace function public.resolve_contract_context(
  p_sede_codigo text default null,
  p_employee_id uuid default null,
  p_employee_id_text text default null,
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
    coalesce(s.contrato_codigo, e.contrato_codigo) as contrato_codigo,
    coalesce(s.contrato_nombre, e.contrato_nombre) as contrato_nombre,
    coalesce(s.cliente_nombre_snapshot, e.cliente_nombre_snapshot) as cliente_nombre_snapshot,
    coalesce(s.cliente_nit_snapshot, e.cliente_nit_snapshot) as cliente_nit_snapshot
  from (select 1) base
  left join lateral (
    select
      sede.contrato_codigo,
      sede.contrato_nombre,
      sede.cliente_nombre_snapshot,
      sede.cliente_nit_snapshot
    from public.sedes sede
    where sede.codigo = nullif(trim(p_sede_codigo), '')
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
       or (nullif(trim(p_employee_id_text), '') is not null and emp.id::text = nullif(trim(p_employee_id_text), ''))
       or (nullif(trim(p_documento), '') is not null and emp.documento = nullif(trim(p_documento), ''))
    order by
      case
        when p_employee_id is not null and emp.id = p_employee_id then 0
        when nullif(trim(p_employee_id_text), '') is not null and emp.id::text = nullif(trim(p_employee_id_text), '') then 1
        else 2
      end
    limit 1
  ) e on true;
$$;

create or replace function public.fill_employee_daily_status_contract_context()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
begin
  select *
  into v_ctx
  from public.resolve_contract_context(new.sede_codigo, null, new.employee_id, new.documento);

  new.contrato_codigo = coalesce(v_ctx.contrato_codigo, new.contrato_codigo);
  new.contrato_nombre = coalesce(v_ctx.contrato_nombre, new.contrato_nombre);
  new.cliente_nombre_snapshot = coalesce(v_ctx.cliente_nombre_snapshot, new.cliente_nombre_snapshot);
  new.cliente_nit_snapshot = coalesce(v_ctx.cliente_nit_snapshot, new.cliente_nit_snapshot);

  return new;
end;
$$;

create or replace function public.fill_daily_sede_contract_context()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
begin
  select *
  into v_ctx
  from public.resolve_contract_context(new.sede_codigo, null, null, null);

  new.contrato_codigo = coalesce(v_ctx.contrato_codigo, new.contrato_codigo);
  new.contrato_nombre = coalesce(v_ctx.contrato_nombre, new.contrato_nombre);
  new.cliente_nombre_snapshot = coalesce(v_ctx.cliente_nombre_snapshot, new.cliente_nombre_snapshot);
  new.cliente_nit_snapshot = coalesce(v_ctx.cliente_nit_snapshot, new.cliente_nit_snapshot);

  return new;
end;
$$;

create or replace function public.fill_attendance_contract_context()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
begin
  select *
  into v_ctx
  from public.resolve_contract_context(new.sede_codigo, new.empleado_id, null, new.documento);

  new.contrato_codigo = coalesce(v_ctx.contrato_codigo, new.contrato_codigo);
  new.contrato_nombre = coalesce(v_ctx.contrato_nombre, new.contrato_nombre);
  new.cliente_nombre_snapshot = coalesce(v_ctx.cliente_nombre_snapshot, new.cliente_nombre_snapshot);
  new.cliente_nit_snapshot = coalesce(v_ctx.cliente_nit_snapshot, new.cliente_nit_snapshot);

  return new;
end;
$$;

create or replace function public.fill_absenteeism_contract_context()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
begin
  select *
  into v_ctx
  from public.resolve_contract_context(new.sede_codigo, new.empleado_id, null, new.documento);

  new.contrato_codigo = coalesce(v_ctx.contrato_codigo, new.contrato_codigo);
  new.contrato_nombre = coalesce(v_ctx.contrato_nombre, new.contrato_nombre);
  new.cliente_nombre_snapshot = coalesce(v_ctx.cliente_nombre_snapshot, new.cliente_nombre_snapshot);
  new.cliente_nit_snapshot = coalesce(v_ctx.cliente_nit_snapshot, new.cliente_nit_snapshot);

  return new;
end;
$$;

create or replace function public.fill_import_replacement_contract_context()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
begin
  select *
  into v_ctx
  from public.resolve_contract_context(new.sede_codigo, new.empleado_id, null, new.documento);

  new.contrato_codigo = coalesce(v_ctx.contrato_codigo, new.contrato_codigo);
  new.contrato_nombre = coalesce(v_ctx.contrato_nombre, new.contrato_nombre);
  new.cliente_nombre_snapshot = coalesce(v_ctx.cliente_nombre_snapshot, new.cliente_nombre_snapshot);
  new.cliente_nit_snapshot = coalesce(v_ctx.cliente_nit_snapshot, new.cliente_nit_snapshot);

  return new;
end;
$$;

drop trigger if exists trg_employee_daily_status_contract_context on public.employee_daily_status;
create trigger trg_employee_daily_status_contract_context
before insert or update of employee_id, documento, sede_codigo, contrato_codigo, contrato_nombre, cliente_nombre_snapshot, cliente_nit_snapshot
on public.employee_daily_status
for each row execute function public.fill_employee_daily_status_contract_context();

drop trigger if exists trg_daily_sede_closure_contract_context on public.daily_sede_closures;
create trigger trg_daily_sede_closure_contract_context
before insert or update of sede_codigo, contrato_codigo, contrato_nombre, cliente_nombre_snapshot, cliente_nit_snapshot
on public.daily_sede_closures
for each row execute function public.fill_daily_sede_contract_context();

drop trigger if exists trg_sede_status_contract_context on public.sede_status;
create trigger trg_sede_status_contract_context
before insert or update of sede_codigo, contrato_codigo, contrato_nombre, cliente_nombre_snapshot, cliente_nit_snapshot
on public.sede_status
for each row execute function public.fill_daily_sede_contract_context();

drop trigger if exists trg_attendance_contract_context on public.attendance;
create trigger trg_attendance_contract_context
before insert or update of empleado_id, documento, sede_codigo, contrato_codigo, contrato_nombre, cliente_nombre_snapshot, cliente_nit_snapshot
on public.attendance
for each row execute function public.fill_attendance_contract_context();

drop trigger if exists trg_absenteeism_contract_context on public.absenteeism;
create trigger trg_absenteeism_contract_context
before insert or update of empleado_id, documento, sede_codigo, contrato_codigo, contrato_nombre, cliente_nombre_snapshot, cliente_nit_snapshot
on public.absenteeism
for each row execute function public.fill_absenteeism_contract_context();

drop trigger if exists trg_import_replacements_contract_context on public.import_replacements;
create trigger trg_import_replacements_contract_context
before insert or update of empleado_id, documento, sede_codigo, contrato_codigo, contrato_nombre, cliente_nombre_snapshot, cliente_nit_snapshot
on public.import_replacements
for each row execute function public.fill_import_replacement_contract_context();

with resolved as (
  select
    eds.id,
    ctx.contrato_codigo,
    ctx.contrato_nombre,
    ctx.cliente_nombre_snapshot,
    ctx.cliente_nit_snapshot
  from public.employee_daily_status eds
  cross join lateral public.resolve_contract_context(eds.sede_codigo, null, eds.employee_id, eds.documento) ctx
  where eds.contrato_codigo is null
)
update public.employee_daily_status eds
set
  contrato_codigo = coalesce(resolved.contrato_codigo, eds.contrato_codigo),
  contrato_nombre = coalesce(resolved.contrato_nombre, eds.contrato_nombre),
  cliente_nombre_snapshot = coalesce(resolved.cliente_nombre_snapshot, eds.cliente_nombre_snapshot),
  cliente_nit_snapshot = coalesce(resolved.cliente_nit_snapshot, eds.cliente_nit_snapshot)
from resolved
where eds.id = resolved.id;

with resolved as (
  select
    dsc.id,
    ctx.contrato_codigo,
    ctx.contrato_nombre,
    ctx.cliente_nombre_snapshot,
    ctx.cliente_nit_snapshot
  from public.daily_sede_closures dsc
  cross join lateral public.resolve_contract_context(dsc.sede_codigo, null, null, null) ctx
  where dsc.contrato_codigo is null
)
update public.daily_sede_closures dsc
set
  contrato_codigo = coalesce(resolved.contrato_codigo, dsc.contrato_codigo),
  contrato_nombre = coalesce(resolved.contrato_nombre, dsc.contrato_nombre),
  cliente_nombre_snapshot = coalesce(resolved.cliente_nombre_snapshot, dsc.cliente_nombre_snapshot),
  cliente_nit_snapshot = coalesce(resolved.cliente_nit_snapshot, dsc.cliente_nit_snapshot)
from resolved
where dsc.id = resolved.id;

with resolved as (
  select
    ss.id,
    ctx.contrato_codigo,
    ctx.contrato_nombre,
    ctx.cliente_nombre_snapshot,
    ctx.cliente_nit_snapshot
  from public.sede_status ss
  cross join lateral public.resolve_contract_context(ss.sede_codigo, null, null, null) ctx
  where ss.contrato_codigo is null
)
update public.sede_status ss
set
  contrato_codigo = coalesce(resolved.contrato_codigo, ss.contrato_codigo),
  contrato_nombre = coalesce(resolved.contrato_nombre, ss.contrato_nombre),
  cliente_nombre_snapshot = coalesce(resolved.cliente_nombre_snapshot, ss.cliente_nombre_snapshot),
  cliente_nit_snapshot = coalesce(resolved.cliente_nit_snapshot, ss.cliente_nit_snapshot)
from resolved
where ss.id = resolved.id;

with resolved as (
  select
    a.id,
    ctx.contrato_codigo,
    ctx.contrato_nombre,
    ctx.cliente_nombre_snapshot,
    ctx.cliente_nit_snapshot
  from public.attendance a
  cross join lateral public.resolve_contract_context(a.sede_codigo, a.empleado_id, null, a.documento) ctx
  where a.contrato_codigo is null
)
update public.attendance a
set
  contrato_codigo = coalesce(resolved.contrato_codigo, a.contrato_codigo),
  contrato_nombre = coalesce(resolved.contrato_nombre, a.contrato_nombre),
  cliente_nombre_snapshot = coalesce(resolved.cliente_nombre_snapshot, a.cliente_nombre_snapshot),
  cliente_nit_snapshot = coalesce(resolved.cliente_nit_snapshot, a.cliente_nit_snapshot)
from resolved
where a.id = resolved.id;

with resolved as (
  select
    ab.id,
    ctx.contrato_codigo,
    ctx.contrato_nombre,
    ctx.cliente_nombre_snapshot,
    ctx.cliente_nit_snapshot
  from public.absenteeism ab
  cross join lateral public.resolve_contract_context(ab.sede_codigo, ab.empleado_id, null, ab.documento) ctx
  where ab.contrato_codigo is null
)
update public.absenteeism ab
set
  contrato_codigo = coalesce(resolved.contrato_codigo, ab.contrato_codigo),
  contrato_nombre = coalesce(resolved.contrato_nombre, ab.contrato_nombre),
  cliente_nombre_snapshot = coalesce(resolved.cliente_nombre_snapshot, ab.cliente_nombre_snapshot),
  cliente_nit_snapshot = coalesce(resolved.cliente_nit_snapshot, ab.cliente_nit_snapshot)
from resolved
where ab.id = resolved.id;

with resolved as (
  select
    ir.id,
    ctx.contrato_codigo,
    ctx.contrato_nombre,
    ctx.cliente_nombre_snapshot,
    ctx.cliente_nit_snapshot
  from public.import_replacements ir
  cross join lateral public.resolve_contract_context(ir.sede_codigo, ir.empleado_id, null, ir.documento) ctx
  where ir.contrato_codigo is null
)
update public.import_replacements ir
set
  contrato_codigo = coalesce(resolved.contrato_codigo, ir.contrato_codigo),
  contrato_nombre = coalesce(resolved.contrato_nombre, ir.contrato_nombre),
  cliente_nombre_snapshot = coalesce(resolved.cliente_nombre_snapshot, ir.cliente_nombre_snapshot),
  cliente_nit_snapshot = coalesce(resolved.cliente_nit_snapshot, ir.cliente_nit_snapshot)
from resolved
where ir.id = resolved.id;

create index if not exists idx_employee_daily_status_fecha_contrato on public.employee_daily_status (fecha, contrato_codigo);
create index if not exists idx_daily_sede_closures_fecha_contrato on public.daily_sede_closures (fecha, contrato_codigo);
create index if not exists idx_sede_status_fecha_contrato on public.sede_status (fecha, contrato_codigo);
create index if not exists idx_attendance_fecha_contrato on public.attendance (fecha, contrato_codigo);
create index if not exists idx_absenteeism_fecha_contrato on public.absenteeism (fecha, contrato_codigo);
create index if not exists idx_import_replacements_fecha_contrato on public.import_replacements (fecha, contrato_codigo);

do $$
begin
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'daily_contract_metrics'
      and c.relkind = 'v'
  ) then
    drop view public.daily_contract_metrics;
  end if;
end $$;

create table if not exists public.daily_contract_metrics (
  fecha text not null,
  contrato_codigo text not null,
  contrato_nombre text,
  cliente_nombre_snapshot text,
  cliente_nit_snapshot text,
  planeados integer not null default 0,
  contratados integer not null default 0,
  asistencias integer not null default 0,
  ausentismos integer not null default 0,
  pagados integer not null default 0,
  no_contratados integer not null default 0,
  faltan integer not null default 0,
  sobran integer not null default 0,
  closed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (fecha, contrato_codigo)
);

alter table public.daily_contract_metrics enable row level security;

drop trigger if exists trg_daily_contract_metrics_updated_at on public.daily_contract_metrics;
create trigger trg_daily_contract_metrics_updated_at
before update on public.daily_contract_metrics
for each row execute function public.set_updated_at();

drop policy if exists "daily_contract_metrics_read_authenticated" on public.daily_contract_metrics;
create policy "daily_contract_metrics_read_authenticated"
on public.daily_contract_metrics
for select
to authenticated
using (true);

drop policy if exists "daily_contract_metrics_write_admin" on public.daily_contract_metrics;
create policy "daily_contract_metrics_write_admin"
on public.daily_contract_metrics
for all
to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

create or replace function public.recompute_daily_contract_metrics_from_employee_daily_status(p_fecha text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer := 0;
begin
  if p_fecha is null or p_fecha !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Fecha invalida para daily_contract_metrics: %', p_fecha;
  end if;

  delete from public.daily_contract_metrics where fecha = p_fecha;

  with active_sedes as (
    select *
    from public.sedes s
    where lower(trim(coalesce(s.estado, 'activo'))) <> 'inactivo'
      and public.is_sede_scheduled_for_date_sql(s.jornada, p_fecha)
  ),
  contract_scope as (
    select
      s.contrato_codigo,
      max(s.contrato_nombre) as contrato_nombre,
      max(s.cliente_nombre_snapshot) as cliente_nombre_snapshot,
      max(s.cliente_nit_snapshot) as cliente_nit_snapshot
    from active_sedes s
    where nullif(trim(s.contrato_codigo), '') is not null
    group by s.contrato_codigo
    union
    select
      eds.contrato_codigo,
      max(eds.contrato_nombre) as contrato_nombre,
      max(eds.cliente_nombre_snapshot) as cliente_nombre_snapshot,
      max(eds.cliente_nit_snapshot) as cliente_nit_snapshot
    from public.employee_daily_status eds
    where eds.fecha = p_fecha
      and nullif(trim(eds.contrato_codigo), '') is not null
    group by eds.contrato_codigo
  ),
  planned_by_contract as (
    select
      s.contrato_codigo,
      sum(greatest(coalesce(s.numero_operarios, 0), 0))::integer as planeados
    from active_sedes s
    where nullif(trim(s.contrato_codigo), '') is not null
    group by s.contrato_codigo
  ),
  status_by_contract as (
    select
      eds.contrato_codigo,
      count(*) filter (
        where eds.tipo_personal = 'empleado'
          and eds.servicio_programado = true
      )::integer as contratados,
      count(*) filter (
        where eds.asistio = true
      )::integer as asistencias,
      count(*) filter (
        where eds.tipo_personal = 'empleado'
          and eds.servicio_programado = true
          and coalesce(eds.cuenta_pago_servicio, false) = true
      )::integer as pagados,
      count(*) filter (
        where eds.tipo_personal = 'empleado'
          and eds.servicio_programado = true
          and (
            coalesce(eds.cuenta_pago_servicio, false) = false
            or coalesce(eds.decision_cobertura, '') = 'ausentismo'
            or eds.estado_dia = 'ausente_sin_reemplazo'
          )
      )::integer as ausentismos_directos
    from public.employee_daily_status eds
    where eds.fecha = p_fecha
      and nullif(trim(eds.contrato_codigo), '') is not null
    group by eds.contrato_codigo
  ),
  closure_flag as (
    select exists (
      select 1
      from public.daily_closures dc
      where dc.fecha = p_fecha
        and (dc.locked = true or lower(trim(coalesce(dc.status, ''))) = 'closed')
    ) as is_closed
  ),
  metrics as (
    select
      p_fecha as fecha,
      cs.contrato_codigo,
      max(cs.contrato_nombre) as contrato_nombre,
      max(cs.cliente_nombre_snapshot) as cliente_nombre_snapshot,
      max(cs.cliente_nit_snapshot) as cliente_nit_snapshot,
      coalesce(max(pbc.planeados), 0)::integer as planeados,
      coalesce(max(sbc.contratados), 0)::integer as contratados,
      coalesce(max(sbc.asistencias), 0)::integer as asistencias,
      coalesce(max(sbc.pagados), 0)::integer as pagados,
      coalesce(max(sbc.ausentismos_directos), 0)::integer as ausentismos_directos,
      (select is_closed from closure_flag) as closed
    from contract_scope cs
    left join planned_by_contract pbc on pbc.contrato_codigo = cs.contrato_codigo
    left join status_by_contract sbc on sbc.contrato_codigo = cs.contrato_codigo
    group by cs.contrato_codigo
  )
  insert into public.daily_contract_metrics (
    fecha,
    contrato_codigo,
    contrato_nombre,
    cliente_nombre_snapshot,
    cliente_nit_snapshot,
    planeados,
    contratados,
    asistencias,
    ausentismos,
    pagados,
    no_contratados,
    faltan,
    sobran,
    closed
  )
  select
    fecha,
    contrato_codigo,
    contrato_nombre,
    cliente_nombre_snapshot,
    cliente_nit_snapshot,
    planeados,
    contratados,
    asistencias,
    case
      when planeados <= 0 and contratados <= 0 then 0
      else greatest(least(planeados, contratados) - pagados, ausentismos_directos, 0)
    end as ausentismos,
    pagados,
    greatest(planeados - contratados, 0) as no_contratados,
    greatest(planeados - contratados, 0) as faltan,
    greatest(pagados - planeados, 0) as sobran,
    closed
  from metrics
  where nullif(trim(contrato_codigo), '') is not null;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

create or replace function public.recompute_sede_status_from_employee_daily_status(p_fecha text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer := 0;
begin
  if p_fecha is null or p_fecha !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Fecha invalida para sede_status: %', p_fecha;
  end if;

  if exists (
    select 1
    from public.daily_closures dc
    where dc.fecha = p_fecha
      and (dc.locked = true or lower(trim(coalesce(dc.status, ''))) = 'closed')
  ) then
    select count(*)::integer
    into v_rows
    from public.sede_status
    where fecha = p_fecha;
    return v_rows;
  end if;

  delete from public.sede_status where fecha = p_fecha;

  with active_sedes as (
    select s.*
    from public.sedes s
    where lower(trim(coalesce(s.estado, 'activo'))) <> 'inactivo'
      and public.is_sede_scheduled_for_date_sql(s.jornada, p_fecha)
  ),
  contracted_by_sede as (
    select
      eds.sede_codigo,
      count(*)::integer as contratados,
      count(*) filter (where eds.cuenta_pago_servicio = true)::integer as cubiertos
    from public.employee_daily_status eds
    where eds.fecha = p_fecha
      and eds.tipo_personal = 'empleado'
      and eds.servicio_programado = true
    group by eds.sede_codigo
  )
  insert into public.sede_status (
    id,
    fecha,
    sede_codigo,
    sede_nombre,
    contrato_codigo,
    contrato_nombre,
    cliente_nombre_snapshot,
    cliente_nit_snapshot,
    operarios_esperados,
    operarios_presentes,
    faltantes
  )
  select
    concat(p_fecha, '_', s.codigo) as id,
    p_fecha,
    s.codigo,
    s.nombre,
    s.contrato_codigo,
    s.contrato_nombre,
    s.cliente_nombre_snapshot,
    s.cliente_nit_snapshot,
    coalesce(c.contratados, 0),
    coalesce(c.cubiertos, 0),
    greatest(coalesce(c.contratados, 0) - coalesce(c.cubiertos, 0), 0)
  from active_sedes s
  left join contracted_by_sede c on c.sede_codigo = s.codigo;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

create or replace function public.refresh_operational_snapshots_from_employee_daily_status(p_fecha text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sedes integer := 0;
  v_contracts integer := 0;
  v_metrics public.daily_metrics;
begin
  v_sedes := public.recompute_sede_status_from_employee_daily_status(p_fecha);
  v_metrics := public.recompute_daily_metrics_from_employee_daily_status(p_fecha);
  v_contracts := public.recompute_daily_contract_metrics_from_employee_daily_status(p_fecha);

  return jsonb_build_object(
    'fecha', p_fecha,
    'sede_status_rows', v_sedes,
    'daily_contract_metrics_rows', v_contracts,
    'daily_metrics_id', v_metrics.id,
    'attendance_count', v_metrics.attendance_count,
    'expected', v_metrics.expected,
    'planned', v_metrics.planned
  );
end;
$$;

grant execute on function public.resolve_contract_context(text, uuid, text, text) to authenticated;
grant execute on function public.recompute_daily_contract_metrics_from_employee_daily_status(text) to authenticated;
