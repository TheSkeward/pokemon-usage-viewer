/**
 * @fileoverview Competitive teammate co-use lift, extracted from each mon's
 * first-meaningful tier by scripts/build-teammate-index.mjs.
 * A missing file means "the prior has no opinion" — callers treat that as
 * trust 0 and the hand-built team-fit judgements stay fully in force.
 */
import { dataUrl } from "../utils/dataUrl.js";
import { fetchJsonCached } from "../utils/fetchJsonCached.js";

// The per-family listing of which mons HAVE an index file. Consulted before
// any per-mon fetch so mons without data (a normal state — only mons with a
// Teammates block in their tier get a file) don't produce a 404 request on
// every optimize; browsers log those to the console even when caught. A
// missing/unfetchable listing (older deployed data) returns null and the
// loader falls back to fetch-and-catch.
async function loadAvailableIds(family) {
  try {
    const ids = await fetchJsonCached(
      dataUrl(`teammate-index/${family}/all/index.json`),
    );
    return Array.isArray(ids) ? new Set(ids) : null;
  } catch {
    return null;
  }
}

/**
 * @param {{family: ?string, pokemonId: ?string}} key
 * @return {Promise<?Object>} Teammate-lift entry; null when the mon has no
 *     index file or the fetch fails.
 */
export async function loadTeammateLift({ family, pokemonId }) {
  if (!family || !pokemonId) return null;
  const available = await loadAvailableIds(family);
  if (available && !available.has(pokemonId)) return null;
  try {
    return await fetchJsonCached(
      dataUrl(`teammate-index/${family}/all/${pokemonId}.json`),
    );
  } catch {
    return null;
  }
}

// The search kernel scores the makeChoice clones (line.best / bestNonMega /
// choiceOptions and their buildAlternatives) — NOT the raw scored rows in
// line.candidates — so the lift must land on exactly those objects. A choice
// can appear in several of the collections; the seen-set makes the walk (and
// the mutation) visit each object once.
function* lineChoices(line, seen = new Set()) {
  const stack = [line.best, line.bestNonMega, ...(line.choiceOptions || [])];
  while (stack.length) {
    const choice = stack.pop();
    if (!choice || seen.has(choice)) continue;
    seen.add(choice);
    yield choice;
    if (choice.buildAlternatives) stack.push(...choice.buildAlternatives);
  }
}

/**
 * Attaches `_teammates` (id -> lift %) to every choice of every line, so the
 * search kernel can build its pair-trust matrix without further IO. Fetches
 * are cached and deduped per representative id.
 * @param {Array<Object>} lines
 * @param {string} family
 * @return {Promise<void>}
 */
export async function attachTeammateLift(lines, family) {
  const byId = new Map();
  for (const line of lines) {
    for (const choice of lineChoices(line)) {
      if (choice.pokemonId && !byId.has(choice.pokemonId)) {
        byId.set(choice.pokemonId, null);
      }
    }
  }
  await Promise.all(
    [...byId.keys()].map(async (pokemonId) => {
      byId.set(pokemonId, await loadTeammateLift({ family, pokemonId }));
    }),
  );
  for (const line of lines) {
    for (const choice of lineChoices(line)) {
      const entry = byId.get(choice.pokemonId);
      if (entry?.teammates) choice._teammates = entry.teammates;
    }
  }
}
