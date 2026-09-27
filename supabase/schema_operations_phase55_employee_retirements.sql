-- Apply before deploying the employee retirement UI. Existing retirees remain valid.
begin;

alter table public.employees add column if not exists retiro_motivo text;
alter table public.employees add column if not exists retiro_observacion text;

create table if not exists public.employee_retirements (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  documento text,
  contrato_codigo text,
  fecha_ingreso timestamptz,
  fecha_retiro timestamptz not null,
  motivo text not null check (motivo in (
    'renuncia','mutuo_acuerdo','vencimiento_contrato','finalizacion_obra_labor',
    'despido_justa_causa','despido_sin_justa_causa','fallecimiento',
    'liquidacion_empresa','abandono_cargo','sentencia_judicial','pension_jubilacion','periodo_prueba'
  )),
  observacion text not null check (observacion ~ '[^[:space:]]'),
  created_by_uid uuid,
  created_by_email text,
  created_at timestamptz not null default now()
);
create index if not exists employee_retirements_employee_created_idx
  on public.employee_retirements(employee_id, created_at desc);
alter table public.employee_retirements enable row level security;
drop policy if exists employee_retirements_read on public.employee_retirements;
create policy employee_retirements_read on public.employee_retirements
  for select to authenticated using (
    public.can_read_contract_data(contrato_codigo)
    or public.can_read_employee_data(employee_id, documento)
  );
grant select on public.employee_retirements to authenticated;
revoke insert, update, delete on public.employee_retirements from anon, authenticated;

-- The employee UPDATE and the history INSERT commit or roll back together.
-- A trigger covers rehireEmployee, imports and all other employee write paths.
create or replace function public.prepare_employee_retirement()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.estado = 'inactivo' and (tg_op = 'INSERT' or old.estado is distinct from 'inactivo') then
    if new.retiro_motivo is null or new.retiro_motivo not in (
      'renuncia','mutuo_acuerdo','vencimiento_contrato','finalizacion_obra_labor',
      'despido_justa_causa','despido_sin_justa_causa','fallecimiento',
      'liquidacion_empresa','abandono_cargo','sentencia_judicial','pension_jubilacion','periodo_prueba'
    ) then
      raise exception 'Selecciona un motivo de retiro válido desde Empleados > Retirar empleado.';
    end if;
    new.retiro_observacion := btrim(new.retiro_observacion);
    if new.retiro_observacion is null or new.retiro_observacion !~ '[^[:space:]]' then
      raise exception 'Escribe la observación del retiro.';
    end if;
    if new.fecha_retiro is null or new.fecha_retiro < new.fecha_ingreso then
      raise exception 'La fecha de retiro es obligatoria y no puede ser anterior al ingreso.';
    end if;
  elsif new.estado = 'activo' then
    new.retiro_motivo := null;
    new.retiro_observacion := null;
  elsif tg_op = 'UPDATE' and old.estado = 'inactivo' and new.estado = 'inactivo'
    and (new.retiro_motivo is distinct from old.retiro_motivo
      or new.retiro_observacion is distinct from old.retiro_observacion) then
    raise exception 'El motivo y la observación del retiro registrado no se pueden sobrescribir.';
  end if;
  return new;
end;
$$;

create or replace function public.record_employee_retirement()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'inactivo' and (tg_op = 'INSERT' or old.estado is distinct from 'inactivo') then
    insert into public.employee_retirements (
      employee_id, documento, contrato_codigo, fecha_ingreso, fecha_retiro,
      motivo, observacion, created_by_uid, created_by_email
    ) values (
      new.id, new.documento, new.contrato_codigo, new.fecha_ingreso, new.fecha_retiro,
      new.retiro_motivo, new.retiro_observacion, auth.uid(), auth.jwt()->>'email'
    );
  end if;
  return new;
end;
$$;
revoke all on function public.record_employee_retirement() from public;
drop trigger if exists prepare_employee_retirement on public.employees;
create trigger prepare_employee_retirement before insert or update on public.employees
  for each row execute function public.prepare_employee_retirement();
drop trigger if exists record_employee_retirement on public.employees;
create trigger record_employee_retirement after insert or update on public.employees
  for each row execute function public.record_employee_retirement();

commit;
