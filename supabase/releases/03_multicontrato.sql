-- ============================================================
-- Rocky | 03 Multi-contrato
-- Generado por supabase/build_release_bundles.mjs. NO editar a mano.
--
-- Idempotente: sirve para un proyecto nuevo y para actualizar uno existente.
-- Ejecutar en orden 01 -> 05 en el editor SQL de Supabase (o con psql).
-- Fuentes incluidas (12):
--   schema_operations_phase38_contracts.sql
--   schema_operations_phase39_contract_reporting_scope.sql
--   schema_operations_phase40_contract_access_rls.sql
--   schema_operations_phase41_contract_operational_calculations.sql
--   schema_operations_phase42_contract_profile_permissions.sql
--   schema_operations_phase43_backend_contract_context.sql
--   schema_operations_phase44_contract_final_coverage.sql
--   schema_operations_phase45_supernumerario_contract_access.sql
--   schema_operations_phase46_shift_assignment_performance.sql
--   schema_operations_phase47_shift_window_defaults.sql
--   schema_operations_phase48_contract_config.sql
--   schema_operations_phase49_contract_reference_images.sql
-- ============================================================

-- >>>>>>>>>> schema_operations_phase38_contracts.sql
-- Phase 38: contracts as the operational and reporting boundary.
-- Each project represents one operating company; contracts carry client data.

create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  nombre text not null,
  numero_contrato text,
  cliente_nombre text,
  cliente_nit text,
  cliente_contacto text,
  cliente_email text,
  cliente_telefono text,
  fecha_inicio date,
  fecha_fin date,
  estado text not null default 'activo',
  created_by_uid uuid references public.profiles(id) on delete set null,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.contracts enable row level security;

drop trigger if exists trg_contracts_updated_at on public.contracts;
drop trigger if exists trg_contracts_updated_at on public.contracts;
create trigger trg_contracts_updated_at
before update on public.contracts
for each row execute function public.set_updated_at();

drop policy if exists "contracts_read_authenticated" on public.contracts;
drop policy if exists "contracts_read_authenticated" on public.contracts;
create policy "contracts_read_authenticated"
on public.contracts
for select
to authenticated
using (true);

drop policy if exists "contracts_write_admin" on public.contracts;
drop policy if exists "contracts_write_admin" on public.contracts;
create policy "contracts_write_admin"
on public.contracts
for all
to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

do $$
begin
  if to_regclass('public.profile_contract_access') is not null then
    alter table public.profile_contract_access
      drop constraint if exists profile_contract_access_contrato_codigo_fkey;
    alter table public.profile_contract_access
      add constraint profile_contract_access_contrato_codigo_fkey
      foreign key (contrato_codigo)
      references public.contracts(codigo)
      on update cascade
      on delete restrict;
  end if;

  if to_regclass('public.supernumerario_contract_access') is not null then
    alter table public.supernumerario_contract_access
      drop constraint if exists supernumerario_contract_access_contrato_codigo_fkey;
    alter table public.supernumerario_contract_access
      add constraint supernumerario_contract_access_contrato_codigo_fkey
      foreign key (contrato_codigo)
      references public.contracts(codigo)
      on update cascade
      on delete restrict;
  end if;
end;
$$;

update public.contracts
set
  codigo = 'CON-0001',
  numero_contrato = case
    when numero_contrato = 'CONTRATO-INICIAL' then 'CON-0001'
    else numero_contrato
  end
where codigo = 'CONTRATO-INICIAL'
  and not exists (
    select 1
    from public.contracts existing
    where existing.codigo = 'CON-0001'
  );

do $once$
begin
  if public.rocky_run_once('contracts_initial_seed', 'public.contracts') then
    insert into public.contracts (
      codigo,
      nombre,
      numero_contrato,
      cliente_nombre,
      cliente_nit,
      estado
    )
    values (
      'CON-0001',
      'Contrato inicial',
      'CON-0001',
      'Cliente inicial',
      null,
      'activo'
    )
    on conflict (codigo) do nothing;
  end if;
end
$once$;

do $$
begin
  if to_regclass('public.profile_contract_access') is not null then
    update public.profile_contract_access
    set contrato_codigo = 'CON-0001'
    where contrato_codigo = 'CONTRATO-INICIAL';
  end if;

  if to_regclass('public.supernumerario_contract_access') is not null then
    update public.supernumerario_contract_access
    set contrato_codigo = 'CON-0001'
    where contrato_codigo = 'CONTRATO-INICIAL';
  end if;
end;
$$;

create table if not exists public.catalog_code_counters (
  scope text not null,
  prefix text not null,
  last_value integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (scope, prefix)
);

alter table public.catalog_code_counters enable row level security;

create or replace function public.reserve_prefixed_codes(
  p_scope text,
  p_prefix text,
  p_count integer default 1,
  p_width integer default 4
)
returns table(code text, value integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scope text := lower(trim(coalesce(p_scope, '')));
  v_prefix text := upper(trim(coalesce(p_prefix, '')));
  v_count integer := greatest(1, coalesce(p_count, 1));
  v_width integer := greatest(1, coalesce(p_width, 4));
  v_table text;
  v_last integer := 0;
  v_existing_max integer := 0;
  v_start integer;
  v_end integer;
  v_capture_regex text;
  v_match_regex text;
begin
  if v_count > 10000 then
    raise exception 'No se pueden reservar mas de 10000 codigos por solicitud.';
  end if;

  if v_prefix !~ '^[A-Z0-9]+$' then
    raise exception 'Prefijo invalido para consecutivo: %', p_prefix;
  end if;

  v_table := case v_scope
    when 'contracts' then 'contracts'
    when 'zones' then 'zones'
    when 'dependencies' then 'dependencies'
    when 'sedes' then 'sedes'
    when 'cargos' then 'cargos'
    when 'novedades' then 'novedades'
    when 'employees' then 'employees'
    else null
  end;

  if v_table is null then
    raise exception 'Alcance invalido para consecutivo: %', p_scope;
  end if;

  insert into public.catalog_code_counters(scope, prefix, last_value)
  values (v_scope, v_prefix, 0)
  on conflict (scope, prefix) do nothing;

  select c.last_value
  into v_last
  from public.catalog_code_counters c
  where c.scope = v_scope
    and c.prefix = v_prefix
  for update;

  v_capture_regex := '^' || v_prefix || '-([0-9]+)$';
  v_match_regex := '^' || v_prefix || '-[0-9]+$';

  execute format(
    'select coalesce(max(substring(codigo from %L)::integer), 0) from public.%I where codigo ~ %L',
    v_capture_regex,
    v_table,
    v_match_regex
  )
  into v_existing_max;

  v_start := greatest(coalesce(v_last, 0), coalesce(v_existing_max, 0)) + 1;
  v_end := v_start + v_count - 1;

  update public.catalog_code_counters
  set last_value = v_end,
      updated_at = now()
  where scope = v_scope
    and prefix = v_prefix;

  return query
  select
    v_prefix || '-' || lpad(gs::text, v_width, '0') as code,
    gs::integer as value
  from generate_series(v_start, v_end) as gs;
end;
$$;

grant execute on function public.reserve_prefixed_codes(text, text, integer, integer) to authenticated;

alter table public.dependencies
  add column if not exists contrato_codigo text,
  add column if not exists contrato_nombre text,
  add column if not exists cliente_nombre_snapshot text,
  add column if not exists cliente_nit_snapshot text;

alter table public.zones
  add column if not exists contrato_codigo text,
  add column if not exists contrato_nombre text,
  add column if not exists cliente_nombre_snapshot text,
  add column if not exists cliente_nit_snapshot text;

alter table public.sedes
  add column if not exists contrato_codigo text,
  add column if not exists contrato_nombre text,
  add column if not exists cliente_nombre_snapshot text,
  add column if not exists cliente_nit_snapshot text;

alter table public.employees
  add column if not exists contrato_codigo text,
  add column if not exists contrato_nombre text,
  add column if not exists cliente_nombre_snapshot text,
  add column if not exists cliente_nit_snapshot text;

alter table public.employee_cargo_history
  add column if not exists contrato_codigo text,
  add column if not exists contrato_nombre text,
  add column if not exists cliente_nombre_snapshot text,
  add column if not exists cliente_nit_snapshot text;

update public.dependencies
set contrato_codigo = 'CON-0001'
where contrato_codigo = 'CONTRATO-INICIAL';

update public.zones
set contrato_codigo = 'CON-0001'
where contrato_codigo = 'CONTRATO-INICIAL';

update public.sedes
set contrato_codigo = 'CON-0001'
where contrato_codigo = 'CONTRATO-INICIAL';

update public.employees
set contrato_codigo = 'CON-0001'
where contrato_codigo = 'CONTRATO-INICIAL';

update public.employee_cargo_history
set contrato_codigo = 'CON-0001'
where contrato_codigo = 'CONTRATO-INICIAL';

delete from public.contracts legacy
where legacy.codigo = 'CONTRATO-INICIAL'
  and exists (
    select 1
    from public.contracts current_contract
    where current_contract.codigo = 'CON-0001'
  );

with initial_contract as (
  select codigo, nombre, cliente_nombre, cliente_nit
  from public.contracts
  where codigo = 'CON-0001'
)
update public.dependencies d
set
  contrato_codigo = coalesce(d.contrato_codigo, c.codigo),
  contrato_nombre = coalesce(d.contrato_nombre, c.nombre),
  cliente_nombre_snapshot = coalesce(d.cliente_nombre_snapshot, c.cliente_nombre),
  cliente_nit_snapshot = coalesce(d.cliente_nit_snapshot, c.cliente_nit)
from initial_contract c
where d.contrato_codigo is null;

with initial_contract as (
  select codigo, nombre, cliente_nombre, cliente_nit
  from public.contracts
  where codigo = 'CON-0001'
)
update public.zones z
set
  contrato_codigo = coalesce(z.contrato_codigo, c.codigo),
  contrato_nombre = coalesce(z.contrato_nombre, c.nombre),
  cliente_nombre_snapshot = coalesce(z.cliente_nombre_snapshot, c.cliente_nombre),
  cliente_nit_snapshot = coalesce(z.cliente_nit_snapshot, c.cliente_nit)
from initial_contract c
where z.contrato_codigo is null;

with initial_contract as (
  select codigo, nombre, cliente_nombre, cliente_nit
  from public.contracts
  where codigo = 'CON-0001'
)
update public.sedes s
set
  contrato_codigo = coalesce(s.contrato_codigo, c.codigo),
  contrato_nombre = coalesce(s.contrato_nombre, c.nombre),
  cliente_nombre_snapshot = coalesce(s.cliente_nombre_snapshot, c.cliente_nombre),
  cliente_nit_snapshot = coalesce(s.cliente_nit_snapshot, c.cliente_nit)
from initial_contract c
where s.contrato_codigo is null;

with initial_contract as (
  select codigo, nombre, cliente_nombre, cliente_nit
  from public.contracts
  where codigo = 'CON-0001'
)
update public.employees e
set
  contrato_codigo = coalesce(e.contrato_codigo, (select s.contrato_codigo from public.sedes s where s.codigo = e.sede_codigo limit 1), c.codigo),
  contrato_nombre = coalesce(e.contrato_nombre, (select s.contrato_nombre from public.sedes s where s.codigo = e.sede_codigo limit 1), c.nombre),
  cliente_nombre_snapshot = coalesce(e.cliente_nombre_snapshot, (select s.cliente_nombre_snapshot from public.sedes s where s.codigo = e.sede_codigo limit 1), c.cliente_nombre),
  cliente_nit_snapshot = coalesce(e.cliente_nit_snapshot, (select s.cliente_nit_snapshot from public.sedes s where s.codigo = e.sede_codigo limit 1), c.cliente_nit)
from initial_contract c
where e.contrato_codigo is null;

with initial_contract as (
  select codigo, nombre, cliente_nombre, cliente_nit
  from public.contracts
  where codigo = 'CON-0001'
)
update public.employee_cargo_history h
set
  contrato_codigo = coalesce(
    h.contrato_codigo,
    (select e.contrato_codigo from public.employees e where e.id = h.employee_id limit 1),
    (select s.contrato_codigo from public.sedes s where s.codigo = h.sede_codigo limit 1),
    c.codigo
  ),
  contrato_nombre = coalesce(
    h.contrato_nombre,
    (select e.contrato_nombre from public.employees e where e.id = h.employee_id limit 1),
    (select s.contrato_nombre from public.sedes s where s.codigo = h.sede_codigo limit 1),
    c.nombre
  ),
  cliente_nombre_snapshot = coalesce(
    h.cliente_nombre_snapshot,
    (select e.cliente_nombre_snapshot from public.employees e where e.id = h.employee_id limit 1),
    (select s.cliente_nombre_snapshot from public.sedes s where s.codigo = h.sede_codigo limit 1),
    c.cliente_nombre
  ),
  cliente_nit_snapshot = coalesce(
    h.cliente_nit_snapshot,
    (select e.cliente_nit_snapshot from public.employees e where e.id = h.employee_id limit 1),
    (select s.cliente_nit_snapshot from public.sedes s where s.codigo = h.sede_codigo limit 1),
    c.cliente_nit
  )
from initial_contract c
where h.contrato_codigo is null;

create index if not exists idx_dependencies_contrato_codigo on public.dependencies (contrato_codigo);
create index if not exists idx_zones_contrato_codigo on public.zones (contrato_codigo);
create index if not exists idx_sedes_contrato_codigo on public.sedes (contrato_codigo);
create index if not exists idx_employees_contrato_codigo on public.employees (contrato_codigo);
create index if not exists idx_employee_cargo_history_contrato_codigo on public.employee_cargo_history (contrato_codigo);

-- >>>>>>>>>> schema_operations_phase39_contract_reporting_scope.sql
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
drop trigger if exists trg_employee_daily_status_contract_context on public.employee_daily_status;
create trigger trg_employee_daily_status_contract_context
before insert or update of employee_id, documento, sede_codigo, contrato_codigo, contrato_nombre, cliente_nombre_snapshot, cliente_nit_snapshot
on public.employee_daily_status
for each row execute function public.fill_employee_daily_status_contract_context();

drop trigger if exists trg_daily_sede_closure_contract_context on public.daily_sede_closures;
drop trigger if exists trg_daily_sede_closure_contract_context on public.daily_sede_closures;
create trigger trg_daily_sede_closure_contract_context
before insert or update of sede_codigo, contrato_codigo, contrato_nombre, cliente_nombre_snapshot, cliente_nit_snapshot
on public.daily_sede_closures
for each row execute function public.fill_daily_sede_contract_context();

drop trigger if exists trg_sede_status_contract_context on public.sede_status;
drop trigger if exists trg_sede_status_contract_context on public.sede_status;
create trigger trg_sede_status_contract_context
before insert or update of sede_codigo, contrato_codigo, contrato_nombre, cliente_nombre_snapshot, cliente_nit_snapshot
on public.sede_status
for each row execute function public.fill_daily_sede_contract_context();

drop trigger if exists trg_attendance_contract_context on public.attendance;
drop trigger if exists trg_attendance_contract_context on public.attendance;
create trigger trg_attendance_contract_context
before insert or update of empleado_id, documento, sede_codigo, contrato_codigo, contrato_nombre, cliente_nombre_snapshot, cliente_nit_snapshot
on public.attendance
for each row execute function public.fill_attendance_contract_context();

drop trigger if exists trg_absenteeism_contract_context on public.absenteeism;
drop trigger if exists trg_absenteeism_contract_context on public.absenteeism;
create trigger trg_absenteeism_contract_context
before insert or update of empleado_id, documento, sede_codigo, contrato_codigo, contrato_nombre, cliente_nombre_snapshot, cliente_nit_snapshot
on public.absenteeism
for each row execute function public.fill_absenteeism_contract_context();

drop trigger if exists trg_import_replacements_contract_context on public.import_replacements;
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
drop trigger if exists trg_daily_contract_metrics_updated_at on public.daily_contract_metrics;
create trigger trg_daily_contract_metrics_updated_at
before update on public.daily_contract_metrics
for each row execute function public.set_updated_at();

drop policy if exists "daily_contract_metrics_read_authenticated" on public.daily_contract_metrics;
drop policy if exists "daily_contract_metrics_read_authenticated" on public.daily_contract_metrics;
create policy "daily_contract_metrics_read_authenticated"
on public.daily_contract_metrics
for select
to authenticated
using (true);

drop policy if exists "daily_contract_metrics_write_admin" on public.daily_contract_metrics;
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

-- >>>>>>>>>> schema_operations_phase40_contract_access_rls.sql
-- Phase 40: contract-scoped access for client/contract administrators.
-- Users with role consultor can read only contracts explicitly assigned here.

create table if not exists public.profile_contract_access (
  user_id uuid not null references public.profiles(id) on delete cascade,
  contrato_codigo text not null references public.contracts(codigo) on update cascade on delete restrict,
  estado text not null default 'activo',
  created_by_uid uuid references public.profiles(id) on delete set null,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, contrato_codigo)
);

alter table public.profile_contract_access enable row level security;

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'contracts',
    'profile_contract_access',
    'daily_contract_metrics'
  ]
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = tbl
    ) then
      execute format('alter publication supabase_realtime add table public.%I', tbl);
    end if;
  end loop;
end $$;

create or replace function public.default_role_has_permission(role_value text, permission_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when role_value = 'superadmin' then true
    when role_value = 'admin' then permission_key = any(array[
      'viewUsers','editUsers','viewContracts','editContracts',
      'viewZones','editZones','viewDependencies','editDependencies',
      'viewSedes','editSedes','viewEmployees','editEmployees','manageEmployees',
      'manageEmployeeSchedules','viewSupervisors','editSupervisors','manageSupervisors',
      'viewSupernumerarios','editSupernumerarios','viewCargos','editCargos',
      'viewNovedades','editNovedades','viewQrScanner','viewQrDailyRegistry',
      'manageQrDevices'
    ])
    when role_value = 'consultor' then permission_key = any(array[
      'viewContracts','viewZones','viewDependencies','viewSedes','viewEmployees',
      'viewReports','viewReportsClient','exportReportsClient',
      'viewReportsCompany','exportReportsCompany',
      'viewReportsEmployees','exportReportsEmployees',
      'viewReportsHiring','exportReportsHiring',
      'viewReportsNoveltiesConsolidated','exportReportsNoveltiesConsolidated',
      'viewReportsServicesConsolidated','exportReportsServicesConsolidated'
    ])
    when role_value = 'supervisor' then permission_key = any(array[
      'viewSedes','editSedes','viewEmployees','editEmployees','manageEmployees',
      'viewSupervisors','editSupervisors','manageSupervisors',
      'viewQrScanner','viewQrDailyRegistry','manageQrDevices','uploadData'
    ])
    else false
  end;
$$;

drop trigger if exists trg_profile_contract_access_updated_at on public.profile_contract_access;
drop trigger if exists trg_profile_contract_access_updated_at on public.profile_contract_access;
create trigger trg_profile_contract_access_updated_at
before update on public.profile_contract_access
for each row execute function public.set_updated_at();

create or replace function public.current_profile_can_manage_contract_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.estado = 'activo'
      and p.role::text in ('superadmin', 'admin')
  );
$$;

create or replace function public.current_profile_is_active_non_supervisor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.estado = 'activo'
      and p.role::text in ('superadmin', 'admin', 'editor')
  );
$$;

create or replace function public.current_profile_has_contract_access(contract_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profile_contract_access pca
    join public.profiles p on p.id = pca.user_id
    where p.id = auth.uid()
      and p.estado = 'activo'
      and p.role::text = 'consultor'
      and pca.estado = 'activo'
      and nullif(trim(contract_code), '') is not null
      and pca.contrato_codigo = nullif(trim(contract_code), '')
  );
$$;

create or replace function public.can_read_contract_data(contract_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_profile_is_active_non_supervisor()
    or public.current_profile_has_contract_access(contract_code);
$$;

create or replace function public.can_read_dependency_data(dependency_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_profile_is_active_non_supervisor()
    or exists (
      select 1
      from public.dependencies d
      where d.codigo = nullif(trim(dependency_code), '')
        and public.current_profile_has_contract_access(d.contrato_codigo)
    );
$$;

create or replace function public.can_read_zone_data(zone_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_profile_is_active_non_supervisor()
    or public.current_supervisor_can_read_zone(zone_code)
    or exists (
      select 1
      from public.zones z
      where z.codigo = nullif(trim(zone_code), '')
        and public.current_profile_has_contract_access(z.contrato_codigo)
    );
$$;

create or replace function public.can_read_sede_data(sede_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_profile_is_active_non_supervisor()
    or exists (
      select 1
      from public.sedes s
      where s.codigo = nullif(trim(sede_code), '')
        and (
          public.current_supervisor_can_read_zone(s.zona_codigo)
          or public.current_profile_has_contract_access(s.contrato_codigo)
        )
    );
$$;

create or replace function public.can_read_employee_data(employee_id_value uuid, documento_value text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_profile_is_active_non_supervisor()
    or exists (
      select 1
      from public.employees e
      where (
          (employee_id_value is not null and e.id = employee_id_value)
          or (
            nullif(trim(documento_value), '') is not null
            and e.documento = nullif(trim(documento_value), '')
          )
        )
        and (
          public.current_supervisor_can_read_zone(e.zona_codigo)
          or public.can_read_sede_data(e.sede_codigo)
          or public.current_profile_has_contract_access(e.contrato_codigo)
        )
    );
$$;

create or replace function public.can_read_operational_sede_or_employee(
  sede_code text,
  employee_id_value uuid,
  documento_value text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_read_sede_data(sede_code)
    or public.can_read_employee_data(employee_id_value, documento_value);
$$;

grant execute on function public.current_profile_can_manage_contract_access() to authenticated;
grant execute on function public.default_role_has_permission(text, text) to authenticated;
grant execute on function public.current_profile_is_active_non_supervisor() to authenticated;
grant execute on function public.current_profile_has_contract_access(text) to authenticated;
grant execute on function public.can_read_contract_data(text) to authenticated;
grant execute on function public.can_read_dependency_data(text) to authenticated;
grant execute on function public.can_read_zone_data(text) to authenticated;
grant execute on function public.can_read_sede_data(text) to authenticated;
grant execute on function public.can_read_employee_data(uuid, text) to authenticated;
grant execute on function public.can_read_operational_sede_or_employee(text, uuid, text) to authenticated;

drop policy if exists "profile_contract_access_select" on public.profile_contract_access;
drop policy if exists "profile_contract_access_select" on public.profile_contract_access;
create policy "profile_contract_access_select"
on public.profile_contract_access
for select
to authenticated
using (public.current_profile_can_manage_contract_access() or user_id = auth.uid());

drop policy if exists "profile_contract_access_insert" on public.profile_contract_access;
drop policy if exists "profile_contract_access_insert" on public.profile_contract_access;
create policy "profile_contract_access_insert"
on public.profile_contract_access
for insert
to authenticated
with check (public.current_profile_can_manage_contract_access());

drop policy if exists "profile_contract_access_update" on public.profile_contract_access;
drop policy if exists "profile_contract_access_update" on public.profile_contract_access;
create policy "profile_contract_access_update"
on public.profile_contract_access
for update
to authenticated
using (public.current_profile_can_manage_contract_access())
with check (public.current_profile_can_manage_contract_access());

drop policy if exists "profile_contract_access_delete" on public.profile_contract_access;
drop policy if exists "profile_contract_access_delete" on public.profile_contract_access;
create policy "profile_contract_access_delete"
on public.profile_contract_access
for delete
to authenticated
using (public.current_profile_can_manage_contract_access());

drop policy if exists "contracts_read_authenticated" on public.contracts;
drop policy if exists "contracts_read_authenticated" on public.contracts;
create policy "contracts_read_authenticated"
on public.contracts
for select
to authenticated
using (public.can_read_contract_data(codigo));

drop policy if exists "dependencies_read_authenticated" on public.dependencies;
drop policy if exists "dependencies_read_authenticated" on public.dependencies;
create policy "dependencies_read_authenticated"
on public.dependencies
for select
to authenticated
using (public.can_read_dependency_data(codigo));

drop policy if exists "zones_read_authenticated" on public.zones;
drop policy if exists "zones_read_authenticated" on public.zones;
create policy "zones_read_authenticated"
on public.zones
for select
to authenticated
using (public.can_read_zone_data(codigo));

drop policy if exists "sedes_read_authenticated" on public.sedes;
drop policy if exists "sedes_read_authenticated" on public.sedes;
create policy "sedes_read_authenticated"
on public.sedes
for select
to authenticated
using (public.can_read_sede_data(codigo));

drop policy if exists "employees_read_authenticated" on public.employees;
drop policy if exists "employees_read_authenticated" on public.employees;
create policy "employees_read_authenticated"
on public.employees
for select
to authenticated
using (
  public.current_profile_is_active_non_supervisor()
  or public.can_read_sede_data(sede_codigo)
  or public.current_profile_has_contract_access(contrato_codigo)
);

drop policy if exists "attendance_read_authenticated" on public.attendance;
drop policy if exists "attendance_read_authenticated" on public.attendance;
create policy "attendance_read_authenticated"
on public.attendance
for select
to authenticated
using (
  public.can_read_contract_data(contrato_codigo)
  or public.can_read_operational_sede_or_employee(sede_codigo, empleado_id, documento)
);

drop policy if exists "absenteeism_read_authenticated" on public.absenteeism;
drop policy if exists "absenteeism_read_authenticated" on public.absenteeism;
create policy "absenteeism_read_authenticated"
on public.absenteeism
for select
to authenticated
using (
  public.can_read_contract_data(contrato_codigo)
  or public.can_read_operational_sede_or_employee(sede_codigo, empleado_id, documento)
);

drop policy if exists "sede_status_read_authenticated" on public.sede_status;
drop policy if exists "sede_status_read_authenticated" on public.sede_status;
create policy "sede_status_read_authenticated"
on public.sede_status
for select
to authenticated
using (
  public.can_read_contract_data(contrato_codigo)
  or public.can_read_sede_data(sede_codigo)
);

drop policy if exists "import_replacements_read_authenticated" on public.import_replacements;
drop policy if exists "import_replacements_read_authenticated" on public.import_replacements;
create policy "import_replacements_read_authenticated"
on public.import_replacements
for select
to authenticated
using (
  public.can_read_contract_data(contrato_codigo)
  or public.can_read_operational_sede_or_employee(sede_codigo, empleado_id, documento)
);

drop policy if exists "employee_cargo_history_read_authenticated" on public.employee_cargo_history;
drop policy if exists "employee_cargo_history_read_authenticated" on public.employee_cargo_history;
create policy "employee_cargo_history_read_authenticated"
on public.employee_cargo_history
for select
to authenticated
using (
  public.can_read_contract_data(contrato_codigo)
  or public.can_read_employee_data(employee_id, documento)
);

drop policy if exists "daily_sede_closures_read_authenticated" on public.daily_sede_closures;
drop policy if exists "daily_sede_closures_read_authenticated" on public.daily_sede_closures;
create policy "daily_sede_closures_read_authenticated"
on public.daily_sede_closures
for select
to authenticated
using (
  public.can_read_contract_data(contrato_codigo)
  or public.can_read_zone_data(zona_codigo)
  or public.can_read_sede_data(sede_codigo)
);

drop policy if exists "employee_daily_status_read_authenticated" on public.employee_daily_status;
drop policy if exists "employee_daily_status_read_authenticated" on public.employee_daily_status;
create policy "employee_daily_status_read_authenticated"
on public.employee_daily_status
for select
to authenticated
using (
  public.can_read_contract_data(contrato_codigo)
  or public.can_read_zone_data(zona_codigo_snapshot)
  or public.can_read_sede_data(sede_codigo)
);

drop policy if exists "daily_contract_metrics_read_authenticated" on public.daily_contract_metrics;
drop policy if exists "daily_contract_metrics_read_authenticated" on public.daily_contract_metrics;
create policy "daily_contract_metrics_read_authenticated"
on public.daily_contract_metrics
for select
to authenticated
using (public.can_read_contract_data(contrato_codigo));

-- >>>>>>>>>> schema_operations_phase41_contract_operational_calculations.sql
-- Phase 41: contract-scoped operational calculations.
-- The daily closure remains global, but operational metrics are reconciled by
-- contract before being rolled up to daily_metrics.

do $$
begin
  if to_regprocedure('public.refresh_employee_daily_status_base(text)') is null then
    alter function public.refresh_employee_daily_status(text) rename to refresh_employee_daily_status_base;
  end if;
end $$;

create or replace function public.refresh_employee_daily_status(p_fecha text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer := 0;
begin
  v_rows := public.refresh_employee_daily_status_base(p_fecha);

  with resolved as (
    select
      eds.id,
      ctx.contrato_codigo,
      ctx.contrato_nombre,
      ctx.cliente_nombre_snapshot,
      ctx.cliente_nit_snapshot
    from public.employee_daily_status eds
    cross join lateral public.resolve_contract_context(eds.sede_codigo, null, eds.employee_id, eds.documento) ctx
    where eds.fecha = p_fecha
  )
  update public.employee_daily_status eds
  set
    contrato_codigo = coalesce(resolved.contrato_codigo, eds.contrato_codigo),
    contrato_nombre = coalesce(resolved.contrato_nombre, eds.contrato_nombre),
    cliente_nombre_snapshot = coalesce(resolved.cliente_nombre_snapshot, eds.cliente_nombre_snapshot),
    cliente_nit_snapshot = coalesce(resolved.cliente_nit_snapshot, eds.cliente_nit_snapshot)
  from resolved
  where eds.id = resolved.id
    and (
      eds.contrato_codigo is distinct from coalesce(resolved.contrato_codigo, eds.contrato_codigo)
      or eds.contrato_nombre is distinct from coalesce(resolved.contrato_nombre, eds.contrato_nombre)
      or eds.cliente_nombre_snapshot is distinct from coalesce(resolved.cliente_nombre_snapshot, eds.cliente_nombre_snapshot)
      or eds.cliente_nit_snapshot is distinct from coalesce(resolved.cliente_nit_snapshot, eds.cliente_nit_snapshot)
    );

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
    select s.*
    from public.sedes s
    where lower(trim(coalesce(s.estado, 'activo'))) <> 'inactivo'
      and public.is_sede_scheduled_for_date_sql(s.jornada, p_fecha)
      and nullif(trim(s.contrato_codigo), '') is not null
  ),
  per_sede as (
    select
      s.contrato_codigo,
      s.contrato_nombre,
      s.cliente_nombre_snapshot,
      s.cliente_nit_snapshot,
      greatest(coalesce(s.numero_operarios, 0), 0)::integer as planeados,
      coalesce(ss.operarios_esperados, 0)::integer as contratados,
      coalesce(ss.operarios_presentes, 0)::integer as asistencias,
      coalesce(ss.operarios_presentes, 0)::integer as pagados,
      coalesce(ss.faltantes, 0)::integer as ausentismos,
      greatest(greatest(coalesce(s.numero_operarios, 0), 0) - coalesce(ss.operarios_esperados, 0), 0)::integer as no_contratados,
      coalesce(ss.faltantes, 0)::integer as faltan,
      greatest(coalesce(ss.operarios_presentes, 0) - greatest(coalesce(s.numero_operarios, 0), 0), 0)::integer as sobran
    from active_sedes s
    left join public.sede_status ss
      on ss.fecha = p_fecha
      and ss.sede_codigo = s.codigo
  ),
  closure_flag as (
    select exists (
      select 1
      from public.daily_closures dc
      where dc.fecha = p_fecha
        and (dc.locked = true or lower(trim(coalesce(dc.status, ''))) = 'closed')
    ) as is_closed
  ),
  grouped as (
    select
      p_fecha as fecha,
      contrato_codigo,
      max(contrato_nombre) as contrato_nombre,
      max(cliente_nombre_snapshot) as cliente_nombre_snapshot,
      max(cliente_nit_snapshot) as cliente_nit_snapshot,
      sum(planeados)::integer as planeados,
      sum(contratados)::integer as contratados,
      sum(asistencias)::integer as asistencias,
      sum(ausentismos)::integer as ausentismos,
      sum(pagados)::integer as pagados,
      sum(no_contratados)::integer as no_contratados,
      sum(faltan)::integer as faltan,
      sum(sobran)::integer as sobran,
      (select is_closed from closure_flag) as closed
    from per_sede
    group by contrato_codigo
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
    ausentismos,
    pagados,
    no_contratados,
    faltan,
    sobran,
    closed
  from grouped;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

create or replace function public.recompute_daily_metrics_from_employee_daily_status(p_fecha text)
returns public.daily_metrics
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result public.daily_metrics;
begin
  if p_fecha is null or p_fecha !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Fecha invalida para daily_metrics: %', p_fecha;
  end if;

  with contract_totals as (
    select
      p_fecha as fecha,
      coalesce(sum(planeados), 0)::integer as planned,
      coalesce(sum(contratados), 0)::integer as expected,
      coalesce(sum(asistencias), 0)::integer as attendance_count,
      coalesce(sum(ausentismos), 0)::integer as absenteeism,
      coalesce(sum(pagados), 0)::integer as paid_services,
      coalesce(sum(no_contratados), 0)::integer as no_contracted,
      coalesce(sum(faltan), 0)::integer as missing
    from public.daily_contract_metrics
    where fecha = p_fecha
  ),
  closure_flag as (
    select exists (
      select 1
      from public.daily_closures dc
      where dc.fecha = p_fecha
        and (dc.locked = true or lower(trim(coalesce(dc.status, ''))) = 'closed')
    ) as is_closed
  )
  insert into public.daily_metrics (
    id,
    fecha,
    planned,
    expected,
    unique_count,
    missing,
    attendance_count,
    absenteeism,
    paid_services,
    no_contracted,
    closed
  )
  select
    p_fecha,
    ct.fecha,
    ct.planned,
    ct.expected,
    ct.attendance_count,
    ct.missing,
    ct.attendance_count,
    ct.absenteeism,
    ct.paid_services,
    ct.no_contracted,
    (select is_closed from closure_flag)
  from contract_totals ct
  on conflict (id) do update
  set
    fecha = excluded.fecha,
    planned = excluded.planned,
    expected = excluded.expected,
    unique_count = excluded.unique_count,
    missing = excluded.missing,
    attendance_count = excluded.attendance_count,
    absenteeism = excluded.absenteeism,
    paid_services = excluded.paid_services,
    no_contracted = excluded.no_contracted,
    closed = excluded.closed,
    updated_at = now()
  returning * into v_result;

  return v_result;
end;
$$;

create or replace function public.recompute_daily_sede_closures_from_sede_status(p_fecha text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer := 0;
begin
  if p_fecha is null or p_fecha !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Fecha invalida para daily_sede_closures: %', p_fecha;
  end if;

  if exists (
    select 1
    from public.daily_closures dc
    where dc.fecha = p_fecha
      and (dc.locked = true or lower(trim(coalesce(dc.status, ''))) = 'closed')
  ) then
    select count(*)::integer
    into v_rows
    from public.daily_sede_closures
    where fecha = p_fecha;
    return v_rows;
  end if;

  delete from public.daily_sede_closures where fecha = p_fecha;

  with active_sedes as (
    select s.*
    from public.sedes s
    where lower(trim(coalesce(s.estado, 'activo'))) <> 'inactivo'
      and public.is_sede_scheduled_for_date_sql(s.jornada, p_fecha)
  )
  insert into public.daily_sede_closures (
    id,
    fecha,
    sede_codigo,
    sede_nombre,
    zona_codigo,
    zona_nombre,
    dependencia_codigo,
    dependencia_nombre,
    contrato_codigo,
    contrato_nombre,
    cliente_nombre_snapshot,
    cliente_nit_snapshot,
    planeados,
    contratados,
    registrados,
    faltantes,
    sobrantes
  )
  select
    concat(p_fecha, '_', s.codigo) as id,
    p_fecha,
    s.codigo,
    s.nombre,
    s.zona_codigo,
    s.zona_nombre,
    s.dependencia_codigo,
    s.dependencia_nombre,
    s.contrato_codigo,
    s.contrato_nombre,
    s.cliente_nombre_snapshot,
    s.cliente_nit_snapshot,
    greatest(coalesce(s.numero_operarios, 0), 0)::integer as planeados,
    coalesce(ss.operarios_esperados, 0)::integer as contratados,
    coalesce(ss.operarios_presentes, 0)::integer as registrados,
    coalesce(ss.faltantes, 0)::integer as faltantes,
    greatest(coalesce(ss.operarios_presentes, 0) - greatest(coalesce(s.numero_operarios, 0), 0), 0)::integer as sobrantes
  from active_sedes s
  left join public.sede_status ss
    on ss.fecha = p_fecha
    and ss.sede_codigo = s.codigo;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

create or replace function public.validate_daily_contract_metric_consistency(p_fecha text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if p_fecha is null or p_fecha !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Fecha invalida para validacion de metricas: %', p_fecha;
  end if;

  with contract_totals as (
    select
      coalesce(sum(planeados), 0)::integer as planned,
      coalesce(sum(contratados), 0)::integer as expected,
      coalesce(sum(asistencias), 0)::integer as attendance_count,
      coalesce(sum(ausentismos), 0)::integer as absenteeism,
      coalesce(sum(pagados), 0)::integer as paid_services,
      coalesce(sum(no_contratados), 0)::integer as no_contracted,
      coalesce(sum(faltan), 0)::integer as missing
    from public.daily_contract_metrics
    where fecha = p_fecha
  ),
  global_metrics as (
    select
      coalesce(dm.planned, 0)::integer as planned,
      coalesce(dm.expected, 0)::integer as expected,
      coalesce(dm.attendance_count, 0)::integer as attendance_count,
      coalesce(dm.absenteeism, 0)::integer as absenteeism,
      coalesce(dm.paid_services, 0)::integer as paid_services,
      coalesce(dm.no_contracted, 0)::integer as no_contracted,
      coalesce(dm.missing, 0)::integer as missing
    from public.daily_metrics dm
    where dm.fecha = p_fecha
    limit 1
  ),
  global_compare as (
    select
      row_to_json(ct)::jsonb as contract_sum,
      jsonb_build_object(
        'planned', coalesce(gm.planned, 0),
        'expected', coalesce(gm.expected, 0),
        'attendance_count', coalesce(gm.attendance_count, 0),
        'absenteeism', coalesce(gm.absenteeism, 0),
        'paid_services', coalesce(gm.paid_services, 0),
        'no_contracted', coalesce(gm.no_contracted, 0),
        'missing', coalesce(gm.missing, 0)
      ) as daily_metrics,
      ct.planned = coalesce(gm.planned, 0)
        and ct.expected = coalesce(gm.expected, 0)
        and ct.attendance_count = coalesce(gm.attendance_count, 0)
        and ct.absenteeism = coalesce(gm.absenteeism, 0)
        and ct.paid_services = coalesce(gm.paid_services, 0)
        and ct.no_contracted = coalesce(gm.no_contracted, 0)
        and ct.missing = coalesce(gm.missing, 0) as ok
    from contract_totals ct
    left join global_metrics gm on true
  ),
  sede_contract_totals as (
    select
      contrato_codigo,
      coalesce(sum(planeados), 0)::integer as planeados,
      coalesce(sum(contratados), 0)::integer as contratados,
      coalesce(sum(registrados), 0)::integer as asistencias,
      coalesce(sum(faltantes), 0)::integer as ausentismos,
      coalesce(sum(registrados), 0)::integer as pagados,
      coalesce(sum(greatest(coalesce(planeados, 0) - coalesce(contratados, 0), 0)), 0)::integer as no_contratados,
      coalesce(sum(faltantes), 0)::integer as faltan,
      coalesce(sum(sobrantes), 0)::integer as sobran
    from public.daily_sede_closures
    where fecha = p_fecha
      and nullif(trim(contrato_codigo), '') is not null
    group by contrato_codigo
  ),
  metric_contract_totals as (
    select
      contrato_codigo,
      coalesce(planeados, 0)::integer as planeados,
      coalesce(contratados, 0)::integer as contratados,
      coalesce(asistencias, 0)::integer as asistencias,
      coalesce(ausentismos, 0)::integer as ausentismos,
      coalesce(pagados, 0)::integer as pagados,
      coalesce(no_contratados, 0)::integer as no_contratados,
      coalesce(faltan, 0)::integer as faltan,
      coalesce(sobran, 0)::integer as sobran
    from public.daily_contract_metrics
    where fecha = p_fecha
  ),
  contract_mismatches as (
    select
      coalesce(sct.contrato_codigo, mct.contrato_codigo) as contrato_codigo,
      row_to_json(sct)::jsonb as daily_sede_closures_sum,
      row_to_json(mct)::jsonb as daily_contract_metrics,
      (
        coalesce(sct.planeados, 0) = coalesce(mct.planeados, 0)
        and coalesce(sct.contratados, 0) = coalesce(mct.contratados, 0)
        and coalesce(sct.asistencias, 0) = coalesce(mct.asistencias, 0)
        and coalesce(sct.ausentismos, 0) = coalesce(mct.ausentismos, 0)
        and coalesce(sct.pagados, 0) = coalesce(mct.pagados, 0)
        and coalesce(sct.no_contratados, 0) = coalesce(mct.no_contratados, 0)
        and coalesce(sct.faltan, 0) = coalesce(mct.faltan, 0)
        and coalesce(sct.sobran, 0) = coalesce(mct.sobran, 0)
      ) as ok
    from sede_contract_totals sct
    full outer join metric_contract_totals mct on mct.contrato_codigo = sct.contrato_codigo
  ),
  contract_compare as (
    select
      coalesce(bool_and(ok), true) as ok,
      coalesce(jsonb_agg(
        jsonb_build_object(
          'contrato_codigo', contrato_codigo,
          'daily_sede_closures_sum', daily_sede_closures_sum,
          'daily_contract_metrics', daily_contract_metrics
        )
      ) filter (where ok = false), '[]'::jsonb) as mismatches
    from contract_mismatches
  )
  select jsonb_build_object(
    'ok', (select ok from global_compare) and (select ok from contract_compare),
    'fecha', p_fecha,
    'global', jsonb_build_object(
      'ok', (select ok from global_compare),
      'contract_sum', (select contract_sum from global_compare),
      'daily_metrics', (select daily_metrics from global_compare)
    ),
    'contracts', jsonb_build_object(
      'ok', (select ok from contract_compare),
      'mismatches', (select mismatches from contract_compare)
    )
  )
  into v_result;

  return v_result;
end;
$$;

create or replace function public.refresh_operational_snapshots_from_employee_daily_status(p_fecha text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_rows integer := 0;
  v_sedes integer := 0;
  v_contracts integer := 0;
  v_sede_closures integer := 0;
  v_metrics public.daily_metrics;
  v_validation jsonb;
begin
  v_employee_rows := public.refresh_employee_daily_status(p_fecha);
  v_sedes := public.recompute_sede_status_from_employee_daily_status(p_fecha);
  v_contracts := public.recompute_daily_contract_metrics_from_employee_daily_status(p_fecha);
  v_metrics := public.recompute_daily_metrics_from_employee_daily_status(p_fecha);
  v_sede_closures := public.recompute_daily_sede_closures_from_sede_status(p_fecha);
  v_validation := public.validate_daily_contract_metric_consistency(p_fecha);

  if coalesce((v_validation ->> 'ok')::boolean, false) = false then
    raise exception 'Inconsistencia en metricas operativas por contrato para %: %', p_fecha, v_validation;
  end if;

  return jsonb_build_object(
    'fecha', p_fecha,
    'employee_daily_status_rows', v_employee_rows,
    'sede_status_rows', v_sedes,
    'daily_contract_metrics_rows', v_contracts,
    'daily_metrics_id', v_metrics.id,
    'daily_sede_closures_rows', v_sede_closures,
    'attendance_count', v_metrics.attendance_count,
    'expected', v_metrics.expected,
    'planned', v_metrics.planned,
    'validation', v_validation
  );
end;
$$;

grant execute on function public.refresh_employee_daily_status(text) to authenticated;
grant execute on function public.recompute_sede_status_from_employee_daily_status(text) to authenticated;
grant execute on function public.recompute_daily_contract_metrics_from_employee_daily_status(text) to authenticated;
grant execute on function public.recompute_daily_metrics_from_employee_daily_status(text) to authenticated;
grant execute on function public.recompute_daily_sede_closures_from_sede_status(text) to authenticated;
grant execute on function public.validate_daily_contract_metric_consistency(text) to authenticated;
grant execute on function public.refresh_operational_snapshots_from_employee_daily_status(text) to authenticated;

-- >>>>>>>>>> schema_operations_phase42_contract_profile_permissions.sql
-- Phase 42: profile-level contract permissions.
-- Phase 5 of the contract rollout: profiles carry the primary contract scope,
-- while profile_contract_access remains as the normalized assignment table.

alter table public.profiles
  add column if not exists contrato_codigo text,
  add column if not exists contratos_permitidos text[] not null default '{}';

create index if not exists idx_profiles_contrato_codigo
  on public.profiles (contrato_codigo);

create index if not exists idx_profiles_contratos_permitidos
  on public.profiles using gin (contratos_permitidos);

create or replace function public.sync_profile_contract_fields(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_codes text[] := '{}'::text[];
begin
  if p_user_id is null then
    return;
  end if;

  select coalesce(array_agg(code order by code), '{}'::text[])
  into v_codes
  from (
    select distinct nullif(trim(pca.contrato_codigo), '') as code
    from public.profile_contract_access pca
    where pca.user_id = p_user_id
      and lower(trim(coalesce(pca.estado, 'activo'))) = 'activo'
      and nullif(trim(pca.contrato_codigo), '') is not null
  ) codes;

  update public.profiles p
  set
    contrato_codigo = case when array_length(v_codes, 1) > 0 then v_codes[1] else null end,
    contratos_permitidos = coalesce(v_codes, '{}'::text[]),
    updated_at = now()
  where p.id = p_user_id;
end;
$$;

create or replace function public.sync_profile_contract_fields_from_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.sync_profile_contract_fields(old.user_id);
    return old;
  end if;
  perform public.sync_profile_contract_fields(new.user_id);
  return new;
end;
$$;

drop trigger if exists trg_profile_contract_access_sync_profile on public.profile_contract_access;
drop trigger if exists trg_profile_contract_access_sync_profile on public.profile_contract_access;
create trigger trg_profile_contract_access_sync_profile
after insert or update or delete on public.profile_contract_access
for each row execute function public.sync_profile_contract_fields_from_access();

with assigned as (
  select
    pca.user_id,
    coalesce(array_agg(distinct pca.contrato_codigo order by pca.contrato_codigo), '{}'::text[]) as codes
  from public.profile_contract_access pca
  where lower(trim(coalesce(pca.estado, 'activo'))) = 'activo'
    and nullif(trim(pca.contrato_codigo), '') is not null
  group by pca.user_id
)
update public.profiles p
set
  contratos_permitidos = assigned.codes,
  contrato_codigo = coalesce(nullif(trim(p.contrato_codigo), ''), assigned.codes[1]),
  updated_at = now()
from assigned
where assigned.user_id = p.id;

create or replace function public.current_profile_is_internal_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.estado = 'activo'
      and p.role::text in ('superadmin', 'admin', 'editor')
  );
$$;

create or replace function public.current_profile_is_active_non_supervisor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_profile_is_internal_user();
$$;

create or replace function public.current_profile_can_manage_contract_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.estado = 'activo'
      and p.role::text in ('superadmin', 'admin')
  );
$$;

create or replace function public.current_profile_contract_codes()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select coalesce(array(
      select distinct clean_code
      from (
        select nullif(trim(p.contrato_codigo), '') as clean_code
        union all
        select nullif(trim(value), '') as clean_code
        from unnest(coalesce(p.contratos_permitidos, '{}'::text[])) as allowed(value)
        union all
        select nullif(trim(pca.contrato_codigo), '') as clean_code
        from public.profile_contract_access pca
        where pca.user_id = p.id
          and lower(trim(coalesce(pca.estado, 'activo'))) = 'activo'
      ) codes
      where clean_code is not null
      order by clean_code
    ), '{}'::text[])
    from public.profiles p
    where p.id = auth.uid()
      and p.estado = 'activo'
      and p.role::text = 'consultor'
  ), '{}'::text[]);
$$;

create or replace function public.current_profile_has_contract_access(contract_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select nullif(trim(contract_code), '') is not null
    and nullif(trim(contract_code), '') = any(public.current_profile_contract_codes());
$$;

create or replace function public.can_read_contract_data(contract_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_profile_is_internal_user()
    or public.current_profile_has_contract_access(contract_code);
$$;

create or replace function public.can_read_dependency_data(dependency_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_profile_is_internal_user()
    or exists (
      select 1
      from public.dependencies d
      where d.codigo = nullif(trim(dependency_code), '')
        and public.current_profile_has_contract_access(d.contrato_codigo)
    );
$$;

create or replace function public.can_read_zone_data(zone_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_profile_is_internal_user()
    or public.current_supervisor_can_read_zone(zone_code)
    or exists (
      select 1
      from public.zones z
      where z.codigo = nullif(trim(zone_code), '')
        and public.current_profile_has_contract_access(z.contrato_codigo)
    );
$$;

create or replace function public.can_read_sede_data(sede_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_profile_is_internal_user()
    or exists (
      select 1
      from public.sedes s
      where s.codigo = nullif(trim(sede_code), '')
        and (
          public.current_supervisor_can_read_zone(s.zona_codigo)
          or public.current_profile_has_contract_access(s.contrato_codigo)
        )
    );
$$;

create or replace function public.can_read_employee_data(employee_id_value uuid, documento_value text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_profile_is_internal_user()
    or exists (
      select 1
      from public.employees e
      where (
          (employee_id_value is not null and e.id = employee_id_value)
          or (
            nullif(trim(documento_value), '') is not null
            and e.documento = nullif(trim(documento_value), '')
          )
        )
        and (
          public.current_supervisor_can_read_zone(e.zona_codigo)
          or public.can_read_sede_data(e.sede_codigo)
          or public.current_profile_has_contract_access(e.contrato_codigo)
        )
    );
$$;

create or replace function public.can_read_operational_sede_or_employee(
  sede_code text,
  employee_id_value uuid,
  documento_value text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_read_sede_data(sede_code)
    or public.can_read_employee_data(employee_id_value, documento_value);
$$;

create or replace function public.protect_profile_self_service_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_uid uuid := auth.uid();
  current_is_superadmin boolean := public.is_superadmin();
begin
  if current_uid is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.id = current_uid and current_is_superadmin is not true then
      new.role := 'empleado';
      new.estado := 'activo';
      new.supervisor_eligible := false;
      new.zona_codigo := null;
      new.zonas_permitidas := '{}'::text[];
      new.contrato_codigo := null;
      new.contratos_permitidos := '{}'::text[];
      new.created_by_uid := null;
      new.created_by_email := null;
      new.last_modified_by_uid := null;
      new.last_modified_by_email := null;
      new.deleted_at := null;
      new.deleted_by_uid := null;
      new.deleted_by_email := null;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.id = current_uid and current_is_superadmin is not true then
      if new.role is distinct from old.role
        or new.estado is distinct from old.estado
        or new.supervisor_eligible is distinct from old.supervisor_eligible
        or new.zona_codigo is distinct from old.zona_codigo
        or new.zonas_permitidas is distinct from old.zonas_permitidas
        or new.contrato_codigo is distinct from old.contrato_codigo
        or new.contratos_permitidos is distinct from old.contratos_permitidos
        or new.created_by_uid is distinct from old.created_by_uid
        or new.created_by_email is distinct from old.created_by_email
        or new.last_modified_by_uid is distinct from old.last_modified_by_uid
        or new.last_modified_by_email is distinct from old.last_modified_by_email
        or new.deleted_at is distinct from old.deleted_at
        or new.deleted_by_uid is distinct from old.deleted_by_uid
        or new.deleted_by_email is distinct from old.deleted_by_email
      then
        raise exception 'No puedes modificar rol, estado, zonas, contratos ni campos administrativos de tu propio perfil.';
      end if;
    end if;
    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_profiles_protect_self_service_fields on public.profiles;
drop trigger if exists trg_profiles_protect_self_service_fields on public.profiles;
create trigger trg_profiles_protect_self_service_fields
before insert or update on public.profiles
for each row
execute function public.protect_profile_self_service_fields();

drop policy if exists "profile_contract_access_select" on public.profile_contract_access;
drop policy if exists "profile_contract_access_select" on public.profile_contract_access;
create policy "profile_contract_access_select"
on public.profile_contract_access
for select
to authenticated
using (public.current_profile_is_internal_user() or user_id = auth.uid());

drop policy if exists "profile_contract_access_insert" on public.profile_contract_access;
drop policy if exists "profile_contract_access_insert" on public.profile_contract_access;
create policy "profile_contract_access_insert"
on public.profile_contract_access
for insert
to authenticated
with check (public.current_profile_can_manage_contract_access());

drop policy if exists "profile_contract_access_update" on public.profile_contract_access;
drop policy if exists "profile_contract_access_update" on public.profile_contract_access;
create policy "profile_contract_access_update"
on public.profile_contract_access
for update
to authenticated
using (public.current_profile_can_manage_contract_access())
with check (public.current_profile_can_manage_contract_access());

drop policy if exists "profile_contract_access_delete" on public.profile_contract_access;
drop policy if exists "profile_contract_access_delete" on public.profile_contract_access;
create policy "profile_contract_access_delete"
on public.profile_contract_access
for delete
to authenticated
using (public.current_profile_can_manage_contract_access());

drop policy if exists "contracts_read_authenticated" on public.contracts;
drop policy if exists "contracts_read_authenticated" on public.contracts;
create policy "contracts_read_authenticated"
on public.contracts
for select
to authenticated
using (public.can_read_contract_data(codigo));

drop policy if exists "dependencies_read_authenticated" on public.dependencies;
drop policy if exists "dependencies_read_authenticated" on public.dependencies;
create policy "dependencies_read_authenticated"
on public.dependencies
for select
to authenticated
using (public.can_read_dependency_data(codigo));

drop policy if exists "zones_read_authenticated" on public.zones;
drop policy if exists "zones_read_authenticated" on public.zones;
create policy "zones_read_authenticated"
on public.zones
for select
to authenticated
using (public.can_read_zone_data(codigo));

drop policy if exists "sedes_read_authenticated" on public.sedes;
drop policy if exists "sedes_read_authenticated" on public.sedes;
create policy "sedes_read_authenticated"
on public.sedes
for select
to authenticated
using (public.can_read_sede_data(codigo));

drop policy if exists "employees_read_authenticated" on public.employees;
drop policy if exists "employees_read_authenticated" on public.employees;
create policy "employees_read_authenticated"
on public.employees
for select
to authenticated
using (
  public.current_profile_is_internal_user()
  or public.can_read_sede_data(sede_codigo)
  or public.current_profile_has_contract_access(contrato_codigo)
);

drop policy if exists "attendance_read_authenticated" on public.attendance;
drop policy if exists "attendance_read_authenticated" on public.attendance;
create policy "attendance_read_authenticated"
on public.attendance
for select
to authenticated
using (
  public.can_read_contract_data(contrato_codigo)
  or public.can_read_operational_sede_or_employee(sede_codigo, empleado_id, documento)
);

drop policy if exists "absenteeism_read_authenticated" on public.absenteeism;
drop policy if exists "absenteeism_read_authenticated" on public.absenteeism;
create policy "absenteeism_read_authenticated"
on public.absenteeism
for select
to authenticated
using (
  public.can_read_contract_data(contrato_codigo)
  or public.can_read_operational_sede_or_employee(sede_codigo, empleado_id, documento)
);

drop policy if exists "sede_status_read_authenticated" on public.sede_status;
drop policy if exists "sede_status_read_authenticated" on public.sede_status;
create policy "sede_status_read_authenticated"
on public.sede_status
for select
to authenticated
using (
  public.can_read_contract_data(contrato_codigo)
  or public.can_read_sede_data(sede_codigo)
);

drop policy if exists "import_replacements_read_authenticated" on public.import_replacements;
drop policy if exists "import_replacements_read_authenticated" on public.import_replacements;
create policy "import_replacements_read_authenticated"
on public.import_replacements
for select
to authenticated
using (
  public.can_read_contract_data(contrato_codigo)
  or public.can_read_operational_sede_or_employee(sede_codigo, empleado_id, documento)
);

drop policy if exists "employee_cargo_history_read_authenticated" on public.employee_cargo_history;
drop policy if exists "employee_cargo_history_read_authenticated" on public.employee_cargo_history;
create policy "employee_cargo_history_read_authenticated"
on public.employee_cargo_history
for select
to authenticated
using (
  public.can_read_contract_data(contrato_codigo)
  or public.can_read_employee_data(employee_id, documento)
);

drop policy if exists "daily_sede_closures_read_authenticated" on public.daily_sede_closures;
drop policy if exists "daily_sede_closures_read_authenticated" on public.daily_sede_closures;
create policy "daily_sede_closures_read_authenticated"
on public.daily_sede_closures
for select
to authenticated
using (
  public.can_read_contract_data(contrato_codigo)
  or public.can_read_zone_data(zona_codigo)
  or public.can_read_sede_data(sede_codigo)
);

drop policy if exists "employee_daily_status_read_authenticated" on public.employee_daily_status;
drop policy if exists "employee_daily_status_read_authenticated" on public.employee_daily_status;
create policy "employee_daily_status_read_authenticated"
on public.employee_daily_status
for select
to authenticated
using (
  public.can_read_contract_data(contrato_codigo)
  or public.can_read_zone_data(zona_codigo_snapshot)
  or public.can_read_sede_data(sede_codigo)
);

drop policy if exists "daily_contract_metrics_read_authenticated" on public.daily_contract_metrics;
drop policy if exists "daily_contract_metrics_read_authenticated" on public.daily_contract_metrics;
create policy "daily_contract_metrics_read_authenticated"
on public.daily_contract_metrics
for select
to authenticated
using (public.can_read_contract_data(contrato_codigo));

drop policy if exists "incapacitados_read_authenticated" on public.incapacitados;
drop policy if exists "incapacitados_read_authenticated" on public.incapacitados;
create policy "incapacitados_read_authenticated"
on public.incapacitados
for select
to authenticated
using (public.can_read_employee_data(employee_id, documento));

drop policy if exists "import_history_read_authenticated" on public.import_history;
drop policy if exists "import_history_read_authenticated" on public.import_history;
create policy "import_history_read_authenticated"
on public.import_history
for select
to authenticated
using (public.current_profile_is_internal_user());

drop policy if exists "daily_metrics_read_authenticated" on public.daily_metrics;
drop policy if exists "daily_metrics_read_authenticated" on public.daily_metrics;
create policy "daily_metrics_read_authenticated"
on public.daily_metrics
for select
to authenticated
using (public.current_profile_is_internal_user());

drop policy if exists "daily_closures_read_authenticated" on public.daily_closures;
drop policy if exists "daily_closures_read_authenticated" on public.daily_closures;
create policy "daily_closures_read_authenticated"
on public.daily_closures
for select
to authenticated
using (public.current_profile_is_internal_user());

grant execute on function public.sync_profile_contract_fields(uuid) to authenticated;
grant execute on function public.current_profile_can_manage_contract_access() to authenticated;
grant execute on function public.current_profile_is_internal_user() to authenticated;
grant execute on function public.current_profile_is_active_non_supervisor() to authenticated;
grant execute on function public.current_profile_contract_codes() to authenticated;
grant execute on function public.current_profile_has_contract_access(text) to authenticated;
grant execute on function public.can_read_contract_data(text) to authenticated;
grant execute on function public.can_read_dependency_data(text) to authenticated;
grant execute on function public.can_read_zone_data(text) to authenticated;
grant execute on function public.can_read_sede_data(text) to authenticated;
grant execute on function public.can_read_employee_data(uuid, text) to authenticated;
grant execute on function public.can_read_operational_sede_or_employee(text, uuid, text) to authenticated;

-- >>>>>>>>>> schema_operations_phase43_backend_contract_context.sql
-- Phase 43: contract context for WhatsApp/QR backend artifacts.
-- Persist contract/client snapshots in QR, incapacity and certificate records so
-- backend-created rows can be filtered and reported without relying on later joins.

alter table public.attendance_qr_tokens
  add column if not exists contrato_codigo text,
  add column if not exists contrato_nombre text,
  add column if not exists cliente_nombre_snapshot text,
  add column if not exists cliente_nit_snapshot text;

alter table public.employee_daily_exits
  add column if not exists contrato_codigo text,
  add column if not exists contrato_nombre text,
  add column if not exists cliente_nombre_snapshot text,
  add column if not exists cliente_nit_snapshot text;

alter table public.attendance_qr_scans
  add column if not exists contrato_codigo text,
  add column if not exists contrato_nombre text,
  add column if not exists cliente_nombre_snapshot text,
  add column if not exists cliente_nit_snapshot text;

alter table public.incapacitados
  add column if not exists contrato_codigo text,
  add column if not exists contrato_nombre text,
  add column if not exists cliente_nombre_snapshot text,
  add column if not exists cliente_nit_snapshot text;

alter table public.employee_shift_status
  add column if not exists contrato_codigo text,
  add column if not exists contrato_nombre text,
  add column if not exists cliente_nombre_snapshot text,
  add column if not exists cliente_nit_snapshot text;

alter table public.employee_certificate_audit
  add column if not exists contrato_codigo text,
  add column if not exists contrato_nombre text,
  add column if not exists cliente_nombre_snapshot text,
  add column if not exists cliente_nit_snapshot text;

create or replace function public.fill_qr_token_contract_context()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
begin
  select * into v_ctx
  from public.resolve_contract_context(new.sede_codigo, new.employee_id, null, new.documento);
  new.contrato_codigo = coalesce(new.contrato_codigo, v_ctx.contrato_codigo);
  new.contrato_nombre = coalesce(new.contrato_nombre, v_ctx.contrato_nombre);
  new.cliente_nombre_snapshot = coalesce(new.cliente_nombre_snapshot, v_ctx.cliente_nombre_snapshot);
  new.cliente_nit_snapshot = coalesce(new.cliente_nit_snapshot, v_ctx.cliente_nit_snapshot);
  return new;
end;
$$;

create or replace function public.fill_qr_exit_contract_context()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
begin
  select * into v_ctx
  from public.resolve_contract_context(new.sede_codigo, new.employee_id, null, new.documento);
  new.contrato_codigo = coalesce(new.contrato_codigo, v_ctx.contrato_codigo);
  new.contrato_nombre = coalesce(new.contrato_nombre, v_ctx.contrato_nombre);
  new.cliente_nombre_snapshot = coalesce(new.cliente_nombre_snapshot, v_ctx.cliente_nombre_snapshot);
  new.cliente_nit_snapshot = coalesce(new.cliente_nit_snapshot, v_ctx.cliente_nit_snapshot);
  return new;
end;
$$;

create or replace function public.fill_qr_scan_contract_context()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token public.attendance_qr_tokens;
  v_ctx record;
begin
  if new.qr_token_id is not null then
    select * into v_token
    from public.attendance_qr_tokens
    where id = new.qr_token_id
    limit 1;
  end if;

  select * into v_ctx
  from public.resolve_contract_context(
    coalesce(new.sede_codigo, v_token.sede_codigo),
    coalesce(new.employee_id, v_token.employee_id),
    null,
    coalesce(new.documento, v_token.documento)
  );

  new.contrato_codigo = coalesce(new.contrato_codigo, v_token.contrato_codigo, v_ctx.contrato_codigo);
  new.contrato_nombre = coalesce(new.contrato_nombre, v_token.contrato_nombre, v_ctx.contrato_nombre);
  new.cliente_nombre_snapshot = coalesce(new.cliente_nombre_snapshot, v_token.cliente_nombre_snapshot, v_ctx.cliente_nombre_snapshot);
  new.cliente_nit_snapshot = coalesce(new.cliente_nit_snapshot, v_token.cliente_nit_snapshot, v_ctx.cliente_nit_snapshot);
  return new;
end;
$$;

create or replace function public.fill_incapacidad_contract_context()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
begin
  select * into v_ctx
  from public.resolve_contract_context(null, new.employee_id, null, new.documento);
  new.contrato_codigo = coalesce(new.contrato_codigo, v_ctx.contrato_codigo);
  new.contrato_nombre = coalesce(new.contrato_nombre, v_ctx.contrato_nombre);
  new.cliente_nombre_snapshot = coalesce(new.cliente_nombre_snapshot, v_ctx.cliente_nombre_snapshot);
  new.cliente_nit_snapshot = coalesce(new.cliente_nit_snapshot, v_ctx.cliente_nit_snapshot);
  return new;
end;
$$;

create or replace function public.fill_employee_shift_status_contract_context()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
begin
  select * into v_ctx
  from public.resolve_contract_context(new.sede_codigo, new.employee_id, null, new.documento);
  new.contrato_codigo = coalesce(new.contrato_codigo, v_ctx.contrato_codigo);
  new.contrato_nombre = coalesce(new.contrato_nombre, v_ctx.contrato_nombre);
  new.cliente_nombre_snapshot = coalesce(new.cliente_nombre_snapshot, v_ctx.cliente_nombre_snapshot);
  new.cliente_nit_snapshot = coalesce(new.cliente_nit_snapshot, v_ctx.cliente_nit_snapshot);
  return new;
end;
$$;

drop trigger if exists trg_attendance_qr_tokens_contract_context on public.attendance_qr_tokens;
drop trigger if exists trg_attendance_qr_tokens_contract_context on public.attendance_qr_tokens;
create trigger trg_attendance_qr_tokens_contract_context
before insert or update of employee_id, documento, sede_codigo, contrato_codigo, contrato_nombre, cliente_nombre_snapshot, cliente_nit_snapshot
on public.attendance_qr_tokens
for each row execute function public.fill_qr_token_contract_context();

drop trigger if exists trg_employee_daily_exits_contract_context on public.employee_daily_exits;
drop trigger if exists trg_employee_daily_exits_contract_context on public.employee_daily_exits;
create trigger trg_employee_daily_exits_contract_context
before insert or update of employee_id, documento, sede_codigo, contrato_codigo, contrato_nombre, cliente_nombre_snapshot, cliente_nit_snapshot
on public.employee_daily_exits
for each row execute function public.fill_qr_exit_contract_context();

drop trigger if exists trg_attendance_qr_scans_contract_context on public.attendance_qr_scans;
drop trigger if exists trg_attendance_qr_scans_contract_context on public.attendance_qr_scans;
create trigger trg_attendance_qr_scans_contract_context
before insert or update of qr_token_id, employee_id, documento, sede_codigo, contrato_codigo, contrato_nombre, cliente_nombre_snapshot, cliente_nit_snapshot
on public.attendance_qr_scans
for each row execute function public.fill_qr_scan_contract_context();

drop trigger if exists trg_incapacitados_contract_context on public.incapacitados;
drop trigger if exists trg_incapacitados_contract_context on public.incapacitados;
create trigger trg_incapacitados_contract_context
before insert or update of employee_id, documento, contrato_codigo, contrato_nombre, cliente_nombre_snapshot, cliente_nit_snapshot
on public.incapacitados
for each row execute function public.fill_incapacidad_contract_context();

drop trigger if exists trg_employee_shift_status_contract_context on public.employee_shift_status;
drop trigger if exists trg_employee_shift_status_contract_context on public.employee_shift_status;
create trigger trg_employee_shift_status_contract_context
before insert or update of employee_id, documento, sede_codigo, contrato_codigo, contrato_nombre, cliente_nombre_snapshot, cliente_nit_snapshot
on public.employee_shift_status
for each row execute function public.fill_employee_shift_status_contract_context();

with resolved as (
  select q.id, ctx.*
  from public.attendance_qr_tokens q
  cross join lateral public.resolve_contract_context(q.sede_codigo, q.employee_id, null, q.documento) ctx
)
update public.attendance_qr_tokens q
set
  contrato_codigo = coalesce(resolved.contrato_codigo, q.contrato_codigo),
  contrato_nombre = coalesce(resolved.contrato_nombre, q.contrato_nombre),
  cliente_nombre_snapshot = coalesce(resolved.cliente_nombre_snapshot, q.cliente_nombre_snapshot),
  cliente_nit_snapshot = coalesce(resolved.cliente_nit_snapshot, q.cliente_nit_snapshot)
from resolved
where q.id = resolved.id;

with resolved as (
  select e.id, ctx.*
  from public.employee_daily_exits e
  cross join lateral public.resolve_contract_context(e.sede_codigo, e.employee_id, null, e.documento) ctx
)
update public.employee_daily_exits e
set
  contrato_codigo = coalesce(resolved.contrato_codigo, e.contrato_codigo),
  contrato_nombre = coalesce(resolved.contrato_nombre, e.contrato_nombre),
  cliente_nombre_snapshot = coalesce(resolved.cliente_nombre_snapshot, e.cliente_nombre_snapshot),
  cliente_nit_snapshot = coalesce(resolved.cliente_nit_snapshot, e.cliente_nit_snapshot)
from resolved
where e.id = resolved.id;

with resolved as (
  select s.id, ctx.*
  from public.attendance_qr_scans s
  cross join lateral public.resolve_contract_context(s.sede_codigo, s.employee_id, null, s.documento) ctx
)
update public.attendance_qr_scans s
set
  contrato_codigo = coalesce(resolved.contrato_codigo, s.contrato_codigo),
  contrato_nombre = coalesce(resolved.contrato_nombre, s.contrato_nombre),
  cliente_nombre_snapshot = coalesce(resolved.cliente_nombre_snapshot, s.cliente_nombre_snapshot),
  cliente_nit_snapshot = coalesce(resolved.cliente_nit_snapshot, s.cliente_nit_snapshot)
from resolved
where s.id = resolved.id;

with resolved as (
  select i.id, ctx.*
  from public.incapacitados i
  cross join lateral public.resolve_contract_context(null, i.employee_id, null, i.documento) ctx
)
update public.incapacitados i
set
  contrato_codigo = coalesce(resolved.contrato_codigo, i.contrato_codigo),
  contrato_nombre = coalesce(resolved.contrato_nombre, i.contrato_nombre),
  cliente_nombre_snapshot = coalesce(resolved.cliente_nombre_snapshot, i.cliente_nombre_snapshot),
  cliente_nit_snapshot = coalesce(resolved.cliente_nit_snapshot, i.cliente_nit_snapshot)
from resolved
where i.id = resolved.id;

with resolved as (
  select a.id, e.contrato_codigo, e.contrato_nombre, e.cliente_nombre_snapshot, e.cliente_nit_snapshot
  from public.employee_certificate_audit a
  left join public.employees e on e.id = a.employee_id
)
update public.employee_certificate_audit a
set
  contrato_codigo = coalesce(resolved.contrato_codigo, a.contrato_codigo),
  contrato_nombre = coalesce(resolved.contrato_nombre, a.contrato_nombre),
  cliente_nombre_snapshot = coalesce(resolved.cliente_nombre_snapshot, a.cliente_nombre_snapshot),
  cliente_nit_snapshot = coalesce(resolved.cliente_nit_snapshot, a.cliente_nit_snapshot)
from resolved
where a.id = resolved.id;

with resolved as (
  select ess.id, ctx.*
  from public.employee_shift_status ess
  cross join lateral public.resolve_contract_context(ess.sede_codigo, ess.employee_id, null, ess.documento) ctx
)
update public.employee_shift_status ess
set
  contrato_codigo = coalesce(resolved.contrato_codigo, ess.contrato_codigo),
  contrato_nombre = coalesce(resolved.contrato_nombre, ess.contrato_nombre),
  cliente_nombre_snapshot = coalesce(resolved.cliente_nombre_snapshot, ess.cliente_nombre_snapshot),
  cliente_nit_snapshot = coalesce(resolved.cliente_nit_snapshot, ess.cliente_nit_snapshot)
from resolved
where ess.id = resolved.id;

create index if not exists idx_attendance_qr_tokens_fecha_contrato on public.attendance_qr_tokens (fecha, contrato_codigo);
create index if not exists idx_employee_daily_exits_fecha_contrato on public.employee_daily_exits (fecha, contrato_codigo);
create index if not exists idx_attendance_qr_scans_fecha_contrato on public.attendance_qr_scans (fecha, contrato_codigo);
create index if not exists idx_incapacitados_fecha_contrato on public.incapacitados (fecha_inicio, fecha_fin, contrato_codigo);
create index if not exists idx_employee_shift_status_fecha_contrato on public.employee_shift_status (fecha_operativa, contrato_codigo);
create index if not exists idx_employee_certificate_audit_contrato on public.employee_certificate_audit (contrato_codigo, created_at desc);

create or replace function public.can_view_qr_registry()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.estado = 'activo'
      and (
        p.role::text in ('superadmin', 'admin', 'editor', 'consultor')
        or (p.role::text = 'supervisor' and p.supervisor_eligible = true)
      )
  );
$$;

drop policy if exists "attendance_qr_tokens_admin_read" on public.attendance_qr_tokens;
drop policy if exists "attendance_qr_tokens_registry_read" on public.attendance_qr_tokens;
drop policy if exists "attendance_qr_tokens_registry_read" on public.attendance_qr_tokens;
create policy "attendance_qr_tokens_registry_read"
on public.attendance_qr_tokens
for select
to authenticated
using (
  public.can_view_qr_registry()
  and public.can_read_operational_sede_or_employee(sede_codigo, employee_id, documento)
  and (contrato_codigo is null or public.can_read_contract_data(contrato_codigo))
);

drop policy if exists "employee_daily_exits_read_authenticated" on public.employee_daily_exits;
drop policy if exists "employee_daily_exits_read_authenticated" on public.employee_daily_exits;
create policy "employee_daily_exits_read_authenticated"
on public.employee_daily_exits
for select
to authenticated
using (
  public.can_read_operational_sede_or_employee(sede_codigo, employee_id, documento)
  and (contrato_codigo is null or public.can_read_contract_data(contrato_codigo))
);

drop policy if exists "attendance_qr_scans_admin_read" on public.attendance_qr_scans;
drop policy if exists "attendance_qr_scans_read_authenticated" on public.attendance_qr_scans;
drop policy if exists "attendance_qr_scans_read_authenticated" on public.attendance_qr_scans;
create policy "attendance_qr_scans_read_authenticated"
on public.attendance_qr_scans
for select
to authenticated
using (
  public.can_view_qr_registry()
  and (contrato_codigo is null or public.can_read_contract_data(contrato_codigo))
);

drop policy if exists "incapacitados_write_admin" on public.incapacitados;
drop policy if exists "incapacitados_write_active_user" on public.incapacitados;
drop policy if exists "incapacitados_read_authenticated" on public.incapacitados;
drop policy if exists "incapacitados_insert_authenticated" on public.incapacitados;
drop policy if exists "incapacitados_update_authenticated" on public.incapacitados;
drop policy if exists "incapacitados_delete_authenticated" on public.incapacitados;
drop policy if exists "incapacitados_read_authenticated" on public.incapacitados;
create policy "incapacitados_read_authenticated"
on public.incapacitados
for select
to authenticated
using (
  public.can_read_employee_data(employee_id, documento)
  and (contrato_codigo is null or public.can_read_contract_data(contrato_codigo))
);

drop policy if exists "incapacitados_insert_authenticated" on public.incapacitados;
create policy "incapacitados_insert_authenticated"
on public.incapacitados
for insert
to authenticated
with check (
  public.is_active_authenticated_user()
  and public.can_read_employee_data(employee_id, documento)
  and (contrato_codigo is null or public.can_read_contract_data(contrato_codigo))
);

drop policy if exists "incapacitados_update_authenticated" on public.incapacitados;
create policy "incapacitados_update_authenticated"
on public.incapacitados
for update
to authenticated
using (
  public.is_active_authenticated_user()
  and public.can_read_employee_data(employee_id, documento)
  and (contrato_codigo is null or public.can_read_contract_data(contrato_codigo))
)
with check (
  public.is_active_authenticated_user()
  and public.can_read_employee_data(employee_id, documento)
  and (contrato_codigo is null or public.can_read_contract_data(contrato_codigo))
);

drop policy if exists "incapacitados_delete_authenticated" on public.incapacitados;
create policy "incapacitados_delete_authenticated"
on public.incapacitados
for delete
to authenticated
using (
  public.is_active_authenticated_user()
  and public.can_read_employee_data(employee_id, documento)
  and (contrato_codigo is null or public.can_read_contract_data(contrato_codigo))
);

drop policy if exists "employee_certificate_audit_read_admin" on public.employee_certificate_audit;
drop policy if exists "employee_certificate_audit_read_admin" on public.employee_certificate_audit;
create policy "employee_certificate_audit_read_admin"
on public.employee_certificate_audit
for select
to authenticated
using (
  public.current_profile_is_internal_user()
  or (contrato_codigo is not null and public.can_read_contract_data(contrato_codigo))
);

drop policy if exists "employee_shift_status_read_authenticated" on public.employee_shift_status;
drop policy if exists "employee_shift_status_read_authenticated" on public.employee_shift_status;
create policy "employee_shift_status_read_authenticated"
on public.employee_shift_status
for select
to authenticated
using (
  public.current_profile_is_internal_user()
  or (
    public.can_read_operational_sede_or_employee(sede_codigo, employee_id, documento)
    and (contrato_codigo is null or public.can_read_contract_data(contrato_codigo))
  )
);

-- >>>>>>>>>> schema_operations_phase44_contract_final_coverage.sql
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
drop trigger if exists trg_shift_site_plan_assignments_contract_context on public.shift_site_plan_assignments;
create trigger trg_shift_site_plan_assignments_contract_context
before insert or update of sede_codigo, contrato_codigo, contrato_nombre, cliente_nombre_snapshot, cliente_nit_snapshot
on public.shift_site_plan_assignments
for each row execute function public.fill_shift_sede_contract_context();

drop trigger if exists trg_scheduled_shifts_contract_context on public.scheduled_shifts;
drop trigger if exists trg_scheduled_shifts_contract_context on public.scheduled_shifts;
create trigger trg_scheduled_shifts_contract_context
before insert or update of sede_codigo, contrato_codigo, contrato_nombre, cliente_nombre_snapshot, cliente_nit_snapshot
on public.scheduled_shifts
for each row execute function public.fill_shift_sede_contract_context();

drop trigger if exists trg_shift_assignments_contract_context on public.shift_assignments;
drop trigger if exists trg_shift_assignments_contract_context on public.shift_assignments;
create trigger trg_shift_assignments_contract_context
before insert or update of scheduled_shift_id, employee_id, documento, sede_codigo, contrato_codigo, contrato_nombre, cliente_nombre_snapshot, cliente_nit_snapshot
on public.shift_assignments
for each row execute function public.fill_shift_detail_contract_context();

drop trigger if exists trg_employee_shift_status_contract_context on public.employee_shift_status;
drop trigger if exists trg_employee_shift_status_contract_context on public.employee_shift_status;
create trigger trg_employee_shift_status_contract_context
before insert or update of scheduled_shift_id, employee_id, documento, sede_codigo, contrato_codigo, contrato_nombre, cliente_nombre_snapshot, cliente_nit_snapshot
on public.employee_shift_status
for each row execute function public.fill_shift_detail_contract_context();

drop trigger if exists trg_shift_time_authorizations_contract_context on public.shift_time_authorizations;
drop trigger if exists trg_shift_time_authorizations_contract_context on public.shift_time_authorizations;
create trigger trg_shift_time_authorizations_contract_context
before insert or update of scheduled_shift_id, employee_id, documento, contrato_codigo, contrato_nombre, cliente_nombre_snapshot, cliente_nit_snapshot
on public.shift_time_authorizations
for each row execute function public.fill_shift_authorization_contract_context();

drop trigger if exists trg_shift_closures_contract_context on public.shift_closures;
drop trigger if exists trg_shift_closures_contract_context on public.shift_closures;
create trigger trg_shift_closures_contract_context
before insert or update of scheduled_shift_id, sede_codigo, contrato_codigo, contrato_nombre, cliente_nombre_snapshot, cliente_nit_snapshot
on public.shift_closures
for each row execute function public.fill_shift_closure_contract_context();

drop trigger if exists trg_shift_adjustments_contract_context on public.shift_adjustments;
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
drop policy if exists "shift_site_plan_assignments_read_authenticated" on public.shift_site_plan_assignments;
create policy "shift_site_plan_assignments_read_authenticated"
on public.shift_site_plan_assignments
for select
to authenticated
using (public.can_read_shift_contract_data(contrato_codigo, null, sede_codigo, null, null));

drop policy if exists "scheduled_shifts_read_authenticated" on public.scheduled_shifts;
drop policy if exists "scheduled_shifts_read_authenticated" on public.scheduled_shifts;
create policy "scheduled_shifts_read_authenticated"
on public.scheduled_shifts
for select
to authenticated
using (public.can_read_shift_contract_data(contrato_codigo, null, sede_codigo, null, null));

drop policy if exists "shift_assignments_read_authenticated" on public.shift_assignments;
drop policy if exists "shift_assignments_read_authenticated" on public.shift_assignments;
create policy "shift_assignments_read_authenticated"
on public.shift_assignments
for select
to authenticated
using (public.can_read_shift_contract_data(contrato_codigo, scheduled_shift_id, sede_codigo, employee_id, documento));

drop policy if exists "shift_time_authorizations_read_authenticated" on public.shift_time_authorizations;
drop policy if exists "shift_time_authorizations_read_authenticated" on public.shift_time_authorizations;
create policy "shift_time_authorizations_read_authenticated"
on public.shift_time_authorizations
for select
to authenticated
using (public.can_read_shift_contract_data(contrato_codigo, scheduled_shift_id, null, employee_id, documento));

drop policy if exists "employee_shift_status_read_authenticated" on public.employee_shift_status;
drop policy if exists "employee_shift_status_read_authenticated" on public.employee_shift_status;
create policy "employee_shift_status_read_authenticated"
on public.employee_shift_status
for select
to authenticated
using (public.can_read_shift_contract_data(contrato_codigo, scheduled_shift_id, sede_codigo, employee_id, documento));

drop policy if exists "shift_closures_read_authenticated" on public.shift_closures;
drop policy if exists "shift_closures_read_authenticated" on public.shift_closures;
create policy "shift_closures_read_authenticated"
on public.shift_closures
for select
to authenticated
using (public.can_read_shift_contract_data(contrato_codigo, scheduled_shift_id, sede_codigo, null, null));

drop policy if exists "shift_adjustments_read_authenticated" on public.shift_adjustments;
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

-- >>>>>>>>>> schema_operations_phase45_supernumerario_contract_access.sql
-- Phase 45: multi-contract coverage for supernumerarios.
-- Apply after phase 44.

create table if not exists public.supernumerario_contract_access (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id) on delete cascade,
  documento text,
  contrato_codigo text not null references public.contracts(codigo) on update cascade on delete restrict,
  contrato_nombre_snapshot text,
  cliente_nombre_snapshot text,
  cliente_nit_snapshot text,
  estado text not null default 'activo' check (estado in ('activo', 'inactivo')),
  fecha_inicio date,
  fecha_fin date,
  created_by_uid uuid,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, contrato_codigo)
);

alter table public.supernumerario_contract_access enable row level security;

create index if not exists idx_supernumerario_contract_access_employee
  on public.supernumerario_contract_access (employee_id, estado);

create index if not exists idx_supernumerario_contract_access_documento
  on public.supernumerario_contract_access (documento, estado);

create unique index if not exists uq_supernumerario_contract_access_documento_contrato
  on public.supernumerario_contract_access (documento, contrato_codigo)
  where documento is not null;

create index if not exists idx_supernumerario_contract_access_contrato
  on public.supernumerario_contract_access (contrato_codigo, estado);

drop trigger if exists trg_supernumerario_contract_access_updated_at on public.supernumerario_contract_access;
drop trigger if exists trg_supernumerario_contract_access_updated_at on public.supernumerario_contract_access;
create trigger trg_supernumerario_contract_access_updated_at
before update on public.supernumerario_contract_access
for each row execute function public.set_updated_at();

create or replace function public.fill_supernumerario_contract_access_snapshots()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contract record;
  v_employee record;
begin
  if new.employee_id is not null then
    select e.documento into v_employee
    from public.employees e
    where e.id = new.employee_id
    limit 1;
    new.documento = coalesce(nullif(trim(new.documento), ''), v_employee.documento);
  end if;

  select c.codigo, c.nombre, c.cliente_nombre, c.cliente_nit
  into v_contract
  from public.contracts c
  where c.codigo = new.contrato_codigo
  limit 1;

  new.contrato_nombre_snapshot = coalesce(v_contract.nombre, new.contrato_nombre_snapshot);
  new.cliente_nombre_snapshot = coalesce(v_contract.cliente_nombre, new.cliente_nombre_snapshot);
  new.cliente_nit_snapshot = coalesce(v_contract.cliente_nit, new.cliente_nit_snapshot);
  return new;
end;
$$;

drop trigger if exists trg_supernumerario_contract_access_snapshots on public.supernumerario_contract_access;
drop trigger if exists trg_supernumerario_contract_access_snapshots on public.supernumerario_contract_access;
create trigger trg_supernumerario_contract_access_snapshots
before insert or update of employee_id, documento, contrato_codigo, contrato_nombre_snapshot, cliente_nombre_snapshot, cliente_nit_snapshot
on public.supernumerario_contract_access
for each row execute function public.fill_supernumerario_contract_access_snapshots();

create or replace function public.is_supernumerario_employee(
  p_employee_id uuid default null,
  p_documento text default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.employees e
    left join public.cargos c on c.codigo = e.cargo_codigo
    where (
        (p_employee_id is not null and e.id = p_employee_id)
        or (
          nullif(trim(p_documento), '') is not null
          and e.documento = nullif(trim(p_documento), '')
        )
      )
      and (
        lower(coalesce(c.alineacion_crud, '')) = 'supernumerario'
        or lower(coalesce(c.nombre, '')) like '%supernumer%'
        or lower(coalesce(e.cargo_nombre, '')) like '%supernumer%'
      )
  );
$$;

create or replace function public.supernumerario_contract_codes(
  p_employee_id uuid default null,
  p_documento text default null,
  p_fecha date default null
)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  with target as (
    select e.id, e.documento, nullif(trim(e.contrato_codigo), '') as contrato_codigo
    from public.employees e
    where (
        (p_employee_id is not null and e.id = p_employee_id)
        or (
          nullif(trim(p_documento), '') is not null
          and e.documento = nullif(trim(p_documento), '')
        )
      )
    limit 1
  ),
  explicit_codes as (
    select distinct nullif(trim(sca.contrato_codigo), '') as code
    from public.supernumerario_contract_access sca
    join target t on (
      (sca.employee_id is not null and sca.employee_id = t.id)
      or (nullif(trim(sca.documento), '') is not null and sca.documento = t.documento)
    )
    where lower(trim(coalesce(sca.estado, 'activo'))) = 'activo'
      and nullif(trim(sca.contrato_codigo), '') is not null
      and (p_fecha is null or sca.fecha_inicio is null or sca.fecha_inicio <= p_fecha)
      and (p_fecha is null or sca.fecha_fin is null or sca.fecha_fin >= p_fecha)
  ),
  fallback_code as (
    select t.contrato_codigo as code
    from target t
    where t.contrato_codigo is not null
      and not exists (select 1 from explicit_codes)
  )
  select coalesce(array(
    select code
    from (
      select code from explicit_codes
      union
      select code from fallback_code
    ) codes
    where code is not null
    order by code
  ), '{}'::text[]);
$$;

create or replace function public.supernumerario_can_cover_contract(
  p_employee_id uuid default null,
  p_documento text default null,
  p_contrato_codigo text default null,
  p_fecha date default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select nullif(trim(p_contrato_codigo), '') is not null
    and public.is_supernumerario_employee(p_employee_id, p_documento)
    and nullif(trim(p_contrato_codigo), '') = any(public.supernumerario_contract_codes(p_employee_id, p_documento, p_fecha));
$$;

create or replace function public.can_read_supernumerario_data(
  p_employee_id uuid default null,
  p_documento text default null,
  p_fecha date default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_profile_is_internal_user()
    or exists (
      select 1
      from public.employees e
      where (
          (p_employee_id is not null and e.id = p_employee_id)
          or (
            nullif(trim(p_documento), '') is not null
            and e.documento = nullif(trim(p_documento), '')
          )
        )
        and (
          public.current_supervisor_can_read_zone(e.zona_codigo)
          or public.can_read_sede_data(e.sede_codigo)
          or exists (
            select 1
            from unnest(public.supernumerario_contract_codes(e.id, e.documento, p_fecha)) as allowed(code)
            where public.current_profile_has_contract_access(allowed.code)
          )
        )
    );
$$;

create or replace function public.can_read_employee_data(employee_id_value uuid, documento_value text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_profile_is_internal_user()
    or public.can_read_supernumerario_data(employee_id_value, documento_value, null)
    or exists (
      select 1
      from public.employees e
      where (
          (employee_id_value is not null and e.id = employee_id_value)
          or (
            nullif(trim(documento_value), '') is not null
            and e.documento = nullif(trim(documento_value), '')
          )
        )
        and (
          public.current_supervisor_can_read_zone(e.zona_codigo)
          or public.can_read_sede_data(e.sede_codigo)
          or public.current_profile_has_contract_access(e.contrato_codigo)
        )
    );
$$;

do $once$
begin
  if public.rocky_run_once('p45_supernumerario_access_backfill', 'public.supernumerario_contract_access') then
    insert into public.supernumerario_contract_access (
      employee_id,
      documento,
      contrato_codigo,
      contrato_nombre_snapshot,
      cliente_nombre_snapshot,
      cliente_nit_snapshot,
      estado,
      fecha_inicio,
      created_by_uid,
      created_by_email
    )
    select
      e.id,
      e.documento,
      e.contrato_codigo,
      e.contrato_nombre,
      e.cliente_nombre_snapshot,
      e.cliente_nit_snapshot,
      'activo',
      e.fecha_ingreso::date,
      null,
      'migration@system'
    from public.employees e
    left join public.cargos c on c.codigo = e.cargo_codigo
    where nullif(trim(e.contrato_codigo), '') is not null
      and (
        lower(coalesce(c.alineacion_crud, '')) = 'supernumerario'
        or lower(coalesce(c.nombre, '')) like '%supernumer%'
        or lower(coalesce(e.cargo_nombre, '')) like '%supernumer%'
      )
    on conflict (employee_id, contrato_codigo) do update
    set
      documento = excluded.documento,
      contrato_nombre_snapshot = coalesce(excluded.contrato_nombre_snapshot, public.supernumerario_contract_access.contrato_nombre_snapshot),
      cliente_nombre_snapshot = coalesce(excluded.cliente_nombre_snapshot, public.supernumerario_contract_access.cliente_nombre_snapshot),
      cliente_nit_snapshot = coalesce(excluded.cliente_nit_snapshot, public.supernumerario_contract_access.cliente_nit_snapshot),
      updated_at = now();
  end if;
end
$once$;

drop policy if exists "supernumerario_contract_access_select" on public.supernumerario_contract_access;
drop policy if exists "supernumerario_contract_access_select" on public.supernumerario_contract_access;
create policy "supernumerario_contract_access_select"
on public.supernumerario_contract_access
for select
to authenticated
using (
  public.current_profile_is_internal_user()
  or public.can_read_contract_data(contrato_codigo)
  or public.current_supervisor_can_read_zone((
    select e.zona_codigo from public.employees e where e.id = employee_id limit 1
  ))
);

drop policy if exists "supernumerario_contract_access_insert" on public.supernumerario_contract_access;
drop policy if exists "supernumerario_contract_access_insert" on public.supernumerario_contract_access;
create policy "supernumerario_contract_access_insert"
on public.supernumerario_contract_access
for insert
to authenticated
with check (public.current_profile_can_manage_contract_access());

drop policy if exists "supernumerario_contract_access_update" on public.supernumerario_contract_access;
drop policy if exists "supernumerario_contract_access_update" on public.supernumerario_contract_access;
create policy "supernumerario_contract_access_update"
on public.supernumerario_contract_access
for update
to authenticated
using (public.current_profile_can_manage_contract_access())
with check (public.current_profile_can_manage_contract_access());

drop policy if exists "supernumerario_contract_access_delete" on public.supernumerario_contract_access;
drop policy if exists "supernumerario_contract_access_delete" on public.supernumerario_contract_access;
create policy "supernumerario_contract_access_delete"
on public.supernumerario_contract_access
for delete
to authenticated
using (public.current_profile_can_manage_contract_access());

drop policy if exists "employees_read_authenticated" on public.employees;
drop policy if exists "employees_read_authenticated" on public.employees;
create policy "employees_read_authenticated"
on public.employees
for select
to authenticated
using (
  public.current_profile_is_internal_user()
  or public.can_read_sede_data(sede_codigo)
  or public.current_profile_has_contract_access(contrato_codigo)
  or public.can_read_supernumerario_data(id, documento, null)
);

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
  contratos_habilitados text[],
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
    public.supernumerario_contract_codes(e.id, e.documento, null) as contratos_habilitados,
    e.fecha_ingreso::date,
    e.fecha_retiro::date
  from public.employees e
  left join public.cargos c on c.codigo = e.cargo_codigo
  where coalesce(e.estado, 'activo') <> 'inactivo'
    and public.can_read_supernumerario_data(e.id, e.documento, null)
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
  contratos_habilitados text[],
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
    public.supernumerario_contract_codes(e.id, e.documento, params.day) as contratos_habilitados,
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
    and public.can_read_supernumerario_data(e.id, e.documento, params.day)
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

grant execute on function public.is_supernumerario_employee(uuid, text) to authenticated;
grant execute on function public.supernumerario_contract_codes(uuid, text, date) to authenticated;
grant execute on function public.supernumerario_can_cover_contract(uuid, text, text, date) to authenticated;
grant execute on function public.can_read_supernumerario_data(uuid, text, date) to authenticated;
grant execute on function public.can_read_employee_data(uuid, text) to authenticated;
grant execute on function public.list_supernumerarios_for_current_supervisor() to authenticated;
grant execute on function public.list_supernumerarios_for_current_supervisor(text) to authenticated;

-- >>>>>>>>>> schema_operations_phase46_shift_assignment_performance.sql
-- Phase 46: speed up generated shift employee assignment checks.
-- Apply after phase 45.

create index if not exists idx_shift_assignments_employee_estado_shift
  on public.shift_assignments (employee_id, estado, scheduled_shift_id)
  where employee_id is not null;

create index if not exists idx_shift_assignments_documento_estado_shift
  on public.shift_assignments (documento, estado, scheduled_shift_id)
  where documento is not null;

create index if not exists idx_scheduled_shifts_fecha_estado_contrato
  on public.scheduled_shifts (fecha_operativa, estado, contrato_codigo);

-- >>>>>>>>>> schema_operations_phase47_shift_window_defaults.sql
-- Phase 47: update default attendance windows for new shift template rules.

alter table if exists public.shift_template_rules
  alter column ventana_entrada_antes_minutos set default 60,
  alter column ventana_entrada_despues_minutos set default 30,
  alter column ventana_salida_antes_minutos set default 30,
  alter column ventana_salida_despues_minutos set default 60;

-- >>>>>>>>>> schema_operations_phase48_contract_config.sql
-- Phase 48: contract-scoped operational configuration.
-- Apply after phase 47.

create table if not exists public.contract_cargos (
  id uuid primary key default gen_random_uuid(),
  contrato_codigo text not null references public.contracts(codigo) on update cascade on delete restrict,
  contrato_nombre text,
  cliente_nombre_snapshot text,
  cliente_nit_snapshot text,
  cargo_codigo text not null references public.cargos(codigo) on update cascade on delete restrict,
  cargo_nombre_snapshot text,
  salario numeric,
  estado text not null default 'activo' check (estado in ('activo', 'inactivo')),
  created_by_uid uuid references public.profiles(id) on delete set null,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (contrato_codigo, cargo_codigo)
);

alter table public.contract_cargos enable row level security;

drop trigger if exists trg_contract_cargos_updated_at on public.contract_cargos;
drop trigger if exists trg_contract_cargos_updated_at on public.contract_cargos;
create trigger trg_contract_cargos_updated_at
before update on public.contract_cargos
for each row execute function public.set_updated_at();

create or replace function public.fill_contract_cargo_snapshots()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contract record;
  v_cargo record;
begin
  select codigo, nombre, cliente_nombre, cliente_nit
  into v_contract
  from public.contracts
  where codigo = new.contrato_codigo
  limit 1;

  select codigo, nombre
  into v_cargo
  from public.cargos
  where codigo = new.cargo_codigo
  limit 1;

  new.contrato_nombre = coalesce(v_contract.nombre, new.contrato_nombre);
  new.cliente_nombre_snapshot = coalesce(v_contract.cliente_nombre, new.cliente_nombre_snapshot);
  new.cliente_nit_snapshot = coalesce(v_contract.cliente_nit, new.cliente_nit_snapshot);
  new.cargo_nombre_snapshot = coalesce(v_cargo.nombre, new.cargo_nombre_snapshot);
  return new;
end;
$$;

drop trigger if exists trg_contract_cargos_snapshots on public.contract_cargos;
drop trigger if exists trg_contract_cargos_snapshots on public.contract_cargos;
create trigger trg_contract_cargos_snapshots
before insert or update of contrato_codigo, cargo_codigo, contrato_nombre, cliente_nombre_snapshot, cliente_nit_snapshot, cargo_nombre_snapshot
on public.contract_cargos
for each row execute function public.fill_contract_cargo_snapshots();

do $once$
begin
  if public.rocky_run_once('p48_contract_cargos_backfill', 'public.contract_cargos') then
    insert into public.contract_cargos (
      contrato_codigo,
      contrato_nombre,
      cliente_nombre_snapshot,
      cliente_nit_snapshot,
      cargo_codigo,
      cargo_nombre_snapshot,
      salario,
      estado,
      created_by_email
    )
    select
      c.codigo,
      c.nombre,
      c.cliente_nombre,
      c.cliente_nit,
      cg.codigo,
      cg.nombre,
      cg.salario,
      case
        when lower(trim(coalesce(c.estado, 'activo'))) = 'inactivo'
          or lower(trim(coalesce(cg.estado, 'activo'))) = 'inactivo'
        then 'inactivo'
        else 'activo'
      end,
      'schema@system'
    from public.contracts c
    cross join public.cargos cg
    where nullif(trim(c.codigo), '') is not null
      and nullif(trim(cg.codigo), '') is not null
    on conflict (contrato_codigo, cargo_codigo) do nothing;
  end if;
end
$once$;

create index if not exists idx_contract_cargos_contrato_estado
  on public.contract_cargos (contrato_codigo, estado, cargo_codigo);

create index if not exists idx_contract_cargos_cargo
  on public.contract_cargos (cargo_codigo);

drop policy if exists "contract_cargos_read_authenticated" on public.contract_cargos;
drop policy if exists "contract_cargos_read_authenticated" on public.contract_cargos;
create policy "contract_cargos_read_authenticated"
on public.contract_cargos
for select
to authenticated
using (public.can_read_contract_data(contrato_codigo));

drop policy if exists "contract_cargos_write_admin" on public.contract_cargos;
drop policy if exists "contract_cargos_write_admin" on public.contract_cargos;
create policy "contract_cargos_write_admin"
on public.contract_cargos
for all
to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

alter table public.shift_templates
  add column if not exists contrato_codigo text,
  add column if not exists contrato_nombre text,
  add column if not exists cliente_nombre_snapshot text,
  add column if not exists cliente_nit_snapshot text;

alter table public.shift_templates
  drop constraint if exists shift_templates_contrato_codigo_fkey;

do $once$
begin
  if public.rocky_run_once('contracts_initial_seed', 'public.contracts') then
    insert into public.contracts (
      codigo,
      nombre,
      numero_contrato,
      cliente_nombre,
      estado,
      created_by_email
    )
    values (
      'CON-0001',
      'Contrato inicial',
      'CON-0001',
      'Cliente inicial',
      'activo',
      'schema@system'
    )
    on conflict (codigo) do nothing;
  end if;
end
$once$;

update public.shift_templates
set contrato_codigo = 'CON-0001'
where contrato_codigo = 'CONTRATO-INICIAL'
  and exists (
    select 1
    from public.contracts c
    where c.codigo = 'CON-0001'
  );

update public.shift_templates st
set
  contrato_codigo = null,
  contrato_nombre = null,
  cliente_nombre_snapshot = null,
  cliente_nit_snapshot = null
where nullif(trim(st.contrato_codigo), '') is not null
  and not exists (
    select 1
    from public.contracts c
    where c.codigo = st.contrato_codigo
  );

create or replace function public.fill_shift_template_contract_context()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contract record;
begin
  if nullif(trim(coalesce(new.contrato_codigo, '')), '') is null then
    return new;
  end if;

  select codigo, nombre, cliente_nombre, cliente_nit
  into v_contract
  from public.contracts
  where codigo = new.contrato_codigo
  limit 1;

  new.contrato_codigo = coalesce(v_contract.codigo, new.contrato_codigo);
  new.contrato_nombre = coalesce(v_contract.nombre, new.contrato_nombre);
  new.cliente_nombre_snapshot = coalesce(v_contract.cliente_nombre, new.cliente_nombre_snapshot);
  new.cliente_nit_snapshot = coalesce(v_contract.cliente_nit, new.cliente_nit_snapshot);
  return new;
end;
$$;

drop trigger if exists trg_shift_templates_contract_context on public.shift_templates;
drop trigger if exists trg_shift_templates_contract_context on public.shift_templates;
create trigger trg_shift_templates_contract_context
before insert or update of contrato_codigo, contrato_nombre, cliente_nombre_snapshot, cliente_nit_snapshot
on public.shift_templates
for each row execute function public.fill_shift_template_contract_context();

with inferred as (
  select
    st.id,
    coalesce(
      (
        select sspa.contrato_codigo
        from public.shift_site_plan_assignments sspa
        where sspa.template_id = st.id
          and nullif(trim(sspa.contrato_codigo), '') is not null
          and exists (
            select 1
            from public.contracts c
            where c.codigo = sspa.contrato_codigo
          )
        order by sspa.updated_at desc nulls last, sspa.created_at desc nulls last
        limit 1
      ),
      (
        select c.codigo
        from public.contracts c
        where lower(trim(coalesce(c.estado, 'activo'))) <> 'inactivo'
        order by c.fecha_inicio desc nulls last, c.created_at desc nulls last
        limit 1
      )
    ) as contrato_codigo
  from public.shift_templates st
  where st.contrato_codigo is null
)
update public.shift_templates st
set contrato_codigo = inferred.contrato_codigo
from inferred
where st.id = inferred.id
  and inferred.contrato_codigo is not null;

update public.shift_templates st
set
  contrato_nombre = coalesce(st.contrato_nombre, c.nombre),
  cliente_nombre_snapshot = coalesce(st.cliente_nombre_snapshot, c.cliente_nombre),
  cliente_nit_snapshot = coalesce(st.cliente_nit_snapshot, c.cliente_nit)
from public.contracts c
where st.contrato_codigo = c.codigo;

alter table public.shift_templates
  add constraint shift_templates_contrato_codigo_fkey
  foreign key (contrato_codigo)
  references public.contracts(codigo)
  on update cascade
  on delete restrict;

create index if not exists idx_shift_templates_contrato_estado_orden
  on public.shift_templates (contrato_codigo, estado, orden, nombre);

drop policy if exists "shift_templates_read_authenticated" on public.shift_templates;
drop policy if exists "shift_templates_read_authenticated" on public.shift_templates;
create policy "shift_templates_read_authenticated"
on public.shift_templates
for select
to authenticated
using (
  public.current_profile_is_internal_user()
  or public.can_read_contract_data(contrato_codigo)
);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'contract_cargos'
  ) then
    alter publication supabase_realtime add table public.contract_cargos;
  end if;
end $$;

-- >>>>>>>>>> schema_operations_phase49_contract_reference_images.sql
-- Private thumbnails inherit the contract's read access and administrative write access.
begin;

alter table public.contracts add column if not exists reference_image_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('contract-reference-images', 'contract-reference-images', false, 2097152,
  array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists contract_reference_images_read on storage.objects;
drop policy if exists contract_reference_images_read on storage.objects;
create policy contract_reference_images_read on storage.objects for select to authenticated
using (bucket_id = 'contract-reference-images' and exists (
  select 1 from public.contracts c
  where c.id::text = (storage.foldername(name))[1]
));

drop policy if exists contract_reference_images_insert on storage.objects;
drop policy if exists contract_reference_images_insert on storage.objects;
create policy contract_reference_images_insert on storage.objects for insert to authenticated
with check (bucket_id = 'contract-reference-images' and public.is_admin_like() and exists (
  select 1 from public.contracts c
  where c.id::text = (storage.foldername(name))[1]
));

drop policy if exists contract_reference_images_delete on storage.objects;
drop policy if exists contract_reference_images_delete on storage.objects;
create policy contract_reference_images_delete on storage.objects for delete to authenticated
using (bucket_id = 'contract-reference-images' and public.is_admin_like() and exists (
  select 1 from public.contracts c
  where c.id::text = (storage.foldername(name))[1]
    and c.reference_image_path is distinct from name
));

commit;
