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
create trigger trg_contracts_updated_at
before update on public.contracts
for each row execute function public.set_updated_at();

drop policy if exists "contracts_read_authenticated" on public.contracts;
create policy "contracts_read_authenticated"
on public.contracts
for select
to authenticated
using (true);

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
