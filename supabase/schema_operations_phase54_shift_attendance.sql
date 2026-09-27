-- Apply after phase 53, before deploying the new backend.
begin;
alter table public.sedes alter column qr_radius_meters set default 200;
update public.sedes set qr_radius_meters = 200 where qr_radius_meters = 500;

-- Keep legacy daily records unique, while allowing separate worked shifts.
drop index if exists public.attendance_unique_fecha_documento;
create unique index if not exists attendance_unique_fecha_documento
  on public.attendance(fecha, documento) where documento is not null and turno_id is null;
create unique index if not exists attendance_unique_turno_documento
  on public.attendance(turno_id, documento) where turno_id is not null and documento is not null;
drop index if exists public.employee_daily_exits_unique_fecha_documento;
create unique index if not exists employee_daily_exits_unique_fecha_documento
  on public.employee_daily_exits(fecha, documento) where documento is not null and turno_id is null;
create unique index if not exists employee_daily_exits_unique_turno_documento
  on public.employee_daily_exits(turno_id, documento) where turno_id is not null and documento is not null;

-- Evidence belongs to the marking, independently of QR tokens. No historical backfill.
alter table public.attendance
  add column if not exists marking_method text,
  add column if not exists request_latitude double precision,
  add column if not exists request_longitude double precision,
  add column if not exists request_distance_meters integer,
  add column if not exists location_verified_at timestamptz,
  add column if not exists phone_number text;
alter table public.employee_daily_exits
  add column if not exists marking_method text,
  add column if not exists request_latitude double precision,
  add column if not exists request_longitude double precision,
  add column if not exists request_distance_meters integer,
  add column if not exists location_verified_at timestamptz,
  add column if not exists phone_number text;

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
begin
  if v_action is null or v_action not in ('entry','exit') or v_method is null or v_method not in ('qr','location') then
    raise exception 'invalid_marking';
  end if;
  -- Same lock order as shift closure: lock the shift before employee status.
  select * into v_shift from public.scheduled_shifts where id = v_shift_id for update;
  if not found or v_shift.estado = 'cancelado' then raise exception 'attendance_shift_missing'; end if;
  select * into v_employee from public.employees where id = v_emp for share;
  if not found or lower(v_employee.estado) <> 'activo' then raise exception 'employee_inactive'; end if;
  select * into v_site from public.sedes where codigo = v_shift.sede_codigo for share;
  if not found or lower(v_site.estado) <> 'activo' then raise exception 'attendance_shift_missing'; end if;
  if p_event->>'sede_codigo' is distinct from v_shift.sede_codigo then raise exception 'sede_mismatch'; end if;
  if v_method = 'qr' then
    if not v_site.qr_enabled then raise exception 'qr_disabled'; end if;
    select * into v_token from public.attendance_qr_tokens where id = v_token_id for update;
    if not found then raise exception 'qr_not_found'; end if;
    if v_token.used_at is not null then raise exception 'qr_used'; end if;
    if v_token.expires_at <= v_at then raise exception 'qr_expired'; end if;
    if v_token.turno_id is distinct from v_shift_id or v_token.employee_id is distinct from v_emp
      or v_token.action is distinct from v_action or v_token.sede_codigo is distinct from v_shift.sede_codigo then
      raise exception 'sede_mismatch';
    end if;
    if not exists(select 1 from public.sede_devices d where d.id = v_device_id and d.estado = 'activo' and d.revoked_at is null
      and (d.sede_codigo = v_shift.sede_codigo or exists(select 1 from public.sede_device_sites ds where ds.device_id = d.id and ds.sede_codigo = v_shift.sede_codigo))) then
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
      p_event->>'contrato_codigo', p_event->>'contrato_nombre', p_event->>'cliente_nombre_snapshot', p_event->>'cliente_nit_snapshot');
    v_state := case when v_class = 'entrada_tardia' then 'trabajado_tardio' else 'trabajado' end;
    insert into public.employee_shift_status(id, scheduled_shift_id, fecha_operativa, employee_id, documento,
      nombre, sede_codigo, estado_turno, asistio, entrada_at, source_attendance_id, novedad_codigo, novedad_nombre,
      early_entry_minutes, late_entry_minutes, requires_review,
      contrato_codigo, contrato_nombre, cliente_nombre_snapshot, cliente_nit_snapshot)
    values(coalesce(v_status.id, v_record_id), v_shift_id, v_shift.fecha_operativa, v_emp, v_employee.documento,
      v_employee.nombre, v_shift.sede_codigo, v_state, true, v_at, v_record_id, '1', 'Trabajando',
      case when v_class = 'entrada_anticipada' then v_minutes else 0 end,
      case when v_class = 'entrada_tardia' then v_minutes else 0 end, v_review,
      p_event->>'contrato_codigo', p_event->>'contrato_nombre', p_event->>'cliente_nombre_snapshot', p_event->>'cliente_nit_snapshot')
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
      p_event->>'contrato_codigo', p_event->>'contrato_nombre', p_event->>'cliente_nombre_snapshot', p_event->>'cliente_nit_snapshot');
    update public.employee_shift_status set salida_at = v_at, source_exit_id = v_record_id,
      early_exit_minutes = case when v_class = 'salida_anticipada' then v_minutes else 0 end,
      late_exit_minutes = case when v_class = 'salida_tardia' then v_minutes else 0 end,
      requires_review = requires_review or v_review or v_shift.estado = 'cerrado',
      estado_turno = case when v_shift.estado = 'cerrado' then 'post_cierre_pendiente'
        when v_class = 'salida_anticipada' then 'retiro_anticipado'
        when late_entry_minutes > 0 then 'trabajado_tardio' else 'trabajado' end
    where id = v_status.id;
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

-- Serialize closure with marking so a stale snapshot cannot erase a real exit.
create or replace function public.finalize_shift_attendance(p_shift_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_rows jsonb;
begin
  perform 1 from public.scheduled_shifts where id = p_shift_id and estado <> 'cancelado' for update;
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
  select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) into v_rows
    from public.employee_shift_status s where scheduled_shift_id = p_shift_id;
  return v_rows;
end;
$$;
revoke all on function public.finalize_shift_attendance(uuid) from public, anon, authenticated;
grant execute on function public.finalize_shift_attendance(uuid) to service_role;
commit;
