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
