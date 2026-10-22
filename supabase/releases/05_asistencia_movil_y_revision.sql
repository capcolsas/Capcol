-- ============================================================
-- Rocky | 05 Asistencia movil, alertas, revision y descansos
-- Generado por supabase/build_release_bundles.mjs. NO editar a mano.
--
-- Idempotente: sirve para un proyecto nuevo y para actualizar uno existente.
-- Ejecutar en orden 01 -> 05 en el editor SQL de Supabase (o con psql).
-- Fuentes incluidas (14):
--   schema_operations_phase60_mobile_attendance.sql
--   schema_operations_phase61_attendance_alert_thresholds.sql
--   schema_operations_phase63_shift_review_decisions.sql
--   schema_operations_phase64_rotation_weekly_rest.sql
--   schema_operations_phase66_rotation_business_rules.sql
--   schema_operations_phase67_shift_status_payroll_sync.sql
--   schema_operations_phase68_backfill_pending_exits.sql
--   schema_operations_phase69_shift_labor_limits.sql
--   schema_operations_phase70_site_visit_permissions.sql
--   schema_operations_phase71_contract_scope_all_profiles.sql
--   schema_operations_phase72_access_profiles.sql
--   schema_operations_phase73_audit_contract_scope.sql
--   schema_operations_phase74_employee_residence_emergency.sql
--   schema_operations_phase75_whatsapp_flows.sql
-- ============================================================

-- >>>>>>>>>> schema_operations_phase60_mobile_attendance.sql
-- Apply after phase 59, before deploying the mobile marking backend/frontend.
begin;
alter table public.cargos add column if not exists marcacion_movil boolean not null default false;
alter table public.attendance add column if not exists marking_sede_codigo text, add column if not exists marking_sede_nombre text;
alter table public.employee_daily_exits add column if not exists marking_sede_codigo text, add column if not exists marking_sede_nombre text;

-- Shared policy for WhatsApp and the transactional marking RPC. Never trust a session flag.
create or replace function public.attendance_site_options(p_employee_id uuid, p_shift_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public
as $$
declare
  v_employee public.employees%rowtype;
  v_shift public.scheduled_shifts%rowtype;
  v_cargo text;
  v_mobile boolean := false;
  v_alignment text;
  v_zone text;
  v_contract text;
  v_sites jsonb;
  v_day text := to_char(now() at time zone 'America/Bogota', 'YYYY-MM-DD');
begin
  select * into v_employee from public.employees where id=p_employee_id;
  if not found then raise exception 'employee_inactive'; end if;
  select * into v_shift from public.scheduled_shifts where id=p_shift_id;
  if not found then raise exception 'attendance_shift_missing'; end if;
  select h.cargo_codigo into v_cargo from public.employee_cargo_history h
    where h.employee_id=p_employee_id and h.fecha_ingreso::date <= v_day::date
      and (h.fecha_retiro is null or h.fecha_retiro::date >= v_day::date)
    order by h.fecha_ingreso desc, h.created_at desc limit 1;
  select c.marcacion_movil, c.alineacion_crud into v_mobile, v_alignment
    from public.cargos c where c.codigo=coalesce(nullif(v_cargo,''),v_employee.cargo_codigo);
  v_mobile := coalesce(v_mobile,false);
  if v_mobile then
    if v_alignment='supervisor' then
      select nullif(trim(s.zona_codigo),'') into v_zone from public.supervisor_profile s where s.documento=v_employee.documento;
    end if;
    v_zone := coalesce(v_zone,nullif(trim(v_employee.zona_codigo),''));
    if v_zone is null then raise exception 'attendance_zone_missing'; end if;
    v_contract := v_shift.contrato_codigo;
    if nullif(trim(v_contract),'') is null then raise exception 'attendance_contract_missing'; end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('codigo',s.codigo,'nombre',s.nombre,
    'qr_latitude',s.qr_latitude,'qr_longitude',s.qr_longitude,'qr_radius_meters',s.qr_radius_meters,
    'qr_enabled',s.qr_enabled) order by s.nombre,s.codigo),'[]'::jsonb) into v_sites
    from public.sedes s where s.estado='activo' and
      ((not v_mobile and s.codigo=v_shift.sede_codigo)
       or (v_mobile and s.zona_codigo=v_zone and s.contrato_codigo=v_contract));
  return jsonb_build_object('mobile',v_mobile,'zone',v_zone,'sites',v_sites);
end;
$$;
revoke all on function public.attendance_site_options(uuid,uuid) from public,anon,authenticated;
grant execute on function public.attendance_site_options(uuid,uuid) to service_role;

create or replace function public.register_shift_attendance(p_event jsonb)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_shift public.scheduled_shifts%rowtype;
  v_site public.sedes%rowtype;
  v_employee public.employees%rowtype;
  v_token public.attendance_qr_tokens%rowtype;
  v_entry public.attendance%rowtype;
  v_status public.employee_shift_status%rowtype;
  v_action text := p_event->>'action';
  v_method text := p_event->>'method';
  v_emp uuid := (p_event->>'employee_id')::uuid;
  v_shift_id uuid := (p_event->>'turno_id')::uuid;
  v_token_id uuid := (p_event->>'qr_token_id')::uuid;
  v_device_id uuid := (p_event->>'device_id')::uuid;
  v_at timestamptz := clock_timestamp();
  v_lat double precision;
  v_lng double precision;
  v_distance double precision;
  v_verified timestamptz;
  v_record_id text;
  v_class text := p_event->'classification'->>'status';
  v_minutes integer := coalesce((p_event->'classification'->>'minutes')::integer, 0);
  v_review boolean := coalesce((p_event->'classification'->>'requiresReview')::boolean, false);
  v_state text;
  v_options jsonb;
  v_mobile boolean;
begin
  if v_action is null or v_action not in ('entry','exit') or v_method is null or v_method not in ('qr','location') then
    raise exception 'invalid_marking';
  end if;
  -- Same lock order as shift closure: lock the shift before employee status.
  select * into v_shift from public.scheduled_shifts where id = v_shift_id for update;
  if not found or v_shift.estado = 'cancelado' then raise exception 'attendance_shift_missing'; end if;
  select * into v_employee from public.employees where id = v_emp for update;
  if not found or lower(v_employee.estado) <> 'activo' then raise exception 'employee_inactive'; end if;
  v_options := public.attendance_site_options(v_emp, v_shift_id);
  v_mobile := coalesce((v_options->>'mobile')::boolean, false);
  if not exists(select 1 from jsonb_array_elements(v_options->'sites') s where s->>'codigo' = p_event->>'sede_codigo') then
    raise exception 'attendance_site_forbidden';
  end if;
  if v_mobile and v_action = 'entry' then
    if not exists(select 1 from public.shift_assignments a where a.scheduled_shift_id=v_shift_id
      and (a.employee_id=v_emp or (a.employee_id is null and a.documento=v_employee.documento))
      and a.estado in ('asignado','confirmado')) then raise exception 'attendance_shift_missing'; end if;
    if exists(select 1 from public.employee_shift_status s where s.employee_id=v_emp
      and s.entrada_at is not null and s.salida_at is null and s.estado_turno <> 'cancelado'
      and s.scheduled_shift_id <> v_shift_id) then raise exception 'attendance_open_shift'; end if;
  end if;
  select * into v_site from public.sedes where codigo = p_event->>'sede_codigo' for share;
  if not found or lower(v_site.estado) <> 'activo' then raise exception 'attendance_shift_missing'; end if;
  if v_method = 'qr' then
    if not v_site.qr_enabled then raise exception 'qr_disabled'; end if;
    select * into v_token from public.attendance_qr_tokens where id = v_token_id for update;
    if not found then raise exception 'qr_not_found'; end if;
    if v_token.used_at is not null then raise exception 'qr_used'; end if;
    if v_token.expires_at <= v_at then raise exception 'qr_expired'; end if;
    if v_token.turno_id is distinct from v_shift_id or v_token.employee_id is distinct from v_emp
      or v_token.action is distinct from v_action or v_token.sede_codigo is distinct from v_site.codigo then
      raise exception 'sede_mismatch';
    end if;
    if not exists(select 1 from public.sede_devices d where d.id = v_device_id and d.estado = 'activo' and d.revoked_at is null
      and (d.sede_codigo = v_site.codigo or exists(select 1 from public.sede_device_sites ds where ds.device_id = d.id and ds.sede_codigo = v_site.codigo))) then
      raise exception 'device_inactive';
    end if;
    v_lat := v_token.request_latitude;
    v_lng := v_token.request_longitude;
    v_verified := v_token.location_verified_at;
  else
    if v_site.qr_enabled then raise exception 'qr_disabled'; end if;
    v_lat := (p_event->>'request_latitude')::double precision;
    v_lng := (p_event->>'request_longitude')::double precision;
    v_verified := (p_event->>'location_verified_at')::timestamptz;
  end if;
  if v_lat is null or v_lng is null or not (v_lat between -90 and 90) or not (v_lng between -180 and 180)
    or v_site.qr_latitude is null or v_site.qr_longitude is null
    or not (v_site.qr_latitude between -90 and 90) or not (v_site.qr_longitude between -180 and 180)
    or (abs(v_site.qr_latitude) < 0.000001 and abs(v_site.qr_longitude) < 0.000001)
    or v_verified is null or v_verified > v_at + interval '1 minute'
    or (v_method = 'location' and v_verified < v_at - interval '5 minutes') then
    raise exception 'location_required';
  end if;
  v_distance := 6371000 * 2 * asin(sqrt(least(1.0,
    power(sin(radians(v_lat - v_site.qr_latitude) / 2), 2)
    + cos(radians(v_site.qr_latitude)) * cos(radians(v_lat))
    * power(sin(radians(v_lng - v_site.qr_longitude) / 2), 2))));
  if v_distance > coalesce(nullif(v_site.qr_radius_meters, 0), 200) then raise exception 'location_outside'; end if;

  select * into v_entry from public.attendance where turno_id = v_shift_id and documento = v_employee.documento and asistio = true;
  select * into v_status from public.employee_shift_status where scheduled_shift_id = v_shift_id and employee_id = v_emp for update;
  v_record_id := v_shift_id::text || '_' || v_emp::text;
  if v_action = 'entry' then
    if v_entry.id is not null or v_status.entrada_at is not null then raise exception 'entry_exists'; end if;
    if v_shift.estado = 'cerrado' or v_at >= v_shift.ends_at then raise exception 'attendance_shift_missing'; end if;
    insert into public.attendance(id, fecha, empleado_id, documento, nombre, sede_codigo, sede_nombre,
      asistio, novedad, turno_id, fecha_operativa, reported_at, registro_estado, requires_review,
      early_entry_minutes, late_entry_minutes, marking_method, request_latitude, request_longitude,
      request_distance_meters, location_verified_at, phone_number,
      contrato_codigo, contrato_nombre, cliente_nombre_snapshot, cliente_nit_snapshot)
    values(v_record_id, v_shift.fecha_operativa, v_emp, v_employee.documento, v_employee.nombre,
      v_shift.sede_codigo, v_shift.sede_nombre, true, '1', v_shift_id, v_shift.fecha_operativa, v_at,
      v_class, v_review, case when v_class = 'entrada_anticipada' then v_minutes else 0 end,
      case when v_class = 'entrada_tardia' then v_minutes else 0 end, v_method, v_lat, v_lng,
      round(v_distance)::integer, v_verified, p_event->>'phone_number',
      v_shift.contrato_codigo, v_shift.contrato_nombre, v_shift.cliente_nombre_snapshot, v_shift.cliente_nit_snapshot);
    v_state := case when v_class = 'entrada_tardia' then 'trabajado_tardio' else 'trabajado' end;
    insert into public.employee_shift_status(id, scheduled_shift_id, fecha_operativa, employee_id, documento,
      nombre, sede_codigo, estado_turno, asistio, entrada_at, source_attendance_id, novedad_codigo, novedad_nombre,
      early_entry_minutes, late_entry_minutes, requires_review,
      contrato_codigo, contrato_nombre, cliente_nombre_snapshot, cliente_nit_snapshot)
    values(coalesce(v_status.id, v_record_id), v_shift_id, v_shift.fecha_operativa, v_emp, v_employee.documento,
      v_employee.nombre, v_shift.sede_codigo, v_state, true, v_at, v_record_id, '1', 'Trabajando',
      case when v_class = 'entrada_anticipada' then v_minutes else 0 end,
      case when v_class = 'entrada_tardia' then v_minutes else 0 end, v_review,
      v_shift.contrato_codigo, v_shift.contrato_nombre, v_shift.cliente_nombre_snapshot, v_shift.cliente_nit_snapshot)
    on conflict(id) do update set estado_turno = excluded.estado_turno, asistio = true, entrada_at = v_at,
      source_attendance_id = v_record_id, novedad_codigo = '1', novedad_nombre = 'Trabajando',
      early_entry_minutes = excluded.early_entry_minutes, late_entry_minutes = excluded.late_entry_minutes,
      requires_review = employee_shift_status.requires_review or excluded.requires_review;
    update public.scheduled_shifts set estado = 'abierto', opened_at = coalesce(opened_at, v_at) where id = v_shift_id and estado = 'programado';
  else
    if v_entry.id is null or v_status.entrada_at is null then raise exception 'exit_requires_entry'; end if;
    if v_status.salida_at is not null or exists(select 1 from public.employee_daily_exits where turno_id = v_shift_id and documento = v_employee.documento) then
      raise exception 'exit_exists';
    end if;
    insert into public.employee_daily_exits(id, fecha, employee_id, documento, nombre, sede_codigo, sede_nombre,
      qr_token_id, device_id, entry_attendance_id, exit_at, turno_id, fecha_operativa, registro_estado, requires_review,
      early_exit_minutes, late_exit_minutes, marking_method, request_latitude, request_longitude,
      request_distance_meters, location_verified_at, phone_number,
      contrato_codigo, contrato_nombre, cliente_nombre_snapshot, cliente_nit_snapshot)
    values(v_record_id, v_shift.fecha_operativa, v_emp, v_employee.documento, v_employee.nombre,
      v_shift.sede_codigo, v_shift.sede_nombre, v_token_id, v_device_id, v_entry.id, v_at,
      v_shift_id, v_shift.fecha_operativa, v_class, v_review or v_shift.estado = 'cerrado',
      case when v_class = 'salida_anticipada' then v_minutes else 0 end,
      case when v_class = 'salida_tardia' then v_minutes else 0 end, v_method, v_lat, v_lng,
      round(v_distance)::integer, v_verified, p_event->>'phone_number',
      v_shift.contrato_codigo, v_shift.contrato_nombre, v_shift.cliente_nombre_snapshot, v_shift.cliente_nit_snapshot);
    update public.employee_shift_status set salida_at = v_at, source_exit_id = v_record_id,
      early_exit_minutes = case when v_class = 'salida_anticipada' then v_minutes else 0 end,
      late_exit_minutes = case when v_class = 'salida_tardia' then v_minutes else 0 end,
      requires_review = requires_review or v_review or v_shift.estado = 'cerrado',
      estado_turno = case when v_shift.estado = 'cerrado' then 'post_cierre_pendiente'
        when v_class = 'salida_anticipada' then 'retiro_anticipado'
        when late_entry_minutes > 0 then 'trabajado_tardio' else 'trabajado' end
    where id = v_status.id;
  end if;
  if v_action = 'entry' then
    update public.attendance set marking_sede_codigo=v_site.codigo, marking_sede_nombre=v_site.nombre where id=v_record_id;
  else
    update public.employee_daily_exits set marking_sede_codigo=v_site.codigo, marking_sede_nombre=v_site.nombre where id=v_record_id;
  end if;
  if v_method = 'qr' then
    update public.attendance_qr_tokens set used_at = v_at, used_by_device_id = v_device_id where id = v_token_id;
  end if;
  return jsonb_build_object('status', case when v_action = 'entry' then 'entry_registered' else 'exit_registered' end,
    'attendanceId', case when v_action = 'entry' then v_record_id else v_entry.id end,
    'exitId', case when v_action = 'exit' then v_record_id else null end, 'eventAt', v_at);
end;
$$;
revoke all on function public.register_shift_attendance(jsonb) from public, anon, authenticated;
grant execute on function public.register_shift_attendance(jsonb) to service_role;

commit;

-- >>>>>>>>>> schema_operations_phase61_attendance_alert_thresholds.sql
-- Phase 61: timing thresholds, WhatsApp explanations (5-200 characters), and daily tracking.
begin;
alter table public.shift_template_rules add column if not exists alerta_entrada_antes_minutos integer;
alter table public.shift_template_rules drop constraint if exists alerta_entrada_antes_range;
alter table public.shift_template_rules add constraint alerta_entrada_antes_range
  check (alerta_entrada_antes_minutos is null or alerta_entrada_antes_minutos between 0 and ventana_entrada_antes_minutos);
alter table public.shift_template_rules add column if not exists alerta_entrada_despues_minutos integer;
alter table public.shift_template_rules drop constraint if exists alerta_entrada_despues_range;
alter table public.shift_template_rules add constraint alerta_entrada_despues_range
  check (alerta_entrada_despues_minutos is null or alerta_entrada_despues_minutos between 0 and ventana_entrada_despues_minutos);
alter table public.shift_template_rules add column if not exists alerta_salida_antes_minutos integer;
alter table public.shift_template_rules drop constraint if exists alerta_salida_antes_range;
alter table public.shift_template_rules add constraint alerta_salida_antes_range
  check (alerta_salida_antes_minutos is null or alerta_salida_antes_minutos between 0 and ventana_salida_antes_minutos);
alter table public.shift_template_rules add column if not exists alerta_salida_despues_minutos integer;
alter table public.shift_template_rules drop constraint if exists alerta_salida_despues_range;
alter table public.shift_template_rules add constraint alerta_salida_despues_range
  check (alerta_salida_despues_minutos is null or alerta_salida_despues_minutos between 0 and ventana_salida_despues_minutos);
alter table public.employee_shift_status add column if not exists timing_alerts jsonb not null default '{}'::jsonb;

create or replace function public.register_shift_attendance_before_reasons(p_event jsonb)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_shift public.scheduled_shifts%rowtype;
  v_site public.sedes%rowtype;
  v_employee public.employees%rowtype;
  v_token public.attendance_qr_tokens%rowtype;
  v_entry public.attendance%rowtype;
  v_status public.employee_shift_status%rowtype;
  v_action text := p_event->>'action';
  v_method text := p_event->>'method';
  v_emp uuid := (p_event->>'employee_id')::uuid;
  v_shift_id uuid := (p_event->>'turno_id')::uuid;
  v_token_id uuid := (p_event->>'qr_token_id')::uuid;
  v_device_id uuid := (p_event->>'device_id')::uuid;
  v_at timestamptz := clock_timestamp();
  v_lat double precision;
  v_lng double precision;
  v_distance double precision;
  v_verified timestamptz;
  v_record_id text;
  v_class text := p_event->'classification'->>'status';
  v_minutes integer := coalesce((p_event->'classification'->>'minutes')::integer, 0);
  v_review boolean := coalesce((p_event->'classification'->>'requiresReview')::boolean, false);
  v_state text;
  v_options jsonb;
  v_mobile boolean;
  v_rule public.shift_template_rules%rowtype;
  v_delta numeric;
  v_alert integer;
  v_control integer;
  v_alert_type text;
  v_alerts jsonb := '{}'::jsonb;
begin
  if v_action is null or v_action not in ('entry','exit') or v_method is null or v_method not in ('qr','location') then
    raise exception 'invalid_marking';
  end if;
  -- Same lock order as shift closure: lock the shift before employee status.
  select * into v_shift from public.scheduled_shifts where id = v_shift_id for update;
  if not found or v_shift.estado = 'cancelado' then raise exception 'attendance_shift_missing'; end if;
  select * into v_employee from public.employees where id = v_emp for update;
  if not found or lower(v_employee.estado) <> 'activo' then raise exception 'employee_inactive'; end if;
  v_options := public.attendance_site_options(v_emp, v_shift_id);
  v_mobile := coalesce((v_options->>'mobile')::boolean, false);
  if not exists(select 1 from jsonb_array_elements(v_options->'sites') s where s->>'codigo' = p_event->>'sede_codigo') then
    raise exception 'attendance_site_forbidden';
  end if;
  if v_mobile and v_action = 'entry' then
    if not exists(select 1 from public.shift_assignments a where a.scheduled_shift_id=v_shift_id
      and (a.employee_id=v_emp or (a.employee_id is null and a.documento=v_employee.documento))
      and a.estado in ('asignado','confirmado')) then raise exception 'attendance_shift_missing'; end if;
    if exists(select 1 from public.employee_shift_status s where s.employee_id=v_emp
      and s.entrada_at is not null and s.salida_at is null and s.estado_turno <> 'cancelado'
      and s.scheduled_shift_id <> v_shift_id) then raise exception 'attendance_open_shift'; end if;
  end if;
  select * into v_site from public.sedes where codigo = p_event->>'sede_codigo' for share;
  if not found or lower(v_site.estado) <> 'activo' then raise exception 'attendance_shift_missing'; end if;
  if v_method = 'qr' then
    if not v_site.qr_enabled then raise exception 'qr_disabled'; end if;
    select * into v_token from public.attendance_qr_tokens where id = v_token_id for update;
    if not found then raise exception 'qr_not_found'; end if;
    if v_token.used_at is not null then raise exception 'qr_used'; end if;
    if v_token.expires_at <= v_at then raise exception 'qr_expired'; end if;
    if v_token.turno_id is distinct from v_shift_id or v_token.employee_id is distinct from v_emp
      or v_token.action is distinct from v_action or v_token.sede_codigo is distinct from v_site.codigo then
      raise exception 'sede_mismatch';
    end if;
    if not exists(select 1 from public.sede_devices d where d.id = v_device_id and d.estado = 'activo' and d.revoked_at is null
      and (d.sede_codigo = v_site.codigo or exists(select 1 from public.sede_device_sites ds where ds.device_id = d.id and ds.sede_codigo = v_site.codigo))) then
      raise exception 'device_inactive';
    end if;
    v_lat := v_token.request_latitude;
    v_lng := v_token.request_longitude;
    v_verified := v_token.location_verified_at;
  else
    if v_site.qr_enabled then raise exception 'qr_disabled'; end if;
    v_lat := (p_event->>'request_latitude')::double precision;
    v_lng := (p_event->>'request_longitude')::double precision;
    v_verified := (p_event->>'location_verified_at')::timestamptz;
  end if;
  if v_lat is null or v_lng is null or not (v_lat between -90 and 90) or not (v_lng between -180 and 180)
    or v_site.qr_latitude is null or v_site.qr_longitude is null
    or not (v_site.qr_latitude between -90 and 90) or not (v_site.qr_longitude between -180 and 180)
    or (abs(v_site.qr_latitude) < 0.000001 and abs(v_site.qr_longitude) < 0.000001)
    or v_verified is null or v_verified > v_at + interval '1 minute'
    or (v_method = 'location' and v_verified < v_at - interval '5 minutes') then
    raise exception 'location_required';
  end if;
  v_distance := 6371000 * 2 * asin(sqrt(least(1.0,
    power(sin(radians(v_lat - v_site.qr_latitude) / 2), 2)
    + cos(radians(v_site.qr_latitude)) * cos(radians(v_lat))
    * power(sin(radians(v_lng - v_site.qr_longitude) / 2), 2))));
  if v_distance > coalesce(nullif(v_site.qr_radius_meters, 0), 200) then raise exception 'location_outside'; end if;

  select * into v_rule from public.shift_template_rules where id = v_shift.template_rule_id;
  v_delta := extract(epoch from (v_at - case when v_action = 'entry' then v_shift.starts_at else v_shift.ends_at end)) / 60;
  v_alert := case when v_action = 'entry' then
    case when v_delta < 0 then coalesce(v_rule.alerta_entrada_antes_minutos, v_rule.ventana_entrada_antes_minutos, 0)
      else coalesce(v_rule.alerta_entrada_despues_minutos, v_rule.ventana_entrada_despues_minutos, 0) end
    else case when v_delta < 0 then coalesce(v_rule.alerta_salida_antes_minutos, v_rule.ventana_salida_antes_minutos, 0)
      else coalesce(v_rule.alerta_salida_despues_minutos, v_rule.ventana_salida_despues_minutos, 0) end end;
  v_alert_type := (case when v_action = 'entry' then 'entrada' else 'salida' end) ||
    (case when v_delta < 0 then '_anticipada' else '_tardia' end);
  if v_rule.id is not null then
    v_control := case when v_action = 'entry' then
      case when v_delta < 0 then v_rule.ventana_entrada_antes_minutos else v_rule.ventana_entrada_despues_minutos end
      else case when v_delta < 0 then v_rule.ventana_salida_antes_minutos else v_rule.ventana_salida_despues_minutos end end;
    v_minutes := greatest(0, ceil(abs(v_delta) - v_control)::integer);
    v_class := case when v_minutes > 0 then v_alert_type else 'normal' end;
    v_review := v_minutes > 0;
  end if;
  if v_rule.id is not null and abs(v_delta) > v_alert then
    v_alerts := jsonb_build_object(v_alert_type, ceil(abs(v_delta))::integer);
    v_review := true;
  end if;

  select * into v_entry from public.attendance where turno_id = v_shift_id and documento = v_employee.documento and asistio = true;
  select * into v_status from public.employee_shift_status where scheduled_shift_id = v_shift_id and employee_id = v_emp for update;
  v_record_id := v_shift_id::text || '_' || v_emp::text;
  if v_action = 'entry' then
    if v_entry.id is not null or v_status.entrada_at is not null then raise exception 'entry_exists'; end if;
    if v_shift.estado = 'cerrado' or v_at >= v_shift.ends_at then raise exception 'attendance_shift_missing'; end if;
    insert into public.attendance(id, fecha, empleado_id, documento, nombre, sede_codigo, sede_nombre,
      asistio, novedad, turno_id, fecha_operativa, reported_at, registro_estado, requires_review,
      early_entry_minutes, late_entry_minutes, marking_method, request_latitude, request_longitude,
      request_distance_meters, location_verified_at, phone_number,
      contrato_codigo, contrato_nombre, cliente_nombre_snapshot, cliente_nit_snapshot)
    values(v_record_id, v_shift.fecha_operativa, v_emp, v_employee.documento, v_employee.nombre,
      v_shift.sede_codigo, v_shift.sede_nombre, true, '1', v_shift_id, v_shift.fecha_operativa, v_at,
      v_class, v_review, case when v_class = 'entrada_anticipada' then v_minutes else 0 end,
      case when v_class = 'entrada_tardia' then v_minutes else 0 end, v_method, v_lat, v_lng,
      round(v_distance)::integer, v_verified, p_event->>'phone_number',
      v_shift.contrato_codigo, v_shift.contrato_nombre, v_shift.cliente_nombre_snapshot, v_shift.cliente_nit_snapshot);
    v_state := case when v_class = 'entrada_tardia' then 'trabajado_tardio' else 'trabajado' end;
    insert into public.employee_shift_status(id, scheduled_shift_id, fecha_operativa, employee_id, documento,
      nombre, sede_codigo, estado_turno, asistio, entrada_at, source_attendance_id, novedad_codigo, novedad_nombre,
      early_entry_minutes, late_entry_minutes, requires_review,
      contrato_codigo, contrato_nombre, cliente_nombre_snapshot, cliente_nit_snapshot)
    values(coalesce(v_status.id, v_record_id), v_shift_id, v_shift.fecha_operativa, v_emp, v_employee.documento,
      v_employee.nombre, v_shift.sede_codigo, v_state, true, v_at, v_record_id, '1', 'Trabajando',
      case when v_class = 'entrada_anticipada' then v_minutes else 0 end,
      case when v_class = 'entrada_tardia' then v_minutes else 0 end, v_review,
      v_shift.contrato_codigo, v_shift.contrato_nombre, v_shift.cliente_nombre_snapshot, v_shift.cliente_nit_snapshot)
    on conflict(id) do update set estado_turno = excluded.estado_turno, asistio = true, entrada_at = v_at,
      source_attendance_id = v_record_id, novedad_codigo = '1', novedad_nombre = 'Trabajando',
      early_entry_minutes = excluded.early_entry_minutes, late_entry_minutes = excluded.late_entry_minutes,
      requires_review = employee_shift_status.requires_review or excluded.requires_review;
    update public.scheduled_shifts set estado = 'abierto', opened_at = coalesce(opened_at, v_at) where id = v_shift_id and estado = 'programado';
  else
    if v_entry.id is null or v_status.entrada_at is null then raise exception 'exit_requires_entry'; end if;
    if v_status.salida_at is not null or exists(select 1 from public.employee_daily_exits where turno_id = v_shift_id and documento = v_employee.documento) then
      raise exception 'exit_exists';
    end if;
    insert into public.employee_daily_exits(id, fecha, employee_id, documento, nombre, sede_codigo, sede_nombre,
      qr_token_id, device_id, entry_attendance_id, exit_at, turno_id, fecha_operativa, registro_estado, requires_review,
      early_exit_minutes, late_exit_minutes, marking_method, request_latitude, request_longitude,
      request_distance_meters, location_verified_at, phone_number,
      contrato_codigo, contrato_nombre, cliente_nombre_snapshot, cliente_nit_snapshot)
    values(v_record_id, v_shift.fecha_operativa, v_emp, v_employee.documento, v_employee.nombre,
      v_shift.sede_codigo, v_shift.sede_nombre, v_token_id, v_device_id, v_entry.id, v_at,
      v_shift_id, v_shift.fecha_operativa, v_class, v_review or v_shift.estado = 'cerrado',
      case when v_class = 'salida_anticipada' then v_minutes else 0 end,
      case when v_class = 'salida_tardia' then v_minutes else 0 end, v_method, v_lat, v_lng,
      round(v_distance)::integer, v_verified, p_event->>'phone_number',
      v_shift.contrato_codigo, v_shift.contrato_nombre, v_shift.cliente_nombre_snapshot, v_shift.cliente_nit_snapshot);
    update public.employee_shift_status set salida_at = v_at, source_exit_id = v_record_id,
      early_exit_minutes = case when v_class = 'salida_anticipada' then v_minutes else 0 end,
      late_exit_minutes = case when v_class = 'salida_tardia' then v_minutes else 0 end,
      requires_review = requires_review or v_review or v_shift.estado = 'cerrado',
      estado_turno = case when v_shift.estado = 'cerrado' then 'post_cierre_pendiente'
        when v_class = 'salida_anticipada' then 'retiro_anticipado'
        when late_entry_minutes > 0 then 'trabajado_tardio' else 'trabajado' end
    where id = v_status.id;
  end if;
  if v_action = 'entry' then
    update public.attendance set marking_sede_codigo=v_site.codigo, marking_sede_nombre=v_site.nombre where id=v_record_id;
  else
    update public.employee_daily_exits set marking_sede_codigo=v_site.codigo, marking_sede_nombre=v_site.nombre where id=v_record_id;
  end if;
  update public.employee_shift_status
    set timing_alerts = timing_alerts || v_alerts
    where scheduled_shift_id = v_shift_id and employee_id = v_emp;
  if v_method = 'qr' then
    update public.attendance_qr_tokens set used_at = v_at, used_by_device_id = v_device_id where id = v_token_id;
  end if;
  return jsonb_build_object('status', case when v_action = 'entry' then 'entry_registered' else 'exit_registered' end,
    'attendanceId', case when v_action = 'entry' then v_record_id else v_entry.id end,
    'exitId', case when v_action = 'exit' then v_record_id else null end, 'eventAt', v_at);
end;
$$;

revoke all on function public.register_shift_attendance_before_reasons(jsonb) from public, anon, authenticated, service_role;


alter table public.attendance_qr_tokens add column if not exists whatsapp_recipient text;
alter table public.attendance
  add column if not exists timing_alert_type text,
  add column if not exists timing_control_required boolean not null default false,
  add column if not exists employee_reason text,
  add column if not exists employee_reason_at timestamptz;
alter table public.employee_daily_exits
  add column if not exists timing_alert_type text,
  add column if not exists timing_control_required boolean not null default false,
  add column if not exists employee_reason text,
  add column if not exists employee_reason_at timestamptz;

create table if not exists public.attendance_reason_requests (
  id text primary key,
  scheduled_shift_id uuid not null references public.scheduled_shifts(id),
  employee_id uuid not null references public.employees(id),
  action text not null check (action in ('entry', 'exit')),
  record_id text not null,
  recipient text not null check (length(btrim(recipient)) > 0),
  alert_type text not null check (alert_type in ('entrada_tardia', 'entrada_anticipada', 'salida_anticipada', 'salida_tardia')),
  control_required boolean not null,
  event_at timestamptz not null,
  reason text check (reason is null or char_length(btrim(reason, E' \t\n\r')) between 5 and 200),
  answered_at timestamptz,
  message_id text,
  unique(scheduled_shift_id, employee_id, action)
);
create index if not exists attendance_reason_requests_pending_idx
  on public.attendance_reason_requests(recipient, event_at) where answered_at is null;
create unique index if not exists attendance_reason_requests_message_idx
  on public.attendance_reason_requests(recipient, message_id) where message_id is not null;
alter table public.attendance_reason_requests enable row level security;
revoke all on public.attendance_reason_requests from public, anon, authenticated;
grant select, insert, update on public.attendance_reason_requests to service_role;

revoke all on function public.register_shift_attendance_before_reasons(jsonb) from public, anon, authenticated, service_role;

create or replace function public.register_shift_attendance(p_event jsonb)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_result jsonb;
  v_status public.employee_shift_status%rowtype;
  v_action text := p_event->>'action';
  v_type text;
  v_control boolean;
  v_recipient text;
  v_record_id text;
  v_request_id text;
begin
  v_result := public.register_shift_attendance_before_reasons(p_event);
  select * into strict v_status from public.employee_shift_status
    where scheduled_shift_id=(p_event->>'turno_id')::uuid and employee_id=(p_event->>'employee_id')::uuid;
  select key into v_type from jsonb_object_keys(v_status.timing_alerts) as key
    where key like (case when v_action='entry' then 'entrada_%' else 'salida_%' end) limit 1;
  v_control := case when v_action='entry' then v_status.early_entry_minutes > 0 or v_status.late_entry_minutes > 0
    else v_status.early_exit_minutes > 0 or v_status.late_exit_minutes > 0 or v_status.estado_turno='post_cierre_pendiente' end;
  v_record_id := v_result->>(case when v_action='entry' then 'attendanceId' else 'exitId' end);
  if v_action='entry' then
    update public.attendance set timing_alert_type=v_type, timing_control_required=v_control where id=v_record_id;
  else
    update public.employee_daily_exits set timing_alert_type=v_type, timing_control_required=v_control where id=v_record_id;
  end if;
  if v_type is not null then
    if p_event->>'method'='qr' then
      select coalesce(nullif(whatsapp_recipient,''),phone_number) into v_recipient
        from public.attendance_qr_tokens where id=(p_event->>'qr_token_id')::uuid;
    else
      v_recipient := coalesce(nullif(p_event->>'whatsapp_recipient',''),p_event->>'phone_number');
    end if;
    if nullif(btrim(v_recipient),'') is null then raise exception 'attendance_reason_recipient_missing'; end if;
    v_request_id := v_record_id || '_' || v_action;
    insert into public.attendance_reason_requests(id,scheduled_shift_id,employee_id,action,record_id,
      recipient,alert_type,control_required,event_at)
    values(v_request_id,v_status.scheduled_shift_id,v_status.employee_id,v_action,v_record_id,
      v_recipient,v_type,v_control,(v_result->>'eventAt')::timestamptz);
    v_result := v_result || jsonb_build_object('reasonRequest', jsonb_build_object(
      'id',v_request_id,'recipient',v_recipient,'alert_type',v_type,'event_at',v_result->>'eventAt'));
  end if;
  return v_result;
end;
$$;

create or replace function public.answer_attendance_reason(p_request_id text, p_recipient text, p_reason text, p_message_id text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_request public.attendance_reason_requests%rowtype;
  v_reason text := btrim(p_reason, E' \t\n\r');
begin
  if v_reason is null or char_length(v_reason) not between 5 and 200 then raise exception 'attendance_reason_length'; end if;
  select * into v_request from public.attendance_reason_requests where id=p_request_id and recipient=p_recipient;
  if not found then raise exception 'attendance_reason_not_found'; end if;
  -- Same lock order as marking and closure, followed by the explanation request.
  perform 1 from public.scheduled_shifts where id=v_request.scheduled_shift_id for update;
  perform 1 from public.employee_shift_status where scheduled_shift_id=v_request.scheduled_shift_id
    and employee_id=v_request.employee_id for update;
  select * into v_request from public.attendance_reason_requests where id=p_request_id for update;
  if v_request.answered_at is not null then return jsonb_build_object('saved',true,'alreadyAnswered',true); end if;
  if p_message_id is not null and exists(select 1 from public.attendance_reason_requests
    where recipient=p_recipient and message_id=p_message_id) then
    return jsonb_build_object('saved',true,'alreadyAnswered',true);
  end if;
  update public.attendance_reason_requests set reason=v_reason, answered_at=clock_timestamp(), message_id=p_message_id where id=p_request_id;
  if v_request.action='entry' then
    update public.attendance set employee_reason=v_reason, employee_reason_at=clock_timestamp(),
      early_entry_reason=case when v_request.alert_type='entrada_anticipada' then v_reason else early_entry_reason end,
      late_entry_reason=case when v_request.alert_type='entrada_tardia' then v_reason else late_entry_reason end,
      requires_review=timing_control_required where id=v_request.record_id;
  else
    update public.employee_daily_exits set employee_reason=v_reason, employee_reason_at=clock_timestamp(),
      early_exit_reason=case when v_request.alert_type='salida_anticipada' then v_reason else early_exit_reason end,
      late_exit_reason=case when v_request.alert_type='salida_tardia' then v_reason else late_exit_reason end,
      requires_review=timing_control_required where id=v_request.record_id;
  end if;
  update public.employee_shift_status set
    early_entry_reason=case when v_request.alert_type='entrada_anticipada' then v_reason else early_entry_reason end,
    late_entry_reason=case when v_request.alert_type='entrada_tardia' then v_reason else late_entry_reason end,
    early_exit_reason=case when v_request.alert_type='salida_anticipada' then v_reason else early_exit_reason end,
    late_exit_reason=case when v_request.alert_type='salida_tardia' then v_reason else late_exit_reason end,
    requires_review=early_entry_minutes>0 or late_entry_minutes>0 or early_exit_minutes>0 or late_exit_minutes>0
      or estado_turno in ('post_cierre_pendiente','salida_pendiente','retiro_anticipado','trabajado_tardio')
      or exists(select 1 from public.attendance_reason_requests r where r.scheduled_shift_id=v_request.scheduled_shift_id
        and r.employee_id=v_request.employee_id and r.answered_at is null)
    where scheduled_shift_id=v_request.scheduled_shift_id and employee_id=v_request.employee_id;
  return jsonb_build_object('saved',true,'controlRequired',v_request.control_required);
end;
$$;
revoke all on function public.register_shift_attendance(jsonb) from public, anon, authenticated;
revoke all on function public.answer_attendance_reason(text,text,text,text) from public, anon, authenticated;
grant execute on function public.register_shift_attendance(jsonb) to service_role;
grant execute on function public.answer_attendance_reason(text,text,text,text) to service_role;
commit;

-- >>>>>>>>>> schema_operations_phase63_shift_review_decisions.sql
-- Decisions by circumstance. No payroll calculation or alteration of markings.
begin;
alter table public.employee_shift_status
  add column if not exists review_decisions jsonb not null default '{}'::jsonb;

create or replace function public.shift_review_pending_types(r jsonb)
returns text[] language sql immutable set search_path = public as $$
  select coalesce(array_agg(t.key order by t.ord), '{}'::text[])
  from (values
    (1, 'entrada_anticipada', 'early_entry_minutes', 'early_entry_reason', ''),
    (2, 'entrada_tardia', 'late_entry_minutes', 'late_entry_reason', 'trabajado_tardio'),
    (3, 'salida_anticipada', 'early_exit_minutes', 'early_exit_reason', 'retiro_anticipado'),
    (4, 'salida_tardia', 'late_exit_minutes', 'late_exit_reason', ''),
    (5, 'salida_sin_registro', '', '', 'salida_pendiente'),
    (6, 'registro_post_cierre', '', '', 'post_cierre_pendiente')
  ) t(ord,key,minutes_field,reason_field,status)
  where coalesce(r->>'estado_turno','') not in ('ausente_con_novedad','ausente_sin_reemplazo','sin_registro','cancelado')
    and not (r->>'estado_turno' = 'ajustado' and not coalesce((r->>'requires_review')::boolean,false))
    and not coalesce(r->'review_decisions','{}'::jsonb) ? t.key
    and not (t.key = 'entrada_anticipada' and nullif(r->>'entry_authorization_id','') is not null)
    and not (t.key = 'salida_tardia' and nullif(r->>'exit_authorization_id','') is not null)
    and (coalesce((r->>t.minutes_field)::numeric,0) > 0
      or (t.status <> '' and r->>'estado_turno' = t.status)
      or (coalesce((r->'timing_alerts'->>t.key)::numeric,0) > 0 and nullif(trim(r->>t.reason_field),'') is null));
$$;

create or replace function public.resolve_shift_review_decision(
  p_status_id text, p_circumstance text, p_effect text, p_minutes integer,
  p_reason text, p_expected_updated_at timestamptz
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  s public.employee_shift_status%rowtype;
  shift_id uuid;
  v_shift public.scheduled_shifts%rowtype;
  v_before jsonb;
  v_decision jsonb;
  v_pending text[];
  v_authorization uuid;
  v_actor uuid := auth.uid();
  v_email text := auth.jwt()->>'email';
  v_now timestamptz := clock_timestamp();
begin
  if v_actor is null or not public.current_profile_has_permission('manageShiftReview','manageOperationRegistry') then
    raise exception 'No tienes permiso para gestionar revisiones.';
  end if;
  if p_effect is null or p_effect not in ('addition','deduction','none')
    or p_minutes is null or (p_effect = 'none' and p_minutes <> 0)
    or (p_effect <> 'none' and p_minutes <= 0) or nullif(trim(p_reason),'') is null then
    raise exception 'La decision requiere un motivo y minutos validos.';
  end if;
  select scheduled_shift_id into shift_id from public.employee_shift_status where id = p_status_id;
  -- Same lock order as attendance and automatic closure.
  select * into v_shift from public.scheduled_shifts where id = shift_id for update;
  select * into s from public.employee_shift_status where id = p_status_id for update;
  if not found or not public.can_read_contract_data(s.contrato_codigo) then
    raise exception 'Registro no disponible en tu contrato.';
  end if;
  if p_expected_updated_at is null or s.updated_at is distinct from p_expected_updated_at then
    raise exception 'El registro cambio. Consulta nuevamente antes de decidir.';
  end if;
  v_before := to_jsonb(s);
  v_pending := public.shift_review_pending_types(v_before);
  if p_circumstance is null or not p_circumstance = any(v_pending) then
    raise exception 'La circunstancia ya fue gestionada o no esta pendiente.';
  end if;
  if (p_effect = 'addition' and p_circumstance not in ('entrada_anticipada','salida_tardia'))
    or (p_effect = 'deduction' and p_circumstance not in ('entrada_tardia','salida_anticipada')) then
    raise exception 'El tipo de ajuste no corresponde a esta circunstancia.';
  end if;
  -- Preserve existing additional-time authorizations. Deductions are decisions
  -- in shift_adjustments, never negative minutes in an attendance authorization.
  if p_effect = 'addition' then
    insert into public.shift_time_authorizations (
      scheduled_shift_id, employee_id, documento, authorization_type, minutes_authorized, authorized_from, authorized_until,
      reason, estado, requested_by_uid, requested_by_email, approved_by_uid, approved_by_email, approved_at
    ) values (s.scheduled_shift_id, s.employee_id, s.documento,
      case p_circumstance when 'entrada_anticipada' then 'early_entry' else 'late_exit' end,
      p_minutes,
      case p_circumstance when 'entrada_anticipada' then s.entrada_at else v_shift.ends_at end,
      case p_circumstance when 'entrada_anticipada' then v_shift.starts_at else s.salida_at end,
      trim(p_reason), 'aprobada', v_actor, v_email, v_actor, v_email, v_now)
    returning id into v_authorization;
  end if;
  v_decision := jsonb_build_object('effect',p_effect,'minutes',p_minutes,
    'signedMinutes',case p_effect when 'addition' then p_minutes when 'deduction' then -p_minutes else 0 end,
    'reason',trim(p_reason),'actorUid',v_actor,'actorEmail',v_email,'decidedAt',v_now,'authorizationId',v_authorization);
  s.review_decisions := s.review_decisions || jsonb_build_object(p_circumstance,v_decision);
  v_pending := public.shift_review_pending_types(to_jsonb(s));
  update public.employee_shift_status set
    review_decisions = s.review_decisions,
    requires_review = cardinality(v_pending) > 0,
    estado_turno = case when cardinality(v_pending) = 0 then 'ajustado' else s.estado_turno end,
    entry_authorization_id = case when p_circumstance = 'entrada_anticipada' and v_authorization is not null then v_authorization else s.entry_authorization_id end,
    exit_authorization_id = case when p_circumstance = 'salida_tardia' and v_authorization is not null then v_authorization else s.exit_authorization_id end,
    updated_at = v_now
  where id = p_status_id;
  if not found then raise exception 'No se pudo actualizar la revision.'; end if;
  insert into public.shift_adjustments (
    scheduled_shift_id, employee_id, documento, tipo, estado, before_snapshot, after_snapshot,
    motivo, approved_by_uid, approved_by_email, approved_at
  ) values (s.scheduled_shift_id,s.employee_id,s.documento,
    case p_circumstance when 'salida_sin_registro' then 'correccion_manual' else p_circumstance end,
    'aprobado',v_before,jsonb_build_object('circumstance',p_circumstance,'decision',v_decision),
    trim(p_reason),v_actor,v_email,v_now);
  insert into public.audit_logs(actor_uid,actor_email,target_type,target_id,action,before_data,after_data,note)
  values(v_actor,v_email,'employee_shift_status',p_status_id,'resolve_shift_review_decision',v_before,
    jsonb_build_object('circumstance',p_circumstance,'decision',v_decision),trim(p_reason));
  return jsonb_build_object('decision',v_decision,'remaining',v_pending);
end;
$$;
revoke all on function public.resolve_shift_review_decision(text,text,text,integer,text,timestamptz) from public, anon;
grant execute on function public.resolve_shift_review_decision(text,text,text,integer,text,timestamptz) to authenticated;

-- A later marking must not inherit the approval of an earlier marking.
create or replace function public.invalidate_changed_shift_review_decisions()
returns trigger language plpgsql set search_path = public as $$
declare v_previous jsonb := new.review_decisions;
begin
  if new.entrada_at is distinct from old.entrada_at
    or new.early_entry_minutes is distinct from old.early_entry_minutes
    or new.late_entry_minutes is distinct from old.late_entry_minutes then
    new.review_decisions := new.review_decisions - 'entrada_anticipada' - 'entrada_tardia';
    if old.review_decisions ? 'entrada_anticipada' then new.entry_authorization_id := null; end if;
  end if;
  if new.salida_at is distinct from old.salida_at
    or new.early_exit_minutes is distinct from old.early_exit_minutes
    or new.late_exit_minutes is distinct from old.late_exit_minutes then
    new.review_decisions := new.review_decisions - 'salida_anticipada' - 'salida_tardia' - 'salida_sin_registro' - 'registro_post_cierre';
    if old.review_decisions ? 'salida_tardia' then new.exit_authorization_id := null; end if;
  end if;
  if new.review_decisions is distinct from v_previous then
    new.requires_review := true;
    if new.estado_turno = 'ajustado' then new.estado_turno := 'trabajado'; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists invalidate_changed_shift_review_decisions on public.employee_shift_status;
drop trigger if exists invalidate_changed_shift_review_decisions on public.employee_shift_status;
create trigger invalidate_changed_shift_review_decisions before update on public.employee_shift_status
for each row execute function public.invalidate_changed_shift_review_decisions();
commit;

-- >>>>>>>>>> schema_operations_phase64_rotation_weekly_rest.sql
-- Phase 64: weekly rest, deletion of unused rotations and future rest-change requests.
-- Apply after phase 63. Existing configurations and assignments are preserved.
begin;
create or replace function public.shift_rotation_rest_overlap(p_config jsonb, p_employee uuid, p_start timestamptz, p_end timestamptz)
returns boolean language sql stable set search_path=public as $$
  select exists(select 1 from generate_series(
    (p_start at time zone 'America/Bogota')::date::timestamp,
    ((p_end-interval '1 microsecond') at time zone 'America/Bogota')::date::timestamp,interval '1 day') d
    where extract(dow from d)::integer = (p_config->'rules'->'weeklyRestDays'->>p_employee::text)::integer)
$$;
revoke all on function public.shift_rotation_rest_overlap(jsonb,uuid,timestamptz,timestamptz) from public,anon;
grant execute on function public.shift_rotation_rest_overlap(jsonb,uuid,timestamptz,timestamptz) to authenticated,service_role;

create or replace function public.preview_shift_rotation(p_contract text, p_config jsonb, p_from date, p_to date)
returns table(fecha date, employee_id uuid, employee_name text, template_id uuid, shift_id uuid, result text)
language plpgsql security definer set search_path = public as $$
declare
  v_start date; v_end date; v_days integer; v_cycle jsonb; v_member jsonb;
  v_rules jsonb := coalesce(p_config->'rules','{}'::jsonb);
  v_unavailable jsonb := coalesce(p_config->'unavailable','[]'::jsonb);
  v_rest numeric; v_daily numeric; v_weekly numeric; v_consecutive integer; v_period jsonb;
begin
  if coalesce(auth.role(),'') <> 'service_role' and not coalesce(public.is_admin_like() and public.can_read_contract_data(p_contract),false) then
    raise exception 'Sin permiso para administrar rotaciones';
  end if;
  v_start := (p_config->>'start')::date;
  v_end := nullif(p_config->>'end','')::date;
  v_days := (p_config->>'days')::integer;
  v_cycle := p_config->'cycle';
  if v_start is null or v_days is null or v_days not between 1 and 28
     or jsonb_typeof(v_cycle) is distinct from 'array' then raise exception 'Ciclo invalido'; end if;
  if jsonb_array_length(v_cycle) not between 1 and 28 or (v_end is not null and v_end < v_start)
     or p_from is null or p_to is null or p_to < p_from or p_to-p_from > 370 then raise exception 'Vigencia invalida'; end if;
  if not exists(select 1 from jsonb_array_elements_text(v_cycle) value where value is not null) then raise exception 'El ciclo requiere un plan'; end if;
  if jsonb_typeof(p_config->'members') is distinct from 'array' then raise exception 'Faltan empleados'; end if;
  if jsonb_array_length(p_config->'members') not between 1 and 200 then raise exception 'Selecciona entre 1 y 200 empleados'; end if;
  if not exists(select 1 from public.sedes s where s.codigo=p_config->>'site' and s.contrato_codigo=p_contract and s.estado='activo') then
    raise exception 'La sede no pertenece al contrato activo';
  end if;
  if exists(select 1 from jsonb_array_elements_text(v_cycle) x where x is not null and not exists(
    select 1 from public.shift_templates t where t.id=x::uuid and t.contrato_codigo=p_contract and t.estado='activo')) then
    raise exception 'Un plan no pertenece al contrato o esta inactivo';
  end if;
  if (select count(*) from jsonb_array_elements(p_config->'members')) <>
     (select count(distinct x->>'employee') from jsonb_array_elements(p_config->'members') x) then raise exception 'Empleado duplicado'; end if;
  for v_member in select value from jsonb_array_elements(p_config->'members') loop
    if (v_member->>'offset') is null or (v_member->>'offset')::integer not between 0 and jsonb_array_length(v_cycle)-1 then raise exception 'Posicion de equipo invalida'; end if;
    if not exists(select 1 from public.employees e where e.id=(v_member->>'employee')::uuid
      and e.contrato_codigo=p_contract and e.sede_codigo=p_config->>'site' and e.estado='activo') then
      raise exception 'Empleado fuera de la sede o contrato, o inactivo';
    end if;
  end loop;
  if jsonb_typeof(v_rules) is distinct from 'object' or jsonb_typeof(v_unavailable) is distinct from 'array' then
    raise exception 'Reglas o indisponibilidades invalidas';
  end if;
  if v_rules ? 'weeklyRestDays' then
    if jsonb_typeof(v_rules->'weeklyRestDays') is distinct from 'object' then raise exception 'Descansos semanales invalidos'; end if;
    if exists(select 1 from jsonb_each(v_rules->'weeklyRestDays') d
      where jsonb_typeof(d.value) <> 'number' or d.value::text !~ '^[0-6]$'
        or not exists(select 1 from jsonb_array_elements(p_config->'members') m where m->>'employee'=d.key)) then
      raise exception 'Dia de descanso invalido o empleado fuera del equipo';
    end if;
  end if;
  v_rest := coalesce((v_rules->>'minRestHours')::numeric,0);
  v_daily := coalesce((v_rules->>'maxDailyHours')::numeric,0);
  v_weekly := coalesce((v_rules->>'maxWeeklyHours')::numeric,0);
  v_consecutive := coalesce((v_rules->>'maxConsecutiveDays')::integer,0);
  if v_rest not between 0 and 72 or v_daily not between 0 and 24 or v_weekly not between 0 and 168
     or v_consecutive not between 0 and 31 then raise exception 'Limites fuera de rango'; end if;
  if jsonb_array_length(v_unavailable)>200 then raise exception 'Demasiados periodos de indisponibilidad'; end if;
  for v_period in select value from jsonb_array_elements(v_unavailable) loop
    if nullif(v_period->>'from','') is null or nullif(v_period->>'to','') is null
       or (v_period->>'to')::date < (v_period->>'from')::date
       or not exists(select 1 from jsonb_array_elements(p_config->'members') m where m->>'employee'=v_period->>'employee') then
      raise exception 'Periodo de indisponibilidad invalido o empleado fuera del equipo';
    end if;
  end loop;
  return query
  with days as (
    select d::date as work_date from generate_series(greatest(p_from-32,v_start)::timestamp,
      least(p_to+32,coalesce(v_end,p_to+32))::timestamp,interval '1 day') d
  ), expected as (
    select work_date, e.id eid, e.nombre ename,
      case when (v_rules->'weeklyRestDays'->>(m->>'employee'))::integer = extract(dow from work_date)::integer then null
        else (v_cycle->>((((work_date-v_start)/v_days)+(m->>'offset')::integer)%jsonb_array_length(v_cycle)))::uuid end tid
    from days cross join jsonb_array_elements(p_config->'members') m
    join public.employees e on e.id=(m->>'employee')::uuid
  ), candidates as (
    select x.*, s.id sid, s.starts_at, s.ends_at, s.estado, s.operarios_planeados
    from expected x left join public.scheduled_shifts s on s.template_id=x.tid and s.sede_codigo=p_config->>'site'
      and s.contrato_codigo=p_contract and s.fecha_operativa=x.work_date::text and s.estado <> 'cancelado'
  ), workload as materialized (
    -- Include existing assignments across contracts; a person cannot rest twice.
    -- UNION avoids counting an existing assignment again as a proposed shift.
    select c.eid,c.sid,c.starts_at,c.ends_at from candidates c
      where c.sid is not null and c.estado='programado' and c.starts_at>now()
      and not public.shift_rotation_rest_overlap(p_config,c.eid,c.starts_at,c.ends_at)
      and not exists(select 1 from public.shift_assignments a where a.employee_id=c.eid and a.scheduled_shift_id=c.sid
        and a.estado not in ('cancelado','reemplazado'))
    union
    select a.employee_id,s.id,s.starts_at,s.ends_at
    from public.shift_assignments a join public.scheduled_shifts s on s.id=a.scheduled_shift_id
    where a.estado not in ('cancelado','reemplazado') and s.estado<>'cancelado'
      and a.employee_id in (select (m->>'employee')::uuid from jsonb_array_elements(p_config->'members') m)
      and s.starts_at < ((p_to+33)::timestamp at time zone 'America/Bogota')
      and s.ends_at > ((p_from-32)::timestamp at time zone 'America/Bogota')
  ), daily as materialized (
    select w.eid,d.work_day::date as local_day,
      sum(extract(epoch from least(w.ends_at,(d.work_day+interval '1 day') at time zone 'America/Bogota')
        - greatest(w.starts_at,d.work_day at time zone 'America/Bogota'))/3600) hours
    from workload w cross join lateral generate_series(
      (w.starts_at at time zone 'America/Bogota')::date::timestamp,
      ((w.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date::timestamp,interval '1 day') d(work_day)
    group by w.eid,d.work_day
  ), weekly as (
    select eid,date_trunc('week',local_day)::date week_start,sum(hours) hours from daily group by eid,date_trunc('week',local_day)
  ), streak_days as (
    select eid,local_day,local_day-(row_number() over(partition by eid order by local_day))::integer as streak from daily
  ), streaks as (
    select eid,min(local_day) first_day,max(local_day) last_day,count(*) worked_days from streak_days group by eid,streak
  )
  select c.work_date,c.eid,c.ename,c.tid,c.sid,
    case
      when c.tid is null then case
        when (v_rules->'weeklyRestDays'->>c.eid::text)::integer = extract(dow from c.work_date)::integer then
          case when exists(select 1 from public.shift_assignments a join public.scheduled_shifts sh on sh.id=a.scheduled_shift_id
            where a.employee_id=c.eid and a.estado not in ('cancelado','reemplazado') and sh.estado<>'cancelado'
              and sh.starts_at < ((c.work_date+1)::timestamp at time zone 'America/Bogota')
              and sh.ends_at > (c.work_date::timestamp at time zone 'America/Bogota'))
            then 'Revisar asignacion existente: Descanso semanal' else 'Descanso semanal' end
        else 'Descanso' end
      when c.sid is null then 'Sin turno generado'
      when c.starts_at <= now() or c.estado <> 'programado' then 'Historico o iniciado'
      when public.shift_rotation_rest_overlap(p_config,c.eid,c.starts_at,c.ends_at) then
        case when exists(select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=c.eid and a.estado not in ('cancelado','reemplazado'))
          then 'Revisar asignacion existente: Descanso semanal' else 'Descanso semanal (cruce nocturno)' end
      when exists(select 1 from jsonb_array_elements(v_unavailable) u
        where (u->>'employee')::uuid=c.eid
        and c.starts_at < (((u->>'to')::date+1)::timestamp at time zone 'America/Bogota')
        and c.ends_at > ((u->>'from')::date::timestamp at time zone 'America/Bogota')) then case when exists(select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=c.eid)
          then 'Revisar asignacion existente: Empleado no disponible' else 'Empleado no disponible' end
      when v_rest>0 and exists(select 1 from workload w where w.eid=c.eid and w.sid<>c.sid
        and w.starts_at < c.ends_at+make_interval(secs=>(v_rest*3600)::double precision)
        and w.ends_at > c.starts_at-make_interval(secs=>(v_rest*3600)::double precision)) then case when exists(select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=c.eid)
          then 'Revisar asignacion existente: Descanso minimo insuficiente' else 'Descanso minimo insuficiente' end
      when v_daily>0 and exists(select 1 from daily d where d.eid=c.eid and d.hours>v_daily
        and d.local_day between (c.starts_at at time zone 'America/Bogota')::date
          and ((c.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date) then case when exists(select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=c.eid)
          then 'Revisar asignacion existente: Limite de horas diarias' else 'Limite de horas diarias' end
      when v_weekly>0 and exists(select 1 from weekly w where w.eid=c.eid and w.hours>v_weekly
        and w.week_start between date_trunc('week',c.starts_at at time zone 'America/Bogota')::date
          and date_trunc('week',(c.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date) then
        (case when exists(select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=c.eid)
          then 'Revisar asignacion existente: ' else '' end)
        || 'Limite semanal: '
        || (select trim(to_char(w.hours,'FM999999990.##')) from weekly w
            where w.eid=c.eid and w.hours>v_weekly
              and w.week_start between date_trunc('week',c.starts_at at time zone 'America/Bogota')::date
                and date_trunc('week',(c.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date
            order by w.hours desc limit 1)
        || ' h programadas / ' || trim(to_char(v_weekly,'FM999999990.##')) || ' h permitidas'
      when v_consecutive>0 and exists(select 1 from streaks st where st.eid=c.eid and st.worked_days>v_consecutive
        and st.first_day<=((c.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date
        and st.last_day>=(c.starts_at at time zone 'America/Bogota')::date) then case when exists(select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=c.eid)
          then 'Revisar asignacion existente: Limite de dias consecutivos' else 'Limite de dias consecutivos' end
      when exists(select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=c.eid) then 'Asignacion existente'
      when exists(select 1 from public.shift_assignments a join public.scheduled_shifts s on s.id=a.scheduled_shift_id
        where a.employee_id=c.eid and a.estado not in ('cancelado','reemplazado') and s.estado <> 'cancelado'
        and s.starts_at < c.ends_at and s.ends_at > c.starts_at) then 'Cruce con otra asignacion'
      when exists(select 1 from candidates other where other.eid=c.eid and other.sid<>c.sid
        and not public.shift_rotation_rest_overlap(p_config,other.eid,other.starts_at,other.ends_at)
        and other.starts_at<c.ends_at and other.ends_at>c.starts_at) then 'Cruce dentro del ciclo'
      when (select count(*) from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.estado not in ('cancelado','reemplazado'))
         + (select count(*) from candidates other where other.sid=c.sid and not exists(
             select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=other.eid
               and a.estado not in ('cancelado','reemplazado'))
             and not public.shift_rotation_rest_overlap(p_config,other.eid,other.starts_at,other.ends_at)) > c.operarios_planeados then 'Cupo insuficiente'
      else 'Por asignar'
    end::text
  from candidates c where c.work_date between p_from and p_to order by c.work_date,c.ename,c.starts_at;
end $$;



create or replace function public.shift_rotation_rules_version()
returns integer language sql stable as $$select 64$$;
revoke all on function public.shift_rotation_rules_version() from public,anon;
grant execute on function public.shift_rotation_rules_version() to authenticated,service_role;
-- Future WhatsApp/web rest-day requests.
-- These records do not modify shifts or weekly rules automatically.

create table if not exists public.shift_rest_change_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  rotation_id uuid not null references public.shift_rotations(id),
  contrato_codigo text not null references public.contracts(codigo),
  sede_codigo text not null references public.sedes(codigo),
  fecha_descanso_original date not null,
  fecha_descanso_solicitada date not null,
  motivo text not null check (length(trim(motivo)) between 1 and 2000),
  estado text not null default 'pendiente' check (estado in ('pendiente','aprobada','rechazada','cancelada')),
  origen text not null check (origen in ('whatsapp','web','administracion')),
  -- Provider message ID, not a telephone number; used to deduplicate webhooks.
  source_message_id text,
  requested_by_uid uuid references public.profiles(id) on delete set null,
  requested_at timestamptz not null default now(),
  rotation_config_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(rotation_config_snapshot)='object'),
  resolved_by_uid uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  resolution_reason text,
  -- Approval and application are separate. Future transactional application
  -- records the affected assignments here; approval alone never moves a shift.
  applied_at timestamptz,
  applied_changes jsonb not null default '{}'::jsonb check (jsonb_typeof(applied_changes)='object'),
  updated_at timestamptz not null default now(),
  check (fecha_descanso_original <> fecha_descanso_solicitada),
  check (source_message_id is null or length(trim(source_message_id)) > 0),
  check (origen <> 'whatsapp' or source_message_id is not null),
  check ((estado='pendiente' and resolved_at is null) or (estado<>'pendiente' and resolved_at is not null)),
  check (estado <> 'rechazada' or nullif(trim(resolution_reason),'') is not null),
  check (applied_at is null or (estado='aprobada' and applied_changes <> '{}'::jsonb)),
  check (applied_at is not null or applied_changes = '{}'::jsonb)
);

create unique index if not exists idx_rest_change_source_message
  on public.shift_rest_change_requests(origen,source_message_id) where source_message_id is not null;
-- One open request per original rest date, even across rotation versions.
create unique index if not exists idx_rest_change_pending_date
  on public.shift_rest_change_requests(employee_id,fecha_descanso_original)
  where estado='pendiente' or (estado='aprobada' and applied_at is null);
create index if not exists idx_rest_change_employee_dates
  on public.shift_rest_change_requests(employee_id,fecha_descanso_solicitada,requested_at desc);
create index if not exists idx_rest_change_contract_status
  on public.shift_rest_change_requests(contrato_codigo,estado,requested_at desc);
create index if not exists idx_rest_change_rotation on public.shift_rest_change_requests(rotation_id);

create or replace function public.validate_rest_change_request()
returns trigger language plpgsql set search_path=public as $$
declare r public.shift_rotations; e public.employees;
begin
  if tg_op='INSERT' then
    select * into r from public.shift_rotations where id=new.rotation_id;
    select * into e from public.employees where id=new.employee_id;
    if r.id is null or e.id is null or r.contrato_codigo is distinct from new.contrato_codigo
      or e.contrato_codigo is distinct from new.contrato_codigo
      or r.config->>'site' is distinct from new.sede_codigo or e.sede_codigo is distinct from new.sede_codigo
      or not exists(select 1 from jsonb_array_elements(r.config->'members') m where m->>'employee'=new.employee_id::text) then
      raise exception 'Empleado, sede y contrato no corresponden a la rotacion';
    end if;
    if new.estado<>'pendiente' or new.applied_at is not null or new.resolved_by_uid is not null then
      raise exception 'La solicitud debe crearse pendiente';
    end if;
    new.rotation_config_snapshot := r.config;
    new.requested_at := clock_timestamp();
  else
    if row(new.employee_id,new.rotation_id,new.contrato_codigo,new.sede_codigo,
        new.fecha_descanso_original,new.fecha_descanso_solicitada,new.motivo,new.origen,new.source_message_id,
        new.requested_at,new.requested_by_uid,new.rotation_config_snapshot)
      is distinct from row(old.employee_id,old.rotation_id,old.contrato_codigo,old.sede_codigo,
        old.fecha_descanso_original,old.fecha_descanso_solicitada,old.motivo,old.origen,old.source_message_id,
        old.requested_at,old.requested_by_uid,old.rotation_config_snapshot) then
      raise exception 'Los datos originales de la solicitud no se pueden modificar';
    end if;
    if old.estado<>'pendiente' and row(new.estado,new.resolved_by_uid,new.resolved_at,new.resolution_reason)
      is distinct from row(old.estado,old.resolved_by_uid,old.resolved_at,old.resolution_reason) then
      raise exception 'La solicitud ya fue resuelta';
    end if;
    if old.applied_at is not null and row(new.applied_at,new.applied_changes) is distinct from row(old.applied_at,old.applied_changes) then
      raise exception 'La aplicacion del cambio ya fue registrada';
    end if;
    if new.estado is distinct from old.estado then
      if new.estado in ('aprobada','rechazada') and new.resolved_by_uid is null then
        raise exception 'Falta el responsable de la decision';
      end if;
      new.resolved_at := clock_timestamp();
    end if;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end $$;
drop trigger if exists trg_validate_rest_change_request on public.shift_rest_change_requests;
drop trigger if exists trg_validate_rest_change_request on public.shift_rest_change_requests;
create trigger trg_validate_rest_change_request before insert or update on public.shift_rest_change_requests
  for each row execute function public.validate_rest_change_request();

alter table public.shift_rest_change_requests enable row level security;
revoke all on public.shift_rest_change_requests from public,anon,authenticated;
grant select on public.shift_rest_change_requests to authenticated;
-- Employee identity/phone ownership must be verified by the future backend.
-- Browser clients cannot create, approve, apply or delete requests directly.
grant select,insert,update on public.shift_rest_change_requests to service_role;
drop policy if exists rest_change_requests_read on public.shift_rest_change_requests;
drop policy if exists rest_change_requests_read on public.shift_rest_change_requests;
create policy rest_change_requests_read on public.shift_rest_change_requests for select to authenticated
  using (public.is_admin_like() and public.can_read_contract_data(contrato_codigo));

create or replace function public.delete_shift_rotation(p_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare r public.shift_rotations;
begin
  select * into r from public.shift_rotations where id=p_id for update;
  if r.id is null then raise exception 'Rotacion no encontrada'; end if;
  if coalesce(auth.role(),'')<>'service_role' and not coalesce(public.is_admin_like() and public.can_read_contract_data(r.contrato_codigo),false) then raise exception 'Sin permiso'; end if;
  if r.estado='activo' then raise exception 'Pausa la rotacion antes de eliminarla'; end if;
  if exists(select 1 from public.shift_assignments where rotation_id=p_id)
    or exists(select 1 from public.shift_rest_change_requests where rotation_id=p_id) then
    raise exception 'La rotacion tiene asignaciones o solicitudes. Conservala pausada para mantener el historial';
  end if;
  delete from public.shift_rotations where id=p_id;
end $$;
revoke all on function public.delete_shift_rotation(uuid) from public,anon;
grant execute on function public.delete_shift_rotation(uuid) to authenticated,service_role;
commit;


-- >>>>>>>>>> schema_operations_phase66_rotation_business_rules.sql
-- Phase 66: business rules for rotations.
--   1. Lunch per shift rule; shifts keep a copy so hours are net of lunch.
--   2. Weekly rest per week: rotating rest days, compensatory day after Sunday work, swaps between employees and moves.
--   3. Weekly overtime recorded per employee and week (Colombian weekly limit).
--   4. Optional replacement of the manual schedule when a rotation is activated.
-- Weeks run from Sunday to Saturday (42 h: Sunday plus five weekdays). Whoever is planned to work Sunday rests one day of
-- that same week; whoever does not work Sunday already rested and nothing extra is owed: no rule looks at the previous week.
-- Apply after phase 64. Existing rotations keep the fixed weekly rest ("fijo") until switched to "rotativo".
-- Existing assignments are never moved or deleted by this migration.
begin;

-- ---------------------------------------------------------------- 1. Lunch
do $$
begin
  if to_regclass('public.shift_template_rules') is not null
     and not exists (select 1 from information_schema.columns
       where table_schema='public' and table_name='shift_template_rules' and column_name='almuerzo_minutos') then
    alter table public.shift_template_rules
      add column almuerzo_minutos integer not null default 60 check (almuerzo_minutos between 0 and 240);
    -- Short shifts (under 6 hours) normally have no lunch; the administrator can edit the value afterwards.
    update public.shift_template_rules
    set almuerzo_minutos = 0
    where (extract(epoch from (hora_fin - hora_inicio)) + case when cruza_dia then 86400 else 0 end) / 3600 < 6;
  end if;
  if to_regclass('public.scheduled_shifts') is not null
     and not exists (select 1 from information_schema.columns
       where table_schema='public' and table_name='scheduled_shifts' and column_name='almuerzo_minutos') then
    alter table public.scheduled_shifts
      add column almuerzo_minutos integer not null default 0 check (almuerzo_minutos between 0 and 240);
    if to_regclass('public.shift_template_rules') is not null then
      update public.scheduled_shifts s set almuerzo_minutos = r.almuerzo_minutos
      from public.shift_template_rules r
      where s.template_rule_id = r.id and s.almuerzo_minutos is distinct from r.almuerzo_minutos;
    end if;
  end if;
end
$$;

-- Fraction of a shift that is worked time (1 - lunch / duration).
create or replace function public.shift_net_ratio(p_start timestamptz, p_end timestamptz, p_lunch integer)
returns numeric language sql immutable as $$
  select case when p_end <= p_start then 0::numeric
    else greatest(0::numeric, 1 - coalesce(p_lunch,0) * 60.0 / extract(epoch from (p_end - p_start))) end
$$;

-- First day (Sunday) of the week of a date. Weeks run from Sunday to Saturday.
create or replace function public.rotation_week_start(p_date date)
returns date language sql immutable as $$ select p_date - extract(dow from p_date)::integer $$;
revoke all on function public.rotation_week_start(date) from public,anon;
grant execute on function public.rotation_week_start(date) to authenticated,service_role;

-- Where the cycle counts its stages from. Stages of whole weeks (7, 14, 21, 28 days) change on Sunday, the first day of the
-- week, whatever the start date is; the validity (start / end) still uses the real dates.
create or replace function public.rotation_cycle_origin(p_start date, p_days integer)
returns date language sql immutable as $$ select case when p_days % 7 = 0 then public.rotation_week_start(p_start) else p_start end $$;
revoke all on function public.rotation_cycle_origin(date,integer) from public,anon;
grant execute on function public.rotation_cycle_origin(date,integer) to authenticated,service_role;

-- Ordinary weekly limit in Colombia (Law 2101 of 2021), in minutes, for the week starting on p_date.
create or replace function public.colombia_weekly_limit_minutes(p_date date)
returns integer language sql immutable as $$
  select (case when p_date >= date '2026-07-15' then 42 when p_date >= date '2025-07-15' then 44
    when p_date >= date '2024-07-15' then 46 when p_date >= date '2023-07-15' then 47 else 48 end) * 60
$$;
revoke all on function public.shift_net_ratio(timestamptz,timestamptz,integer) from public,anon;
revoke all on function public.colombia_weekly_limit_minutes(date) from public,anon;
grant execute on function public.shift_net_ratio(timestamptz,timestamptz,integer) to authenticated,service_role;
grant execute on function public.colombia_weekly_limit_minutes(date) to authenticated,service_role;

-- ---------------------------------------------------------------- 2. Weekly rest
-- Additional rest days (never the rest days of the cycle itself) as a set: one row per employee and rest date.
--   restMode 'fijo'     legacy: the fixed weekday of rules.weeklyRestDays, every week.
--   restMode 'rotativo' weeks run Sunday to Saturday. An employee planned to work Sunday rests one day of that same week
--                       (Monday to Saturday, different every week and spread across the team): a compensatory rest.
--                       Without Sunday work (Sunday is the natural rest) or with another rest in the week nothing is added.
--   rules.restPlan      explicit overrides { employee: { week_start_sunday: { compensatorio: date } } } (swaps and moves).
-- Weekdays (0 = Sunday ... 6 = Saturday) on which a plan has active schedules. Plans without rules: every day.
create or replace function public.shift_template_operating_days(p_template uuid)
returns integer[] language plpgsql stable set search_path=public as $$
declare v_days integer[];
begin
  if p_template is null or to_regclass('public.shift_template_rules') is null then return array[0,1,2,3,4,5,6]; end if;
  execute 'select array_agg(distinct dia_semana::integer) from public.shift_template_rules where template_id=$1 and estado=''activo'' and tipo_dia=''dia_semana'' and dia_semana is not null'
    into v_days using p_template;
  return coalesce(v_days, array[0,1,2,3,4,5,6]);
end $$;
revoke all on function public.shift_template_operating_days(uuid) from public,anon;
grant execute on function public.shift_template_operating_days(uuid) to authenticated,service_role;

create or replace function public.shift_rotation_rest_days(p_config jsonb, p_from date, p_to date)
returns table(employee_id uuid, rest_date date, kind text)
language plpgsql stable set search_path=public as $$
#variable_conflict use_column
declare
  v_start date := (p_config->>'start')::date;
  v_end date := nullif(p_config->>'end','')::date;
  v_days integer := (p_config->>'days')::integer;
  v_cycle jsonb := p_config->'cycle';
  v_len integer := jsonb_array_length(p_config->'cycle');
  v_rules jsonb := coalesce(p_config->'rules','{}'::jsonb);
  v_plan jsonb := coalesce(p_config->'rules'->'restPlan','{}'::jsonb);
  v_first date := greatest(p_from,(p_config->>'start')::date);
  v_last date := least(p_to,coalesce(nullif(p_config->>'end','')::date,p_to));
  v_ops jsonb;
begin
  if v_first > v_last then return; end if;
  if coalesce(v_rules->>'restMode','fijo') <> 'rotativo' then
    return query
      select (m->>'employee')::uuid, d::date, 'semanal'::text
      from generate_series(v_first::timestamp,v_last::timestamp,interval '1 day') d
      cross join jsonb_array_elements(p_config->'members') m
      where not coalesce((m->>'reliever')::boolean,false)
        and (v_rules->'weeklyRestDays'->>(m->>'employee')) is not null
        and (v_rules->'weeklyRestDays'->>(m->>'employee'))::integer = extract(dow from d)::integer;
    return;
  end if;
  select coalesce(jsonb_object_agg(t, to_jsonb(public.shift_template_operating_days(t::uuid))), '{}'::jsonb) into v_ops
  from (select distinct value t from jsonb_array_elements_text(v_cycle) value where value is not null) x;
  return query
  with members as (
    select m->>'employee' eid, (m->>'offset')::integer off,
      (row_number() over (order by (m->>'offset')::integer, m->>'employee') - 1)::integer idx
    from jsonb_array_elements(p_config->'members') m
    where not coalesce((m->>'reliever')::boolean,false)
  ), weeks as (
    select w::date wstart from generate_series(public.rotation_week_start(v_first)::timestamp,public.rotation_week_start(v_last)::timestamp,interval '7 days') w
  ), mw as (
    select mb.eid, mb.off, mb.idx, wk.wstart, ((wk.wstart - public.rotation_week_start(v_start)) / 7) wknum
    from members mb cross join weeks wk
  ), cyc0 as (
    select mw.eid, mw.wstart, (mw.wstart + g) dia, v_cycle->>((((mw.wstart + g) - public.rotation_cycle_origin(v_start,v_days)) / v_days + mw.off) % v_len) tpl
    from mw cross join generate_series(0,6) g
  ), cyc as (
    -- State of each day for each employee: the Sunday before the week and the week itself. A day is rest when the cycle has
    -- no plan or the plan does not operate that weekday (Sunday is then the natural rest).
    select eid, wstart, dia,
      case when dia < v_start or (v_end is not null and dia > v_end) then 'fuera'
           when tpl is null then 'descanso'
           when not (coalesce(v_ops->tpl,'[0,1,2,3,4,5,6]'::jsonb) @> to_jsonb(extract(dow from dia)::integer)) then 'descanso'
           else 'trabajo' end estado
    from cyc0
  ), slots as (
    select mw.*,
      -- Sunday (first day of the week) worked and no other rest in the week: one compensatory rest from Monday to Saturday.
      case when exists(select 1 from cyc c where c.eid=mw.eid and c.wstart=mw.wstart and c.dia=mw.wstart and c.estado='trabajo')
             and not exists(select 1 from cyc c where c.eid=mw.eid and c.wstart=mw.wstart and c.dia>mw.wstart and c.estado='descanso') then 'compensatorio' end kind
    from mw
  )
  select s.eid::uuid,
    coalesce(nullif(v_plan->s.eid->(s.wstart::text)->>s.kind,'')::date, s.wstart + 1 + ((s.idx + s.wknum) % 6)),
    s.kind
  from slots s
  where s.kind is not null
    and coalesce(nullif(v_plan->s.eid->(s.wstart::text)->>s.kind,'')::date, s.wstart + 1 + ((s.idx + s.wknum) % 6)) between v_first and v_last;
end
$$;
revoke all on function public.shift_rotation_rest_days(jsonb,date,date) from public,anon;
grant execute on function public.shift_rotation_rest_days(jsonb,date,date) to authenticated,service_role;

create or replace function public.shift_rotation_rest_plan_set(p_plan jsonb, p_employee text, p_monday date, p_kind text, p_date date)
returns jsonb language sql immutable as $$
  select jsonb_set(
    jsonb_set(
      jsonb_set(coalesce(p_plan,'{}'::jsonb), array[p_employee], coalesce(p_plan->p_employee,'{}'::jsonb), true),
      array[p_employee, p_monday::text], coalesce(p_plan->p_employee->(p_monday::text),'{}'::jsonb), true),
    array[p_employee, p_monday::text, p_kind], to_jsonb(p_date::text), true)
$$;
revoke all on function public.shift_rotation_rest_plan_set(jsonb,text,date,text,date) from public,anon;

create or replace function public.preview_shift_rotation(p_contract text, p_config jsonb, p_from date, p_to date)
returns table(fecha date, employee_id uuid, employee_name text, template_id uuid, shift_id uuid, result text)
language plpgsql security definer set search_path = public as $$
declare
  v_start date; v_end date; v_days integer; v_cycle jsonb; v_member jsonb;
  v_rules jsonb := coalesce(p_config->'rules','{}'::jsonb);
  v_unavailable jsonb := coalesce(p_config->'unavailable','[]'::jsonb);
  v_rest numeric; v_daily numeric; v_weekly numeric; v_consecutive integer; v_period jsonb; v_ops jsonb;
begin
  if coalesce(auth.role(),'') <> 'service_role' and not coalesce(public.is_admin_like() and public.can_read_contract_data(p_contract),false) then
    raise exception 'Sin permiso para administrar rotaciones';
  end if;
  v_start := (p_config->>'start')::date;
  v_end := nullif(p_config->>'end','')::date;
  v_days := (p_config->>'days')::integer;
  v_cycle := p_config->'cycle';
  if v_start is null or v_days is null or v_days not between 1 and 28
     or jsonb_typeof(v_cycle) is distinct from 'array' then raise exception 'Ciclo invalido'; end if;
  if jsonb_array_length(v_cycle) not between 1 and 28 or (v_end is not null and v_end < v_start)
     or p_from is null or p_to is null or p_to < p_from or p_to-p_from > 370 then raise exception 'Vigencia invalida'; end if;
  if not exists(select 1 from jsonb_array_elements_text(v_cycle) value where value is not null) then raise exception 'El ciclo requiere un plan'; end if;
  if jsonb_typeof(p_config->'members') is distinct from 'array' then raise exception 'Faltan empleados'; end if;
  if jsonb_array_length(p_config->'members') not between 1 and 200 then raise exception 'Selecciona entre 1 y 200 empleados'; end if;
  if not exists(select 1 from public.sedes s where s.codigo=p_config->>'site' and s.contrato_codigo=p_contract and s.estado='activo') then
    raise exception 'La sede no pertenece al contrato activo';
  end if;
  if exists(select 1 from jsonb_array_elements_text(v_cycle) x where x is not null and not exists(
    select 1 from public.shift_templates t where t.id=x::uuid and t.contrato_codigo=p_contract and t.estado='activo')) then
    raise exception 'Un plan no pertenece al contrato o esta inactivo';
  end if;
  if (select count(*) from jsonb_array_elements(p_config->'members')) <>
     (select count(distinct x->>'employee') from jsonb_array_elements(p_config->'members') x) then raise exception 'Empleado duplicado'; end if;
  for v_member in select value from jsonb_array_elements(p_config->'members') loop
    if (v_member->>'offset') is null or (v_member->>'offset')::integer not between 0 and jsonb_array_length(v_cycle)-1 then raise exception 'Posicion de equipo invalida'; end if;
    if not exists(select 1 from public.employees e where e.id=(v_member->>'employee')::uuid
      and e.contrato_codigo=p_contract and e.sede_codigo=p_config->>'site' and e.estado='activo') then
      raise exception 'Empleado fuera de la sede o contrato, o inactivo';
    end if;
  end loop;
  if jsonb_typeof(v_rules) is distinct from 'object' or jsonb_typeof(v_unavailable) is distinct from 'array' then
    raise exception 'Reglas o indisponibilidades invalidas';
  end if;
  if v_rules ? 'weeklyRestDays' then
    if jsonb_typeof(v_rules->'weeklyRestDays') is distinct from 'object' then raise exception 'Descansos semanales invalidos'; end if;
    if exists(select 1 from jsonb_each(v_rules->'weeklyRestDays') d
      where jsonb_typeof(d.value) <> 'number' or d.value::text !~ '^[0-6]$'
        or not exists(select 1 from jsonb_array_elements(p_config->'members') m where m->>'employee'=d.key)) then
      raise exception 'Dia de descanso invalido o empleado fuera del equipo';
    end if;
  end if;
  if exists(select 1 from jsonb_array_elements(p_config->'members') m where m ? 'reliever' and jsonb_typeof(m->'reliever') not in ('boolean','null')) then
    raise exception 'Relevo invalido';
  end if;
  if v_rules ? 'restMode' and v_rules->>'restMode' not in ('fijo','rotativo') then raise exception 'Modo de descanso invalido'; end if;
  if v_rules ? 'restPlan' and jsonb_typeof(v_rules->'restPlan') is distinct from 'object' then raise exception 'Plan de descansos invalido'; end if;
  if v_rules ? 'surplusPlan' and jsonb_typeof(v_rules->'surplusPlan') is distinct from 'object' then raise exception 'Plan de sobrantes invalido'; end if;
  v_rest := coalesce((v_rules->>'minRestHours')::numeric,0);
  v_daily := coalesce((v_rules->>'maxDailyHours')::numeric,0);
  v_weekly := coalesce((v_rules->>'maxWeeklyHours')::numeric,0);
  v_consecutive := coalesce((v_rules->>'maxConsecutiveDays')::integer,0);
  if v_rest not between 0 and 72 or v_daily not between 0 and 24 or v_weekly not between 0 and 168
     or v_consecutive not between 0 and 31 then raise exception 'Limites fuera de rango'; end if;
  if jsonb_array_length(v_unavailable)>200 then raise exception 'Demasiados periodos de indisponibilidad'; end if;
  for v_period in select value from jsonb_array_elements(v_unavailable) loop
    if nullif(v_period->>'from','') is null or nullif(v_period->>'to','') is null
       or (v_period->>'to')::date < (v_period->>'from')::date
       or not exists(select 1 from jsonb_array_elements(p_config->'members') m where m->>'employee'=v_period->>'employee') then
      raise exception 'Periodo de indisponibilidad invalido o empleado fuera del equipo';
    end if;
  end loop;
  select coalesce(jsonb_object_agg(t, to_jsonb(public.shift_template_operating_days(t::uuid))), '{}'::jsonb) into v_ops
  from (select distinct value t from jsonb_array_elements_text(v_cycle) value where value is not null) x;
  return query
  with days as (
    select d::date as work_date from generate_series(greatest(p_from-32,v_start)::timestamp,
      least(p_to+32,coalesce(v_end,p_to+32))::timestamp,interval '1 day') d
  ), rest as materialized (
    select * from public.shift_rotation_rest_days(p_config,greatest(p_from-32,v_start),least(p_to+32,coalesce(v_end,p_to+32)))
  ), relief as materialized (
    select * from public.shift_rotation_relief(p_config,greatest(p_from-32,v_start),least(p_to+32,coalesce(v_end,p_to+32)))
  ), expected as (
    select work_date, e.id eid, e.nombre ename,
      case when coalesce((m->>'reliever')::boolean,false) then
             case when exists(select 1 from relief rf where rf.employee_id=e.id and rf.work_date=days.work_date) then null else 'relevo' end
           else (select r.kind from rest r where r.employee_id=e.id and r.rest_date=work_date limit 1) end rkind,
      coalesce((select rf.surplus from relief rf where rf.employee_id=e.id and rf.work_date=days.work_date limit 1),false) surplus,
      case when coalesce((m->>'reliever')::boolean,false) then (select rf.template_id from relief rf where rf.employee_id=e.id and rf.work_date=days.work_date limit 1)
        when exists(select 1 from rest r where r.employee_id=e.id and r.rest_date=days.work_date) then null
        else (select q.t from (select (v_cycle->>((((days.work_date-public.rotation_cycle_origin(v_start,v_days))/v_days)+(m->>'offset')::integer)%jsonb_array_length(v_cycle)))::uuid t) q
              where coalesce(v_ops->(q.t::text),'[0,1,2,3,4,5,6]'::jsonb) @> to_jsonb(extract(dow from days.work_date)::integer)) end tid
    from days cross join jsonb_array_elements(p_config->'members') m
    join public.employees e on e.id=(m->>'employee')::uuid
  ), candidates as (
    select x.*, s.id sid, s.starts_at, s.ends_at, s.estado, s.operarios_planeados, s.almuerzo_minutos lunch
    from expected x left join public.scheduled_shifts s on s.template_id=x.tid and s.sede_codigo=p_config->>'site'
      and s.contrato_codigo=p_contract and s.fecha_operativa=x.work_date::text and s.estado <> 'cancelado'
  ), workload as materialized (
    -- Include existing assignments across contracts; a person cannot rest twice.
    -- UNION avoids counting an existing assignment again as a proposed shift.
    select c.eid,c.sid,c.starts_at,c.ends_at,c.lunch from candidates c
      where c.sid is not null and c.estado='programado' and c.starts_at>now()
      and not exists(select 1 from rest rd where rd.employee_id=c.eid and rd.rest_date between (c.starts_at at time zone 'America/Bogota')::date and ((c.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date)
      and not exists(select 1 from public.shift_assignments a where a.employee_id=c.eid and a.scheduled_shift_id=c.sid
        and a.estado not in ('cancelado','reemplazado'))
    union
    select a.employee_id,s.id,s.starts_at,s.ends_at,s.almuerzo_minutos
    from public.shift_assignments a join public.scheduled_shifts s on s.id=a.scheduled_shift_id
    where a.estado not in ('cancelado','reemplazado') and s.estado<>'cancelado'
      and a.employee_id in (select (m->>'employee')::uuid from jsonb_array_elements(p_config->'members') m)
      -- Assignments a rotation made on a day that is now a rest day will be replaced: they are reported on their own
      -- ('Revisar asignacion existente') and must not also break the limits of the neighbouring days.
      and not (a.rotation_id is not null and exists(select 1 from rest rd where rd.employee_id=a.employee_id
        and rd.rest_date between (s.starts_at at time zone 'America/Bogota')::date and ((s.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date))
      and s.starts_at < ((p_to+33)::timestamp at time zone 'America/Bogota')
      and s.ends_at > ((p_from-32)::timestamp at time zone 'America/Bogota')
  ), daily as materialized (
    select w.eid,d.work_day::date as local_day,
      sum(extract(epoch from least(w.ends_at,(d.work_day+interval '1 day') at time zone 'America/Bogota')
        - greatest(w.starts_at,d.work_day at time zone 'America/Bogota'))/3600 * public.shift_net_ratio(w.starts_at,w.ends_at,w.lunch)) hours
    from workload w cross join lateral generate_series(
      (w.starts_at at time zone 'America/Bogota')::date::timestamp,
      ((w.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date::timestamp,interval '1 day') d(work_day)
    group by w.eid,d.work_day
  ), weekly as (
    select eid,public.rotation_week_start(local_day) week_start,sum(hours) hours from daily group by eid,public.rotation_week_start(local_day)
  ), streak_days as (
    select eid,local_day,local_day-(row_number() over(partition by eid order by local_day))::integer as streak from daily
  ), streaks as (
    select eid,min(local_day) first_day,max(local_day) last_day,count(*) worked_days from streak_days group by eid,streak
  )
  select c.work_date,c.eid,c.ename,c.tid,c.sid,
    case
      when c.tid is null then case
        when c.rkind is not null then
          case when exists(select 1 from public.shift_assignments a join public.scheduled_shifts sh on sh.id=a.scheduled_shift_id
            where a.employee_id=c.eid and a.estado not in ('cancelado','reemplazado') and sh.estado<>'cancelado'
              and (sh.starts_at at time zone 'America/Bogota')::date = c.work_date)
            then 'Revisar asignacion existente: Descanso ' || c.rkind else 'Descanso ' || c.rkind end
        else 'Descanso' end
      when c.sid is null then 'Sin turno generado'
      when c.starts_at <= now() or c.estado <> 'programado' then 'Historico o iniciado'
      when exists(select 1 from rest rd where rd.employee_id=c.eid and rd.rest_date between (c.starts_at at time zone 'America/Bogota')::date and ((c.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date) then
        case when exists(select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=c.eid and a.estado not in ('cancelado','reemplazado'))
          then 'Revisar asignacion existente: Descanso ' || (select rd.kind from rest rd where rd.employee_id=c.eid
            and rd.rest_date between (c.starts_at at time zone 'America/Bogota')::date and ((c.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date limit 1)
          else 'Descanso ' || (select rd.kind from rest rd where rd.employee_id=c.eid
            and rd.rest_date between (c.starts_at at time zone 'America/Bogota')::date and ((c.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date limit 1) || ' (cruce nocturno)' end
      when exists(select 1 from jsonb_array_elements(v_unavailable) u
        where (u->>'employee')::uuid=c.eid
        and c.starts_at < (((u->>'to')::date+1)::timestamp at time zone 'America/Bogota')
        and c.ends_at > ((u->>'from')::date::timestamp at time zone 'America/Bogota')) then case when exists(select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=c.eid)
          then 'Revisar asignacion existente: Empleado no disponible' else 'Empleado no disponible' end
      when v_rest>0 and exists(select 1 from workload w where w.eid=c.eid and w.sid<>c.sid
        and w.starts_at < c.ends_at+make_interval(secs=>(v_rest*3600)::double precision)
        and w.ends_at > c.starts_at-make_interval(secs=>(v_rest*3600)::double precision)) then case when exists(select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=c.eid)
          then 'Revisar asignacion existente: Descanso minimo insuficiente' else 'Descanso minimo insuficiente' end
      when v_daily>0 and exists(select 1 from daily d where d.eid=c.eid and d.hours>v_daily
        and d.local_day between (c.starts_at at time zone 'America/Bogota')::date
          and ((c.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date) then case when exists(select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=c.eid)
          then 'Revisar asignacion existente: Limite de horas diarias' else 'Limite de horas diarias' end
      when v_weekly>0 and exists(select 1 from weekly w where w.eid=c.eid and w.hours>v_weekly
        and w.week_start between public.rotation_week_start((c.starts_at at time zone 'America/Bogota')::date)
          and public.rotation_week_start(((c.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date)) then
        (case when exists(select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=c.eid)
          then 'Revisar asignacion existente: ' else '' end)
        || 'Limite semanal: '
        || (select trim(to_char(w.hours,'FM999999990.##')) from weekly w
            where w.eid=c.eid and w.hours>v_weekly
              and w.week_start between public.rotation_week_start((c.starts_at at time zone 'America/Bogota')::date)
                and public.rotation_week_start(((c.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date)
            order by w.hours desc limit 1)
        || ' h programadas / ' || trim(to_char(v_weekly,'FM999999990.##')) || ' h permitidas'
      when v_consecutive>0 and exists(select 1 from streaks st where st.eid=c.eid and st.worked_days>v_consecutive
        and st.first_day<=((c.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date
        and st.last_day>=(c.starts_at at time zone 'America/Bogota')::date) then case when exists(select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=c.eid)
          then 'Revisar asignacion existente: ' else '' end
        || 'Limite de dias consecutivos: ' || (select st.worked_days from streaks st where st.eid=c.eid and st.worked_days>v_consecutive and st.first_day<=((c.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date and st.last_day>=(c.starts_at at time zone 'America/Bogota')::date order by st.worked_days desc limit 1) || ' dias seguidos / ' || v_consecutive || ' permitidos'
      when exists(select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=c.eid) then 'Asignacion existente'
      when exists(select 1 from public.shift_assignments a join public.scheduled_shifts s on s.id=a.scheduled_shift_id
        where a.employee_id=c.eid and a.estado not in ('cancelado','reemplazado') and s.estado <> 'cancelado'
        and s.starts_at < c.ends_at and s.ends_at > c.starts_at) then
        'Cruce con otra asignacion: ' || (select coalesce('rotacion ' || ro.nombre, 'asignacion manual') || ' de '
          || to_char(s.starts_at at time zone 'America/Bogota','HH24:MI') || ' a ' || to_char(s.ends_at at time zone 'America/Bogota','HH24:MI')
          || ' (' || to_char(s.starts_at at time zone 'America/Bogota','DD/MM') || ')'
          from public.shift_assignments a join public.scheduled_shifts s on s.id=a.scheduled_shift_id
          left join public.shift_rotations ro on ro.id=a.rotation_id
          where a.employee_id=c.eid and a.estado not in ('cancelado','reemplazado') and s.estado <> 'cancelado'
            and s.starts_at < c.ends_at and s.ends_at > c.starts_at order by s.starts_at limit 1)
      when exists(select 1 from candidates other where other.eid=c.eid and other.sid<>c.sid
        and not exists(select 1 from rest rd where rd.employee_id=other.eid and rd.rest_date between (other.starts_at at time zone 'America/Bogota')::date and ((other.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date)
        and other.starts_at<c.ends_at and other.ends_at>c.starts_at) then 'Cruce dentro del ciclo'
      when not c.surplus and (select count(*) from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.estado not in ('cancelado','reemplazado'))
         + (select count(*) from candidates other where other.sid=c.sid and not other.surplus and not exists(
             select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=other.eid
               and a.estado not in ('cancelado','reemplazado'))
             and not exists(select 1 from rest rd where rd.employee_id=other.eid and rd.rest_date between (other.starts_at at time zone 'America/Bogota')::date and ((other.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date)
             and not exists(select 1 from jsonb_array_elements(v_unavailable) u2 where (u2->>'employee')::uuid=other.eid
               and other.starts_at < (((u2->>'to')::date+1)::timestamp at time zone 'America/Bogota')
               and other.ends_at > ((u2->>'from')::date::timestamp at time zone 'America/Bogota'))) > c.operarios_planeados then
        'Cupo insuficiente: ' || ((select count(*) from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.estado not in ('cancelado','reemplazado'))
           + (select count(*) from candidates other where other.sid=c.sid and not other.surplus and not exists(
               select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=other.eid
                 and a.estado not in ('cancelado','reemplazado'))
               and not exists(select 1 from rest rd where rd.employee_id=other.eid and rd.rest_date between (other.starts_at at time zone 'America/Bogota')::date and ((other.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date))) || ' personas en el turno para ' || c.operarios_planeados || ' cupos'
      when c.surplus then 'Por asignar (sobrante)'
      else 'Por asignar'
    end::text
  from candidates c where c.work_date between p_from and p_to order by c.work_date,c.ename,c.starts_at;
end $$;

-- ---------------------------------------------------------------- 3. Overtime
create table if not exists public.shift_overtime_weeks (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  contrato_codigo text not null,
  sede_codigo text,
  rotation_id uuid references public.shift_rotations(id) on delete set null,
  week_start date not null,
  worked_minutes integer not null check (worked_minutes >= 0),
  limit_minutes integer not null check (limit_minutes > 0),
  overtime_minutes integer not null check (overtime_minutes >= 0),
  computed_at timestamptz not null default now(),
  unique (employee_id, week_start)
);
create index if not exists idx_overtime_weeks_contract_week on public.shift_overtime_weeks(contrato_codigo, week_start);
-- Weeks used to start on Monday; they start on Sunday now. Derived data: rows are recalculated when a rotation is applied.
delete from public.shift_overtime_weeks where extract(dow from week_start) <> 0;
alter table public.shift_overtime_weeks enable row level security;
revoke all on public.shift_overtime_weeks from public, anon, authenticated;
grant select on public.shift_overtime_weeks to authenticated;
grant select, insert, update, delete on public.shift_overtime_weeks to service_role;
drop policy if exists overtime_weeks_read on public.shift_overtime_weeks;
drop policy if exists overtime_weeks_read on public.shift_overtime_weeks;
create policy overtime_weeks_read on public.shift_overtime_weeks for select to authenticated
  using (public.is_admin_like() and public.can_read_contract_data(contrato_codigo));

-- Weekly worked time (net of lunch, Sunday to Saturday, all current assignments of each rotation member) against the
-- ordinary weekly limit. Overtime is whatever exceeds it. Recomputed every time the rotation is applied.
create or replace function public.record_rotation_overtime(p_rotation uuid, p_from date, p_to date)
returns integer language plpgsql security definer set search_path=public as $$
declare r public.shift_rotations; n integer := 0;
begin
  select * into r from public.shift_rotations where id=p_rotation;
  if r.id is null then raise exception 'Rotacion no encontrada'; end if;
  if coalesce(auth.role(),'')<>'service_role' and not coalesce(public.is_admin_like() and public.can_read_contract_data(r.contrato_codigo),false) then
    raise exception 'Sin permiso';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 370 then raise exception 'Rango invalido'; end if;
  with members as (
    select (m->>'employee')::uuid eid from jsonb_array_elements(r.config->'members') m
  ), weeks as (
    select w::date wstart from generate_series(public.rotation_week_start(p_from)::timestamp,public.rotation_week_start(p_to)::timestamp,interval '7 days') w
  ), segments as (
    -- The whole shift counts on the day it starts (also overnight shifts), like the calendar shows it.
    select a.employee_id eid, (s.starts_at at time zone 'America/Bogota')::date local_day,
      extract(epoch from (s.ends_at - s.starts_at)) / 60 * public.shift_net_ratio(s.starts_at,s.ends_at,s.almuerzo_minutos) mins
    from public.shift_assignments a
    join public.scheduled_shifts s on s.id=a.scheduled_shift_id
    where a.employee_id in (select eid from members)
      and a.estado not in ('cancelado','reemplazado') and s.estado<>'cancelado'
      and s.starts_at < ((p_to+8)::timestamp at time zone 'America/Bogota')
      and s.ends_at > ((p_from-8)::timestamp at time zone 'America/Bogota')
  ), totals as (
    select m.eid, w.wstart, coalesce(round(sum(g.mins)),0)::integer worked
    from members m cross join weeks w
    left join segments g on g.eid=m.eid and g.local_day between w.wstart and w.wstart+6
    group by m.eid, w.wstart
  )
  insert into public.shift_overtime_weeks(employee_id,contrato_codigo,sede_codigo,rotation_id,week_start,worked_minutes,limit_minutes,overtime_minutes)
  select t.eid, r.contrato_codigo, r.config->>'site', r.id, t.wstart, t.worked,
    public.colombia_weekly_limit_minutes(t.wstart), greatest(0, t.worked - public.colombia_weekly_limit_minutes(t.wstart))
  from totals t
  on conflict (employee_id, week_start) do update set
    contrato_codigo=excluded.contrato_codigo, sede_codigo=excluded.sede_codigo, rotation_id=excluded.rotation_id,
    worked_minutes=excluded.worked_minutes, limit_minutes=excluded.limit_minutes,
    overtime_minutes=excluded.overtime_minutes, computed_at=now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.record_rotation_overtime(uuid,date,date) from public,anon;
grant execute on function public.record_rotation_overtime(uuid,date,date) to authenticated,service_role;

create or replace function public.apply_shift_rotation(p_id uuid, p_activate boolean default false)
returns integer language plpgsql security definer set search_path=public as $$
declare r public.shift_rotations; x record; e public.employees; s public.scheduled_shifts; n integer:=0; v_count integer; v_expected jsonb;
begin
  -- Serialize rotation runs and protect the check/insert window against manual assignments.
  lock table public.scheduled_shifts in share mode;
  lock table public.employees in share mode;
  lock table public.shift_assignments in share row exclusive mode;
  select * into r from public.shift_rotations where id=p_id for update;
  if r.id is null then raise exception 'Rotacion no encontrada'; end if;
  if coalesce(auth.role(),'')<>'service_role' and not coalesce(public.is_admin_like() and public.can_read_contract_data(r.contrato_codigo),false) then raise exception 'Sin permiso'; end if;
  if r.estado<>'activo' and not p_activate then return 0; end if;
  -- With rotating rests or relievers, shifts this rotation assigned that the plan no longer expects (a day that is now rest,
  -- or a relief no longer needed) are released while not started and without attendance.
  if coalesce(r.config->'rules'->>'restMode','fijo')='rotativo'
     or exists(select 1 from jsonb_array_elements(r.config->'members') m where coalesce((m->>'reliever')::boolean,false)) then
    select coalesce(jsonb_agg(jsonb_build_object('e',p.employee_id,'d',p.fecha,'t',p.template_id)),'[]'::jsonb) into v_expected
    from public.preview_shift_rotation(r.contrato_codigo,r.config,(now() at time zone 'America/Bogota')::date+1,(now() at time zone 'America/Bogota')::date+30) p;
    delete from public.employee_shift_status es using public.shift_assignments a, public.scheduled_shifts sh
      where a.rotation_id=r.id and sh.id=a.scheduled_shift_id and es.scheduled_shift_id=sh.id and es.employee_id=a.employee_id
        and sh.starts_at>now() and es.estado_turno='programado' and coalesce(es.asistio,false)=false
        and sh.fecha_operativa between ((now() at time zone 'America/Bogota')::date+1)::text and ((now() at time zone 'America/Bogota')::date+30)::text
        and not exists(select 1 from jsonb_to_recordset(v_expected) as ex(e uuid,d date,t uuid) where ex.e=a.employee_id and ex.d::text=sh.fecha_operativa and ex.t is not distinct from sh.template_id);
    delete from public.shift_assignments a using public.scheduled_shifts sh
      where a.rotation_id=r.id and sh.id=a.scheduled_shift_id and sh.starts_at>now()
        and sh.fecha_operativa between ((now() at time zone 'America/Bogota')::date+1)::text and ((now() at time zone 'America/Bogota')::date+30)::text
        and not exists(select 1 from public.employee_shift_status es where es.scheduled_shift_id=sh.id and es.employee_id=a.employee_id and (coalesce(es.asistio,false) or es.estado_turno<>'programado'))
        and not exists(select 1 from jsonb_to_recordset(v_expected) as ex(e uuid,d date,t uuid) where ex.e=a.employee_id and ex.d::text=sh.fecha_operativa and ex.t is not distinct from sh.template_id);
  end if;
  for x in select * from public.preview_shift_rotation(r.contrato_codigo,r.config,
    (now() at time zone 'America/Bogota')::date+1,(now() at time zone 'America/Bogota')::date+30) loop
    if x.result not in ('Por asignar','Por asignar (sobrante)') then continue; end if;
    select * into s from public.scheduled_shifts where id=x.shift_id for update;
    select * into e from public.employees where id=x.employee_id;
    if s.starts_at<=now() or s.estado<>'programado' then continue; end if;
    -- Recheck capacity and overlaps after each insert; never overwrite a manual row.
    if exists(select 1 from public.shift_assignments a join public.scheduled_shifts sh on sh.id=a.scheduled_shift_id
      where a.employee_id=e.id and a.estado<>'cancelado' and sh.estado<>'cancelado'
      and sh.starts_at<s.ends_at and sh.ends_at>s.starts_at) then continue; end if;
    if x.result='Por asignar' and (select count(*) from public.shift_assignments a where a.scheduled_shift_id=s.id and a.estado<>'cancelado')>=s.operarios_planeados then continue; end if;
    insert into public.shift_assignments(scheduled_shift_id,employee_id,documento,nombre,cargo_codigo,cargo_nombre,sede_codigo,
      contrato_codigo,contrato_nombre,cliente_nombre_snapshot,cliente_nit_snapshot,rotation_id)
    values(s.id,e.id,e.documento,e.nombre,e.cargo_codigo,e.cargo_nombre,s.sede_codigo,
      s.contrato_codigo,s.contrato_nombre,s.cliente_nombre_snapshot,s.cliente_nit_snapshot,r.id) on conflict do nothing;
    get diagnostics v_count = row_count;
    if v_count=0 then continue; end if;
    n:=n+1;
    insert into public.employee_shift_status(id,scheduled_shift_id,fecha_operativa,employee_id,documento,nombre,sede_codigo,
      contrato_codigo,contrato_nombre,cliente_nombre_snapshot,cliente_nit_snapshot,estado_turno,asistio)
    values(s.id::text||'_'||e.id::text,s.id,s.fecha_operativa,e.id,e.documento,e.nombre,s.sede_codigo,
      s.contrato_codigo,s.contrato_nombre,s.cliente_nombre_snapshot,s.cliente_nit_snapshot,'programado',false) on conflict do nothing;
  end loop;
  if p_activate then update public.shift_rotations set estado='activo' where id=r.id; end if;
  perform public.record_rotation_overtime(r.id,(now() at time zone 'America/Bogota')::date,(now() at time zone 'America/Bogota')::date+30);
  return n;
end $$;

-- ---------------------------------------------------------------- Swap rest days between two employees of the site
-- Both employees keep exactly one rest day in that week; only the dates are exchanged. Assignments the rotation
-- created on the day an employee stops working are removed (future and not started); the other days are filled by
-- the normal application of the rotation. Manual assignments are never touched.
create or replace function public.swap_shift_rotation_rest_days(p_id uuid, p_employee_a uuid, p_date_a date, p_employee_b uuid, p_date_b date)
returns integer language plpgsql security definer set search_path=public as $$
declare
  r public.shift_rotations; v_today date := (now() at time zone 'America/Bogota')::date;
  v_week date; v_kind_a text; v_kind_b text; v_plan jsonb; v_config jsonb; v_removed integer := 0; v_added integer := 0; x record;
begin
  select * into r from public.shift_rotations where id=p_id for update;
  if r.id is null then raise exception 'Rotacion no encontrada'; end if;
  if coalesce(auth.role(),'')<>'service_role' and not coalesce(public.is_admin_like() and public.can_read_contract_data(r.contrato_codigo),false) then
    raise exception 'Sin permiso';
  end if;
  if coalesce(r.config->'rules'->>'restMode','fijo') <> 'rotativo' then
    raise exception 'Activa los descansos rotativos para intercambiar descansos';
  end if;
  if p_employee_a is null or p_employee_b is null or p_employee_a = p_employee_b then raise exception 'Selecciona dos empleados distintos'; end if;
  if p_date_a is null or p_date_b is null or p_date_a = p_date_b then raise exception 'Selecciona dos fechas distintas'; end if;
  if (select count(*) from public.employees e where e.id in (p_employee_a,p_employee_b)
        and e.sede_codigo=r.config->>'site' and e.contrato_codigo=r.contrato_codigo and e.estado='activo') <> 2
     or (select count(*) from jsonb_array_elements(r.config->'members') m where (m->>'employee')::uuid in (p_employee_a,p_employee_b)) <> 2 then
    raise exception 'Los empleados deben ser de la misma sede y estar en la rotacion';
  end if;
  if p_date_a <= v_today or p_date_b <= v_today then raise exception 'Solo se pueden intercambiar descansos futuros'; end if;
  v_week := public.rotation_week_start(p_date_a);
  if public.rotation_week_start(p_date_b) <> v_week then raise exception 'Los descansos deben ser de la misma semana'; end if;
  select d.kind into v_kind_a from public.shift_rotation_rest_days(r.config,v_week,v_week+6) d where d.employee_id=p_employee_a and d.rest_date=p_date_a;
  select d.kind into v_kind_b from public.shift_rotation_rest_days(r.config,v_week,v_week+6) d where d.employee_id=p_employee_b and d.rest_date=p_date_b;
  if v_kind_a is null or v_kind_b is null then
    raise exception 'La fecha no es un descanso programado del empleado; los descansos del ciclo no se intercambian';
  end if;
  -- Each employee must be working the day it receives as rest (not already resting by slot or by the cycle).
  if exists(select 1 from public.preview_shift_rotation(r.contrato_codigo,r.config,least(p_date_a,p_date_b),greatest(p_date_a,p_date_b)) p
      where ((p.employee_id=p_employee_a and p.fecha=p_date_b) or (p.employee_id=p_employee_b and p.fecha=p_date_a)) and p.template_id is null) then
    raise exception 'Un empleado ya descansa ese dia';
  end if;
  v_plan := public.shift_rotation_rest_plan_set(r.config->'rules'->'restPlan',p_employee_a::text,v_week,v_kind_a,p_date_b);
  v_plan := public.shift_rotation_rest_plan_set(v_plan,p_employee_b::text,v_week,v_kind_b,p_date_a);
  v_config := jsonb_set(r.config,'{rules,restPlan}',v_plan,true);
  -- The same validation used when saving.
  perform * from public.preview_shift_rotation(r.contrato_codigo,v_config,v_today+1,v_today+1);
  update public.shift_rotations set config=v_config, rules_updated_at=now(), rules_updated_by=auth.uid() where id=r.id;
  for x in select a.id aid, s.id sid, a.employee_id eid
    from public.shift_assignments a join public.scheduled_shifts s on s.id=a.scheduled_shift_id
    where a.rotation_id=p_id and s.starts_at>now()
      and ((a.employee_id=p_employee_a and s.fecha_operativa=p_date_b::text) or (a.employee_id=p_employee_b and s.fecha_operativa=p_date_a::text)) loop
    delete from public.employee_shift_status where scheduled_shift_id=x.sid and employee_id=x.eid and estado_turno='programado' and coalesce(asistio,false)=false;
    delete from public.shift_assignments where id=x.aid;
    v_removed := v_removed + 1;
  end loop;
  if r.estado='activo' then v_added := public.apply_shift_rotation(p_id,false); end if;
  return v_removed + v_added;
end $$;
revoke all on function public.swap_shift_rotation_rest_days(uuid,uuid,date,uuid,date) from public,anon;
grant execute on function public.swap_shift_rotation_rest_days(uuid,uuid,date,uuid,date) to authenticated,service_role;

-- ---------------------------------------------------------------- Move one employee's rest day inside its week
-- The employee keeps exactly one rest day of that kind in the week; only the date changes (Monday to Saturday, a day
-- currently worked). Rotation assignments on the new rest day are removed (future and not started); the day that stops
-- being rest is filled by the normal application of the rotation. Manual assignments are never touched.
create or replace function public.move_shift_rotation_rest_day(p_id uuid, p_employee uuid, p_from date, p_to date)
returns integer language plpgsql security definer set search_path=public as $$
declare
  r public.shift_rotations; v_today date := (now() at time zone 'America/Bogota')::date;
  v_week date; v_kind text; v_plan jsonb; v_config jsonb; v_removed integer := 0; v_added integer := 0; x record;
begin
  select * into r from public.shift_rotations where id=p_id for update;
  if r.id is null then raise exception 'Rotacion no encontrada'; end if;
  if coalesce(auth.role(),'')<>'service_role' and not coalesce(public.is_admin_like() and public.can_read_contract_data(r.contrato_codigo),false) then
    raise exception 'Sin permiso';
  end if;
  if coalesce(r.config->'rules'->>'restMode','fijo') <> 'rotativo' then
    raise exception 'Activa los descansos rotativos para mover descansos';
  end if;
  if p_employee is null or p_from is null or p_to is null or p_from = p_to then raise exception 'Selecciona un dia distinto'; end if;
  if not exists(select 1 from public.employees e where e.id=p_employee and e.sede_codigo=r.config->>'site'
        and e.contrato_codigo=r.contrato_codigo and e.estado='activo')
     or not exists(select 1 from jsonb_array_elements(r.config->'members') m where (m->>'employee')::uuid=p_employee) then
    raise exception 'El empleado debe ser de la sede y estar en la rotacion';
  end if;
  if p_from <= v_today or p_to <= v_today then raise exception 'Solo se pueden mover descansos futuros'; end if;
  v_week := public.rotation_week_start(p_from);
  if public.rotation_week_start(p_to) <> v_week then raise exception 'El descanso debe quedar en la misma semana'; end if;
  if extract(dow from p_to) = 0 then raise exception 'El descanso se programa de lunes a sabado'; end if;
  select d.kind into v_kind from public.shift_rotation_rest_days(r.config,v_week,v_week+6) d where d.employee_id=p_employee and d.rest_date=p_from;
  if v_kind is null then
    raise exception 'La fecha no es un descanso programado del empleado; los descansos del ciclo no se mueven';
  end if;
  if exists(select 1 from public.preview_shift_rotation(r.contrato_codigo,r.config,p_to,p_to) p
      where p.employee_id=p_employee and p.fecha=p_to and p.template_id is null) then
    raise exception 'El empleado ya descansa ese dia';
  end if;
  v_plan := public.shift_rotation_rest_plan_set(r.config->'rules'->'restPlan',p_employee::text,v_week,v_kind,p_to);
  v_config := jsonb_set(r.config,'{rules,restPlan}',v_plan,true);
  perform * from public.preview_shift_rotation(r.contrato_codigo,v_config,v_today+1,v_today+1);
  update public.shift_rotations set config=v_config, rules_updated_at=now(), rules_updated_by=auth.uid() where id=r.id;
  for x in select a.id aid, s.id sid
    from public.shift_assignments a join public.scheduled_shifts s on s.id=a.scheduled_shift_id
    where a.rotation_id=p_id and a.employee_id=p_employee and s.starts_at>now() and s.fecha_operativa=p_to::text loop
    delete from public.employee_shift_status where scheduled_shift_id=x.sid and employee_id=p_employee and estado_turno='programado' and coalesce(asistio,false)=false;
    delete from public.shift_assignments where id=x.aid;
    v_removed := v_removed + 1;
  end loop;
  if r.estado='activo' then v_added := public.apply_shift_rotation(p_id,false); end if;
  return v_removed + v_added;
end $$;
revoke all on function public.move_shift_rotation_rest_day(uuid,uuid,date,date) from public,anon;
grant execute on function public.move_shift_rotation_rest_day(uuid,uuid,date,date) to authenticated,service_role;

-- ---------------------------------------------------------------- Replace the manual schedule with the rotation
-- Manual assignments (no rotation) of the rotation members, in the rotation's site and contract, inside the next
-- 30 days and the rotation's validity, that have not started and have no attendance. p_dry_run only counts them.
-- The application of the rotation itself never touches manual assignments; this is an explicit administrator action.
create or replace function public.replace_manual_shift_assignments(p_id uuid, p_dry_run boolean default true)
returns integer language plpgsql security definer set search_path=public as $$
declare
  r public.shift_rotations; v_from date := (now() at time zone 'America/Bogota')::date + 1; v_to date := (now() at time zone 'America/Bogota')::date + 30;
  v_start date; v_end date; n integer := 0; x record;
begin
  select * into r from public.shift_rotations where id=p_id for update;
  if r.id is null then raise exception 'Rotacion no encontrada'; end if;
  if coalesce(auth.role(),'')<>'service_role' and not coalesce(public.is_admin_like() and public.can_read_contract_data(r.contrato_codigo),false) then
    raise exception 'Sin permiso';
  end if;
  v_start := (r.config->>'start')::date;
  v_end := nullif(r.config->>'end','')::date;
  v_from := greatest(v_from, v_start);
  v_to := least(v_to, coalesce(v_end, v_to));
  for x in select a.id aid, s.id sid, a.employee_id eid
    from public.shift_assignments a join public.scheduled_shifts s on s.id=a.scheduled_shift_id
    where a.rotation_id is null and a.estado not in ('cancelado','reemplazado') and s.estado<>'cancelado'
      and a.employee_id in (select (m->>'employee')::uuid from jsonb_array_elements(r.config->'members') m)
      and s.sede_codigo=r.config->>'site' and s.contrato_codigo=r.contrato_codigo
      and s.starts_at>now() and s.fecha_operativa between v_from::text and v_to::text
      and not exists(select 1 from public.employee_shift_status es where es.scheduled_shift_id=s.id and es.employee_id=a.employee_id
        and (coalesce(es.asistio,false) or es.estado_turno<>'programado'))
  loop
    n := n + 1;
    if not p_dry_run then
      delete from public.employee_shift_status where scheduled_shift_id=x.sid and employee_id=x.eid and estado_turno='programado' and coalesce(asistio,false)=false;
      delete from public.shift_assignments where id=x.aid;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.replace_manual_shift_assignments(uuid,boolean) from public,anon;
grant execute on function public.replace_manual_shift_assignments(uuid,boolean) to authenticated,service_role;

-- ---------------------------------------------------------------- Relievers (relevos)
-- Members flagged "reliever": true have no fixed cycle. They cover, day by day, the plan of the regular members who are
-- resting (compensatory rest) or unavailable. Rules:
--   * weeks run Sunday to Saturday; a reliever works at most 6 days a week and Sunday is its natural rest;
--   * a reliever that works Sunday must rest one day of that same week, from Monday to Saturday (at most 5 weekdays);
--   * a reliever with a pending rest works at most 5 days until the pending rest is paid back;
--   * when covering does not reach its 6 days (5 with a pending rest) the reliever completes the week as surplus
--     ("sobrante"): assigned above the planned quota to the plan it covered most, on days that plan operates and with no
--     gap to cover. The administrator can move a surplus day to any free day of the week (rules.surplusPlan);
--   * if gaps remain and there is no other reliever, a reliever may cover a 7th day: that week has no rest, the rest
--     becomes pending (paid in a later week) and the hours over the weekly limit are recorded as overtime.
-- Deterministic: recalculated from the configuration, nothing is stored. Result:
--   { assignments: [{employee,date,template,covers,extra,surplus}], weeks: [{employee,week_start,days_worked,extra_days,surplus_days,pending_rest}] }
create or replace function public.shift_rotation_relief_plan(p_config jsonb, p_from date, p_to date)
returns jsonb language plpgsql set search_path=public as $$
#variable_conflict use_column
declare
  v_start date := (p_config->>'start')::date;
  v_end date := nullif(p_config->>'end','')::date;
  v_days integer := (p_config->>'days')::integer;
  v_cycle jsonb := p_config->'cycle';
  v_len integer := jsonb_array_length(p_config->'cycle');
  v_unavailable jsonb := coalesce(p_config->'unavailable','[]'::jsonb);
  v_splan jsonb := coalesce(p_config->'rules'->'surplusPlan','{}'::jsonb);
  v_last date := least(p_to, coalesce(nullif(p_config->>'end','')::date, p_to));
  v_all constant jsonb := '[0,1,2,3,4,5,6]'::jsonb;
  v_ops jsonb;
  v_rel text[];
  v_pending jsonb := '{}'::jsonb;
  v_assign jsonb := '[]'::jsonb;
  v_weeks jsonb := '[]'::jsonb;
  v_week date; v_pass integer; g record; r text; v_pick text; v_pick_count integer; v_count integer; v_cap integer; v_ms integer;
  v_worked jsonb; v_extra jsonb; v_covered jsonb; v_pend integer; v_n integer; v_owes boolean;
  v_wk jsonb; v_gapdays date[]; v_gaptpl jsonb; v_plan text; v_target integer; v_sur integer; v_d date; v_first_plan text; v_explicit jsonb;
begin
  select coalesce(array_agg(m->>'employee' order by coalesce((m->>'offset')::integer,0), m->>'employee'), '{}'::text[]) into v_rel
  from jsonb_array_elements(p_config->'members') m where coalesce((m->>'reliever')::boolean,false);
  if cardinality(v_rel) = 0 or v_start is null or v_last < greatest(p_from, v_start) then
    return jsonb_build_object('assignments','[]'::jsonb,'weeks','[]'::jsonb);
  end if;
  select coalesce(jsonb_object_agg(t, to_jsonb(public.shift_template_operating_days(t::uuid))), '{}'::jsonb) into v_ops
  from (select distinct value t from jsonb_array_elements_text(v_cycle) value where value is not null) x;
  foreach r in array v_rel loop
    v_pending := v_pending || jsonb_build_object(r, 0);
  end loop;
  for v_week in select w::date from generate_series(public.rotation_week_start(v_start)::timestamp, public.rotation_week_start(v_last)::timestamp, interval '7 days') w loop
    v_worked := '{}'::jsonb; v_extra := '{}'::jsonb; v_covered := '{}'::jsonb; v_wk := '[]'::jsonb; v_gapdays := '{}'; v_gaptpl := '{}'::jsonb;
    foreach r in array v_rel loop v_worked := v_worked || jsonb_build_object(r,'[]'::jsonb); v_extra := v_extra || jsonb_build_object(r,0); end loop;
    for v_pass in 1..2 loop
      for g in
        with rd as (select employee_id, rest_date from public.shift_rotation_rest_days(p_config, v_week, v_week+6)),
        raw as (
          select d::date dt, m->>'employee' covers, m,
            v_cycle->>((((d::date - public.rotation_cycle_origin(v_start,v_days)) / v_days) + coalesce((m->>'offset')::integer,0)) % v_len) tpl
          from generate_series(v_week::timestamp, (v_week+6)::timestamp, interval '1 day') d
          cross join jsonb_array_elements(p_config->'members') m
          where not coalesce((m->>'reliever')::boolean,false) and d::date >= v_start and (v_end is null or d::date <= v_end)
        )
        select dt, covers, tpl from raw
        where tpl is not null
          and coalesce(v_ops->tpl, v_all) @> to_jsonb(extract(dow from dt)::integer)
          and (exists(select 1 from rd where rd.employee_id=covers::uuid and rd.rest_date=dt)
            or exists(select 1 from jsonb_array_elements(v_unavailable) u where u->>'employee'=covers
                 and dt between (u->>'from')::date and (u->>'to')::date))
        order by 1, 3, 2
      loop
        if v_pass = 1 then
          v_gapdays := v_gapdays || g.dt;
          v_gaptpl := jsonb_set(v_gaptpl, array[g.tpl], to_jsonb(coalesce((v_gaptpl->>g.tpl)::integer,0)+1), true);
        end if;
        continue when v_covered ? (g.dt::text || '|' || g.covers);
        v_pick := null; v_pick_count := null;
        foreach r in array v_rel loop
          v_count := jsonb_array_length(v_worked->r);
          v_pend := coalesce((v_pending->>r)::integer,0);
          v_ms := v_count - case when (v_worked->r) ? v_week::text then 1 else 0 end;
          v_cap := case when v_pass = 1 then 6 - case when v_pend > 0 then 1 else 0 end else 7 end;
          if v_count >= v_cap then continue; end if;
          -- Working Sunday, one weekday of the same week must stay free (compensatory rest).
          if v_pass = 1 and (v_worked->r) ? v_week::text and extract(dow from g.dt) <> 0 and v_ms >= 5 then continue; end if;
          if (v_worked->r) ? g.dt::text then continue; end if;
          if exists(select 1 from jsonb_array_elements(v_unavailable) u where u->>'employee'=r and g.dt between (u->>'from')::date and (u->>'to')::date) then continue; end if;
          if v_pick is null or v_count < v_pick_count then v_pick := r; v_pick_count := v_count; end if;
        end loop;
        continue when v_pick is null;
        v_worked := jsonb_set(v_worked, array[v_pick], (v_worked->v_pick) || to_jsonb(g.dt::text));
        v_covered := v_covered || jsonb_build_object(g.dt::text || '|' || g.covers, true);
        if v_pass = 2 then v_extra := jsonb_set(v_extra, array[v_pick], to_jsonb(coalesce((v_extra->>v_pick)::integer,0)+1)); end if;
        v_wk := v_wk || jsonb_build_object('employee',v_pick,'date',g.dt,'template',g.tpl,'covers',g.covers,'extra',v_pass=2,'surplus',false);
      end loop;
    end loop;
    -- Surplus: complete the week up to 6 days (5 with a pending rest) above the quota, on days the plan operates and with
    -- nothing to cover. Sunday is filled last: it is the natural rest. An explicit list (moved by the administrator) wins.
    v_first_plan := (select c from jsonb_array_elements_text(v_cycle) c where c is not null limit 1);
    foreach r in array v_rel loop
      v_target := 6 - case when coalesce((v_pending->>r)::integer,0) > 0 then 1 else 0 end;
      v_n := jsonb_array_length(v_worked->r);
      continue when v_n >= v_target;
      v_plan := coalesce(
        (select w->>'template' from jsonb_array_elements(v_wk) w where w->>'employee'=r group by w->>'template' order by count(*) desc, min(w->>'date') limit 1),
        (select k from jsonb_each_text(v_gaptpl) t(k,v) order by v::integer desc, k limit 1),
        v_first_plan);
      continue when v_plan is null;
      v_sur := v_target - v_n;
      v_ms := v_n - case when (v_worked->r) ? v_week::text then 1 else 0 end;
      v_explicit := v_splan->r->(v_week::text);
      for v_d in
        select d::date from generate_series(greatest(v_week,v_start)::timestamp, least(v_week+6, coalesce(v_end,v_week+6))::timestamp, interval '1 day') d
        where not ((v_worked->r) ? d::date::text)
          and coalesce(v_ops->v_plan, v_all) @> to_jsonb(extract(dow from d)::integer)
          and not exists(select 1 from jsonb_array_elements(v_unavailable) u where u->>'employee'=r and d::date between (u->>'from')::date and (u->>'to')::date)
          and (v_explicit is null or jsonb_typeof(v_explicit) <> 'array' or v_explicit ? d::date::text)
        order by (d::date = any(v_gapdays)) desc, (extract(dow from d) = 0), d::date
      loop
        exit when v_sur <= 0;
        if (v_worked->r) ? v_week::text and extract(dow from v_d) <> 0 and v_ms >= 5 then continue; end if;
        v_worked := jsonb_set(v_worked, array[r], (v_worked->r) || to_jsonb(v_d::text));
        v_wk := v_wk || jsonb_build_object('employee',r,'date',v_d,'template',v_plan,'covers',null,'extra',false,'surplus',true);
        v_sur := v_sur - 1;
        if extract(dow from v_d) <> 0 then v_ms := v_ms + 1; end if;
      end loop;
    end loop;
    v_assign := v_assign || coalesce((select jsonb_agg(w) from jsonb_array_elements(v_wk) w where (w->>'date')::date between p_from and p_to),'[]'::jsonb);
    -- Weekly balance: a seventh worked day loses the weekly rest (pending); two rest days pay one back.
    foreach r in array v_rel loop
      v_n := jsonb_array_length(v_worked->r);
      v_pend := coalesce((v_pending->>r)::integer,0);
      if v_n >= 7 then v_pend := v_pend + 1;
      elsif v_n <= 5 and v_pend > 0 then v_pend := v_pend - 1;
      end if;
      v_pending := jsonb_set(v_pending, array[r], to_jsonb(v_pend));
      if v_week + 6 >= p_from and v_week <= p_to then
        v_weeks := v_weeks || jsonb_build_object('employee',r,'week_start',v_week,'days_worked',v_n,
          'extra_days',coalesce((v_extra->>r)::integer,0),
          'surplus_days',(select count(*) from jsonb_array_elements(v_wk) w where w->>'employee'=r and (w->>'surplus')::boolean),'pending_rest',v_pend);
      end if;
    end loop;
  end loop;
  return jsonb_build_object('assignments',v_assign,'weeks',v_weeks);
end
$$;
revoke all on function public.shift_rotation_relief_plan(jsonb,date,date) from public,anon;
grant execute on function public.shift_rotation_relief_plan(jsonb,date,date) to authenticated,service_role;

drop function if exists public.shift_rotation_relief(jsonb,date,date);
create or replace function public.shift_rotation_relief(p_config jsonb, p_from date, p_to date)
returns table(employee_id uuid, work_date date, template_id uuid, covers uuid, extra boolean, surplus boolean)
language sql set search_path=public as $$
  select x.employee, x.date, x.template::uuid, x.covers, x.extra, x.surplus
  from jsonb_to_recordset(public.shift_rotation_relief_plan(p_config,p_from,p_to)->'assignments')
    as x(employee uuid, date date, template text, covers uuid, extra boolean, surplus boolean)
$$;
revoke all on function public.shift_rotation_relief(jsonb,date,date) from public,anon;
grant execute on function public.shift_rotation_relief(jsonb,date,date) to authenticated,service_role;

drop function if exists public.shift_rotation_relief_weeks(jsonb,date,date);
create or replace function public.shift_rotation_relief_weeks(p_config jsonb, p_from date, p_to date)
returns table(employee_id uuid, week_start date, days_worked integer, extra_days integer, surplus_days integer, pending_rest integer)
language sql set search_path=public as $$
  select x.employee, x.week_start, x.days_worked, x.extra_days, x.surplus_days, x.pending_rest
  from jsonb_to_recordset(public.shift_rotation_relief_plan(p_config,p_from,p_to)->'weeks')
    as x(employee uuid, week_start date, days_worked integer, extra_days integer, surplus_days integer, pending_rest integer)
$$;
revoke all on function public.shift_rotation_relief_weeks(jsonb,date,date) from public,anon;
grant execute on function public.shift_rotation_relief_weeks(jsonb,date,date) to authenticated,service_role;

-- ---------------------------------------------------------------- Move a reliever's surplus day inside its week
-- The surplus day goes to any free day of the same week (Monday to Sunday) on which the plan operates. The rule that a
-- Sunday worked owes a weekday rest the following week keeps applying (the planner recalculates it).
create or replace function public.move_shift_rotation_surplus(p_id uuid, p_employee uuid, p_from date, p_to date)
returns integer language plpgsql security definer set search_path=public as $$
declare
  r public.shift_rotations; v_today date := (now() at time zone 'America/Bogota')::date;
  v_week date; v_dates jsonb; v_plan jsonb; v_config jsonb; v_removed integer := 0; v_added integer := 0; x record;
begin
  select * into r from public.shift_rotations where id=p_id for update;
  if r.id is null then raise exception 'Rotacion no encontrada'; end if;
  if coalesce(auth.role(),'')<>'service_role' and not coalesce(public.is_admin_like() and public.can_read_contract_data(r.contrato_codigo),false) then
    raise exception 'Sin permiso';
  end if;
  if p_employee is null or p_from is null or p_to is null or p_from = p_to then raise exception 'Selecciona un dia distinto'; end if;
  if not exists(select 1 from jsonb_array_elements(r.config->'members') m where (m->>'employee')::uuid=p_employee and coalesce((m->>'reliever')::boolean,false)) then
    raise exception 'El empleado debe ser un relevo de la rotacion';
  end if;
  if p_from <= v_today or p_to <= v_today then raise exception 'Solo se pueden mover sobrantes futuros'; end if;
  v_week := public.rotation_week_start(p_from);
  if public.rotation_week_start(p_to) <> v_week then raise exception 'El sobrante debe quedar en la misma semana'; end if;
  select coalesce(jsonb_agg(d.work_date order by d.work_date), '[]'::jsonb) into v_dates
  from public.shift_rotation_relief(r.config,v_week,v_week+6) d where d.employee_id=p_employee and d.surplus;
  if not (v_dates ? p_from::text) then raise exception 'La fecha no es un sobrante del relevo'; end if;
  select coalesce(jsonb_agg(y.dv order by y.dv), '[]'::jsonb) into v_dates
  from (select value as dv from jsonb_array_elements_text(v_dates) value where value <> p_from::text union select p_to::text) y;
  v_plan := coalesce(r.config->'rules'->'surplusPlan','{}'::jsonb);
  v_plan := jsonb_set(v_plan, array[p_employee::text], coalesce(v_plan->p_employee::text,'{}'::jsonb), true);
  v_plan := jsonb_set(v_plan, array[p_employee::text, v_week::text], v_dates, true);
  v_config := jsonb_set(r.config,'{rules,surplusPlan}',v_plan,true);
  -- The destination must become a surplus day of the reliever (free and on a day the plan operates).
  if not exists(select 1 from public.shift_rotation_relief(v_config,v_week,v_week+6) d where d.employee_id=p_employee and d.work_date=p_to and d.surplus) then
    raise exception 'No se puede mover el sobrante a ese dia: esta ocupado, no disponible o el plan no opera ese dia';
  end if;
  perform * from public.preview_shift_rotation(r.contrato_codigo,v_config,v_today+1,v_today+1);
  update public.shift_rotations set config=v_config, rules_updated_at=now(), rules_updated_by=auth.uid() where id=r.id;
  for x in select a.id aid, s.id sid
    from public.shift_assignments a join public.scheduled_shifts s on s.id=a.scheduled_shift_id
    where a.rotation_id=p_id and a.employee_id=p_employee and s.starts_at>now() and s.fecha_operativa=p_from::text loop
    delete from public.employee_shift_status where scheduled_shift_id=x.sid and employee_id=p_employee and estado_turno='programado' and coalesce(asistio,false)=false;
    delete from public.shift_assignments where id=x.aid;
    v_removed := v_removed + 1;
  end loop;
  if r.estado='activo' then v_added := public.apply_shift_rotation(p_id,false); end if;
  return v_removed + v_added;
end $$;
revoke all on function public.move_shift_rotation_surplus(uuid,uuid,date,date) from public,anon;
grant execute on function public.move_shift_rotation_surplus(uuid,uuid,date,date) to authenticated,service_role;

create or replace function public.shift_rotation_rules_version()
returns integer language sql stable as $$select 69$$;
revoke all on function public.shift_rotation_rules_version() from public,anon;
grant execute on function public.shift_rotation_rules_version() to authenticated,service_role;
commit;

-- >>>>>>>>>> schema_operations_phase67_shift_status_payroll_sync.sql
-- Phase 67: close three gaps found while reviewing shift rotation against payroll rules.
--   1. employee_shift_status never received the coverage/payroll decision that
--      refresh_employee_daily_status_base already computes correctly per employee/day.
--      "Servicio" (was the shift covered, by whoever) and "nomina" (is THIS employee paid
--      this day, per their own novelty) are kept as two separate signals, exactly as they
--      already are in employee_daily_status: a replaced titular can have servicio = true
--      (the shift was covered, so the client can be billed) and paga_nomina = false/true
--      independently, based on their own novelty classification (public.novedades.nomina).
--   2. shift_overtime_weeks was only ever recomputed from apply_shift_rotation. A manual
--      assignment (no rotation involved) never produced an overtime row even when it pushed
--      an employee over the legal weekly limit.
--   3. preview_shift_rotation is the one entry point that receives a raw, not-yet-saved
--      config straight from the UI; a malformed value crashed with a raw Postgres cast
--      error instead of the same kind of business message the rest of the function uses.
-- Apply after phase 66. Existing data is never rewritten by this migration; the new sync
-- and overtime functions populate rows going forward (and can be re-run per date/employee).
begin;

-- ---------------------------------------------------------------- 1. Servicio vs nomina
alter table public.employee_shift_status
  add column if not exists servicio_cubierto boolean not null default false,
  add column if not exists cuenta_pago_servicio boolean not null default false,
  add column if not exists cuenta_nomina boolean not null default true,
  add column if not exists paga_nomina boolean,
  add column if not exists motivo_nomina text;

-- Propagates the coverage/payroll decision that refresh_employee_daily_status_base already
-- computed for a given date onto the matching employee_shift_status rows of that same date.
-- Matched strictly per employee (employee_id, falling back to documento) so a titular's row
-- is never mixed with the replacement's row: each keeps its own servicio/nomina decision.
-- Fields already carrying real information from the shift itself (a marking, a novedad
-- linked directly to the turno) are never overwritten, only completed.
create or replace function public.sync_shift_status_coverage_from_daily(p_fecha text)
returns integer language plpgsql security definer set search_path = public as $$
declare v_rows integer := 0;
begin
  if p_fecha is null or p_fecha !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Fecha invalida'; end if;
  update public.employee_shift_status es
  set
    servicio_cubierto = ds.servicio_cubierto,
    cuenta_pago_servicio = ds.cuenta_pago_servicio,
    cuenta_nomina = ds.cuenta_nomina,
    paga_nomina = ds.paga_nomina,
    motivo_nomina = ds.motivo_nomina,
    decision_cobertura = case when es.decision_cobertura = 'no_aplica' and ds.decision_cobertura <> 'no_aplica'
      then ds.decision_cobertura else es.decision_cobertura end,
    reemplazado_por_employee_id = case when es.decision_cobertura = 'no_aplica' and ds.decision_cobertura <> 'no_aplica'
      then nullif(ds.reemplazado_por_employee_id,'')::uuid else es.reemplazado_por_employee_id end,
    reemplazado_por_documento = case when es.decision_cobertura = 'no_aplica' and ds.decision_cobertura <> 'no_aplica'
      then ds.reemplazado_por_documento else es.reemplazado_por_documento end,
    reemplazado_por_nombre = case when es.decision_cobertura = 'no_aplica' and ds.decision_cobertura <> 'no_aplica'
      then ds.reemplazado_por_nombre else es.reemplazado_por_nombre end,
    asistio = case when ds.asistio = true and es.asistio = false and es.entrada_at is null then true else es.asistio end,
    novedad_codigo = case when es.novedad_codigo is null and es.novedad_nombre is null then ds.novedad_codigo else es.novedad_codigo end,
    novedad_nombre = case when es.novedad_codigo is null and es.novedad_nombre is null then ds.novedad_nombre else es.novedad_nombre end,
    source_incapacity_id = case when es.novedad_codigo is null and es.novedad_nombre is null and es.source_incapacity_id is null
      and ds.source_incapacity_id ~ '^[0-9a-fA-F-]{36}$' then ds.source_incapacity_id::uuid else es.source_incapacity_id end,
    updated_at = now()
  from public.employee_daily_status ds
  where ds.fecha = p_fecha
    and es.fecha_operativa = p_fecha
    and (
      (es.employee_id is not null and ds.employee_id = es.employee_id::text)
      or (es.employee_id is null and es.documento is not null and ds.documento = es.documento)
    );
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;
revoke all on function public.sync_shift_status_coverage_from_daily(text) from public, anon;
grant execute on function public.sync_shift_status_coverage_from_daily(text) to authenticated, service_role;

-- Run right after the daily pipeline recomputes employee_daily_status, so every normal day
-- close (and every manual re-run) keeps employee_shift_status caught up automatically.
create or replace function public.refresh_operational_snapshots_from_employee_daily_status(p_fecha text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_rows integer := 0;
  v_sedes integer := 0;
  v_contracts integer := 0;
  v_sede_closures integer := 0;
  v_shift_status_rows integer := 0;
  v_metrics public.daily_metrics;
  v_validation jsonb;
begin
  v_employee_rows := public.refresh_employee_daily_status(p_fecha);
  v_sedes := public.recompute_sede_status_from_employee_daily_status(p_fecha);
  v_contracts := public.recompute_daily_contract_metrics_from_employee_daily_status(p_fecha);
  v_metrics := public.recompute_daily_metrics_from_employee_daily_status(p_fecha);
  v_sede_closures := public.recompute_daily_sede_closures_from_sede_status(p_fecha);
  v_shift_status_rows := public.sync_shift_status_coverage_from_daily(p_fecha);
  v_validation := public.validate_daily_contract_metric_consistency(p_fecha);

  if coalesce((v_validation ->> 'ok')::boolean, false) = false then
    raise exception 'Inconsistencia en metricas operativas por contrato para %: %', p_fecha, v_validation;
  end if;

  return jsonb_build_object(
    'fecha', p_fecha,
    'employee_daily_status_rows', v_employee_rows,
    'sede_status_rows', v_sedes,
    'daily_contract_metrics_rows', v_contracts,
    'daily_metrics_id', v_metrics.id,
    'daily_sede_closures_rows', v_sede_closures,
    'employee_shift_status_synced_rows', v_shift_status_rows,
    'attendance_count', v_metrics.attendance_count,
    'expected', v_metrics.expected,
    'planned', v_metrics.planned,
    'validation', v_validation
  );
end;
$$;

-- Also sync the specific shift's date right when it closes, so review screens and any
-- payroll export do not have to wait for the next daily-closure cron run.
create or replace function public.finalize_shift_attendance(p_shift_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_rows jsonb; v_fecha text;
begin
  select fecha_operativa into v_fecha from public.scheduled_shifts where id = p_shift_id and estado <> 'cancelado' for update;
  if not found then raise exception 'attendance_shift_missing'; end if;
  update public.employee_shift_status set
    estado_turno = case
      when (asistio or entrada_at is not null) and salida_at is null
        and estado_turno not in ('ausente_con_novedad','cancelado') then 'salida_pendiente'
      when estado_turno = 'programado' then 'sin_registro' else estado_turno end,
    requires_review = requires_review or ((asistio or entrada_at is not null) and salida_at is null
      and estado_turno not in ('ausente_con_novedad','cancelado')),
    closed = true
  where scheduled_shift_id = p_shift_id;
  update public.scheduled_shifts set estado = 'cerrado', closed_at = coalesce(closed_at, clock_timestamp()) where id = p_shift_id;
  perform public.sync_shift_status_coverage_from_daily(v_fecha);
  select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) into v_rows
    from public.employee_shift_status s where scheduled_shift_id = p_shift_id;
  return v_rows;
end;
$$;
revoke all on function public.finalize_shift_attendance(uuid) from public, anon, authenticated;
grant execute on function public.finalize_shift_attendance(uuid) to service_role;

-- ---------------------------------------------------------------- 2. Overtime, manual too
-- Same weekly totals as record_rotation_overtime, but scoped to one employee and an explicit
-- list of weeks, with no dependency on a shift_rotations row: covers manual assignments too.
create or replace function public.recompute_employee_overtime_weeks(p_employee uuid, p_weeks date[])
returns integer language plpgsql security definer set search_path = public as $$
declare v_from date; v_to date; n integer := 0;
begin
  if p_employee is null or p_weeks is null or cardinality(p_weeks) = 0 then return 0; end if;
  select min(w), max(w) + 6 into v_from, v_to from unnest(p_weeks) w;
  with weeks as (
    select distinct public.rotation_week_start(w) wstart from unnest(p_weeks) w
  ), segments as (
    select a.contrato_codigo, a.sede_codigo, a.rotation_id,
      (s.starts_at at time zone 'America/Bogota')::date local_day,
      extract(epoch from (s.ends_at - s.starts_at)) / 60 * public.shift_net_ratio(s.starts_at,s.ends_at,s.almuerzo_minutos) mins
    from public.shift_assignments a
    join public.scheduled_shifts s on s.id = a.scheduled_shift_id
    where a.employee_id = p_employee
      and a.estado not in ('cancelado','reemplazado') and s.estado <> 'cancelado'
      and s.starts_at < ((v_to + 8)::timestamp at time zone 'America/Bogota')
      and s.ends_at > ((v_from - 8)::timestamp at time zone 'America/Bogota')
  ), totals as (
    select w.wstart,
      coalesce(round(sum(g.mins) filter (where g.local_day between w.wstart and w.wstart + 6)),0)::integer worked,
      (array_agg(g.contrato_codigo order by g.local_day desc) filter (where g.local_day between w.wstart and w.wstart + 6))[1] contrato_codigo,
      (array_agg(g.sede_codigo order by g.local_day desc) filter (where g.local_day between w.wstart and w.wstart + 6))[1] sede_codigo,
      (array_agg(g.rotation_id order by g.local_day desc) filter (where g.local_day between w.wstart and w.wstart + 6 and g.rotation_id is not null))[1] rotation_id
    from weeks w
    left join segments g on true
    group by w.wstart
  )
  insert into public.shift_overtime_weeks(employee_id,contrato_codigo,sede_codigo,rotation_id,week_start,worked_minutes,limit_minutes,overtime_minutes)
  select p_employee, coalesce(t.contrato_codigo, e.contrato_codigo), coalesce(t.sede_codigo, e.sede_codigo),
    t.rotation_id, t.wstart, t.worked, public.colombia_weekly_limit_minutes(t.wstart), greatest(0, t.worked - public.colombia_weekly_limit_minutes(t.wstart))
  from totals t
  join public.employees e on e.id = p_employee
  where coalesce(t.contrato_codigo, e.contrato_codigo) is not null
  on conflict (employee_id, week_start) do update set
    contrato_codigo=excluded.contrato_codigo, sede_codigo=excluded.sede_codigo, rotation_id=excluded.rotation_id,
    worked_minutes=excluded.worked_minutes, limit_minutes=excluded.limit_minutes,
    overtime_minutes=excluded.overtime_minutes, computed_at=now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.recompute_employee_overtime_weeks(uuid,date[]) from public,anon;
grant execute on function public.recompute_employee_overtime_weeks(uuid,date[]) to authenticated,service_role;

-- Fires for every assignment change, manual or from a rotation: the trigger is now the one
-- source of truth for shift_overtime_weeks, so apply_shift_rotation no longer needs its own
-- bulk recompute at the end (removed below), and nothing manual is ever missed.
create or replace function public.trg_recompute_overtime_on_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_shift_id uuid := coalesce(new.scheduled_shift_id, old.scheduled_shift_id);
  v_starts_at timestamptz;
  v_week date;
begin
  select starts_at into v_starts_at from public.scheduled_shifts where id = v_shift_id;
  if v_starts_at is null then return coalesce(new, old); end if;
  v_week := public.rotation_week_start((v_starts_at at time zone 'America/Bogota')::date);
  if tg_op = 'DELETE' then
    if old.employee_id is not null then perform public.recompute_employee_overtime_weeks(old.employee_id, array[v_week]); end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.employee_id is not null and old.employee_id is distinct from new.employee_id then
    perform public.recompute_employee_overtime_weeks(old.employee_id, array[v_week]);
  end if;
  if new.employee_id is not null then
    perform public.recompute_employee_overtime_weeks(new.employee_id, array[v_week]);
  end if;
  return new;
end $$;
drop trigger if exists trg_shift_assignments_overtime on public.shift_assignments;
drop trigger if exists trg_shift_assignments_overtime on public.shift_assignments;
create trigger trg_shift_assignments_overtime
after insert or update or delete on public.shift_assignments
for each row execute function public.trg_recompute_overtime_on_assignment();

-- A retimed shift (rare, but possible before it opens) must also refresh whoever is on it.
create or replace function public.trg_recompute_overtime_on_shift_retime()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_week_old date; v_week_new date; r record;
begin
  if new.starts_at is not distinct from old.starts_at and new.ends_at is not distinct from old.ends_at
     and new.almuerzo_minutos is not distinct from old.almuerzo_minutos then
    return new;
  end if;
  v_week_old := public.rotation_week_start((old.starts_at at time zone 'America/Bogota')::date);
  v_week_new := public.rotation_week_start((new.starts_at at time zone 'America/Bogota')::date);
  for r in select distinct employee_id from public.shift_assignments
    where scheduled_shift_id = new.id and employee_id is not null and estado <> 'cancelado' loop
    perform public.recompute_employee_overtime_weeks(r.employee_id, array[v_week_old, v_week_new]);
  end loop;
  return new;
end $$;
drop trigger if exists trg_scheduled_shifts_overtime on public.scheduled_shifts;
drop trigger if exists trg_scheduled_shifts_overtime on public.scheduled_shifts;
create trigger trg_scheduled_shifts_overtime
after update on public.scheduled_shifts
for each row execute function public.trg_recompute_overtime_on_shift_retime();

-- record_rotation_overtime is kept as-is for bulk/administrative recompute of a whole
-- rotation; it is no longer the only path that fills shift_overtime_weeks.

-- apply_shift_rotation, identical to phase 66 except the trailing bulk overtime recompute:
-- the trigger above already recomputed overtime for every employee/week actually touched by
-- each insert, so recomputing the whole rotation again here was redundant work.
create or replace function public.apply_shift_rotation(p_id uuid, p_activate boolean default false)
returns integer language plpgsql security definer set search_path=public as $$
declare r public.shift_rotations; x record; e public.employees; s public.scheduled_shifts; n integer:=0; v_count integer; v_expected jsonb;
begin
  -- Serialize rotation runs and protect the check/insert window against manual assignments.
  lock table public.scheduled_shifts in share mode;
  lock table public.employees in share mode;
  lock table public.shift_assignments in share row exclusive mode;
  select * into r from public.shift_rotations where id=p_id for update;
  if r.id is null then raise exception 'Rotacion no encontrada'; end if;
  if coalesce(auth.role(),'')<>'service_role' and not coalesce(public.is_admin_like() and public.can_read_contract_data(r.contrato_codigo),false) then raise exception 'Sin permiso'; end if;
  if r.estado<>'activo' and not p_activate then return 0; end if;
  -- With rotating rests or relievers, shifts this rotation assigned that the plan no longer expects (a day that is now rest,
  -- or a relief no longer needed) are released while not started and without attendance.
  if coalesce(r.config->'rules'->>'restMode','fijo')='rotativo'
     or exists(select 1 from jsonb_array_elements(r.config->'members') m where coalesce((m->>'reliever')::boolean,false)) then
    select coalesce(jsonb_agg(jsonb_build_object('e',p.employee_id,'d',p.fecha,'t',p.template_id)),'[]'::jsonb) into v_expected
    from public.preview_shift_rotation(r.contrato_codigo,r.config,(now() at time zone 'America/Bogota')::date+1,(now() at time zone 'America/Bogota')::date+30) p;
    delete from public.employee_shift_status es using public.shift_assignments a, public.scheduled_shifts sh
      where a.rotation_id=r.id and sh.id=a.scheduled_shift_id and es.scheduled_shift_id=sh.id and es.employee_id=a.employee_id
        and sh.starts_at>now() and es.estado_turno='programado' and coalesce(es.asistio,false)=false
        and sh.fecha_operativa between ((now() at time zone 'America/Bogota')::date+1)::text and ((now() at time zone 'America/Bogota')::date+30)::text
        and not exists(select 1 from jsonb_to_recordset(v_expected) as ex(e uuid,d date,t uuid) where ex.e=a.employee_id and ex.d::text=sh.fecha_operativa and ex.t is not distinct from sh.template_id);
    delete from public.shift_assignments a using public.scheduled_shifts sh
      where a.rotation_id=r.id and sh.id=a.scheduled_shift_id and sh.starts_at>now()
        and sh.fecha_operativa between ((now() at time zone 'America/Bogota')::date+1)::text and ((now() at time zone 'America/Bogota')::date+30)::text
        and not exists(select 1 from public.employee_shift_status es where es.scheduled_shift_id=sh.id and es.employee_id=a.employee_id and (coalesce(es.asistio,false) or es.estado_turno<>'programado'))
        and not exists(select 1 from jsonb_to_recordset(v_expected) as ex(e uuid,d date,t uuid) where ex.e=a.employee_id and ex.d::text=sh.fecha_operativa and ex.t is not distinct from sh.template_id);
  end if;
  for x in select * from public.preview_shift_rotation(r.contrato_codigo,r.config,
    (now() at time zone 'America/Bogota')::date+1,(now() at time zone 'America/Bogota')::date+30) loop
    if x.result not in ('Por asignar','Por asignar (sobrante)') then continue; end if;
    select * into s from public.scheduled_shifts where id=x.shift_id for update;
    select * into e from public.employees where id=x.employee_id;
    if s.starts_at<=now() or s.estado<>'programado' then continue; end if;
    -- Recheck capacity and overlaps after each insert; never overwrite a manual row.
    if exists(select 1 from public.shift_assignments a join public.scheduled_shifts sh on sh.id=a.scheduled_shift_id
      where a.employee_id=e.id and a.estado<>'cancelado' and sh.estado<>'cancelado'
      and sh.starts_at<s.ends_at and sh.ends_at>s.starts_at) then continue; end if;
    if x.result='Por asignar' and (select count(*) from public.shift_assignments a where a.scheduled_shift_id=s.id and a.estado<>'cancelado')>=s.operarios_planeados then continue; end if;
    insert into public.shift_assignments(scheduled_shift_id,employee_id,documento,nombre,cargo_codigo,cargo_nombre,sede_codigo,
      contrato_codigo,contrato_nombre,cliente_nombre_snapshot,cliente_nit_snapshot,rotation_id)
    values(s.id,e.id,e.documento,e.nombre,e.cargo_codigo,e.cargo_nombre,s.sede_codigo,
      s.contrato_codigo,s.contrato_nombre,s.cliente_nombre_snapshot,s.cliente_nit_snapshot,r.id) on conflict do nothing;
    get diagnostics v_count = row_count;
    if v_count=0 then continue; end if;
    n:=n+1;
    insert into public.employee_shift_status(id,scheduled_shift_id,fecha_operativa,employee_id,documento,nombre,sede_codigo,
      contrato_codigo,contrato_nombre,cliente_nombre_snapshot,cliente_nit_snapshot,estado_turno,asistio)
    values(s.id::text||'_'||e.id::text,s.id,s.fecha_operativa,e.id,e.documento,e.nombre,s.sede_codigo,
      s.contrato_codigo,s.contrato_nombre,s.cliente_nombre_snapshot,s.cliente_nit_snapshot,'programado',false) on conflict do nothing;
  end loop;
  if p_activate then update public.shift_rotations set estado='activo' where id=r.id; end if;
  return n;
end $$;

-- ---------------------------------------------------------------- 3. Harden rotation input
-- preview_shift_rotation is the only entry point that receives a raw, not-yet-saved config
-- straight from the UI (every other rotation RPC reads r.config, already validated when it
-- was saved). Identical to phase 66 except the initial cast block, now guarded so a malformed
-- value raises the same kind of business message as the rest of the function instead of a
-- raw Postgres cast error.
create or replace function public.preview_shift_rotation(p_contract text, p_config jsonb, p_from date, p_to date)
returns table(fecha date, employee_id uuid, employee_name text, template_id uuid, shift_id uuid, result text)
language plpgsql security definer set search_path = public as $$
declare
  v_start date; v_end date; v_days integer; v_cycle jsonb; v_member jsonb;
  v_rules jsonb := coalesce(p_config->'rules','{}'::jsonb);
  v_unavailable jsonb := coalesce(p_config->'unavailable','[]'::jsonb);
  v_rest numeric; v_daily numeric; v_weekly numeric; v_consecutive integer; v_period jsonb; v_ops jsonb;
begin
  if coalesce(auth.role(),'') <> 'service_role' and not coalesce(public.is_admin_like() and public.can_read_contract_data(p_contract),false) then
    raise exception 'Sin permiso para administrar rotaciones';
  end if;
  begin
    v_start := (p_config->>'start')::date;
    v_end := nullif(p_config->>'end','')::date;
    v_days := (p_config->>'days')::integer;
    v_cycle := p_config->'cycle';
  exception when others then
    raise exception 'Configuracion de rotacion invalida: %', sqlerrm;
  end;
  if v_start is null or v_days is null or v_days not between 1 and 28
     or jsonb_typeof(v_cycle) is distinct from 'array' then raise exception 'Ciclo invalido'; end if;
  if jsonb_array_length(v_cycle) not between 1 and 28 or (v_end is not null and v_end < v_start)
     or p_from is null or p_to is null or p_to < p_from or p_to-p_from > 370 then raise exception 'Vigencia invalida'; end if;
  if not exists(select 1 from jsonb_array_elements_text(v_cycle) value where value is not null) then raise exception 'El ciclo requiere un plan'; end if;
  if jsonb_typeof(p_config->'members') is distinct from 'array' then raise exception 'Faltan empleados'; end if;
  if jsonb_array_length(p_config->'members') not between 1 and 200 then raise exception 'Selecciona entre 1 y 200 empleados'; end if;
  if not exists(select 1 from public.sedes s where s.codigo=p_config->>'site' and s.contrato_codigo=p_contract and s.estado='activo') then
    raise exception 'La sede no pertenece al contrato activo';
  end if;
  if exists(select 1 from jsonb_array_elements_text(v_cycle) x where x is not null and not exists(
    select 1 from public.shift_templates t where t.id=x::uuid and t.contrato_codigo=p_contract and t.estado='activo')) then
    raise exception 'Un plan no pertenece al contrato o esta inactivo';
  end if;
  if (select count(*) from jsonb_array_elements(p_config->'members')) <>
     (select count(distinct x->>'employee') from jsonb_array_elements(p_config->'members') x) then raise exception 'Empleado duplicado'; end if;
  for v_member in select value from jsonb_array_elements(p_config->'members') loop
    if (v_member->>'offset') is null or (v_member->>'offset')::integer not between 0 and jsonb_array_length(v_cycle)-1 then raise exception 'Posicion de equipo invalida'; end if;
    if not exists(select 1 from public.employees e where e.id=(v_member->>'employee')::uuid
      and e.contrato_codigo=p_contract and e.sede_codigo=p_config->>'site' and e.estado='activo') then
      raise exception 'Empleado fuera de la sede o contrato, o inactivo';
    end if;
  end loop;
  if jsonb_typeof(v_rules) is distinct from 'object' or jsonb_typeof(v_unavailable) is distinct from 'array' then
    raise exception 'Reglas o indisponibilidades invalidas';
  end if;
  if v_rules ? 'weeklyRestDays' then
    if jsonb_typeof(v_rules->'weeklyRestDays') is distinct from 'object' then raise exception 'Descansos semanales invalidos'; end if;
    if exists(select 1 from jsonb_each(v_rules->'weeklyRestDays') d
      where jsonb_typeof(d.value) <> 'number' or d.value::text !~ '^[0-6]$'
        or not exists(select 1 from jsonb_array_elements(p_config->'members') m where m->>'employee'=d.key)) then
      raise exception 'Dia de descanso invalido o empleado fuera del equipo';
    end if;
  end if;
  if exists(select 1 from jsonb_array_elements(p_config->'members') m where m ? 'reliever' and jsonb_typeof(m->'reliever') not in ('boolean','null')) then
    raise exception 'Relevo invalido';
  end if;
  if v_rules ? 'restMode' and v_rules->>'restMode' not in ('fijo','rotativo') then raise exception 'Modo de descanso invalido'; end if;
  if v_rules ? 'restPlan' and jsonb_typeof(v_rules->'restPlan') is distinct from 'object' then raise exception 'Plan de descansos invalido'; end if;
  if v_rules ? 'surplusPlan' and jsonb_typeof(v_rules->'surplusPlan') is distinct from 'object' then raise exception 'Plan de sobrantes invalido'; end if;
  v_rest := coalesce((v_rules->>'minRestHours')::numeric,0);
  v_daily := coalesce((v_rules->>'maxDailyHours')::numeric,0);
  v_weekly := coalesce((v_rules->>'maxWeeklyHours')::numeric,0);
  v_consecutive := coalesce((v_rules->>'maxConsecutiveDays')::integer,0);
  if v_rest not between 0 and 72 or v_daily not between 0 and 24 or v_weekly not between 0 and 168
     or v_consecutive not between 0 and 31 then raise exception 'Limites fuera de rango'; end if;
  if jsonb_array_length(v_unavailable)>200 then raise exception 'Demasiados periodos de indisponibilidad'; end if;
  for v_period in select value from jsonb_array_elements(v_unavailable) loop
    if nullif(v_period->>'from','') is null or nullif(v_period->>'to','') is null
       or (v_period->>'to')::date < (v_period->>'from')::date
       or not exists(select 1 from jsonb_array_elements(p_config->'members') m where m->>'employee'=v_period->>'employee') then
      raise exception 'Periodo de indisponibilidad invalido o empleado fuera del equipo';
    end if;
  end loop;
  select coalesce(jsonb_object_agg(t, to_jsonb(public.shift_template_operating_days(t::uuid))), '{}'::jsonb) into v_ops
  from (select distinct value t from jsonb_array_elements_text(v_cycle) value where value is not null) x;
  return query
  with days as (
    select d::date as work_date from generate_series(greatest(p_from-32,v_start)::timestamp,
      least(p_to+32,coalesce(v_end,p_to+32))::timestamp,interval '1 day') d
  ), rest as materialized (
    select * from public.shift_rotation_rest_days(p_config,greatest(p_from-32,v_start),least(p_to+32,coalesce(v_end,p_to+32)))
  ), relief as materialized (
    select * from public.shift_rotation_relief(p_config,greatest(p_from-32,v_start),least(p_to+32,coalesce(v_end,p_to+32)))
  ), expected as (
    select work_date, e.id eid, e.nombre ename,
      case when coalesce((m->>'reliever')::boolean,false) then
             case when exists(select 1 from relief rf where rf.employee_id=e.id and rf.work_date=days.work_date) then null else 'relevo' end
           else (select r.kind from rest r where r.employee_id=e.id and r.rest_date=work_date limit 1) end rkind,
      coalesce((select rf.surplus from relief rf where rf.employee_id=e.id and rf.work_date=days.work_date limit 1),false) surplus,
      case when coalesce((m->>'reliever')::boolean,false) then (select rf.template_id from relief rf where rf.employee_id=e.id and rf.work_date=days.work_date limit 1)
        when exists(select 1 from rest r where r.employee_id=e.id and r.rest_date=days.work_date) then null
        else (select q.t from (select (v_cycle->>((((days.work_date-public.rotation_cycle_origin(v_start,v_days))/v_days)+(m->>'offset')::integer)%jsonb_array_length(v_cycle)))::uuid t) q
              where coalesce(v_ops->(q.t::text),'[0,1,2,3,4,5,6]'::jsonb) @> to_jsonb(extract(dow from days.work_date)::integer)) end tid
    from days cross join jsonb_array_elements(p_config->'members') m
    join public.employees e on e.id=(m->>'employee')::uuid
  ), candidates as (
    select x.*, s.id sid, s.starts_at, s.ends_at, s.estado, s.operarios_planeados, s.almuerzo_minutos lunch
    from expected x left join public.scheduled_shifts s on s.template_id=x.tid and s.sede_codigo=p_config->>'site'
      and s.contrato_codigo=p_contract and s.fecha_operativa=x.work_date::text and s.estado <> 'cancelado'
  ), workload as materialized (
    -- Include existing assignments across contracts; a person cannot rest twice.
    -- UNION avoids counting an existing assignment again as a proposed shift.
    select c.eid,c.sid,c.starts_at,c.ends_at,c.lunch from candidates c
      where c.sid is not null and c.estado='programado' and c.starts_at>now()
      and not exists(select 1 from rest rd where rd.employee_id=c.eid and rd.rest_date between (c.starts_at at time zone 'America/Bogota')::date and ((c.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date)
      and not exists(select 1 from public.shift_assignments a where a.employee_id=c.eid and a.scheduled_shift_id=c.sid
        and a.estado not in ('cancelado','reemplazado'))
    union
    select a.employee_id,s.id,s.starts_at,s.ends_at,s.almuerzo_minutos
    from public.shift_assignments a join public.scheduled_shifts s on s.id=a.scheduled_shift_id
    where a.estado not in ('cancelado','reemplazado') and s.estado<>'cancelado'
      and a.employee_id in (select (m->>'employee')::uuid from jsonb_array_elements(p_config->'members') m)
      -- Assignments a rotation made on a day that is now a rest day will be replaced: they are reported on their own
      -- ('Revisar asignacion existente') and must not also break the limits of the neighbouring days.
      and not (a.rotation_id is not null and exists(select 1 from rest rd where rd.employee_id=a.employee_id
        and rd.rest_date between (s.starts_at at time zone 'America/Bogota')::date and ((s.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date))
      and s.starts_at < ((p_to+33)::timestamp at time zone 'America/Bogota')
      and s.ends_at > ((p_from-32)::timestamp at time zone 'America/Bogota')
  ), daily as materialized (
    select w.eid,d.work_day::date as local_day,
      sum(extract(epoch from least(w.ends_at,(d.work_day+interval '1 day') at time zone 'America/Bogota')
        - greatest(w.starts_at,d.work_day at time zone 'America/Bogota'))/3600 * public.shift_net_ratio(w.starts_at,w.ends_at,w.lunch)) hours
    from workload w cross join lateral generate_series(
      (w.starts_at at time zone 'America/Bogota')::date::timestamp,
      ((w.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date::timestamp,interval '1 day') d(work_day)
    group by w.eid,d.work_day
  ), weekly as (
    select eid,public.rotation_week_start(local_day) week_start,sum(hours) hours from daily group by eid,public.rotation_week_start(local_day)
  ), streak_days as (
    select eid,local_day,local_day-(row_number() over(partition by eid order by local_day))::integer as streak from daily
  ), streaks as (
    select eid,min(local_day) first_day,max(local_day) last_day,count(*) worked_days from streak_days group by eid,streak
  )
  select c.work_date,c.eid,c.ename,c.tid,c.sid,
    case
      when c.tid is null then case
        when c.rkind is not null then
          case when exists(select 1 from public.shift_assignments a join public.scheduled_shifts sh on sh.id=a.scheduled_shift_id
            where a.employee_id=c.eid and a.estado not in ('cancelado','reemplazado') and sh.estado<>'cancelado'
              and (sh.starts_at at time zone 'America/Bogota')::date = c.work_date)
            then 'Revisar asignacion existente: Descanso ' || c.rkind else 'Descanso ' || c.rkind end
        else 'Descanso' end
      when c.sid is null then 'Sin turno generado'
      when c.starts_at <= now() or c.estado <> 'programado' then 'Historico o iniciado'
      when exists(select 1 from rest rd where rd.employee_id=c.eid and rd.rest_date between (c.starts_at at time zone 'America/Bogota')::date and ((c.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date) then
        case when exists(select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=c.eid and a.estado not in ('cancelado','reemplazado'))
          then 'Revisar asignacion existente: Descanso ' || (select rd.kind from rest rd where rd.employee_id=c.eid
            and rd.rest_date between (c.starts_at at time zone 'America/Bogota')::date and ((c.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date limit 1)
          else 'Descanso ' || (select rd.kind from rest rd where rd.employee_id=c.eid
            and rd.rest_date between (c.starts_at at time zone 'America/Bogota')::date and ((c.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date limit 1) || ' (cruce nocturno)' end
      when exists(select 1 from jsonb_array_elements(v_unavailable) u
        where (u->>'employee')::uuid=c.eid
        and c.starts_at < (((u->>'to')::date+1)::timestamp at time zone 'America/Bogota')
        and c.ends_at > ((u->>'from')::date::timestamp at time zone 'America/Bogota')) then case when exists(select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=c.eid)
          then 'Revisar asignacion existente: Empleado no disponible' else 'Empleado no disponible' end
      when v_rest>0 and exists(select 1 from workload w where w.eid=c.eid and w.sid<>c.sid
        and w.starts_at < c.ends_at+make_interval(secs=>(v_rest*3600)::double precision)
        and w.ends_at > c.starts_at-make_interval(secs=>(v_rest*3600)::double precision)) then case when exists(select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=c.eid)
          then 'Revisar asignacion existente: Descanso minimo insuficiente' else 'Descanso minimo insuficiente' end
      when v_daily>0 and exists(select 1 from daily d where d.eid=c.eid and d.hours>v_daily
        and d.local_day between (c.starts_at at time zone 'America/Bogota')::date
          and ((c.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date) then case when exists(select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=c.eid)
          then 'Revisar asignacion existente: Limite de horas diarias' else 'Limite de horas diarias' end
      when v_weekly>0 and exists(select 1 from weekly w where w.eid=c.eid and w.hours>v_weekly
        and w.week_start between public.rotation_week_start((c.starts_at at time zone 'America/Bogota')::date)
          and public.rotation_week_start(((c.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date)) then
        (case when exists(select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=c.eid)
          then 'Revisar asignacion existente: ' else '' end)
        || 'Limite semanal: '
        || (select trim(to_char(w.hours,'FM999999990.##')) from weekly w
            where w.eid=c.eid and w.hours>v_weekly
              and w.week_start between public.rotation_week_start((c.starts_at at time zone 'America/Bogota')::date)
                and public.rotation_week_start(((c.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date)
            order by w.hours desc limit 1)
        || ' h programadas / ' || trim(to_char(v_weekly,'FM999999990.##')) || ' h permitidas'
      when v_consecutive>0 and exists(select 1 from streaks st where st.eid=c.eid and st.worked_days>v_consecutive
        and st.first_day<=((c.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date
        and st.last_day>=(c.starts_at at time zone 'America/Bogota')::date) then case when exists(select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=c.eid)
          then 'Revisar asignacion existente: ' else '' end
        || 'Limite de dias consecutivos: ' || (select st.worked_days from streaks st where st.eid=c.eid and st.worked_days>v_consecutive and st.first_day<=((c.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date and st.last_day>=(c.starts_at at time zone 'America/Bogota')::date order by st.worked_days desc limit 1) || ' dias seguidos / ' || v_consecutive || ' permitidos'
      when exists(select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=c.eid) then 'Asignacion existente'
      when exists(select 1 from public.shift_assignments a join public.scheduled_shifts s on s.id=a.scheduled_shift_id
        where a.employee_id=c.eid and a.estado not in ('cancelado','reemplazado') and s.estado <> 'cancelado'
        and s.starts_at < c.ends_at and s.ends_at > c.starts_at) then
        'Cruce con otra asignacion: ' || (select coalesce('rotacion ' || ro.nombre, 'asignacion manual') || ' de '
          || to_char(s.starts_at at time zone 'America/Bogota','HH24:MI') || ' a ' || to_char(s.ends_at at time zone 'America/Bogota','HH24:MI')
          || ' (' || to_char(s.starts_at at time zone 'America/Bogota','DD/MM') || ')'
          from public.shift_assignments a join public.scheduled_shifts s on s.id=a.scheduled_shift_id
          left join public.shift_rotations ro on ro.id=a.rotation_id
          where a.employee_id=c.eid and a.estado not in ('cancelado','reemplazado') and s.estado <> 'cancelado'
            and s.starts_at < c.ends_at and s.ends_at > c.starts_at order by s.starts_at limit 1)
      when exists(select 1 from candidates other where other.eid=c.eid and other.sid<>c.sid
        and not exists(select 1 from rest rd where rd.employee_id=other.eid and rd.rest_date between (other.starts_at at time zone 'America/Bogota')::date and ((other.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date)
        and other.starts_at<c.ends_at and other.ends_at>c.starts_at) then 'Cruce dentro del ciclo'
      when not c.surplus and (select count(*) from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.estado not in ('cancelado','reemplazado'))
         + (select count(*) from candidates other where other.sid=c.sid and not other.surplus and not exists(
             select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=other.eid
               and a.estado not in ('cancelado','reemplazado'))
             and not exists(select 1 from rest rd where rd.employee_id=other.eid and rd.rest_date between (other.starts_at at time zone 'America/Bogota')::date and ((other.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date)
             and not exists(select 1 from jsonb_array_elements(v_unavailable) u2 where (u2->>'employee')::uuid=other.eid
               and other.starts_at < (((u2->>'to')::date+1)::timestamp at time zone 'America/Bogota')
               and other.ends_at > ((u2->>'from')::date::timestamp at time zone 'America/Bogota'))) > c.operarios_planeados then
        'Cupo insuficiente: ' || ((select count(*) from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.estado not in ('cancelado','reemplazado'))
           + (select count(*) from candidates other where other.sid=c.sid and not other.surplus and not exists(
               select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=other.eid
                 and a.estado not in ('cancelado','reemplazado'))
               and not exists(select 1 from rest rd where rd.employee_id=other.eid and rd.rest_date between (other.starts_at at time zone 'America/Bogota')::date and ((other.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date))) || ' personas en el turno para ' || c.operarios_planeados || ' cupos'
      when c.surplus then 'Por asignar (sobrante)'
      else 'Por asignar'
    end::text
  from candidates c where c.work_date between p_from and p_to order by c.work_date,c.ename,c.starts_at;
end $$;

revoke all on function public.preview_shift_rotation(text,jsonb,date,date) from public,anon;
grant execute on function public.preview_shift_rotation(text,jsonb,date,date) to authenticated,service_role;
revoke all on function public.apply_shift_rotation(uuid,boolean) from public,anon;
grant execute on function public.apply_shift_rotation(uuid,boolean) to authenticated,service_role;
commit;

-- >>>>>>>>>> schema_operations_phase68_backfill_pending_exits.sql
-- Phase 68: backfill pending-exit status for shifts closed by older logic.
-- Apply after phase 67.
--
-- Context: exit tracking (salida_at) via WhatsApp/QR is a newer feature. Any project upgrading
-- from before it existed already has employee_shift_status rows that a closure job finalized
-- with a terminal estado_turno ('trabajado', 'trabajado_tardio', 'ajustado', etc.) even though
-- entrada_at was set and salida_at was never captured, because the closure logic at the time
-- never checked for a missing exit. public.finalize_shift_attendance (phase 67) already fixes
-- this going forward by classifying such rows as 'salida_pendiente' with requires_review = true.
-- This phase applies that same, already-shipped rule retroactively to the rows closed before it
-- existed, so upgrading a project does not leave a backlog of misclassified "finished" shifts
-- that were never actually exited.

update public.employee_shift_status
set
  estado_turno = 'salida_pendiente',
  requires_review = true
where entrada_at is not null
  and salida_at is null
  and estado_turno not in ('salida_pendiente', 'post_cierre_pendiente', 'ausente_con_novedad', 'cancelado', 'programado');

-- >>>>>>>>>> schema_operations_phase69_shift_labor_limits.sql
-- Phase 69: opt-in labor-compliance limits per shift plan (weekly hours, minimum rest,
-- max consecutive work days, weekly-rest alert), applied to ANY shift regardless of
-- whether a rotation exists.
-- Apply after phase 68. Existing configurations and assignments are preserved.
--
-- These columns mirror the existing ventana_*/alerta_* per-plan-control pattern on
-- shift_template_rules: they are set once per plan (ShiftsAdmin.js openPlanModal) and
-- stamped on every rule row of that plan. limite_horas_semanales/limite_descanso_horas/
-- limite_dias_consecutivos are nullable with no default: unconfigured (NULL) means
-- "use the Colombian legal weekly default (colombia_weekly_limit) for hours, or no
-- limit at all for rest/consecutive days" -- see preview_shift_rotation below and
-- checkShiftLaborLimits in ShiftsAdmin.js (client side), which both apply the exact
-- same fallback so every plan is protected even if nobody configured it.
--
-- Rotaciones no longer keeps its own separate minRestHours/maxWeeklyHours/
-- maxConsecutiveDays in shift_rotations.config->rules: preview_shift_rotation now
-- resolves these from the plan(s) used in the rotation's cycle instead, so there is a
-- single source of truth. maxDailyHours is removed without replacement (shift duration
-- is already bounded by hora_inicio/hora_fin at plan level). weeklyRestDays (fixed rest
-- day per employee, for team coverage) is untouched -- that is a rotation-only concern.
begin;

alter table public.shift_template_rules
  add column if not exists limite_horas_semanales numeric,
  add column if not exists limite_descanso_horas numeric,
  add column if not exists limite_dias_consecutivos integer,
  add column if not exists alerta_descanso_semanal boolean not null default false;

alter table public.shift_template_rules
  drop constraint if exists shift_template_rules_limite_horas_semanales_check,
  drop constraint if exists shift_template_rules_limite_descanso_horas_check,
  drop constraint if exists shift_template_rules_limite_dias_consecutivos_check;

alter table public.shift_template_rules
  add constraint shift_template_rules_limite_horas_semanales_check
    check (limite_horas_semanales is null or limite_horas_semanales between 1 and 168),
  add constraint shift_template_rules_limite_descanso_horas_check
    check (limite_descanso_horas is null or limite_descanso_horas between 0 and 72),
  add constraint shift_template_rules_limite_dias_consecutivos_check
    check (limite_dias_consecutivos is null or limite_dias_consecutivos between 1 and 31);

-- Mirrors src/assets/js/utils/rotationHours.js COLOMBIA_WEEKLY_LIMITS / colombiaWeeklyLimit.
-- Keep both in sync: this is a duplicated legal constant (Ley 2101 de 2021), not
-- duplicated business logic -- the JS copy drives the browser UI, this one drives
-- preview_shift_rotation server-side.
create or replace function public.colombia_weekly_limit(p_date date)
returns numeric language sql immutable as $$
  select case
    when p_date >= '2026-07-15' then 42
    when p_date >= '2025-07-15' then 44
    when p_date >= '2024-07-15' then 46
    when p_date >= '2023-07-15' then 47
    else 48
  end
$$;
revoke all on function public.colombia_weekly_limit(date) from public,anon;
grant execute on function public.colombia_weekly_limit(date) to authenticated,service_role;

create or replace function public.preview_shift_rotation(p_contract text, p_config jsonb, p_from date, p_to date)
returns table(fecha date, employee_id uuid, employee_name text, template_id uuid, shift_id uuid, result text)
language plpgsql security definer set search_path = public as $$
declare
  v_start date; v_end date; v_days integer; v_cycle jsonb; v_member jsonb;
  v_rules jsonb := coalesce(p_config->'rules','{}'::jsonb);
  v_unavailable jsonb := coalesce(p_config->'unavailable','[]'::jsonb);
  v_period jsonb;
begin
  if coalesce(auth.role(),'') <> 'service_role' and not coalesce(public.is_admin_like() and public.can_read_contract_data(p_contract),false) then
    raise exception 'Sin permiso para administrar rotaciones';
  end if;
  v_start := (p_config->>'start')::date;
  v_end := nullif(p_config->>'end','')::date;
  v_days := (p_config->>'days')::integer;
  v_cycle := p_config->'cycle';
  if v_start is null or v_days is null or v_days not between 1 and 28
     or jsonb_typeof(v_cycle) is distinct from 'array' then raise exception 'Ciclo invalido'; end if;
  if jsonb_array_length(v_cycle) not between 1 and 28 or (v_end is not null and v_end < v_start)
     or p_from is null or p_to is null or p_to < p_from or p_to-p_from > 370 then raise exception 'Vigencia invalida'; end if;
  if not exists(select 1 from jsonb_array_elements_text(v_cycle) value where value is not null) then raise exception 'El ciclo requiere un plan'; end if;
  if jsonb_typeof(p_config->'members') is distinct from 'array' then raise exception 'Faltan empleados'; end if;
  if jsonb_array_length(p_config->'members') not between 1 and 200 then raise exception 'Selecciona entre 1 y 200 empleados'; end if;
  if not exists(select 1 from public.sedes s where s.codigo=p_config->>'site' and s.contrato_codigo=p_contract and s.estado='activo') then
    raise exception 'La sede no pertenece al contrato activo';
  end if;
  if exists(select 1 from jsonb_array_elements_text(v_cycle) x where x is not null and not exists(
    select 1 from public.shift_templates t where t.id=x::uuid and t.contrato_codigo=p_contract and t.estado='activo')) then
    raise exception 'Un plan no pertenece al contrato o esta inactivo';
  end if;
  if (select count(*) from jsonb_array_elements(p_config->'members')) <>
     (select count(distinct x->>'employee') from jsonb_array_elements(p_config->'members') x) then raise exception 'Empleado duplicado'; end if;
  for v_member in select value from jsonb_array_elements(p_config->'members') loop
    if (v_member->>'offset') is null or (v_member->>'offset')::integer not between 0 and jsonb_array_length(v_cycle)-1 then raise exception 'Posicion de equipo invalida'; end if;
    if not exists(select 1 from public.employees e where e.id=(v_member->>'employee')::uuid
      and e.contrato_codigo=p_contract and e.sede_codigo=p_config->>'site' and e.estado='activo') then
      raise exception 'Empleado fuera de la sede o contrato, o inactivo';
    end if;
  end loop;
  if jsonb_typeof(v_rules) is distinct from 'object' or jsonb_typeof(v_unavailable) is distinct from 'array' then
    raise exception 'Reglas o indisponibilidades invalidas';
  end if;
  if v_rules ? 'weeklyRestDays' then
    if jsonb_typeof(v_rules->'weeklyRestDays') is distinct from 'object' then raise exception 'Descansos semanales invalidos'; end if;
    if exists(select 1 from jsonb_each(v_rules->'weeklyRestDays') d
      where jsonb_typeof(d.value) <> 'number' or d.value::text !~ '^[0-6]$'
        or not exists(select 1 from jsonb_array_elements(p_config->'members') m where m->>'employee'=d.key)) then
      raise exception 'Dia de descanso invalido o empleado fuera del equipo';
    end if;
  end if;
  if jsonb_array_length(v_unavailable)>200 then raise exception 'Demasiados periodos de indisponibilidad'; end if;
  for v_period in select value from jsonb_array_elements(v_unavailable) loop
    if nullif(v_period->>'from','') is null or nullif(v_period->>'to','') is null
       or (v_period->>'to')::date < (v_period->>'from')::date
       or not exists(select 1 from jsonb_array_elements(p_config->'members') m where m->>'employee'=v_period->>'employee') then
      raise exception 'Periodo de indisponibilidad invalido o empleado fuera del equipo';
    end if;
  end loop;
  return query
  with days as (
    select d::date as work_date from generate_series(greatest(p_from-32,v_start)::timestamp,
      least(p_to+32,coalesce(v_end,p_to+32))::timestamp,interval '1 day') d
  ), expected as (
    select work_date, e.id eid, e.nombre ename,
      case when (v_rules->'weeklyRestDays'->>(m->>'employee'))::integer = extract(dow from work_date)::integer then null
        else (v_cycle->>((((work_date-v_start)/v_days)+(m->>'offset')::integer)%jsonb_array_length(v_cycle)))::uuid end tid
    from days cross join jsonb_array_elements(p_config->'members') m
    join public.employees e on e.id=(m->>'employee')::uuid
  ), candidates as (
    select x.*, s.id sid, s.starts_at, s.ends_at, s.estado, s.operarios_planeados
    from expected x left join public.scheduled_shifts s on s.template_id=x.tid and s.sede_codigo=p_config->>'site'
      and s.contrato_codigo=p_contract and s.fecha_operativa=x.work_date::text and s.estado <> 'cancelado'
  ), workload as materialized (
    -- Include existing assignments across contracts; a person cannot rest twice.
    -- UNION avoids counting an existing assignment again as a proposed shift.
    select c.eid,c.sid,c.starts_at,c.ends_at,c.tid from candidates c
      where c.sid is not null and c.estado='programado' and c.starts_at>now()
      and not public.shift_rotation_rest_overlap(p_config,c.eid,c.starts_at,c.ends_at)
      and not exists(select 1 from public.shift_assignments a where a.employee_id=c.eid and a.scheduled_shift_id=c.sid
        and a.estado not in ('cancelado','reemplazado'))
    union
    select a.employee_id,s.id,s.starts_at,s.ends_at,s.template_id
    from public.shift_assignments a join public.scheduled_shifts s on s.id=a.scheduled_shift_id
    where a.estado not in ('cancelado','reemplazado') and s.estado<>'cancelado'
      and a.employee_id in (select (m->>'employee')::uuid from jsonb_array_elements(p_config->'members') m)
      and s.starts_at < ((p_to+33)::timestamp at time zone 'America/Bogota')
      and s.ends_at > ((p_from-32)::timestamp at time zone 'America/Bogota')
  ), template_limits as (
    -- Resolves the labor limits from the plan(s) actually touched by this employee's
    -- workload (cycle candidates + real existing assignments), not only p_config. A
    -- plan's limits are stamped identically on every one of its shift_template_rules
    -- rows, so min() here just collapses to one row per template_id.
    select w.tid as template_id,
      min(r.limite_horas_semanales) as limite_horas_semanales,
      min(r.limite_descanso_horas) as limite_descanso_horas,
      min(r.limite_dias_consecutivos) as limite_dias_consecutivos
    from (select distinct tid from workload where tid is not null) w
    left join public.shift_template_rules r on r.template_id=w.tid and r.estado='activo'
    group by w.tid
  ), daily as materialized (
    select w.eid,d.work_day::date as local_day,
      sum(extract(epoch from least(w.ends_at,(d.work_day+interval '1 day') at time zone 'America/Bogota')
        - greatest(w.starts_at,d.work_day at time zone 'America/Bogota'))/3600) hours
    from workload w cross join lateral generate_series(
      (w.starts_at at time zone 'America/Bogota')::date::timestamp,
      ((w.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date::timestamp,interval '1 day') d(work_day)
    group by w.eid,d.work_day
  ), daily_templates as materialized (
    select distinct w.eid, d.work_day::date as local_day, w.tid
    from workload w cross join lateral generate_series(
      (w.starts_at at time zone 'America/Bogota')::date::timestamp,
      ((w.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date::timestamp,interval '1 day') d(work_day)
    where w.tid is not null
  ), weekly as (
    select d.eid,date_trunc('week',d.local_day)::date week_start,sum(d.hours) hours,
      coalesce(min(tl.limite_horas_semanales),public.colombia_weekly_limit(date_trunc('week',d.local_day)::date)) as limite
    from daily d
    left join daily_templates dt on dt.eid=d.eid and dt.local_day=d.local_day
    left join template_limits tl on tl.template_id=dt.tid
    group by d.eid,date_trunc('week',d.local_day)
  ), streak_days as (
    select eid,local_day,local_day-(row_number() over(partition by eid order by local_day))::integer as streak from daily
  ), streaks as (
    select eid,min(local_day) first_day,max(local_day) last_day,count(*) worked_days from streak_days group by eid,streak
  )
  select c.work_date,c.eid,c.ename,c.tid,c.sid,
    case
      when c.tid is null then case
        when (v_rules->'weeklyRestDays'->>c.eid::text)::integer = extract(dow from c.work_date)::integer then
          case when exists(select 1 from public.shift_assignments a join public.scheduled_shifts sh on sh.id=a.scheduled_shift_id
            where a.employee_id=c.eid and a.estado not in ('cancelado','reemplazado') and sh.estado<>'cancelado'
              and sh.starts_at < ((c.work_date+1)::timestamp at time zone 'America/Bogota')
              and sh.ends_at > (c.work_date::timestamp at time zone 'America/Bogota'))
            then 'Revisar asignacion existente: Descanso semanal' else 'Descanso semanal' end
        else 'Descanso' end
      when c.sid is null then 'Sin turno generado'
      when c.starts_at <= now() or c.estado <> 'programado' then 'Historico o iniciado'
      when public.shift_rotation_rest_overlap(p_config,c.eid,c.starts_at,c.ends_at) then
        case when exists(select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=c.eid and a.estado not in ('cancelado','reemplazado'))
          then 'Revisar asignacion existente: Descanso semanal' else 'Descanso semanal (cruce nocturno)' end
      when exists(select 1 from jsonb_array_elements(v_unavailable) u
        where (u->>'employee')::uuid=c.eid
        and c.starts_at < (((u->>'to')::date+1)::timestamp at time zone 'America/Bogota')
        and c.ends_at > ((u->>'from')::date::timestamp at time zone 'America/Bogota')) then case when exists(select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=c.eid)
          then 'Revisar asignacion existente: Empleado no disponible' else 'Empleado no disponible' end
      when exists(select 1 from workload w where w.eid=c.eid and w.sid<>c.sid
        and w.starts_at < c.ends_at+make_interval(secs=>((select tl.limite_descanso_horas from template_limits tl where tl.template_id=c.tid)*3600)::double precision)
        and w.ends_at > c.starts_at-make_interval(secs=>((select tl.limite_descanso_horas from template_limits tl where tl.template_id=c.tid)*3600)::double precision)) then case when exists(select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=c.eid)
          then 'Revisar asignacion existente: Descanso minimo insuficiente' else 'Descanso minimo insuficiente' end
      when exists(select 1 from weekly w where w.eid=c.eid and w.hours>w.limite+colombia_max_weekly_overtime()
        and w.week_start between date_trunc('week',c.starts_at at time zone 'America/Bogota')::date
          and date_trunc('week',(c.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date) then
        (case when exists(select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=c.eid)
          then 'Revisar asignacion existente: ' else '' end)
        || 'Limite semanal: '
        || (select trim(to_char(w.hours,'FM999999990.##')) from weekly w
            where w.eid=c.eid and w.hours>w.limite+colombia_max_weekly_overtime()
              and w.week_start between date_trunc('week',c.starts_at at time zone 'America/Bogota')::date
                and date_trunc('week',(c.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date
            order by w.hours desc limit 1)
        || ' h programadas / ' || (select trim(to_char(w.limite+colombia_max_weekly_overtime(),'FM999999990.##')) from weekly w
              where w.eid=c.eid and w.hours>w.limite+colombia_max_weekly_overtime()
                and w.week_start between date_trunc('week',c.starts_at at time zone 'America/Bogota')::date
                  and date_trunc('week',(c.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date
              order by w.hours desc limit 1) || ' h permitidas'
      when exists(select 1 from streaks st where st.eid=c.eid
        and st.worked_days > (select min(tl.limite_dias_consecutivos) from daily_templates dt join template_limits tl on tl.template_id=dt.tid
            where dt.eid=st.eid and dt.local_day between st.first_day and st.last_day)
        and st.first_day<=((c.ends_at-interval '1 microsecond') at time zone 'America/Bogota')::date
        and st.last_day>=(c.starts_at at time zone 'America/Bogota')::date) then case when exists(select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=c.eid)
          then 'Revisar asignacion existente: Limite de dias consecutivos' else 'Limite de dias consecutivos' end
      when exists(select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=c.eid) then 'Asignacion existente'
      when exists(select 1 from public.shift_assignments a join public.scheduled_shifts s on s.id=a.scheduled_shift_id
        where a.employee_id=c.eid and a.estado not in ('cancelado','reemplazado') and s.estado <> 'cancelado'
        and s.starts_at < c.ends_at and s.ends_at > c.starts_at) then 'Cruce con otra asignacion'
      when exists(select 1 from candidates other where other.eid=c.eid and other.sid<>c.sid
        and not public.shift_rotation_rest_overlap(p_config,other.eid,other.starts_at,other.ends_at)
        and other.starts_at<c.ends_at and other.ends_at>c.starts_at) then 'Cruce dentro del ciclo'
      when (select count(*) from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.estado not in ('cancelado','reemplazado'))
         + (select count(*) from candidates other where other.sid=c.sid and not exists(
             select 1 from public.shift_assignments a where a.scheduled_shift_id=c.sid and a.employee_id=other.eid
               and a.estado not in ('cancelado','reemplazado'))
             and not public.shift_rotation_rest_overlap(p_config,other.eid,other.starts_at,other.ends_at)) > c.operarios_planeados then 'Cupo insuficiente'
      else 'Por asignar'
    end::text
  from candidates c where c.work_date between p_from and p_to order by c.work_date,c.ename,c.starts_at;
end $$;

-- Small helper so the CASE expression above stays readable; mirrors
-- COLOMBIA_MAX_WEEKLY_OVERTIME in rotationHours.js (Art. 22 Ley 50 de 1990).
create or replace function public.colombia_max_weekly_overtime()
returns numeric language sql immutable as $$ select 12 $$;
revoke all on function public.colombia_max_weekly_overtime() from public,anon;
grant execute on function public.colombia_max_weekly_overtime() to authenticated,service_role;

create or replace function public.shift_rotation_rules_version()
returns integer language sql stable as $$select 70$$;
revoke all on function public.shift_rotation_rules_version() from public,anon;
grant execute on function public.shift_rotation_rules_version() to authenticated,service_role;

commit;

-- >>>>>>>>>> schema_operations_phase70_site_visit_permissions.sql
-- Phase 70: split site-visit access into consult (viewSiteVisits) and manage (manageSiteVisits).
-- Apply after phase 69.
--
-- Until now visit_admin() required editContracts for reading AND managing visits, so the
-- Centro de Permisos could not grant one without the other. Both new keys fall back to
-- editContracts, so roles and users without an explicit value keep exactly their current access.
begin;

-- Manage: program cycles (visit_save_settings) and review visits (visit_review).
create or replace function public.visit_admin(p_contract text) returns boolean language sql stable security definer set search_path=public as $$
 select coalesce(public.can_read_contract_data(p_contract) and public.current_profile_has_permission('manageSiteVisits','editContracts'),false)
$$;

-- Consult: read every cycle, assignment and visit of the contract.
create or replace function public.visit_viewer(p_contract text) returns boolean language sql stable security definer set search_path=public as $$
 select coalesce(public.can_read_contract_data(p_contract) and (
   public.current_profile_has_permission('viewSiteVisits','editContracts')
   or public.current_profile_has_permission('manageSiteVisits','editContracts')
 ),false)
$$;
grant execute on function public.visit_viewer(text) to authenticated;

create or replace function public.visit_assignment_read(p_assignment uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from visit_assignments a where a.id=p_assignment and
 (visit_viewer(a.contrato_codigo) or (a.supervisor_id=auth.uid() and visit_active_user())))
$$;

drop policy if exists visit_settings_read on public.visit_settings;
drop policy if exists visit_settings_read on public.visit_settings;
create policy visit_settings_read on public.visit_settings for select to authenticated using(visit_viewer(contrato_codigo));
drop policy if exists visit_cycles_read on public.visit_cycles;
drop policy if exists visit_cycles_read on public.visit_cycles;
create policy visit_cycles_read on public.visit_cycles for select to authenticated using(visit_viewer(contrato_codigo) or exists(select 1 from visit_assignments a where a.cycle_id=visit_cycles.id and a.supervisor_id=auth.uid()));

commit;

-- >>>>>>>>>> schema_operations_phase71_contract_scope_all_profiles.sql
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
do $once$
begin
  if public.rocky_run_once('p71_profile_contract_backfill') then
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
  end if;
end
$once$;

-- ---------------------------------------------------------------------------
-- Contract assignments
-- ---------------------------------------------------------------------------
-- An admin only sees and grants the contracts it has itself, so it cannot widen anyone's scope
-- (its own included) beyond its own.
drop policy if exists "profile_contract_access_select" on public.profile_contract_access;
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
drop policy if exists "profile_contract_access_insert" on public.profile_contract_access;
create policy "profile_contract_access_insert"
on public.profile_contract_access
for insert
to authenticated
with check (public.current_profile_can_manage_contract_access() and public.can_read_contract_data(contrato_codigo) and public.can_manage_profile(user_id));

drop policy if exists "profile_contract_access_update" on public.profile_contract_access;
drop policy if exists "profile_contract_access_update" on public.profile_contract_access;
create policy "profile_contract_access_update"
on public.profile_contract_access
for update
to authenticated
using (public.current_profile_can_manage_contract_access() and public.can_read_contract_data(contrato_codigo) and public.can_manage_profile(user_id))
with check (public.current_profile_can_manage_contract_access() and public.can_read_contract_data(contrato_codigo) and public.can_manage_profile(user_id));

drop policy if exists "profile_contract_access_delete" on public.profile_contract_access;
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
drop trigger if exists trg_contracts_grant_creator_access on public.contracts;
create trigger trg_contracts_grant_creator_access
after insert on public.contracts
for each row execute function public.grant_contract_access_to_creator();

-- Every assigned profile (supervisors included) reads the contract header to pick it. The insert's
-- RETURNING is checked before the trigger's assignment is visible, so the creator also reads the
-- row inside the same transaction (created_at defaults to now(), the transaction start).
drop policy if exists "contracts_read_authenticated" on public.contracts;
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
drop policy if exists "contracts_insert_admin" on public.contracts;
create policy "contracts_insert_admin"
on public.contracts
for insert
to authenticated
with check (public.is_admin_like());

-- The new code is not assigned yet while a rename is checked, so only the old row is scoped.
drop policy if exists "contracts_update_admin" on public.contracts;
drop policy if exists "contracts_update_admin" on public.contracts;
create policy "contracts_update_admin"
on public.contracts
for update
to authenticated
using (public.is_admin_like() and public.can_read_contract_data(codigo))
with check (public.is_admin_like());

drop policy if exists "contracts_delete_admin" on public.contracts;
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
drop policy if exists "daily_metrics_read_authenticated" on public.daily_metrics;
create policy "daily_metrics_read_authenticated"
on public.daily_metrics
for select
to authenticated
using (public.is_superadmin());

drop policy if exists "daily_metrics_write_superadmin" on public.daily_metrics;
drop policy if exists "daily_metrics_write_superadmin" on public.daily_metrics;
create policy "daily_metrics_write_superadmin"
on public.daily_metrics
for all
to authenticated
using (public.is_superadmin())
with check (public.is_superadmin());

drop policy if exists "daily_closures_write_admin" on public.daily_closures;
drop policy if exists "daily_closures_read_authenticated" on public.daily_closures;
drop policy if exists "daily_closures_read_authenticated" on public.daily_closures;
create policy "daily_closures_read_authenticated"
on public.daily_closures
for select
to authenticated
using (public.is_superadmin());

drop policy if exists "daily_closures_write_superadmin" on public.daily_closures;
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
drop policy if exists "import_history_read_authenticated" on public.import_history;
create policy "import_history_read_authenticated"
on public.import_history
for select
to authenticated
using (public.is_superadmin() or confirmado_por_uid = auth.uid());

drop policy if exists "import_history_insert_admin" on public.import_history;
drop policy if exists "import_history_insert_admin" on public.import_history;
create policy "import_history_insert_admin"
on public.import_history
for insert
to authenticated
with check (public.is_superadmin() or (public.is_admin_like() and confirmado_por_uid = auth.uid()));

drop policy if exists "import_history_manage_superadmin" on public.import_history;
drop policy if exists "import_history_manage_superadmin" on public.import_history;
create policy "import_history_manage_superadmin"
on public.import_history
for update
to authenticated
using (public.is_superadmin())
with check (public.is_superadmin());

drop policy if exists "import_history_delete_superadmin" on public.import_history;
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
drop policy if exists "profiles_select_self_or_admin" on public.profiles;
create policy "profiles_select_self_or_admin"
on public.profiles
for select
to authenticated
using (auth.uid() = id or public.can_manage_profile(id));

drop policy if exists "profiles_update_self_or_admin" on public.profiles;
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
drop policy if exists "audit_logs_read_admin_like" on public.audit_logs;
create policy "audit_logs_read_admin_like"
on public.audit_logs
for select
to authenticated
using (public.can_read_audit_log(actor_uid, target_type, target_id, contrato_codigo));

-- Nobody writes entries in someone else's name or into a contract it cannot read.
drop policy if exists "audit_logs_insert_active_user" on public.audit_logs;
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

-- >>>>>>>>>> schema_operations_phase72_access_profiles.sql
-- Phase 72: custom access profiles ("Perfiles").
-- Apply after phase 71.
--
-- A superadmin creates profiles tailored to each project (e.g. "Coordinador de turnos") and picks
-- the modules they enable. Each profile sits on a base role (admin, editor, consultor or supervisor)
-- that keeps the system behaviour of that role: contract scope, supervisor zones, admin writes.
-- Effective permissions of a user, first value found wins:
--   user_overrides > access profile > roles_matrix of the role > role defaults.
begin;

create table if not exists public.access_profiles (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  descripcion text,
  base_role public.app_role not null,
  permissions jsonb not null default '{}'::jsonb,
  estado text not null default 'activo',
  created_by_uid uuid references public.profiles(id) on delete set null,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint access_profiles_base_role_check check (base_role::text in ('admin', 'editor', 'consultor', 'supervisor')),
  constraint access_profiles_estado_check check (estado in ('activo', 'inactivo')),
  constraint access_profiles_nombre_check check (length(trim(nombre)) > 0)
);

create unique index if not exists idx_access_profiles_nombre
  on public.access_profiles (lower(trim(nombre)));

alter table public.access_profiles enable row level security;

drop trigger if exists trg_access_profiles_updated_at on public.access_profiles;
drop trigger if exists trg_access_profiles_updated_at on public.access_profiles;
create trigger trg_access_profiles_updated_at
before update on public.access_profiles
for each row execute function public.set_updated_at();

alter table public.profiles
  add column if not exists access_profile_id uuid references public.access_profiles(id) on delete set null;

create index if not exists idx_profiles_access_profile_id
  on public.profiles (access_profile_id);

-- The base role carries the user's contract and zone behaviour, so it cannot change under users
-- that already hold the profile.
create or replace function public.guard_access_profile_base_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.base_role is distinct from old.base_role
    and exists (select 1 from public.profiles p where p.access_profile_id = old.id)
  then
    raise exception 'No puedes cambiar el rol base de un perfil con usuarios asignados.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_access_profiles_guard_base_role on public.access_profiles;
drop trigger if exists trg_access_profiles_guard_base_role on public.access_profiles;
create trigger trg_access_profiles_guard_base_role
before update on public.access_profiles
for each row execute function public.guard_access_profile_base_role();

-- Assigning a profile sets the user's role to its base role; setting a different role directly
-- detaches the profile. Nobody but a superadmin changes their own profile.
create or replace function public.sync_profile_access_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base_role public.app_role;
  v_estado text;
  v_changed boolean := tg_op = 'INSERT' or new.access_profile_id is distinct from old.access_profile_id;
begin
  if auth.uid() is not null and new.id = auth.uid() and not public.is_superadmin() then
    if tg_op = 'INSERT' then
      new.access_profile_id := null;
    elsif v_changed then
      raise exception 'No puedes cambiar el perfil de tu propio usuario.';
    end if;
  end if;

  if new.access_profile_id is null then
    return new;
  end if;

  select ap.base_role, ap.estado
  into v_base_role, v_estado
  from public.access_profiles ap
  where ap.id = new.access_profile_id;

  if not v_changed and new.role is distinct from old.role and new.role is distinct from v_base_role then
    new.access_profile_id := null;
    return new;
  end if;

  if v_changed and v_estado is distinct from 'activo' then
    raise exception 'El perfil seleccionado esta inactivo.';
  end if;

  new.role := v_base_role;
  return new;
end;
$$;

-- Fires before trg_profiles_protect_* (alphabetical order), so those guards see the final role.
drop trigger if exists trg_profiles_access_profile_role on public.profiles;
drop trigger if exists trg_profiles_access_profile_role on public.profiles;
create trigger trg_profiles_access_profile_role
before insert or update on public.profiles
for each row execute function public.sync_profile_access_profile_role();

-- Same resolution as phase 21 with the access profile between the user overrides and the role.
create or replace function public.current_profile_has_permission(permission_key text, legacy_key text default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case
      when p.estado <> 'activo' then false
      when p.role::text = 'superadmin' then true
      when p.role::text = 'supervisor' and p.supervisor_eligible is not true then false
      else coalesce(
        case when u.permissions ? permission_key then (u.permissions ->> permission_key)::boolean end,
        case when legacy_key is not null and u.permissions ? legacy_key then (u.permissions ->> legacy_key)::boolean end,
        case when ap.permissions ? permission_key then (ap.permissions ->> permission_key)::boolean end,
        case when legacy_key is not null and ap.permissions ? legacy_key then (ap.permissions ->> legacy_key)::boolean end,
        case when rm.permissions ? permission_key then (rm.permissions ->> permission_key)::boolean end,
        case when legacy_key is not null and rm.permissions ? legacy_key then (rm.permissions ->> legacy_key)::boolean end,
        (
          public.default_role_has_permission(p.role::text, permission_key)
          or (
            legacy_key is not null
            and public.default_role_has_permission(p.role::text, legacy_key)
          )
        ),
        false
      )
    end
    from public.profiles p
    left join public.access_profiles ap on ap.id = p.access_profile_id and ap.estado = 'activo'
    left join public.roles_matrix rm on rm.role = p.role
    left join public.user_overrides u on u.user_id = p.id
    where p.id = auth.uid()
  ), false);
$$;

grant execute on function public.current_profile_has_permission(text, text) to authenticated;

-- Everyone reads the profile it holds; user and permission managers read the whole catalog.
drop policy if exists "access_profiles_select" on public.access_profiles;
drop policy if exists "access_profiles_select" on public.access_profiles;
create policy "access_profiles_select"
on public.access_profiles
for select
to authenticated
using (
  public.is_admin_like()
  or public.current_profile_has_permission('viewPermissions', 'managePermissions')
  or public.current_profile_has_permission('viewUsers', 'manageUsers')
  or id = (select p.access_profile_id from public.profiles p where p.id = auth.uid())
);

-- Like roles_matrix, only a superadmin defines what a profile can do.
drop policy if exists "access_profiles_write_superadmin" on public.access_profiles;
drop policy if exists "access_profiles_write_superadmin" on public.access_profiles;
create policy "access_profiles_write_superadmin"
on public.access_profiles
for all
to authenticated
using (public.is_superadmin())
with check (public.is_superadmin());

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'access_profiles'
  ) then
    alter publication supabase_realtime add table public.access_profiles;
  end if;
end;
$$;

commit;

-- >>>>>>>>>> schema_operations_phase73_audit_contract_scope.sql
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
drop trigger if exists trg_audit_logs_set_contract on public.audit_logs;
create trigger trg_audit_logs_set_contract
before insert on public.audit_logs
for each row execute function public.set_audit_log_contract();

-- Legacy entries (the release bundle wraps it in rocky_run_once).
do $once$
begin
  if public.rocky_run_once('p73_audit_contract_backfill') then
    update public.audit_logs al
    set contrato_codigo = public.audit_target_contract(al.target_type, al.target_id)
    where al.contrato_codigo is null
      and not public.audit_log_is_company_wide(al.target_type)
      and al.target_id is not null;
  end if;
end
$once$;

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

-- >>>>>>>>>> schema_operations_phase74_employee_residence_emergency.sql
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

-- >>>>>>>>>> schema_operations_phase75_whatsapp_flows.sql
-- Phase 75: WhatsApp Flows (menu Rocky y marcacion), soportes de incapacidad recibidos por Flow y
-- supervisores siempre con marcacion movil.
-- Apply after phase 74, before setting WHATSAPP_CONVERSATION_MODE=location in the backend.
begin;

-- One row per Flow message sent. Only the token hash is stored; the raw token travels in the Flow.
create table if not exists public.whatsapp_flow_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  flow text not null check (flow in ('menu', 'marcacion')),
  recipient text not null check (length(btrim(recipient)) > 0),
  employee_id uuid references public.employees(id) on delete set null,
  documento text,
  estado text not null default 'abierto' check (estado in ('abierto', 'completado')),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  completed_at timestamptz
);
create index if not exists whatsapp_flow_sessions_recipient_idx
  on public.whatsapp_flow_sessions(recipient, created_at desc);
alter table public.whatsapp_flow_sessions enable row level security;
revoke all on public.whatsapp_flow_sessions from public, anon, authenticated;

-- Every support file of an incapacity. incapacitados.soporte_* keeps the main one for the portal and reports.
create table if not exists public.incapacidad_soportes (
  id uuid primary key default gen_random_uuid(),
  incapacidad_id uuid not null references public.incapacitados(id) on delete cascade,
  tipo text not null check (tipo in ('incapacidad', 'epicrisis')),
  canal text not null default 'whatsapp_flow',
  url text not null,
  nombre text,
  mime_type text,
  storage_path text not null,
  created_at timestamptz not null default now()
);
create index if not exists incapacidad_soportes_incapacidad_idx
  on public.incapacidad_soportes(incapacidad_id, created_at);
alter table public.incapacidad_soportes enable row level security;
revoke all on public.incapacidad_soportes from public, anon, authenticated;

-- Same policy as phase 60, except that a supervisor cargo is always mobile.
create or replace function public.attendance_site_options(p_employee_id uuid, p_shift_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public
as $$
declare
  v_employee public.employees%rowtype;
  v_shift public.scheduled_shifts%rowtype;
  v_cargo text;
  v_mobile boolean := false;
  v_alignment text;
  v_zone text;
  v_contract text;
  v_sites jsonb;
  v_day text := to_char(now() at time zone 'America/Bogota', 'YYYY-MM-DD');
begin
  select * into v_employee from public.employees where id=p_employee_id;
  if not found then raise exception 'employee_inactive'; end if;
  select * into v_shift from public.scheduled_shifts where id=p_shift_id;
  if not found then raise exception 'attendance_shift_missing'; end if;
  select h.cargo_codigo into v_cargo from public.employee_cargo_history h
    where h.employee_id=p_employee_id and h.fecha_ingreso::date <= v_day::date
      and (h.fecha_retiro is null or h.fecha_retiro::date >= v_day::date)
    order by h.fecha_ingreso desc, h.created_at desc limit 1;
  select c.marcacion_movil, c.alineacion_crud into v_mobile, v_alignment
    from public.cargos c where c.codigo=coalesce(nullif(v_cargo,''),v_employee.cargo_codigo);
  v_mobile := coalesce(v_mobile,false) or coalesce(v_alignment,'')='supervisor';
  if v_mobile then
    if v_alignment='supervisor' then
      select nullif(trim(s.zona_codigo),'') into v_zone from public.supervisor_profile s where s.documento=v_employee.documento;
    end if;
    v_zone := coalesce(v_zone,nullif(trim(v_employee.zona_codigo),''));
    if v_zone is null then raise exception 'attendance_zone_missing'; end if;
    v_contract := v_shift.contrato_codigo;
    if nullif(trim(v_contract),'') is null then raise exception 'attendance_contract_missing'; end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('codigo',s.codigo,'nombre',s.nombre,
    'qr_latitude',s.qr_latitude,'qr_longitude',s.qr_longitude,'qr_radius_meters',s.qr_radius_meters,
    'qr_enabled',s.qr_enabled) order by s.nombre,s.codigo),'[]'::jsonb) into v_sites
    from public.sedes s where s.estado='activo' and
      ((not v_mobile and s.codigo=v_shift.sede_codigo)
       or (v_mobile and s.zona_codigo=v_zone and s.contrato_codigo=v_contract));
  return jsonb_build_object('mobile',v_mobile,'zone',v_zone,'sites',v_sites);
end;
$$;
revoke all on function public.attendance_site_options(uuid,uuid) from public,anon,authenticated;
grant execute on function public.attendance_site_options(uuid,uuid) to service_role;

commit;
