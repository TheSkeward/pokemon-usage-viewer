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
import { loadTopSet } from "../reborn/topSpread.js";
import { buildInputGroups } from "./inputGroups";
import { parseAbilityAnnotations } from "./poolParsing";
import { normalizeName } from "./nameUtils";
import { tunable, scoringOverridesSignature } from "./scoringConstants.js";
import { utilityValue } from "./currentFormValue.js";
import {
  MIN_MEANINGFUL_USAGE_PERCENT,
  compareScoredCandidates,
  scoreCandidate,
} from "./candidateScoring";
import { resolveRepresentativeLightBundle } from "./representativeBundle";
import { choosePoolTeam } from "./teamSelection";
import { loadPersistedResults, persistResult } from "./resultCacheStore.js";
import { getDataSignature } from "../manifest.js";

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

// Layer 3 is also persisted to IndexedDB (resultCacheStore) so it survives page
// reloads. Bump this whenever a change alters optimizer output (scoring, the
// search, or the legality/damage model): a mismatched version retires the stored
// results so a reload after such a deploy recomputes rather than showing stale
// teams. UI-only deploys keep the version, so results survive them.
const RESULT_CACHE_VERSION = "9";

// Hydrate the in-memory memo from persisted results once, lazily. optimize()
// awaits this before consulting the memo so a reload-then-same-pool is a hit.
let hydration = null;
function ensureHydrated() {
  if (!hydration) {
    hydration = loadPersistedResults(RESULT_CACHE_VERSION)
      .then((entries) => {
        for (const [poolKey, result] of entries) {
          if (!resultCache.has(poolKey)) resultCache.set(poolKey, result);
        }
      })
      .catch(() => {});
  }
  return hydration;
}

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

  // Restore any persisted results before checking the memo, so a pool computed in
  // a previous session (e.g. before a reload) is answered without recomputing.
  await ensureHydrated();

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
  // Ability annotations ("Froakie (Torrent)") change a line's builds, so they
  // are part of the score context too.
  const abilityAnnotations = parseAbilityAnnotations(query, pokemonIndex);
  const abilitySig = abilityAnnotations.size
    ? [...abilityAnnotations.entries()]
        .sort()
        .map(([name, ability]) => `${name}=${ability}`)
        .join(",")
    : "none";
  // Scoring overrides (confidence sweep / tests) and the DATA signature are part
  // of the score context: a sweep run must never hit — or seed — the production
  // ("base") caches, and a data refresh must retire every cached verdict.
  const contextSig = `${family}|${selection}|${progressionSig}|${breedingSig}|${abilitySig}|${scoringOverridesSignature()}|${await getDataSignature()}`;

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
  const resolveStart = Date.now();

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
            abilityAnnotations,
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

  const searchStart = Date.now();
  const result = await choosePoolTeam(lines, progression.opponentTypeBias, {
    exhaustive,
    incremental,
    // The team store is keyed on the same context as the incremental cache, so a
    // deletion to an unvisited subset is answered from the last full search.
    searchKey,
  });
  // Wall-clock telemetry (roadmap: performance visibility): how long line
  // resolution vs the search actually took, surfaced in the provenance footer.
  result.timings = {
    resolveMs: searchStart - resolveStart,
    searchMs: Date.now() - searchStart,
  };

  seedSearchCache(result, lines, searchKey);
  storeResult(poolKey, result);
  // Persist for future sessions (fire-and-forget; failures are silent no-ops).
  persistResult(RESULT_CACHE_VERSION, poolKey, result);

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
  abilityAnnotations = null,
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
  const abilityOverride =
    abilityAnnotations?.get(normalizeName(input.name)) || null;

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
        const builds = await resolveCandidateBuilds({
          breedingContext,
          candidate,
          family,
          input,
          progression,
          selection,
          abilityOverride,
        });
        const levelCap = Number.parseInt(progression.levelCap, 10) || 0;
        const scoreOf = (legalityProfile) =>
          scoreCandidate({
            availability,
            bundle,
            candidate,
            family,
            legalityProfile,
            levelCap,
            opponentTypeBias: progression.opponentTypeBias,
          });

        const scoredBuilds = builds.variants
          .map((variant) => ({
            input,
            candidate,
            bundle,
            buildKey: variant.key,
            buildLabel: variant.label,
            legalityProfile: variant.profile,
            ...scoreOf(variant.profile),
          }))
          .filter((row) => Number.isFinite(row.score));
        if (!scoredBuilds.length) {
          // No usage bundle for this form (e.g. a mega with no ladder data):
          // an unscoreable candidate, filtered by the ranked cut — not an error.
          return {
            input,
            candidate,
            bundle,
            score: -Infinity,
            teamScore: -Infinity,
            meaningfulUsage: false,
            usagePercent: 0,
            rawCount: 0,
            leadPercent: 0,
            legalityProfile: builds.variants[0]?.profile || null,
          };
        }

        // Ability sensitivity: how much V rests on the ability ASSUMPTION
        // (primary vs secondary on the same set). Zero when the user pinned the
        // ability. Stored on every build so the sweep's "assume the secondary
        // ability" axis and the explanation layer can both use it.
        if (builds.sensitivityProbe) {
          const probe = scoreOf(builds.sensitivityProbe);
          const defaultRow =
            scoredBuilds.find((row) => row.buildKey === "default") ||
            scoredBuilds[0];
          const sensitivity = Number.isFinite(probe.score)
            ? Math.max(0, Math.round(defaultRow.score - probe.score))
            : 0;
          for (const row of scoredBuilds) {
            row.abilitySensitivity = sensitivity;
            row.legalityProfile.abilitySensitivity = sensitivity;
          }
        }

        const kept = pruneDominatedBuilds(scoredBuilds);
        kept.sort(compareScoredCandidates);
        const best = kept[0];
        // Choice-shaped builds for the post-selection realization pass, built
        // BEFORE tagging `best` so there is no self-nesting.
        const buildChoices = kept.map((row) =>
          makeChoice(input, row, row.buildLabel || "Build"),
        );
        best.buildChoices = buildChoices;
        best.optimisticCoverageVector = optimisticCoverageVector(kept);
        return best;
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

// Dominance pruning across a candidate's build variants — on MECHANICAL facts
// only (coverage into every defense type, utility value, peak damage, friction),
// never on scored value: the confidence sweep perturbs the value weights, so a
// build pruned "because it scores lower under today's constants" could be
// exactly the alternative a sweep setting needs. Pruning on facts that no sweep
// axis can reorder keeps the robustness test honest (friction scales uniformly
// under FRICTION_SCALE, so ≤ friction is scale-invariant). Keep at most four
// (realization enumerates ≤4^6 — trivial); the default build is always kept as
// the canonical honest set.
function pruneDominatedBuilds(rows) {
  const facts = rows.map((row) => ({
    coverage: row.legalityProfile?.coverageVector || [],
    utility: utilityValue(row.legalityProfile?.recommendedMoves),
    peak: Math.max(
      row.legalityProfile?.bestStabMove?.estimatedDamage || 0,
      row.legalityProfile?.bestDamagingMove?.estimatedDamage || 0,
    ),
    friction: row.legalityProfile?.frictionCost || 0,
  }));
  const dominates = (a, b) => {
    if (facts[a].friction > facts[b].friction) return false;
    if (facts[a].utility < facts[b].utility - 1e-9) return false;
    if (facts[a].peak < facts[b].peak - 1e-9) return false;
    const ca = facts[a].coverage;
    const cb = facts[b].coverage;
    for (let i = 0; i < cb.length; i++) {
      if ((ca[i] || 0) < (cb[i] || 0) - 1e-9) return false;
    }
    return true;
  };

  const kept = [];
  for (let b = 0; b < rows.length; b++) {
    const dominated = rows.some((_, a) => {
      if (a === b) return false;
      if (!dominates(a, b)) return false;
      // Mutually-equal twins: keep the earlier (default-first) one only.
      if (dominates(b, a)) return a < b;
      return true;
    });
    if (!dominated || rows[b].buildKey === "default") kept.push(rows[b]);
  }
  // Deterministic, value-free ordering: default first, then by mechanical
  // richness (coverage mass), then friction.
  const coverageMass = (row) =>
    (row.legalityProfile?.coverageVector || []).reduce((sum, v) => sum + v, 0);
  kept.sort(
    (a, b) =>
      Number(b.buildKey === "default") - Number(a.buildKey === "default") ||
      coverageMass(b) - coverageMass(a) ||
      (a.legalityProfile?.frictionCost || 0) -
        (b.legalityProfile?.frictionCost || 0),
  );
  return kept.slice(0, 4);
}

// Element-wise max of the kept builds' coverage vectors: the line's optimistic
// coverage for team SELECTION (a relaxation — realized by assignTeamBuilds).
function optimisticCoverageVector(rows) {
  let vector = null;
  for (const row of rows) {
    const cv = row.legalityProfile?.coverageVector;
    if (!cv) continue;
    if (!vector) vector = [...cv];
    else for (let i = 0; i < vector.length; i++) vector[i] = Math.max(vector[i], cv[i] || 0);
  }
  return vector;
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
    friction: result.friction,
    currentRole: result.currentRole,
    currentFeatures: result.currentFeatures,
    ceiling: result.ceiling,
    online: result.online,
    futureValue: result.futureValue,
    buildKey: result.buildKey || "default",
    buildLabel: result.buildLabel || null,
    abilitySensitivity: result.abilitySensitivity || 0,
    ...(result.buildChoices ? { buildAlternatives: result.buildChoices } : {}),
    ...(result.optimisticCoverageVector
      ? { optimisticCoverageVector: result.optimisticCoverageVector }
      : {}),
    bundle: result.bundle,
    note: legalityNote ? `${usageNote}; ${legalityNote}` : usageNote,
  };
}

function formatLegalityNote(profile) {
  if (!profile) return "";

  const bestStab = profile.bestStabMove?.name
    ? `best legal STAB: ${profile.bestStabMove.name}`
    : "no current legal STAB";

  // Make the assumed ability visible when it materially changes damage, so the
  // score isn't silently claiming e.g. Protean without saying so.
  const ability = String(profile.assumedAbility || "").toLowerCase();
  const abilityNote =
    ability === "protean" || ability === "adaptability"
      ? `; scored assuming ${profile.assumedAbility}`
      : "";

  return `${bestStab}; ${profile.attackTypes.length} recommended attack types${abilityNote}`;
}

// Generates the candidate's BUILD VARIANTS (roadmap Phase 3): a build is a
// concrete (form, ability, move set, friction) with its own legality profile
// and coverage vector. 2–4 plausible builds per viable form:
//   default   — the usage-anchored competitive set (natural evolution path)
//   coverage  — maximizes distinct real attacking coverage
//   utility   — leads with role moves (recovery/hazards/speed control)
//   delayed   — the default set allowed to use delayed-evolution moves, paying
//               DELAYED_EVO_FRICTION and labelled
// plus, when the caught mon's ability is UNKNOWN, a secondary-ability probe
// used only to measure ability sensitivity (the optimizer must never "choose"
// an ability the player doesn't control; a user annotation pins it instead).
async function resolveCandidateBuilds({
  breedingContext,
  candidate,
  family,
  input,
  progression,
  selection,
  abilityOverride = null,
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
  // The DEFAULT build assumes the natural evolution path: moves that would
  // require delaying an evolution are split into a friction-costed variant,
  // never silently assumed.
  const naturalMoves = moves.filter((move) => !move.delayedEvolution);
  const delayedMoves = moves.filter((move) => move.delayedEvolution);

  // Ability: a user annotation ("Froakie (Torrent)") pins the caught mon's real
  // ability; otherwise assume the represented form's primary competitive
  // ability (what the usage prior itself reflects) and measure sensitivity
  // against the secondary.
  const topSet = await loadTopSet({
    family,
    pokemonId: candidate.id,
    selection,
  });
  const abilityChoices = topSet?.abilities || [];
  const matchedOverride = abilityOverride
    ? abilityChoices.find(
        (entry) => entry.name.toLowerCase() === abilityOverride.toLowerCase(),
      )?.name || null
    : null;
  const assumedAbility = matchedOverride || topSet?.ability || null;
  const abilityKnown = Boolean(matchedOverride);
  const secondaryAbility =
    !abilityKnown && abilityChoices.length > 1
      ? abilityChoices.find((entry) => entry.name !== assumedAbility)?.name ||
        null
      : null;

  const evolution = currentSpecies
    ? {
        friction: currentSpecies.evolutionFriction || 0,
        steps: currentSpecies.evolutionSteps || [],
        blocked: currentSpecies.blockedEvolutions || [],
      }
    : { friction: 0, steps: [], blocked: [] };

  const makeProfile = ({ movePreference, buildMoves, buildFriction = 0, ability }) => {
    const profile = buildCandidateLegalityProfile({
      member,
      moves: buildMoves,
      representativeName: candidate.name,
      levelCap: progression.levelCap,
      ability,
      evolution,
      buildFriction,
      opponentTypeBias: progression.opponentTypeBias,
      movePreference,
    });
    profile.abilityKnown = abilityKnown;
    profile.abilityOptions = abilityChoices;
    return profile;
  };

  const variants = [
    {
      key: "default",
      label: "Standard set",
      profile: makeProfile({
        movePreference: "default",
        buildMoves: naturalMoves,
        ability: assumedAbility,
      }),
    },
    {
      key: "coverage",
      label: "Coverage set",
      profile: makeProfile({
        movePreference: "coverage",
        buildMoves: naturalMoves,
        ability: assumedAbility,
      }),
    },
    {
      key: "utility",
      label: "Utility set",
      profile: makeProfile({
        movePreference: "utility",
        buildMoves: naturalMoves,
        ability: assumedAbility,
      }),
    },
  ];

  if (delayedMoves.length) {
    const delayedProfile = makeProfile({
      movePreference: "default",
      buildMoves: [...naturalMoves, ...delayedMoves],
      ability: assumedAbility,
    });
    const delayedIds = new Set(delayedMoves.map((move) => move.id));
    const usedDelayed = (delayedProfile.recommendedMoves || []).filter((move) =>
      delayedIds.has(move.id),
    );
    // Only a distinct build if the set actually uses a delayed move; then it
    // pays the delayed-evolution K and says which move required the delay.
    if (usedDelayed.length) {
      delayedProfile.frictionCost += tunable("DELAYED_EVO_FRICTION");
      delayedProfile.legalityProof.buildFriction = tunable("DELAYED_EVO_FRICTION");
      delayedProfile.legalityProof.delayedMoves = usedDelayed.map((move) => ({
        name: move.name,
        source: move.availableSources?.[0]?.label || "delayed evolution",
      }));
      variants.push({
        key: "delayed",
        label: `Delayed-evolution set (${usedDelayed.map((m) => m.name).join(", ")})`,
        profile: delayedProfile,
      });
    }
  }

  // Sensitivity probe: same default set, secondary ability. Never a competing
  // build — only a measurement.
  const sensitivityProbe = secondaryAbility
    ? makeProfile({
        movePreference: "default",
        buildMoves: naturalMoves,
        ability: secondaryAbility,
      })
    : null;

  return { variants, sensitivityProbe, assumedAbility, abilityKnown, secondaryAbility };
}

function getLineKey(candidates, fallbackId) {
  if (!candidates.length) return fallbackId;

  return candidates
    .map((candidate) => candidate.id)
    .sort()
    .join("|");
}
