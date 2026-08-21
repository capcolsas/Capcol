create table if not exists public.catalog_code_counters (
  scope text not null,
  prefix text not null,
  last_value integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (scope, prefix)
);

alter table public.catalog_code_counters enable row level security;

create or replace function public.reserve_prefixed_codes(
  p_scope text,
  p_prefix text,
  p_count integer default 1,
  p_width integer default 4
)
returns table(code text, value integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scope text := lower(trim(coalesce(p_scope, '')));
  v_prefix text := upper(trim(coalesce(p_prefix, '')));
  v_count integer := greatest(1, coalesce(p_count, 1));
  v_width integer := greatest(1, coalesce(p_width, 4));
  v_table text;
  v_last integer := 0;
  v_existing_max integer := 0;
  v_start integer;
  v_end integer;
  v_capture_regex text;
  v_match_regex text;
begin
  if v_count > 10000 then
    raise exception 'No se pueden reservar mas de 10000 codigos por solicitud.';
  end if;

  if v_prefix !~ '^[A-Z0-9]+$' then
    raise exception 'Prefijo invalido para consecutivo: %', p_prefix;
  end if;

  v_table := case v_scope
    when 'zones' then 'zones'
    when 'dependencies' then 'dependencies'
    when 'sedes' then 'sedes'
    when 'cargos' then 'cargos'
    when 'novedades' then 'novedades'
    when 'employees' then 'employees'
    else null
  end;

  if v_table is null then
    raise exception 'Alcance invalido para consecutivo: %', p_scope;
  end if;

  insert into public.catalog_code_counters(scope, prefix, last_value)
  values (v_scope, v_prefix, 0)
  on conflict (scope, prefix) do nothing;

  select c.last_value
  into v_last
  from public.catalog_code_counters c
  where c.scope = v_scope
    and c.prefix = v_prefix
  for update;

  v_capture_regex := '^' || v_prefix || '-([0-9]+)$';
  v_match_regex := '^' || v_prefix || '-[0-9]+$';

  execute format(
    'select coalesce(max(substring(codigo from %L)::integer), 0) from public.%I where codigo ~ %L',
    v_capture_regex,
    v_table,
    v_match_regex
  )
  into v_existing_max;

  v_start := greatest(coalesce(v_last, 0), coalesce(v_existing_max, 0)) + 1;
  v_end := v_start + v_count - 1;

  update public.catalog_code_counters
  set last_value = v_end,
      updated_at = now()
  where scope = v_scope
    and prefix = v_prefix;

  return query
  select
    v_prefix || '-' || lpad(gs::text, v_width, '0') as code,
    gs::integer as value
  from generate_series(v_start, v_end) as gs;
end;
$$;

create or replace function public.next_prefixed_code(
  p_scope text,
  p_prefix text,
  p_width integer default 4
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  select r.code
  into v_code
  from public.reserve_prefixed_codes(p_scope, p_prefix, 1, p_width) r
  limit 1;

  return v_code;
end;
$$;

grant execute on function public.reserve_prefixed_codes(text, text, integer, integer) to authenticated;
grant execute on function public.next_prefixed_code(text, text, integer) to authenticated;

comment on table public.catalog_code_counters is 'Consecutivos seguros para codigos visibles de catalogos y empleados.';
comment on function public.reserve_prefixed_codes(text, text, integer, integer) is 'Reserva un bloque de codigos con formato PREFIX-0001 sin descargar toda la tabla al cliente.';
comment on function public.next_prefixed_code(text, text, integer) is 'Reserva y retorna un unico codigo con formato PREFIX-0001.';
