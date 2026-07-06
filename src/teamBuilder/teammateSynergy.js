// Phase 3 (usage-convergence): competitive teammate co-use lift, extracted
// from each mon's first-meaningful tier by scripts/build-teammate-index.mjs.
// A missing file means "the prior has no opinion" — callers treat that as
// trust 0 and the hand-built team-fit judgements stay fully in force.
import { dataUrl } from "../utils/dataUrl.js";
import { fetchJsonCached } from "../utils/fetchJsonCached.js";

export async function loadTeammateLift({ family, pokemonId }) {
  if (!family || !pokemonId) return null;
  try {
    return await fetchJsonCached(
      dataUrl(`teammate-index/${family}/all/${pokemonId}.json`),
    );
  } catch {
    return null;
  }
}

// Attaches `_teammates` (id -> lift %) to every choice of every line, so the
// search kernel can build its pair-trust matrix without further IO. Fetches
// are cached and deduped per representative id.
export async function attachTeammateLift(lines, family) {
  const byId = new Map();
  const wanted = new Set();
  for (const line of lines) {
    for (const choice of line.candidates || []) {
      if (choice?.pokemonId) wanted.add(choice.pokemonId);
    }
  }
  await Promise.all(
    [...wanted].map(async (pokemonId) => {
      byId.set(pokemonId, await loadTeammateLift({ family, pokemonId }));
    }),
  );
  for (const line of lines) {
    for (const choice of line.candidates || []) {
      const entry = choice?.pokemonId ? byId.get(choice.pokemonId) : null;
      if (entry?.teammates) choice._teammates = entry.teammates;
      if (choice?.buildChoices) {
        for (const build of choice.buildChoices) {
          if (entry?.teammates) build._teammates = entry.teammates;
        }
      }
    }
  }
}
