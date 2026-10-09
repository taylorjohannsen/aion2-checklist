// AION 2 Checklist server: serves public/ and relays the few NC lookups the site
// needs. NC's API turns away browser requests from other sites ("Invalid CORS
// request"), so character and item lookups have to come through here.
//
//   npm start                            build, then http://localhost:3005
//   PORT=3005 HOST=127.0.0.1 node dist/server.js
//
// Needs Node 18+ (global fetch). No runtime dependencies.

import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT) || 3005;
const HOST = process.env.HOST || '127.0.0.1';
// this runs compiled, from dist/, so public/ is one level up
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const NC_SITE = 'https://aion2.plaync.com';
const NC_SEARCH = 'https://api-search.plaync.com/aion2global/search/v2/character';
const NC_PORTRAITS = 'https://profileimg.plaync.com';
const NC_ICONS = 'https://assets.playnccdn.com/static-aion2-gamedata/resources/';
const LANG = 'en-US';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

// NC's shard codes for Global; KR and TW are separate services
const REGIONS = new Set(['nae', 'naw', 'eu', 'la', 'as']);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// ---------- NC's raw payloads ----------
// Only the fields the routes read. All optional: NC owns these shapes and can
// change them without notice, so every read below still defends against gaps.

interface NcServers {
  serverList?: { serverId: number; serverName: string; raceId: number }[];
}

interface NcSearchRow {
  characterId: string | number;
  name: string;
  level: number;
  pcId: number;
  race: number;
  serverId: number;
  serverName: string;
  region?: string;
  profileImageUrl?: string;
}

interface NcSearch {
  list?: NcSearchRow[];
  pagination?: { total?: number };
}

interface NcCharacter {
  profile?: {
    characterId: string;
    characterName?: string;
    characterLevel: number;
    className: string;
    raceId: number;
    raceName?: string;
    serverId: number;
    serverName: string;
    combatPower?: number;
    profileImage?: string;
    titleName?: string;
    titleGrade?: string;
  };
  stat?: { statList?: { type: string; value: number }[] };
}

interface NcItem {
  id?: number;
  name?: string;
  desc?: string;
  grade?: string;
  categoryName?: string;
  type?: string;
  raceName?: string;
  equipLevel?: number;
  tradable?: boolean;
  sources?: unknown;
  icon?: string;
}

interface NcPcData {
  pcDataList?: { id: number; classText: string }[];
}

// ---------- upstream: one polite, cached client for NC ----------

const cache = new Map<string, { expires: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();
const CACHE_MAX = 5000;

const NC_CONCURRENCY = 4;
const NC_SPACING_MS = 100;
let ncActive = 0;
let ncLastStart = 0;
const ncQueue: (() => void)[] = [];

function ncSlot(): Promise<void> {
  return new Promise((resolve) => {
    ncQueue.push(resolve);
    pumpQueue();
  });
}

function pumpQueue(): void {
  if (!ncQueue.length || ncActive >= NC_CONCURRENCY) return;
  const wait = ncLastStart + NC_SPACING_MS - Date.now();
  if (wait > 0) {
    setTimeout(pumpQueue, wait);
    return;
  }
  ncActive++;
  ncLastStart = Date.now();
  ncQueue.shift()?.();
  pumpQueue();
}

function ncDone(): void {
  ncActive--;
  pumpQueue();
}

class UpstreamError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function ncJSON<T>(url: string, ttl: number): Promise<T> {
  const hit = cache.get(url);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  const pending = inflight.get(url);
  if (pending) return pending as Promise<T>;

  const request = (async (): Promise<T> => {
    await ncSlot();
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': USER_AGENT, accept: 'application/json', 'accept-language': 'en-US,en;q=0.9' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new UpstreamError(`NC answered ${res.status}`, res.status);
      const value = (await res.json()) as T;
      const oldest = cache.keys().next().value;
      if (cache.size >= CACHE_MAX && oldest !== undefined) cache.delete(oldest);
      cache.set(url, { expires: Date.now() + ttl, value });
      return value;
    } finally {
      ncDone();
    }
  })();
  inflight.set(url, request);
  try {
    return await request;
  } finally {
    inflight.delete(url);
  }
}

const siteURL = (pathname: string, params: Record<string, string>): string => `${NC_SITE}${pathname}?${new URLSearchParams({ lang: LANG, ...params })}`;

async function classTable(): Promise<Map<number, string>> {
  const data = await ncJSON<NcPcData>(siteURL('/en-us/api/gameinfo/pcdata', { region: 'nae' }), 24 * HOUR);
  return new Map((data.pcDataList || []).map((row) => [row.id, row.classText]));
}

// ---------- API routes ----------

const stripTags = (value: unknown): string => String(value ?? '').replace(/<[^>]*>/g, '').trim();

function decodeId(id: string): string {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

function absolute(origin: string, url: string | undefined): string {
  if (!url) return '';
  return /^https?:\/\//.test(url) ? url : origin + url;
}

const RACES: Record<number, string> = { 1: 'Elyos', 2: 'Asmodian' };

function requireRegion(query: URLSearchParams): string {
  const region = query.get('region') ?? '';
  if (!REGIONS.has(region)) throw new BadRequest('Unknown region');
  return region;
}

function requireMatch(query: URLSearchParams, name: string, pattern: RegExp, label = name): string {
  const value = query.get(name) ?? '';
  if (!pattern.test(value)) throw new BadRequest(`Invalid ${label}`);
  return value;
}

class BadRequest extends Error {}

interface RouteResult {
  status?: number;
  body: unknown;
  /** seconds the browser may cache a 200 */
  maxAge?: number;
}

type Route = (query: URLSearchParams) => Promise<RouteResult>;

const routes: Record<string, Route> = {
  async '/api/servers'(query) {
    const region = requireRegion(query);
    const data = await ncJSON<NcServers>(siteURL('/en-us/api/gameinfo/servers', { region }), 6 * HOUR);
    return {
      maxAge: 3600,
      body: {
        servers: (data.serverList || []).map((s) => ({
          id: s.serverId,
          name: s.serverName,
          race: RACES[s.raceId] || '',
        })),
      },
    };
  },

  async '/api/search'(query) {
    const region = requireRegion(query);
    const name = (query.get('name') || '').trim();
    if (!name || name.length > 24 || /[\u0000-\u001f<>]/.test(name)) throw new BadRequest('Invalid name');
    const params: Record<string, string> = { keyword: name, region, localeInfo: LANG, page: '1', size: '30' };
    const serverId = query.get('serverId');
    if (serverId) params.serverId = requireMatch(query, 'serverId', /^\d{4}$/, 'server');

    const [data, classes] = await Promise.all([
      ncJSON<NcSearch>(`${NC_SEARCH}?${new URLSearchParams(params)}`, 5 * MINUTE),
      classTable().catch(() => new Map<number, string>()),
    ]);
    return {
      maxAge: 120,
      body: {
        results: (data.list || []).map((row) => ({
          characterId: decodeId(String(row.characterId)),
          name: stripTags(row.name),
          level: row.level,
          className: classes.get(row.pcId) || '',
          race: RACES[row.race] || '',
          serverId: row.serverId,
          serverName: row.serverName,
          region: row.region || region,
          portrait: absolute(NC_PORTRAITS, row.profileImageUrl),
        })),
        total: data.pagination?.total ?? 0,
      },
    };
  },

  async '/api/character'(query) {
    const region = requireRegion(query);
    const serverId = requireMatch(query, 'serverId', /^\d{4}$/, 'server');
    const characterId = requireMatch(query, 'characterId', /^[A-Za-z0-9_\-=]{8,128}$/, 'character');
    const data = await ncJSON<NcCharacter>(siteURL('/api/character/info', { region, serverId, characterId }), 10 * MINUTE);
    const profile = data.profile;
    if (!profile?.characterName) return { status: 404, body: { error: 'Character not found' } };
    const itemLevel = (data.stat?.statList || []).find((s) => s.type === 'ItemLevel')?.value ?? null;
    return {
      maxAge: 300,
      body: {
        characterId: profile.characterId,
        name: profile.characterName,
        level: profile.characterLevel,
        className: profile.className,
        race: RACES[profile.raceId] || profile.raceName || '',
        serverId: profile.serverId,
        serverName: profile.serverName,
        region,
        combatPower: profile.combatPower ?? null,
        itemLevel,
        portrait: profile.profileImage || '',
        title: profile.titleName ? { name: profile.titleName, grade: profile.titleGrade } : null,
      },
    };
  },

  async '/api/item'(query) {
    const id = requireMatch(query, 'id', /^\d{6,10}$/, 'item');
    const data = await ncJSON<NcItem>(siteURL('/en-us/api/gameconst/item', { id, enchantLevel: '0', region: 'nae' }), 24 * HOUR);
    // NC answers an unknown ID with 200 and id 0
    if (!data?.id) return { status: 404, body: { error: 'Item not found' } };
    return {
      maxAge: 86400,
      body: {
        id: data.id,
        name: data.name,
        desc: data.desc || '',
        grade: data.grade || '',
        category: data.categoryName || '',
        type: data.type || '',
        race: data.raceName || '',
        level: data.equipLevel || 0,
        tradable: Boolean(data.tradable),
        // NC's own source categories ("Expedition", "Reward Chest"). Coarser than the
        // in-game panel, which also names the dungeon, but it covers most items.
        sources: (Array.isArray(data.sources) ? data.sources : []).map((s) => stripTags(s)).filter(Boolean).slice(0, 12),
        icon: data.icon ? data.icon.replace(NC_ICONS, '') : '',
      },
    };
  },
};

// ---------- per-visitor rate limit ----------

const RATE_WINDOW_MS = MINUTE;
const RATE_MAX = 60;
const hits = new Map<string, number[]>(); // ip -> request timestamps

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > RATE_MAX;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, times] of hits) if (times.every((t) => now - t >= RATE_WINDOW_MS)) hits.delete(ip);
}, 5 * MINUTE).unref();

function clientIp(req: http.IncomingMessage): string {
  // nginx sets X-Real-IP; only trust it when the request came through the local proxy
  const direct = req.socket.remoteAddress || '';
  const local = direct === '127.0.0.1' || direct === '::1' || direct === '::ffff:127.0.0.1';
  const forwarded = req.headers['x-real-ip'];
  return (local && typeof forwarded === 'string' && forwarded) || direct;
}

// ---------- static files (nginx serves these in production) ----------

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

async function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): Promise<void> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return send(res, 400, 'Bad request');
  }
  let file = path.normalize(path.join(PUBLIC_DIR, decoded));
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden');
  let info = await stat(file).catch(() => null);
  if (info?.isDirectory()) {
    file = path.join(file, 'index.html');
    info = await stat(file).catch(() => null);
  }
  if (!info?.isFile()) return send(res, 404, 'Not found');

  const etag = `"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
  const longLived = pathname.startsWith('/icons/');
  res.setHeader('etag', etag);
  res.setHeader('cache-control', longLived ? 'public, max-age=604800' : 'no-cache');
  res.setHeader('content-type', TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
  if (req.headers['if-none-match'] === etag) {
    res.statusCode = 304;
    res.end();
    return;
  }
  res.setHeader('content-length', info.size);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
}

function send(res: http.ServerResponse, status: number, text: string): void {
  res.statusCode = status;
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.end(text);
}

function sendJSON(res: http.ServerResponse, status: number, body: unknown, maxAge = 0): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', maxAge ? `public, max-age=${maxAge}` : 'no-store');
  res.end(JSON.stringify(body));
}

// ---------- server ----------

const server = http.createServer(async (req, res) => {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');

  const url = new URL(req.url ?? '/', 'http://localhost');
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');

  if (url.pathname.startsWith('/api/')) {
    const route = routes[url.pathname];
    if (!route) return sendJSON(res, 404, { error: 'Not found' });
    if (rateLimited(clientIp(req))) {
      res.setHeader('retry-after', '60');
      return sendJSON(res, 429, { error: 'Too many lookups, try again in a minute' });
    }
    try {
      const { status = 200, body, maxAge = 0 } = await route(url.searchParams);
      return sendJSON(res, status, body, status === 200 ? maxAge : 0);
    } catch (err) {
      if (err instanceof BadRequest) return sendJSON(res, 400, { error: err.message });
      console.error(`${url.pathname}: ${err instanceof Error ? err.message : String(err)}`);
      return sendJSON(res, 502, { error: 'NCSOFT lookup failed, try again shortly' });
    }
  }

  try {
    await serveStatic(req, res, url.pathname);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(res, 500, 'Server error');
  }
});

server.listen(PORT, HOST, () => console.log(`AION 2 Checklist on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`));
