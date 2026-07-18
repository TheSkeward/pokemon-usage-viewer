// Pure team-scoring + enumeration core, with NO dependency on the cache layers,
// the DOM, or the worker orchestration — so it can run identically on the main
// thread or inside a Web Worker. teamSelection.js (orchestration + caches) and
// searchWorker.js (the worker entry) both import from here; this is the single
// source of truth for how a team is scored and how a slice of the combination
// space is enumerated, so the parallel and sequential paths can never diverge.

import { getTypeMultiplier, REBORN_ANALYSIS_TYPES } from "../reborn/typeChart.js";
import { MAX_OPPONENT_TYPE_BIAS } from "../reborn/progression";
import { tunable } from "./scoringConstants.js";

export { REBORN_ANALYSIS_TYPES, getTypeMultiplier };

// --- Team-fit scoring ------------------------------------------------------
// Exhaustive search evaluates hundreds of thousands of teams, so before a search
// we precompute per choice what the hot loop needs: its damage-aware coverage
// vector (best real hit into each defense type, 0..1 — from the legality profile)
// and its defensive weak/resist bitmasks. All judgement constants come from
// scoringConstants.js, snapshotted once per search so overrides don't cost the
// hot loop.
const TYPE_COUNT = REBORN_ANALYSIS_TYPES.length;
const ZERO_COVERAGE = new Float64Array(TYPE_COUNT);

let fitReady = false;
let coverageWeights = null; // per-defense-type multiplier from opponent bias
// Tunables snapshotted per search (prepareFitScoring) for the hot loop.
let ACTIVE = snapshotFitTunables();

function snapshotFitTunables() {
  return {
    coverageWeight: tunable("COVERAGE_WEIGHT"),
    coverageScale: tunable("COVERAGE_SCALE"),
    sharedWeakPenalty: tunable("SHARED_WEAK_PENALTY"),
    uncoveredWeakPenalty: tunable("UNCOVERED_WEAK_PENALTY"),
    resistStackBonus: tunable("RESIST_STACK_BONUS"),
    synergyScale: tunable("SYNERGY_SCALE"),
  };
}

function computeCoverageWeights(opponentTypeBias) {
  const weights = new Array(TYPE_COUNT).fill(1);
  const boost = tunable("BIAS_COVERAGE_BOOST");
  if (!opponentTypeBias) return weights;
  for (let j = 0; j < TYPE_COUNT; j++) {
    const raw = opponentTypeBias[REBORN_ANALYSIS_TYPES[j]];
    const level = Math.max(0, Math.min(MAX_OPPONENT_TYPE_BIAS, raw || 0));
    if (level) {
      weights[j] = 1 + (level / MAX_OPPONENT_TYPE_BIAS) * boost;
    }
  }
  return weights;
}

function precomputeFit(choice, opponentTypeBias) {
  const profile = choice.legalityProfile || {};
  let weakMask = 0;
  let resistMask = 0;
  const currentTypes = profile.currentTypes || [];
  for (let j = 0; j < TYPE_COUNT; j++) {
    const multiplier = getTypeMultiplier(REBORN_ANALYSIS_TYPES[j], currentTypes);
    if (multiplier > 1) weakMask |= 1 << j;
    else if (multiplier < 1) resistMask |= 1 << j;
  }
  // Team SELECTION uses the line's optimistic coverage vector (the max over its
  // build variants) when present — a relaxation, so a line whose coverage build
  // could patch a hole isn't pruned before the optimiser sees it. The chosen
  // team's concrete builds are then realized by the post-selection build
  // assignment (teamSelection.assignTeamBuilds), which scores REAL vectors.
  // Float64Array for fast sequential reads in the noisy-OR hot loop.
  const cv = choice.optimisticCoverageVector || profile.coverageVector;
  choice._fit = {
    coverageVector:
      cv && cv.length === TYPE_COUNT ? Float64Array.from(cv) : ZERO_COVERAGE,
    weakMask,
    resistMask,
    fitWeight: 1 - biasCounterExemption(profile, opponentTypeBias),
    // Phase 3: line-anchored usage trust + competitive co-use lift (id -> %).
    // Pair trust t = min of the two trusts, only where lift data exists.
    trust: Math.max(0, Math.min(1, choice.usageWeight || 0)),
    teammates: choice._teammates || null,
    repId: choice.pokemonId || null,
  };
}

export function prepareFitScoring(lines, opponentTypeBias) {
  coverageWeights = computeCoverageWeights(opponentTypeBias);
  ACTIVE = snapshotFitTunables();
  for (const line of lines) {
    for (const choice of getLineChoiceOptions(line)) {
      precomputeFit(choice, opponentTypeBias);
    }
  }
  fitReady = true;
}

// Clears the per-search fit state (so getTeamScore falls back to the exact path
// outside a search) and the per-line option cache (so it never outlives a search).
export function resetFitScoring(lines) {
  fitReady = false;
  coverageWeights = null;
  for (const line of lines) line._choiceOptions = undefined;
}

// Damage-aware team coverage: for each defense type, the chance SOMEONE lands a
// real hit into it — a noisy-OR over the members' per-type A values — weighted by
// how much that type matters (opponent bias). Saturating by construction (the
// first real answer is worth a lot, the fourth almost nothing), and a 30-BP chip
// move contributes ~0. Plus the defensive shared-weakness term.
const MISS_SCRATCH = new Float64Array(TYPE_COUNT);

function fastTeamFit(team) {
  const weights = coverageWeights || computeCoverageWeights(null);
  // Phase 3 blend: pair trust t = min(trust_a, trust_b) where competitive
  // co-use data exists. Synergy (lift) fades IN per pair; the hand-built
  // coverage/defensive judgements fade OUT with the mean pair trust W̄ —
  // EXCEPT the bias-boosted share of coverage, which never fades (bias is
  // the Reborn-specific insurance no ladder prior covers).
  // All trusts 0 (V0 model, incomplete sets, no data) ⇒ exactly the
  // original formula.
  let synergy = 0;
  let pairTrustSum = 0;
  let pairCount = 0;
  for (let a = 0; a < team.length; a++) {
    const fa = team[a]._fit;
    if (!fa) return null;
    for (let b = a + 1; b < team.length; b++) {
      const fb = team[b]._fit;
      if (!fb) return null;
      pairCount += 1;
      const lift =
        (fa.teammates && fb.repId != null
          ? fa.teammates[fb.repId]
          : undefined) ??
        (fb.teammates && fa.repId != null
          ? fb.teammates[fa.repId]
          : undefined);
      if (lift !== undefined) {
        const t = fa.trust < fb.trust ? fa.trust : fb.trust;
        pairTrustSum += t;
        synergy += t * lift;
      }
    }
  }
  const meanTrust = pairCount ? pairTrustSum / pairCount : 0;
  const handBuilt = 1 - meanTrust;

  // Noisy-OR miss probability per type, accumulated members-outer (each member's
  // vector read sequentially) for cache locality on the hot search path.
  MISS_SCRATCH.fill(1);
  for (const choice of team) {
    const cv = choice._fit.coverageVector;
    for (let j = 0; j < TYPE_COUNT; j++) MISS_SCRATCH[j] *= 1 - cv[j];
  }
  let score = synergy * ACTIVE.synergyScale;
  for (let j = 0; j < TYPE_COUNT; j++) {
    // weights[j] = 1 + biasExtra: the base 1 fades with trust, biasExtra stays.
    const blendedWeight = handBuilt + (weights[j] - 1);
    score += blendedWeight * (1 - MISS_SCRATCH[j]) * ACTIVE.coverageScale;
  }

  for (let j = 0; j < TYPE_COUNT; j++) {
    const bit = 1 << j;
    let weakWeight = 0;
    let coverCount = 0;
    for (const choice of team) {
      const fit = choice._fit;
      if (fit.weakMask & bit) weakWeight += fit.fitWeight;
      else if (fit.resistMask & bit) coverCount += 1;
    }
    if (weakWeight >= 2) {
      score -= handBuilt * (weakWeight - 1) * ACTIVE.sharedWeakPenalty;
      if (!coverCount) score -= handBuilt * ACTIVE.uncoveredWeakPenalty;
    }
    if (coverCount >= 2)
      score += handBuilt * Math.min(3, coverCount) * ACTIVE.resistStackBonus;
  }

  return score;
}

// COVERAGE_WEIGHT: how much the team-level coverage/defense fit is worth relative
// to the summed individual values — a strong-but-not-dominant marginal term: it
// can pull a genuine answer onto the team over a redundant stronger mon when it
// fills a real hole, but can't assemble a team of type-spread chaff over the
// clear individual standouts.
export function getTeamScore(team, opponentTypeBias = {}) {
  const fast = fitReady ? fastTeamFit(team) : null;
  const fit = fast != null ? fast : scoreTeamFit(team, opponentTypeBias);
  const weight = fitReady ? ACTIVE.coverageWeight : tunable("COVERAGE_WEIGHT");
  return sumTeamScore(team) + weight * fit;
}

export function getUsagePercent(choice) {
  return Math.max(0, choice.bundle?.usage?.value || 0);
}

// Sums each member's `teamScore`, falling back to `score` for any choice
// built without one (scoreCandidate currently emits them equal).
function sumTeamScore(team) {
  return team.reduce((sum, row) => sum + (row.teamScore ?? row.score ?? 0), 0);
}

function scoreTeamFit(team, opponentTypeBias = {}) {
  const profiles = team
    .map((choice) => choice.legalityProfile)
    .filter(Boolean);
  const weights = computeCoverageWeights(opponentTypeBias);
  // Per-member fit-penalty weight: a pick that counters a biased opponent type
  // (resists/is immune to it, or hits it super-effectively) is shielded from
  // shared-weakness penalties in proportion to that type's bias level.
  const fitWeights = profiles.map(
    (profile) => 1 - biasCounterExemption(profile, opponentTypeBias),
  );
  const coverageScale = tunable("COVERAGE_SCALE");
  const sharedWeakPenalty = tunable("SHARED_WEAK_PENALTY");
  const uncoveredWeakPenalty = tunable("UNCOVERED_WEAK_PENALTY");
  const resistStackBonus = tunable("RESIST_STACK_BONUS");
  const synergyScale = tunable("SYNERGY_SCALE");

  // Same Phase 3 blend as fastTeamFit (kept in lockstep): synergy fades in
  // per-pair, hand-built judgements fade out with mean pair trust, the
  // bias-boosted share of coverage never fades.
  let synergy = 0;
  let pairTrustSum = 0;
  let pairCount = 0;
  for (let a = 0; a < team.length; a++) {
    for (let b = a + 1; b < team.length; b++) {
      pairCount += 1;
      const lift =
        team[a]._teammates?.[team[b].pokemonId] ??
        team[b]._teammates?.[team[a].pokemonId];
      if (lift !== undefined) {
        const t = Math.min(
          Math.max(0, Math.min(1, team[a].usageWeight || 0)),
          Math.max(0, Math.min(1, team[b].usageWeight || 0)),
        );
        pairTrustSum += t;
        synergy += t * lift;
      }
    }
  }
  const handBuilt = 1 - (pairCount ? pairTrustSum / pairCount : 0);
  let score = synergy * synergyScale;

  // Damage-aware coverage: noisy-OR over members' per-type A values. This exact
  // path scores the members' REAL coverage vectors (their concrete builds), not
  // the optimistic selection relaxation.
  for (let j = 0; j < TYPE_COUNT; j++) {
    let miss = 1;
    for (const profile of profiles) {
      const vector = profile.coverageVector || ZERO_COVERAGE;
      miss *= 1 - (vector[j] || 0);
    }
    score += (handBuilt + (weights[j] - 1)) * (1 - miss) * coverageScale;
  }

  // Defensive shared-weakness term.
  for (let j = 0; j < TYPE_COUNT; j++) {
    const attackType = REBORN_ANALYSIS_TYPES[j];
    let weakWeight = 0;
    let coverCount = 0;
    profiles.forEach((profile, index) => {
      const multiplier = getTypeMultiplier(attackType, profile.currentTypes || []);
      if (multiplier > 1) weakWeight += fitWeights[index];
      else if (multiplier < 1) coverCount += 1;
    });
    if (weakWeight >= 2) {
      score -= handBuilt * (weakWeight - 1) * sharedWeakPenalty;
      if (!coverCount) score -= handBuilt * uncoveredWeakPenalty;
    }
    if (coverCount >= 2)
      score += handBuilt * Math.min(3, coverCount) * resistStackBonus;
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

// --- Per-line form options + team comparison -------------------------------

// Score-first, mirroring compareScoredCandidates: the meaningfulUsage boolean
// no longer outranks score anywhere (usage is informative inside score, never
// sovereign over it — invariant 1).
export function compareChoices(a, b) {
  return (
    b.score - a.score ||
    getUsagePercent(b) - getUsagePercent(a) ||
    a.name.localeCompare(b.name)
  );
}

// A line's form options are fixed for the duration of a search but were being
// re-sorted and re-deduped on every combination that touched the line (millions
// of times for ~N distinct answers). Cache the result on the line; the cache is
// populated by prepareFitScoring and cleared by resetFitScoring, so it never
// outlives a single search (no cross-edit staleness). When a line already carries
// a prepared `_choiceOptions` (compact lines shipped to a worker), it's used as-is.
export function getLineChoiceOptions(line) {
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

// The best legal form/mega assignment for a fixed set of lines: each line offers
// a few form options, with at most one mega across the whole team.
export function bestAssignmentForLines(comboLines, targetSize, opponentTypeBias) {
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
// identityOf() and memoized onto the result.
export function evaluateTeam(team, megaUsed, targetSize, opponentTypeBias) {
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
export function identityOf(evaluated) {
  if (evaluated._identityKey === undefined) {
    evaluated._identityKey = teamIdentityKey(evaluated.team);
  }
  return evaluated._identityKey;
}

// Strictly-better test with a deterministic identity tie-break, so equal-scoring
// teams resolve the same way no matter what order they were enumerated in. Score
// is the sole quality key (usage tier is already folded into score, so we do NOT
// gate on meaningful-pick count). The identity tie-break is only reached when size
// and score match exactly, so identityOf() runs for a vanishing fraction of
// comparisons.
export function betterEvaluated(a, b) {
  if (a.sizePriority !== b.sizePriority) return a.sizePriority > b.sizePriority;
  if (a.score !== b.score) return a.score > b.score;
  return identityOf(a) < identityOf(b);
}

export function teamIdentityKey(team) {
  return team
    .map((choice) => `${choice.inputPokemonId}:${choice.pokemonId}`)
    .sort()
    .join("|");
}

// --- Top-N team collection ---------------------------------------------------
// Team SELECTION scores a relaxation (optimistic max-over-builds coverage), so
// the single best relaxed team is not guaranteed to be the best team after
// concrete builds are realized — a line can look like it patches two holes that
// no single build patches together. The search therefore keeps the TOP N relaxed
// teams; the realization pass (teamSelection) assigns concrete builds to each
// and re-ranks by the exact realized score. Bounded, deterministic (insertion
// uses the same betterEvaluated comparator incl. the identity tie-break).
export function createTopTeams(capacity) {
  return { capacity: Math.max(1, capacity), items: [] };
}

export function offerTopTeam(top, evaluated) {
  const items = top.items;
  if (
    items.length >= top.capacity &&
    !betterEvaluated(evaluated, items[items.length - 1])
  ) {
    return;
  }
  let index = items.length;
  while (index > 0 && betterEvaluated(evaluated, items[index - 1])) index -= 1;
  items.splice(index, 0, evaluated);
  if (items.length > top.capacity) items.pop();
}

// The exact realized score of a CONCRETE team (its members' real coverage
// vectors, never the optimistic selection relaxation) — used to re-rank the
// top-N relaxed teams after build assignment.
export function getRealizedTeamScore(team, opponentTypeBias = {}) {
  return (
    sumTeamScore(team) +
    tunable("COVERAGE_WEIGHT") * scoreTeamFit(team, opponentTypeBias)
  );
}

export function getTeamSizePriority(team, targetSize) {
  return Math.min(team.length, targetSize);
}

// --- Combination enumeration -----------------------------------------------

// Exact C(n, k) as a Number (the values here fit in a double precisely).
export function comb(n, k) {
  if (k < 0 || k > n || n < 0) return 0;
  const r = Math.min(k, n - k);
  let result = 1;
  for (let i = 0; i < r; i++) result = (result * (n - i)) / (i + 1);
  return Math.round(result);
}

// Yields each size-k index combination of [0..n) in lexicographic order, reusing
// one array.
export function forEachCombination(n, k, callback) {
  if (k === 0) {
    callback([]);
    return;
  }
  if (k > n) return;

  const idx = Array.from({ length: k }, (_, i) => i);
  while (true) {
    callback(idx);
    if (!nextCombination(idx, n, k)) break;
  }
}

// Advances `idx` to the next lexicographic combination in place; false if it was
// the last one.
function nextCombination(idx, n, k) {
  let i = k - 1;
  while (i >= 0 && idx[i] === n - k + i) i -= 1;
  if (i < 0) return false;
  idx[i] += 1;
  for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  return true;
}

// The combination at lexicographic rank `rank` of choosing k from [0, n), or null
// if the rank is out of range. Lets a worker start enumerating partway through the
// space without walking from the beginning.
function unrankCombination(rank, n, k) {
  if (k === 0) return rank === 0 ? [] : null;
  const result = new Array(k);
  let remaining = rank;
  let value = 0;
  for (let i = 0; i < k; i++) {
    while (true) {
      const count = comb(n - 1 - value, k - 1 - i);
      if (remaining < count) break;
      remaining -= count;
      value += 1;
      if (value >= n) return null;
    }
    result[i] = value;
    value += 1;
  }
  return result;
}

// Enumerates lexicographic combinations [start, end) of choosing targetSize lines
// from `lines`, scores each, and returns the single best as compact id refs (so it
// survives a worker postMessage). Pure and self-contained: it prepares and resets
// its own fit state, so it can run in a worker or on the main thread as a fallback.
// `lines` must carry a prepared `choiceOptions` array per line (the form options).
// Progress reporting cadence: ~20 reports per range, clamped so tiny ranges
// don't spam and huge ones still stride at most every 64k combos. The cadence
// must stay range-relative: a fixed stride leaves a short worker range with
// under two reports, so its progress sits silent and then jumps.
export const SEARCH_PROGRESS_MAX_STRIDE = 65_536;
const SEARCH_PROGRESS_MIN_STRIDE = 2_048;
const SEARCH_PROGRESS_REPORTS_PER_RANGE = 20;

export function searchCombinationRange(lines, targetSize, opponentTypeBias, start, end, topCount = 1, onProgress = null) {
  for (const line of lines) line._choiceOptions = line.choiceOptions;
  prepareFitScoring(lines, opponentTypeBias);

  const top = createTopTeams(topCount);
  const n = lines.length;
  const stride = onProgress
    ? Math.max(
        SEARCH_PROGRESS_MIN_STRIDE,
        Math.min(
          SEARCH_PROGRESS_MAX_STRIDE,
          Math.floor((end - start) / SEARCH_PROGRESS_REPORTS_PER_RANGE) ||
            SEARCH_PROGRESS_MIN_STRIDE,
        ),
      )
    : 0;
  const idx = unrankCombination(start, n, targetSize);
  if (idx) {
    for (let pos = start; pos < end; pos++) {
      const comboLines = idx.map((i) => lines[i]);
      const candidate = bestAssignmentForLines(comboLines, targetSize, opponentTypeBias);
      if (candidate) offerTopTeam(top, candidate);
      if (onProgress && (pos - start + 1) % stride === 0) {
        onProgress(pos - start + 1);
      }
      if (!nextCombination(idx, n, targetSize)) break;
    }
    // Final report so the aggregate drains to 100% as ranges complete.
    if (onProgress) onProgress(end - start);
  }

  resetFitScoring(lines);
  if (!top.items.length) return null;
  return {
    top: top.items.map((evaluated) => ({
      team: evaluated.team.map((c) => ({
        inputPokemonId: c.inputPokemonId,
        pokemonId: c.pokemonId,
        isMega: !!c.isMega,
      })),
      megaUsed: evaluated.megaUsed
        ? {
            inputPokemonId: evaluated.megaUsed.inputPokemonId,
            pokemonId: evaluated.megaUsed.pokemonId,
          }
        : null,
      score: evaluated.score,
      identityKey: identityOf(evaluated),
    })),
  };
}
