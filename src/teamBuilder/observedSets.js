// Loader + selection for the observed-sets index (whole competitive sets
// scraped from curated sample teams; scripts/build-observed-sets.mjs).
// Same fetch conventions as teammateSynergy: index.json gates per-mon
// fetches so mons with no observed sets never 404.
import { dataUrl } from "../utils/dataUrl.js";
import { fetchJsonCached } from "../utils/fetchJsonCached.js";

const availableIdsCache = new Map();

async function loadAvailableIds(family) {
  if (!availableIdsCache.has(family)) {
    availableIdsCache.set(
      family,
      fetchJsonCached(dataUrl(`observed-sets/${family}/index.json`))
        .then((ids) => new Set(Array.isArray(ids) ? ids : []))
        .catch(() => new Set()),
    );
  }
  return availableIdsCache.get(family);
}

export async function loadObservedSets({ family, pokemonId }) {
  if (!family || !pokemonId) return null;
  const available = await loadAvailableIds(family);
  if (!available.has(pokemonId)) return null;
  try {
    return await fetchJsonCached(
      dataUrl(`observed-sets/${family}/${pokemonId}.json`),
    );
  } catch {
    return null;
  }
}

// The most-run observed whole set (≥3 known moves — fragments aren't sets),
// regardless of current legality: labeled real-world CONTEXT only (user
// ruling), never a recommendation. Builder files are most-common-first.
export async function selectObservedSet({ family, candidateIds }) {
  for (const pokemonId of candidateIds.filter(Boolean)) {
    const detail = await loadObservedSets({ family, pokemonId });
    const context = (detail?.sets || []).find(
      (set) => (set.moveIds || []).length >= 3,
    );
    if (context) return context;
  }
  return null;
}
