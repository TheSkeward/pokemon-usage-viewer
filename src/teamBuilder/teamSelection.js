import {
  getTypeMultiplier,
  REBORN_ANALYSIS_TYPES,
} from "../reborn/typeChart.js";
import { MAX_OPPONENT_TYPE_BIAS } from "../reborn/progression";

export function choosePoolTeam(lines, opponentTypeBias = {}) {
  const resolvedLines = lines.filter((line) => line.best || line.bestNonMega);
  const unresolved = lines.filter((line) => line.unresolved);
  const bestTeam = selectTeamByFit(resolvedLines, opponentTypeBias);
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

function selectTeamByFit(lines, opponentTypeBias = {}) {
  const targetSize = Math.min(6, lines.length);
  let states = [
    {
      lineKeys: new Set(),
      megaUsed: null,
      team: [],
    },
  ];

  for (const line of orderLinesForSelection(lines)) {
    const nextStates = [...states];
    const options = getLineChoiceOptions(line);

    for (const state of states) {
      if (state.team.length >= targetSize) continue;

      for (const choice of options) {
        if (choice.isMega && state.megaUsed) continue;
        if (state.lineKeys.has(line.lineKey)) continue;

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
      )[0] || {
      team: [],
      megaUsed: null,
    }
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
    .slice(0, 120);
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

function compareCandidateTeams(a, b, targetSize = 6, opponentTypeBias = {}) {
  return (
    getTeamSizePriority(b.team, targetSize) -
      getTeamSizePriority(a.team, targetSize) ||
    countMeaningfulChoices(b.team) - countMeaningfulChoices(a.team) ||
    getTeamScore(b.team, opponentTypeBias) -
      getTeamScore(a.team, opponentTypeBias)
  );
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

function getTeamScore(team, opponentTypeBias = {}) {
  return sumTeamScore(team) + scoreTeamFit(team, opponentTypeBias);
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
