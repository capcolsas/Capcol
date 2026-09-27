-- ============================================================
-- Rocky | 01 Base y operacion diaria
-- Generado por supabase/build_release_bundles.mjs. NO editar a mano.
--
-- Idempotente: sirve para un proyecto nuevo y para actualizar uno existente.
-- Ejecutar en orden 01 -> 05 en el editor SQL de Supabase (o con psql).
-- Fuentes incluidas (31):
--   schema_foundation_phase0.sql
--   schema_initial.sql
--   schema_catalogs_phase1.sql
--   schema_operations_phase2.sql
--   schema_operations_phase3.sql
--   schema_whatsapp_phase4.sql
--   schema_constraints_phase5.sql
--   schema_governance_phase6.sql
--   schema_operations_phase6.sql
--   schema_operations_phase7.sql
--   schema_operations_phase8.sql
--   schema_operations_phase9.sql
--   schema_operations_phase10.sql
--   schema_operations_phase11.sql
--   schema_operations_phase12.sql
--   schema_operations_phase13.sql
--   schema_operations_phase14_employee_portal.sql
--   schema_operations_phase15_incapacidades_support.sql
--   schema_operations_phase16_qr_attendance.sql
--   schema_operations_phase17_employee_certificates.sql
--   schema_operations_phase17_tablet_qr_role.sql
--   schema_operations_phase18_supervisor_rls.sql
--   schema_operations_phase19_supernumerario_occupancy.sql
--   schema_operations_phase20_supernumerario_incapacities.sql
--   schema_operations_phase21_admin_permission_rls.sql
--   schema_operations_phase22_report_performance_indexes.sql
--   schema_operations_phase22_supernumerarios_by_date.sql
--   schema_operations_phase23_profile_role_protection.sql
--   schema_operations_phase24_colombia_holiday_july9.sql
--   schema_operations_phase25_employee_extended_info.sql
--   schema_operations_phase26_sede_catalog_reference_sync.sql
-- ============================================================

-- Registro de respaldos de datos de una sola vez. Evita que una re-ejecucion
-- reviva filas que un administrador elimino a proposito.
create table if not exists public.rocky_data_migrations (
  id text primary key,
  applied_at timestamptz not null default now()
);
alter table public.rocky_data_migrations enable row level security;
revoke all on public.rocky_data_migrations from public, anon, authenticated;

-- Devuelve true solo la primera vez y solo si la tabla destino aun esta vacia.
-- Un proyecto que ya tiene datos queda registrado como migrado y no se toca.
create or replace function public.rocky_run_once(p_id text, p_table regclass default null)
returns boolean language plpgsql set search_path = public as $fn$
declare v_empty boolean := true;
begin
  if exists (select 1 from public.rocky_data_migrations where id = p_id) then
    return false;
  end if;
  if p_table is not null then
    execute format('select not exists (select 1 from %s)', p_table) into v_empty;
  end if;
  insert into public.rocky_data_migrations(id) values (p_id) on conflict do nothing;
  return v_empty;
end
$fn$;
revoke all on function public.rocky_run_once(text, regclass) from public, anon, authenticated;

-- >>>>>>>>>> schema_foundation_phase0.sql
-- Base minima para instancias nuevas de Supabase.
-- Varias tablas del proyecto usan gen_random_uuid().
create extension if not exists pgcrypto;

-- >>>>>>>>>> schema_initial.sql
do $$
begin
  create type public.app_role as enum (
    'superadmin',
    'admin',
    'editor',
    'consultor',
    'supervisor',
    'tablet_qr',
    'empleado'
  );
exception
  when duplicate_object then null;
end
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  display_name text,
  documento text,
  role public.app_role not null default 'empleado',
  estado text not null default 'activo',
  zona_codigo text,
  zonas_permitidas text[] not null default '{}',
  supervisor_eligible boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.roles_matrix (
  role public.app_role primary key,
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_overrides (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.roles_matrix enable row level security;
alter table public.user_overrides enable row level security;

create or replace function public.is_admin_like()
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
      and p.role in ('superadmin', 'admin')
      and p.estado = 'activo'
  );
$$;

create or replace function public.is_superadmin()
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
      and p.role = 'superadmin'
      and p.estado = 'activo'
  );
$$;

drop policy if exists "profiles_select_self_or_admin" on public.profiles;
drop policy if exists "profiles_select_self_or_admin" on public.profiles;
create policy "profiles_select_self_or_admin"
on public.profiles
for select
to authenticated
using (
  auth.uid() = id
  or public.is_admin_like()
);

drop policy if exists "profiles_insert_self_or_admin" on public.profiles;
drop policy if exists "profiles_insert_self_or_admin" on public.profiles;
create policy "profiles_insert_self_or_admin"
on public.profiles
for insert
to authenticated
with check (
  auth.uid() = id
  or public.is_admin_like()
);

drop policy if exists "profiles_update_self_or_admin" on public.profiles;
drop policy if exists "profiles_update_self_or_admin" on public.profiles;
create policy "profiles_update_self_or_admin"
on public.profiles
for update
to authenticated
using (
  auth.uid() = id
  or public.is_admin_like()
)
with check (
  auth.uid() = id
  or public.is_admin_like()
);

drop policy if exists "roles_matrix_read_authenticated" on public.roles_matrix;
drop policy if exists "roles_matrix_read_authenticated" on public.roles_matrix;
create policy "roles_matrix_read_authenticated"
on public.roles_matrix
for select
to authenticated
using (true);

drop policy if exists "roles_matrix_write_superadmin" on public.roles_matrix;
drop policy if exists "roles_matrix_write_superadmin" on public.roles_matrix;
create policy "roles_matrix_write_superadmin"
on public.roles_matrix
for all
to authenticated
using (public.is_superadmin())
with check (public.is_superadmin());

drop policy if exists "user_overrides_select_self_or_superadmin" on public.user_overrides;
drop policy if exists "user_overrides_select_self_or_superadmin" on public.user_overrides;
create policy "user_overrides_select_self_or_superadmin"
on public.user_overrides
for select
to authenticated
using (
  user_id = auth.uid()
  or public.is_superadmin()
);

drop policy if exists "user_overrides_write_superadmin" on public.user_overrides;
drop policy if exists "user_overrides_write_superadmin" on public.user_overrides;
create policy "user_overrides_write_superadmin"
on public.user_overrides
for all
to authenticated
using (public.is_superadmin())
with check (public.is_superadmin());

insert into public.roles_matrix (role, permissions)
values
  ('superadmin', '{}'::jsonb),
  ('admin', '{}'::jsonb),
  ('editor', '{}'::jsonb),
  ('consultor', '{}'::jsonb),
  ('supervisor', '{}'::jsonb),
  ('tablet_qr', '{"viewQrScanner": true}'::jsonb),
  ('empleado', '{}'::jsonb)
on conflict (role) do nothing;

-- >>>>>>>>>> schema_catalogs_phase1.sql
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.zones (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  nombre text,
  estado text not null default 'activo',
  created_by_uid uuid references public.profiles(id) on delete set null,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.dependencies (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  nombre text,
  estado text not null default 'activo',
  created_by_uid uuid references public.profiles(id) on delete set null,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sedes (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  nombre text,
  dependencia_codigo text,
  dependencia_nombre text,
  zona_codigo text,
  zona_nombre text,
  numero_operarios integer,
  jornada text not null default 'lun_vie',
  estado text not null default 'activo',
  created_by_uid uuid references public.profiles(id) on delete set null,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cargos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  nombre text,
  salario numeric,
  alineacion_crud text not null default 'empleado',
  estado text not null default 'activo',
  created_by_uid uuid references public.profiles(id) on delete set null,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.cargos
  add column if not exists salario numeric;

create table if not exists public.novedades (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  codigo_novedad text unique,
  nombre text,
  reemplazo text,
  nomina text,
  estado text not null default 'activo',
  created_by_uid uuid references public.profiles(id) on delete set null,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.novedades (
  codigo,
  codigo_novedad,
  nombre,
  reemplazo,
  nomina,
  estado,
  created_by_uid,
  created_by_email
)
values
  ('NOV0001', '1', 'Trabajando', 'no', 'si', 'activo', null, 'schema@system'),
  ('NOV0002', '2', 'Accidente Laboral', 'si', 'si', 'activo', null, 'schema@system'),
  ('NOV0003', '3', 'Enfermedad General', 'si', 'si', 'activo', null, 'schema@system'),
  ('NOV0004', '4', 'Calamidad', 'si', 'si', 'activo', null, 'schema@system'),
  ('NOV0005', '5', 'Licencia No Remunerada', 'si', 'no', 'activo', null, 'schema@system'),
  ('NOV0006', '6', 'Licencia Remunerada', 'si', 'si', 'activo', null, 'schema@system'),
  ('NOV0007', '7', 'Compensatorio', 'no', 'no', 'activo', null, 'schema@system'),
  ('NOV0008', '8', 'Ausencia No Justificada', 'si', 'no', 'activo', null, 'schema@system'),
  ('NOV0009', '9', 'Vacaciones', 'si', 'si', 'activo', null, 'schema@system')
on conflict (codigo_novedad) do update
set
  nombre = excluded.nombre,
  reemplazo = excluded.reemplazo,
  nomina = excluded.nomina,
  estado = excluded.estado,
  updated_at = now();

alter table public.zones enable row level security;
alter table public.dependencies enable row level security;
alter table public.sedes enable row level security;
alter table public.cargos enable row level security;
alter table public.novedades enable row level security;

drop trigger if exists trg_zones_updated_at on public.zones;
drop trigger if exists trg_zones_updated_at on public.zones;
create trigger trg_zones_updated_at
before update on public.zones
for each row execute function public.set_updated_at();

drop trigger if exists trg_dependencies_updated_at on public.dependencies;
drop trigger if exists trg_dependencies_updated_at on public.dependencies;
create trigger trg_dependencies_updated_at
before update on public.dependencies
for each row execute function public.set_updated_at();

drop trigger if exists trg_sedes_updated_at on public.sedes;
drop trigger if exists trg_sedes_updated_at on public.sedes;
create trigger trg_sedes_updated_at
before update on public.sedes
for each row execute function public.set_updated_at();

drop trigger if exists trg_cargos_updated_at on public.cargos;
drop trigger if exists trg_cargos_updated_at on public.cargos;
create trigger trg_cargos_updated_at
before update on public.cargos
for each row execute function public.set_updated_at();

drop trigger if exists trg_novedades_updated_at on public.novedades;
drop trigger if exists trg_novedades_updated_at on public.novedades;
create trigger trg_novedades_updated_at
before update on public.novedades
for each row execute function public.set_updated_at();

drop policy if exists "zones_read_authenticated" on public.zones;
drop policy if exists "zones_read_authenticated" on public.zones;
create policy "zones_read_authenticated"
on public.zones
for select
to authenticated
using (true);

drop policy if exists "zones_write_admin" on public.zones;
drop policy if exists "zones_write_admin" on public.zones;
create policy "zones_write_admin"
on public.zones
for all
to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

drop policy if exists "dependencies_read_authenticated" on public.dependencies;
drop policy if exists "dependencies_read_authenticated" on public.dependencies;
create policy "dependencies_read_authenticated"
on public.dependencies
for select
to authenticated
using (true);

drop policy if exists "dependencies_write_admin" on public.dependencies;
drop policy if exists "dependencies_write_admin" on public.dependencies;
create policy "dependencies_write_admin"
on public.dependencies
for all
to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

drop policy if exists "sedes_read_authenticated" on public.sedes;
drop policy if exists "sedes_read_authenticated" on public.sedes;
create policy "sedes_read_authenticated"
on public.sedes
for select
to authenticated
using (true);

drop policy if exists "sedes_write_admin" on public.sedes;
drop policy if exists "sedes_write_admin" on public.sedes;
create policy "sedes_write_admin"
on public.sedes
for all
to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

drop policy if exists "cargos_read_authenticated" on public.cargos;
drop policy if exists "cargos_read_authenticated" on public.cargos;
create policy "cargos_read_authenticated"
on public.cargos
for select
to authenticated
using (true);

drop policy if exists "cargos_write_admin" on public.cargos;
drop policy if exists "cargos_write_admin" on public.cargos;
create policy "cargos_write_admin"
on public.cargos
for all
to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

drop policy if exists "novedades_read_authenticated" on public.novedades;
drop policy if exists "novedades_read_authenticated" on public.novedades;
create policy "novedades_read_authenticated"
on public.novedades
for select
to authenticated
using (true);

drop policy if exists "novedades_write_admin" on public.novedades;
drop policy if exists "novedades_write_admin" on public.novedades;
create policy "novedades_write_admin"
on public.novedades
for all
to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

-- >>>>>>>>>> schema_operations_phase2.sql
create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  documento text not null unique,
  nombre text,
  telefono text,
  cargo_codigo text,
  cargo_nombre text,
  sede_codigo text,
  sede_nombre text,
  zona_codigo text,
  zona_nombre text,
  fecha_ingreso timestamptz,
  fecha_retiro timestamptz,
  estado text not null default 'activo',
  created_by_uid uuid references public.profiles(id) on delete set null,
  created_by_email text,
  created_at timestamptz not null default now(),
  last_modified_by_uid uuid references public.profiles(id) on delete set null,
  last_modified_by_email text,
  last_modified_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.employee_cargo_history (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  employee_codigo text,
  documento text,
  cargo_codigo text,
  cargo_nombre text,
  fecha_ingreso timestamptz,
  fecha_retiro timestamptz,
  source text,
  created_at timestamptz not null default now()
);

create table if not exists public.supervisor_profile (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id) on delete set null,
  employee_codigo text,
  documento text not null unique,
  nombre text,
  cargo_codigo text,
  cargo_nombre text,
  sede_codigo text,
  zona_codigo text,
  zona_nombre text,
  fecha_ingreso timestamptz,
  fecha_retiro timestamptz,
  estado text not null default 'activo',
  created_by_uid uuid references public.profiles(id) on delete set null,
  created_by_email text,
  created_at timestamptz not null default now(),
  last_modified_by_uid uuid references public.profiles(id) on delete set null,
  last_modified_by_email text,
  last_modified_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.employees enable row level security;
alter table public.employee_cargo_history enable row level security;
alter table public.supervisor_profile enable row level security;

drop trigger if exists trg_employees_updated_at on public.employees;
drop trigger if exists trg_employees_updated_at on public.employees;
create trigger trg_employees_updated_at
before update on public.employees
for each row execute function public.set_updated_at();

drop trigger if exists trg_supervisor_profile_updated_at on public.supervisor_profile;
drop trigger if exists trg_supervisor_profile_updated_at on public.supervisor_profile;
create trigger trg_supervisor_profile_updated_at
before update on public.supervisor_profile
for each row execute function public.set_updated_at();

drop policy if exists "employees_read_authenticated" on public.employees;
drop policy if exists "employees_read_authenticated" on public.employees;
create policy "employees_read_authenticated"
on public.employees
for select
to authenticated
using (true);

drop policy if exists "employees_write_admin" on public.employees;
drop policy if exists "employees_write_admin" on public.employees;
create policy "employees_write_admin"
on public.employees
for all
to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

drop policy if exists "employee_cargo_history_read_authenticated" on public.employee_cargo_history;
drop policy if exists "employee_cargo_history_read_authenticated" on public.employee_cargo_history;
create policy "employee_cargo_history_read_authenticated"
on public.employee_cargo_history
for select
to authenticated
using (true);

drop policy if exists "employee_cargo_history_write_admin" on public.employee_cargo_history;
drop policy if exists "employee_cargo_history_write_admin" on public.employee_cargo_history;
create policy "employee_cargo_history_write_admin"
on public.employee_cargo_history
for all
to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

drop policy if exists "supervisor_profile_read_authenticated" on public.supervisor_profile;
drop policy if exists "supervisor_profile_read_authenticated" on public.supervisor_profile;
create policy "supervisor_profile_read_authenticated"
on public.supervisor_profile
for select
to authenticated
using (true);

drop policy if exists "supervisor_profile_write_admin" on public.supervisor_profile;
drop policy if exists "supervisor_profile_write_admin" on public.supervisor_profile;
create policy "supervisor_profile_write_admin"
on public.supervisor_profile
for all
to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

-- >>>>>>>>>> schema_operations_phase3.sql
create table if not exists public.import_history (
  id uuid primary key default gen_random_uuid(),
  fecha_operacion text,
  ts timestamptz not null default now(),
  source text,
  planned_count integer not null default 0,
  expected_count integer not null default 0,
  found_count integer not null default 0,
  missing_count integer not null default 0,
  extra_count integer not null default 0,
  missing_supervisors_count integer not null default 0,
  missing_supernumerarios_count integer not null default 0,
  missing_docs jsonb not null default '[]'::jsonb,
  extra_docs jsonb not null default '[]'::jsonb,
  missing_supervisors jsonb not null default '[]'::jsonb,
  missing_supernumerarios jsonb not null default '[]'::jsonb,
  errores jsonb not null default '[]'::jsonb,
  confirmado_por_uid uuid references public.profiles(id) on delete set null,
  confirmado_por_email text
);

create table if not exists public.attendance (
  id text primary key,
  fecha text not null,
  empleado_id uuid references public.employees(id) on delete cascade,
  documento text,
  nombre text,
  sede_codigo text,
  sede_nombre text,
  asistio boolean not null default false,
  novedad text,
  created_at timestamptz not null default now()
);

create table if not exists public.absenteeism (
  id text primary key,
  fecha text not null,
  empleado_id uuid references public.employees(id) on delete cascade,
  documento text,
  nombre text,
  sede_codigo text,
  sede_nombre text,
  estado text not null default 'pendiente',
  reemplazo_id uuid references public.employees(id) on delete set null,
  reemplazo_documento text,
  created_at timestamptz not null default now(),
  created_by_uid uuid references public.profiles(id) on delete set null,
  created_by_email text
);

create table if not exists public.sede_status (
  id text primary key,
  fecha text not null,
  sede_codigo text not null,
  sede_nombre text,
  operarios_esperados integer not null default 0,
  operarios_presentes integer not null default 0,
  faltantes integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.import_replacements (
  id text primary key,
  import_id uuid references public.import_history(id) on delete set null,
  fecha_operacion text,
  fecha text not null,
  empleado_id uuid references public.employees(id) on delete cascade,
  documento text,
  nombre text,
  sede_codigo text,
  sede_nombre text,
  novedad_codigo text,
  novedad_nombre text,
  decision text not null default 'ausentismo',
  supernumerario_id uuid references public.employees(id) on delete set null,
  supernumerario_documento text,
  supernumerario_nombre text,
  ts timestamptz not null default now(),
  actor_uid uuid references public.profiles(id) on delete set null,
  actor_email text
);

create table if not exists public.daily_metrics (
  id text primary key,
  fecha text not null unique,
  planned integer not null default 0,
  expected integer not null default 0,
  unique_count integer not null default 0,
  missing integer not null default 0,
  attendance_count integer not null default 0,
  absenteeism integer not null default 0,
  paid_services integer not null default 0,
  no_contracted integer not null default 0,
  closed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.daily_closures (
  id text primary key,
  fecha text not null unique,
  status text not null default 'closed',
  locked boolean not null default true,
  planeados integer not null default 0,
  contratados integer not null default 0,
  asistencias integer not null default 0,
  ausentismos integer not null default 0,
  pagados integer not null default 0,
  no_contratados integer not null default 0,
  closed_by_uid uuid references public.profiles(id) on delete set null,
  closed_by_email text,
  closed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.import_history enable row level security;
alter table public.attendance enable row level security;
alter table public.absenteeism enable row level security;
alter table public.sede_status enable row level security;
alter table public.import_replacements enable row level security;
alter table public.daily_metrics enable row level security;
alter table public.daily_closures enable row level security;

drop trigger if exists trg_daily_metrics_updated_at on public.daily_metrics;
drop trigger if exists trg_daily_metrics_updated_at on public.daily_metrics;
create trigger trg_daily_metrics_updated_at
before update on public.daily_metrics
for each row execute function public.set_updated_at();

drop trigger if exists trg_daily_closures_updated_at on public.daily_closures;
drop trigger if exists trg_daily_closures_updated_at on public.daily_closures;
create trigger trg_daily_closures_updated_at
before update on public.daily_closures
for each row execute function public.set_updated_at();

drop policy if exists "import_history_read_authenticated" on public.import_history;
drop policy if exists "import_history_read_authenticated" on public.import_history;
create policy "import_history_read_authenticated"
on public.import_history
for select
to authenticated
using (true);

drop policy if exists "import_history_write_admin" on public.import_history;
drop policy if exists "import_history_write_admin" on public.import_history;
create policy "import_history_write_admin"
on public.import_history
for all
to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

drop policy if exists "attendance_read_authenticated" on public.attendance;
drop policy if exists "attendance_read_authenticated" on public.attendance;
create policy "attendance_read_authenticated"
on public.attendance
for select
to authenticated
using (true);

drop policy if exists "attendance_write_admin" on public.attendance;
drop policy if exists "attendance_write_admin" on public.attendance;
create policy "attendance_write_admin"
on public.attendance
for all
to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

drop policy if exists "absenteeism_read_authenticated" on public.absenteeism;
drop policy if exists "absenteeism_read_authenticated" on public.absenteeism;
create policy "absenteeism_read_authenticated"
on public.absenteeism
for select
to authenticated
using (true);

drop policy if exists "absenteeism_write_admin" on public.absenteeism;
drop policy if exists "absenteeism_write_admin" on public.absenteeism;
create policy "absenteeism_write_admin"
on public.absenteeism
for all
to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

drop policy if exists "sede_status_read_authenticated" on public.sede_status;
drop policy if exists "sede_status_read_authenticated" on public.sede_status;
create policy "sede_status_read_authenticated"
on public.sede_status
for select
to authenticated
using (true);

drop policy if exists "sede_status_write_admin" on public.sede_status;
drop policy if exists "sede_status_write_admin" on public.sede_status;
create policy "sede_status_write_admin"
on public.sede_status
for all
to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

drop policy if exists "import_replacements_read_authenticated" on public.import_replacements;
drop policy if exists "import_replacements_read_authenticated" on public.import_replacements;
create policy "import_replacements_read_authenticated"
on public.import_replacements
for select
to authenticated
using (true);

drop policy if exists "import_replacements_write_admin" on public.import_replacements;
drop policy if exists "import_replacements_write_admin" on public.import_replacements;
create policy "import_replacements_write_admin"
on public.import_replacements
for all
to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

drop policy if exists "daily_metrics_read_authenticated" on public.daily_metrics;
drop policy if exists "daily_metrics_read_authenticated" on public.daily_metrics;
create policy "daily_metrics_read_authenticated"
on public.daily_metrics
for select
to authenticated
using (true);

drop policy if exists "daily_metrics_write_admin" on public.daily_metrics;
drop policy if exists "daily_metrics_write_admin" on public.daily_metrics;
create policy "daily_metrics_write_admin"
on public.daily_metrics
for all
to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

drop policy if exists "daily_closures_read_authenticated" on public.daily_closures;
drop policy if exists "daily_closures_read_authenticated" on public.daily_closures;
create policy "daily_closures_read_authenticated"
on public.daily_closures
for select
to authenticated
using (true);

drop policy if exists "daily_closures_write_admin" on public.daily_closures;
drop policy if exists "daily_closures_write_admin" on public.daily_closures;
create policy "daily_closures_write_admin"
on public.daily_closures
for all
to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

-- >>>>>>>>>> schema_whatsapp_phase4.sql
create table if not exists public.whatsapp_incoming (
  id text primary key,
  source text not null default 'whatsapp_cloud_api',
  event_type text not null default 'message',
  message_id text,
  wa_from text,
  wa_timestamp text,
  wa_type text,
  text_body text,
  phone_number_id text,
  display_phone_number text,
  raw_payload jsonb not null default '{}'::jsonb,
  process_status text not null default 'pending',
  process_reason text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create table if not exists public.whatsapp_sessions (
  id text primary key,
  phone_number text,
  employee_id uuid references public.employees(id) on delete set null,
  documento text,
  session_state text not null default 'idle',
  session_data jsonb not null default '{}'::jsonb,
  last_message_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.incapacitados (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id) on delete set null,
  documento text,
  nombre text,
  fecha_inicio date,
  fecha_fin date,
  estado text not null default 'activo',
  source text,
  whatsapp_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.whatsapp_incoming enable row level security;
alter table public.whatsapp_sessions enable row level security;
alter table public.incapacitados enable row level security;

drop trigger if exists trg_whatsapp_sessions_updated_at on public.whatsapp_sessions;
drop trigger if exists trg_whatsapp_sessions_updated_at on public.whatsapp_sessions;
create trigger trg_whatsapp_sessions_updated_at
before update on public.whatsapp_sessions
for each row execute function public.set_updated_at();

drop trigger if exists trg_incapacitados_updated_at on public.incapacitados;
drop trigger if exists trg_incapacitados_updated_at on public.incapacitados;
create trigger trg_incapacitados_updated_at
before update on public.incapacitados
for each row execute function public.set_updated_at();

drop policy if exists "whatsapp_incoming_service_only" on public.whatsapp_incoming;
drop policy if exists "whatsapp_incoming_service_only" on public.whatsapp_incoming;
create policy "whatsapp_incoming_service_only"
on public.whatsapp_incoming
for all
to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

drop policy if exists "whatsapp_sessions_service_only" on public.whatsapp_sessions;
drop policy if exists "whatsapp_sessions_service_only" on public.whatsapp_sessions;
create policy "whatsapp_sessions_service_only"
on public.whatsapp_sessions
for all
to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

drop policy if exists "incapacitados_read_authenticated" on public.incapacitados;
drop policy if exists "incapacitados_read_authenticated" on public.incapacitados;
create policy "incapacitados_read_authenticated"
on public.incapacitados
for select
to authenticated
using (true);

drop policy if exists "incapacitados_write_admin" on public.incapacitados;
drop policy if exists "incapacitados_write_admin" on public.incapacitados;
create policy "incapacitados_write_admin"
on public.incapacitados
for all
to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

-- >>>>>>>>>> schema_constraints_phase5.sql
create unique index if not exists attendance_unique_fecha_documento
on public.attendance (fecha, documento)
where documento is not null;

create unique index if not exists absenteeism_unique_fecha_documento
on public.absenteeism (fecha, documento)
where documento is not null;

create unique index if not exists import_replacements_unique_fecha_documento
on public.import_replacements (fecha, documento)
where documento is not null;

-- >>>>>>>>>> schema_governance_phase6.sql
alter table public.profiles
  add column if not exists created_by_uid uuid references public.profiles(id) on delete set null,
  add column if not exists created_by_email text,
  add column if not exists last_modified_by_uid uuid references public.profiles(id) on delete set null,
  add column if not exists last_modified_by_email text,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_uid uuid references public.profiles(id) on delete set null,
  add column if not exists deleted_by_email text;

alter table public.profiles
  alter column role set default 'empleado';

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_uid uuid references public.profiles(id) on delete set null,
  actor_email text,
  target_type text,
  target_id text,
  action text not null,
  before_data jsonb,
  after_data jsonb,
  note text,
  created_at timestamptz not null default now()
);

alter table public.audit_logs enable row level security;

create or replace function public.is_admin_like()
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
      and p.role in ('superadmin', 'admin')
      and p.estado = 'activo'
  );
$$;

create or replace function public.is_superadmin()
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
      and p.role = 'superadmin'
      and p.estado = 'activo'
  );
$$;

create or replace function public.is_active_authenticated_user()
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
  );
$$;

drop policy if exists "audit_logs_read_admin_like" on public.audit_logs;
drop policy if exists "audit_logs_read_admin_like" on public.audit_logs;
create policy "audit_logs_read_admin_like"
on public.audit_logs
for select
to authenticated
using (public.is_admin_like());

drop policy if exists "audit_logs_insert_active_user" on public.audit_logs;
drop policy if exists "audit_logs_insert_active_user" on public.audit_logs;
create policy "audit_logs_insert_active_user"
on public.audit_logs
for insert
to authenticated
with check (public.is_active_authenticated_user());

-- >>>>>>>>>> schema_operations_phase6.sql
alter table public.daily_closures
  add column if not exists asistencias integer not null default 0;

do $legacy$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'daily_closures' and column_name = 'pagados') then
    execute 'update public.daily_closures set asistencias = coalesce(nullif(asistencias, 0), pagados, 0) where coalesce(asistencias, 0) = 0';
  end if;
end
$legacy$;

alter table public.daily_closures
  drop column if exists pagados;

-- >>>>>>>>>> schema_operations_phase7.sql
alter table public.employee_cargo_history
  add column if not exists sede_codigo text,
  add column if not exists sede_nombre text;

-- >>>>>>>>>> schema_operations_phase8.sql
alter table public.daily_closures
  add column if not exists faltan integer not null default 0,
  add column if not exists sobran integer not null default 0;

-- >>>>>>>>>> schema_operations_phase9.sql
create table if not exists public.daily_sede_closures (
  id text primary key,
  fecha text not null,
  sede_codigo text not null,
  sede_nombre text,
  zona_codigo text,
  zona_nombre text,
  dependencia_codigo text,
  dependencia_nombre text,
  planeados integer not null default 0,
  contratados integer not null default 0,
  registrados integer not null default 0,
  faltantes integer not null default 0,
  sobrantes integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (fecha, sede_codigo)
);

alter table public.daily_sede_closures enable row level security;

drop trigger if exists trg_daily_sede_closures_updated_at on public.daily_sede_closures;
drop trigger if exists trg_daily_sede_closures_updated_at on public.daily_sede_closures;
create trigger trg_daily_sede_closures_updated_at
before update on public.daily_sede_closures
for each row execute function public.set_updated_at();

drop policy if exists "daily_sede_closures_read_authenticated" on public.daily_sede_closures;
drop policy if exists "daily_sede_closures_read_authenticated" on public.daily_sede_closures;
create policy "daily_sede_closures_read_authenticated"
on public.daily_sede_closures
for select
to authenticated
using (true);

drop policy if exists "daily_sede_closures_write_admin" on public.daily_sede_closures;
drop policy if exists "daily_sede_closures_write_admin" on public.daily_sede_closures;
create policy "daily_sede_closures_write_admin"
on public.daily_sede_closures
for all
to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

-- >>>>>>>>>> schema_operations_phase10.sql
create table if not exists public.employee_daily_status (
  id text primary key,
  fecha text not null,
  employee_id text not null,
  documento text,
  nombre text,
  tipo_personal text not null check (tipo_personal in ('empleado', 'supernumerario')),
  sede_codigo text,
  sede_nombre_snapshot text,
  zona_codigo_snapshot text,
  zona_nombre_snapshot text,
  dependencia_codigo_snapshot text,
  dependencia_nombre_snapshot text,
  estado_dia text not null check (estado_dia in (
    'trabajado',
    'trabajado_reemplazo',
    'ausente_con_novedad',
    'ausente_sin_reemplazo',
    'incapacidad',
    'vacaciones',
    'compensatorio',
    'sin_registro',
    'no_programado'
  )),
  asistio boolean not null default false,
  novedad_codigo text,
  novedad_nombre text,
  requiere_reemplazo boolean not null default false,
  decision_cobertura text not null default 'no_aplica' check (decision_cobertura in ('no_aplica', 'pendiente', 'reemplazo', 'ausentismo')),
  reemplaza_a_employee_id text,
  reemplaza_a_documento text,
  reemplaza_a_nombre text,
  reemplazado_por_employee_id text,
  reemplazado_por_documento text,
  reemplazado_por_nombre text,
  servicio_programado boolean not null default false,
  servicio_cubierto boolean not null default false,
  cuenta_pago_servicio boolean not null default false,
  cuenta_nomina boolean not null default true,
  paga_nomina boolean,
  motivo_nomina text,
  source_attendance_id text,
  source_replacement_id text,
  source_absenteeism_id text,
  source_incapacity_id text,
  origen text not null default 'manual',
  closed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (fecha, employee_id),
  constraint employee_daily_status_supernumerario_service_check
    check (not (tipo_personal = 'supernumerario' and cuenta_pago_servicio = true))
);

create index if not exists idx_employee_daily_status_fecha on public.employee_daily_status (fecha);
create index if not exists idx_employee_daily_status_fecha_sede on public.employee_daily_status (fecha, sede_codigo);
create index if not exists idx_employee_daily_status_fecha_tipo on public.employee_daily_status (fecha, tipo_personal);
create index if not exists idx_employee_daily_status_fecha_estado on public.employee_daily_status (fecha, estado_dia);
create index if not exists idx_employee_daily_status_fecha_closed on public.employee_daily_status (fecha, closed);

alter table public.employee_daily_status enable row level security;

drop trigger if exists trg_employee_daily_status_updated_at on public.employee_daily_status;
drop trigger if exists trg_employee_daily_status_updated_at on public.employee_daily_status;
create trigger trg_employee_daily_status_updated_at
before update on public.employee_daily_status
for each row execute function public.set_updated_at();

drop policy if exists "employee_daily_status_read_authenticated" on public.employee_daily_status;
drop policy if exists "employee_daily_status_read_authenticated" on public.employee_daily_status;
create policy "employee_daily_status_read_authenticated"
on public.employee_daily_status
for select
to authenticated
using (true);

drop policy if exists "employee_daily_status_write_admin" on public.employee_daily_status;
drop policy if exists "employee_daily_status_write_admin" on public.employee_daily_status;
create policy "employee_daily_status_write_admin"
on public.employee_daily_status
for all
to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

-- >>>>>>>>>> schema_operations_phase11.sql
create or replace function public.bool_from_text_nullable(value text)
returns boolean
language sql
immutable
as $$
  select case
    when value is null then null
    when lower(trim(value)) in ('si', 'yes', 'true', '1', 'paga', 'pago', 'remunerado', 'liquida') then true
    when lower(trim(value)) in ('no', 'false', '0', 'no_paga', 'nopaga', 'no pago', 'sin pago', 'no remunerado') then false
    else null
  end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'employee_cargo_history_valid_date_range'
      and conrelid = 'public.employee_cargo_history'::regclass
  ) then
    alter table public.employee_cargo_history
      add constraint employee_cargo_history_valid_date_range
      check (
        fecha_ingreso is null
        or fecha_retiro is null
        or fecha_ingreso::date <= fecha_retiro::date
      ) not valid;
  end if;
end $$;

create or replace function public.bool_from_text_truthy(value text)
returns boolean
language sql
immutable
as $$
  select coalesce(public.bool_from_text_nullable(value), false);
$$;

create or replace function public.easter_sunday_sql(p_year integer)
returns date
language plpgsql
immutable
as $$
declare
  a integer;
  b integer;
  c integer;
  d integer;
  e integer;
  f integer;
  g integer;
  h integer;
  i integer;
  k integer;
  l integer;
  m integer;
  v_month integer;
  v_day integer;
begin
  a := p_year % 19;
  b := floor(p_year / 100);
  c := p_year % 100;
  d := floor(b / 4);
  e := b % 4;
  f := floor((b + 8) / 25);
  g := floor((b - f + 1) / 3);
  h := (19 * a + b - d - g + 15) % 30;
  i := floor(c / 4);
  k := c % 4;
  l := (32 + 2 * e + 2 * i - h - k) % 7;
  m := floor((a + 11 * h + 22 * l) / 451);
  v_month := floor((h + l - 7 * m + 114) / 31);
  v_day := ((h + l - 7 * m + 114) % 31) + 1;
  return make_date(p_year, v_month, v_day);
end;
$$;

create or replace function public.move_to_following_monday_sql(p_fecha date)
returns date
language sql
immutable
as $$
  select case
    when p_fecha is null then null
    when extract(isodow from p_fecha)::integer = 1 then p_fecha
    else p_fecha + (8 - extract(isodow from p_fecha)::integer)
  end;
$$;

create or replace function public.is_colombia_holiday_sql(fecha text)
returns boolean
language plpgsql
immutable
as $$
declare
  v_fecha date;
  v_year integer;
  v_easter date;
begin
  if fecha is null or fecha !~ '^\d{4}-\d{2}-\d{2}$' then
    return false;
  end if;

  v_fecha := fecha::date;
  v_year := extract(year from v_fecha);
  v_easter := public.easter_sunday_sql(v_year);

  return v_fecha in (
    make_date(v_year, 1, 1),
    make_date(v_year, 5, 1),
    make_date(v_year, 7, 20),
    make_date(v_year, 8, 7),
    make_date(v_year, 12, 8),
    make_date(v_year, 12, 25),
    public.move_to_following_monday_sql(make_date(v_year, 1, 6)),
    public.move_to_following_monday_sql(make_date(v_year, 3, 19)),
    public.move_to_following_monday_sql(make_date(v_year, 6, 29)),
    public.move_to_following_monday_sql(make_date(v_year, 7, 9)),
    public.move_to_following_monday_sql(make_date(v_year, 8, 15)),
    public.move_to_following_monday_sql(make_date(v_year, 10, 12)),
    public.move_to_following_monday_sql(make_date(v_year, 11, 1)),
    public.move_to_following_monday_sql(make_date(v_year, 11, 11)),
    v_easter - 3,
    v_easter - 2,
    public.move_to_following_monday_sql(v_easter + 39),
    public.move_to_following_monday_sql(v_easter + 60),
    public.move_to_following_monday_sql(v_easter + 68)
  );
end;
$$;

create or replace function public.is_sede_scheduled_for_date_sql(jornada text, fecha text)
returns boolean
language plpgsql
immutable
as $$
declare
  v_fecha date;
  v_weekday integer;
  v_jornada text;
begin
  if fecha is null or fecha !~ '^\d{4}-\d{2}-\d{2}$' then
    return false;
  end if;
  v_fecha := fecha::date;
  v_weekday := extract(dow from v_fecha);
  v_jornada := lower(trim(coalesce(jornada, 'lun_vie')));

  if v_jornada = 'lun_dom' then
    return true;
  end if;

  if public.is_colombia_holiday_sql(fecha) then
    return false;
  end if;

  if v_jornada = 'lun_sab' then
    return v_weekday between 1 and 6;
  end if;

  return v_weekday between 1 and 5;
end;
$$;

create or replace function public.is_employee_effective_for_date_sql(
  estado text,
  fecha_ingreso timestamptz,
  fecha_retiro timestamptz,
  fecha text
)
returns boolean
language plpgsql
immutable
as $$
declare
  v_fecha date;
  v_ingreso date;
  v_retiro date;
  v_estado text;
begin
  if fecha is null or fecha !~ '^\d{4}-\d{2}-\d{2}$' then
    return false;
  end if;

  v_fecha := fecha::date;
  v_ingreso := fecha_ingreso::date;
  v_retiro := fecha_retiro::date;
  v_estado := lower(trim(coalesce(estado, 'activo')));

  if v_ingreso is null or v_ingreso > v_fecha then
    return false;
  end if;

  if v_retiro is not null and v_retiro < v_fecha then
    return false;
  end if;

  if v_estado = 'inactivo' then
    return v_retiro is not null and v_retiro >= v_fecha;
  end if;

  return v_estado <> 'eliminado';
end;
$$;

create or replace function public.refresh_employee_daily_status(p_fecha text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer := 0;
begin
  if p_fecha is null or p_fecha !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Fecha invalida para employee_daily_status: %', p_fecha;
  end if;

  if exists (
    select 1
    from public.daily_closures dc
    where dc.fecha = p_fecha
      and (dc.locked = true or lower(trim(coalesce(dc.status, ''))) = 'closed')
  ) then
    select count(*)::integer
    into v_rows
    from public.employee_daily_status
    where fecha = p_fecha;
    return v_rows;
  end if;

  delete from public.employee_daily_status where fecha = p_fecha;

  with active_sedes as (
    select s.*
    from public.sedes s
    where lower(trim(coalesce(s.estado, 'activo'))) <> 'inactivo'
      and public.is_sede_scheduled_for_date_sql(s.jornada, p_fecha)
  ),
  sedes_lookup as (
    select s.*
    from public.sedes s
  ),
  cargos_lookup as (
    select
      c.codigo,
      c.nombre,
      lower(trim(coalesce(c.alineacion_crud, 'empleado'))) as alineacion_crud
    from public.cargos c
  ),
  assignment_history_effective as (
    select *
    from (
      select
        h.*,
        row_number() over (
          partition by h.employee_id
          order by h.fecha_ingreso desc nulls last, h.created_at desc nulls last, h.id desc
        ) as rn
      from public.employee_cargo_history h
      where (h.fecha_ingreso is null or h.fecha_ingreso::date <= p_fecha::date)
        and (h.fecha_retiro is null or h.fecha_retiro::date >= p_fecha::date)
    ) x
    where x.rn = 1
  ),
  employees_catalog as (
    select
      e.id::text as employee_id,
      e.id as employee_uuid,
      e.codigo,
      e.documento,
      e.nombre,
      coalesce(ahe.cargo_codigo, e.cargo_codigo) as cargo_codigo,
      coalesce(ahe.cargo_nombre, e.cargo_nombre) as cargo_nombre,
      coalesce(ahe.sede_codigo, e.sede_codigo) as home_sede_codigo,
      coalesce(ahe.sede_nombre, e.sede_nombre) as home_sede_nombre,
      e.zona_codigo as home_zona_codigo,
      e.zona_nombre as home_zona_nombre,
      coalesce(ahe.fecha_ingreso, e.fecha_ingreso) as fecha_ingreso,
      coalesce(ahe.fecha_retiro, e.fecha_retiro) as fecha_retiro,
      lower(trim(coalesce(e.estado, 'activo'))) as estado_empleado,
      case
        when coalesce(cl_effective.alineacion_crud, cl_base.alineacion_crud, '') = 'supernumerario' then 'supernumerario'
        when lower(coalesce(ahe.cargo_nombre, e.cargo_nombre, '')) like '%supernumerar%' then 'supernumerario'
        else 'empleado'
      end as tipo_personal
    from public.employees e
    left join assignment_history_effective ahe on ahe.employee_id = e.id
    left join cargos_lookup cl_base on cl_base.codigo = e.cargo_codigo
    left join cargos_lookup cl_effective on cl_effective.codigo = coalesce(ahe.cargo_codigo, e.cargo_codigo)
  ),
  expected_base as (
    select
      ec.employee_id,
      ec.employee_uuid,
      ec.documento,
      ec.nombre,
      ec.cargo_codigo,
      ec.cargo_nombre,
      ec.tipo_personal,
      s.codigo as sede_codigo,
      coalesce(s.nombre, ec.home_sede_nombre) as sede_nombre_snapshot,
      s.zona_codigo as zona_codigo_snapshot,
      s.zona_nombre as zona_nombre_snapshot,
      s.dependencia_codigo as dependencia_codigo_snapshot,
      s.dependencia_nombre as dependencia_nombre_snapshot,
      true as servicio_programado
    from employees_catalog ec
    join active_sedes s on s.codigo = ec.home_sede_codigo
    where ec.tipo_personal = 'empleado'
      and public.is_employee_effective_for_date_sql(ec.estado_empleado, ec.fecha_ingreso, ec.fecha_retiro, p_fecha)
  ),
  attendance_day as (
    select *
    from (
      select
        a.*,
        row_number() over (
          partition by coalesce(a.empleado_id::text, a.documento, a.id)
          order by a.created_at desc nulls last, a.id desc
        ) as rn
      from public.attendance a
      where a.fecha = p_fecha
    ) x
    where x.rn = 1
  ),
  replacements_by_employee as (
    select *
    from (
      select
        r.*,
        row_number() over (
          partition by coalesce(r.empleado_id::text, r.documento, r.id)
          order by r.ts desc nulls last, r.id desc
        ) as rn
      from public.import_replacements r
      where r.fecha = p_fecha
    ) x
    where x.rn = 1
  ),
  replacements_by_supernumerario as (
    select *
    from (
      select
        r.*,
        row_number() over (
          partition by coalesce(r.supernumerario_id::text, r.supernumerario_documento, r.id)
          order by r.ts desc nulls last, r.id desc
        ) as rn
      from public.import_replacements r
      where r.fecha = p_fecha
        and coalesce(r.supernumerario_id::text, r.supernumerario_documento, '') <> ''
    ) x
    where x.rn = 1
  ),
  absenteeism_day as (
    select *
    from (
      select
        ab.*,
        row_number() over (
          partition by coalesce(ab.empleado_id::text, ab.documento, ab.id)
          order by ab.created_at desc nulls last, ab.id desc
        ) as rn
      from public.absenteeism ab
      where ab.fecha = p_fecha
    ) x
    where x.rn = 1
  ),
  incapacity_day as (
    select *
    from (
      select
        i.*,
        row_number() over (
          partition by coalesce(i.employee_id::text, i.documento, i.id::text)
          order by i.updated_at desc nulls last, i.created_at desc nulls last, i.id desc
        ) as rn
      from public.incapacitados i
      where lower(trim(coalesce(i.estado, 'activo'))) = 'activo'
        and p_fecha::date between i.fecha_inicio and i.fecha_fin
    ) x
    where x.rn = 1
  ),
  employee_activity_scope as (
    select distinct
      ec.employee_id,
      ec.employee_uuid,
      ec.documento,
      ec.nombre,
      ec.cargo_codigo,
      ec.cargo_nombre,
      ec.tipo_personal,
      ec.home_sede_codigo as sede_codigo,
      coalesce(sl.nombre, ec.home_sede_nombre) as sede_nombre_snapshot,
      sl.zona_codigo as zona_codigo_snapshot,
      sl.zona_nombre as zona_nombre_snapshot,
      sl.dependencia_codigo as dependencia_codigo_snapshot,
      sl.dependencia_nombre as dependencia_nombre_snapshot,
      false as servicio_programado
    from employees_catalog ec
    left join sedes_lookup sl on sl.codigo = ec.home_sede_codigo
    where ec.tipo_personal = 'empleado'
      and not exists (
        select 1 from expected_base eb where eb.employee_id = ec.employee_id
      )
      and (
        exists (
          select 1
          from attendance_day a
          where a.empleado_id::text = ec.employee_id
             or (a.empleado_id is null and a.documento = ec.documento)
        )
        or exists (
          select 1
          from replacements_by_employee r
          where r.empleado_id::text = ec.employee_id
             or (r.empleado_id is null and r.documento = ec.documento)
        )
        or exists (
          select 1
          from incapacity_day i
          where i.employee_id::text = ec.employee_id
             or (i.employee_id is null and i.documento = ec.documento)
        )
      )
  ),
  supernumerario_scope as (
    select distinct
      ec.employee_id,
      ec.employee_uuid,
      ec.documento,
      ec.nombre,
      ec.cargo_codigo,
      ec.cargo_nombre,
      ec.tipo_personal,
      ec.home_sede_codigo as sede_codigo,
      coalesce(sl.nombre, ec.home_sede_nombre) as sede_nombre_snapshot,
      sl.zona_codigo as zona_codigo_snapshot,
      sl.zona_nombre as zona_nombre_snapshot,
      sl.dependencia_codigo as dependencia_codigo_snapshot,
      sl.dependencia_nombre as dependencia_nombre_snapshot,
      false as servicio_programado
    from employees_catalog ec
    left join sedes_lookup sl on sl.codigo = ec.home_sede_codigo
    where ec.tipo_personal = 'supernumerario'
      and (
        exists (
          select 1
          from attendance_day a
          where a.empleado_id::text = ec.employee_id
             or (a.empleado_id is null and a.documento = ec.documento)
        )
        or exists (
          select 1
          from replacements_by_supernumerario r
          where r.supernumerario_id::text = ec.employee_id
             or (r.supernumerario_id is null and r.supernumerario_documento = ec.documento)
        )
        or exists (
          select 1
          from incapacity_day i
          where i.employee_id::text = ec.employee_id
             or (i.employee_id is null and i.documento = ec.documento)
        )
      )
  ),
  people_day as (
    select * from expected_base
    union all
    select * from employee_activity_scope
    union all
    select * from supernumerario_scope
  ),
  resolved_rows as (
    select
      pd.employee_id,
      pd.documento,
      pd.nombre,
      pd.cargo_codigo,
      pd.cargo_nombre,
      pd.tipo_personal,
      coalesce(rep_sup.sede_codigo, rep_emp.sede_codigo, att.sede_codigo, pd.sede_codigo) as effective_sede_codigo,
      coalesce(rep_sup.sede_nombre, rep_emp.sede_nombre, att.sede_nombre, pd.sede_nombre_snapshot) as effective_sede_nombre,
      pd.zona_codigo_snapshot as default_zona_codigo_snapshot,
      pd.zona_nombre_snapshot as default_zona_nombre_snapshot,
      pd.dependencia_codigo_snapshot as default_dependencia_codigo_snapshot,
      pd.dependencia_nombre_snapshot as default_dependencia_nombre_snapshot,
      pd.servicio_programado,
      att.id as attendance_id,
      att.asistio,
      att.novedad as attendance_novedad,
      rep_emp.id as replacement_employee_id,
      rep_emp.novedad_codigo as replacement_novedad_codigo,
      rep_emp.novedad_nombre as replacement_novedad_nombre,
      lower(trim(coalesce(rep_emp.decision, ''))) as replacement_employee_decision,
      rep_emp.supernumerario_id::text as reemplazado_por_employee_id,
      rep_emp.supernumerario_documento as reemplazado_por_documento,
      rep_emp.supernumerario_nombre as reemplazado_por_nombre,
      rep_sup.id as replacement_super_id,
      rep_sup.empleado_id::text as reemplaza_a_employee_id,
      rep_sup.documento as reemplaza_a_documento,
      rep_sup.nombre as reemplaza_a_nombre,
      absd.id as absenteeism_id,
      incap.id::text as incapacity_id,
      incap.source as incapacity_source,
      dc.locked as day_locked,
      dc.status as day_status,
      nav_att.codigo as nav_att_codigo,
      nav_att.codigo_novedad as nav_att_codigo_novedad,
      nav_att.nombre as nav_att_nombre,
      nav_att.reemplazo as nav_att_reemplazo,
      nav_att.nomina as nav_att_nomina,
      nav_rep.codigo as nav_rep_codigo,
      nav_rep.codigo_novedad as nav_rep_codigo_novedad,
      nav_rep.nombre as nav_rep_nombre,
      nav_rep.reemplazo as nav_rep_reemplazo,
      nav_rep.nomina as nav_rep_nomina,
      nav_incap.codigo as nav_incap_codigo,
      nav_incap.codigo_novedad as nav_incap_codigo_novedad,
      nav_incap.nombre as nav_incap_nombre,
      nav_incap.reemplazo as nav_incap_reemplazo,
      nav_incap.nomina as nav_incap_nomina,
      rep_emp.actor_email as replacement_employee_actor_email,
      rep_sup.actor_email as replacement_super_actor_email
    from people_day pd
    left join attendance_day att
      on att.empleado_id::text = pd.employee_id
      or (att.empleado_id is null and att.documento = pd.documento)
    left join replacements_by_employee rep_emp
      on rep_emp.empleado_id::text = pd.employee_id
      or (rep_emp.empleado_id is null and rep_emp.documento = pd.documento)
    left join replacements_by_supernumerario rep_sup
      on rep_sup.supernumerario_id::text = pd.employee_id
      or (rep_sup.supernumerario_id is null and rep_sup.supernumerario_documento = pd.documento)
    left join absenteeism_day absd
      on absd.empleado_id::text = pd.employee_id
      or (absd.empleado_id is null and absd.documento = pd.documento)
    left join incapacity_day incap
      on incap.employee_id::text = pd.employee_id
      or (incap.employee_id is null and incap.documento = pd.documento)
    left join public.daily_closures dc
      on dc.fecha = p_fecha
    left join lateral (
      select n.*
      from public.novedades n
      where (
        att.novedad ~ '^\d+$' and trim(coalesce(n.codigo_novedad, n.codigo, '')) = trim(att.novedad)
      ) or (
        lower(trim(coalesce(n.nombre, ''))) = lower(trim(coalesce(att.novedad, '')))
      )
      order by case when att.novedad ~ '^\d+$' and trim(coalesce(n.codigo_novedad, n.codigo, '')) = trim(att.novedad) then 0 else 1 end
      limit 1
    ) nav_att on true
    left join lateral (
      select n.*
      from public.novedades n
      where (
        trim(coalesce(n.codigo_novedad, n.codigo, '')) = trim(coalesce(rep_emp.novedad_codigo, ''))
      ) or (
        lower(trim(coalesce(n.nombre, ''))) = lower(trim(coalesce(rep_emp.novedad_nombre, '')))
      )
      order by case when trim(coalesce(n.codigo_novedad, n.codigo, '')) = trim(coalesce(rep_emp.novedad_codigo, '')) then 0 else 1 end
      limit 1
    ) nav_rep on true
    left join lateral (
      select n.*
      from public.novedades n
      where lower(trim(coalesce(n.nombre, ''))) = lower(trim(coalesce(incap.source, '')))
      limit 1
    ) nav_incap on true
  ),
  validated_rows as (
    select
      rr.*,
      rr.tipo_personal as effective_tipo_personal
    from resolved_rows rr
    left join employees_catalog ec_current on ec_current.employee_id = rr.employee_id
    left join active_sedes s_current on s_current.codigo = ec_current.home_sede_codigo
    where rr.servicio_programado = false
      or (
        rr.tipo_personal = 'empleado'
        and s_current.codigo is not null
        and public.is_employee_effective_for_date_sql(
          ec_current.estado_empleado,
          ec_current.fecha_ingreso,
          ec_current.fecha_retiro,
          p_fecha
        )
      )
  )
  insert into public.employee_daily_status (
    id,
    fecha,
    employee_id,
    documento,
    nombre,
    tipo_personal,
    sede_codigo,
    sede_nombre_snapshot,
    zona_codigo_snapshot,
    zona_nombre_snapshot,
    dependencia_codigo_snapshot,
    dependencia_nombre_snapshot,
    estado_dia,
    asistio,
    novedad_codigo,
    novedad_nombre,
    requiere_reemplazo,
    decision_cobertura,
    reemplaza_a_employee_id,
    reemplaza_a_documento,
    reemplaza_a_nombre,
    reemplazado_por_employee_id,
    reemplazado_por_documento,
    reemplazado_por_nombre,
    servicio_programado,
    servicio_cubierto,
    cuenta_pago_servicio,
    cuenta_nomina,
    paga_nomina,
    motivo_nomina,
    source_attendance_id,
    source_replacement_id,
    source_absenteeism_id,
    source_incapacity_id,
    origen,
    closed
  )
  select
    concat(p_fecha, '_', rr.employee_id) as id,
    p_fecha,
    rr.employee_id,
    rr.documento,
    rr.nombre,
    rr.effective_tipo_personal,
    rr.effective_sede_codigo,
    coalesce(sl.nombre, rr.effective_sede_nombre),
    coalesce(sl.zona_codigo, rr.default_zona_codigo_snapshot),
    coalesce(sl.zona_nombre, rr.default_zona_nombre_snapshot),
    coalesce(sl.dependencia_codigo, rr.default_dependencia_codigo_snapshot),
    coalesce(sl.dependencia_nombre, rr.default_dependencia_nombre_snapshot),
    case
      when rr.replacement_super_id is not null then 'trabajado_reemplazo'
      when coalesce(rr.nav_att_codigo_novedad, rr.nav_att_codigo, '') = '9'
        or coalesce(rr.nav_rep_codigo_novedad, rr.nav_rep_codigo, '') = '9'
        or lower(trim(coalesce(rr.incapacity_source, ''))) = 'vacaciones' then 'vacaciones'
      when coalesce(rr.nav_att_codigo_novedad, rr.nav_att_codigo, '') = '7' then 'compensatorio'
      when coalesce(rr.asistio, false) = true then 'trabajado'
      when rr.incapacity_id is not null then 'incapacidad'
      when rr.replacement_employee_decision = 'ausentismo' or rr.absenteeism_id is not null then 'ausente_sin_reemplazo'
      when public.bool_from_text_truthy(coalesce(rr.nav_rep_reemplazo, rr.nav_att_reemplazo, rr.nav_incap_reemplazo)) then 'ausente_con_novedad'
      when rr.tipo_personal = 'empleado'
        and rr.servicio_programado
        and (
          coalesce(rr.day_locked, false)
          or lower(trim(coalesce(rr.day_status, ''))) = 'closed'
        ) then 'ausente_sin_reemplazo'
      when rr.servicio_programado then 'sin_registro'
      else 'no_programado'
    end as estado_dia,
    coalesce(rr.asistio, false),
    case
      when nullif(coalesce(rr.nav_rep_codigo_novedad, rr.nav_rep_codigo, rr.nav_att_codigo_novedad, rr.nav_att_codigo, rr.nav_incap_codigo_novedad, rr.nav_incap_codigo), '') is not null
        then coalesce(rr.nav_rep_codigo_novedad, rr.nav_rep_codigo, rr.nav_att_codigo_novedad, rr.nav_att_codigo, rr.nav_incap_codigo_novedad, rr.nav_incap_codigo)
      when rr.tipo_personal = 'empleado'
        and rr.servicio_programado
        and rr.incapacity_id is null
        and coalesce(rr.asistio, false) = false
        and (
          rr.replacement_employee_decision = 'ausentismo'
          or rr.absenteeism_id is not null
          or coalesce(rr.day_locked, false)
          or lower(trim(coalesce(rr.day_status, ''))) = 'closed'
        ) then '8'
      else null
    end,
    case
      when nullif(coalesce(rr.nav_rep_nombre, rr.nav_att_nombre, rr.nav_incap_nombre, rr.incapacity_source), '') is not null
        then coalesce(rr.nav_rep_nombre, rr.nav_att_nombre, rr.nav_incap_nombre, rr.incapacity_source)
      when rr.tipo_personal = 'empleado'
        and rr.servicio_programado
        and rr.incapacity_id is null
        and coalesce(rr.asistio, false) = false
        and (
          rr.replacement_employee_decision = 'ausentismo'
          or rr.absenteeism_id is not null
          or coalesce(rr.day_locked, false)
          or lower(trim(coalesce(rr.day_status, ''))) = 'closed'
        ) then 'AUSENCIA NO JUSTIFICADA'
      else null
    end,
    public.bool_from_text_truthy(coalesce(rr.nav_rep_reemplazo, rr.nav_att_reemplazo, rr.nav_incap_reemplazo)),
    case
      when rr.replacement_super_id is not null then 'reemplazo'
      when rr.replacement_employee_decision in ('reemplazo', 'ausentismo') then rr.replacement_employee_decision
      when rr.absenteeism_id is not null then 'ausentismo'
      when rr.tipo_personal = 'empleado'
        and rr.servicio_programado
        and coalesce(rr.asistio, false) = false
        and (
          coalesce(rr.day_locked, false)
          or lower(trim(coalesce(rr.day_status, ''))) = 'closed'
        ) then 'ausentismo'
      when public.bool_from_text_truthy(coalesce(rr.nav_rep_reemplazo, rr.nav_att_reemplazo, rr.nav_incap_reemplazo)) then 'pendiente'
      else 'no_aplica'
    end as decision_cobertura,
    rr.reemplaza_a_employee_id,
    rr.reemplaza_a_documento,
    rr.reemplaza_a_nombre,
    rr.reemplazado_por_employee_id,
    rr.reemplazado_por_documento,
    rr.reemplazado_por_nombre,
    rr.servicio_programado,
    case
      when rr.tipo_personal <> 'empleado' then false
      when rr.replacement_employee_decision = 'reemplazo' then true
      when coalesce(rr.asistio, false) = true then true
      else false
    end as servicio_cubierto,
    case
      when rr.tipo_personal <> 'empleado' then false
      when rr.replacement_employee_decision = 'reemplazo' then true
      when coalesce(rr.asistio, false) = true then true
      else false
    end as cuenta_pago_servicio,
    true as cuenta_nomina,
    case
      when rr.replacement_super_id is not null then true
      when coalesce(rr.asistio, false) = true then coalesce(public.bool_from_text_nullable(rr.nav_att_nomina), true)
      when rr.incapacity_id is not null then public.bool_from_text_nullable(coalesce(rr.nav_incap_nomina, rr.nav_att_nomina, rr.nav_rep_nomina))
      when rr.attendance_id is not null or rr.replacement_employee_id is not null or rr.absenteeism_id is not null then public.bool_from_text_nullable(coalesce(rr.nav_rep_nomina, rr.nav_att_nomina, rr.nav_incap_nomina))
      else null
    end as paga_nomina,
    case
      when rr.replacement_super_id is not null then 'Supernumerario en reemplazo.'
      when coalesce(rr.asistio, false) = true then 'Prestacion del servicio registrada.'
      when rr.incapacity_id is not null then concat('Incapacidad o novedad prolongada: ', coalesce(rr.nav_incap_nombre, rr.incapacity_source, 'Sin detalle'))
      when rr.replacement_employee_decision = 'reemplazo' then 'Ausencia cubierta con reemplazo.'
      when rr.replacement_employee_decision = 'ausentismo' then 'Ausencia sin reemplazo confirmada.'
      when public.bool_from_text_truthy(coalesce(rr.nav_rep_reemplazo, rr.nav_att_reemplazo, rr.nav_incap_reemplazo)) then 'Pendiente por definir reemplazo o ausentismo.'
      when rr.servicio_programado then 'Sin registro diario del empleado programado.'
      else 'Registro fuera de la programacion base de servicio.'
    end as motivo_nomina,
    rr.attendance_id,
    coalesce(rr.replacement_super_id, rr.replacement_employee_id),
    rr.absenteeism_id,
    rr.incapacity_id,
    case
      when coalesce(rr.replacement_super_actor_email, rr.replacement_employee_actor_email, '') = 'cron@system' then 'cierre'
      when rr.replacement_super_id is not null or rr.replacement_employee_id is not null then 'manual'
      when rr.incapacity_id is not null and rr.attendance_id is null then 'propagacion_incapacidad'
      when rr.attendance_id is not null then 'whatsapp'
      else 'manual'
    end as origen,
    coalesce(rr.day_locked, false) or lower(trim(coalesce(rr.day_status, ''))) = 'closed' as closed
  from validated_rows rr
  left join sedes_lookup sl on sl.codigo = rr.effective_sede_codigo;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

create or replace function public.refresh_employee_daily_status_range(p_fecha_desde text, p_fecha_hasta text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from date;
  v_to date;
  v_current date;
  v_total integer := 0;
begin
  if p_fecha_desde is null or p_fecha_hasta is null then
    raise exception 'Debes enviar un rango de fechas valido.';
  end if;

  v_from := p_fecha_desde::date;
  v_to := p_fecha_hasta::date;

  if v_from > v_to then
    raise exception 'La fecha inicial no puede ser mayor que la fecha final.';
  end if;

  v_current := v_from;
  while v_current <= v_to loop
    v_total := v_total + public.refresh_employee_daily_status(v_current::text);
    v_current := v_current + 1;
  end loop;

  return v_total;
end;
$$;

-- >>>>>>>>>> schema_operations_phase12.sql
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
    operarios_esperados,
    operarios_presentes,
    faltantes
  )
  select
    concat(p_fecha, '_', s.codigo) as id,
    p_fecha,
    s.codigo,
    s.nombre,
    coalesce(c.contratados, 0),
    coalesce(c.cubiertos, 0),
    greatest(coalesce(c.contratados, 0) - coalesce(c.cubiertos, 0), 0)
  from active_sedes s
  left join contracted_by_sede c on c.sede_codigo = s.codigo;

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

  if exists (
    select 1
    from public.daily_closures dc
    where dc.fecha = p_fecha
      and (dc.locked = true or lower(trim(coalesce(dc.status, ''))) = 'closed')
  ) then
    select *
    into v_result
    from public.daily_metrics dm
    where dm.fecha = p_fecha
    limit 1;
    if found then
      return v_result;
    end if;
  end if;

  with active_sedes as (
    select s.*
    from public.sedes s
    where lower(trim(coalesce(s.estado, 'activo'))) <> 'inactivo'
      and public.is_sede_scheduled_for_date_sql(s.jornada, p_fecha)
  ),
  scheduled_service_rows as (
    select *
    from public.employee_daily_status eds
    where eds.fecha = p_fecha
      and eds.tipo_personal = 'empleado'
      and eds.servicio_programado = true
  ),
  actual_rows as (
    select *
    from public.employee_daily_status eds
    where eds.fecha = p_fecha
      and (eds.asistio = true or eds.asistio = false)
  ),
  closure_state as (
    select dc.*
    from public.daily_closures dc
    where dc.fecha = p_fecha
  ),
  closure_flag as (
    select exists (
      select 1
      from closure_state cs
      where cs.locked = true or lower(trim(coalesce(cs.status, ''))) = 'closed'
    ) as is_closed
  ),
  base_counts as (
    select
      p_fecha as fecha,
      coalesce((select sum(greatest(coalesce(s.numero_operarios, 0), 0))::integer from active_sedes s), 0) as planned,
      coalesce((select count(*)::integer from scheduled_service_rows), 0) as expected,
      coalesce((select count(*)::integer from actual_rows where source_attendance_id is not null), 0) as unique_count,
      (select is_closed from closure_flag) as is_closed
  ),
  metrics as (
    select
      bc.fecha,
      bc.planned,
      bc.expected,
      bc.unique_count,
      case
        when bc.planned = 0 and bc.expected = 0 then coalesce((select count(*)::integer from actual_rows ar where ar.asistio = true), 0)
        else coalesce((select count(*)::integer from scheduled_service_rows sr where sr.cuenta_pago_servicio = true), 0)
      end as attendance_count,
      case
        when bc.planned = 0 and bc.expected = 0 then 0
        when bc.is_closed then coalesce((select count(*)::integer from scheduled_service_rows sr where coalesce(sr.cuenta_pago_servicio, false) = false), 0)
        else coalesce((select count(*)::integer from scheduled_service_rows sr where coalesce(sr.decision_cobertura, '') = 'ausentismo' or sr.estado_dia = 'ausente_sin_reemplazo'), 0)
      end as absenteeism,
      coalesce(bc.is_closed, false) as is_closed
    from base_counts bc
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
    m.fecha,
    m.planned,
    m.expected,
    m.unique_count,
    case
      when m.planned = 0 and m.expected = 0 then 0
      when m.is_closed then m.absenteeism
      else greatest(m.expected - m.attendance_count, 0)
    end,
    m.attendance_count,
    m.absenteeism,
    m.attendance_count,
    greatest(m.planned - m.expected, 0),
    m.is_closed
  from metrics m
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

create or replace function public.refresh_operational_snapshots_from_employee_daily_status(p_fecha text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sedes integer := 0;
  v_metrics public.daily_metrics;
begin
  v_sedes := public.recompute_sede_status_from_employee_daily_status(p_fecha);
  v_metrics := public.recompute_daily_metrics_from_employee_daily_status(p_fecha);

  return jsonb_build_object(
    'fecha', p_fecha,
    'sede_status_rows', v_sedes,
    'daily_metrics_id', v_metrics.id,
    'attendance_count', v_metrics.attendance_count,
    'expected', v_metrics.expected,
    'planned', v_metrics.planned
  );
end;
$$;

-- >>>>>>>>>> schema_operations_phase13.sql
do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'roles_matrix',
    'user_overrides',
    'zones',
    'dependencies',
    'sedes',
    'cargos',
    'novedades',
    'employees',
    'employee_cargo_history',
    'supervisor_profile',
    'import_history',
    'daily_closures',
    'attendance',
    'import_replacements',
    'daily_metrics',
    'incapacitados'
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

-- >>>>>>>>>> schema_operations_phase14_employee_portal.sql
create table if not exists public.employee_portal_sessions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  documento_snapshot text not null,
  nombre_snapshot text,
  telefono_last4_snapshot text not null,
  token_hash text not null unique,
  ip text,
  user_agent text,
  last_seen_at timestamptz,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_employee_portal_sessions_employee_id
  on public.employee_portal_sessions(employee_id);

create index if not exists idx_employee_portal_sessions_expires_at
  on public.employee_portal_sessions(expires_at);

create table if not exists public.employee_portal_audit (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id) on delete set null,
  session_id uuid references public.employee_portal_sessions(id) on delete set null,
  documento text,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists idx_employee_portal_audit_employee_id
  on public.employee_portal_audit(employee_id, created_at desc);

create index if not exists idx_employee_portal_audit_action
  on public.employee_portal_audit(action, created_at desc);

alter table public.employee_portal_sessions enable row level security;
alter table public.employee_portal_audit enable row level security;

drop trigger if exists trg_employee_portal_sessions_updated_at on public.employee_portal_sessions;
drop trigger if exists trg_employee_portal_sessions_updated_at on public.employee_portal_sessions;
create trigger trg_employee_portal_sessions_updated_at
before update on public.employee_portal_sessions
for each row execute function public.set_updated_at();

-- >>>>>>>>>> schema_operations_phase15_incapacidades_support.sql
alter table public.incapacitados
  add column if not exists canal_registro text,
  add column if not exists soporte_url text,
  add column if not exists soporte_nombre text,
  add column if not exists soporte_tipo text,
  add column if not exists soporte_storage_path text;

update public.incapacitados
set canal_registro = case
  when coalesce(whatsapp_message_id, '') <> '' then 'whatsapp'
  else 'portal_web'
end
where canal_registro is null;

drop policy if exists "incapacitados_write_admin" on public.incapacitados;
drop policy if exists "incapacitados_write_active_user" on public.incapacitados;
create policy "incapacitados_write_active_user"
on public.incapacitados
for all
to authenticated
using (public.is_active_authenticated_user())
with check (public.is_active_authenticated_user());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'incapacidades-soportes',
  'incapacidades-soportes',
  true,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "incapacidades_soportes_select_public" on storage.objects;
drop policy if exists "incapacidades_soportes_select_public" on storage.objects;
create policy "incapacidades_soportes_select_public"
on storage.objects
for select
to public
using (bucket_id = 'incapacidades-soportes');

drop policy if exists "incapacidades_soportes_insert_active_user" on storage.objects;
drop policy if exists "incapacidades_soportes_insert_active_user" on storage.objects;
create policy "incapacidades_soportes_insert_active_user"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'incapacidades-soportes'
  and public.is_active_authenticated_user()
);

drop policy if exists "incapacidades_soportes_update_active_user" on storage.objects;
drop policy if exists "incapacidades_soportes_update_active_user" on storage.objects;
create policy "incapacidades_soportes_update_active_user"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'incapacidades-soportes'
  and public.is_active_authenticated_user()
)
with check (
  bucket_id = 'incapacidades-soportes'
  and public.is_active_authenticated_user()
);

drop policy if exists "incapacidades_soportes_delete_active_user" on storage.objects;
drop policy if exists "incapacidades_soportes_delete_active_user" on storage.objects;
create policy "incapacidades_soportes_delete_active_user"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'incapacidades-soportes'
  and public.is_active_authenticated_user()
);

-- >>>>>>>>>> schema_operations_phase16_qr_attendance.sql
alter table public.sedes
  add column if not exists qr_enabled boolean not null default false;

alter table public.sedes
  add column if not exists qr_latitude double precision,
  add column if not exists qr_longitude double precision,
  add column if not exists qr_radius_meters integer not null default 500;

create table if not exists public.sede_devices (
  id uuid primary key default gen_random_uuid(),
  sede_id uuid references public.sedes(id) on delete cascade,
  sede_codigo text not null,
  sede_nombre text,
  device_name text not null,
  token_hash text not null unique,
  estado text not null default 'activo',
  created_by_uid uuid references public.profiles(id) on delete set null,
  created_by_email text,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sede_devices_sede_codigo
  on public.sede_devices(sede_codigo);

create index if not exists idx_sede_devices_estado
  on public.sede_devices(estado);

alter table public.sede_devices
  add column if not exists last_modified_by_uid uuid references public.profiles(id) on delete set null,
  add column if not exists last_modified_by_email text,
  add column if not exists last_modified_at timestamptz,
  add column if not exists revoked_by_uid uuid references public.profiles(id) on delete set null,
  add column if not exists revoked_by_email text;

create table if not exists public.sede_device_sites (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.sede_devices(id) on delete cascade,
  sede_id uuid references public.sedes(id) on delete cascade,
  sede_codigo text not null,
  sede_nombre text,
  created_at timestamptz not null default now(),
  unique(device_id, sede_codigo)
);

create index if not exists idx_sede_device_sites_device_id
  on public.sede_device_sites(device_id);

create index if not exists idx_sede_device_sites_sede_codigo
  on public.sede_device_sites(sede_codigo);

do $once$
begin
  if public.rocky_run_once('p16_sede_device_sites_backfill', 'public.sede_device_sites') then
    insert into public.sede_device_sites(device_id, sede_id, sede_codigo, sede_nombre)
    select d.id, d.sede_id, d.sede_codigo, d.sede_nombre
    from public.sede_devices d
    where d.sede_codigo is not null
    on conflict (device_id, sede_codigo) do nothing;
  end if;
end
$once$;

create table if not exists public.attendance_qr_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  action text not null check (action in ('entry', 'exit')),
  fecha text not null,
  employee_id uuid not null references public.employees(id) on delete cascade,
  documento text not null,
  nombre text,
  sede_codigo text not null,
  sede_nombre text,
  phone_number text,
  request_latitude double precision,
  request_longitude double precision,
  request_distance_meters integer,
  location_verified_at timestamptz,
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by_device_id uuid references public.sede_devices(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_attendance_qr_tokens_employee_fecha
  on public.attendance_qr_tokens(employee_id, fecha);

create index if not exists idx_attendance_qr_tokens_expires_at
  on public.attendance_qr_tokens(expires_at);

alter table public.attendance_qr_tokens
  add column if not exists request_latitude double precision,
  add column if not exists request_longitude double precision,
  add column if not exists request_distance_meters integer,
  add column if not exists location_verified_at timestamptz;

create table if not exists public.employee_daily_exits (
  id text primary key,
  fecha text not null,
  employee_id uuid not null references public.employees(id) on delete cascade,
  documento text not null,
  nombre text,
  sede_codigo text not null,
  sede_nombre text,
  qr_token_id uuid references public.attendance_qr_tokens(id) on delete set null,
  device_id uuid references public.sede_devices(id) on delete set null,
  entry_attendance_id text references public.attendance(id) on delete set null,
  exit_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists employee_daily_exits_unique_fecha_documento
  on public.employee_daily_exits(fecha, documento)
  where documento is not null;

create table if not exists public.attendance_qr_scans (
  id uuid primary key default gen_random_uuid(),
  qr_token_id uuid references public.attendance_qr_tokens(id) on delete set null,
  device_id uuid references public.sede_devices(id) on delete set null,
  action text,
  fecha text,
  employee_id uuid references public.employees(id) on delete set null,
  documento text,
  sede_codigo text,
  ok boolean not null default false,
  reason text,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists idx_attendance_qr_scans_created_at
  on public.attendance_qr_scans(created_at desc);

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'attendance_qr_tokens',
    'employee_daily_exits',
    'employee_daily_status'
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

alter table public.sede_devices enable row level security;
alter table public.sede_device_sites enable row level security;
alter table public.attendance_qr_tokens enable row level security;
alter table public.employee_daily_exits enable row level security;
alter table public.attendance_qr_scans enable row level security;

drop trigger if exists trg_sede_devices_updated_at on public.sede_devices;
drop trigger if exists trg_sede_devices_updated_at on public.sede_devices;
create trigger trg_sede_devices_updated_at
before update on public.sede_devices
for each row execute function public.set_updated_at();

drop policy if exists "sede_devices_read_authenticated" on public.sede_devices;
drop policy if exists "sede_devices_read_authenticated" on public.sede_devices;
create policy "sede_devices_read_authenticated"
on public.sede_devices
for select
to authenticated
using (true);

drop policy if exists "sede_devices_write_admin" on public.sede_devices;
drop policy if exists "sede_devices_write_admin" on public.sede_devices;
create policy "sede_devices_write_admin"
on public.sede_devices
for all
to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

drop policy if exists "sede_device_sites_read_authenticated" on public.sede_device_sites;
drop policy if exists "sede_device_sites_read_authenticated" on public.sede_device_sites;
create policy "sede_device_sites_read_authenticated"
on public.sede_device_sites
for select
to authenticated
using (true);

drop policy if exists "sede_device_sites_write_admin" on public.sede_device_sites;
drop policy if exists "sede_device_sites_write_admin" on public.sede_device_sites;
create policy "sede_device_sites_write_admin"
on public.sede_device_sites
for all
to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

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
        p.role in ('superadmin', 'admin', 'editor')
        or (p.role = 'supervisor' and p.supervisor_eligible = true)
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
using (public.can_view_qr_registry());

drop policy if exists "employee_daily_exits_read_authenticated" on public.employee_daily_exits;
drop policy if exists "employee_daily_exits_read_authenticated" on public.employee_daily_exits;
create policy "employee_daily_exits_read_authenticated"
on public.employee_daily_exits
for select
to authenticated
using (true);

drop policy if exists "employee_daily_exits_write_admin" on public.employee_daily_exits;
drop policy if exists "employee_daily_exits_write_admin" on public.employee_daily_exits;
create policy "employee_daily_exits_write_admin"
on public.employee_daily_exits
for all
to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

drop policy if exists "attendance_qr_scans_admin_read" on public.attendance_qr_scans;
drop policy if exists "attendance_qr_scans_admin_read" on public.attendance_qr_scans;
create policy "attendance_qr_scans_admin_read"
on public.attendance_qr_scans
for select
to authenticated
using (public.is_admin_like());

-- >>>>>>>>>> schema_operations_phase17_employee_certificates.sql
alter table public.cargos
  add column if not exists salario numeric;

create table if not exists public.employee_certificate_audit (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id) on delete set null,
  employee_codigo text,
  documento text,
  nombre text,
  verification_code text,
  certificate_type text not null check (certificate_type in ('basic', 'with_salary')),
  channel text not null check (channel in ('admin', 'employee_portal')),
  requested_by_profile_id uuid references public.profiles(id) on delete set null,
  requested_by_email text,
  requested_by_employee_session_id uuid references public.employee_portal_sessions(id) on delete set null,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

alter table public.employee_certificate_audit
  add column if not exists verification_code text;

create index if not exists idx_employee_certificate_audit_employee_id
  on public.employee_certificate_audit(employee_id, created_at desc);

create index if not exists idx_employee_certificate_audit_documento
  on public.employee_certificate_audit(documento, created_at desc);

create index if not exists idx_employee_certificate_audit_channel
  on public.employee_certificate_audit(channel, created_at desc);

create unique index if not exists idx_employee_certificate_audit_verification_code
  on public.employee_certificate_audit(verification_code)
  where verification_code is not null;

alter table public.employee_certificate_audit enable row level security;

drop policy if exists "employee_certificate_audit_read_admin" on public.employee_certificate_audit;
drop policy if exists "employee_certificate_audit_read_admin" on public.employee_certificate_audit;
create policy "employee_certificate_audit_read_admin"
on public.employee_certificate_audit
for select
to authenticated
using (public.is_admin_like());

-- >>>>>>>>>> schema_operations_phase17_tablet_qr_role.sql
do $$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'app_role'
      and e.enumlabel = 'tablet_qr'
  ) then
    alter type public.app_role add value 'tablet_qr';
  end if;
end $$;

-- >>>>>>>>>> schema_operations_phase18_supervisor_rls.sql
-- Phase 18: zone-scoped read access for supervisors.
-- Apply after phases 1, 2, 3, 9, 10, 15, 16 and whatsapp phase 4.

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
      and p.role::text <> 'supervisor'
  );
$$;

create or replace function public.current_supervisor_can_read_zone(zone_code text)
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
      and p.role::text = 'supervisor'
      and p.supervisor_eligible = true
      and nullif(trim(zone_code), '') is not null
      and (
        nullif(trim(zone_code), '') = nullif(trim(p.zona_codigo), '')
        or nullif(trim(zone_code), '') = any(coalesce(p.zonas_permitidas, '{}'::text[]))
      )
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
    or public.current_supervisor_can_read_zone(zone_code);
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
        and public.current_supervisor_can_read_zone(s.zona_codigo)
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

create or replace function public.current_supervisor_can_write_operational_replacement(
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
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.estado = 'activo'
      and p.role::text = 'supervisor'
      and p.supervisor_eligible = true
  )
  and public.can_read_operational_sede_or_employee(sede_code, employee_id_value, documento_value);
$$;

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
        p.role::text in ('superadmin', 'admin', 'editor')
        or (p.role::text = 'supervisor' and p.supervisor_eligible = true)
      )
  );
$$;

drop function if exists public.list_supernumerarios_for_current_supervisor();

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
    e.fecha_ingreso::date,
    e.fecha_retiro::date
  from public.employees e
  left join public.cargos c on c.codigo = e.cargo_codigo
  where coalesce(e.estado, 'activo') <> 'inactivo'
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

grant execute on function public.current_profile_is_active_non_supervisor() to authenticated;
grant execute on function public.current_supervisor_can_read_zone(text) to authenticated;
grant execute on function public.can_read_zone_data(text) to authenticated;
grant execute on function public.can_read_sede_data(text) to authenticated;
grant execute on function public.can_read_employee_data(uuid, text) to authenticated;
grant execute on function public.can_read_operational_sede_or_employee(text, uuid, text) to authenticated;
grant execute on function public.current_supervisor_can_write_operational_replacement(text, uuid, text) to authenticated;
grant execute on function public.can_view_qr_registry() to authenticated;
grant execute on function public.list_supernumerarios_for_current_supervisor() to authenticated;

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
using (public.can_read_zone_data(zona_codigo));

drop policy if exists "employees_read_authenticated" on public.employees;
drop policy if exists "employees_read_authenticated" on public.employees;
create policy "employees_read_authenticated"
on public.employees
for select
to authenticated
using (
  public.can_read_zone_data(zona_codigo)
  or public.can_read_sede_data(sede_codigo)
);

drop policy if exists "employee_cargo_history_read_authenticated" on public.employee_cargo_history;
drop policy if exists "employee_cargo_history_read_authenticated" on public.employee_cargo_history;
create policy "employee_cargo_history_read_authenticated"
on public.employee_cargo_history
for select
to authenticated
using (public.can_read_employee_data(employee_id, documento));

drop policy if exists "supervisor_profile_read_authenticated" on public.supervisor_profile;
drop policy if exists "supervisor_profile_read_authenticated" on public.supervisor_profile;
create policy "supervisor_profile_read_authenticated"
on public.supervisor_profile
for select
to authenticated
using (
  public.can_read_zone_data(zona_codigo)
  or public.can_read_sede_data(sede_codigo)
);

drop policy if exists "attendance_read_authenticated" on public.attendance;
drop policy if exists "attendance_read_authenticated" on public.attendance;
create policy "attendance_read_authenticated"
on public.attendance
for select
to authenticated
using (public.can_read_operational_sede_or_employee(sede_codigo, empleado_id, documento));

drop policy if exists "absenteeism_read_authenticated" on public.absenteeism;
drop policy if exists "absenteeism_read_authenticated" on public.absenteeism;
create policy "absenteeism_read_authenticated"
on public.absenteeism
for select
to authenticated
using (public.can_read_operational_sede_or_employee(sede_codigo, empleado_id, documento));

drop policy if exists "sede_status_read_authenticated" on public.sede_status;
drop policy if exists "sede_status_read_authenticated" on public.sede_status;
create policy "sede_status_read_authenticated"
on public.sede_status
for select
to authenticated
using (public.can_read_sede_data(sede_codigo));

drop policy if exists "import_replacements_read_authenticated" on public.import_replacements;
drop policy if exists "import_replacements_read_authenticated" on public.import_replacements;
create policy "import_replacements_read_authenticated"
on public.import_replacements
for select
to authenticated
using (public.can_read_operational_sede_or_employee(sede_codigo, empleado_id, documento));

drop policy if exists "import_replacements_insert_supervisor" on public.import_replacements;
drop policy if exists "import_replacements_insert_supervisor" on public.import_replacements;
create policy "import_replacements_insert_supervisor"
on public.import_replacements
for insert
to authenticated
with check (public.current_supervisor_can_write_operational_replacement(sede_codigo, empleado_id, documento));

drop policy if exists "import_replacements_update_supervisor" on public.import_replacements;
drop policy if exists "import_replacements_update_supervisor" on public.import_replacements;
create policy "import_replacements_update_supervisor"
on public.import_replacements
for update
to authenticated
using (public.current_supervisor_can_write_operational_replacement(sede_codigo, empleado_id, documento))
with check (public.current_supervisor_can_write_operational_replacement(sede_codigo, empleado_id, documento));

drop policy if exists "daily_sede_closures_read_authenticated" on public.daily_sede_closures;
drop policy if exists "daily_sede_closures_read_authenticated" on public.daily_sede_closures;
create policy "daily_sede_closures_read_authenticated"
on public.daily_sede_closures
for select
to authenticated
using (
  public.can_read_zone_data(zona_codigo)
  or public.can_read_sede_data(sede_codigo)
);

drop policy if exists "employee_daily_status_read_authenticated" on public.employee_daily_status;
drop policy if exists "employee_daily_status_read_authenticated" on public.employee_daily_status;
create policy "employee_daily_status_read_authenticated"
on public.employee_daily_status
for select
to authenticated
using (
  public.can_read_zone_data(zona_codigo_snapshot)
  or public.can_read_sede_data(sede_codigo)
);

drop policy if exists "sede_devices_read_authenticated" on public.sede_devices;
drop policy if exists "sede_devices_read_authenticated" on public.sede_devices;
create policy "sede_devices_read_authenticated"
on public.sede_devices
for select
to authenticated
using (public.can_read_sede_data(sede_codigo));

drop policy if exists "sede_device_sites_read_authenticated" on public.sede_device_sites;
drop policy if exists "sede_device_sites_read_authenticated" on public.sede_device_sites;
create policy "sede_device_sites_read_authenticated"
on public.sede_device_sites
for select
to authenticated
using (public.can_read_sede_data(sede_codigo));

drop policy if exists "attendance_qr_tokens_registry_read" on public.attendance_qr_tokens;
drop policy if exists "attendance_qr_tokens_registry_read" on public.attendance_qr_tokens;
create policy "attendance_qr_tokens_registry_read"
on public.attendance_qr_tokens
for select
to authenticated
using (
  public.can_view_qr_registry()
  and public.can_read_operational_sede_or_employee(sede_codigo, employee_id, documento)
);

drop policy if exists "employee_daily_exits_read_authenticated" on public.employee_daily_exits;
drop policy if exists "employee_daily_exits_read_authenticated" on public.employee_daily_exits;
create policy "employee_daily_exits_read_authenticated"
on public.employee_daily_exits
for select
to authenticated
using (public.can_read_operational_sede_or_employee(sede_codigo, employee_id, documento));

drop policy if exists "incapacitados_read_authenticated" on public.incapacitados;
drop policy if exists "incapacitados_read_authenticated" on public.incapacitados;
create policy "incapacitados_read_authenticated"
on public.incapacitados
for select
to authenticated
using (public.can_read_employee_data(employee_id, documento));

-- These global summaries do not contain per-zone columns. Keep them available to
-- non-supervisor authenticated roles, but avoid exposing company-wide totals to supervisors.
drop policy if exists "import_history_read_authenticated" on public.import_history;
drop policy if exists "import_history_read_authenticated" on public.import_history;
create policy "import_history_read_authenticated"
on public.import_history
for select
to authenticated
using (public.current_profile_is_active_non_supervisor());

drop policy if exists "daily_metrics_read_authenticated" on public.daily_metrics;
drop policy if exists "daily_metrics_read_authenticated" on public.daily_metrics;
create policy "daily_metrics_read_authenticated"
on public.daily_metrics
for select
to authenticated
using (public.current_profile_is_active_non_supervisor());

drop policy if exists "daily_closures_read_authenticated" on public.daily_closures;
drop policy if exists "daily_closures_read_authenticated" on public.daily_closures;
create policy "daily_closures_read_authenticated"
on public.daily_closures
for select
to authenticated
using (public.current_profile_is_active_non_supervisor());

-- >>>>>>>>>> schema_operations_phase19_supernumerario_occupancy.sql
-- Phase 19: global daily occupancy for supernumerario replacements.
-- Apply after phase 18.
-- Existing duplicated rows must be reviewed manually; the trigger prevents new duplicates.

create or replace function public.list_supernumerario_replacement_occupancy(p_fecha text)
returns table (
  id text,
  import_id uuid,
  fecha_operacion text,
  fecha text,
  empleado_id uuid,
  documento text,
  nombre text,
  sede_codigo text,
  sede_nombre text,
  novedad_codigo text,
  novedad_nombre text,
  decision text,
  supernumerario_id uuid,
  supernumerario_documento text,
  supernumerario_nombre text,
  ts timestamptz,
  actor_uid uuid,
  actor_email text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id,
    r.import_id,
    r.fecha_operacion,
    r.fecha,
    r.empleado_id,
    r.documento,
    r.nombre,
    r.sede_codigo,
    r.sede_nombre,
    r.novedad_codigo,
    r.novedad_nombre,
    r.decision,
    r.supernumerario_id,
    r.supernumerario_documento,
    r.supernumerario_nombre,
    r.ts,
    r.actor_uid,
    r.actor_email
  from public.import_replacements r
  left join public.employee_daily_status eds
    on eds.fecha = r.fecha
    and (
      (r.empleado_id is not null and eds.employee_id = r.empleado_id::text)
      or (
        nullif(trim(coalesce(r.documento, '')), '') is not null
        and eds.documento = nullif(trim(r.documento), '')
      )
    )
  where r.fecha = nullif(trim(p_fecha), '')
    and r.decision = 'reemplazo'
    and coalesce(eds.servicio_programado, true) = true
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
  order by r.ts desc nulls last, r.supernumerario_nombre asc;
$$;

grant execute on function public.list_supernumerario_replacement_occupancy(text) to authenticated;

create or replace function public.prevent_duplicate_supernumerario_replacement()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_super_label text;
  v_target text;
begin
  if coalesce(new.decision, '') <> 'reemplazo' then
    return new;
  end if;

  if new.supernumerario_id is null and nullif(trim(coalesce(new.supernumerario_documento, '')), '') is null then
    return new;
  end if;

  if exists (
    select 1
    from public.employee_daily_status eds
    where eds.fecha = new.fecha
      and coalesce(eds.servicio_programado, false) = false
      and (
        (new.empleado_id is not null and eds.employee_id = new.empleado_id::text)
        or (
          nullif(trim(coalesce(new.documento, '')), '') is not null
          and eds.documento = nullif(trim(new.documento), '')
        )
      )
  ) then
    return new;
  end if;

  select coalesce(r.nombre, r.documento, r.id)
    into v_target
  from public.import_replacements r
  left join public.employee_daily_status eds
    on eds.fecha = r.fecha
    and (
      (r.empleado_id is not null and eds.employee_id = r.empleado_id::text)
      or (
        nullif(trim(coalesce(r.documento, '')), '') is not null
        and eds.documento = nullif(trim(r.documento), '')
      )
    )
  where r.fecha = new.fecha
    and r.id <> new.id
    and coalesce(r.decision, '') = 'reemplazo'
    and coalesce(eds.servicio_programado, true) = true
    and (
      (new.supernumerario_id is not null and r.supernumerario_id = new.supernumerario_id)
      or (
        nullif(trim(coalesce(new.supernumerario_documento, '')), '') is not null
        and nullif(trim(coalesce(r.supernumerario_documento, '')), '') = nullif(trim(new.supernumerario_documento), '')
      )
    )
  limit 1;

  if v_target is not null then
    v_super_label := coalesce(new.supernumerario_nombre, new.supernumerario_documento, new.supernumerario_id::text, 'El supernumerario');
    raise exception '% ya esta ocupado para la fecha % cubriendo a %.', v_super_label, new.fecha, v_target
      using errcode = '23505';
  end if;

  return new;
end;
$$;

drop trigger if exists import_replacements_prevent_duplicate_supernumerario on public.import_replacements;
drop trigger if exists import_replacements_prevent_duplicate_supernumerario on public.import_replacements;
create trigger import_replacements_prevent_duplicate_supernumerario
before insert or update of fecha, decision, supernumerario_id, supernumerario_documento
on public.import_replacements
for each row
execute function public.prevent_duplicate_supernumerario_replacement();

-- >>>>>>>>>> schema_operations_phase20_supernumerario_incapacities.sql
-- Phase 20: active incapacity occupancy for global supernumerarios.
-- Apply after phase 19.

create or replace function public.list_supernumerario_incapacities_for_current_supervisor(p_fecha text)
returns table (
  id uuid,
  employee_id uuid,
  documento text,
  nombre text,
  fecha_inicio date,
  fecha_fin date,
  estado text,
  source text,
  canal_registro text,
  soporte_url text,
  soporte_nombre text,
  soporte_tipo text,
  soporte_storage_path text,
  whatsapp_message_id text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    i.id,
    i.employee_id,
    i.documento,
    i.nombre,
    i.fecha_inicio,
    i.fecha_fin,
    i.estado,
    i.source,
    i.canal_registro,
    i.soporte_url,
    i.soporte_nombre,
    i.soporte_tipo,
    i.soporte_storage_path,
    i.whatsapp_message_id,
    i.created_at,
    i.updated_at
  from public.incapacitados i
  join public.employees e
    on (
      (i.employee_id is not null and e.id = i.employee_id)
      or (
        nullif(trim(coalesce(i.documento, '')), '') is not null
        and e.documento = nullif(trim(i.documento), '')
      )
    )
  left join public.cargos c on c.codigo = e.cargo_codigo
  where nullif(trim(p_fecha), '') is not null
    and coalesce(i.estado, 'activo') = 'activo'
    and i.fecha_inicio <= nullif(trim(p_fecha), '')::date
    and i.fecha_fin >= nullif(trim(p_fecha), '')::date
    and coalesce(e.estado, 'activo') <> 'inactivo'
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
  order by i.fecha_inicio desc, i.nombre asc;
$$;

grant execute on function public.list_supernumerario_incapacities_for_current_supervisor(text) to authenticated;

-- >>>>>>>>>> schema_operations_phase21_admin_permission_rls.sql
-- Phase 21: let eligible supervisors use administrative modules according to permissions.
-- Apply after phase 18.

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
      'viewUsers','editUsers','viewZones','editZones','viewDependencies','editDependencies',
      'viewSedes','editSedes','viewEmployees','editEmployees','manageEmployees',
      'manageEmployeeSchedules','viewSupervisors','editSupervisors','manageSupervisors',
      'viewSupernumerarios','editSupernumerarios','viewCargos','editCargos',
      'viewNovedades','editNovedades','viewQrScanner','viewQrDailyRegistry',
      'manageQrDevices'
    ])
    when role_value = 'supervisor' then permission_key = any(array[
      'viewSedes','editSedes','viewEmployees','editEmployees','manageEmployees',
      'viewSupervisors','editSupervisors','manageSupervisors',
      'viewQrScanner','viewQrDailyRegistry','manageQrDevices','uploadData'
    ])
    else false
  end;
$$;

create or replace function public.current_profile_has_permission(permission_key text, legacy_key text default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case
      when p.estado <> 'activo' then false
      when p.role::text = 'superadmin' then true
      when p.role::text = 'supervisor' and p.supervisor_eligible is not true then false
      else coalesce(
        case when u.permissions ? permission_key then (u.permissions ->> permission_key)::boolean end,
        case when legacy_key is not null and u.permissions ? legacy_key then (u.permissions ->> legacy_key)::boolean end,
        case when rm.permissions ? permission_key then (rm.permissions ->> permission_key)::boolean end,
        case when legacy_key is not null and rm.permissions ? legacy_key then (rm.permissions ->> legacy_key)::boolean end,
        (
          public.default_role_has_permission(p.role::text, permission_key)
          or (
            legacy_key is not null
            and public.default_role_has_permission(p.role::text, legacy_key)
          )
        ),
        false
      )
    end
    from public.profiles p
    left join public.roles_matrix rm on rm.role = p.role
    left join public.user_overrides u on u.user_id = p.id
    where p.id = auth.uid()
  ), false);
$$;

grant execute on function public.default_role_has_permission(text, text) to authenticated;
grant execute on function public.current_profile_has_permission(text, text) to authenticated;

drop policy if exists "employees_write_admin" on public.employees;
drop policy if exists "employees_write_admin" on public.employees;
create policy "employees_write_admin"
on public.employees
for all
to authenticated
using (
  public.is_admin_like()
  or (
    public.current_profile_has_permission('editEmployees', 'manageEmployees')
    and public.can_read_employee_data(id, documento)
  )
)
with check (
  public.is_admin_like()
  or (
    public.current_profile_has_permission('editEmployees', 'manageEmployees')
    and (
      public.current_supervisor_can_read_zone(zona_codigo)
      or public.can_read_sede_data(sede_codigo)
    )
  )
);

drop policy if exists "employee_cargo_history_write_admin" on public.employee_cargo_history;
drop policy if exists "employee_cargo_history_write_admin" on public.employee_cargo_history;
create policy "employee_cargo_history_write_admin"
on public.employee_cargo_history
for all
to authenticated
using (
  public.is_admin_like()
  or (
    public.current_profile_has_permission('editEmployees', 'manageEmployees')
    and public.can_read_employee_data(employee_id, documento)
  )
)
with check (
  public.is_admin_like()
  or (
    public.current_profile_has_permission('editEmployees', 'manageEmployees')
    and public.can_read_employee_data(employee_id, documento)
  )
);

-- >>>>>>>>>> schema_operations_phase22_report_performance_indexes.sql
create index if not exists idx_employee_daily_status_report_range_order
on public.employee_daily_status (fecha, sede_codigo, nombre);

create index if not exists idx_employee_daily_status_report_employee_date
on public.employee_daily_status (employee_id, fecha);

create index if not exists idx_employee_daily_status_report_document_date
on public.employee_daily_status (documento, fecha);

create index if not exists idx_employee_cargo_history_fecha_ingreso_desc
on public.employee_cargo_history (fecha_ingreso desc);

create index if not exists idx_incapacitados_employee_report_range
on public.incapacitados (employee_id, fecha_inicio, fecha_fin);

create index if not exists idx_incapacitados_documento_report_range
on public.incapacitados (documento, fecha_inicio, fecha_fin);

-- >>>>>>>>>> schema_operations_phase22_supernumerarios_by_date.sql
-- Phase 22: date-aware supernumerario availability for supervisor replacements.
-- Apply after phase 18.

drop function if exists public.list_supernumerarios_for_current_supervisor(text);

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

grant execute on function public.list_supernumerarios_for_current_supervisor(text) to authenticated;

create or replace function public.list_supernumerario_incapacities_for_current_supervisor(p_fecha text)
returns table (
  id uuid,
  employee_id uuid,
  documento text,
  nombre text,
  fecha_inicio date,
  fecha_fin date,
  estado text,
  source text,
  canal_registro text,
  soporte_url text,
  soporte_nombre text,
  soporte_tipo text,
  soporte_storage_path text,
  whatsapp_message_id text,
  created_at timestamptz,
  updated_at timestamptz
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
    i.id,
    i.employee_id,
    i.documento,
    i.nombre,
    i.fecha_inicio,
    i.fecha_fin,
    i.estado,
    i.source,
    i.canal_registro,
    i.soporte_url,
    i.soporte_nombre,
    i.soporte_tipo,
    i.soporte_storage_path,
    i.whatsapp_message_id,
    i.created_at,
    i.updated_at
  from params
  join public.incapacitados i on params.day is not null
  join public.employees e
    on (
      (i.employee_id is not null and e.id = i.employee_id)
      or (
        nullif(trim(coalesce(i.documento, '')), '') is not null
        and e.documento = nullif(trim(i.documento), '')
      )
    )
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
  where coalesce(i.estado, 'activo') = 'activo'
    and i.fecha_inicio <= params.day
    and i.fecha_fin >= params.day
    and (
      coalesce(e.estado, 'activo') <> 'inactivo'
      or (e.fecha_retiro is not null and e.fecha_retiro::date >= params.day)
    )
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
  order by i.fecha_inicio desc, i.nombre asc;
$$;

grant execute on function public.list_supernumerario_incapacities_for_current_supervisor(text) to authenticated;

-- >>>>>>>>>> schema_operations_phase23_profile_role_protection.sql
-- Phase 23: protect profile access fields from self-service overwrites.
-- Apply after phase 21.

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
        or new.created_by_uid is distinct from old.created_by_uid
        or new.created_by_email is distinct from old.created_by_email
        or new.last_modified_by_uid is distinct from old.last_modified_by_uid
        or new.last_modified_by_email is distinct from old.last_modified_by_email
        or new.deleted_at is distinct from old.deleted_at
        or new.deleted_by_uid is distinct from old.deleted_by_uid
        or new.deleted_by_email is distinct from old.deleted_by_email
      then
        raise exception 'No puedes modificar rol, estado ni campos administrativos de tu propio perfil.';
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

-- >>>>>>>>>> schema_operations_phase24_colombia_holiday_july9.sql
-- Adds the July 9 national holiday introduced by Ley 2578 de 2026.
create or replace function public.is_colombia_holiday_sql(fecha text)
returns boolean
language plpgsql
immutable
as $$
declare
  v_fecha date;
  v_year integer;
  v_easter date;
begin
  if fecha is null or fecha !~ '^\d{4}-\d{2}-\d{2}$' then
    return false;
  end if;

  v_fecha := fecha::date;
  v_year := extract(year from v_fecha);
  v_easter := public.easter_sunday_sql(v_year);

  return v_fecha in (
    make_date(v_year, 1, 1),
    make_date(v_year, 5, 1),
    make_date(v_year, 7, 20),
    make_date(v_year, 8, 7),
    make_date(v_year, 12, 8),
    make_date(v_year, 12, 25),
    public.move_to_following_monday_sql(make_date(v_year, 1, 6)),
    public.move_to_following_monday_sql(make_date(v_year, 3, 19)),
    public.move_to_following_monday_sql(make_date(v_year, 6, 29)),
    public.move_to_following_monday_sql(make_date(v_year, 7, 9)),
    public.move_to_following_monday_sql(make_date(v_year, 8, 15)),
    public.move_to_following_monday_sql(make_date(v_year, 10, 12)),
    public.move_to_following_monday_sql(make_date(v_year, 11, 1)),
    public.move_to_following_monday_sql(make_date(v_year, 11, 11)),
    v_easter - 3,
    v_easter - 2,
    public.move_to_following_monday_sql(v_easter + 39),
    public.move_to_following_monday_sql(v_easter + 60),
    public.move_to_following_monday_sql(v_easter + 68)
  );
end;
$$;

-- >>>>>>>>>> schema_operations_phase25_employee_extended_info.sql
-- Phase 25: extended employee information.
-- Adds optional detail fields kept outside the main employee table view.

alter table public.employees
  add column if not exists fecha_nacimiento date,
  add column if not exists eps text,
  add column if not exists afp text,
  add column if not exists arl_riesgo text,
  add column if not exists dotacion_camisa text,
  add column if not exists dotacion_pantalon text,
  add column if not exists dotacion_zapatos text;

-- >>>>>>>>>> schema_operations_phase26_sede_catalog_reference_sync.sql
-- Phase 26: keep live sede catalog references synchronized after sede edits.
-- Apply after phase 25.

create or replace function public.sync_sede_catalog_references()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.codigo, '') = coalesce(old.codigo, '')
    and coalesce(new.nombre, '') = coalesce(old.nombre, '')
    and coalesce(new.zona_codigo, '') = coalesce(old.zona_codigo, '')
    and coalesce(new.zona_nombre, '') = coalesce(old.zona_nombre, '')
  then
    return new;
  end if;

  update public.employees
  set
    sede_codigo = new.codigo,
    sede_nombre = new.nombre,
    zona_codigo = new.zona_codigo,
    zona_nombre = new.zona_nombre,
    last_modified_at = now()
  where sede_codigo = old.codigo;

  update public.employee_cargo_history
  set
    sede_codigo = new.codigo,
    sede_nombre = new.nombre
  where sede_codigo = old.codigo;

  update public.supervisor_profile
  set
    sede_codigo = new.codigo,
    zona_codigo = new.zona_codigo,
    zona_nombre = new.zona_nombre,
    last_modified_at = now()
  where sede_codigo = old.codigo;

  update public.sede_devices
  set
    sede_codigo = new.codigo,
    sede_nombre = new.nombre
  where sede_codigo = old.codigo;

  update public.sede_device_sites
  set
    sede_codigo = new.codigo,
    sede_nombre = new.nombre
  where sede_codigo = old.codigo;

  return new;
end;
$$;

drop trigger if exists trg_sedes_sync_catalog_references on public.sedes;
drop trigger if exists trg_sedes_sync_catalog_references on public.sedes;
create trigger trg_sedes_sync_catalog_references
after update of codigo, nombre, zona_codigo, zona_nombre on public.sedes
for each row
execute function public.sync_sede_catalog_references();

update public.employees e
set
  sede_nombre = s.nombre,
  zona_codigo = s.zona_codigo,
  zona_nombre = s.zona_nombre
from public.sedes s
where e.sede_codigo = s.codigo
  and (
    coalesce(e.sede_nombre, '') <> coalesce(s.nombre, '')
    or coalesce(e.zona_codigo, '') <> coalesce(s.zona_codigo, '')
    or coalesce(e.zona_nombre, '') <> coalesce(s.zona_nombre, '')
  );

update public.employee_cargo_history h
set sede_nombre = s.nombre
from public.sedes s
where h.sede_codigo = s.codigo
  and coalesce(h.sede_nombre, '') <> coalesce(s.nombre, '');

update public.sede_devices d
set sede_nombre = s.nombre
from public.sedes s
where d.sede_codigo = s.codigo
  and coalesce(d.sede_nombre, '') <> coalesce(s.nombre, '');

update public.sede_device_sites ds
set sede_nombre = s.nombre
from public.sedes s
where ds.sede_codigo = s.codigo
  and coalesce(ds.sede_nombre, '') <> coalesce(s.nombre, '');
