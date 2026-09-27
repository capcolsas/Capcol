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
