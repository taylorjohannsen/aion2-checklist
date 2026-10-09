// Everything the site remembers lives in one localStorage entry, in the visitor's
// browser. Progress is kept per character and cleared at each daily/weekly reset.
import { DEFAULT_TASKS, MAX_COUNT, PERIODS, type Period, type ResolvedTask, type Task } from './tasks.js';
import { dayIndex, weekIndex } from './time.js';
import { isIconKey } from './icons.js';
import type { RegionId } from './api.js';

export const STORAGE_KEY = 'aion2-checklist';
const VERSION = 1;

export const REGIONS: { id: RegionId; label: string }[] = [
  { id: 'nae', label: 'NA East' },
  { id: 'naw', label: 'NA West' },
  { id: 'eu', label: 'Europe' },
  { id: 'la', label: 'South America' },
  { id: 'as', label: 'Asia' },
];

export interface Character {
  id: string;
  name: string;
  /** added by name rather than looked up */
  manual?: boolean;
  /** the old "My character" starter, which only saves from before 2026-10-09 still hold */
  placeholder?: boolean;
  region?: RegionId;
  characterId?: string;
  serverId?: number;
  serverName?: string;
  className?: string;
  race?: string;
  level?: number;
  combatPower?: number;
  itemLevel?: number;
  portrait?: string;
  updatedAt?: number;
}

/** A character's place in the week. `counts` holds 0..max per task id; absent means 0. */
export interface Progress {
  day: number;
  week: number;
  counts: Record<string, number>;
}

export type Tab = 'checklist' | 'items';

export interface State {
  version: number;
  activeId: string | null;
  characters: Character[];
  progress: Record<string, Progress>;
  tasks: { hidden: string[]; max: Record<string, number>; custom: Task[] };
  items: { pinned: string[]; notes: Record<string, string> };
  ui: { tab: Tab; region: RegionId };
}

/** The fields that say two entries are the same NC character. */
type Identity = Pick<Character, 'characterId' | 'serverId' | 'region'>;

export function blankState(): State {
  return {
    version: VERSION,
    activeId: null,
    characters: [],
    progress: {},
    tasks: { hidden: [], max: {}, custom: [] },
    items: { pinned: [], notes: {} },
    ui: { tab: 'checklist', region: 'nae' },
  };
}

export const newId = (): string =>
  (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);

export function loadState(): State {
  let state = blankState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) state = normalize(JSON.parse(raw));
  } catch {
    // unreadable or blocked storage: start fresh rather than break the page
  }
  return ensureActive(state);
}

export function saveState(state: State): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

// A new visitor has no characters at all; the checklist asks them to add one.
// Older saves may still hold the "My character" placeholder, which keeps working.
function ensureActive(state: State): State {
  if (!state.characters.some((c) => c.id === state.activeId)) state.activeId = state.characters[0]?.id ?? null;
  return state;
}

// ---------- validation, for storage and imported backups ----------
// Everything below takes `unknown` on purpose: it's the line where untrusted JSON
// (localStorage, an imported file, an API response) becomes typed state.

type Loose = Record<string, unknown>;

const isObject = (v: unknown): v is Loose => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max = 200): string => (typeof v === 'string' ? v.slice(0, max) : '');
const int = (v: unknown, min: number, max: number): number | null =>
  (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null);
const isRegion = (v: unknown): v is RegionId => REGIONS.some((r) => r.id === v);

const NUMBER_FIELDS = ['serverId', 'level', 'combatPower', 'itemLevel', 'updatedAt'] as const;
const STRING_FIELDS = ['characterId', 'serverName', 'className', 'race'] as const;

function cleanCharacter(input: object): Character {
  const c = input as Loose;
  const out: Character = { id: str(c.id, 80), name: str(c.name, 40) || 'Unnamed' };
  if (c.manual) out.manual = true;
  if (c.placeholder) out.placeholder = true;
  if (isRegion(c.region)) out.region = c.region;
  for (const key of NUMBER_FIELDS) {
    const value = c[key];
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
  }
  for (const key of STRING_FIELDS) {
    if (c[key]) out[key] = str(c[key], 160);
  }
  if (typeof c.portrait === 'string' && /^https:\/\/profileimg\.plaync\.com\//.test(c.portrait)) out.portrait = c.portrait;
  return out;
}

function cleanTask(t: unknown): Task | null {
  if (!isObject(t) || !str(t.id, 60) || !str(t.name, 60)) return null;
  const period: Period | undefined = PERIODS.find((p) => p.id === t.period)?.id;
  if (!period) return null;
  return {
    id: str(t.id, 60),
    name: str(t.name, 60),
    period,
    max: int(t.max, 1, MAX_COUNT) ?? 1,
    icon: typeof t.icon === 'string' && isIconKey(t.icon) ? t.icon : 'chest',
    note: str(t.note, 120),
  };
}

export function normalize(data: unknown): State {
  if (!isObject(data) || !Array.isArray(data.characters)) throw new Error('That file isn’t a checklist backup');
  const state = blankState();

  const seen = new Set<string>();
  for (const c of data.characters) {
    const id = isObject(c) ? str(c.id) : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    state.characters.push(cleanCharacter(c));
  }
  if (typeof data.activeId === 'string') state.activeId = data.activeId;

  for (const [id, p] of Object.entries(isObject(data.progress) ? data.progress : {})) {
    if (!seen.has(id) || !isObject(p)) continue;
    const counts: Record<string, number> = {};
    for (const [taskId, n] of Object.entries(isObject(p.counts) ? p.counts : {})) {
      const value = int(n, 0, MAX_COUNT);
      if (value) counts[str(taskId, 60)] = value;
    }
    state.progress[id] = { day: int(p.day, 0, 1e6) ?? 0, week: int(p.week, 0, 1e6) ?? 0, counts };
  }

  const tasks: Loose = isObject(data.tasks) ? data.tasks : {};
  state.tasks.hidden = (Array.isArray(tasks.hidden) ? tasks.hidden : [])
    .filter((id): id is string => typeof id === 'string')
    .slice(0, 200);
  for (const [id, n] of Object.entries(isObject(tasks.max) ? tasks.max : {})) {
    const value = int(n, 1, MAX_COUNT);
    if (value && DEFAULT_TASKS.some((t) => t.id === id)) state.tasks.max[id] = value;
  }
  state.tasks.custom = (Array.isArray(tasks.custom) ? tasks.custom : [])
    .map(cleanTask)
    .filter((t): t is Task => t !== null)
    .slice(0, 60);

  const items: Loose = isObject(data.items) ? data.items : {};
  state.items.pinned = (Array.isArray(items.pinned) ? items.pinned : [])
    .filter((k): k is string => typeof k === 'string')
    .slice(0, 100);
  for (const [k, note] of Object.entries(isObject(items.notes) ? items.notes : {})) {
    if (typeof note === 'string' && note.trim()) state.items.notes[str(k, 60)] = note.slice(0, 2000);
  }

  const ui: Loose = isObject(data.ui) ? data.ui : {};
  if (ui.tab === 'items') state.ui.tab = 'items';
  if (isRegion(ui.region)) state.ui.region = ui.region;

  return ensureActive(state);
}

// ---------- tasks ----------

export function allTasks(state: State): ResolvedTask[] {
  return [
    ...DEFAULT_TASKS.map((t) => ({ ...t, max: state.tasks.max[t.id] ?? t.max, custom: false })),
    ...state.tasks.custom.map((t) => ({ ...t, custom: true })),
  ];
}

export const visibleTasks = (state: State): ResolvedTask[] => allTasks(state).filter((t) => !state.tasks.hidden.includes(t.id));

/** Takes raw form values; anything invalid comes back null and nothing is added. */
export function addCustomTask(state: State, task: { name: string; period: string; max: number; icon: string }): Task | null {
  const clean = cleanTask({ ...task, id: `custom-${newId()}` });
  if (clean) state.tasks.custom.push(clean);
  return clean;
}

// ---------- progress ----------

// Clears whatever reset since the character's progress was last touched
function rollover(state: State, progress: Progress, now: number): boolean {
  const day = dayIndex(now);
  const week = weekIndex(now);
  if (progress.day === day && progress.week === week) return false;
  const tasks = allTasks(state);
  for (const id of Object.keys(progress.counts)) {
    const task = tasks.find((t) => t.id === id);
    if (!task || (task.period === 'daily' && progress.day !== day) || (task.period === 'weekly' && progress.week !== week)) {
      delete progress.counts[id];
    }
  }
  progress.day = day;
  progress.week = week;
  return true;
}

export function progressFor(state: State, charId: string, now: number = Date.now()): Progress {
  const progress = (state.progress[charId] ??= { day: dayIndex(now), week: weekIndex(now), counts: {} });
  rollover(state, progress, now);
  return progress;
}

// True if any character's progress was cleared by a reset
export function rolloverAll(state: State, now: number = Date.now()): boolean {
  let changed = false;
  for (const progress of Object.values(state.progress)) changed = rollover(state, progress, now) || changed;
  return changed;
}

export function getCount(state: State, charId: string, task: ResolvedTask): number {
  return Math.min(progressFor(state, charId).counts[task.id] || 0, task.max);
}

export function setCount(state: State, charId: string, task: ResolvedTask, value: number): number {
  const progress = progressFor(state, charId);
  const next = Math.max(0, Math.min(task.max, value));
  if (next) progress.counts[task.id] = next;
  else delete progress.counts[task.id];
  return next;
}

export function periodSummary(state: State, charId: string, period: Period): { done: number; total: number } {
  const tasks = visibleTasks(state).filter((t) => t.period === period);
  const done = tasks.filter((t) => getCount(state, charId, t) >= t.max).length;
  return { done, total: tasks.length };
}

// ---------- characters ----------

// undefined when the visitor hasn't added anyone yet
export const activeCharacter = (state: State): Character | undefined =>
  state.characters.find((c) => c.id === state.activeId) || state.characters[0];

export const sameCharacter = (a: Identity, b: Identity): boolean =>
  Boolean(a.characterId && a.characterId === b.characterId && a.serverId === b.serverId && a.region === b.region);

// A looked-up character takes over the starter placeholder, keeping its progress.
// `info` is a search hit, a full lookup or a typed-in name, so it's checked like any input.
export function addCharacter(state: State, info: object): Character {
  const identity = info as Identity;
  const existing = state.characters.find((c) => sameCharacter(c, identity));
  if (existing) {
    Object.assign(existing, cleanCharacter({ ...existing, ...info, id: existing.id }));
    state.activeId = existing.id;
    return existing;
  }
  const first = state.characters[0];
  const placeholder = state.characters.length === 1 && first?.placeholder ? first : null;
  const character = cleanCharacter({ ...info, id: placeholder ? placeholder.id : newId() });
  if (placeholder) state.characters[0] = character;
  else state.characters.push(character);
  state.activeId = character.id;
  return character;
}

export function updateCharacter(state: State, id: string, info: object): Character | null {
  const index = state.characters.findIndex((c) => c.id === id);
  const current = state.characters[index];
  if (!current) return null;
  const fields = info as Partial<Character>;
  const updated = cleanCharacter({ ...current, ...info, id, manual: current.manual && !fields.characterId });
  if (updated.placeholder && fields.name) delete updated.placeholder;
  state.characters[index] = updated;
  return updated;
}

export function removeCharacter(state: State, id: string): void {
  state.characters = state.characters.filter((c) => c.id !== id);
  delete state.progress[id];
  ensureActive(state);
}

export function moveCharacter(state: State, id: string, delta: number): void {
  const from = state.characters.findIndex((c) => c.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= state.characters.length) return;
  const [character] = state.characters.splice(from, 1);
  if (character) state.characters.splice(to, 0, character);
}
