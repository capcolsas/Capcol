import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pendingShiftReviewItems, shiftReviewTone, shiftReviewDecisionLabel } from '../src/assets/js/utils/shiftReview.js';

const db = new PGlite();
try {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql as $$ select '00000000-0000-0000-0000-000000000001'::uuid $$;
    create function auth.jwt() returns jsonb language sql as $$ select '{"email":"reviewer@example.test"}'::jsonb $$;
    create function current_profile_has_permission(text,text) returns boolean language sql as $$ select true $$;
    create function can_read_contract_data(text) returns boolean language sql as $$ select $1 = 'C' $$;
    create table scheduled_shifts(id uuid primary key, starts_at timestamptz, ends_at timestamptz);
    insert into scheduled_shifts(id) values ('00000000-0000-0000-0000-000000000010');
    create table employee_shift_status (
      id text primary key, scheduled_shift_id uuid, employee_id uuid, documento text, contrato_codigo text default 'C',
      estado_turno text default 'trabajado', requires_review boolean default true,
      entrada_at timestamptz, salida_at timestamptz,
      early_entry_minutes integer default 0, late_entry_minutes integer default 0,
      early_exit_minutes integer default 0, late_exit_minutes integer default 0,
      early_entry_reason text, late_entry_reason text, early_exit_reason text, late_exit_reason text,
      entry_authorization_id uuid, exit_authorization_id uuid, timing_alerts jsonb default '{}',
      updated_at timestamptz default now()
    );
    create table shift_time_authorizations (
      id uuid primary key default gen_random_uuid(), scheduled_shift_id uuid, employee_id uuid, documento text,
      authorization_type text check (authorization_type in ('early_entry','late_exit','extra_shift','extended_shift')),
      minutes_authorized integer check (minutes_authorized>=0), authorized_from timestamptz, authorized_until timestamptz, reason text, estado text,
      requested_by_uid uuid, requested_by_email text, approved_by_uid uuid, approved_by_email text, approved_at timestamptz
    );
    create table shift_adjustments (
      scheduled_shift_id uuid, employee_id uuid, documento text, tipo text, estado text,
      before_snapshot jsonb, after_snapshot jsonb, motivo text, approved_by_uid uuid, approved_by_email text, approved_at timestamptz
    );
    create table audit_logs(actor_uid uuid,actor_email text,target_type text,target_id text,action text,before_data jsonb,after_data jsonb,note text);
  `);
  const sql = await fs.readFile(new URL('../supabase/schema_operations_phase63_shift_review_decisions.sql', import.meta.url), 'utf8');
  await db.exec(sql);
  await db.exec(sql); // Safe to apply twice.
  await db.exec(`insert into employee_shift_status(id,scheduled_shift_id,estado_turno,late_entry_minutes,late_exit_minutes)
    values('A','00000000-0000-0000-0000-000000000010','trabajado_tardio',15,30)`);
  const row = async () => (await db.query("select *,updated_at::text as version from employee_shift_status where id='A'")).rows[0];
  const decide = async (key,effect,minutes,reason='Decision de prueba',version) => db.query(
    'select resolve_shift_review_decision($1,$2,$3,$4,$5,$6::timestamptz) as result',
    ['A',key,effect,minutes,reason,version ?? (await row()).version]);
  await assert.rejects(decide('entrada_tardia','addition',15), /no corresponde/);
  await assert.rejects(decide('entrada_tardia','deduction',0), /minutos validos/);
  await assert.rejects(decide('entrada_tardia','none',10), /minutos validos/);
  await assert.rejects(decide('entrada_tardia','deduction',15,' '), /minutos validos/);
  const oldVersion = (await row()).version;
  await decide('entrada_tardia','deduction',12);
  let current = await row();
  assert.equal(current.requires_review,true);
  assert.equal(current.late_entry_minutes,15, 'markings and measured minutes stay intact');
  assert.equal(current.review_decisions.entrada_tardia.signedMinutes,-12);
  assert.equal((await db.query('select count(*)::int as n from shift_time_authorizations')).rows[0].n,0);
  await assert.rejects(decide('salida_tardia','addition',30,'Otra decision',oldVersion), /registro cambio/);
  await assert.rejects(decide('entrada_tardia','deduction',12), /ya fue gestionada/);
  const ui = {estadoTurno:current.estado_turno, requiresReview:current.requires_review,
    lateEntryMinutes:15,lateExitMinutes:30,reviewDecisions:current.review_decisions};
  assert.deepEqual(pendingShiftReviewItems(ui).map(x=>x.key),['salida_tardia']);
  assert.equal(shiftReviewTone(ui,'Llegada tarde'),'');
  assert.equal(shiftReviewTone(ui,'Salida tardia'),'orange');
  assert.equal(shiftReviewDecisionLabel(current.review_decisions.entrada_tardia),'Descuento autorizado');
  // Simulate a failure after the authorization and status write: all must roll back.
  await db.exec(`create function fail_adjustment() returns trigger language plpgsql as $$ begin raise exception 'test_failure'; end $$;
    create trigger fail_adjustment before insert on shift_adjustments for each row execute function fail_adjustment()`);
  await assert.rejects(decide('salida_tardia','addition',25), /test_failure/);
  assert.equal((await row()).review_decisions.salida_tardia,undefined);
  assert.equal((await db.query('select count(*)::int as n from shift_time_authorizations')).rows[0].n,0);
  await db.exec('drop trigger fail_adjustment on shift_adjustments');
  await decide('salida_tardia','addition',25);
  current = await row();
  assert.equal(current.estado_turno,'ajustado');
  assert.equal(current.requires_review,false);
  assert.equal(current.review_decisions.salida_tardia.signedMinutes,25);
  assert.equal((await db.query('select minutes_authorized from shift_time_authorizations')).rows[0].minutes_authorized,25);
  // New exit clears only exit decisions, retaining the already reviewed entry.
  await db.exec("update employee_shift_status set salida_at='2026-09-25T22:00:00Z',late_exit_minutes=40 where id='A'");
  assert.equal((await row()).exit_authorization_id,null);
  assert.equal((await row()).review_decisions.salida_tardia,undefined);
  assert.equal((await row()).review_decisions.entrada_tardia.effect,'deduction');
  await decide('salida_tardia','none',0);
  assert.equal((await row()).review_decisions.salida_tardia.signedMinutes,0);
  assert.equal((await db.query('select count(*)::int as n from shift_time_authorizations')).rows[0].n,1,'no-adjustment creates no time authorization');
  await db.exec("update employee_shift_status set contrato_codigo='OTHER' where id='A'");
  await assert.rejects(decide('salida_tardia','none',0), /tu contrato/);
  await db.exec("create or replace function current_profile_has_permission(text,text) returns boolean language sql as $$ select false $$");
  await assert.rejects(decide('salida_tardia','none',0), /permiso/);
  console.log('Shift decisions: atomic saves, additions, deductions, no adjustment, partial review, duplicate/stale protection, new markings, contract and permission checks passed.');
} finally { await db.close(); }
