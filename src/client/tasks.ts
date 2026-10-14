import type { IconKey } from './icons.js';

export type Period = 'daily' | 'weekly' | 'siege';

export interface Task {
  id: string;
  name: string;
  period: Period;
  max: number;
  icon: IconKey;
  note?: string;
}

/** A task as the checklist renders it, with the visitor's overrides applied. */
export interface ResolvedTask extends Task {
  custom: boolean;
}

// The default checklist. Visitors can hide tasks, change counts and add their
// own in "Edit tasks"; that's saved in their browser, not here.
export const DEFAULT_TASKS: Task[] = [
  { id: 'duty', name: 'Duty Quests', period: 'daily', max: 5, icon: 'pouch', note: 'Kinah and Abyss Points' },
  { id: 'nightmare', name: 'Nightmare', period: 'daily', max: 2, icon: 'nightmare', note: '2 charges a day, banks up to 14' },
  { id: 'shugo', name: 'Shugo Festival', period: 'daily', max: 3, icon: 'shugo', note: 'Every hour on the hour' },
  { id: 'invasion', name: 'Dimensional Invasion', period: 'daily', max: 1, icon: 'invasion', note: 'Every hour at :30' },
  { id: 'command', name: 'Command Quests', period: 'weekly', max: 12, icon: 'scroll', note: 'From the city Command Merchant' },
  { id: 'trial', name: 'Ascension Trial', period: 'weekly', max: 3, icon: 'ascension', note: 'Run last, at your best item level' },
  { id: 'fissure', name: 'Daily Dungeon', period: 'weekly', max: 14, icon: 'fissure', note: 'Unknown Fissure' },
  { id: 'odyle-craft', name: 'Odyle Craft', period: 'weekly', max: 20, icon: 'odyle-raw', note: 'Substance Morph' },
  { id: 'soul-crystal', name: 'Soul Crystal Craft', period: 'weekly', max: 1000, icon: 'soul-crystal', note: 'Substance Morph' },
  { id: 'sub-shop', name: 'Odyle Sub Shop', period: 'weekly', max: 1, icon: 'odyle-small', note: 'Buy this week’s Odyle' },
  { id: 'pvp-command', name: 'PvP Command Quests', period: 'weekly', max: 20, icon: 'pvp', note: 'From the Abyss Command Merchant' },
  { id: 'corridors', name: 'Abyss Corridors', period: 'siege', max: 1, icon: 'corridor', note: 'Open after your side wins an Artifact Siege' },
];

export const PERIODS: { id: Period; label: string }[] = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  // resets at every Artifact Siege, since that's when Abyss Corridors reopen
  { id: 'siege', label: 'Siege' },
];

export const MAX_COUNT = 9999;
