import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const source = await fs.readFile(new URL('../src/assets/js/services/supabase/visits.js', import.meta.url), 'utf8');
let calls = [], fail = null;
globalThis.visitTestClient = {
  rpc(name) { return execute(name); },
  from(table) {
    const query = { select() { return query; }, eq() { return query; }, order() { return query; }, in() { return query; },
      range() { return execute(table); }, maybeSingle() { return execute(table); } };
    return query;
  }
};
function execute(stage) {
  calls.push(stage);
  const error = fail?.(stage, calls.filter(call => call === stage).length);
  if (error) return Promise.resolve(error);
  return Promise.resolve({ data: stage === 'visit_settings' ? { starts_on: '2026-09-14' } : [], error: null, status: 200 });
}
const { loadVisits, saveVisitSettings } = await import('data:text/javascript;base64,' + Buffer.from(source.replace("import { supabase } from './client.js';", 'const supabase = globalThis.visitTestClient;')).toString('base64'));
const network = { error: { message: 'TypeError: Failed to fetch', code: '' }, status: 0 };
fail = (stage, count) => stage === 'visit_sync_cycles' && count === 1 ? network : null;
assert.equal((await loadVisits('A')).settings.starts_on, '2026-09-14');
assert.equal(calls.filter(stage => stage === 'visit_sync_cycles').length, 2);
calls = []; fail = (stage, count) => stage === 'visit_cycles' && count < 3 ? network : null;
await loadVisits('A', { sync: false });
assert.ok(!calls.includes('visit_sync_cycles'), 'After save, skip redundant synchronization');
assert.equal(calls.filter(stage => stage === 'visit_cycles').length, 3);
calls = []; fail = stage => stage === 'visit_settings' ? network : null;
await assert.rejects(loadVisits('A', { sync: false }), /consultar la programación/);
assert.equal(calls.filter(stage => stage === 'visit_settings').length, 3, 'Retries are bounded');
calls = []; fail = stage => stage === 'visit_cycles' ? {error:{message:'permission denied',code:'42501'},status:403} : null;
await assert.rejects(loadVisits('A', { sync: false }), /consultar los ciclos: permission denied/);
assert.equal(calls.length, 1, 'Do not retry permission errors');
calls = []; fail = () => network;
await assert.rejects(saveVisitSettings('A', {frequency:'weekly',starts_on:'2026-09-14',radius_m:200,accuracy_m:100}), /Failed to fetch/);
assert.deepEqual(calls,['visit_save_settings'], 'Do not automatically repeat writes');
delete globalThis.visitTestClient;
console.log('PASS: transient read recovery, bounded retries, stage-specific errors, no duplicate sync after save and no automatic write retry.');
