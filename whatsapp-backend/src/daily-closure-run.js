import { addIsoDays } from './shift-calendar.js';

// Process the older date first so its post-closure tasks precede the next day.
// closeDay must preserve already-closed days (as closeOperationDay does).
export async function closeDailyOperationWithPrevious(day, closeDay) {
  const previousDay = addIsoDays(day, -1);
  if (!previousDay) throw new Error('invalid_date');
  const results = [];
  for (const date of [previousDay, day]) {
    try {
      results.push(await closeDay(date));
    } catch (error) {
      // A failed recovery must not prevent attempting the scheduled date.
      results.push({ date, status: 'failed', error: error?.message || 'cron_close_failed' });
    }
  }
  const failure = results.find(result => result.status === 'failed');
  return {
    ok: !failure,
    ...results[1],
    ...(failure ? { error: failure.error } : {}),
    results
  };
}
