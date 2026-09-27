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
create policy "supernumerario_contract_access_insert"
on public.supernumerario_contract_access
for insert
to authenticated
with check (public.current_profile_can_manage_contract_access());

drop policy if exists "supernumerario_contract_access_update" on public.supernumerario_contract_access;
create policy "supernumerario_contract_access_update"
on public.supernumerario_contract_access
for update
to authenticated
using (public.current_profile_can_manage_contract_access())
with check (public.current_profile_can_manage_contract_access());

drop policy if exists "supernumerario_contract_access_delete" on public.supernumerario_contract_access;
create policy "supernumerario_contract_access_delete"
on public.supernumerario_contract_access
for delete
to authenticated
using (public.current_profile_can_manage_contract_access());

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
