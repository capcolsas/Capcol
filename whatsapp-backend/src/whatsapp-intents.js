// Inbound intents of the location-first WhatsApp conversation. Kept free of I/O so the rules that
// decide what the bot answers (and therefore what is billed) can be tested in isolation.
const MENU_KEYWORDS = new Set(['r', 'rocky', 'n', 'novedad', 'novedades']);

export const DEFAULT_EXIT_GUARD_MINUTES = 30;

export function normalizeIntentText(value) {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '').toLowerCase();
}

export function isMenuKeyword(value) {
  return MENU_KEYWORDS.has(normalizeIntentText(value));
}

// openEntry: { shift, entradaAt } for a shift with entry and no exit, or null.
// entry: { available, shift } — shift is null for a covering supernumerario whose site (and so shift)
// is only known after locating them.
// Returns one of: entry | exit | confirm_exit (exit right after entry) | choose (exit one shift or enter
// the next) | none.
export function decideMarkingAction({ openEntry = null, entry = null, now = new Date(), guardMinutes = DEFAULT_EXIT_GUARD_MINUTES } = {}) {
  const canEnter = entry?.available === true;
  if (!openEntry?.shift?.id) return canEnter ? { action: 'entry', shift: entry.shift || null } : { action: 'none' };

  if (canEnter && entry.shift?.id && entry.shift.id !== openEntry.shift.id) {
    return { action: 'choose', exitShift: openEntry.shift, entryShift: entry.shift };
  }
  const minutesSinceEntry = (new Date(now).getTime() - new Date(openEntry.entradaAt).getTime()) / 60000;
  if (Number.isFinite(minutesSinceEntry) && minutesSinceEntry < Math.max(0, Number(guardMinutes) || 0)) {
    return { action: 'confirm_exit', shift: openEntry.shift };
  }
  return { action: 'exit', shift: openEntry.shift };
}
