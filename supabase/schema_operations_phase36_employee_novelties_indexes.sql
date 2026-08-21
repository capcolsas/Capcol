-- Phase 36: support range-based employee novelty reads.

create index if not exists idx_employee_cargo_history_fecha_ingreso_created
  on public.employee_cargo_history (fecha_ingreso desc, created_at desc);

create index if not exists idx_employee_cargo_history_fecha_retiro
  on public.employee_cargo_history (fecha_retiro desc, employee_id)
  where fecha_retiro is not null;
