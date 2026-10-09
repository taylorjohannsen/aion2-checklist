// Lookups go through this site's server (server.js), which relays them to NCSOFT.
async function get(path, params = {}) {
  let res;
  try {
    res = await fetch(`${path}?${new URLSearchParams(params)}`, { headers: { accept: 'application/json' } });
  } catch {
    throw new Error('Can’t reach the server. Check your connection.');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Lookup failed (${res.status})`);
  return body;
}

export const api = {
  servers: (region) => get('/api/servers', { region }),
  search: (region, name, serverId) => get('/api/search', serverId ? { region, name, serverId } : { region, name }),
  character: ({ region, serverId, characterId }) => get('/api/character', { region, serverId, characterId }),
  item: (id) => get('/api/item', { id }),
};
