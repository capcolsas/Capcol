-- Operational range and ordering indexes.
create index if not exists idx_attendance_fecha_created_at
  on public.attendance (fecha, created_at desc);

create index if not exists idx_attendance_fecha_sede_created_at
  on public.attendance (fecha, sede_codigo, created_at desc);

create index if not exists idx_import_replacements_fecha_ts
  on public.import_replacements (fecha, ts desc);

create index if not exists idx_import_replacements_fecha_sede_ts
  on public.import_replacements (fecha, sede_codigo, ts desc);

create index if not exists idx_import_replacements_fecha_decision_ts
  on public.import_replacements (fecha, decision, ts desc);

create index if not exists idx_absenteeism_fecha_sede_created_at
  on public.absenteeism (fecha, sede_codigo, created_at desc);

create index if not exists idx_sede_status_fecha_sede
  on public.sede_status (fecha, sede_codigo);

-- Employee effective-date, zone/site and role-alignment lookups.
create index if not exists idx_employees_estado_fecha_ingreso_retiro
  on public.employees (estado, fecha_ingreso, fecha_retiro);

create index if not exists idx_employees_sede_nombre
  on public.employees (sede_codigo, nombre);

create index if not exists idx_employees_zona_nombre
  on public.employees (zona_codigo, nombre);

create index if not exists idx_employees_cargo_estado_nombre
  on public.employees (cargo_codigo, estado, nombre);

create index if not exists idx_employees_telefono
  on public.employees (telefono);

create index if not exists idx_employee_cargo_history_employee_fecha_created
  on public.employee_cargo_history (employee_id, fecha_ingreso desc, created_at desc);

create index if not exists idx_employee_cargo_history_documento_fecha_created
  on public.employee_cargo_history (documento, fecha_ingreso desc, created_at desc);

create index if not exists idx_supervisor_profile_documento_estado
  on public.supervisor_profile (documento, estado);

create index if not exists idx_supervisor_profile_zona_nombre
  on public.supervisor_profile (zona_codigo, nombre);

-- Site scoping for daily registry, QR and supervisor views.
create index if not exists idx_sedes_estado_nombre
  on public.sedes (estado, nombre);

create index if not exists idx_sedes_zona_nombre
  on public.sedes (zona_codigo, nombre);

create index if not exists idx_sedes_qr_estado_nombre
  on public.sedes (qr_enabled, estado, nombre);

-- Incapacity overlap searches.
create index if not exists idx_incapacitados_estado_range
  on public.incapacitados (estado, fecha_inicio, fecha_fin);

create index if not exists idx_incapacitados_documento_estado_range
  on public.incapacitados (documento, estado, fecha_inicio, fecha_fin);

create index if not exists idx_incapacitados_employee_estado_range
  on public.incapacitados (employee_id, estado, fecha_inicio, fecha_fin);

-- QR daily lookups.
create index if not exists idx_employee_daily_exits_fecha_exit_at
  on public.employee_daily_exits (fecha, exit_at);

create index if not exists idx_employee_daily_exits_fecha_sede_exit_at
  on public.employee_daily_exits (fecha, sede_codigo, exit_at);

create index if not exists idx_attendance_qr_tokens_fecha_used_at
  on public.attendance_qr_tokens (fecha, used_at)
  where used_at is not null;

create index if not exists idx_attendance_qr_tokens_fecha_sede_used_at
  on public.attendance_qr_tokens (fecha, sede_codigo, used_at)
  where used_at is not null;

-- Audit dashboard separation: closures vs general activity.
create index if not exists idx_audit_logs_created_at_desc
  on public.audit_logs (created_at desc);

create index if not exists idx_audit_logs_target_type_created_at_desc
  on public.audit_logs (target_type, created_at desc);

create index if not exists idx_audit_logs_closure_created_at_desc
  on public.audit_logs (created_at desc)
  where target_type in ('daily_closure', 'shift_closure');

create index if not exists idx_audit_logs_activity_created_at_desc
  on public.audit_logs (created_at desc)
  where target_type is null or target_type not in ('daily_closure', 'shift_closure');

-- Shift automation and review queues.
create index if not exists idx_scheduled_shifts_due_closure
  on public.scheduled_shifts (ends_at)
  where estado in ('programado', 'abierto');

create index if not exists idx_scheduled_shifts_sede_template_fecha
  on public.scheduled_shifts (sede_codigo, template_id, fecha_operativa);

create index if not exists idx_shift_assignments_shift_estado_nombre
  on public.shift_assignments (scheduled_shift_id, estado, nombre);

create index if not exists idx_shift_adjustments_estado_reported_at
  on public.shift_adjustments (estado, reported_at desc);

create index if not exists idx_shift_time_authorizations_estado_created_at
  on public.shift_time_authorizations (estado, created_at desc);

create index if not exists idx_employee_shift_status_review_fecha_sede
  on public.employee_shift_status (fecha_operativa, sede_codigo, nombre)
  where requires_review = true;
