// AION 2 Global resets every day at 07:00 UTC (16:00 on the game's UTC+9 server
// clock) and weekly on Wednesday at the same time, on every Global region.
import type { RegionId } from './api.js';

export const RESET_HOUR_UTC = 7;
export const WEEKLY_RESET_DAY = 3; // Wednesday, as Date#getUTCDay counts

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const OFFSET = RESET_HOUR_UTC * HOUR;

// Game days run reset to reset and are numbered from the epoch
export const dayIndex = (now: number = Date.now()): number => Math.floor((now - OFFSET) / DAY);

// The game day the current week began on (the last Wednesday reset)
export function weekIndex(now: number = Date.now()): number {
  const day = dayIndex(now);
  const weekday = (day + 4) % 7; // day 0, 1970-01-01, was a Thursday
  return day - ((weekday - WEEKLY_RESET_DAY + 7) % 7);
}

export const nextDailyReset = (now: number = Date.now()): number => (dayIndex(now) + 1) * DAY + OFFSET;
export const nextWeeklyReset = (now: number = Date.now()): number => (weekIndex(now) + 7) * DAY + OFFSET;

// ---------- Artifact Siege ----------
// Monday, Thursday and Saturday at 21:00 on each region's own server clock, unlike the
// resets above. Abyss Corridors stay open until the next siege, so siege tasks reset
// there. The zones are community-reported (metabot.gg); only NA East is checked in game.
export const SIEGE_DAYS = [1, 4, 6]; // Mon, Thu, Sat, as Date#getUTCDay counts
export const SIEGE_HOUR = 21;

const SERVER_ZONES: Record<RegionId, string> = {
  nae: 'America/New_York',
  naw: 'America/Los_Angeles',
  eu: 'Europe/Berlin',
  la: 'America/Sao_Paulo',
  as: 'Asia/Singapore',
};

const formats = new Map<string, Intl.DateTimeFormat>();

// The wall-clock date and time in a zone
function zoneParts(ts: number, zone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  let format = formats.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    formats.set(zone, format);
  }
  const parts = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  for (const { type, value } of format.formatToParts(ts)) if (type in parts) parts[type as keyof typeof parts] = Number(value);
  return parts;
}

// The moment a wall-clock time happens in a zone, daylight saving included
function zonedTime(year: number, month: number, day: number, hour: number, zone: string): number {
  const wall = Date.UTC(year, month - 1, day, hour);
  const offset = (at: number) => {
    const p = zoneParts(at, zone);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - at;
  };
  return wall - offset(wall - offset(wall));
}

const siegeCache = new Map<string, { last: number; next: number }>();

function sieges(now: number, region: RegionId): { last: number; next: number } {
  const zone = SERVER_ZONES[region];
  const hit = siegeCache.get(zone);
  if (hit && now >= hit.last && now < hit.next) return hit;
  let last = -Infinity;
  let next = Infinity;
  for (let k = -8; k <= 8; k++) {
    const { year, month, day } = zoneParts(now + k * DAY, zone);
    if (!SIEGE_DAYS.includes(new Date(Date.UTC(year, month - 1, day)).getUTCDay())) continue;
    const at = zonedTime(year, month, day, SIEGE_HOUR, zone);
    if (at <= now) last = Math.max(last, at);
    else next = Math.min(next, at);
  }
  const found = { last, next };
  siegeCache.set(zone, found);
  return found;
}

// Sieges are numbered by the hour they started, counted from the epoch
export const siegeIndex = (now: number, region: RegionId): number => Math.floor(sieges(now, region).last / HOUR);
export const nextSiege = (now: number, region: RegionId): number => sieges(now, region).next;

export interface GameEvent {
  id: string;
  name: string;
  everyMin: number;
  atMin: number;
  openMin: number;
  openLabel: string;
}

export interface EventStatus {
  open: boolean;
  /** when the window closes if open, otherwise when the next one starts */
  at: number;
}

// Recurring world events, in UTC. Community-reported, and the same on every Global region.
export const EVENTS: GameEvent[] = [
  { id: 'shugo', name: 'Shugo Festival', everyMin: 60, atMin: 0, openMin: 10, openLabel: 'on now' },
  { id: 'invasion', name: 'Dimensional Invasion', everyMin: 60, atMin: 30, openMin: 3, openLabel: 'join now' },
  { id: 'rift', name: 'Spacetime Rift', everyMin: 180, atMin: 0, openMin: 10, openLabel: 'portal open' },
];

export function eventStatus(event: GameEvent, now: number = Date.now()): EventStatus {
  const period = event.everyMin * MINUTE;
  const shift = event.atMin * MINUTE;
  const lastStart = Math.floor((now - shift) / period) * period + shift;
  const closes = lastStart + event.openMin * MINUTE;
  return now < closes ? { open: true, at: closes } : { open: false, at: lastStart + period };
}

// "4d 3h", "3h 12m", "12m", "45s"
export function formatDuration(ms: number): string {
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

export function formatLocalTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}
