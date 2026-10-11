-- Phase 74: employee residence (address and location), medical restrictions and emergency contact.
-- Apply after phase 73.
--
-- Optional detail fields, like phase 25: they follow the employees RLS, so each profile sees them
-- only for the employees of its contracts (or zones, for supervisors).

alter table public.employees
  add column if not exists direccion_residencia text,
  add column if not exists barrio_residencia text,
  add column if not exists municipio_residencia text,
  add column if not exists residencia_latitud double precision,
  add column if not exists residencia_longitud double precision,
  add column if not exists restricciones_medicas text,
  add column if not exists contacto_emergencia_nombre text,
  add column if not exists contacto_emergencia_parentesco text,
  add column if not exists contacto_emergencia_telefono text;

-- A location is both coordinates or none, inside valid ranges.
alter table public.employees
  drop constraint if exists employees_residencia_ubicacion_check;
alter table public.employees
  add constraint employees_residencia_ubicacion_check check (
    (residencia_latitud is null and residencia_longitud is null)
    or (
      residencia_latitud is not null
      and residencia_longitud is not null
      and residencia_latitud between -90 and 90
      and residencia_longitud between -180 and 180
    )
  );
