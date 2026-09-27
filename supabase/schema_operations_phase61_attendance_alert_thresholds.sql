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
