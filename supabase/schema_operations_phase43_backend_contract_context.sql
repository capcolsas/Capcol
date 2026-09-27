-- Phase 43: contract context for WhatsApp/QR backend artifacts.
-- Persist contract/client snapshots in QR, incapacity and certificate records so
-- backend-created rows can be filtered and reported without relying on later joins.

alter table public.attendance_qr_tokens
  add column if not exists contrato_codigo text,
  add column if not exists contrato_nombre text,
  add column if not exists cliente_nombre_snapshot text,
  add column if not exists cliente_nit_snapshot text;

alter table public.employee_daily_exits
  add column if not exists contrato_codigo text,
  add column if not exists contrato_nombre text,
  add column if not exists cliente_nombre_snapshot text,
  add column if not exists cliente_nit_snapshot text;

alter table public.attendance_qr_scans
  add column if not exists contrato_codigo text,
  add column if not exists contrato_nombre text,
  add column if not exists cliente_nombre_snapshot text,
  add column if not exists cliente_nit_snapshot text;

alter table public.incapacitados
  add column if not exists contrato_codigo text,
  add column if not exists contrato_nombre text,
  add column if not exists cliente_nombre_snapshot text,
  add column if not exists cliente_nit_snapshot text;

alter table public.employee_shift_status
  add column if not exists contrato_codigo text,
  add column if not exists contrato_nombre text,
  add column if not exists cliente_nombre_snapshot text,
  add column if not exists cliente_nit_snapshot text;

alter table public.employee_certificate_audit
  add column if not exists contrato_codigo text,
  add column if not exists contrato_nombre text,
  add column if not exists cliente_nombre_snapshot text,
  add column if not exists cliente_nit_snapshot text;

create or replace function public.fill_qr_token_contract_context()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
begin
  select * into v_ctx
  from public.resolve_contract_context(new.sede_codigo, new.employee_id, null, new.documento);
  new.contrato_codigo = coalesce(new.contrato_codigo, v_ctx.contrato_codigo);
  new.contrato_nombre = coalesce(new.contrato_nombre, v_ctx.contrato_nombre);
  new.cliente_nombre_snapshot = coalesce(new.cliente_nombre_snapshot, v_ctx.cliente_nombre_snapshot);
  new.cliente_nit_snapshot = coalesce(new.cliente_nit_snapshot, v_ctx.cliente_nit_snapshot);
  return new;
end;
$$;

create or replace function public.fill_qr_exit_contract_context()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
begin
  select * into v_ctx
  from public.resolve_contract_context(new.sede_codigo, new.employee_id, null, new.documento);
  new.contrato_codigo = coalesce(new.contrato_codigo, v_ctx.contrato_codigo);
  new.contrato_nombre = coalesce(new.contrato_nombre, v_ctx.contrato_nombre);
  new.cliente_nombre_snapshot = coalesce(new.cliente_nombre_snapshot, v_ctx.cliente_nombre_snapshot);
  new.cliente_nit_snapshot = coalesce(new.cliente_nit_snapshot, v_ctx.cliente_nit_snapshot);
  return new;
end;
$$;

create or replace function public.fill_qr_scan_contract_context()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token public.attendance_qr_tokens;
  v_ctx record;
begin
  if new.qr_token_id is not null then
    select * into v_token
    from public.attendance_qr_tokens
    where id = new.qr_token_id
    limit 1;
  end if;

  select * into v_ctx
  from public.resolve_contract_context(
    coalesce(new.sede_codigo, v_token.sede_codigo),
    coalesce(new.employee_id, v_token.employee_id),
    null,
    coalesce(new.documento, v_token.documento)
  );

  new.contrato_codigo = coalesce(new.contrato_codigo, v_token.contrato_codigo, v_ctx.contrato_codigo);
  new.contrato_nombre = coalesce(new.contrato_nombre, v_token.contrato_nombre, v_ctx.contrato_nombre);
  new.cliente_nombre_snapshot = coalesce(new.cliente_nombre_snapshot, v_token.cliente_nombre_snapshot, v_ctx.cliente_nombre_snapshot);
  new.cliente_nit_snapshot = coalesce(new.cliente_nit_snapshot, v_token.cliente_nit_snapshot, v_ctx.cliente_nit_snapshot);
  return new;
end;
$$;

create or replace function public.fill_incapacidad_contract_context()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
begin
  select * into v_ctx
  from public.resolve_contract_context(null, new.employee_id, null, new.documento);
  new.contrato_codigo = coalesce(new.contrato_codigo, v_ctx.contrato_codigo);
  new.contrato_nombre = coalesce(new.contrato_nombre, v_ctx.contrato_nombre);
  new.cliente_nombre_snapshot = coalesce(new.cliente_nombre_snapshot, v_ctx.cliente_nombre_snapshot);
  new.cliente_nit_snapshot = coalesce(new.cliente_nit_snapshot, v_ctx.cliente_nit_snapshot);
  return new;
end;
$$;

create or replace function public.fill_employee_shift_status_contract_context()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
begin
  select * into v_ctx
  from public.resolve_contract_context(new.sede_codigo, new.employee_id, null, new.documento);
  new.contrato_codigo = coalesce(new.contrato_codigo, v_ctx.contrato_codigo);
  new.contrato_nombre = coalesce(new.contrato_nombre, v_ctx.contrato_nombre);
  new.cliente_nombre_snapshot = coalesce(new.cliente_nombre_snapshot, v_ctx.cliente_nombre_snapshot);
  new.cliente_nit_snapshot = coalesce(new.cliente_nit_snapshot, v_ctx.cliente_nit_snapshot);
  return new;
end;
$$;

drop trigger if exists trg_attendance_qr_tokens_contract_context on public.attendance_qr_tokens;
create trigger trg_attendance_qr_tokens_contract_context
before insert or update of employee_id, documento, sede_codigo, contrato_codigo, contrato_nombre, cliente_nombre_snapshot, cliente_nit_snapshot
on public.attendance_qr_tokens
for each row execute function public.fill_qr_token_contract_context();

drop trigger if exists trg_employee_daily_exits_contract_context on public.employee_daily_exits;
create trigger trg_employee_daily_exits_contract_context
before insert or update of employee_id, documento, sede_codigo, contrato_codigo, contrato_nombre, cliente_nombre_snapshot, cliente_nit_snapshot
on public.employee_daily_exits
for each row execute function public.fill_qr_exit_contract_context();

drop trigger if exists trg_attendance_qr_scans_contract_context on public.attendance_qr_scans;
create trigger trg_attendance_qr_scans_contract_context
before insert or update of qr_token_id, employee_id, documento, sede_codigo, contrato_codigo, contrato_nombre, cliente_nombre_snapshot, cliente_nit_snapshot
on public.attendance_qr_scans
for each row execute function public.fill_qr_scan_contract_context();

drop trigger if exists trg_incapacitados_contract_context on public.incapacitados;
create trigger trg_incapacitados_contract_context
before insert or update of employee_id, documento, contrato_codigo, contrato_nombre, cliente_nombre_snapshot, cliente_nit_snapshot
on public.incapacitados
for each row execute function public.fill_incapacidad_contract_context();

drop trigger if exists trg_employee_shift_status_contract_context on public.employee_shift_status;
create trigger trg_employee_shift_status_contract_context
before insert or update of employee_id, documento, sede_codigo, contrato_codigo, contrato_nombre, cliente_nombre_snapshot, cliente_nit_snapshot
on public.employee_shift_status
for each row execute function public.fill_employee_shift_status_contract_context();

with resolved as (
  select q.id, ctx.*
  from public.attendance_qr_tokens q
  cross join lateral public.resolve_contract_context(q.sede_codigo, q.employee_id, null, q.documento) ctx
)
update public.attendance_qr_tokens q
set
  contrato_codigo = coalesce(resolved.contrato_codigo, q.contrato_codigo),
  contrato_nombre = coalesce(resolved.contrato_nombre, q.contrato_nombre),
  cliente_nombre_snapshot = coalesce(resolved.cliente_nombre_snapshot, q.cliente_nombre_snapshot),
  cliente_nit_snapshot = coalesce(resolved.cliente_nit_snapshot, q.cliente_nit_snapshot)
from resolved
where q.id = resolved.id;

with resolved as (
  select e.id, ctx.*
  from public.employee_daily_exits e
  cross join lateral public.resolve_contract_context(e.sede_codigo, e.employee_id, null, e.documento) ctx
)
update public.employee_daily_exits e
set
  contrato_codigo = coalesce(resolved.contrato_codigo, e.contrato_codigo),
  contrato_nombre = coalesce(resolved.contrato_nombre, e.contrato_nombre),
  cliente_nombre_snapshot = coalesce(resolved.cliente_nombre_snapshot, e.cliente_nombre_snapshot),
  cliente_nit_snapshot = coalesce(resolved.cliente_nit_snapshot, e.cliente_nit_snapshot)
from resolved
where e.id = resolved.id;

with resolved as (
  select s.id, ctx.*
  from public.attendance_qr_scans s
  cross join lateral public.resolve_contract_context(s.sede_codigo, s.employee_id, null, s.documento) ctx
)
update public.attendance_qr_scans s
set
  contrato_codigo = coalesce(resolved.contrato_codigo, s.contrato_codigo),
  contrato_nombre = coalesce(resolved.contrato_nombre, s.contrato_nombre),
  cliente_nombre_snapshot = coalesce(resolved.cliente_nombre_snapshot, s.cliente_nombre_snapshot),
  cliente_nit_snapshot = coalesce(resolved.cliente_nit_snapshot, s.cliente_nit_snapshot)
from resolved
where s.id = resolved.id;

with resolved as (
  select i.id, ctx.*
  from public.incapacitados i
  cross join lateral public.resolve_contract_context(null, i.employee_id, null, i.documento) ctx
)
update public.incapacitados i
set
  contrato_codigo = coalesce(resolved.contrato_codigo, i.contrato_codigo),
  contrato_nombre = coalesce(resolved.contrato_nombre, i.contrato_nombre),
  cliente_nombre_snapshot = coalesce(resolved.cliente_nombre_snapshot, i.cliente_nombre_snapshot),
  cliente_nit_snapshot = coalesce(resolved.cliente_nit_snapshot, i.cliente_nit_snapshot)
from resolved
where i.id = resolved.id;

with resolved as (
  select a.id, e.contrato_codigo, e.contrato_nombre, e.cliente_nombre_snapshot, e.cliente_nit_snapshot
  from public.employee_certificate_audit a
  left join public.employees e on e.id = a.employee_id
)
update public.employee_certificate_audit a
set
  contrato_codigo = coalesce(resolved.contrato_codigo, a.contrato_codigo),
  contrato_nombre = coalesce(resolved.contrato_nombre, a.contrato_nombre),
  cliente_nombre_snapshot = coalesce(resolved.cliente_nombre_snapshot, a.cliente_nombre_snapshot),
  cliente_nit_snapshot = coalesce(resolved.cliente_nit_snapshot, a.cliente_nit_snapshot)
from resolved
where a.id = resolved.id;

with resolved as (
  select ess.id, ctx.*
  from public.employee_shift_status ess
  cross join lateral public.resolve_contract_context(ess.sede_codigo, ess.employee_id, null, ess.documento) ctx
)
update public.employee_shift_status ess
set
  contrato_codigo = coalesce(resolved.contrato_codigo, ess.contrato_codigo),
  contrato_nombre = coalesce(resolved.contrato_nombre, ess.contrato_nombre),
  cliente_nombre_snapshot = coalesce(resolved.cliente_nombre_snapshot, ess.cliente_nombre_snapshot),
  cliente_nit_snapshot = coalesce(resolved.cliente_nit_snapshot, ess.cliente_nit_snapshot)
from resolved
where ess.id = resolved.id;

create index if not exists idx_attendance_qr_tokens_fecha_contrato on public.attendance_qr_tokens (fecha, contrato_codigo);
create index if not exists idx_employee_daily_exits_fecha_contrato on public.employee_daily_exits (fecha, contrato_codigo);
create index if not exists idx_attendance_qr_scans_fecha_contrato on public.attendance_qr_scans (fecha, contrato_codigo);
create index if not exists idx_incapacitados_fecha_contrato on public.incapacitados (fecha_inicio, fecha_fin, contrato_codigo);
create index if not exists idx_employee_shift_status_fecha_contrato on public.employee_shift_status (fecha_operativa, contrato_codigo);
create index if not exists idx_employee_certificate_audit_contrato on public.employee_certificate_audit (contrato_codigo, created_at desc);

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
        p.role::text in ('superadmin', 'admin', 'editor', 'consultor')
        or (p.role::text = 'supervisor' and p.supervisor_eligible = true)
      )
  );
$$;

drop policy if exists "attendance_qr_tokens_admin_read" on public.attendance_qr_tokens;
drop policy if exists "attendance_qr_tokens_registry_read" on public.attendance_qr_tokens;
create policy "attendance_qr_tokens_registry_read"
on public.attendance_qr_tokens
for select
to authenticated
using (
  public.can_view_qr_registry()
  and public.can_read_operational_sede_or_employee(sede_codigo, employee_id, documento)
  and (contrato_codigo is null or public.can_read_contract_data(contrato_codigo))
);

drop policy if exists "employee_daily_exits_read_authenticated" on public.employee_daily_exits;
create policy "employee_daily_exits_read_authenticated"
on public.employee_daily_exits
for select
to authenticated
using (
  public.can_read_operational_sede_or_employee(sede_codigo, employee_id, documento)
  and (contrato_codigo is null or public.can_read_contract_data(contrato_codigo))
);

drop policy if exists "attendance_qr_scans_admin_read" on public.attendance_qr_scans;
drop policy if exists "attendance_qr_scans_read_authenticated" on public.attendance_qr_scans;
create policy "attendance_qr_scans_read_authenticated"
on public.attendance_qr_scans
for select
to authenticated
using (
  public.can_view_qr_registry()
  and (contrato_codigo is null or public.can_read_contract_data(contrato_codigo))
);

drop policy if exists "incapacitados_write_admin" on public.incapacitados;
drop policy if exists "incapacitados_write_active_user" on public.incapacitados;
drop policy if exists "incapacitados_read_authenticated" on public.incapacitados;
drop policy if exists "incapacitados_insert_authenticated" on public.incapacitados;
drop policy if exists "incapacitados_update_authenticated" on public.incapacitados;
drop policy if exists "incapacitados_delete_authenticated" on public.incapacitados;
create policy "incapacitados_read_authenticated"
on public.incapacitados
for select
to authenticated
using (
  public.can_read_employee_data(employee_id, documento)
  and (contrato_codigo is null or public.can_read_contract_data(contrato_codigo))
);

create policy "incapacitados_insert_authenticated"
on public.incapacitados
for insert
to authenticated
with check (
  public.is_active_authenticated_user()
  and public.can_read_employee_data(employee_id, documento)
  and (contrato_codigo is null or public.can_read_contract_data(contrato_codigo))
);

create policy "incapacitados_update_authenticated"
on public.incapacitados
for update
to authenticated
using (
  public.is_active_authenticated_user()
  and public.can_read_employee_data(employee_id, documento)
  and (contrato_codigo is null or public.can_read_contract_data(contrato_codigo))
)
with check (
  public.is_active_authenticated_user()
  and public.can_read_employee_data(employee_id, documento)
  and (contrato_codigo is null or public.can_read_contract_data(contrato_codigo))
);

create policy "incapacitados_delete_authenticated"
on public.incapacitados
for delete
to authenticated
using (
  public.is_active_authenticated_user()
  and public.can_read_employee_data(employee_id, documento)
  and (contrato_codigo is null or public.can_read_contract_data(contrato_codigo))
);

drop policy if exists "employee_certificate_audit_read_admin" on public.employee_certificate_audit;
create policy "employee_certificate_audit_read_admin"
on public.employee_certificate_audit
for select
to authenticated
using (
  public.current_profile_is_internal_user()
  or (contrato_codigo is not null and public.can_read_contract_data(contrato_codigo))
);

drop policy if exists "employee_shift_status_read_authenticated" on public.employee_shift_status;
create policy "employee_shift_status_read_authenticated"
on public.employee_shift_status
for select
to authenticated
using (
  public.current_profile_is_internal_user()
  or (
    public.can_read_operational_sede_or_employee(sede_codigo, employee_id, documento)
    and (contrato_codigo is null or public.can_read_contract_data(contrato_codigo))
  )
);
