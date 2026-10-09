// Everything the site remembers lives in one localStorage entry, in the visitor's
// browser. Progress is kept per character and cleared at each daily/weekly reset.
import { DEFAULT_TASKS, MAX_COUNT, PERIODS } from './tasks.js';
import { dayIndex, weekIndex } from './time.js';
import { ICONS } from './icons.js';

export const STORAGE_KEY = 'aion2-checklist';
const VERSION = 1;

export const REGIONS = [
  { id: 'nae', label: 'NA East' },
  { id: 'naw', label: 'NA West' },
  { id: 'eu', label: 'Europe' },
  { id: 'la', label: 'South America' },
  { id: 'as', label: 'Asia' },
];

export function blankState() {
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

export const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);

export function loadState() {
  let state = blankState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) state = normalize(JSON.parse(raw));
  } catch {
    // unreadable or blocked storage: start fresh rather than break the page
  }
  return ensureActive(state);
}

export function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

// Every visitor starts with an unnamed character so the checklist works before any lookup
function ensureActive(state) {
  if (!state.characters.length) {
    state.characters.push({ id: newId(), name: 'My character', manual: true, placeholder: true });
  }
  if (!state.characters.some((c) => c.id === state.activeId)) state.activeId = state.characters[0].id;
  return state;
}

// ---------- validation, for storage and imported backups ----------

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
const int = (v, min, max) => (Number.isInteger(v) && v >= min && v <= max ? v : null);

function cleanCharacter(c) {
  const out = { id: str(c.id, 80), name: str(c.name, 40) || 'Unnamed' };
  if (c.manual) out.manual = true;
  if (c.placeholder) out.placeholder = true;
  if (REGIONS.some((r) => r.id === c.region)) out.region = c.region;
  for (const key of ['serverId', 'level', 'combatPower', 'itemLevel', 'updatedAt']) {
    if (Number.isFinite(c[key])) out[key] = c[key];
  }
  for (const key of ['characterId', 'serverName', 'className', 'race']) {
    if (c[key]) out[key] = str(c[key], 160);
  }
  if (typeof c.portrait === 'string' && /^https:\/\/profileimg\.plaync\.com\//.test(c.portrait)) out.portrait = c.portrait;
  return out;
}

function cleanTask(t) {
  if (!isObject(t) || !str(t.id, 60) || !str(t.name, 60)) return null;
  if (!PERIODS.some((p) => p.id === t.period)) return null;
  return {
    id: str(t.id, 60),
    name: str(t.name, 60),
    period: t.period,
    max: int(t.max, 1, MAX_COUNT) ?? 1,
    icon: ICONS[t.icon] ? t.icon : 'chest',
    note: str(t.note, 120),
  };
}

export function normalize(data) {
  if (!isObject(data) || !Array.isArray(data.characters)) throw new Error('That file isn’t a checklist backup');
  const state = blankState();

  const seen = new Set();
  for (const c of data.characters) {
    if (!isObject(c) || !str(c.id) || seen.has(c.id)) continue;
    seen.add(c.id);
    state.characters.push(cleanCharacter(c));
  }
  if (typeof data.activeId === 'string') state.activeId = data.activeId;

  for (const [id, p] of Object.entries(isObject(data.progress) ? data.progress : {})) {
    if (!seen.has(id) || !isObject(p)) continue;
    const counts = {};
    for (const [taskId, n] of Object.entries(isObject(p.counts) ? p.counts : {})) {
      const value = int(n, 0, MAX_COUNT);
      if (value) counts[str(taskId, 60)] = value;
    }
    state.progress[id] = { day: int(p.day, 0, 1e6) ?? 0, week: int(p.week, 0, 1e6) ?? 0, counts };
  }

  const tasks = isObject(data.tasks) ? data.tasks : {};
  state.tasks.hidden = (Array.isArray(tasks.hidden) ? tasks.hidden : []).filter((id) => typeof id === 'string').slice(0, 200);
  for (const [id, n] of Object.entries(isObject(tasks.max) ? tasks.max : {})) {
    const value = int(n, 1, MAX_COUNT);
    if (value && DEFAULT_TASKS.some((t) => t.id === id)) state.tasks.max[id] = value;
  }
  state.tasks.custom = (Array.isArray(tasks.custom) ? tasks.custom : []).map(cleanTask).filter(Boolean).slice(0, 60);

  const items = isObject(data.items) ? data.items : {};
  state.items.pinned = (Array.isArray(items.pinned) ? items.pinned : []).filter((k) => typeof k === 'string').slice(0, 100);
  for (const [k, note] of Object.entries(isObject(items.notes) ? items.notes : {})) {
    if (typeof note === 'string' && note.trim()) state.items.notes[str(k, 60)] = note.slice(0, 2000);
  }

  const ui = isObject(data.ui) ? data.ui : {};
  if (ui.tab === 'items') state.ui.tab = 'items';
  if (REGIONS.some((r) => r.id === ui.region)) state.ui.region = ui.region;

  return ensureActive(state);
}

// ---------- tasks ----------

export function allTasks(state) {
  return [
    ...DEFAULT_TASKS.map((t) => ({ ...t, max: state.tasks.max[t.id] ?? t.max, custom: false })),
    ...state.tasks.custom.map((t) => ({ ...t, custom: true })),
  ];
}

export const visibleTasks = (state) => allTasks(state).filter((t) => !state.tasks.hidden.includes(t.id));

export function addCustomTask(state, task) {
  const clean = cleanTask({ ...task, id: `custom-${newId()}` });
  if (clean) state.tasks.custom.push(clean);
  return clean;
}

// ---------- progress ----------

// Clears whatever reset since the character's progress was last touched
function rollover(state, progress, now) {
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

export function progressFor(state, charId, now = Date.now()) {
  if (!state.progress[charId]) state.progress[charId] = { day: dayIndex(now), week: weekIndex(now), counts: {} };
  const progress = state.progress[charId];
  rollover(state, progress, now);
  return progress;
}

// True if any character's progress was cleared by a reset
export function rolloverAll(state, now = Date.now()) {
  let changed = false;
  for (const progress of Object.values(state.progress)) changed = rollover(state, progress, now) || changed;
  return changed;
}

export function getCount(state, charId, task) {
  return Math.min(progressFor(state, charId).counts[task.id] || 0, task.max);
}

export function setCount(state, charId, task, value) {
  const progress = progressFor(state, charId);
  const next = Math.max(0, Math.min(task.max, value));
  if (next) progress.counts[task.id] = next;
  else delete progress.counts[task.id];
  return next;
}

export function periodSummary(state, charId, period) {
  const tasks = visibleTasks(state).filter((t) => t.period === period);
  const done = tasks.filter((t) => getCount(state, charId, t) >= t.max).length;
  return { done, total: tasks.length };
}

// ---------- characters ----------

export const activeCharacter = (state) => state.characters.find((c) => c.id === state.activeId) || state.characters[0];

export const sameCharacter = (a, b) =>
  Boolean(a.characterId && a.characterId === b.characterId && a.serverId === b.serverId && a.region === b.region);

// A looked-up character takes over the starter placeholder, keeping its progress
export function addCharacter(state, info) {
  const existing = state.characters.find((c) => sameCharacter(c, info));
  if (existing) {
    Object.assign(existing, cleanCharacter({ ...existing, ...info, id: existing.id }));
    state.activeId = existing.id;
    return existing;
  }
  const placeholder = state.characters.length === 1 && state.characters[0].placeholder ? state.characters[0] : null;
  const character = cleanCharacter({ ...info, id: placeholder ? placeholder.id : newId() });
  if (placeholder) state.characters[0] = character;
  else state.characters.push(character);
  state.activeId = character.id;
  return character;
}

export function updateCharacter(state, id, info) {
  const index = state.characters.findIndex((c) => c.id === id);
  if (index < 0) return null;
  const current = state.characters[index];
  state.characters[index] = cleanCharacter({ ...current, ...info, id, manual: current.manual && !info.characterId });
  if (state.characters[index].placeholder && info.name) delete state.characters[index].placeholder;
  return state.characters[index];
}

export function removeCharacter(state, id) {
  state.characters = state.characters.filter((c) => c.id !== id);
  delete state.progress[id];
  ensureActive(state);
}

export function moveCharacter(state, id, delta) {
  const from = state.characters.findIndex((c) => c.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= state.characters.length) return;
  const [character] = state.characters.splice(from, 1);
  state.characters.splice(to, 0, character);
}
