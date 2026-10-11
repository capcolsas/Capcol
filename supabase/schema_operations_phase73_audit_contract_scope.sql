-- Phase 73: every audit entry belongs to the contract of what it changed.
-- Apply after phase 72.
--
-- Phase 71 tagged entries with the contract selected in the app, but entries written by the backend
-- (shift closures), by SQL functions (shift review decisions) or before phase 71 had none, so only a
-- superadmin saw them. And an entry of contract B was also visible to an admin of A when its target
-- (a user or employee) belonged to both. From here on:
--   * the contract is derived from the target (employee, sede, shift, rotation...) on insert, and
--     legacy entries are backfilled the same way;
--   * an entry with a contract is visible only to whoever can read that contract;
--   * company-wide entries (users, roles, profiles, catalogs, day closures) carry no contract: a
--     superadmin sees them, and a user entry also the admins that manage that user.
begin;

-- Contract of the row an audit entry points to, or null when it is company-wide or unknown.
create or replace function public.audit_target_contract(p_target_type text, p_target_id text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id text := nullif(trim(p_target_id), '');
  v_uuid uuid;
  v_code text;
begin
  if v_id is null then
    return null;
  end if;
  if v_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_uuid := v_id::uuid;
  end if;

  case p_target_type
    when 'contract' then
      select c.codigo into v_code from public.contracts c where c.id = v_uuid or c.codigo = v_id limit 1;
    when 'zone' then
      select z.contrato_codigo into v_code from public.zones z where z.id = v_uuid or z.codigo = v_id limit 1;
    when 'dependency' then
      select d.contrato_codigo into v_code from public.dependencies d where d.id = v_uuid or d.codigo = v_id limit 1;
    when 'sede' then
      select s.contrato_codigo into v_code from public.sedes s where s.id = v_uuid or s.codigo = v_id limit 1;
    when 'sede_device' then
      select s.contrato_codigo into v_code
      from public.sede_devices sd join public.sedes s on s.codigo = sd.sede_codigo
      where sd.id = v_uuid limit 1;
    when 'supervisor' then
      select z.contrato_codigo into v_code
      from public.supervisor_profile sp join public.zones z on z.codigo = sp.zona_codigo
      where sp.id = v_uuid limit 1;
    when 'employee', 'supernumerario' then
      select e.contrato_codigo into v_code from public.employees e where e.id = v_uuid or e.documento = v_id limit 1;
    when 'shift_rotation' then
      select r.contrato_codigo into v_code from public.shift_rotations r where r.id = v_uuid limit 1;
    when 'shift_template' then
      select t.contrato_codigo into v_code from public.shift_templates t where t.id = v_uuid limit 1;
    when 'scheduled_shift' then
      select ss.contrato_codigo into v_code from public.scheduled_shifts ss where ss.id = v_uuid limit 1;
    when 'shift_site_plan_assignment' then
      select a.contrato_codigo into v_code from public.shift_site_plan_assignments a where a.id = v_uuid limit 1;
    when 'shift_closure' then
      select sc.contrato_codigo into v_code from public.shift_closures sc where sc.id = v_id limit 1;
    when 'employee_shift_status' then
      select es.contrato_codigo into v_code from public.employee_shift_status es where es.id = v_id limit 1;
    else
      v_code := null;
  end case;
  return nullif(trim(v_code), '');
exception
  -- A project without one of these tables or columns simply gets no contract for that target.
  when undefined_table or undefined_column then
    return null;
end;
$$;

-- Targets that are company-wide by nature never carry the contract selected in the app.
create or replace function public.audit_log_is_company_wide(p_target_type text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_target_type, '') in ('user', 'role', 'access_profile', 'cargo', 'novedad', 'daily_closure');
$$;

create or replace function public.set_audit_log_contract()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.audit_log_is_company_wide(new.target_type) then
    new.contrato_codigo := null;
  else
    -- The target is authoritative; the app's selected contract only covers entries without target.
    new.contrato_codigo := coalesce(
      public.audit_target_contract(new.target_type, new.target_id),
      nullif(trim(new.contrato_codigo), '')
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_audit_logs_set_contract on public.audit_logs;
create trigger trg_audit_logs_set_contract
before insert on public.audit_logs
for each row execute function public.set_audit_log_contract();

-- Legacy entries (the release bundle wraps it in rocky_run_once).
update public.audit_logs al
set contrato_codigo = public.audit_target_contract(al.target_type, al.target_id)
where al.contrato_codigo is null
  and not public.audit_log_is_company_wide(al.target_type)
  and al.target_id is not null;

-- An entry with a contract is decided by that contract alone; company-wide entries by their target.
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
  select case
    when public.is_superadmin() then true
    -- One's own entries, while one still works on their contract.
    when p_actor_uid = auth.uid() then
      nullif(trim(p_contrato_codigo), '') is null
      or p_contrato_codigo = any(public.current_profile_contract_codes())
      or public.can_read_contract_data(p_contrato_codigo)
    -- Other people's entries need the audit permission (or the admin role).
    when not (public.is_admin_like() or public.current_profile_has_permission('viewAudit', 'managePermissions')) then false
    when nullif(trim(p_contrato_codigo), '') is not null then public.can_read_contract_data(p_contrato_codigo)
    -- CASE keeps the uuid cast from running on targets that are not uuids.
    when coalesce(p_target_id, '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then false
    when p_target_type = 'user' then public.can_manage_profile(p_target_id::uuid)
    else false
  end;
$$;

grant execute on function public.audit_target_contract(text, text) to authenticated;
grant execute on function public.audit_log_is_company_wide(text) to authenticated;
grant execute on function public.can_read_audit_log(uuid, text, text, text) to authenticated;

commit;
