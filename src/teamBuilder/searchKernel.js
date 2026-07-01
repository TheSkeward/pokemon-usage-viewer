// Pure team-scoring + enumeration core, with NO dependency on the cache layers,
// the DOM, or the worker orchestration — so it can run identically on the main
// thread or inside a Web Worker. teamSelection.js (orchestration + caches) and
// searchWorker.js (the worker entry) both import from here; this is the single
// source of truth for how a team is scored and how a slice of the combination
// space is enumerated, so the parallel and sequential paths can never diverge.

import { getTypeMultiplier, REBORN_ANALYSIS_TYPES } from "../reborn/typeChart.js";
import { MAX_OPPONENT_TYPE_BIAS } from "../reborn/progression";

export { REBORN_ANALYSIS_TYPES, getTypeMultiplier };

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

export function prepareFitScoring(lines, opponentTypeBias) {
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
  for (const line of lines) line._choiceOptions = undefined;
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

// How much the team-level coverage/defense fit is worth relative to the summed
// individual values. Individual value now lives on the combat-score scale (peak
// current usefulness, not the old usage-inflated scale), so this keeps coverage a
// strong-but-not-dominant marginal term: it can pull a genuine answer onto the
// team over a redundant stronger mon when it fills a real hole, but can't assemble
// a team of type-spread chaff over the clear individual standouts. Tunable
// preference — turn it up for more coverage-driven teams, down for more
// quality-driven ones.
const COVERAGE_WEIGHT = 0.5;

export function getTeamScore(team, opponentTypeBias = {}) {
  const fast = fitReady ? fastTeamFit(team) : null;
  const fit = fast != null ? fast : scoreTeamFit(team, opponentTypeBias);
  return sumTeamScore(team) + COVERAGE_WEIGHT * fit;
}

export function getUsagePercent(choice) {
  return Math.max(0, choice.bundle?.usage?.value || 0);
}

// Team selection sums each member's bounded-tier `teamScore` (not the strict
// per-mon `score`), so type coverage can pull a lower-tier mon onto the team
// when it answers a real need. Falls back to `score` for any choice built
// without a teamScore.
function sumTeamScore(team) {
  return team.reduce((sum, row) => sum + (row.teamScore ?? row.score ?? 0), 0);
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

// --- Per-line form options + team comparison -------------------------------

export function compareChoices(a, b) {
  const meaningfulDiff =
    Number(Boolean(b.meaningfulUsage)) - Number(Boolean(a.meaningfulUsage));

  if (meaningfulDiff) return meaningfulDiff;

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
export function searchCombinationRange(lines, targetSize, opponentTypeBias, start, end) {
  for (const line of lines) line._choiceOptions = line.choiceOptions;
  prepareFitScoring(lines, opponentTypeBias);

  let best = null;
  const n = lines.length;
  const idx = unrankCombination(start, n, targetSize);
  if (idx) {
    for (let pos = start; pos < end; pos++) {
      const comboLines = idx.map((i) => lines[i]);
      const candidate = bestAssignmentForLines(comboLines, targetSize, opponentTypeBias);
      if (candidate && (!best || betterEvaluated(candidate, best))) best = candidate;
      if (!nextCombination(idx, n, targetSize)) break;
    }
  }

  resetFitScoring(lines);
  if (!best) return null;
  return {
    team: best.team.map((c) => ({
      inputPokemonId: c.inputPokemonId,
      pokemonId: c.pokemonId,
      isMega: !!c.isMega,
    })),
    megaUsed: best.megaUsed
      ? { inputPokemonId: best.megaUsed.inputPokemonId, pokemonId: best.megaUsed.pokemonId }
      : null,
    score: best.score,
    identityKey: identityOf(best),
  };
}
