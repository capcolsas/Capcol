-- Phase 34: optimize flexible searches used by WhatsApp flows.

create extension if not exists pg_trgm;

create index if not exists idx_employees_phone_last10
  on public.employees ((right(regexp_replace(coalesce(telefono, ''), '\D', '', 'g'), 10)))
  where telefono is not null and telefono <> '';

create index if not exists idx_sedes_nombre_trgm
  on public.sedes using gin (lower(coalesce(nombre, '')) gin_trgm_ops);

create or replace function public.find_employee_candidates_by_phone(
  p_phone text,
  p_limit integer default 20
)
returns setof public.employees
language sql
stable
security definer
set search_path = public
as $$
  with normalized as (
    select
      case
        when length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) >= 10
          then right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10)
        else ''
      end as last10,
      least(greatest(coalesce(p_limit, 20), 1), 50) as max_rows
  )
  select e.*
  from public.employees e
  cross join normalized n
  where n.last10 <> ''
    and right(regexp_replace(coalesce(e.telefono, ''), '\D', '', 'g'), 10) = n.last10
  order by
    case lower(trim(coalesce(e.estado, 'activo')))
      when 'activo' then 0
      when 'inactivo' then 1
      else 2
    end,
    e.created_at desc nulls last
  limit (select max_rows from normalized);
$$;

grant execute on function public.find_employee_candidates_by_phone(text, integer) to authenticated, service_role;

create or replace function public.search_active_sedes(
  p_keyword text,
  p_limit integer default 10
)
returns table (
  id uuid,
  codigo text,
  nombre text,
  zona_codigo text,
  zona_nombre text
)
language sql
stable
security definer
set search_path = public
as $$
  with params as (
    select
      lower(trim(coalesce(p_keyword, ''))) as keyword,
      least(greatest(coalesce(p_limit, 10), 1), 50) as max_rows
  )
  select s.id, s.codigo, s.nombre, s.zona_codigo, s.zona_nombre
  from public.sedes s
  cross join params p
  where s.estado = 'activo'
    and (
      p.keyword = ''
      or lower(coalesce(s.codigo, '')) = p.keyword
      or lower(coalesce(s.nombre, '')) like ('%' || p.keyword || '%')
    )
  order by
    case
      when p.keyword = '' then 0
      when lower(coalesce(s.codigo, '')) = p.keyword then 0
      when lower(coalesce(s.nombre, '')) = p.keyword then 1
      else 2
    end,
    case
      when p.keyword = '' then 0
      else similarity(lower(coalesce(s.nombre, '')), p.keyword)
    end desc,
    s.nombre asc
  limit (select max_rows from params);
$$;

grant execute on function public.search_active_sedes(text, integer) to authenticated, service_role;
