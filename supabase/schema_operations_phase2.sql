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
create trigger trg_employees_updated_at
before update on public.employees
for each row execute function public.set_updated_at();

drop trigger if exists trg_supervisor_profile_updated_at on public.supervisor_profile;
create trigger trg_supervisor_profile_updated_at
before update on public.supervisor_profile
for each row execute function public.set_updated_at();

drop policy if exists "employees_read_authenticated" on public.employees;
create policy "employees_read_authenticated"
on public.employees
for select
to authenticated
using (true);

drop policy if exists "employees_write_admin" on public.employees;
create policy "employees_write_admin"
on public.employees
for all
to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

drop policy if exists "employee_cargo_history_read_authenticated" on public.employee_cargo_history;
create policy "employee_cargo_history_read_authenticated"
on public.employee_cargo_history
for select
to authenticated
using (true);

drop policy if exists "employee_cargo_history_write_admin" on public.employee_cargo_history;
create policy "employee_cargo_history_write_admin"
on public.employee_cargo_history
for all
to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

drop policy if exists "supervisor_profile_read_authenticated" on public.supervisor_profile;
create policy "supervisor_profile_read_authenticated"
on public.supervisor_profile
for select
to authenticated
using (true);

drop policy if exists "supervisor_profile_write_admin" on public.supervisor_profile;
create policy "supervisor_profile_write_admin"
on public.supervisor_profile
for all
to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());
