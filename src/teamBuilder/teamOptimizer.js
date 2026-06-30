import { getLineRepresentativeCandidates } from "../data";
import {
  applyBreedingContextToProgression,
  buildRebornBreedingContext,
} from "../reborn/breeding.js";
import { getCurrentRebornSpeciesForChoice } from "../reborn/currentSpecies.js";
import {
  getAvailableRebornMoves,
  loadRebornLegalMoveData,
} from "../reborn/legalMoves";
import { buildCandidateLegalityProfile } from "../reborn/teamAnalysis";
import { buildInputGroups } from "./inputGroups";
import {
  MIN_MEANINGFUL_USAGE_PERCENT,
  compareScoredCandidates,
  scoreCandidate,
} from "./candidateScoring";
import { resolveRepresentativeLightBundle } from "./representativeBundle";
import { choosePoolTeam } from "./teamSelection";

// --- Incremental caches ----------------------------------------------------
// In a playthrough you mostly grow the pool one mon at a time at a fixed game
// state, so we cache work keyed on everything that affects a line's score.
//   Layer 1: resolved lines, so adding a mon re-resolves only that mon.
//   Layer 2: the exact optimum + its pool, so a pure addition only has to search
//            teams that include the new mon (seeded from the cached best), and a
//            non-team deletion reuses the optimum outright.
//   Layer 3: full results memoized by (score context + mon set). The optimum is
//            a pure function of those, so revisiting any pool state seen this
//            session — undo, toggle a mon off/on, delete-then-re-add — returns
//            instantly with no line resolution and no search.
// All invalidate the moment the score context (family/selection/progression, or
// a line's reachable egg moves) changes — it's folded into every key.
const lineCache = new Map();
const MAX_LINE_CACHE = 4000;
let searchCache = null; // { searchKey, team, megaUsed, baseLineKeys, teamLineKeys }
const resultCache = new Map();
const MAX_RESULT_CACHE = 400;

export async function optimizeTeamFromPool({
  availability,
  family,
  pokemonIndex,
  progression = {},
  query,
  selection,
  onProgress,
  exhaustive = true,
}) {
  const groups = buildInputGroups(query, pokemonIndex);
  const total = groups.length;
  let completed = 0;
  onProgress?.({ completed, total });

  const breedingContext = await buildRebornBreedingContext({
    pokemonIndex,
    progression,
    query,
  });

  const progressionSig = stableStringify(progression);
  // A line's egg moves can come from any current owned species via breeding, and
  // the current species can be a pre-evolution of the line's representative — so
  // rather than risk under-keying per line, all lines share one breeding
  // signature. It's trivial when the daycare is locked (full caching) and only
  // changes the whole pool's cache when reachable egg moves actually change.
  const breedingSig =
    breedingContext?.byPokemonId &&
    Object.keys(breedingContext.byPokemonId).length
      ? stableStringify(breedingContext.byPokemonId)
      : "none";
  const contextSig = `${family}|${selection}|${progressionSig}|${breedingSig}`;

  // Layer 3: the result is a pure function of the score context and the set of
  // input mons, so memoize by both. A hit short-circuits line resolution and the
  // search entirely; re-seed the incremental search from it so a later addition
  // still grows rather than re-enumerates.
  const poolKey = `${contextSig}|${groups
    .map((group) => group.input?.id ?? group.token)
    .sort()
    .join(",")}`;
  const memoized = resultCache.get(poolKey);
  if (memoized) {
    onProgress?.({ completed: total, total });
    seedSearchCache(memoized, memoized.lines, contextSig);
    return memoized;
  }

  const hitLineKeys = new Set();

  const lines = (
    await Promise.all(
      groups.map((group) =>
        resolvePoolLineCached({
          args: {
            availability,
            breedingContext,
            family,
            group,
            pokemonIndex,
            progression,
            selection,
          },
          contextSig,
          hitLineKeys,
        }).then((line) => {
          completed += 1;
          onProgress?.({ completed, total });
          return line;
        }),
      ),
    )
  ).filter(Boolean);

  // Layer 2: if nothing about the score context changed and every line of the
  // cached optimal TEAM is unchanged (a cache hit), the previous optimum is
  // still valid — the team score is intrinsic, so removing any non-team mon
  // can't beat it, and added mons only need their containing teams enumerated.
  // So a deletion that doesn't touch the team returns the cached result with no
  // search, and an addition (with or without unrelated deletions) grows it.
  const searchKey = contextSig;
  const incremental =
    searchCache &&
    searchCache.searchKey === searchKey &&
    [...searchCache.teamLineKeys].every((key) => hitLineKeys.has(key))
      ? {
          previousBest: { team: searchCache.team, megaUsed: searchCache.megaUsed },
          baseLineKeys: searchCache.baseLineKeys,
          teamLineKeys: searchCache.teamLineKeys,
        }
      : null;

  const result = choosePoolTeam(lines, progression.opponentTypeBias, {
    exhaustive,
    incremental,
  });

  seedSearchCache(result, lines, searchKey);
  storeResult(poolKey, result);

  return result;
}

// Seed the Layer-2 incremental cache from an exact result, so the next pool edit
// can grow/reuse it instead of re-searching. Only exact optima are safe to seed.
function seedSearchCache(result, lines, searchKey) {
  if (!(result.searchExact && result.bestEvaluated)) {
    searchCache = null;
    return;
  }

  const lineKeyByInput = new Map();
  for (const line of lines) {
    const rep = line.best || line.bestNonMega;
    if (rep) lineKeyByInput.set(rep.inputPokemonId, line.lineKey);
  }

  searchCache = {
    searchKey,
    team: result.bestEvaluated.team,
    megaUsed: result.bestEvaluated.megaUsed,
    baseLineKeys: new Set(
      lines
        .filter((line) => line.best || line.bestNonMega)
        .map((line) => line.lineKey),
    ),
    // The cached team's own line keys — incremental stays valid as long as these
    // survive, regardless of which other (unused) mons come and go.
    teamLineKeys: new Set(
      result.bestEvaluated.team
        .map((choice) => lineKeyByInput.get(choice.inputPokemonId))
        .filter(Boolean),
    ),
  };
}

function storeResult(poolKey, result) {
  if (resultCache.size >= MAX_RESULT_CACHE) resultCache.clear();
  resultCache.set(poolKey, result);
}

async function resolvePoolLineCached({ args, contextSig, hitLineKeys }) {
  const { group } = args;
  const inputId = group.input?.id ?? group.token;
  const cacheKey = `${inputId}|${contextSig}`;

  const cached = lineCache.get(cacheKey);
  if (cached) {
    if (cached.lineKey) hitLineKeys.add(cached.lineKey);
    return cached;
  }

  const line = await resolvePoolLine(args);
  if (lineCache.size >= MAX_LINE_CACHE) lineCache.clear();
  lineCache.set(cacheKey, line);
  return line;
}

// Stable, order-independent stringify for cache keys: object keys are sorted and
// array elements (which here are set-like — owned items, TM ids, bias) too.
function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).sort().join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${key}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function resolvePoolLine({
  availability,
  breedingContext,
  family,
  group,
  pokemonIndex,
  progression,
  selection,
}) {
  if (group.unresolved || !group.entries.length) {
    return {
      unresolved: true,
      inputName: group.token,
      lineKey: `unresolved:${group.token}`,
      best: null,
      bestNonMega: null,
      candidates: [],
    };
  }

  const input = group.input;
  const candidates = getLineRepresentativeCandidates(input.id, pokemonIndex);

  const scored = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        const bundle = await resolveRepresentativeLightBundle({
          availability,
          family,
          minMeaningfulUsagePercent: MIN_MEANINGFUL_USAGE_PERCENT,
          pokemonId: candidate.id,
          selection,
        });
        const legalityProfile = await resolveCandidateLegalityProfile({
          breedingContext,
          candidate,
          input,
          progression,
        });

        return {
          input,
          candidate,
          bundle,
          legalityProfile,
          ...scoreCandidate({
            availability,
            bundle,
            candidate,
            family,
            legalityProfile,
            opponentTypeBias: progression.opponentTypeBias,
          }),
        };
      } catch (error) {
        console.warn("Failed to score team-builder candidate", {
          candidate,
          error,
          input,
        });

        return {
          input,
          candidate,
          bundle: { usage: null, leads: null },
          score: -Infinity,
          meaningfulUsage: false,
          usagePercent: 0,
          rawCount: 0,
          leadPercent: 0,
          legalityProfile: null,
          error,
        };
      }
    }),
  );

  const ranked = scored
    .filter((candidate) => Number.isFinite(candidate.score))
    .sort(compareScoredCandidates);

  if (!ranked.length) {
    return {
      unresolved: false,
      inputName: input.name,
      lineKey: getLineKey(candidates, input.id),
      best: null,
      bestNonMega: null,
      candidates: scored,
    };
  }

  const best = ranked[0];
  const bestNonMega = ranked.find((entry) => !entry.candidate.isMega) || null;

  return {
    unresolved: false,
    inputName: input.name,
    lineKey: getLineKey(candidates, input.id),
    best: makeChoice(
      input,
      best,
      best.candidate.isMega ? "Best overall; uses Mega slot" : "Best overall",
    ),
    bestNonMega: bestNonMega
      ? makeChoice(
          input,
          bestNonMega,
          best.candidate.isMega ? "Best non-Mega fallback" : "Best non-Mega",
        )
      : null,
    choiceOptions: buildChoiceOptions(input, ranked, best, bestNonMega),
    candidates: ranked,
  };
}

function buildChoiceOptions(input, ranked, best, bestNonMega) {
  const options = [];

  for (const result of ranked.slice(0, 5)) {
    options.push(
      makeChoice(
        input,
        result,
        getChoiceOptionNote(result, best, bestNonMega),
      ),
    );
  }

  if (
    bestNonMega &&
    !options.some((choice) => choice.pokemonId === bestNonMega.candidate.id)
  ) {
    options.push(
      makeChoice(
        input,
        bestNonMega,
        getChoiceOptionNote(bestNonMega, best, bestNonMega),
      ),
    );
  }

  return options;
}

function getChoiceOptionNote(result, best, bestNonMega) {
  if (result.candidate.id === best.candidate.id) {
    return best.candidate.isMega
      ? "Best overall; uses Mega slot"
      : "Best overall";
  }

  if (bestNonMega && result.candidate.id === bestNonMega.candidate.id) {
    return best.candidate.isMega ? "Best non-Mega fallback" : "Best non-Mega";
  }

  return result.candidate.isMega
    ? "Team-fit option; uses Mega slot"
    : "Team-fit option";
}

function makeChoice(input, result, note) {
  const usageNote = result.meaningfulUsage
    ? note
    : `${note}; trace usage (<${MIN_MEANINGFUL_USAGE_PERCENT}%)`;
  const legalityNote = formatLegalityNote(result.legalityProfile);

  return {
    inputPokemonId: input.id,
    inputName: input.name,
    pokemonId: result.candidate.id,
    name: result.candidate.name,
    isMega: Boolean(result.candidate.isMega),
    score: result.score,
    teamScore: result.teamScore,
    meaningfulUsage: result.meaningfulUsage,
    legalityProfile: result.legalityProfile,
    legalityScore: result.legalityScore,
    bundle: result.bundle,
    note: legalityNote ? `${usageNote}; ${legalityNote}` : usageNote,
  };
}

function formatLegalityNote(profile) {
  if (!profile) return "";

  const bestStab = profile.bestStabMove?.name
    ? `best legal STAB: ${profile.bestStabMove.name}`
    : "no current legal STAB";

  return `${bestStab}; ${profile.attackTypes.length} recommended attack types`;
}

async function resolveCandidateLegalityProfile({
  breedingContext,
  candidate,
  input,
  progression,
}) {
  const choice = {
    inputPokemonId: input.id,
    inputName: input.name,
    pokemonId: candidate.id,
    name: candidate.name,
  };
  const currentSpecies = getCurrentRebornSpeciesForChoice(choice, progression);
  const legalMoveData = await loadRebornLegalMoveData(
    currentSpecies?.id || candidate.id,
  );
  const memberProgression = applyBreedingContextToProgression(
    progression,
    legalMoveData?.pokemonId,
    breedingContext,
  );
  const member = {
    id: currentSpecies?.id || candidate.id,
    inputName: input.name,
    name: currentSpecies?.name || candidate.name,
    representativeId: candidate.id,
    representativeName: currentSpecies?.differsFromRepresentative
      ? currentSpecies.representativeName
      : "",
    types: legalMoveData?.types || [],
  };
  const moves = getAvailableRebornMoves(legalMoveData, memberProgression);

  return buildCandidateLegalityProfile({
    member,
    moves,
    representativeName: candidate.name,
    levelCap: progression.levelCap,
    opponentTypeBias: progression.opponentTypeBias,
  });
}

function getLineKey(candidates, fallbackId) {
  if (!candidates.length) return fallbackId;

  return candidates
    .map((candidate) => candidate.id)
    .sort()
    .join("|");
}
