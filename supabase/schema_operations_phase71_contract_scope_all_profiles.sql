-- Phase 71: every profile except superadmin works only inside its assigned contracts.
-- Apply after phase 70.
--
-- Until now admin and editor (Coordinador) counted as "internal users" and skipped the contract
-- filter; only consultor honoured its assignments. On top of that, the *_write_admin policies were
-- FOR ALL using (is_admin_like()), and a FOR ALL policy also grants SELECT, so an admin read every
-- contract even when the read policy was scoped. From here on:
--   * superadmin is the only profile with access to every contract;
--   * admin, editor, consultor and supervisor see only the contracts in profile_contract_access,
--     which is the single source of truth (profiles.contrato_codigo / contratos_permitidos remain a
--     cache synced by the phase 42 trigger);
--   * supervisors keep their zone scope, intersected with their contracts;
--   * modules still come from roles_matrix / user_overrides and apply inside those contracts.
begin;

-- ---------------------------------------------------------------------------
-- Scope functions
-- ---------------------------------------------------------------------------

-- Superadmin is the only profile that is not limited by contract. Every policy and function that
-- used this as a contract bypass (employees, shifts, supernumerarios, templates...) follows it.
create or replace function public.current_profile_is_internal_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_superadmin();
$$;

-- Contracts assigned to the current profile. Only profile_contract_access counts: the profile
-- columns are a cache and can be written by any admin, so they never grant access by themselves.
create or replace function public.current_profile_contract_codes()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array(
    select distinct trim(pca.contrato_codigo)
    from public.profile_contract_access pca
    join public.profiles p on p.id = pca.user_id
    where p.id = auth.uid()
      and p.estado = 'activo'
      and p.role::text in ('admin', 'editor', 'consultor', 'supervisor')
      and lower(trim(coalesce(pca.estado, 'activo'))) = 'activo'
      and nullif(trim(pca.contrato_codigo), '') is not null
    order by 1
  ), '{}'::text[]);
$$;

-- Contract-wide data access. A supervisor ("Supervisor Zona") never reads a whole contract: its
-- contracts only narrow its zones (see current_supervisor_can_read_zone).
create or replace function public.current_profile_has_contract_access(contract_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(trim(contract_code), '') = any(public.current_profile_contract_codes())
    and not exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'supervisor'
    ),
    false
  );
$$;

-- A supervisor reads a zone only when it is one of its zones AND belongs to one of its contracts.
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
    join public.zones z on z.codigo = nullif(trim(zone_code), '')
    where p.id = auth.uid()
      and p.estado = 'activo'
      and p.role::text = 'supervisor'
      and p.supervisor_eligible = true
      and (
        z.codigo = nullif(trim(p.zona_codigo), '')
        or z.codigo = any(coalesce(p.zonas_permitidas, '{}'::text[]))
      )
      and z.contrato_codigo = any(public.current_profile_contract_codes())
  );
$$;

-- Users an admin (or a viewUsers profile) may see and manage: those with a contract it can read.
-- Users without any assignment are visible too, so they can be onboarded. Superadmins are never
-- visible to (nor editable by) anyone else.
create or replace function public.can_manage_profile(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null and (
    public.is_superadmin()
    or (
      (public.is_admin_like() or public.current_profile_has_permission('viewUsers', 'manageUsers'))
      and exists (
        select 1 from public.profiles t where t.id = p_user_id and t.role::text <> 'superadmin'
      )
      and (
        exists (
          select 1
          from public.profile_contract_access pca
          where pca.user_id = p_user_id
            and lower(trim(coalesce(pca.estado, 'activo'))) = 'activo'
            and public.can_read_contract_data(pca.contrato_codigo)
        )
        or not exists (
          select 1
          from public.profile_contract_access pca
          where pca.user_id = p_user_id
            and lower(trim(coalesce(pca.estado, 'activo'))) = 'activo'
        )
      )
    )
  );
$$;

grant execute on function public.can_manage_profile(uuid) to authenticated;

grant execute on function public.current_profile_is_internal_user() to authenticated;
grant execute on function public.current_profile_has_contract_access(text) to authenticated;
grant execute on function public.current_profile_contract_codes() to authenticated;
grant execute on function public.current_supervisor_can_read_zone(text) to authenticated;

-- ---------------------------------------------------------------------------
-- One-time backfill (the release bundle wraps it in rocky_run_once)
-- ---------------------------------------------------------------------------
-- 1. Codes that only lived in the legacy profile columns become real assignments.
-- 2. Profiles with no assignment at all keep today's access, assigned explicitly so it shows checked
--    in Usuarios > Asignar contratos and a superadmin can trim it: admin and editor get every
--    contract; supervisors get the contracts of their zones. Consultor keeps exactly what it had.
insert into public.profile_contract_access (user_id, contrato_codigo, estado, created_by_email)
select distinct src.user_id, c.codigo, 'activo', 'migracion@fase71'
from (
  select p.id as user_id, nullif(trim(legacy.code), '') as code
  from public.profiles p
  cross join lateral unnest(array_append(coalesce(p.contratos_permitidos, '{}'::text[]), p.contrato_codigo)) as legacy(code)
  where p.role::text <> 'superadmin'
  union
  select p.id, case when p.role::text = 'supervisor' then z.contrato_codigo else c.codigo end
  from public.profiles p
  cross join public.contracts c
  left join public.zones z
    on p.role::text = 'supervisor'
    and z.contrato_codigo = c.codigo
    and (z.codigo = nullif(trim(p.zona_codigo), '') or z.codigo = any(coalesce(p.zonas_permitidas, '{}'::text[])))
  where p.role::text in ('admin', 'editor', 'supervisor')
    and coalesce(p.estado, 'activo') <> 'eliminado'
    and nullif(trim(p.contrato_codigo), '') is null
    and coalesce(array_length(p.contratos_permitidos, 1), 0) = 0
    and not exists (select 1 from public.profile_contract_access pca where pca.user_id = p.id)
) src
join public.contracts c on c.codigo = src.code
on conflict (user_id, contrato_codigo) do nothing;

-- ---------------------------------------------------------------------------
-- Contract assignments
-- ---------------------------------------------------------------------------
-- An admin only sees and grants the contracts it has itself, so it cannot widen anyone's scope
-- (its own included) beyond its own.
drop policy if exists "profile_contract_access_select" on public.profile_contract_access;
create policy "profile_contract_access_select"
on public.profile_contract_access
for select
to authenticated
using (
  user_id = auth.uid()
  or (public.current_profile_can_manage_contract_access() and public.can_read_contract_data(contrato_codigo) and public.can_manage_profile(user_id))
);

drop policy if exists "profile_contract_access_insert" on public.profile_contract_access;
create policy "profile_contract_access_insert"
on public.profile_contract_access
for insert
to authenticated
with check (public.current_profile_can_manage_contract_access() and public.can_read_contract_data(contrato_codigo) and public.can_manage_profile(user_id));

drop policy if exists "profile_contract_access_update" on public.profile_contract_access;
create policy "profile_contract_access_update"
on public.profile_contract_access
for update
to authenticated
using (public.current_profile_can_manage_contract_access() and public.can_read_contract_data(contrato_codigo) and public.can_manage_profile(user_id))
with check (public.current_profile_can_manage_contract_access() and public.can_read_contract_data(contrato_codigo) and public.can_manage_profile(user_id));

drop policy if exists "profile_contract_access_delete" on public.profile_contract_access;
create policy "profile_contract_access_delete"
on public.profile_contract_access
for delete
to authenticated
using (public.current_profile_can_manage_contract_access() and public.can_read_contract_data(contrato_codigo) and public.can_manage_profile(user_id));

-- Same protection as phase 42, except that the contract cache of one's own profile may change when
-- it only mirrors profile_contract_access (the phase 42 sync, e.g. after creating a contract).
create or replace function public.protect_profile_self_service_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_uid uuid := auth.uid();
  current_is_superadmin boolean := public.is_superadmin();
  synced_codes text[];
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
      new.contrato_codigo := null;
      new.contratos_permitidos := '{}'::text[];
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
      if new.contrato_codigo is distinct from old.contrato_codigo
        or new.contratos_permitidos is distinct from old.contratos_permitidos
      then
        -- Same expression as sync_profile_contract_fields (phase 42).
        select coalesce(array_agg(code order by code), '{}'::text[])
        into synced_codes
        from (
          select distinct nullif(trim(pca.contrato_codigo), '') as code
          from public.profile_contract_access pca
          where pca.user_id = old.id
            and lower(trim(coalesce(pca.estado, 'activo'))) = 'activo'
            and nullif(trim(pca.contrato_codigo), '') is not null
        ) codes;
      end if;

      if new.role is distinct from old.role
        or new.estado is distinct from old.estado
        or new.supervisor_eligible is distinct from old.supervisor_eligible
        or new.zona_codigo is distinct from old.zona_codigo
        or new.zonas_permitidas is distinct from old.zonas_permitidas
        or (
          synced_codes is not null
          and (
            new.contratos_permitidos is distinct from synced_codes
            or new.contrato_codigo is distinct from synced_codes[1]
          )
        )
        or new.created_by_uid is distinct from old.created_by_uid
        or new.created_by_email is distinct from old.created_by_email
        or new.last_modified_by_uid is distinct from old.last_modified_by_uid
        or new.last_modified_by_email is distinct from old.last_modified_by_email
        or new.deleted_at is distinct from old.deleted_at
        or new.deleted_by_uid is distinct from old.deleted_by_uid
        or new.deleted_by_email is distinct from old.deleted_by_email
      then
        raise exception 'No puedes modificar rol, estado, zonas, contratos ni campos administrativos de tu propio perfil.';
      end if;
    end if;
    return new;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Contracts
-- ---------------------------------------------------------------------------
-- Whoever creates a contract (other than superadmin) is assigned to it, or it would vanish for them.
create or replace function public.grant_contract_access_to_creator()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null
    and not public.is_superadmin()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.estado = 'activo')
  then
    insert into public.profile_contract_access (user_id, contrato_codigo, estado, created_by_uid, created_by_email)
    values (auth.uid(), new.codigo, 'activo', auth.uid(), new.created_by_email)
    on conflict (user_id, contrato_codigo) do update
      set estado = 'activo', updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_contracts_grant_creator_access on public.contracts;
create trigger trg_contracts_grant_creator_access
after insert on public.contracts
for each row execute function public.grant_contract_access_to_creator();

-- Every assigned profile (supervisors included) reads the contract header to pick it. The insert's
-- RETURNING is checked before the trigger's assignment is visible, so the creator also reads the
-- row inside the same transaction (created_at defaults to now(), the transaction start).
drop policy if exists "contracts_read_authenticated" on public.contracts;
create policy "contracts_read_authenticated"
on public.contracts
for select
to authenticated
using (
  public.can_read_contract_data(codigo)
  or codigo = any(public.current_profile_contract_codes())
  or (created_by_uid = auth.uid() and created_at = now())
);

drop policy if exists "contracts_write_admin" on public.contracts;
drop policy if exists "contracts_insert_admin" on public.contracts;
create policy "contracts_insert_admin"
on public.contracts
for insert
to authenticated
with check (public.is_admin_like());

-- The new code is not assigned yet while a rename is checked, so only the old row is scoped.
drop policy if exists "contracts_update_admin" on public.contracts;
create policy "contracts_update_admin"
on public.contracts
for update
to authenticated
using (public.is_admin_like() and public.can_read_contract_data(codigo))
with check (public.is_admin_like());

drop policy if exists "contracts_delete_admin" on public.contracts;
create policy "contracts_delete_admin"
on public.contracts
for delete
to authenticated
using (public.is_admin_like() and public.can_read_contract_data(codigo));

-- ---------------------------------------------------------------------------
-- Contract-scoped tables: split FOR ALL admin policies into insert/update/delete
-- ---------------------------------------------------------------------------
-- Each scope matches the table's read policy, so an admin writes only rows it can read.
do $$
declare
  r record;
begin
  for r in
    select *
    from (values
      ('zones', 'zones_write_admin', 'public.can_read_contract_data(contrato_codigo)'),
      ('dependencies', 'dependencies_write_admin', 'public.can_read_contract_data(contrato_codigo)'),
      ('sedes', 'sedes_write_admin', 'public.can_read_contract_data(contrato_codigo)'),
      ('contract_cargos', 'contract_cargos_write_admin', 'public.can_read_contract_data(contrato_codigo)'),
      ('shift_templates', 'shift_templates_write_admin', 'public.can_read_contract_data(contrato_codigo)'),
      ('daily_contract_metrics', 'daily_contract_metrics_write_admin', 'public.can_read_contract_data(contrato_codigo)'),
      ('attendance', 'attendance_write_admin', 'public.can_read_contract_data(contrato_codigo) or public.can_read_operational_sede_or_employee(sede_codigo, empleado_id, documento)'),
      ('absenteeism', 'absenteeism_write_admin', 'public.can_read_contract_data(contrato_codigo) or public.can_read_operational_sede_or_employee(sede_codigo, empleado_id, documento)'),
      ('import_replacements', 'import_replacements_write_admin', 'public.can_read_contract_data(contrato_codigo) or public.can_read_operational_sede_or_employee(sede_codigo, empleado_id, documento)'),
      ('sede_status', 'sede_status_write_admin', 'public.can_read_contract_data(contrato_codigo) or public.can_read_sede_data(sede_codigo)'),
      ('daily_sede_closures', 'daily_sede_closures_write_admin', 'public.can_read_contract_data(contrato_codigo) or public.can_read_zone_data(zona_codigo) or public.can_read_sede_data(sede_codigo)'),
      ('employee_daily_status', 'employee_daily_status_write_admin', 'public.can_read_contract_data(contrato_codigo) or public.can_read_zone_data(zona_codigo_snapshot) or public.can_read_sede_data(sede_codigo)'),
      ('employee_daily_exits', 'employee_daily_exits_write_admin', 'public.can_read_operational_sede_or_employee(sede_codigo, employee_id, documento) and (contrato_codigo is null or public.can_read_contract_data(contrato_codigo))'),
      ('sede_devices', 'sede_devices_write_admin', 'public.can_read_sede_data(sede_codigo)'),
      ('sede_device_sites', 'sede_device_sites_write_admin', 'public.can_read_sede_data(sede_codigo)'),
      ('supervisor_profile', 'supervisor_profile_write_admin', 'public.can_read_zone_data(zona_codigo) or public.can_read_sede_data(sede_codigo)'),
      ('scheduled_shifts', 'scheduled_shifts_write_admin', 'public.can_read_shift_contract_data(contrato_codigo, null, sede_codigo, null, null)'),
      ('shift_site_plan_assignments', 'shift_site_plan_assignments_write_admin', 'public.can_read_shift_contract_data(contrato_codigo, null, sede_codigo, null, null)'),
      ('shift_assignments', 'shift_assignments_write_admin', 'public.can_read_shift_contract_data(contrato_codigo, scheduled_shift_id, sede_codigo, employee_id, documento)'),
      ('employee_shift_status', 'employee_shift_status_write_admin', 'public.can_read_shift_contract_data(contrato_codigo, scheduled_shift_id, sede_codigo, employee_id, documento)'),
      ('shift_closures', 'shift_closures_write_admin', 'public.can_read_shift_contract_data(contrato_codigo, scheduled_shift_id, sede_codigo, null, null)'),
      ('shift_adjustments', 'shift_adjustments_write_admin', 'public.can_read_shift_contract_data(contrato_codigo, scheduled_shift_id, null, employee_id, documento)'),
      ('shift_time_authorizations', 'shift_time_authorizations_write_admin', 'public.can_read_shift_contract_data(contrato_codigo, scheduled_shift_id, null, employee_id, documento)')
    ) as t(tbl, old_policy, scope)
  loop
    if to_regclass('public.' || r.tbl) is null then
      continue;
    end if;
    execute format('drop policy if exists %I on public.%I', r.old_policy, r.tbl);
    execute format('drop policy if exists %I on public.%I', r.tbl || '_insert_admin', r.tbl);
    execute format('drop policy if exists %I on public.%I', r.tbl || '_update_admin', r.tbl);
    execute format('drop policy if exists %I on public.%I', r.tbl || '_delete_admin', r.tbl);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.is_admin_like() and (%s))',
      r.tbl || '_insert_admin', r.tbl, r.scope
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.is_admin_like() and (%s)) with check (public.is_admin_like() and (%s))',
      r.tbl || '_update_admin', r.tbl, r.scope, r.scope
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.is_admin_like() and (%s))',
      r.tbl || '_delete_admin', r.tbl, r.scope
    );
  end loop;
end;
$$;

-- Employees: admins and editEmployees holders write only employees they can read. Inserts and moves
-- are checked against the destination (contract, zone or sede), as phase 21 did for supervisors.
drop policy if exists "employees_write_admin" on public.employees;
drop policy if exists "employees_insert_admin" on public.employees;
create policy "employees_insert_admin"
on public.employees
for insert
to authenticated
with check (
  (
    public.is_admin_like()
    and (public.can_read_contract_data(contrato_codigo) or public.can_read_sede_data(sede_codigo))
  )
  or (
    public.current_profile_has_permission('editEmployees', 'manageEmployees')
    and (public.current_supervisor_can_read_zone(zona_codigo) or public.can_read_sede_data(sede_codigo))
  )
);

drop policy if exists "employees_update_admin" on public.employees;
create policy "employees_update_admin"
on public.employees
for update
to authenticated
using (
  (public.is_admin_like() or public.current_profile_has_permission('editEmployees', 'manageEmployees'))
  and public.can_read_employee_data(id, documento)
)
with check (
  (
    public.is_admin_like()
    and (public.can_read_contract_data(contrato_codigo) or public.can_read_sede_data(sede_codigo))
  )
  or (
    public.current_profile_has_permission('editEmployees', 'manageEmployees')
    and (public.current_supervisor_can_read_zone(zona_codigo) or public.can_read_sede_data(sede_codigo))
  )
);

drop policy if exists "employees_delete_admin" on public.employees;
create policy "employees_delete_admin"
on public.employees
for delete
to authenticated
using (
  (public.is_admin_like() or public.current_profile_has_permission('editEmployees', 'manageEmployees'))
  and public.can_read_employee_data(id, documento)
);

drop policy if exists "employee_cargo_history_write_admin" on public.employee_cargo_history;
drop policy if exists "employee_cargo_history_insert_admin" on public.employee_cargo_history;
create policy "employee_cargo_history_insert_admin"
on public.employee_cargo_history
for insert
to authenticated
with check (
  (public.is_admin_like() or public.current_profile_has_permission('editEmployees', 'manageEmployees'))
  and public.can_read_employee_data(employee_id, documento)
);

drop policy if exists "employee_cargo_history_update_admin" on public.employee_cargo_history;
create policy "employee_cargo_history_update_admin"
on public.employee_cargo_history
for update
to authenticated
using (
  (public.is_admin_like() or public.current_profile_has_permission('editEmployees', 'manageEmployees'))
  and public.can_read_employee_data(employee_id, documento)
)
with check (
  (public.is_admin_like() or public.current_profile_has_permission('editEmployees', 'manageEmployees'))
  and public.can_read_employee_data(employee_id, documento)
);

drop policy if exists "employee_cargo_history_delete_admin" on public.employee_cargo_history;
create policy "employee_cargo_history_delete_admin"
on public.employee_cargo_history
for delete
to authenticated
using (
  (public.is_admin_like() or public.current_profile_has_permission('editEmployees', 'manageEmployees'))
  and public.can_read_employee_data(employee_id, documento)
);

-- ---------------------------------------------------------------------------
-- Company-wide tables without contract: totals of every contract, superadmin only
-- ---------------------------------------------------------------------------
-- The backend writes them with the service role; their FOR ALL admin policies also opened reads.
drop policy if exists "daily_metrics_write_admin" on public.daily_metrics;
drop policy if exists "daily_metrics_read_authenticated" on public.daily_metrics;
create policy "daily_metrics_read_authenticated"
on public.daily_metrics
for select
to authenticated
using (public.is_superadmin());

drop policy if exists "daily_metrics_write_superadmin" on public.daily_metrics;
create policy "daily_metrics_write_superadmin"
on public.daily_metrics
for all
to authenticated
using (public.is_superadmin())
with check (public.is_superadmin());

drop policy if exists "daily_closures_write_admin" on public.daily_closures;
drop policy if exists "daily_closures_read_authenticated" on public.daily_closures;
create policy "daily_closures_read_authenticated"
on public.daily_closures
for select
to authenticated
using (public.is_superadmin());

drop policy if exists "daily_closures_write_superadmin" on public.daily_closures;
create policy "daily_closures_write_superadmin"
on public.daily_closures
for all
to authenticated
using (public.is_superadmin())
with check (public.is_superadmin());

-- Whether a day is closed is not contract data, but its totals are: every active user reads the
-- closure status with totals summed only over the contracts it can read (all of them for superadmin).
create or replace view public.daily_closures_scoped
with (security_invoker = false)
as
select
  dc.id,
  dc.fecha,
  dc.status,
  dc.locked,
  dc.closed_by_uid,
  dc.closed_by_email,
  dc.closed_at,
  dc.created_at,
  dc.updated_at,
  coalesce(m.planeados, 0) as planeados,
  coalesce(m.contratados, 0) as contratados,
  coalesce(m.asistencias, 0) as asistencias,
  coalesce(m.ausentismos, 0) as ausentismos,
  coalesce(m.pagados, 0) as pagados,
  coalesce(m.no_contratados, 0) as no_contratados,
  coalesce(m.faltan, 0) as faltan,
  coalesce(m.sobran, 0) as sobran
from public.daily_closures dc
left join lateral (
  select
    sum(dcm.planeados)::integer as planeados,
    sum(dcm.contratados)::integer as contratados,
    sum(dcm.asistencias)::integer as asistencias,
    sum(dcm.ausentismos)::integer as ausentismos,
    sum(dcm.pagados)::integer as pagados,
    sum(dcm.no_contratados)::integer as no_contratados,
    sum(dcm.faltan)::integer as faltan,
    sum(dcm.sobran)::integer as sobran
  from public.daily_contract_metrics dcm
  where dcm.fecha = dc.fecha
    and public.can_read_contract_data(dcm.contrato_codigo)
) m on true
where public.is_active_authenticated_user();

revoke all on public.daily_closures_scoped from public, anon;
grant select on public.daily_closures_scoped to authenticated;

-- Import confirmations (legacy load): admins record them and read only their own.
drop policy if exists "import_history_write_admin" on public.import_history;
drop policy if exists "import_history_read_authenticated" on public.import_history;
create policy "import_history_read_authenticated"
on public.import_history
for select
to authenticated
using (public.is_superadmin() or confirmado_por_uid = auth.uid());

drop policy if exists "import_history_insert_admin" on public.import_history;
create policy "import_history_insert_admin"
on public.import_history
for insert
to authenticated
with check (public.is_superadmin() or (public.is_admin_like() and confirmado_por_uid = auth.uid()));

drop policy if exists "import_history_manage_superadmin" on public.import_history;
create policy "import_history_manage_superadmin"
on public.import_history
for update
to authenticated
using (public.is_superadmin())
with check (public.is_superadmin());

drop policy if exists "import_history_delete_superadmin" on public.import_history;
create policy "import_history_delete_superadmin"
on public.import_history
for delete
to authenticated
using (public.is_superadmin());

-- Left by an earlier draft of this phase; nothing uses it any more.
drop function if exists public.current_profile_is_staff_user();

-- ---------------------------------------------------------------------------
-- Users: an admin sees and manages only the users of its contracts
-- ---------------------------------------------------------------------------

drop policy if exists "profiles_select_self_or_admin" on public.profiles;
create policy "profiles_select_self_or_admin"
on public.profiles
for select
to authenticated
using (auth.uid() = id or public.can_manage_profile(id));

drop policy if exists "profiles_update_self_or_admin" on public.profiles;
create policy "profiles_update_self_or_admin"
on public.profiles
for update
to authenticated
using (auth.uid() = id or (public.is_admin_like() and public.can_manage_profile(id)))
with check (auth.uid() = id or (public.is_admin_like() and public.can_manage_profile(id)));

-- Only a superadmin grants or removes the superadmin role.
create or replace function public.protect_superadmin_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_superadmin() then
    return new;
  end if;
  if new.role::text = 'superadmin'
    and (tg_op = 'INSERT' or old.role is distinct from new.role)
  then
    raise exception 'Solo un SuperAdmin puede asignar el rol SuperAdmin.';
  end if;
  if tg_op = 'UPDATE' and old.role::text = 'superadmin' then
    raise exception 'Solo un SuperAdmin puede modificar a otro SuperAdmin.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_protect_superadmin_role on public.profiles;
create trigger trg_profiles_protect_superadmin_role
before insert or update on public.profiles
for each row execute function public.protect_superadmin_role();

-- ---------------------------------------------------------------------------
-- Audit: entries of one's own contracts, users and employees
-- ---------------------------------------------------------------------------
alter table public.audit_logs
  add column if not exists contrato_codigo text;

create index if not exists idx_audit_logs_contrato_created
  on public.audit_logs (contrato_codigo, created_at desc);

create or replace function public.can_read_audit_log(
  p_actor_uid uuid,
  p_target_type text,
  p_target_id text,
  p_contrato_codigo text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_superadmin()
    or p_actor_uid = auth.uid()
    or (
      (public.is_admin_like() or public.current_profile_has_permission('viewAudit', 'managePermissions'))
      and (
        (nullif(trim(p_contrato_codigo), '') is not null and public.can_read_contract_data(p_contrato_codigo))
        -- CASE keeps the uuid cast from running on targets that are not uuids.
        or case
          when p_target_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then false
          when p_target_type = 'user' then public.can_manage_profile(p_target_id::uuid)
          when p_target_type = 'employee' then public.can_read_employee_data(p_target_id::uuid, null)
          else false
        end
      )
    );
$$;

grant execute on function public.can_read_audit_log(uuid, text, text, text) to authenticated;

drop policy if exists "audit_logs_read_admin_like" on public.audit_logs;
create policy "audit_logs_read_admin_like"
on public.audit_logs
for select
to authenticated
using (public.can_read_audit_log(actor_uid, target_type, target_id, contrato_codigo));

-- Nobody writes entries in someone else's name or into a contract it cannot read.
drop policy if exists "audit_logs_insert_active_user" on public.audit_logs;
create policy "audit_logs_insert_active_user"
on public.audit_logs
for insert
to authenticated
with check (
  public.is_active_authenticated_user()
  and actor_uid = auth.uid()
  and (
    contrato_codigo is null
    or public.can_read_contract_data(contrato_codigo)
    or contrato_codigo = any(public.current_profile_contract_codes())
  )
);

-- ---------------------------------------------------------------------------
-- Backend-only search RPCs (WhatsApp bot): they return every sede / employee without scope
-- ---------------------------------------------------------------------------
revoke execute on function public.search_active_sedes(text, integer) from public, anon, authenticated;
revoke execute on function public.find_employee_candidates_by_phone(text, integer) from public, anon, authenticated;
grant execute on function public.search_active_sedes(text, integer) to service_role;
grant execute on function public.find_employee_candidates_by_phone(text, integer) to service_role;

commit;
