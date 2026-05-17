import {
  getAvailableRebornMoves,
  loadRebornLegalMoveData,
} from "./legalMoves";
import { getCurrentRebornSpeciesForChoice } from "./currentSpecies.js";
import {
  applyBreedingContextToProgression,
  buildRebornBreedingContext,
} from "./breeding.js";
import {
  getTypeMultiplier,
  REBORN_ANALYSIS_TYPES,
} from "./typeChart.js";

export { REBORN_ANALYSIS_TYPES };

export async function buildRebornTeamAnalysis(
  team = [],
  progression = {},
  breedingOptions = {},
) {
  const breedingContext = await buildRebornBreedingContext({
    ...breedingOptions,
    progression,
  });
  const legalMoveEntries = await Promise.all(
    team.map(async (row) => {
      const currentSpecies = getCurrentRebornSpeciesForChoice(row, progression);
      const legalMoveData = await loadRebornLegalMoveData(
        currentSpecies?.id || row.pokemonId,
      );
      const memberProgression = applyBreedingContextToProgression(
        progression,
        legalMoveData?.pokemonId,
        breedingContext,
      );
      const member = {
        id: currentSpecies?.id || row.pokemonId,
        name: currentSpecies?.name || row.name,
        inputName: row.inputName || row.name,
        representativeId: row.pokemonId,
        representativeName: currentSpecies?.differsFromRepresentative
          ? currentSpecies.representativeName
          : "",
        types: legalMoveData?.types || [],
      };
      const moves = getAvailableRebornMoves(legalMoveData, memberProgression);

      const profile = buildCandidateLegalityProfile({
        member,
        moves,
        representativeName: row.name,
      });

      return {
        member,
        moves,
        profile,
      };
    }),
  );
  const members = legalMoveEntries.map((entry) => entry.member);

  return {
    members,
    breeding: breedingContext,
    defensive: analyzeDefensiveProfile(members),
    offensive: analyzeOffensiveCoverage(legalMoveEntries),
    profiles: legalMoveEntries.map((entry) => entry.profile),
  };
}

export function buildCandidateLegalityProfile({
  member,
  moves = [],
  representativeName = "",
}) {
  const damagingMoves = moves.filter(isDamagingMove);
  const recommendedMoves = recommendCurrentMoves(member, moves);
  const recommendedDamagingMoves = recommendedMoves.filter(isDamagingMove);
  const stabMoves = damagingMoves
    .filter((move) => member.types.includes(move.type))
    .sort(compareMoveQuality);
  const attackingTypes = summarizeAttackTypes(member, recommendedDamagingMoves);
  const superEffectiveTargetTypes = new Set();

  for (const move of recommendedDamagingMoves) {
    for (const defenseType of REBORN_ANALYSIS_TYPES) {
      if (getTypeMultiplier(move.type, [defenseType]) > 1) {
        superEffectiveTargetTypes.add(defenseType);
      }
    }
  }

  return {
    attackTypes: attackingTypes.map((entry) => entry.type),
    bestCoverageMoves: attackingTypes
      .filter((entry) => !member.types.includes(entry.type))
      .slice(0, 3),
    bestDamagingMove: damagingMoves
      .map((move) => formatProfileMove(move, member))
      .sort(compareProfileMove)[0] || null,
    bestStabMove: stabMoves[0] ? formatProfileMove(stabMoves[0], member) : null,
    currentId: member.id,
    currentName: member.name,
    currentTypes: member.types,
    inputName: member.inputName || member.name,
    legalDamagingMoveCount: damagingMoves.length,
    legalMoveCount: moves.length,
    recommendedDamagingMoveCount: recommendedDamagingMoves.length,
    recommendedMoves: recommendedMoves.map((move) =>
      formatRecommendedMove(move, member),
    ),
    representativeId: member.representativeId || member.id,
    representativeName,
    sourceCounts: countMoveSources(moves),
    superEffectiveTargetCount: superEffectiveTargetTypes.size,
  };
}

function analyzeDefensiveProfile(members) {
  return REBORN_ANALYSIS_TYPES.map((attackType) => {
    const matchups = members.map((member) => ({
      member,
      multiplier: getTypeMultiplier(attackType, member.types),
    }));

    return {
      type: attackType,
      weak: matchups.filter((entry) => entry.multiplier > 1),
      resist: matchups.filter(
        (entry) => entry.multiplier > 0 && entry.multiplier < 1,
      ),
      immune: matchups.filter((entry) => entry.multiplier === 0),
    };
  });
}

function analyzeOffensiveCoverage(legalMoveEntries) {
  const attackTypes = new Map();
  const memberStab = [];
  const superEffectiveTargets = new Map(
    REBORN_ANALYSIS_TYPES.map((type) => [type, []]),
  );

  for (const { member, profile } of legalMoveEntries) {
    const damagingMoves = (profile?.recommendedMoves || [])
      .filter(isDamagingMove)
      .map((move) => ({
        ...move,
        basePower: getMovePower(move),
        priority: move.priority || 0,
      }));
    const stabMoves = damagingMoves
      .filter((move) => member.types.includes(move.type))
      .sort(compareMoveQuality);

    memberStab.push({
      member,
      moves: stabMoves,
      bestMove: stabMoves[0] || null,
    });

    for (const move of damagingMoves) {
      const adjustedPower = getAdjustedPower(move, member);

      const entry = attackTypes.get(move.type) || {
        type: move.type,
        moves: [],
        members: new Map(),
        stabMembers: new Map(),
        bestMove: null,
      };

      entry.moves.push(move);
      if (!entry.members.has(member.id)) {
        entry.members.set(member.id, member.name);
      }
      if (member.types.includes(move.type)) {
        entry.stabMembers.set(member.id, member.name);
      }
      if (
        !entry.bestMove ||
        adjustedPower > entry.bestMove.adjustedPower ||
        (adjustedPower === entry.bestMove.adjustedPower &&
          move.name.localeCompare(entry.bestMove.name) < 0)
      ) {
        entry.bestMove = {
          adjustedPower,
          basePower: getMovePower(move),
          memberName: member.name,
          name: move.name,
        };
      }
      attackTypes.set(move.type, entry);

      for (const defenseType of REBORN_ANALYSIS_TYPES) {
        const multiplier = getTypeMultiplier(move.type, [defenseType]);
        if (multiplier <= 1) continue;

        superEffectiveTargets.get(defenseType).push({
          adjustedPower: adjustedPower * multiplier,
          attackType: move.type,
          basePower: getMovePower(move),
          memberName: member.name,
          moveName: move.name,
        });
      }
    }
  }

  const attackingTypes = [...attackTypes.values()]
    .map((entry) => ({
      ...entry,
      members: [...entry.members.values()].sort((a, b) => a.localeCompare(b)),
      stabMembers: [...entry.stabMembers.values()].sort((a, b) =>
        a.localeCompare(b),
      ),
      moveCount: entry.moves.length,
    }))
    .sort((a, b) => a.type.localeCompare(b.type));

  const availableAttackTypes = new Set(
    attackingTypes.map((entry) => entry.type),
  );
  const missingSuperEffectiveTargets = REBORN_ANALYSIS_TYPES.filter(
    (defenseType) =>
      ![...availableAttackTypes].some(
        (attackType) => getTypeMultiplier(attackType, [defenseType]) > 1,
      ),
  );
  const missingStabMembers = memberStab.filter((entry) => !entry.bestMove);
  const bestCoverageByTarget = [...superEffectiveTargets.entries()]
    .map(([type, options]) => ({
      type,
      best: options.sort(compareCoverageOption)[0] || null,
      optionCount: options.length,
    }))
    .sort((a, b) => {
      if (a.best && !b.best) return 1;
      if (!a.best && b.best) return -1;
      return (
        (a.best?.adjustedPower || 0) - (b.best?.adjustedPower || 0) ||
        a.type.localeCompare(b.type)
      );
    });

  return {
    attackingTypes,
    bestCoverageByTarget,
    missingSuperEffectiveTargets,
    missingStabMembers,
    memberStab,
  };
}

function isDamagingMove(move) {
  return move.category !== "Status" && getMovePower(move) > 0;
}

function summarizeAttackTypes(member, damagingMoves) {
  const byType = new Map();

  for (const move of damagingMoves) {
    const option = formatProfileMove(move, member);
    const entry = byType.get(move.type) || {
      type: move.type,
      bestMove: option,
      moveCount: 0,
      superEffectiveTargetCount: 0,
    };

    entry.moveCount += 1;
    if (compareProfileMove(option, entry.bestMove) < 0) {
      entry.bestMove = option;
    }
    byType.set(move.type, entry);
  }

  for (const entry of byType.values()) {
    entry.superEffectiveTargetCount = REBORN_ANALYSIS_TYPES.filter(
      (defenseType) => getTypeMultiplier(entry.type, [defenseType]) > 1,
    ).length;
  }

  return [...byType.values()].sort(
    (a, b) =>
      compareProfileMove(a.bestMove, b.bestMove) ||
      b.superEffectiveTargetCount - a.superEffectiveTargetCount ||
      a.type.localeCompare(b.type),
  );
}

function formatProfileMove(move, member) {
  return {
    adjustedPower: getAdjustedPower(move, member),
    basePower: getMovePower(move),
    id: move.id,
    name: move.name,
    priority: move.priority || 0,
    type: move.type,
  };
}

function formatRecommendedMove(move, member) {
  return {
    ...formatProfileMove(move, member),
    availableSources: move.availableSources || [],
    category: move.category,
    sourceLabel: formatBestSource(move),
    superEffectiveTargetCount: countSuperEffectiveTargets(move.type),
  };
}

function compareProfileMove(a, b) {
  return (
    b.adjustedPower - a.adjustedPower ||
    b.basePower - a.basePower ||
    a.name.localeCompare(b.name)
  );
}

function countMoveSources(moves) {
  const counts = {};

  for (const move of moves) {
    const kinds = new Set(
      (move.availableSources || []).map((source) => source.kind),
    );

    for (const kind of kinds) {
      counts[kind] = (counts[kind] || 0) + 1;
    }
  }

  return counts;
}

function compareMoveQuality(a, b) {
  return (
    (b.basePower || 0) - (a.basePower || 0) ||
    (b.priority || 0) - (a.priority || 0) ||
    a.name.localeCompare(b.name)
  );
}

function compareCoverageOption(a, b) {
  return (
    b.adjustedPower - a.adjustedPower ||
    b.basePower - a.basePower ||
    a.moveName.localeCompare(b.moveName)
  );
}

function getAdjustedPower(move, member) {
  const basePower = getMovePower(move);
  const stabMultiplier = member.types.includes(move.type) ? 1.5 : 1;
  return basePower * stabMultiplier;
}

function getMovePower(move) {
  return move.basePower || FIXED_DAMAGE_EFFECTIVE_POWER[move.id] || 0;
}

function recommendCurrentMoves(member, moves) {
  const selected = [];
  const damagingMoves = moves
    .filter(isDamagingMove)
    .map((move) => decorateMove(move, member));
  const utilityMoves = moves
    .filter((move) => !isDamagingMove(move) && UTILITY_MOVE_WEIGHTS[move.id])
    .map((move) => decorateMove(move, member));

  const bestStabByType = member.types
    .map((type) =>
      damagingMoves
        .filter((move) => move.type === type)
        .sort(compareRecommendedDamagingMoves)[0],
    )
    .filter(Boolean);

  for (const move of bestStabByType) {
    addRecommendedMove(selected, move);
  }

  const bestCoverageByType = getBestDamagingMoveByType(damagingMoves)
    .filter((move) => !member.types.includes(move.type))
    .sort(compareRecommendedDamagingMoves);

  for (const move of bestCoverageByType) {
    if (selected.length >= 4) break;
    addRecommendedMove(selected, move);
  }

  const bestUtilityMoves = utilityMoves.sort(compareUtilityMoves);
  for (const move of bestUtilityMoves) {
    if (selected.length >= 4) break;
    addRecommendedMove(selected, move);
  }

  const bestRemainingDamage = damagingMoves.sort(compareRecommendedDamagingMoves);
  for (const move of bestRemainingDamage) {
    if (selected.length >= 4) break;
    addRecommendedMove(selected, move);
  }

  return selected.slice(0, 4);
}

function addRecommendedMove(selected, move) {
  if (!move || selected.some((entry) => entry.id === move.id)) return;
  selected.push(move);
}

function decorateMove(move, member) {
  return {
    ...move,
    basePower: getMovePower(move),
    adjustedPower: getAdjustedPower(move, member),
    sourcePriority: getBestSourcePriority(move),
    superEffectiveTargetCount: countSuperEffectiveTargets(move.type),
    utilityWeight: UTILITY_MOVE_WEIGHTS[move.id] || 0,
  };
}

function getBestDamagingMoveByType(damagingMoves) {
  const byType = new Map();

  for (const move of damagingMoves) {
    const current = byType.get(move.type);
    if (!current || compareRecommendedDamagingMoves(move, current) < 0) {
      byType.set(move.type, move);
    }
  }

  return [...byType.values()];
}

function compareRecommendedDamagingMoves(a, b) {
  return (
    Number(memberHasStab(b)) - Number(memberHasStab(a)) ||
    b.superEffectiveTargetCount - a.superEffectiveTargetCount ||
    b.adjustedPower - a.adjustedPower ||
    (b.priority || 0) - (a.priority || 0) ||
    a.sourcePriority - b.sourcePriority ||
    a.name.localeCompare(b.name)
  );
}

function memberHasStab(move) {
  return move.adjustedPower > (move.basePower || 0);
}

function compareUtilityMoves(a, b) {
  return (
    b.utilityWeight - a.utilityWeight ||
    a.sourcePriority - b.sourcePriority ||
    a.name.localeCompare(b.name)
  );
}

function countSuperEffectiveTargets(attackType) {
  return REBORN_ANALYSIS_TYPES.filter(
    (defenseType) => getTypeMultiplier(attackType, [defenseType]) > 1,
  ).length;
}

function getBestSourcePriority(move) {
  const priorities = {
    "level-up": 0,
    relearner: 1,
    tm: 2,
    tmx: 3,
    tutor: 4,
    egg: 5,
  };

  return Math.min(
    ...(move.availableSources || []).map((source) => priorities[source.kind] ?? 9),
    9,
  );
}

function formatBestSource(move) {
  const source = [...(move.availableSources || [])].sort(
    (a, b) => getSourcePriority(a) - getSourcePriority(b),
  )[0];

  if (!source) return "Legal";
  return source.detail ? `${source.label}: ${source.detail}` : source.label;
}

function getSourcePriority(source) {
  const priorities = {
    "level-up": 0,
    relearner: 1,
    tm: 2,
    tmx: 3,
    tutor: 4,
    egg: 5,
  };

  return priorities[source.kind] ?? 9;
}

const UTILITY_MOVE_WEIGHTS = {
  recover: 100,
  roost: 100,
  moonlight: 95,
  morningsun: 95,
  synthesis: 95,
  softboiled: 100,
  slackoff: 100,
  swordsdance: 90,
  nastyplot: 90,
  dragondance: 95,
  quiverdance: 100,
  calmmind: 85,
  bulkup: 85,
  coil: 85,
  curse: 75,
  honeclaws: 70,
  workup: 65,
  willowisp: 85,
  thunderwave: 85,
  toxic: 80,
  sleeppowder: 85,
  spore: 100,
  stunspore: 70,
  glare: 85,
  leechseed: 80,
  substitute: 75,
  protect: 55,
  reflect: 65,
  lightscreen: 65,
};

const FIXED_DAMAGE_EFFECTIVE_POWER = {
  dragonrage: 80,
  finalgambit: 80,
  guardianofalola: 80,
  naturemadness: 80,
  nightshade: 60,
  psywave: 60,
  seismictoss: 60,
  sonicboom: 40,
  superfang: 90,
};

