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
