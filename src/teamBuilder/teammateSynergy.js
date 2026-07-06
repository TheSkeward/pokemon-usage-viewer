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

// Attaches `_teammates` (id -> lift %) to every choice of every line, so the
// search kernel can build its pair-trust matrix without further IO. Fetches
// are cached and deduped per representative id.
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
