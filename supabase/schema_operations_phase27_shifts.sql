-- Phase 27: flexible shift model foundation.
-- Apply after phase 26.
--
-- This phase only prepares the data model. It does not change WhatsApp, QR,
-- daily closures, reports, or operational flows yet.

create table if not exists public.shift_templates (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  notas_programacion text,
  estado text not null default 'activo' check (estado in ('activo', 'inactivo')),
  orden integer not null default 0,
  created_by_uid uuid references public.profiles(id) on delete set null,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.shift_templates
  add column if not exists notas_programacion text;

drop index if exists public.idx_shift_templates_sede_estado;
drop index if exists public.idx_shift_templates_sede_orden;
drop index if exists public.idx_shift_templates_programacion;

alter table public.shift_templates
  drop constraint if exists shift_templates_tipo_programacion_check,
  drop constraint if exists shift_templates_frecuencia_semanas_check,
  drop constraint if exists shift_templates_semana_mes_check,
  drop constraint if exists shift_templates_festivo_modo_check;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'shift_templates'
      and column_name = 'sede_codigo'
  ) then
    alter table public.shift_templates alter column sede_codigo drop not null;
  end if;
end $$;

alter table public.shift_templates
  drop column if exists sede_codigo cascade,
  drop column if exists sede_nombre cascade,
  drop column if exists hora_inicio cascade,
  drop column if exists hora_fin cascade,
  drop column if exists cruza_dia cascade,
  drop column if exists dias_semana cascade,
  drop column if exists tipo_programacion cascade,
  drop column if exists frecuencia_semanas cascade,
  drop column if exists fecha_ancla cascade,
  drop column if exists semana_mes cascade,
  drop column if exists festivo_modo cascade,
  drop column if exists operarios_planeados cascade,
  drop column if exists ventana_entrada_antes_minutos cascade,
  drop column if exists ventana_entrada_despues_minutos cascade,
  drop column if exists ventana_salida_antes_minutos cascade,
  drop column if exists ventana_salida_despues_minutos cascade,
  drop column if exists ventana_novedad_horas cascade,
  drop column if exists requiere_salida_qr cascade,
  drop column if exists color cascade;

create index if not exists idx_shift_templates_estado_orden
  on public.shift_templates (estado, orden, nombre);

drop table if exists public.shift_template_sites cascade;

create table if not exists public.shift_site_plan_assignments (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.shift_templates(id) on delete cascade,
  sede_codigo text not null,
  sede_nombre text,
  operarios_planeados integer not null default 0 check (operarios_planeados >= 0),
  horizon_days integer not null default 90 check (horizon_days between 1 and 370),
  estado text not null default 'activo' check (estado in ('activo', 'inactivo')),
  activated_at timestamptz not null default now(),
  inactivated_at timestamptz,
  created_by_uid uuid references public.profiles(id) on delete set null,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop index if exists public.shift_site_plan_assignments_unique_active_sede;

create unique index if not exists shift_site_plan_assignments_unique_active_sede_template
  on public.shift_site_plan_assignments (sede_codigo, template_id)
  where estado = 'activo';

create index if not exists idx_shift_site_plan_assignments_template
  on public.shift_site_plan_assignments (template_id, estado);

create index if not exists idx_shift_site_plan_assignments_sede
  on public.shift_site_plan_assignments (sede_codigo, estado);

create table if not exists public.shift_template_rules (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.shift_templates(id) on delete cascade,
  nombre text,
  tipo_dia text not null default 'dia_semana' check (tipo_dia in ('dia_semana', 'festivo')),
  dia_semana text check (dia_semana is null or dia_semana in ('1', '2', '3', '4', '5', '6', '0')),
  hora_inicio time not null,
  hora_fin time not null,
  cruza_dia boolean not null default false,
  frecuencia_tipo text not null default 'todos' check (frecuencia_tipo in ('todos', 'cada_n_semanas', 'mensual')),
  frecuencia_semanas integer not null default 1 check (frecuencia_semanas >= 1),
  fecha_ancla date,
  semana_mes integer check (semana_mes is null or semana_mes in (1, 2, 3, 4, -1)),
  festivo_modo text not null default 'excluir' check (festivo_modo in ('excluir', 'normal')),
  ventana_entrada_antes_minutos integer not null default 30 check (ventana_entrada_antes_minutos >= 0),
  ventana_entrada_despues_minutos integer not null default 30 check (ventana_entrada_despues_minutos >= 0),
  ventana_salida_antes_minutos integer not null default 0 check (ventana_salida_antes_minutos >= 0),
  ventana_salida_despues_minutos integer not null default 30 check (ventana_salida_despues_minutos >= 0),
  ventana_novedad_horas integer not null default 48 check (ventana_novedad_horas >= 0),
  estado text not null default 'activo' check (estado in ('activo', 'inactivo')),
  orden integer not null default 0,
  notas text,
  created_by_uid uuid references public.profiles(id) on delete set null,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shift_template_rules_valid_day check (
    (tipo_dia = 'festivo' and dia_semana is null)
    or (tipo_dia = 'dia_semana' and dia_semana is not null)
  ),
  constraint shift_template_rules_valid_frequency check (
    frecuencia_tipo <> 'cada_n_semanas'
    or (frecuencia_semanas >= 2 and fecha_ancla is not null)
  ),
  constraint shift_template_rules_valid_monthly check (
    frecuencia_tipo <> 'mensual'
    or (tipo_dia = 'dia_semana' and dia_semana is not null and semana_mes is not null)
  )
);

alter table public.shift_template_rules
  drop column if exists operarios_planeados cascade,
  drop column if exists requiere_salida_qr cascade,
  drop column if exists color cascade;

create index if not exists idx_shift_template_rules_template
  on public.shift_template_rules (template_id, estado, orden, tipo_dia, dia_semana, hora_inicio);

create index if not exists idx_shift_template_rules_frequency
  on public.shift_template_rules (frecuencia_tipo, fecha_ancla, semana_mes);

create table if not exists public.scheduled_shifts (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references public.shift_templates(id) on delete set null,
  template_rule_id uuid references public.shift_template_rules(id) on delete set null,
  fecha_operativa text not null,
  sede_codigo text not null,
  sede_nombre text,
  nombre text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  estado text not null default 'programado' check (estado in ('programado', 'abierto', 'cerrado', 'cancelado')),
  operarios_planeados integer not null default 0 check (operarios_planeados >= 0),
  opened_at timestamptz,
  closed_at timestamptz,
  closed_by_uid uuid references public.profiles(id) on delete set null,
  closed_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scheduled_shifts_valid_date check (fecha_operativa ~ '^\d{4}-\d{2}-\d{2}$'),
  constraint scheduled_shifts_valid_time_range check (ends_at > starts_at)
);

drop index if exists public.scheduled_shifts_unique_template_day;
drop index if exists public.scheduled_shifts_unique_site_rule_day;
drop index if exists public.idx_scheduled_shifts_template_site;

alter table public.scheduled_shifts
  add column if not exists template_rule_id uuid references public.shift_template_rules(id) on delete set null;

drop index if exists public.scheduled_shifts_unique_rule_day;

alter table public.scheduled_shifts
  drop column if exists template_site_id cascade;

create unique index if not exists scheduled_shifts_unique_sede_rule_day
  on public.scheduled_shifts (sede_codigo, template_rule_id, fecha_operativa)
  where template_rule_id is not null;

create index if not exists idx_scheduled_shifts_template_rule
  on public.scheduled_shifts (template_rule_id);

create index if not exists idx_scheduled_shifts_fecha_sede
  on public.scheduled_shifts (fecha_operativa, sede_codigo);

create index if not exists idx_scheduled_shifts_starts_ends
  on public.scheduled_shifts (starts_at, ends_at);

create index if not exists idx_scheduled_shifts_estado
  on public.scheduled_shifts (estado);

create table if not exists public.shift_assignments (
  id uuid primary key default gen_random_uuid(),
  scheduled_shift_id uuid not null references public.scheduled_shifts(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  documento text,
  nombre text,
  cargo_codigo text,
  cargo_nombre text,
  sede_codigo text,
  estado text not null default 'asignado' check (estado in ('asignado', 'confirmado', 'ausente', 'reemplazado', 'cancelado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists shift_assignments_unique_shift_employee
  on public.shift_assignments (scheduled_shift_id, employee_id)
  where employee_id is not null;

create unique index if not exists shift_assignments_unique_shift_documento
  on public.shift_assignments (scheduled_shift_id, documento)
  where employee_id is null and nullif(trim(documento), '') is not null;

create index if not exists idx_shift_assignments_employee
  on public.shift_assignments (employee_id);

create index if not exists idx_shift_assignments_shift
  on public.shift_assignments (scheduled_shift_id);

create table if not exists public.shift_time_authorizations (
  id uuid primary key default gen_random_uuid(),
  scheduled_shift_id uuid not null references public.scheduled_shifts(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  documento text,
  authorization_type text not null check (authorization_type in ('early_entry', 'late_exit', 'extra_shift', 'extended_shift')),
  authorized_from timestamptz,
  authorized_until timestamptz,
  minutes_authorized integer check (minutes_authorized is null or minutes_authorized >= 0),
  reason text,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'rechazada', 'cancelada')),
  requested_by_uid uuid references public.profiles(id) on delete set null,
  requested_by_email text,
  approved_by_uid uuid references public.profiles(id) on delete set null,
  approved_by_email text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shift_time_authorizations_valid_range check (
    authorized_from is null
    or authorized_until is null
    or authorized_until >= authorized_from
  )
);

create index if not exists idx_shift_time_authorizations_shift_employee_estado
  on public.shift_time_authorizations (scheduled_shift_id, employee_id, estado);

create index if not exists idx_shift_time_authorizations_documento_estado
  on public.shift_time_authorizations (documento, estado);

create table if not exists public.employee_shift_status (
  id text primary key,
  scheduled_shift_id uuid not null references public.scheduled_shifts(id) on delete cascade,
  fecha_operativa text not null,
  employee_id uuid references public.employees(id) on delete set null,
  documento text,
  nombre text,
  sede_codigo text,
  estado_turno text not null default 'programado' check (estado_turno in (
    'programado',
    'trabajado',
    'trabajado_tardio',
    'ausente_con_novedad',
    'ausente_sin_reemplazo',
    'sin_registro',
    'salida_pendiente',
    'retiro_anticipado',
    'post_cierre_pendiente',
    'ajustado',
    'cancelado'
  )),
  asistio boolean not null default false,
  entrada_at timestamptz,
  salida_at timestamptz,
  novedad_codigo text,
  novedad_nombre text,
  early_entry_minutes integer not null default 0 check (early_entry_minutes >= 0),
  late_entry_minutes integer not null default 0 check (late_entry_minutes >= 0),
  early_exit_minutes integer not null default 0 check (early_exit_minutes >= 0),
  late_exit_minutes integer not null default 0 check (late_exit_minutes >= 0),
  early_entry_reason text,
  late_entry_reason text,
  early_exit_reason text,
  late_exit_reason text,
  entry_authorization_id uuid references public.shift_time_authorizations(id) on delete set null,
  exit_authorization_id uuid references public.shift_time_authorizations(id) on delete set null,
  requires_review boolean not null default false,
  requiere_reemplazo boolean not null default false,
  decision_cobertura text not null default 'no_aplica' check (decision_cobertura in ('no_aplica', 'pendiente', 'reemplazo', 'ausentismo')),
  reemplazado_por_employee_id uuid references public.employees(id) on delete set null,
  reemplazado_por_documento text,
  reemplazado_por_nombre text,
  closed boolean not null default false,
  source_attendance_id text references public.attendance(id) on delete set null,
  source_exit_id text references public.employee_daily_exits(id) on delete set null,
  source_incapacity_id uuid references public.incapacitados(id) on delete set null,
  source_replacement_id text references public.import_replacements(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_shift_status_valid_date check (fecha_operativa ~ '^\d{4}-\d{2}-\d{2}$')
);

create unique index if not exists employee_shift_status_unique_shift_employee
  on public.employee_shift_status (scheduled_shift_id, employee_id)
  where employee_id is not null;

create unique index if not exists employee_shift_status_unique_shift_documento
  on public.employee_shift_status (scheduled_shift_id, documento)
  where employee_id is null and nullif(trim(documento), '') is not null;

create index if not exists idx_employee_shift_status_shift
  on public.employee_shift_status (scheduled_shift_id);

create index if not exists idx_employee_shift_status_fecha_sede
  on public.employee_shift_status (fecha_operativa, sede_codigo);

create index if not exists idx_employee_shift_status_employee_fecha
  on public.employee_shift_status (employee_id, fecha_operativa);

create index if not exists idx_employee_shift_status_review
  on public.employee_shift_status (requires_review, closed);

create table if not exists public.shift_closures (
  id text primary key,
  scheduled_shift_id uuid not null references public.scheduled_shifts(id) on delete cascade,
  fecha_operativa text not null,
  sede_codigo text not null,
  planeados integer not null default 0 check (planeados >= 0),
  asignados integer not null default 0 check (asignados >= 0),
  registrados integer not null default 0 check (registrados >= 0),
  ausencias integer not null default 0 check (ausencias >= 0),
  reemplazos integer not null default 0 check (reemplazos >= 0),
  faltantes integer not null default 0 check (faltantes >= 0),
  sobrantes integer not null default 0 check (sobrantes >= 0),
  entradas_fuera_ventana integer not null default 0 check (entradas_fuera_ventana >= 0),
  salidas_fuera_ventana integer not null default 0 check (salidas_fuera_ventana >= 0),
  salidas_pendientes integer not null default 0 check (salidas_pendientes >= 0),
  autorizaciones_pendientes integer not null default 0 check (autorizaciones_pendientes >= 0),
  ajustes_pendientes integer not null default 0 check (ajustes_pendientes >= 0),
  closed_by_uid uuid references public.profiles(id) on delete set null,
  closed_by_email text,
  closed_at timestamptz not null default now(),
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scheduled_shift_id),
  constraint shift_closures_valid_date check (fecha_operativa ~ '^\d{4}-\d{2}-\d{2}$')
);

create index if not exists idx_shift_closures_fecha_sede
  on public.shift_closures (fecha_operativa, sede_codigo);

create table if not exists public.shift_adjustments (
  id uuid primary key default gen_random_uuid(),
  scheduled_shift_id uuid not null references public.scheduled_shifts(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  documento text,
  tipo text not null check (tipo in (
    'entrada_tardia',
    'entrada_anticipada',
    'salida_tardia',
    'salida_anticipada',
    'novedad_post_cierre',
    'registro_post_cierre',
    'cambio_turno',
    'correccion_manual'
  )),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobado', 'rechazado')),
  before_snapshot jsonb not null default '{}'::jsonb,
  after_snapshot jsonb not null default '{}'::jsonb,
  motivo text,
  reported_at timestamptz not null default now(),
  approved_by_uid uuid references public.profiles(id) on delete set null,
  approved_by_email text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_shift_adjustments_shift_estado
  on public.shift_adjustments (scheduled_shift_id, estado);

create index if not exists idx_shift_adjustments_employee
  on public.shift_adjustments (employee_id);

alter table public.attendance
  add column if not exists turno_id uuid references public.scheduled_shifts(id) on delete set null,
  add column if not exists fecha_operativa text,
  add column if not exists registro_estado text,
  add column if not exists requires_review boolean not null default false,
  add column if not exists reported_at timestamptz,
  add column if not exists early_entry_minutes integer not null default 0,
  add column if not exists late_entry_minutes integer not null default 0,
  add column if not exists early_entry_reason text,
  add column if not exists late_entry_reason text,
  add column if not exists entry_authorization_id uuid references public.shift_time_authorizations(id) on delete set null;

alter table public.employee_daily_exits
  add column if not exists turno_id uuid references public.scheduled_shifts(id) on delete set null,
  add column if not exists fecha_operativa text,
  add column if not exists registro_estado text,
  add column if not exists requires_review boolean not null default false,
  add column if not exists early_exit_minutes integer not null default 0,
  add column if not exists late_exit_minutes integer not null default 0,
  add column if not exists early_exit_reason text,
  add column if not exists late_exit_reason text,
  add column if not exists exit_authorization_id uuid references public.shift_time_authorizations(id) on delete set null;

alter table public.attendance_qr_tokens
  add column if not exists turno_id uuid references public.scheduled_shifts(id) on delete set null,
  add column if not exists fecha_operativa text,
  add column if not exists early_exit_reason text;

alter table public.attendance_qr_scans
  add column if not exists turno_id uuid references public.scheduled_shifts(id) on delete set null,
  add column if not exists fecha_operativa text;

alter table public.absenteeism
  add column if not exists turno_id uuid references public.scheduled_shifts(id) on delete set null,
  add column if not exists fecha_operativa text;

alter table public.import_replacements
  add column if not exists turno_id uuid references public.scheduled_shifts(id) on delete set null,
  add column if not exists fecha_operativa text;

alter table public.incapacitados
  add column if not exists origen_turno_id uuid references public.scheduled_shifts(id) on delete set null,
  add column if not exists reported_at timestamptz,
  add column if not exists requires_review boolean not null default false;

create index if not exists idx_attendance_turno
  on public.attendance (turno_id);

create index if not exists idx_attendance_fecha_operativa
  on public.attendance (fecha_operativa);

create index if not exists idx_employee_daily_exits_turno
  on public.employee_daily_exits (turno_id);

create index if not exists idx_attendance_qr_tokens_turno
  on public.attendance_qr_tokens (turno_id);

create index if not exists idx_attendance_qr_scans_turno
  on public.attendance_qr_scans (turno_id);

create index if not exists idx_absenteeism_turno
  on public.absenteeism (turno_id);

create index if not exists idx_import_replacements_turno
  on public.import_replacements (turno_id);

create index if not exists idx_incapacitados_origen_turno
  on public.incapacitados (origen_turno_id);

drop trigger if exists trg_shift_templates_updated_at on public.shift_templates;
create trigger trg_shift_templates_updated_at
before update on public.shift_templates
for each row execute function public.set_updated_at();

drop trigger if exists trg_shift_template_rules_updated_at on public.shift_template_rules;
create trigger trg_shift_template_rules_updated_at
before update on public.shift_template_rules
for each row execute function public.set_updated_at();

drop trigger if exists trg_shift_site_plan_assignments_updated_at on public.shift_site_plan_assignments;
create trigger trg_shift_site_plan_assignments_updated_at
before update on public.shift_site_plan_assignments
for each row execute function public.set_updated_at();

drop trigger if exists trg_scheduled_shifts_updated_at on public.scheduled_shifts;
create trigger trg_scheduled_shifts_updated_at
before update on public.scheduled_shifts
for each row execute function public.set_updated_at();

drop trigger if exists trg_shift_assignments_updated_at on public.shift_assignments;
create trigger trg_shift_assignments_updated_at
before update on public.shift_assignments
for each row execute function public.set_updated_at();

drop trigger if exists trg_shift_time_authorizations_updated_at on public.shift_time_authorizations;
create trigger trg_shift_time_authorizations_updated_at
before update on public.shift_time_authorizations
for each row execute function public.set_updated_at();

drop trigger if exists trg_employee_shift_status_updated_at on public.employee_shift_status;
create trigger trg_employee_shift_status_updated_at
before update on public.employee_shift_status
for each row execute function public.set_updated_at();

drop trigger if exists trg_shift_closures_updated_at on public.shift_closures;
create trigger trg_shift_closures_updated_at
before update on public.shift_closures
for each row execute function public.set_updated_at();

drop trigger if exists trg_shift_adjustments_updated_at on public.shift_adjustments;
create trigger trg_shift_adjustments_updated_at
before update on public.shift_adjustments
for each row execute function public.set_updated_at();

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'shift_templates',
    'shift_template_rules',
    'shift_site_plan_assignments',
    'scheduled_shifts',
    'shift_assignments',
    'shift_time_authorizations',
    'employee_shift_status',
    'shift_closures',
    'shift_adjustments'
  ]
  loop
    execute format('alter table public.%I enable row level security', tbl);
  end loop;
end $$;

drop policy if exists "shift_templates_read_authenticated" on public.shift_templates;
create policy "shift_templates_read_authenticated"
on public.shift_templates
for select
to authenticated
using (true);

drop policy if exists "shift_templates_write_admin" on public.shift_templates;
create policy "shift_templates_write_admin"
on public.shift_templates
for all
to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

drop policy if exists "shift_template_rules_read_authenticated" on public.shift_template_rules;
create policy "shift_template_rules_read_authenticated"
on public.shift_template_rules
for select
to authenticated
using (true);

drop policy if exists "shift_template_rules_write_admin" on public.shift_template_rules;
create policy "shift_template_rules_write_admin"
on public.shift_template_rules
for all
to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

drop policy if exists "shift_site_plan_assignments_read_authenticated" on public.shift_site_plan_assignments;
create policy "shift_site_plan_assignments_read_authenticated"
on public.shift_site_plan_assignments
for select
to authenticated
using (true);

drop policy if exists "shift_site_plan_assignments_write_admin" on public.shift_site_plan_assignments;
create policy "shift_site_plan_assignments_write_admin"
on public.shift_site_plan_assignments
for all
to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

drop policy if exists "scheduled_shifts_read_authenticated" on public.scheduled_shifts;
create policy "scheduled_shifts_read_authenticated"
on public.scheduled_shifts
for select
to authenticated
using (true);

drop policy if exists "scheduled_shifts_write_admin" on public.scheduled_shifts;
create policy "scheduled_shifts_write_admin"
on public.scheduled_shifts
for all
to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

drop policy if exists "shift_assignments_read_authenticated" on public.shift_assignments;
create policy "shift_assignments_read_authenticated"
on public.shift_assignments
for select
to authenticated
using (true);

drop policy if exists "shift_assignments_write_admin" on public.shift_assignments;
create policy "shift_assignments_write_admin"
on public.shift_assignments
for all
to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

drop policy if exists "shift_time_authorizations_read_authenticated" on public.shift_time_authorizations;
create policy "shift_time_authorizations_read_authenticated"
on public.shift_time_authorizations
for select
to authenticated
using (true);

drop policy if exists "shift_time_authorizations_write_admin" on public.shift_time_authorizations;
create policy "shift_time_authorizations_write_admin"
on public.shift_time_authorizations
for all
to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

drop policy if exists "employee_shift_status_read_authenticated" on public.employee_shift_status;
create policy "employee_shift_status_read_authenticated"
on public.employee_shift_status
for select
to authenticated
using (true);

drop policy if exists "employee_shift_status_write_admin" on public.employee_shift_status;
create policy "employee_shift_status_write_admin"
on public.employee_shift_status
for all
to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

drop policy if exists "shift_closures_read_authenticated" on public.shift_closures;
create policy "shift_closures_read_authenticated"
on public.shift_closures
for select
to authenticated
using (true);

drop policy if exists "shift_closures_write_admin" on public.shift_closures;
create policy "shift_closures_write_admin"
on public.shift_closures
for all
to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

drop policy if exists "shift_adjustments_read_authenticated" on public.shift_adjustments;
create policy "shift_adjustments_read_authenticated"
on public.shift_adjustments
for select
to authenticated
using (true);

drop policy if exists "shift_adjustments_write_admin" on public.shift_adjustments;
create policy "shift_adjustments_write_admin"
on public.shift_adjustments
for all
to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'shift_templates',
    'shift_template_rules',
    'shift_site_plan_assignments',
    'scheduled_shifts',
    'shift_assignments',
    'shift_time_authorizations',
    'employee_shift_status',
    'shift_closures',
    'shift_adjustments'
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

  update public.scheduled_shifts
  set
    sede_codigo = new.codigo,
    sede_nombre = new.nombre
  where sede_codigo = old.codigo;

  update public.shift_assignments
  set sede_codigo = new.codigo
  where sede_codigo = old.codigo;

  update public.employee_shift_status
  set sede_codigo = new.codigo
  where sede_codigo = old.codigo;

  update public.shift_closures
  set sede_codigo = new.codigo
  where sede_codigo = old.codigo;

  return new;
end;
$$;

update public.scheduled_shifts ss
set sede_nombre = s.nombre
from public.sedes s
where ss.sede_codigo = s.codigo
  and coalesce(ss.sede_nombre, '') <> coalesce(s.nombre, '');
