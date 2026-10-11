-- ============================================================
-- Rocky | Limpiar la operacion y conservar los datos administrativos
--
-- Uso: Supabase > SQL Editor. Ejecuta primero el PASO 1 (solo lectura) y revisa la lista.
-- Si es correcta, ejecuta el PASO 2. No se puede deshacer: haz un respaldo antes
-- (Supabase > Database > Backups) si necesitas conservar el historico.
--
-- SE CONSERVA (lista blanca): accesos, estructura de contratos, sedes, empleados y equipos.
-- SE BORRA: todo lo demas en public -> asistencia, novedades del dia, ausentismo, reemplazos,
--   cierres y metricas, turnos (planes, reglas, generados, asignaciones, estados, cierres,
--   ajustes, autorizaciones), rotaciones, incapacidades, inventario, visitas, auditoria,
--   portal del empleado (sesiones y auditoria), certificados, QR, WhatsApp.
--
-- NO se toca: auth.users (inicios de sesion), Storage (fotos y archivos), ni el programador
-- de cierres (cron): la operacion se cierra automaticamente desde hoy.
-- ============================================================

-- ------------------------------------------------------------
-- PASO 1 (solo lectura): tablas que se van a vaciar y cuantas filas tienen.
-- ------------------------------------------------------------
with keep(tablename) as (
  values
    -- Accesos
    ('profiles'), ('roles_matrix'), ('user_overrides'), ('access_profiles'), ('profile_contract_access'),
    -- Estructura administrativa
    ('contracts'), ('contract_cargos'), ('zones'), ('dependencies'), ('sedes'), ('cargos'), ('novedades'),
    -- Personal
    ('employees'), ('employee_cargo_history'), ('employee_retirements'),
    ('supernumerario_contract_access'), ('supervisor_profile'),
    -- Equipos QR
    ('sede_devices'), ('sede_device_sites'),
    -- Control interno
    ('catalog_code_counters'), ('rocky_data_migrations')
)
select
  t.tablename as tabla,
  case when k.tablename is null then 'SE VACIA' else 'se conserva' end as accion,
  s.n_live_tup as filas_aprox
from pg_tables t
left join keep k on k.tablename = t.tablename
left join pg_stat_user_tables s on s.schemaname = t.schemaname and s.relname = t.tablename
where t.schemaname = 'public'
order by accion desc, t.tablename;

-- ------------------------------------------------------------
-- PASO 2: limpiar. Todo o nada: si algo falla, no se borra nada.
-- ------------------------------------------------------------
begin;

do $$
declare
  keep text[] := array[
    'profiles', 'roles_matrix', 'user_overrides', 'access_profiles', 'profile_contract_access',
    'contracts', 'contract_cargos', 'zones', 'dependencies', 'sedes', 'cargos', 'novedades',
    'employees', 'employee_cargo_history', 'employee_retirements',
    'supernumerario_contract_access', 'supervisor_profile',
    'sede_devices', 'sede_device_sites',
    'catalog_code_counters'
  ];
  -- Only exists in projects installed with the release bundles; kept when present.
  keep_if_present text[] := array['rocky_data_migrations'];
  missing text;
  table_list text;
begin
  -- Guard: every kept table must exist, or the list is out of date and nothing is touched.
  select string_agg(k, ', ') into missing
  from unnest(keep) as k
  where to_regclass('public.' || k) is null;
  if missing is not null then
    raise exception 'Tablas a conservar que no existen (revisa la lista): %', missing;
  end if;

  select string_agg(format('public.%I', tablename), ', ' order by tablename)
  into table_list
  from pg_tables
  where schemaname = 'public'
    and tablename <> all(keep || keep_if_present);

  -- Without CASCADE: if a kept table referenced an emptied one, TRUNCATE fails and the whole
  -- transaction rolls back instead of silently emptying the kept table.
  if table_list is not null then
    execute 'truncate table ' || table_list || ' restart identity';
  end if;
end;
$$;

commit;

-- ------------------------------------------------------------
-- Verificacion: las tablas operativas deben quedar en 0.
-- ------------------------------------------------------------
select relname as tabla, n_live_tup as filas_aprox
from pg_stat_user_tables
where schemaname = 'public'
order by relname;
