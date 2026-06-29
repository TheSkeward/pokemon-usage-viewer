import {
  getTypeMultiplier,
  REBORN_ANALYSIS_TYPES,
} from "../reborn/typeChart.js";
import { MAX_OPPONENT_TYPE_BIAS } from "../reborn/progression";

export function choosePoolTeam(lines, opponentTypeBias = {}, { exhaustive = true } = {}) {
  const resolvedLines = lines.filter((line) => line.best || line.bestNonMega);
  const unresolved = lines.filter((line) => line.unresolved);
  const bestTeam = selectTeamByFit(resolvedLines, opponentTypeBias, { exhaustive });
  const team = addTeamFitNotes(bestTeam.team);
  const megaUsed = bestTeam.megaUsed
    ? team.find(
        (choice) =>
          choice.inputPokemonId === bestTeam.megaUsed.inputPokemonId &&
          choice.pokemonId === bestTeam.megaUsed.pokemonId,
      )
    : null;

  return {
    team,
    megaUsed,
    lines,
    unresolved,
    linesConsidered: resolvedLines.length,
    searchExact: bestTeam.searchExact !== false,
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
// enumerates when it's cheap, otherwise it takes the fast beam.
const AUTO_EXHAUSTIVE_BUDGET = 150_000;
const HARD_EXHAUSTIVE_CAP = 1_000_000;
const BEAM_WIDTH = 2000;

function selectTeamByFit(lines, opponentTypeBias = {}, { exhaustive = true } = {}) {
  const targetSize = Math.min(6, lines.length);
  if (targetSize === 0) return { team: [], megaUsed: null, searchExact: true };

  prepareFitScoring(lines, opponentTypeBias);
  try {
    const combinations = countCombinations(lines.length, targetSize);
    const budget = exhaustive ? HARD_EXHAUSTIVE_CAP : AUTO_EXHAUSTIVE_BUDGET;

    if (combinations <= budget) {
      return { ...selectTeamExhaustive(lines, targetSize, opponentTypeBias), searchExact: true };
    }
    return { ...selectTeamByBeam(lines, targetSize, opponentTypeBias), searchExact: false };
  } finally {
    fitReady = false;
  }
}

// Streams every team of the target size, keeping the single best — O(1) memory
// regardless of pool size, and provably invariant to unused mons (they only add
// combinations that can't beat the best, and the tie-break is identity-based).
function selectTeamExhaustive(lines, targetSize, opponentTypeBias) {
  let best = null;

  forEachCombination(lines.length, targetSize, (comboIndices) => {
    const comboLines = comboIndices.map((index) => lines[index]);
    const candidate = bestAssignmentForLines(comboLines, targetSize, opponentTypeBias);
    if (candidate && (!best || betterEvaluated(candidate, best))) best = candidate;
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
// recomputes a team's score.
function evaluateTeam(team, megaUsed, targetSize, opponentTypeBias) {
  return {
    team,
    megaUsed,
    sizePriority: getTeamSizePriority(team, targetSize),
    meaningful: countMeaningfulChoices(team),
    score: getTeamScore(team, opponentTypeBias),
    identityKey: teamIdentityKey(team),
  };
}

// Strictly-better test with a deterministic identity tie-break, so equal-scoring
// teams resolve the same way no matter what order they were enumerated in.
function betterEvaluated(a, b) {
  if (a.sizePriority !== b.sizePriority) return a.sizePriority > b.sizePriority;
  if (a.meaningful !== b.meaningful) return a.meaningful > b.meaningful;
  if (a.score !== b.score) return a.score > b.score;
  return a.identityKey < b.identityKey;
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

function getLineChoiceOptions(line) {
  const choices = line.choiceOptions?.length
    ? line.choiceOptions
    : [line.best, line.bestNonMega].filter(Boolean);
  const unique = new Map();

  for (const choice of choices.sort(compareChoices)) {
    if (!choice || unique.has(choice.pokemonId)) continue;
    unique.set(choice.pokemonId, choice);
  }

  return [...unique.values()].slice(0, 6);
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
// betterEvaluated). Usage sits just under score: among similarly-scoring partial
// teams near the prune cutoff, the ones built from higher-usage Pokémon survive,
// so a strong pick is less likely to be pruned away before it's completed.
function compareCandidateTeams(a, b, targetSize = 6, opponentTypeBias = {}) {
  return (
    getTeamSizePriority(b.team, targetSize) -
      getTeamSizePriority(a.team, targetSize) ||
    countMeaningfulChoices(b.team) - countMeaningfulChoices(a.team) ||
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

function countMeaningfulChoices(team) {
  return team.reduce((sum, row) => sum + (row.meaningfulUsage ? 1 : 0), 0);
}

function sumTeamScore(team) {
  return team.reduce((sum, row) => sum + (row.score || 0), 0);
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
