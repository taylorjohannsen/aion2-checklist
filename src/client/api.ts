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

export interface StatLine {
  name: string;
  /** the god a deity stat belongs to, e.g. "Nezekan"; empty for primary stats */
  god: string;
  group: 'primary' | 'deity';
  value: number;
  effects: string[];
}

export interface GearPiece {
  /** NC's slot number; 41-45 are arcana */
  slot: number;
  slotName: string;
  id: number;
  name: string;
  grade: string;
  icon: string;
  enchant: number;
  exceed: number;
}

export interface SkillInfo {
  name: string;
  icon: string;
  group: 'active' | 'passive' | 'stigma';
  level: number;
  equipped: boolean;
}

export interface Armory {
  character: CharacterInfo;
  stats: StatLine[];
  gear: GearPiece[];
  wing: { name: string; grade: string; icon: string; enchant: number } | null;
  pet: { name: string; icon: string; level: number } | null;
  skills: SkillInfo[];
}

export interface GearDetail {
  id: number;
  name: string;
  grade: string;
  icon: string;
  category: string;
  enchant: number;
  maxEnchant: number;
  mainStats: { name: string; value: string; extra: string }[];
  subStats: { name: string; value: string }[];
  manastones: { name: string; value: string; grade: string }[];
  godstones: { name: string; desc: string; grade: string }[];
  subSkills: { name: string; level: number; icon: string }[];
  set: { name: string; equipped: number; total: number; bonuses: { count: number; text: string[] }[] } | null;
}

export interface CharacterRef {
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
  armory: ({ region, serverId, characterId }: CharacterRef) =>
    get<Armory>('/api/armory', { region: String(region), serverId: String(serverId), characterId: String(characterId) }),
  gear: ({ region, serverId, characterId }: CharacterRef, piece: GearPiece) =>
    get<GearDetail>('/api/armory/item', {
      region: String(region),
      serverId: String(serverId),
      characterId: String(characterId),
      id: String(piece.id),
      enchantLevel: String(piece.enchant),
      slotPos: String(piece.slot),
    }),
};
