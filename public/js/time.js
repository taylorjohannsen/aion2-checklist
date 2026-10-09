// AION 2 Global resets every day at 07:00 UTC (16:00 on the game's UTC+9 server
// clock) and weekly on Wednesday at the same time, on every Global region.
export const RESET_HOUR_UTC = 7;
export const WEEKLY_RESET_DAY = 3; // Wednesday, as Date#getUTCDay counts

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const OFFSET = RESET_HOUR_UTC * HOUR;

// Game days run reset to reset and are numbered from the epoch
export const dayIndex = (now = Date.now()) => Math.floor((now - OFFSET) / DAY);

// The game day the current week began on (the last Wednesday reset)
export function weekIndex(now = Date.now()) {
  const day = dayIndex(now);
  const weekday = (day + 4) % 7; // day 0, 1970-01-01, was a Thursday
  return day - ((weekday - WEEKLY_RESET_DAY + 7) % 7);
}

export const nextDailyReset = (now = Date.now()) => (dayIndex(now) + 1) * DAY + OFFSET;
export const nextWeeklyReset = (now = Date.now()) => (weekIndex(now) + 7) * DAY + OFFSET;

// Recurring world events, in UTC. Community-reported, and the same on every Global region.
export const EVENTS = [
  { id: 'shugo', name: 'Shugo Festival', everyMin: 60, atMin: 0, openMin: 10, openLabel: 'on now' },
  { id: 'invasion', name: 'Dimensional Invasion', everyMin: 60, atMin: 30, openMin: 3, openLabel: 'join now' },
  { id: 'rift', name: 'Spacetime Rift', everyMin: 180, atMin: 0, openMin: 10, openLabel: 'portal open' },
];

export function eventStatus(event, now = Date.now()) {
  const period = event.everyMin * MINUTE;
  const shift = event.atMin * MINUTE;
  const lastStart = Math.floor((now - shift) / period) * period + shift;
  const closes = lastStart + event.openMin * MINUTE;
  return now < closes ? { open: true, at: closes } : { open: false, at: lastStart + period };
}

// "4d 3h", "3h 12m", "12m", "45s"
export function formatDuration(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m >= 10) return `${m}m`;
  if (m) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function formatLocalTime(ts) {
  return new Date(ts).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}
