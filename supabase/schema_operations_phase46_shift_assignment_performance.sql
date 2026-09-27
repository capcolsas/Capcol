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
