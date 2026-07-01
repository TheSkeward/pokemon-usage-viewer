import {
  REBORN_ANALYSIS_TYPES,
  getTypeMultiplier,
  prepareFitScoring,
  resetFitScoring,
  getLineChoiceOptions,
  getTeamScore,
  getUsagePercent,
  compareChoices,
  bestAssignmentForLines,
  evaluateTeam,
  betterEvaluated,
  teamIdentityKey,
  getTeamSizePriority,
  forEachCombination,
} from "./searchKernel.js";
import { parallelFullSearch, PARALLEL_THRESHOLD } from "./parallelSearch.js";

export async function choosePoolTeam(
  lines,
  opponentTypeBias = {},
  { exhaustive = true, incremental = null, searchKey = null } = {},
) {
  const resolvedLines = lines.filter((line) => line.best || line.bestNonMega);
  const unresolved = lines.filter((line) => line.unresolved);
  const bestTeam = await selectTeamByFit(resolvedLines, opponentTypeBias, {
    exhaustive,
    incremental,
    searchKey,
  });
  const evaluated = bestTeam.evaluated;
  const team = addTeamFitNotes(evaluated.team);
  const megaUsed = evaluated.megaUsed
    ? team.find(
        (choice) =>
          choice.inputPokemonId === evaluated.megaUsed.inputPokemonId &&
          choice.pokemonId === evaluated.megaUsed.pokemonId,
      )
    : null;

  return {
    team,
    megaUsed,
    lines,
    unresolved,
    linesConsidered: resolvedLines.length,
    searchExact: bestTeam.searchExact !== false,
    // Per non-selected line, the best team score achievable by swapping it onto
    // the optimal team — used by the bench view to flag the most droppable mon
    // (coverage-aware, not just by usage tier).
    benchSwapScores: bestTeam.benchSwapScores || null,
    // The raw (pre-note) winning team, so the optimizer can cache it and grow
    // the search incrementally next time. Only exact results are safe to seed.
    bestEvaluated: bestTeam.searchExact ? evaluated : null,
  };
}

function addTeamFitNotes(team) {
  const attackTypeCounts = new Map();

  for (const choice of team) {
    for (const attackType of choice.legalityProfile?.attackTypes || []) {
      attackTypeCounts.set(
        attackType,
        (attackTypeCounts.get(attackType) || 0) + 1,
      );
    }
  }

  return team.map((choice) => {
    const reasons = getTeamFitReasons(choice, team, attackTypeCounts);
    if (!reasons.length) return choice;

    return {
      ...choice,
      note: `${choice.note}; team fit: ${reasons.join("; ")}`,
    };
  });
}

function getTeamFitReasons(choice, team, attackTypeCounts) {
  const profile = choice.legalityProfile;
  if (!profile) return [];

  const reasons = [];
  const uniqueAttackTypes = (profile.attackTypes || []).filter(
    (type) => attackTypeCounts.get(type) === 1,
  );
  const defensiveCovers = getDefensiveCoverTypes(profile, team);

  if (uniqueAttackTypes.length) {
    reasons.push(`adds ${uniqueAttackTypes.slice(0, 2).join("/")} attacks`);
  }

  if (defensiveCovers.length) {
    reasons.push(`covers ${defensiveCovers.slice(0, 2).join("/")}`);
  }

  return reasons.slice(0, 2);
}

function getDefensiveCoverTypes(profile, team) {
  return REBORN_ANALYSIS_TYPES.filter((attackType) => {
    const multiplier = getTypeMultiplier(attackType, profile.currentTypes || []);
    if (!(multiplier === 0 || (multiplier > 0 && multiplier < 1))) {
      return false;
    }

    const weakCount = team.filter((choice) => {
      const types = choice.legalityProfile?.currentTypes || [];
      return getTypeMultiplier(attackType, types) > 1;
    }).length;

    return weakCount > 0;
  });
}

// A team's score is intrinsic to its own members, so the optimum is the argmax
// over all teams of the target size — which means it must NOT depend on what
// else is sitting unused in the pool. The old beam (keep the top-N partial teams
// each step) was lossy and order-coupled, so adding an unused mon could perturb
// which partial teams survived and flip a near-tie. We now enumerate teams
// exactly whenever that's affordable, and only fall back to a (wide,
// deterministic) beam for pools too large to enumerate.
//
// Budgets are in number of team combinations C(N, size). The explicit Optimize
// button enumerates up to a high ceiling; background auto-reoptimize uses a
// budget that now matches it for the pools people actually build, falling back
// to the fast beam only beyond that. After the deferred-identity + memoized-
// options speedup, both cover a full 36-line pool exactly: 2M ≈ a 36-line pool
// (C(36,6) ≈ 1.95M), and the explicit ceiling adds headroom to ~38 lines
// (C(38,6) ≈ 2.76M). Big searches run across Web Workers, so they're off the main
// thread and core-count faster; most edits never hit them anyway — the incremental
// path is exact regardless of budget; the budget only gates a from-scratch search.
const AUTO_EXHAUSTIVE_BUDGET = 2_000_000;
const HARD_EXHAUSTIVE_CAP = 3_000_000;
const BEAM_WIDTH = 2000;
// For pools too big to enumerate fully (C(N,6) over the cap — roughly N > 38), we
// reduce to a shortlist and enumerate THAT exactly, instead of a lossy beam. The
// shortlist keeps the top mons by individual score plus the best provider of each
// attack type and each defensive resist, so no mon that could earn a slot on
// quality OR coverage is pruned before the optimiser sees it. C(28,6) ≈ 376k
// (above the parallel threshold, so it runs across the Web Worker pool like any
// other big search). This is what makes a 100-mon pool usable — exact on a
// coverage-preserving shortlist instead of the old lossy beam.
const SHORTLIST_MAX = 28;
const SHORTLIST_CORE = 20;

// --- Full-enumeration team store -------------------------------------------
// When a SEQUENTIAL exact search enumerates every C(N, size) team, we keep them
// all — each team's line positions + score — keyed by the score context. The
// optimum of ANY sub-pool is then just the best stored team that uses only
// surviving lines, so a deletion to a never-visited subset is answered by a fast
// scan instead of a re-search. Big pools take the parallel path, which does NOT
// build a store (so it's invalidated there) — a subset-delete of a big pool just
// re-searches in parallel; small pools keep the instant scan.
let teamStore = null;

function createTeamStore(searchKey, lines, targetSize, capacity) {
  const posToLineKey = lines.map((line) => line.lineKey);
  return {
    searchKey,
    targetSize,
    posToLineKey,
    lineKeyToPos: new Map(posToLineKey.map((key, i) => [key, i])),
    count: 0,
    positions: new Uint8Array(capacity * targetSize),
    scores: new Float32Array(capacity),
  };
}

function recordStoreTeam(store, comboPositions, evaluated) {
  const index = store.count++;
  const base = index * store.targetSize;
  for (let j = 0; j < store.targetSize; j++) {
    store.positions[base + j] = comboPositions[j];
  }
  store.scores[index] = evaluated.score;
}

// The current pool is a subset of the stored full search — same context, same
// target size, every current line present — so the store holds every team it can
// form and a scan yields the exact optimum.
function teamStoreCovers(searchKey, lines, targetSize) {
  if (!teamStore || teamStore.searchKey !== searchKey) return false;
  if (teamStore.targetSize !== targetSize) return false;
  for (const line of lines) {
    if (!teamStore.lineKeyToPos.has(line.lineKey)) return false;
  }
  return true;
}

function queryTeamStore(lines, targetSize, opponentTypeBias) {
  const store = teamStore;
  const lineByKey = new Map(lines.map((line) => [line.lineKey, line]));
  const allowed = new Uint8Array(store.posToLineKey.length);
  for (const line of lines) allowed[store.lineKeyToPos.get(line.lineKey)] = 1;

  const size = store.targetSize;
  let bestScore = -Infinity;
  let ties = [];
  for (let i = 0; i < store.count; i++) {
    const base = i * size;
    let ok = true;
    for (let j = 0; j < size; j++) {
      if (!allowed[store.positions[base + j]]) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const score = store.scores[i];
    if (score > bestScore) {
      bestScore = score;
      ties = [base];
    } else if (score === bestScore) {
      ties.push(base);
    }
  }
  if (!ties.length) return { team: [], megaUsed: null };

  // Reconstruct the (rare) score-tied teams and pick with the full comparator, so
  // the deterministic identity tie-break matches a live search exactly.
  let best = null;
  for (const base of ties) {
    const comboLines = [];
    for (let j = 0; j < size; j++) {
      comboLines.push(lineByKey.get(store.posToLineKey[store.positions[base + j]]));
    }
    const candidate = bestAssignmentForLines(comboLines, targetSize, opponentTypeBias);
    if (candidate && (!best || betterEvaluated(candidate, best))) best = candidate;
  }
  return best || { team: [], megaUsed: null };
}

async function selectTeamByFit(
  lines,
  opponentTypeBias = {},
  { exhaustive = true, incremental = null, searchKey = null } = {},
) {
  const targetSize = Math.min(6, lines.length);
  if (targetSize === 0) {
    return { evaluated: { team: [], megaUsed: null }, searchExact: true, benchSwapScores: new Map() };
  }

  // Decide the path from cheap synchronous checks.
  const incApplies = incrementalApplicable(incremental, lines, targetSize);
  const addedCount = incApplies
    ? lines.filter((line) => !incremental.baseLineKeys.has(line.lineKey)).length
    : 0;
  const combinations = countCombinations(lines.length, targetSize);
  const budget = exhaustive ? HARD_EXHAUSTIVE_CAP : AUTO_EXHAUSTIVE_BUDGET;

  // A from-scratch / grown search big enough to be worth it runs in parallel off
  // the main thread. A pure deletion (incremental, no added lines) and a
  // store-covered subset stay on their instant sequential paths; an addition
  // takes the parallel full enumeration (exact, and core-count fast).
  const isPureDeletion = incApplies && addedCount === 0;
  const isStoreCovered = !!searchKey && teamStoreCovers(searchKey, lines, targetSize);
  // Test hook (regret validation only): force the shortlist path even on a pool
  // small enough to enumerate fully, so its optimum can be compared to the true
  // exact optimum. No effect in production (the global is never set).
  const forceShortlist =
    !!globalThis.__FORCE_SHORTLIST__ && !incApplies && !isStoreCovered;
  const useParallel =
    !forceShortlist &&
    !isPureDeletion &&
    !isStoreCovered &&
    combinations <= budget &&
    combinations >= PARALLEL_THRESHOLD;

  if (useParallel) {
    // The parallel path doesn't build a team store; drop any stale one.
    teamStore = null;
    const compactLines = buildCompactLines(lines);
    const bestRefs = await parallelFullSearch(
      compactLines,
      targetSize,
      opponentTypeBias,
      combinations,
    );
    prepareFitScoring(lines, opponentTypeBias);
    try {
      const evaluated = bestRefs
        ? evaluatedFromRefs(bestRefs, lines, targetSize, opponentTypeBias)
        : null;
      if (evaluated) {
        const benchSwapScores = computeBenchSwapScores(
          lines,
          evaluated.team,
          opponentTypeBias,
        );
        return { evaluated, searchExact: true, benchSwapScores };
      }
    } finally {
      resetFitScoring(lines);
    }
    // Unmappable result (shouldn't happen) — fall through to a sequential search.
  }

  prepareFitScoring(lines, opponentTypeBias);
  try {
    let evaluated;
    let searchExact;

    if (incApplies) {
      // Reuse the cached optimum: instant for a pure deletion, or enumerate the
      // teams that include a newly-added line (small pools; big adds went parallel).
      evaluated = selectTeamExhaustive(lines, targetSize, opponentTypeBias, incremental, null);
      searchExact = true;
    } else if (isStoreCovered) {
      evaluated = queryTeamStore(lines, targetSize, opponentTypeBias);
      searchExact = true;
    } else if (combinations <= budget && !forceShortlist) {
      // Sequential full enumeration: record every team so later subsets of this
      // pool are answered by queryTeamStore.
      const store = searchKey
        ? createTeamStore(searchKey, lines, targetSize, combinations)
        : null;
      evaluated = selectTeamExhaustive(lines, targetSize, opponentTypeBias, null, store);
      if (store) teamStore = store;
      searchExact = true;
    } else {
      // Too big to enumerate fully: reduce to a coverage-preserving shortlist and
      // enumerate THAT exactly (far better than the old lossy beam). Route through
      // the Web Worker pool when it's worth it, so a big pool still uses all cores.
      const shortlist = buildShortlist(lines);
      const shortSize = Math.min(6, shortlist.length);
      const shortCombos = countCombinations(shortlist.length, shortSize);
      let shortEvaluated = null;
      if (shortCombos >= PARALLEL_THRESHOLD) {
        const compactLines = buildCompactLines(shortlist);
        const bestRefs = await parallelFullSearch(
          compactLines,
          shortSize,
          opponentTypeBias,
          shortCombos,
        );
        if (bestRefs) {
          shortEvaluated = evaluatedFromRefs(
            bestRefs,
            shortlist,
            shortSize,
            opponentTypeBias,
          );
        }
      }
      evaluated =
        shortEvaluated ||
        selectTeamExhaustive(shortlist, shortSize, opponentTypeBias, null, null);
      searchExact = false; // exact on the shortlist, not the whole pool
    }

    // Rank the non-selected lines by how much the team would suffer if forced to
    // field them — independent of which search ran above.
    const benchSwapScores = computeBenchSwapScores(
      lines,
      evaluated.team,
      opponentTypeBias,
    );

    return { evaluated, searchExact, benchSwapScores };
  } finally {
    resetFitScoring(lines);
  }
}

// Trims each line to the minimal, structured-cloneable shape a worker needs to
// score teams: the form options (pre-deduped/ordered by getLineChoiceOptions),
// each with its types, team-score, mega flag, and identity. No legality profile
// internals, bundles, or move data — keeps the worker message tiny.
function buildCompactLines(lines) {
  return lines.map((line) => ({
    lineKey: line.lineKey,
    choiceOptions: getLineChoiceOptions(line).map((choice) => ({
      inputPokemonId: choice.inputPokemonId,
      pokemonId: choice.pokemonId,
      isMega: !!choice.isMega,
      teamScore: choice.teamScore ?? choice.score ?? 0,
      legalityProfile: {
        attackTypes: choice.legalityProfile?.attackTypes || [],
        currentTypes: choice.legalityProfile?.currentTypes || [],
        coverageVector: choice.legalityProfile?.coverageVector || null,
      },
    })),
  }));
}

// Maps the parallel search's compact id refs back to the real choice objects and
// re-evaluates the team on the main thread (so it carries full legality profiles
// for display and seeding). Returns null if any ref can't be mapped.
function evaluatedFromRefs(bestRefs, lines, targetSize, opponentTypeBias) {
  const byKey = new Map();
  for (const line of lines) {
    for (const choice of getLineChoiceOptions(line)) {
      byKey.set(`${choice.inputPokemonId}|${choice.pokemonId}`, choice);
    }
  }

  const team = [];
  for (const ref of bestRefs.team) {
    const choice = byKey.get(`${ref.inputPokemonId}|${ref.pokemonId}`);
    if (!choice) return null;
    team.push(choice);
  }
  const megaUsed = bestRefs.megaUsed
    ? byKey.get(`${bestRefs.megaUsed.inputPokemonId}|${bestRefs.megaUsed.pokemonId}`) || null
    : null;

  return evaluateTeam(team, megaUsed, targetSize, opponentTypeBias);
}

// For each line not on the optimal team, the best team score achievable by
// swapping it in for one of the starters (best over the line's form options and
// the slot it replaces, honouring the one-Mega limit). A high score means the
// pool genuinely wants this mon — its coverage nearly justifies a starter slot —
// so it should NOT read as the "worst"; a low score means even its best swap-in
// is weak, i.e. it's the most droppable. Returns inputPokemonId -> best score.
function computeBenchSwapScores(lines, team, opponentTypeBias) {
  const scores = new Map();
  if (!team.length) return scores;

  const teamInputIds = new Set(team.map((choice) => choice.inputPokemonId));

  for (const line of lines) {
    const representative = line.best || line.bestNonMega;
    if (!representative) continue;
    if (teamInputIds.has(representative.inputPokemonId)) continue;

    let best = -Infinity;
    for (const form of getLineChoiceOptions(line)) {
      for (let slot = 0; slot < team.length; slot += 1) {
        const swapped = team.slice();
        swapped[slot] = form;

        let megaCount = 0;
        for (const choice of swapped) if (choice.isMega) megaCount += 1;
        if (megaCount > 1) continue;

        const score = getTeamScore(swapped, opponentTypeBias);
        if (score > best) best = score;
      }
    }

    if (best > -Infinity) scores.set(representative.inputPokemonId, best);
  }

  return scores;
}

// Incremental is valid when the cached optimum is a full team of the same target
// size and all of the cached TEAM's lines are still present. Non-team lines may
// have been removed — the optimum is invariant to unused mons, so a deletion
// that doesn't touch the team is reused as-is, and an addition grows the search.
function incrementalApplicable(incremental, lines, targetSize) {
  if (!incremental?.previousBest?.team?.length) return false;
  if (incremental.previousBest.team.length !== targetSize) return false;
  const present = new Set(lines.map((line) => line.lineKey));
  for (const key of incremental.teamLineKeys || incremental.baseLineKeys) {
    if (!present.has(key)) return false;
  }
  return true;
}

// Streams every team of the target size, keeping the single best. With
// `incremental`, it seeds the best from the cached optimum and only enumerates
// teams containing at least one newly-added line.
function selectTeamExhaustive(lines, targetSize, opponentTypeBias, incremental, recordStore) {
  let best = null;

  if (incremental) {
    best = evaluateTeam(
      incremental.previousBest.team,
      incremental.previousBest.megaUsed,
      targetSize,
      opponentTypeBias,
    );
    const baseKeys = incremental.baseLineKeys;
    const added = lines.filter((line) => !baseKeys.has(line.lineKey));
    const old = lines.filter((line) => baseKeys.has(line.lineKey));

    // Teams with exactly `a` added lines and `targetSize - a` old lines, for
    // a = 1..; this enumerates every team with >=1 added line, once each.
    const maxAdded = Math.min(targetSize, added.length);
    for (let a = 1; a <= maxAdded; a++) {
      const fromOld = targetSize - a;
      if (fromOld < 0 || fromOld > old.length) continue;
      forEachCombination(added.length, a, (addedIdx) => {
        const addedLines = addedIdx.map((i) => added[i]);
        forEachCombination(old.length, fromOld, (oldIdx) => {
          const comboLines = addedLines.concat(oldIdx.map((i) => old[i]));
          const candidate = bestAssignmentForLines(comboLines, targetSize, opponentTypeBias);
          if (candidate && (!best || betterEvaluated(candidate, best))) best = candidate;
        });
      });
    }
    return best || { team: [], megaUsed: null };
  }

  forEachCombination(lines.length, targetSize, (comboIndices) => {
    const comboLines = comboIndices.map((index) => lines[index]);
    const candidate = bestAssignmentForLines(comboLines, targetSize, opponentTypeBias);
    if (!candidate) return;
    if (recordStore) recordStoreTeam(recordStore, comboIndices, candidate);
    if (!best || betterEvaluated(candidate, best)) best = candidate;
  });

  return best || { team: [], megaUsed: null };
}

function countCombinations(n, k) {
  if (k < 0 || k > n) return 0;
  const r = Math.min(k, n - k);
  let result = 1;
  for (let i = 0; i < r; i++) {
    result = (result * (n - i)) / (i + 1);
    if (result > HARD_EXHAUSTIVE_CAP * 8) return Infinity;
  }
  return Math.round(result);
}

// Reduces a too-big pool to a shortlist that the optimiser can enumerate exactly.
// Keeps the top mons by individual score (SHORTLIST_CORE) plus the best-scoring
// provider of every attack type and every defensive resist, so a coverage answer
// that isn't a top individual still gets a fair hearing. Deterministic (scored
// order + fixed type order), so the shortlist — and thus the result — is stable.
function buildShortlist(lines) {
  const scored = lines
    .map((line) => {
      const best = getLineChoiceOptions(line)[0];
      return { line, best, score: best?.teamScore ?? best?.score ?? 0 };
    })
    .sort(
      (a, b) =>
        b.score - a.score || a.line.lineKey.localeCompare(b.line.lineKey),
    );

  const maxSize = globalThis.__SHORTLIST_MAX__ ?? SHORTLIST_MAX;
  const coreSize = Math.min(SHORTLIST_CORE, maxSize);
  const picked = new Map();
  const add = (entry) => {
    if (entry && !picked.has(entry.line.lineKey)) {
      picked.set(entry.line.lineKey, entry.line);
    }
  };

  for (let i = 0; i < scored.length && picked.size < coreSize; i++) {
    add(scored[i]);
  }
  for (const type of REBORN_ANALYSIS_TYPES) {
    if (picked.size >= maxSize) break;
    add(
      scored.find((s) =>
        (s.best?.legalityProfile?.attackTypes || []).includes(type),
      ),
    );
    if (picked.size >= maxSize) break;
    add(
      scored.find(
        (s) =>
          getTypeMultiplier(type, s.best?.legalityProfile?.currentTypes || []) <
          1,
      ),
    );
  }
  for (const s of scored) {
    if (picked.size >= maxSize) break;
    add(s);
  }
  return [...picked.values()];
}

// Fallback for pools too large to enumerate exactly: the incremental beam, just
// widened and using the same deterministic comparator.
function selectTeamByBeam(lines, targetSize, opponentTypeBias) {
  let states = [{ lineKeys: new Set(), megaUsed: null, team: [] }];

  for (const line of orderLinesForSelection(lines)) {
    const nextStates = [...states];
    const options = getLineChoiceOptions(line);

    for (const state of states) {
      if (state.team.length >= targetSize) continue;
      if (state.lineKeys.has(line.lineKey)) continue;

      for (const choice of options) {
        if (choice.isMega && state.megaUsed) continue;

        nextStates.push({
          lineKeys: new Set([...state.lineKeys, line.lineKey]),
          megaUsed: choice.isMega ? choice : state.megaUsed,
          team: [...state.team, choice],
        });
      }
    }

    states = pruneTeamStates(nextStates, targetSize, opponentTypeBias);
  }

  return (
    states
      .filter((state) => state.team.length > 0)
      .sort((a, b) =>
        compareCandidateTeams(a, b, targetSize, opponentTypeBias),
      )[0] || { team: [], megaUsed: null }
  );
}

function orderLinesForSelection(lines) {
  return [...lines].sort((a, b) => {
    const aBest = getLineChoiceOptions(a)[0];
    const bBest = getLineChoiceOptions(b)[0];

    return compareChoices(aBest, bBest);
  });
}

function pruneTeamStates(states, targetSize, opponentTypeBias = {}) {
  const seen = new Set();
  const unique = [];

  for (const state of states) {
    const key = state.team
      .map((choice) => `${choice.inputPokemonId}:${choice.pokemonId}`)
      .sort()
      .join("|");
    const megaKey = state.megaUsed?.pokemonId || "none";
    const stateKey = `${key}:${megaKey}`;

    if (seen.has(stateKey)) continue;
    seen.add(stateKey);
    unique.push(state);
  }

  return unique
    .sort((a, b) => compareCandidateTeams(a, b, targetSize, opponentTypeBias))
    .slice(0, BEAM_WIDTH);
}

// Ranks partial/complete teams for the beam fallback (the exact path uses
// betterEvaluated). Score is the quality key (matching betterEvaluated, which no
// longer gates on meaningful-pick count); usage sits just under it so that among
// similarly-scoring partial teams near the prune cutoff, the ones built from
// higher-usage Pokémon survive, and a strong pick is less likely to be pruned
// away before it's completed.
function compareCandidateTeams(a, b, targetSize = 6, opponentTypeBias = {}) {
  return (
    getTeamSizePriority(b.team, targetSize) -
      getTeamSizePriority(a.team, targetSize) ||
    getTeamScore(b.team, opponentTypeBias) -
      getTeamScore(a.team, opponentTypeBias) ||
    teamUsageSum(b.team) - teamUsageSum(a.team) ||
    // Deterministic identity tie-break: equal-scoring teams resolve the same way
    // regardless of enumeration order, so the result is stable.
    teamIdentityKey(a.team).localeCompare(teamIdentityKey(b.team))
  );
}

function teamUsageSum(team) {
  return team.reduce((sum, choice) => sum + getUsagePercent(choice), 0);
}
