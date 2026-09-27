import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closeDailyOperationWithPrevious } from '../whatsapp-backend/src/daily-closure-run.js';

test('recovers the previous date first and preserves already closed dates on retries', async () => {
  const closed = new Set();
  const writes = [];
  const closeDay = async date => {
    if (closed.has(date)) return { date, status: 'already_closed' };
    writes.push(date);
    closed.add(date);
    return { date, status: 'closed' };
  };
  const first = await closeDailyOperationWithPrevious('2026-10-01', closeDay);
  assert.equal(first.ok, true);
  assert.equal(first.date, '2026-10-01');
  assert.deepEqual(writes, ['2026-09-30', '2026-10-01']);
  const retry = await closeDailyOperationWithPrevious('2026-10-01', closeDay);
  assert.equal(retry.ok, true);
  assert.deepEqual(retry.results.map(row => row.status), ['already_closed', 'already_closed']);
  assert.equal(writes.length, 2);
});

test('a failed recovery still allows the scheduled closure and reports partial failure', async () => {
  const calls = [];
  const result = await closeDailyOperationWithPrevious('2026-09-25', async date => {
    calls.push(date);
    if (date === '2026-09-24') throw new Error('Gateway Timeout');
    return { date, status: 'closed' };
  });
  assert.deepEqual(calls, ['2026-09-24', '2026-09-25']);
  assert.equal(result.ok, false);
  assert.equal(result.status, 'closed');
  assert.equal(result.error, 'Gateway Timeout');
  assert.equal(result.results[0].status, 'failed');
});

test('a failure of the scheduled date is reported after a successful recovery', async () => {
  const result = await closeDailyOperationWithPrevious('2027-01-01', async date => {
    if (date === '2027-01-01') throw new Error('closure_failed');
    return { date, status: 'closed' };
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'failed');
  assert.equal(result.results[0].date, '2026-12-31');
  assert.equal(result.results[0].status, 'closed');
});

test('an already closed previous date does not prevent closing the scheduled date', async () => {
  const result = await closeDailyOperationWithPrevious('2026-09-25', async date => ({
    date, status: date === '2026-09-24' ? 'already_closed' : 'closed'
  }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.results.map(row => row.status), ['already_closed', 'closed']);
});
