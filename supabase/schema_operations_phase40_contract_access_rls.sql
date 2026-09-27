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
create policy "profile_contract_access_select"
on public.profile_contract_access
for select
to authenticated
using (public.current_profile_can_manage_contract_access() or user_id = auth.uid());

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
  public.current_profile_is_active_non_supervisor()
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
