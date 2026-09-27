import { supabase } from './client.js';

async function result(query) {
  const { data, error, status } = await query;
  if (error) throw Object.assign(new Error(error.message), { code: error.code, status });
  return data;
}
async function read(makeQuery, stage) {
  for (let attempt = 0; ; attempt++) {
    try { return await result(makeQuery()); }
    catch (error) {
      const network = /failed to fetch|fetch failed|networkerror|network request failed|load failed/i.test(error.message);
      const temporary = network || [502, 503, 504].includes(error.status);
      if (temporary && attempt < 2) {
        await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
        continue;
      }
      throw new Error(network
        ? `No se pudo conectar con el servidor al ${stage}. Revisa tu conexión y vuelve a intentar.`
        : `No se pudo ${stage}: ${error.message}`);
    }
  }
}
async function allRows(table, filter) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const labels = { visit_cycles: 'consultar los ciclos', visit_assignments: 'consultar las sedes asignadas', site_visits: 'consultar las visitas registradas' };
    const page = await read(() => filter(supabase.from(table).select('*')).order('id').range(offset, offset + 499), labels[table]);
    rows.push(...page);
    if (page.length < 500) return rows;
  }
}
async function relatedRows(table, column, ids) {
  const rows = [];
  for (let index = 0; index < ids.length; index += 100) {
    rows.push(...await allRows(table, query => query.in(column, ids.slice(index, index + 100))));
  }
  return rows;
}
export async function loadVisits(contract = null, { sync = true } = {}) {
  // Saving settings already synchronizes cycles in the same database transaction.
  if (sync) await read(() => supabase.rpc('visit_sync_cycles'), 'actualizar los ciclos');
  const cycles = await allRows('visit_cycles', query => contract ? query.eq('contrato_codigo', contract) : query);
  const assignments = await relatedRows('visit_assignments', 'cycle_id', cycles.map(row => row.id));
  const visits = await relatedRows('site_visits', 'assignment_id', assignments.map(row => row.id));
  const settings = contract ? await read(() => supabase.from('visit_settings').select('*').eq('contrato_codigo', contract).maybeSingle(), 'consultar la programación') : null;
  return { cycles, assignments, visits, settings };
}
export function saveVisitSettings(contract, data) {
  return result(supabase.rpc('visit_save_settings', { p_contract: contract, p_frequency: data.frequency, p_start: data.starts_on, p_radius: data.radius_m, p_accuracy: data.accuracy_m }));
}
export function beginVisit(id, assignment, gps) {
  return result(supabase.rpc('visit_begin', { p_id: id, p_assignment: assignment, p_lat: gps.latitude, p_lng: gps.longitude, p_accuracy: gps.accuracy }));
}
export async function uploadVisitPhoto(visitId, file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024 || !file.size) {
    throw new Error('Cada foto debe ser JPG, PNG o WebP de hasta 8 MB.');
  }
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error('Tu sesión venció.');
  const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type];
  const path = `${data.user.id}/${visitId}/${crypto.randomUUID()}.${extension}`;
  await result(supabase.storage.from('visit-evidence').upload(path, file, { contentType: file.type, upsert: false }));
  return path;
}
export function submitVisit(id, data) {
  return result(supabase.rpc('visit_submit', { p_id: id, p_findings: data.has_findings, p_description: data.findings,
    p_recommendations: data.recommendations, p_observations: data.observations, p_photos: data.photos }));
}
export function reviewVisit(id, accept, note) {
  return result(supabase.rpc('visit_review', { p_id: id, p_accept: accept, p_note: note }));
}
export async function getVisitPhotoUrl(path) {
  return (await result(supabase.storage.from('visit-evidence').createSignedUrl(path, 600))).signedUrl;
}
