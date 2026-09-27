import { addIsoDays } from './shiftCalendar.js';

export function cycleEntries(config, from, length = 14) {
  // Las etapas de semanas completas (7, 14, 21, 28 dias) cambian de plan cada domingo, primer dia de la semana.
  const startDate = new Date(`${config.start}T00:00:00Z`);
  const origin = config.days % 7 === 0 ? startDate.getTime() - startDate.getUTCDay() * 86400000 : startDate.getTime();
  const start = Date.parse(`${config.start}T00:00:00Z`);
  return Array.from({ length }, (_, i) => {
    const date = addIsoDays(from, i);
    const time = Date.parse(`${date}T00:00:00Z`);
    const day = Math.round((time - origin) / 86400000);
    return { date, entries: config.members.map(member => ({
      employee: member.employee,
      template: time < start || (config.end && date > config.end) ? undefined
        : String(config.rules?.weeklyRestDays?.[member.employee]) === String(new Date(`${date}T00:00:00Z`).getUTCDay()) ? null
          : config.cycle[(Math.floor(day / config.days) + member.offset) % config.cycle.length]
    })) };
  });
}
