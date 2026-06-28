import { dataUrl } from "../utils/dataUrl.js";
import { fetchJsonCached } from "../utils/fetchJsonCached.js";

// Loads the most-used EV spread + nature string ("Nature:HP/Atk/Def/SpA/SpD/Spe")
// for a team member from its stitched set index, so the damage model can use the
// real top set's investment. Shares the URL-keyed fetch cache with the item
// recommender, which already loads the same set-index files. Falls back through
// the "all" selection and returns null when nothing is available.
export async function loadTopSpread({ family, pokemonId, selection }) {
  const data =
    (await fetchSetIndex({ family, pokemonId, selection })) ||
    (selection !== "all"
      ? await fetchSetIndex({ family, pokemonId, selection: "all" })
      : null);

  const spreads = data?.spreads;
  if (!Array.isArray(spreads) || !spreads.length) return null;

  // Prefer the highest real-usage spread; the stitched tail has usage: null.
  let best = null;
  for (const spread of spreads) {
    if (typeof spread?.name !== "string") continue;
    const usage = typeof spread.usage === "number" ? spread.usage : -1;
    if (!best || usage > best.usage) best = { name: spread.name, usage };
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
