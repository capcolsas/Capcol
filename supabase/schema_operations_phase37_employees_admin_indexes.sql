-- Phase 37: support server-side filtering in Employees admin.

create extension if not exists pg_trgm;

create index if not exists idx_employees_codigo_trgm
  on public.employees using gin (codigo gin_trgm_ops);

create index if not exists idx_employees_documento_trgm
  on public.employees using gin (documento gin_trgm_ops);

create index if not exists idx_employees_nombre_trgm
  on public.employees using gin (nombre gin_trgm_ops);

create index if not exists idx_employees_telefono_trgm
  on public.employees using gin (telefono gin_trgm_ops);

create index if not exists idx_employees_cargo_nombre_trgm
  on public.employees using gin (cargo_nombre gin_trgm_ops);

create index if not exists idx_employees_cargo_codigo_trgm
  on public.employees using gin (cargo_codigo gin_trgm_ops);

create index if not exists idx_employees_sede_nombre_trgm
  on public.employees using gin (sede_nombre gin_trgm_ops);

create index if not exists idx_employees_sede_codigo_trgm
  on public.employees using gin (sede_codigo gin_trgm_ops);
