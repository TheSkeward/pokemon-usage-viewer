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

const SPREAD_STAT_ORDER = ["hp", "atk", "def", "spa", "spd", "spe"];

// "Adamant:252/4/0/0/252/0" — the set-index spread-name format parseSpread
// reads. Null when the observed set carried no nature or EVs at all.
function toSpreadName(set) {
  if (!set.nature && !set.evs) return null;
  const evs = SPREAD_STAT_ORDER.map((stat) => set.evs?.[stat] || 0).join("/");
  return `${set.nature || "Serious"}:${evs}`;
}

// Picks the most-common observed set whose moves are ALL legal under the
// progression (the ratified "whole set legal under the progression" bar).
// Returns { adopt, context }:
//   adopt   — coherent spread+item to replace the marginal top-spread/top-item
//             assembly (null when no observed set is fully legal). Moves and
//             ability are NOT adopted: moves stay scoring-anchored (score-
//             what-you-show), ability stays the damage-active assumption.
//   context — the most-run observed set outright (legality ignored), for
//             display as labeled real-world context.
export function chooseObservedSet(sets, legalMoveIds) {
  const usable = (sets || []).filter((set) => (set.moveIds || []).length >= 3);
  if (!usable.length) return { adopt: null, context: null };
  const legal = usable.filter((set) =>
    set.moveIds.every((id) => legalMoveIds.has(id)),
  );
  const best = legal[0] || null; // builder emits most-common first
  return {
    adopt: best ? { spread: toSpreadName(best), item: best.item ?? null } : null,
    context: usable[0],
  };
}

export async function selectObservedSet({ family, candidateIds, legalMoveIds }) {
  for (const pokemonId of candidateIds.filter(Boolean)) {
    const detail = await loadObservedSets({ family, pokemonId });
    if (detail?.sets?.length) return chooseObservedSet(detail.sets, legalMoveIds);
  }
  return { adopt: null, context: null };
}
