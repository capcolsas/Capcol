create table if not exists public.whatsapp_incoming (
  id text primary key,
  source text not null default 'whatsapp_cloud_api',
  event_type text not null default 'message',
  message_id text,
  wa_from text,
  wa_timestamp text,
  wa_type text,
  text_body text,
  phone_number_id text,
  display_phone_number text,
  raw_payload jsonb not null default '{}'::jsonb,
  process_status text not null default 'pending',
  process_reason text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create table if not exists public.whatsapp_sessions (
  id text primary key,
  phone_number text,
  employee_id uuid references public.employees(id) on delete set null,
  documento text,
  session_state text not null default 'idle',
  session_data jsonb not null default '{}'::jsonb,
  last_message_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.incapacitados (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id) on delete set null,
  documento text,
  nombre text,
  fecha_inicio date,
  fecha_fin date,
  estado text not null default 'activo',
  source text,
  whatsapp_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.whatsapp_incoming enable row level security;
alter table public.whatsapp_sessions enable row level security;
alter table public.incapacitados enable row level security;

drop trigger if exists trg_whatsapp_sessions_updated_at on public.whatsapp_sessions;
create trigger trg_whatsapp_sessions_updated_at
before update on public.whatsapp_sessions
for each row execute function public.set_updated_at();

drop trigger if exists trg_incapacitados_updated_at on public.incapacitados;
create trigger trg_incapacitados_updated_at
before update on public.incapacitados
for each row execute function public.set_updated_at();

drop policy if exists "whatsapp_incoming_service_only" on public.whatsapp_incoming;
create policy "whatsapp_incoming_service_only"
on public.whatsapp_incoming
for all
to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

drop policy if exists "whatsapp_sessions_service_only" on public.whatsapp_sessions;
create policy "whatsapp_sessions_service_only"
on public.whatsapp_sessions
for all
to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

drop policy if exists "incapacitados_read_authenticated" on public.incapacitados;
create policy "incapacitados_read_authenticated"
on public.incapacitados
for select
to authenticated
using (true);

drop policy if exists "incapacitados_write_admin" on public.incapacitados;
create policy "incapacitados_write_admin"
on public.incapacitados
for all
to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());
