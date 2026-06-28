import { dataUrl } from "../utils/dataUrl.js";
import { fetchJsonCached } from "../utils/fetchJsonCached.js";

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
  };
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
