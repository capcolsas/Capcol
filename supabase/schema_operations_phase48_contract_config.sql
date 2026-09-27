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
create trigger trg_contract_cargos_snapshots
before insert or update of contrato_codigo, cargo_codigo, contrato_nombre, cliente_nombre_snapshot, cliente_nit_snapshot, cargo_nombre_snapshot
on public.contract_cargos
for each row execute function public.fill_contract_cargo_snapshots();

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

create index if not exists idx_contract_cargos_contrato_estado
  on public.contract_cargos (contrato_codigo, estado, cargo_codigo);

create index if not exists idx_contract_cargos_cargo
  on public.contract_cargos (cargo_codigo);

drop policy if exists "contract_cargos_read_authenticated" on public.contract_cargos;
create policy "contract_cargos_read_authenticated"
on public.contract_cargos
for select
to authenticated
using (public.can_read_contract_data(contrato_codigo));

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
