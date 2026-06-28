import { dataUrl } from "../utils/dataUrl.js";
import { fetchJsonCached } from "../utils/fetchJsonCached.js";
import { toId } from "../utils/ids.js";

// Loads a team member's most-used competitive set details from its stitched set
// index — top EV spread + nature ("Nature:HP/Atk/Def/SpA/SpD/Spe"), ability, and
// item — so the damage model can use the real investment and the analysis can
// show a complete Showdown set. Shares the URL-keyed fetch cache with the item
// recommender. Falls back through the "all" selection.
export async function loadTopSet({ family, pokemonId, selection }) {
  const data =
    (await fetchSetIndex({ family, pokemonId, selection })) ||
    (selection !== "all"
      ? await fetchSetIndex({ family, pokemonId, selection: "all" })
      : null);

  return {
    spread: topUsageName(data?.spreads),
    ability: topUsageName(data?.abilities),
    item: topUsageName(data?.items),
    // Per-move Smogon usage (id -> usage%), so the recommender can anchor on the
    // mon's canonical moves and rank utility moves by how much they're actually
    // run. Entries with no real usage (the stitched tail) are dropped.
    moveUsage: moveUsageMap(data?.moves),
  };
}

function moveUsageMap(entries) {
  const map = new Map();
  if (!Array.isArray(entries)) return map;
  for (const entry of entries) {
    if (typeof entry?.name !== "string" || typeof entry.usage !== "number") continue;
    const id = toMoveId(entry.name);
    // Keep the highest usage if a name collapses to the same id (Hidden Power).
    if (!map.has(id) || entry.usage > map.get(id)) map.set(id, entry.usage);
  }
  return map;
}

// Reborn legal-move data keys every Hidden Power variant under "hiddenpower";
// collapse usage names the same way so they join by id.
function toMoveId(name) {
  const id = toId(name);
  return id.startsWith("hiddenpower") ? "hiddenpower" : id;
}

// Backwards-compatible helper: just the top spread string.
export async function loadTopSpread(options) {
  return (await loadTopSet(options)).spread;
}

// Highest real-usage entry's name; the stitched tail carries usage: null.
function topUsageName(entries) {
  if (!Array.isArray(entries) || !entries.length) return null;

  let best = null;
  for (const entry of entries) {
    if (typeof entry?.name !== "string") continue;
    const usage = typeof entry.usage === "number" ? entry.usage : -1;
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
