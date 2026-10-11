import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

// The backend writes daily_closures with the service role, so PostgREST rejects the whole closure
// when it sends a column the schema no longer has (pagados, dropped in phase 6, broke every daily
// closure from 2026-09-27). Compare the columns the closure upserts with the ones the phases leave.
const dir = new URL('../supabase/', import.meta.url);
const files = (await fs.readdir(dir)).filter((f) => /^schema_.*\.sql$/.test(f));
const phase = (f) => (f === 'schema_initial.sql' ? -1 : Number(f.match(/phase(\d+)/)?.[1] ?? 0));
files.sort((a, b) => phase(a) - phase(b) || a.localeCompare(b));

const columns = new Set();
for (const file of files) {
  const sql = await fs.readFile(new URL(file, dir), 'utf8');
  const create = sql.match(/create table if not exists public\.daily_closures\s*\(([\s\S]*?)\n\);/);
  if (create) create[1].split('\n').map((l) => l.trim().match(/^([a-z_]+)\s+[a-z]/)?.[1]).filter(Boolean).forEach((c) => columns.add(c));
  for (const block of sql.matchAll(/alter table public\.daily_closures([\s\S]*?);/g)) {
    for (const m of block[1].matchAll(/add column if not exists ([a-z_]+)/g)) columns.add(m[1]);
    for (const m of block[1].matchAll(/drop column if exists ([a-z_]+)/g)) columns.delete(m[1]);
  }
}
assert.ok(columns.has('fecha') && !columns.has('pagados'), 'schema columns parsed');

const app = await fs.readFile(new URL('../whatsapp-backend/src/app.js', import.meta.url), 'utf8');
const upserts = [...app.matchAll(/\.from\('daily_closures'\)\s*\.upsert\(\{([\s\S]*?)\n\s*\},\s*\{ onConflict/g)];
assert.ok(upserts.length > 0, 'found the daily_closures upsert of the closure');
for (const [, body] of upserts) {
  const keys = [...body.matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1]);
  const unknown = keys.filter((key) => !columns.has(key));
  assert.deepEqual(unknown, [], `daily_closures upsert sends columns the schema does not have: ${unknown.join(', ')}`);
}

console.log(`PASS: the daily closure writes only existing daily_closures columns (${[...columns].length} in schema).`);
