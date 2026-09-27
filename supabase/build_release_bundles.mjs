// Genera los bundles SQL de supabase/releases/ a partir de las fases fuente (schema_*.sql).
//
//   node supabase/build_release_bundles.mjs           escribe supabase/releases/*.sql
//   node supabase/build_release_bundles.mjs --check   falla si los bundles estan desactualizados
//
// Las fases fuente se conservan como historial y las leen los tests; los bundles son la unica
// via documentada para instalar o actualizar un proyecto. Todo bundle es idempotente.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const RELEASES_DIR = path.join(HERE, 'releases');

// Cada bundle agrupa un rango contiguo de fases. Mantener el orden numerico es obligatorio:
// varias funciones y politicas se redefinen en fases posteriores y debe ganar la ultima.
export const BUNDLES = [
  { file: '01_base_operacion.sql', title: 'Base y operacion diaria', from: 0, to: 26 },
  { file: '02_turnos_y_rendimiento.sql', title: 'Turnos, contadores e indices', from: 27, to: 37 },
  { file: '03_multicontrato.sql', title: 'Multi-contrato', from: 38, to: 49 },
  { file: '04_rotaciones_y_modulos.sql', title: 'Rotaciones, asistencia por turno, retiros, inventario y visitas', from: 50, to: 59 },
  { file: '05_asistencia_movil_y_revision.sql', title: 'Asistencia movil, alertas, revision y descansos', from: 60, to: Infinity }
];
export const CRON_TEMPLATE_FILE = '06_cron_programador.template.sql';

// El programador lleva la URL y el secreto propios de cada proyecto: nunca entra en un bundle.
export const EXCLUDED_SOURCES = new Set([
  'schema_operations_phase28_supabase_cron.sql',
  'schema_operations_phase62_daily_closure_schedule.sql'
]);

// Solo se guarda que un respaldo de datos ya corrio. Sin RLS ni permisos: solo lo usa el migrador.
const PRELUDE = `-- Registro de respaldos de datos de una sola vez. Evita que una re-ejecucion
-- reviva filas que un administrador elimino a proposito.
create table if not exists public.rocky_data_migrations (
  id text primary key,
  applied_at timestamptz not null default now()
);
alter table public.rocky_data_migrations enable row level security;
revoke all on public.rocky_data_migrations from public, anon, authenticated;

-- Devuelve true solo la primera vez y solo si la tabla destino aun esta vacia.
-- Un proyecto que ya tiene datos queda registrado como migrado y no se toca.
create or replace function public.rocky_run_once(p_id text, p_table regclass default null)
returns boolean language plpgsql set search_path = public as $fn$
declare v_empty boolean := true;
begin
  if exists (select 1 from public.rocky_data_migrations where id = p_id) then
    return false;
  end if;
  if p_table is not null then
    execute format('select not exists (select 1 from %s)', p_table) into v_empty;
  end if;
  insert into public.rocky_data_migrations(id) values (p_id) on conflict do nothing;
  return v_empty;
end
$fn$;
revoke all on function public.rocky_run_once(text, regclass) from public, anon, authenticated;
`;

// ---------- clasificacion y orden de las fuentes ----------
export function phaseKey(file) {
  const fixed = {
    'schema_foundation_phase0.sql': [0, 0], 'schema_initial.sql': [0, 1], 'schema_catalogs_phase1.sql': [1, 0],
    'schema_whatsapp_phase4.sql': [4, 0], 'schema_constraints_phase5.sql': [5, 0], 'schema_governance_phase6.sql': [6, 0]
  };
  if (fixed[file]) return fixed[file];
  const m = file.match(/^schema_operations_phase(\d+)/);
  if (!m) throw new Error(`Fuente sin numero de fase reconocible: ${file}`);
  const n = Number(m[1]);
  let sub = 5;
  if (n === 6) sub = 1;
  if (file.includes('phase17_employee_certificates')) sub = 1;
  if (file.includes('phase17_tablet_qr_role')) sub = 2;
  if (file.includes('phase22_report_performance')) sub = 1;
  if (file.includes('phase22_supernumerarios_by_date')) sub = 2;
  return [n, sub];
}

export function listSources() {
  return fs.readdirSync(HERE)
    .filter((f) => /^schema_.*\.sql$/.test(f) && !EXCLUDED_SOURCES.has(f))
    .sort((a, b) => { const ka = phaseKey(a), kb = phaseKey(b); return ka[0] - kb[0] || ka[1] - kb[1] || a.localeCompare(b); });
}

// ---------- transformaciones ----------
const DOLLAR_BODY = /(\$([A-Za-z_]*)\$[\s\S]*?\$\2\$)/g;
// Aplica fn solo al SQL que esta fuera de cuerpos entre $$...$$ (funciones y bloques DO).
// split con 2 grupos entrega [texto, cuerpo, etiqueta, texto, cuerpo, etiqueta, ...]: la etiqueta ya
// va dentro del cuerpo, por eso se descarta (si no, se duplicaria en la salida).
function outsideBodies(sql, fn) {
  return sql.split(DOLLAR_BODY).map((part, i) => (i % 3 === 0 ? fn(part) : i % 3 === 1 ? part : '')).join('');
}

// Reemplaza exactamente una coincidencia; si el fuente cambio y ya no coincide, falla en voz alta.
function once(text, pattern, replacement, label) {
  const matches = text.match(new RegExp(pattern.source, pattern.flags.replace('g', '') + 'g'));
  if (!matches || matches.length !== 1) throw new Error(`Parche "${label}": se esperaba 1 coincidencia y hubo ${matches ? matches.length : 0}`);
  return text.replace(pattern, typeof replacement === 'string' ? () => replacement : replacement);
}

// Envuelve UNA sentencia de respaldo para que corra solo la primera vez.
function runOnce(id, table, statementRegex) {
  return (sql, label) => once(sql, statementRegex, (stmt) =>
    `do $once$\nbegin\n  if public.rocky_run_once('${id}'${table ? `, '${table}'` : ''}) then\n${stmt.replace(/^/gm, '    ')}\n  end if;\nend\n$once$;`, label);
}

const PATCHES = {
  // Historica: ya no existe la columna pagados en proyectos actualizados.
  'schema_operations_phase6.sql': [(sql, label) => once(sql,
    /update public\.daily_closures\s+set asistencias = coalesce\(nullif\(asistencias, 0\), pagados, 0\)\s+where coalesce\(asistencias, 0\) = 0;/,
    `do $legacy$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'daily_closures' and column_name = 'pagados') then
    execute 'update public.daily_closures set asistencias = coalesce(nullif(asistencias, 0), pagados, 0) where coalesce(asistencias, 0) = 0';
  end if;
end
$legacy$;`, label)],
  'schema_operations_phase16_qr_attendance.sql': [runOnce('p16_sede_device_sites_backfill', 'public.sede_device_sites',
    /insert into public\.sede_device_sites\(device_id, sede_id, sede_codigo, sede_nombre\)[^;]*?on conflict \(device_id, sede_codigo\) do nothing;/)],
  'schema_operations_phase38_contracts.sql': [runOnce('contracts_initial_seed', 'public.contracts',
    /insert into public\.contracts \([^;]*?\)\s*values \(\s*'CON-0001'[^;]*?on conflict \(codigo\) do nothing;/)],
  'schema_operations_phase45_supernumerario_contract_access.sql': [runOnce('p45_supernumerario_access_backfill', 'public.supernumerario_contract_access',
    /insert into public\.supernumerario_contract_access \([^;]*?on conflict \(employee_id, contrato_codigo\) do update[^;]*;/)],
  'schema_operations_phase48_contract_config.sql': [
    runOnce('p48_contract_cargos_backfill', 'public.contract_cargos',
      /insert into public\.contract_cargos \([^;]*?on conflict \(contrato_codigo, cargo_codigo\) do nothing;/),
    runOnce('contracts_initial_seed', 'public.contracts',
      /insert into public\.contracts \([^;]*?\)\s*values \(\s*'CON-0001'[^;]*?on conflict \(codigo\) do nothing;/)
  ],
  // El default cambia en esta fase: el ajuste 500 -> 200 solo aplica si aun rige el default anterior.
  'schema_operations_phase54_shift_attendance.sql': [(sql, label) => once(sql,
    /alter table public\.sedes alter column qr_radius_meters set default 200;\s*update public\.sedes set qr_radius_meters = 200 where qr_radius_meters = 500;/,
    `do $radius$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sedes' and column_name = 'qr_radius_meters' and column_default like '500%') then
    update public.sedes set qr_radius_meters = 200 where qr_radius_meters = 500;
  end if;
end
$radius$;
alter table public.sedes alter column qr_radius_meters set default 200;`, label)],
  // La politica se crea dentro de un bloque DO (dinamico): makeReRunnable no la alcanza.
  'schema_operations_phase58_inventory.sql': [
    (sql, label) => once(sql, /( execute format\('create policy inventory_read on public\.%I)/,
      " execute format('drop policy if exists inventory_read on public.%I',t);\n execute format('create policy inventory_read on public.%I", label)
  ]
};

// Vuelve re-ejecutable una fase escrita pensando en la primera instalacion. Se aplica a TODAS las
// fuentes: algunas solo eran re-ejecutables por accidente (p. ej. la fase 15 crea una politica sin
// eliminarla antes y solo la fase 43 la elimina mas adelante). Si el fuente ya trae el "drop ... if
// exists", el duplicado es inofensivo.
export function makeReRunnable(sql) {
  return outsideBodies(sql, (chunk) => chunk
    .replace(/\bcreate table (?!if not exists)/gi, 'create table if not exists ')
    .replace(/\bcreate (unique )?index (?!if not exists)/gi, (_, u) => `create ${u || ''}index if not exists `)
    .replace(/\bcreate function\b/gi, 'create or replace function')
    .replace(/\bcreate trigger (\w+)\s+((?:before|after)[^;]*?)\bon\s+([\w."]+)/gi,
      (m, name, mid, table) => `drop trigger if exists ${name} on ${table};\n${m}`)
    .replace(/\bcreate policy ("[^"]+"|\w+)\s+on\s+([\w."]+)/gi,
      (m, name, table) => `drop policy if exists ${name} on ${table};\n${m}`));
}

export function prepareSource(file, raw) {
  let sql = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  for (const patch of PATCHES[file] || []) sql = patch(sql, `${file}`);
  sql = makeReRunnable(sql);
  return sql.endsWith('\n') ? sql : sql + '\n';
}

// ---------- plantilla de cron ----------
const CRON_TEMPLATE = `-- ============================================================
-- Rocky | 06 Programador de cierres (Supabase Cron)  -- OPCIONAL, UNA VEZ POR PROYECTO
-- Generado por supabase/build_release_bundles.mjs. Editar la plantilla en el generador.
--
-- NO forma parte de la actualizacion 01..05: contiene la URL y el secreto del backend de cada
-- proyecto. Ejecutalo solo al activar el cierre automatico o cuando cambien URL o secreto.
-- Nunca guardes el secreto real en el repositorio: reemplaza los dos valores en el editor SQL.
-- Requiere haber ejecutado antes los bundles 01..05 y haber desplegado el backend.
-- ============================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare
  backend_base_url text := 'https://TU_BACKEND.vercel.app';
  cron_secret text := 'TU_CRON_SECRET';
  close_shifts_url text;
  close_daily_url text;
begin
  if backend_base_url = 'https://TU_BACKEND.vercel.app' or cron_secret = 'TU_CRON_SECRET' then
    raise exception 'Reemplaza backend_base_url y cron_secret antes de ejecutar este script.';
  end if;

  backend_base_url := regexp_replace(trim(backend_base_url), '/+$', '');
  close_shifts_url := backend_base_url || '/api/cron/close-shifts';
  close_daily_url := backend_base_url || '/api/cron/close-daily-operation';

  begin perform cron.unschedule('rocky_close_shifts_every_15_minutes'); exception when others then null; end;
  begin perform cron.unschedule('rocky_close_daily_operation_legacy'); exception when others then null; end;

  perform cron.schedule(
    'rocky_close_shifts_every_15_minutes',
    '*/15 * * * *',
    format($cron$
      select net.http_get(
        url := %L,
        headers := jsonb_build_object('Authorization', 'Bearer ' || %L),
        timeout_milliseconds := 25000
      ) as request_id;
    $cron$, close_shifts_url, cron_secret)
  );

  -- Cierre diario a las 02:10 America/Bogota (07:10 UTC), franja de baja actividad de marcaciones.
  perform cron.schedule(
    'rocky_close_daily_operation_legacy',
    '10 7 * * *',
    format($cron$
      select net.http_get(
        url := %L,
        headers := jsonb_build_object('Authorization', 'Bearer ' || %L),
        timeout_milliseconds := 25000
      ) as request_id;
    $cron$, close_daily_url, cron_secret)
  );
end $$;

-- Verificacion sin exponer el comando ni sus credenciales:
select jobid, jobname, schedule, active
from cron.job
where jobname in ('rocky_close_shifts_every_15_minutes', 'rocky_close_daily_operation_legacy')
order by jobname;
`;

// ---------- armado ----------
export function buildBundles() {
  const sources = listSources();
  const assigned = new Set();
  const out = BUNDLES.map((bundle, index) => {
    const files = sources.filter((f) => { const n = phaseKey(f)[0]; return n >= bundle.from && n <= bundle.to; });
    files.forEach((f) => assigned.add(f));
    const num = String(index + 1).padStart(2, '0');
    const header = `-- ============================================================
-- Rocky | ${num} ${bundle.title}
-- Generado por supabase/build_release_bundles.mjs. NO editar a mano.
--
-- Idempotente: sirve para un proyecto nuevo y para actualizar uno existente.
-- Ejecutar en orden 01 -> 05 en el editor SQL de Supabase (o con psql).
-- Fuentes incluidas (${files.length}):
${files.map((f) => `--   ${f}`).join('\n')}
-- ============================================================
`;
    const body = files.map((f) => `\n-- >>>>>>>>>> ${f}\n${prepareSource(f, fs.readFileSync(path.join(HERE, f), 'utf8'))}`).join('');
    return { file: bundle.file, sources: files, content: header + (index === 0 ? `\n${PRELUDE}` : '') + body };
  });
  const orphans = sources.filter((f) => !assigned.has(f));
  if (orphans.length) throw new Error(`Fuentes sin bundle: ${orphans.join(', ')}`);
  out.push({ file: CRON_TEMPLATE_FILE, sources: [], content: CRON_TEMPLATE });
  return out;
}

function main() {
  const bundles = buildBundles();
  const check = process.argv.includes('--check');
  if (!check) fs.mkdirSync(RELEASES_DIR, { recursive: true });
  const stale = [];
  for (const b of bundles) {
    const target = path.join(RELEASES_DIR, b.file);
    if (check) {
      if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== b.content) stale.push(b.file);
    } else {
      fs.writeFileSync(target, b.content);
      console.log(`${b.file.padEnd(40)} ${String(Math.round(b.content.length / 1024)).padStart(4)} KB  ${b.sources.length} fuentes`);
    }
  }
  if (check) {
    if (stale.length) { console.error(`Bundles desactualizados: ${stale.join(', ')}\nEjecuta: node supabase/build_release_bundles.mjs`); process.exit(1); }
    console.log('Bundles al dia.');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
