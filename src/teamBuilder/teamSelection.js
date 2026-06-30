import {
  getTypeMultiplier,
  REBORN_ANALYSIS_TYPES,
} from "../reborn/typeChart.js";
import { MAX_OPPONENT_TYPE_BIAS } from "../reborn/progression";

export function choosePoolTeam(
  lines,
  opponentTypeBias = {},
  { exhaustive = true, incremental = null, searchKey = null } = {},
) {
  const resolvedLines = lines.filter((line) => line.best || line.bestNonMega);
  const unresolved = lines.filter((line) => line.unresolved);
  const bestTeam = selectTeamByFit(resolvedLines, opponentTypeBias, {
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
// button enumerates up to a high ceiling; background auto-reoptimize only
// enumerates when it's cheap, otherwise it takes the fast beam. With the fast
// bitmask scorer these stay responsive: 300k ≈ a 27-line pool (background,
// runs on every edit), 2M ≈ a 36-line pool (explicit Optimize, a few seconds).
const AUTO_EXHAUSTIVE_BUDGET = 300_000;
const HARD_EXHAUSTIVE_CAP = 2_000_000;
const BEAM_WIDTH = 2000;

// --- Full-enumeration team store -------------------------------------------
// When an exact search enumerates every C(N, size) team, we keep them all — each
// team's line positions + score — keyed by the score context. The optimum of ANY
// sub-pool is then just the best stored team that
// uses only surviving lines, so a deletion to a never-visited subset (e.g.
// dropping a mon that was on the optimal team) is answered by a fast scan instead
// of a full re-search. Packed typed arrays hold ~2M teams in ~20MB (the 36-line
// ceiling); a normal pool is a few KB. Replaced on each full search, queried for
// any subset of the pool it was built from.
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

function selectTeamByFit(
  lines,
  opponentTypeBias = {},
  { exhaustive = true, incremental = null, searchKey = null } = {},
) {
  const targetSize = Math.min(6, lines.length);
  if (targetSize === 0) {
    return { evaluated: { team: [], megaUsed: null }, searchExact: true, benchSwapScores: new Map() };
  }

  prepareFitScoring(lines, opponentTypeBias);
  try {
    let evaluated;
    let searchExact;

    // Incremental: reuse a cached exact optimum and only enumerate teams that
    // include a newly-added line. Always exact, and cheap (≈ C(N, targetSize-1)),
    // so it runs regardless of the budget.
    if (incrementalApplicable(incremental, lines, targetSize)) {
      evaluated = selectTeamExhaustive(lines, targetSize, opponentTypeBias, incremental, null);
      searchExact = true;
    } else if (searchKey && teamStoreCovers(searchKey, lines, targetSize)) {
      // The pool is a subset of an earlier full search (a deletion, including of a
      // mon that was on the team) — scan the stored teams instead of re-searching.
      evaluated = queryTeamStore(lines, targetSize, opponentTypeBias);
      searchExact = true;
    } else {
      const combinations = countCombinations(lines.length, targetSize);
      const budget = exhaustive ? HARD_EXHAUSTIVE_CAP : AUTO_EXHAUSTIVE_BUDGET;

      if (combinations <= budget) {
        // A full enumeration: record every team so later subsets of this pool are
        // answered by queryTeamStore.
        const store = searchKey
          ? createTeamStore(searchKey, lines, targetSize, combinations)
          : null;
        evaluated = selectTeamExhaustive(lines, targetSize, opponentTypeBias, null, store);
        if (store) teamStore = store;
        searchExact = true;
      } else {
        evaluated = selectTeamByBeam(lines, targetSize, opponentTypeBias);
        searchExact = false;
      }
    }

    // Rank the non-selected lines by how much the team would suffer if forced to
    // field them: a cheap O(bench × forms × size) pass that reuses the team
    // scorer (so coverage — offensive AND defensive — and the bounded tier trade
    // off exactly as in selection). It's independent of which search ran above,
    // so the bench's "worst" highlight is available even in incremental/beam
    // mode.
    const benchSwapScores = computeBenchSwapScores(
      lines,
      evaluated.team,
      opponentTypeBias,
    );

    return { evaluated, searchExact, benchSwapScores };
  } finally {
    fitReady = false;
    for (const line of lines) line._choiceOptions = undefined;
  }
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
// that doesn't touch the team is reused as-is (no team containing a new line
// exists to enumerate), and an addition grows the search. The optimizer
// guarantees the score context (progression/breeding) is unchanged.
function incrementalApplicable(incremental, lines, targetSize) {
  if (!incremental?.previousBest?.team?.length) return false;
  if (incremental.previousBest.team.length !== targetSize) return false;
  const present = new Set(lines.map((line) => line.lineKey));
  for (const key of incremental.teamLineKeys || incremental.baseLineKeys) {
    if (!present.has(key)) return false;
  }
  return true;
}

// Streams every team of the target size, keeping the single best — O(1) memory
// regardless of pool size, and provably invariant to unused mons (they only add
// combinations that can't beat the best, and the tie-break is identity-based).
// With `incremental`, it seeds the best from the cached optimum and only
// enumerates teams containing at least one newly-added line.
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

// The best legal form/mega assignment for a fixed set of lines: each line offers
// a few form options, with at most one mega across the whole team.
function bestAssignmentForLines(comboLines, targetSize, opponentTypeBias) {
  const optionsPerLine = comboLines.map(getLineChoiceOptions);
  const team = [];
  let best = null;

  const assign = (index, megaUsed) => {
    if (index === comboLines.length) {
      const evaluated = evaluateTeam([...team], megaUsed, targetSize, opponentTypeBias);
      if (!best || betterEvaluated(evaluated, best)) best = evaluated;
      return;
    }
    for (const choice of optionsPerLine[index]) {
      if (choice.isMega && megaUsed) continue;
      team.push(choice);
      assign(index + 1, choice.isMega ? choice : megaUsed);
      team.pop();
    }
  };

  assign(0, null);
  return best;
}

// Scores a team once and caches the sort keys, so the argmax loop never
// recomputes a team's score. The identity key is NOT computed here: it's only
// consulted to break an exact score tie (rare), so it's materialized lazily by
// identityOf() and memoized onto the result — turning ~a third of the search's
// work (a sort+join string per team) into a handful of computations per search.
function evaluateTeam(team, megaUsed, targetSize, opponentTypeBias) {
  return {
    team,
    megaUsed,
    sizePriority: getTeamSizePriority(team, targetSize),
    score: getTeamScore(team, opponentTypeBias),
    _identityKey: undefined,
  };
}

// Lazily computes a team's identity from its (snapshotted) members and caches it,
// so the running best's key is built at most once no matter how many candidates
// tie it.
function identityOf(evaluated) {
  if (evaluated._identityKey === undefined) {
    evaluated._identityKey = teamIdentityKey(evaluated.team);
  }
  return evaluated._identityKey;
}

// Strictly-better test with a deterministic identity tie-break, so equal-scoring
// teams resolve the same way no matter what order they were enumerated in. Score
// is the sole quality key: usage tier is already folded into score (heavily, via
// each member's usage prior), so we do NOT gate on meaningful-pick count — a
// lower-usage mon whose coverage/legality/bias answer genuinely outscores a more
// popular pick is allowed to earn its slot, rather than being categorically
// outranked by usage. The identity tie-break is only reached when size and score
// match exactly, so identityOf() runs for a vanishing fraction of comparisons.
function betterEvaluated(a, b) {
  if (a.sizePriority !== b.sizePriority) return a.sizePriority > b.sizePriority;
  if (a.score !== b.score) return a.score > b.score;
  return identityOf(a) < identityOf(b);
}

function teamIdentityKey(team) {
  return team
    .map((choice) => `${choice.inputPokemonId}:${choice.pokemonId}`)
    .sort()
    .join("|");
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

// Yields each size-k index combination of [0..n) in order, reusing one array.
function forEachCombination(n, k, callback) {
  if (k === 0) {
    callback([]);
    return;
  }
  if (k > n) return;

  const idx = Array.from({ length: k }, (_, i) => i);
  while (true) {
    callback(idx);

    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i -= 1;
    if (i < 0) break;
    idx[i] += 1;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
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

// A line's form options are fixed for the duration of a search but were being
// re-sorted and re-deduped on every combination that touched the line (millions
// of times for ~N distinct answers). Cache the result on the line; the cache is
// populated by prepareFitScoring and cleared in selectTeamByFit's finally, so it
// never outlives a single search (no cross-edit staleness).
function getLineChoiceOptions(line) {
  if (line._choiceOptions) return line._choiceOptions;

  const choices = line.choiceOptions?.length
    ? line.choiceOptions
    : [line.best, line.bestNonMega].filter(Boolean);
  const unique = new Map();

  for (const choice of choices.sort(compareChoices)) {
    if (!choice || unique.has(choice.pokemonId)) continue;
    unique.set(choice.pokemonId, choice);
  }

  return (line._choiceOptions = [...unique.values()].slice(0, 6));
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

function compareChoices(a, b) {
  const meaningfulDiff =
    Number(Boolean(b.meaningfulUsage)) - Number(Boolean(a.meaningfulUsage));

  if (meaningfulDiff) return meaningfulDiff;

  return (
    b.score - a.score ||
    getUsagePercent(b) - getUsagePercent(a) ||
    a.name.localeCompare(b.name)
  );
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

function getTeamSizePriority(team, targetSize) {
  return Math.min(team.length, targetSize);
}

// Team selection sums each member's bounded-tier `teamScore` (not the strict
// per-mon `score`), so type coverage can pull a lower-tier mon onto the team
// when it answers a real need. Falls back to `score` for any choice built
// without a teamScore.
function sumTeamScore(team) {
  return team.reduce((sum, row) => sum + (row.teamScore ?? row.score ?? 0), 0);
}

// --- Fast team-fit scoring -------------------------------------------------
// Exhaustive search evaluates hundreds of thousands of teams, and the readable
// scoreTeamFit() below makes ~400 getTypeMultiplier calls per team. So before a
// search we precompute, once per choice, the bitmasks it needs — which defense
// types it hits super-effectively, and which it's weak to / resists — and the
// hot loop becomes pure bit ops. fastTeamFit is asserted equal to scoreTeamFit.
const FIT_TYPE_INDEX = new Map(REBORN_ANALYSIS_TYPES.map((type, i) => [type, i]));
// SE_MASK[i]: defense-type bitmask that attack type i hits super-effectively.
const SE_MASK = REBORN_ANALYSIS_TYPES.map((attackType) =>
  REBORN_ANALYSIS_TYPES.reduce(
    (mask, defenseType, j) =>
      getTypeMultiplier(attackType, [defenseType]) > 1 ? mask | (1 << j) : mask,
    0,
  ),
);
let fitReady = false;

function precomputeFit(choice, opponentTypeBias) {
  const profile = choice.legalityProfile || {};
  let attackMask = 0;
  let coverageMask = 0;
  for (const attackType of profile.attackTypes || []) {
    const i = FIT_TYPE_INDEX.get(attackType);
    if (i === undefined) continue;
    attackMask |= 1 << i;
    coverageMask |= SE_MASK[i];
  }
  let weakMask = 0;
  let resistMask = 0;
  const currentTypes = profile.currentTypes || [];
  for (let j = 0; j < REBORN_ANALYSIS_TYPES.length; j++) {
    const multiplier = getTypeMultiplier(REBORN_ANALYSIS_TYPES[j], currentTypes);
    if (multiplier > 1) weakMask |= 1 << j;
    else if (multiplier < 1) resistMask |= 1 << j;
  }
  choice._fit = {
    attackMask,
    coverageMask,
    weakMask,
    resistMask,
    fitWeight: 1 - biasCounterExemption(profile, opponentTypeBias),
  };
}

function prepareFitScoring(lines, opponentTypeBias) {
  for (const line of lines) {
    for (const choice of getLineChoiceOptions(line)) {
      precomputeFit(choice, opponentTypeBias);
    }
  }
  fitReady = true;
}

function popcount(value) {
  let count = 0;
  let x = value;
  while (x) {
    x &= x - 1;
    count += 1;
  }
  return count;
}

function fastTeamFit(team) {
  let attackUnion = 0;
  let coverUnion = 0;
  for (const choice of team) {
    if (!choice._fit) return null;
    attackUnion |= choice._fit.attackMask;
    coverUnion |= choice._fit.coverageMask;
  }

  const coverSize = popcount(coverUnion);
  let score =
    popcount(attackUnion) * 70 +
    coverSize * 90 -
    (REBORN_ANALYSIS_TYPES.length - coverSize) * 80;

  for (let j = 0; j < REBORN_ANALYSIS_TYPES.length; j++) {
    const bit = 1 << j;
    let weakWeight = 0;
    let coverCount = 0;
    for (const choice of team) {
      const fit = choice._fit;
      if (fit.weakMask & bit) weakWeight += fit.fitWeight;
      else if (fit.resistMask & bit) coverCount += 1;
    }
    if (weakWeight >= 2) {
      score -= (weakWeight - 1) * 180;
      if (!coverCount) score -= 260;
    }
    if (coverCount >= 2) score += Math.min(3, coverCount) * 45;
  }

  return score;
}

function getTeamScore(team, opponentTypeBias = {}) {
  const fast = fitReady ? fastTeamFit(team) : null;
  return (
    sumTeamScore(team) +
    (fast != null ? fast : scoreTeamFit(team, opponentTypeBias))
  );
}

function getUsagePercent(choice) {
  return Math.max(0, choice.bundle?.usage?.value || 0);
}

function scoreTeamFit(team, opponentTypeBias = {}) {
  const profiles = team
    .map((choice) => choice.legalityProfile)
    .filter(Boolean);
  const attackTypes = new Set();
  const coveredDefenseTypes = new Set();
  let score = 0;

  for (const profile of profiles) {
    for (const attackType of profile.attackTypes || []) {
      attackTypes.add(attackType);

      for (const defenseType of REBORN_ANALYSIS_TYPES) {
        if (getTypeMultiplier(attackType, [defenseType]) > 1) {
          coveredDefenseTypes.add(defenseType);
        }
      }
    }
  }

  // Per-member fit-penalty weight: a pick that counters a biased opponent type
  // (resists/is immune to it, or hits it super-effectively) is shielded from
  // shared-weakness penalties in proportion to that type's bias level, so
  // stacking dedicated counters isn't punished. Non-counters keep full weight.
  const fitWeights = profiles.map(
    (profile) => 1 - biasCounterExemption(profile, opponentTypeBias),
  );

  score += attackTypes.size * 70;
  score += coveredDefenseTypes.size * 90;
  score -= (REBORN_ANALYSIS_TYPES.length - coveredDefenseTypes.size) * 80;

  for (const attackType of REBORN_ANALYSIS_TYPES) {
    let weakWeight = 0;
    let coverCount = 0;

    profiles.forEach((profile, index) => {
      const multiplier = getTypeMultiplier(attackType, profile.currentTypes || []);
      if (multiplier > 1) weakWeight += fitWeights[index];
      else if (multiplier < 1) coverCount += 1;
    });

    if (weakWeight >= 2) {
      score -= (weakWeight - 1) * 180;
      if (!coverCount) score -= 260;
    }

    if (coverCount >= 2) score += Math.min(3, coverCount) * 45;
  }

  return score;
}

// How strongly a pick counters any biased opponent type, as a 0..1 fraction:
// the highest bias level (over types it resists/is immune to, or hits super-
// effectively) divided by the max bias. Used to cap that pick's shared-weakness
// fit penalties — it's a dedicated counter, so its own typing holes are accepted.
function biasCounterExemption(profile, opponentTypeBias = {}) {
  let exemption = 0;

  for (const [type, rawLevel] of Object.entries(opponentTypeBias)) {
    const level = Math.max(0, Math.min(MAX_OPPONENT_TYPE_BIAS, rawLevel || 0));
    if (!level) continue;

    const resists = getTypeMultiplier(type, profile.currentTypes || []) < 1;
    const hitsSuperEffectively = (profile.attackTypes || []).some(
      (attackType) => getTypeMultiplier(attackType, [type]) > 1,
    );

    if (resists || hitsSuperEffectively) {
      exemption = Math.max(exemption, level / MAX_OPPONENT_TYPE_BIAS);
    }
  }

  return exemption;
}
