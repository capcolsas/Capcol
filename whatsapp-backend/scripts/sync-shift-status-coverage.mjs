// Backfill puntual: propaga a employee_shift_status la decision de servicio/nomina que
// employee_daily_status ya tiene calculada, para fechas cerradas antes de la fase 67.
// Uso: node scripts/sync-shift-status-coverage.mjs 2026-03-16 2026-03-28
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env' });

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en whatsapp-backend/.env');
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const from = String(process.argv[2] || '2026-03-16').trim();
const to = String(process.argv[3] || '2026-03-28').trim();

if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
  throw new Error('Debes enviar fechas validas en formato YYYY-MM-DD.');
}
if (from > to) {
  throw new Error('La fecha inicial no puede ser mayor que la final.');
}

function addOneDay(value) {
  const [year, month, day] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

console.log(`Sincronizando employee_shift_status desde employee_daily_status entre ${from} y ${to}...`);
let current = from;
let totalRows = 0;
while (current <= to) {
  const { data, error } = await supabase.rpc('sync_shift_status_coverage_from_daily', { p_fecha: current });
  if (error) throw error;
  const rows = data ?? 0;
  totalRows += rows;
  if (rows > 0) console.log(current, '->', rows, 'filas sincronizadas');
  current = addOneDay(current);
}
console.log('Total de filas de employee_shift_status sincronizadas:', totalRows);
