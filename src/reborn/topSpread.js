import { dataUrl } from '../utils/dataUrl.js';
import { fetchJsonCached } from '../utils/fetchJsonCached.js';
import { moveId as toMoveId } from '../utils/ids.js';

/**
 * Loads a team member's most-used competitive set details from its stitched set
 * index — top EV spread + nature ("Nature:HP/Atk/Def/SpA/SpD/Spe"), ability,
 * and item — so the damage model can use the real investment and the analysis
 * can show a complete Showdown set. Shares the URL-keyed fetch cache with the
 * item recommender. Falls back to the "all" selection when the requested
 * selection has no set index.
 * @param {{family: string, pokemonId: string, selection: string}} target
 * @return {Promise<{spread: ?string, ability: ?string,
 *     abilities: Array<{name: string, usage: number}>, item: ?string,
 *     moveUsage: Map<string, number>, moveRank: Map<string, number>}>}
 */
export async function loadTopSet({ family, pokemonId, selection }) {
  const data =
    (await fetchSetIndex({ family, pokemonId, selection })) ||
    (selection !== 'all'
      ? await fetchSetIndex({ family, pokemonId, selection: 'all' })
      : null);

  return {
    spread: topUsageName(data?.spreads),
    ability: topUsageName(data?.abilities),
    // The full competitive ability distribution (name + usage %, descending),
    // so ability sensitivity ("what if my caught mon has Torrent, not
    // Protean?") can be computed instead of assumed away.
    abilities: abilityList(data?.abilities),
    item: topUsageName(data?.items),
    // Per-move Smogon usage (id -> usage%), so the recommender can anchor on
    // the mon's canonical moves and rank utility moves by how much they're
    // actually run. Entries with no real usage (the stitched tail) are dropped.
    moveUsage: moveUsageMap(data?.moves),
    // The FULL stitched priority order (id -> rank), including cross-tier
    // entries whose usage % was nulled when appended (percentages aren't
    // comparable across tiers) and the sub-bar trace tail. The array order is
    // exactly "descending usage within the canonical tier, then each fallback
    // tier down the ladder" — the ranking the recommender's last-resort slot
    // fill uses (entries here can be invisible to moveUsage).
    moveRank: moveRankMap(data?.moves),
  };
}

function abilityList(entries) {
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((entry) => typeof entry?.name === 'string')
    .map((entry) => ({
      name: entry.name,
      usage: typeof entry.usage === 'number' ? entry.usage : 0,
    }))
    .sort((a, b) => b.usage - a.usage);
}

function moveUsageMap(entries) {
  const map = new Map();
  if (!Array.isArray(entries)) return map;
  for (const entry of entries) {
    if (typeof entry?.name !== 'string' || typeof entry.usage !== 'number') continue;
    const id = toMoveId(entry.name);
    if (!map.has(id) || entry.usage > map.get(id)) map.set(id, entry.usage);
  }
  return map;
}

function moveRankMap(entries) {
  const map = new Map();
  if (!Array.isArray(entries)) return map;
  for (const [index, entry] of entries.entries()) {
    const name = entry?.name;
    if (typeof name !== 'string') continue;
    const id = toMoveId(name);
    if (!map.has(id)) map.set(id, index);
  }
  return map;
}

// Highest real-usage entry's name; the stitched tail carries usage: null.
function topUsageName(entries) {
  if (!Array.isArray(entries) || !entries.length) return null;

  let best = null;
  for (const entry of entries) {
    if (typeof entry?.name !== 'string') continue;
    const usage = typeof entry.usage === 'number' ? entry.usage : -1;
    if (!best || usage > best.usage) best = { name: entry.name, usage };
  }

  return best?.name || null;
}

async function fetchSetIndex({ family, pokemonId, selection }) {
  if (!family || !pokemonId) return null;
  try {
    return await fetchJsonCached(
      dataUrl(`set-index/${family}/${selection}/${pokemonId}.json`),
    );
  } catch {
    return null;
  }
}
