#!/usr/bin/env node
// Builds public/data/items.json, the offline index the item lookup searches.
//
// NC's Global site has no item search, so the IDs come from the Taiwan item
// dictionary (same game, more of it), and each ID's English name comes from the
// Global item endpoint. Taiwan's gear doesn't exist on Global, so equipment is
// skipped; materials, consumables, skins and titles mostly carry over.
//
// Every response is cached under scripts/.cache, so a rerun only asks NC for
// what it hasn't seen. Pass --refresh to refetch everything.
//
//   npm run build:items [-- --refresh]

import { mkdir, readFile, writeFile, appendFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// this runs compiled, from dist/scripts/, so the project root is two levels up
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const cacheDir = path.join(root, 'scripts', '.cache');
const catalogFile = path.join(cacheDir, 'tw-catalog.json');
const globalFile = path.join(cacheDir, 'global-items.ndjson');
const sourcesFile = path.join(root, 'public', 'data', 'sources.json');
const outFile = path.join(root, 'public', 'data', 'items.json');

const TW_SEARCH = 'https://tw.ncsoft.com/aion2_tw/v2.0/dict/search/item';
const GLOBAL_ITEM = 'https://aion2.plaync.com/en-us/api/gameconst/item';
const ICON_BASE = 'https://assets.playnccdn.com/static-aion2-gamedata/resources/';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

// Taiwan's top-level categories; the dictionary caps a query at 10,000 rows, so it's paged per category
const CATEGORIES = ['Equip_Weapon', 'Equip_Armor', 'Equip_Accessory', 'Usable_001', 'Usable_Skin', 'Misc_001'];
// Past page 50 the dictionary shrinks pages to 50 rows and shifts its offsets, so page at 50 throughout
const PAGE_SIZE = 50;
const SKIP_CATEGORIES = new Set(['Equip_Weapon', 'Equip_Armor', 'Equip_Accessory']);
// Global-only items the Taiwan dictionary doesn't list (the content recharge tickets)
const EXTRA_IDS = [512000014, 512000015, 512000016, 512000017];

const REQUESTS_PER_SECOND = 5;
const WORKERS = 3;

const refresh = process.argv.includes('--refresh');

/** One page of Taiwan's dictionary search. */
interface TwPage {
  contents: { id: number; image?: string }[];
  pagination: { lastPage: number; total: number };
}

/** Global's item record; only the fields the index keeps. Unknown ids come back with id 0. */
interface GlobalItemResponse {
  id: number;
  name?: string;
  grade?: string;
  categoryName?: string;
  icon?: string;
}

interface CatalogRow {
  id: number;
  category: string;
  icon: string;
}

interface GlobalItem {
  name: string | undefined;
  grade: string | undefined;
  category: string | undefined;
  icon: string;
}

type IndexTuple = [id: number, name: string, grade: string, category: string, icon: string];

let nextSlot = 0;
async function rateLimit() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + 1000 / REQUESTS_PER_SECOND;
  if (wait) await sleep(wait);
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function getJSON<T>(url: string, tries = 5): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    await rateLimit();
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return (await res.json()) as T;
    } catch (err) {
      if (attempt >= tries) throw err;
      await sleep(1000 * 2 ** attempt);
    }
  }
}

const iconFile = (url: unknown): string => (url ? String(url).replace(ICON_BASE, '') : '');

async function loadCatalog(): Promise<CatalogRow[]> {
  if (!refresh && existsSync(catalogFile)) return JSON.parse(await readFile(catalogFile, 'utf8')) as CatalogRow[];

  const rows = new Map<number, CatalogRow>();
  for (const category of CATEGORIES) {
    let total = 0;
    for (let page = 1, lastPage = 1; page <= lastPage; page++) {
      const body = await getJSON<TwPage>(`${TW_SEARCH}?category1=${category}&page=${page}&size=${PAGE_SIZE}`);
      lastPage = body.pagination.lastPage;
      total = body.pagination.total;
      for (const item of body.contents) rows.set(item.id, { id: item.id, category, icon: iconFile(item.image) });
    }
    const got = [...rows.values()].filter((row) => row.category === category).length;
    console.log(`taiwan ${category}: ${got} of ${total}`);
  }
  const catalog = [...rows.values()];
  await writeFile(catalogFile, JSON.stringify(catalog));
  return catalog;
}

async function loadGlobalCache(): Promise<Map<number, GlobalItem | null>> {
  const seen = new Map<number, GlobalItem | null>();
  if (refresh) await rm(globalFile, { force: true });
  if (!existsSync(globalFile)) return seen;
  for (const line of (await readFile(globalFile, 'utf8')).split('\n')) {
    if (!line) continue;
    const row = JSON.parse(line) as { id: number; item: GlobalItem | null };
    seen.set(row.id, row.item);
  }
  return seen;
}

async function sourcedIds(): Promise<number[]> {
  if (!existsSync(sourcesFile)) return [];
  const { items = [] } = JSON.parse(await readFile(sourcesFile, 'utf8')) as { items?: { id?: unknown }[] };
  return items.map((entry) => entry.id).filter((id): id is number => Number.isInteger(id));
}

async function main(): Promise<void> {
  await mkdir(cacheDir, { recursive: true });

  const catalog = await loadCatalog();
  const ids = new Set([
    ...catalog.filter((row) => !SKIP_CATEGORIES.has(row.category)).map((row) => row.id),
    ...EXTRA_IDS,
    ...(await sourcedIds()),
  ]);

  const cache = await loadGlobalCache();
  const todo = [...ids].filter((id) => !cache.has(id));
  console.log(`${ids.size} candidate items, ${cache.size} cached, ${todo.length} to fetch`);

  let done = 0;
  let cursor = 0;
  const started = Date.now();
  async function worker() {
    while (cursor < todo.length) {
      const id = todo[cursor++];
      if (id === undefined) break;
      const body = await getJSON<GlobalItemResponse>(`${GLOBAL_ITEM}?id=${id}&enchantLevel=0&lang=en-US&region=nae`);
      // Global answers an unknown ID with 200 and id 0
      const item: GlobalItem | null = body && body.id ? {
        name: body.name,
        grade: body.grade,
        category: body.categoryName,
        icon: iconFile(body.icon),
      } : null;
      cache.set(id, item);
      await appendFile(globalFile, JSON.stringify({ id, item }) + '\n');
      if (++done % 250 === 0) {
        const rate = done / ((Date.now() - started) / 1000);
        console.log(`${done}/${todo.length} fetched, ~${Math.round((todo.length - done) / rate / 60)} min left`);
      }
    }
  }
  await Promise.all(Array.from({ length: WORKERS }, worker));

  const rows: IndexTuple[] = [];
  for (const id of ids) {
    const item = cache.get(id);
    if (item?.name) rows.push([id, item.name, item.grade || '', item.category || '', item.icon || '']);
  }
  rows.sort((a, b) => a[1].localeCompare(b[1]) || a[0] - b[0]);

  await writeFile(outFile, JSON.stringify({
    generated: new Date().toISOString().slice(0, 10),
    iconBase: ICON_BASE,
    fields: ['id', 'name', 'grade', 'category', 'icon'],
    items: rows,
  }));
  console.log(`wrote ${rows.length} items to ${path.relative(root, outFile)}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
