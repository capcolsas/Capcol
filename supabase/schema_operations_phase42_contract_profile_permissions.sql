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
create trigger trg_profiles_protect_self_service_fields
before insert or update on public.profiles
for each row
execute function public.protect_profile_self_service_fields();

drop policy if exists "profile_contract_access_select" on public.profile_contract_access;
create policy "profile_contract_access_select"
on public.profile_contract_access
for select
to authenticated
using (public.current_profile_is_internal_user() or user_id = auth.uid());

drop policy if exists "profile_contract_access_insert" on public.profile_contract_access;
create policy "profile_contract_access_insert"
on public.profile_contract_access
for insert
to authenticated
with check (public.current_profile_can_manage_contract_access());

drop policy if exists "profile_contract_access_update" on public.profile_contract_access;
create policy "profile_contract_access_update"
on public.profile_contract_access
for update
to authenticated
using (public.current_profile_can_manage_contract_access())
with check (public.current_profile_can_manage_contract_access());

drop policy if exists "profile_contract_access_delete" on public.profile_contract_access;
create policy "profile_contract_access_delete"
on public.profile_contract_access
for delete
to authenticated
using (public.current_profile_can_manage_contract_access());

drop policy if exists "contracts_read_authenticated" on public.contracts;
create policy "contracts_read_authenticated"
on public.contracts
for select
to authenticated
using (public.can_read_contract_data(codigo));

drop policy if exists "dependencies_read_authenticated" on public.dependencies;
create policy "dependencies_read_authenticated"
on public.dependencies
for select
to authenticated
using (public.can_read_dependency_data(codigo));

drop policy if exists "zones_read_authenticated" on public.zones;
create policy "zones_read_authenticated"
on public.zones
for select
to authenticated
using (public.can_read_zone_data(codigo));

drop policy if exists "sedes_read_authenticated" on public.sedes;
create policy "sedes_read_authenticated"
on public.sedes
for select
to authenticated
using (public.can_read_sede_data(codigo));

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
create policy "attendance_read_authenticated"
on public.attendance
for select
to authenticated
using (
  public.can_read_contract_data(contrato_codigo)
  or public.can_read_operational_sede_or_employee(sede_codigo, empleado_id, documento)
);

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
create policy "sede_status_read_authenticated"
on public.sede_status
for select
to authenticated
using (
  public.can_read_contract_data(contrato_codigo)
  or public.can_read_sede_data(sede_codigo)
);

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
create policy "employee_cargo_history_read_authenticated"
on public.employee_cargo_history
for select
to authenticated
using (
  public.can_read_contract_data(contrato_codigo)
  or public.can_read_employee_data(employee_id, documento)
);

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
create policy "daily_contract_metrics_read_authenticated"
on public.daily_contract_metrics
for select
to authenticated
using (public.can_read_contract_data(contrato_codigo));

drop policy if exists "incapacitados_read_authenticated" on public.incapacitados;
create policy "incapacitados_read_authenticated"
on public.incapacitados
for select
to authenticated
using (public.can_read_employee_data(employee_id, documento));

drop policy if exists "import_history_read_authenticated" on public.import_history;
create policy "import_history_read_authenticated"
on public.import_history
for select
to authenticated
using (public.current_profile_is_internal_user());

drop policy if exists "daily_metrics_read_authenticated" on public.daily_metrics;
create policy "daily_metrics_read_authenticated"
on public.daily_metrics
for select
to authenticated
using (public.current_profile_is_internal_user());

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
