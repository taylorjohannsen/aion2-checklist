// Lookups go through this site's server (src/server.ts), which relays them to NCSOFT.
// These shapes mirror what the relay returns, not NC's raw payloads.

export type RegionId = 'nae' | 'naw' | 'eu' | 'la' | 'as';

export interface SearchHit {
  characterId: string;
  name: string;
  level: number;
  className: string;
  race: string;
  serverId: number;
  serverName: string;
  region: RegionId;
  portrait: string;
}

export interface SearchResponse {
  results: SearchHit[];
  total: number;
}

export interface CharacterInfo {
  characterId: string;
  name: string;
  level: number;
  className: string;
  race: string;
  serverId: number;
  serverName: string;
  region: RegionId;
  combatPower: number | null;
  itemLevel: number | null;
  portrait: string;
  title: { name: string; grade: string } | null;
}

export interface ItemInfo {
  id: number;
  name: string;
  desc: string;
  grade: string;
  category: string;
  type: string;
  race: string;
  level: number;
  tradable: boolean;
  /** NC's own source categories, e.g. ["Expedition", "Reward Chest"] */
  sources: string[];
  icon: string;
}

export interface ServerInfo {
  id: number;
  name: string;
  race: string;
}

interface CharacterRef {
  region?: RegionId | undefined;
  serverId?: number | undefined;
  characterId?: string | undefined;
}

async function get<T>(path: string, params: Record<string, string>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${path}?${new URLSearchParams(params)}`, { headers: { accept: 'application/json' } });
  } catch {
    throw new Error('Can’t reach the server. Check your connection.');
  }
  const body = await res.json().catch(() => ({})) as T & { error?: string };
  if (!res.ok) throw new Error(body.error || `Lookup failed (${res.status})`);
  return body;
}

export const api = {
  servers: (region: RegionId) => get<{ servers: ServerInfo[] }>('/api/servers', { region }),
  search: (region: RegionId, name: string, serverId?: string) =>
    get<SearchResponse>('/api/search', serverId ? { region, name, serverId } : { region, name }),
  character: ({ region, serverId, characterId }: CharacterRef) =>
    get<CharacterInfo>('/api/character', { region: String(region), serverId: String(serverId), characterId: String(characterId) }),
  item: (id: number) => get<ItemInfo>('/api/item', { id: String(id) }),
};
