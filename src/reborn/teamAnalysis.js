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
import { estimateMoveDamage, getAttackingStats } from "./damageModel.js";
import { loadTopSpread } from "./topSpread.js";

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
  const { family, selection } = breedingOptions;
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

      // Estimate damage off the member's current species using its observed top
      // set's EVs + nature (best effort; falls back to natural investment).
      const spread = await loadTopSpread({
        family,
        pokemonId: member.id,
        selection,
      });
      const attackerStats = getAttackingStats({
        pokemonId: member.id,
        levelCap: progression.levelCap,
        spread,
      });

      const profile = buildCandidateLegalityProfile({
        member,
        moves,
        representativeName: row.name,
        attackerStats,
        levelCap: progression.levelCap,
      });

      return {
        member,
        moves,
        profile,
        row,
      };
    }),
  );
  const members = legalMoveEntries.map((entry) => entry.member);
  const defensive = analyzeDefensiveProfile(members);
  const offensive = analyzeOffensiveCoverage(legalMoveEntries);
  const profiles = legalMoveEntries.map((entry) => entry.profile);

  return {
    members,
    breeding: breedingContext,
    defensive,
    explanation: buildTeamExplanation({
      defensive,
      legalMoveEntries,
      lines: breedingOptions.lines || [],
      offensive,
      profiles,
    }),
    offensive,
    profiles,
  };
}

export function buildCandidateLegalityProfile({
  member,
  moves = [],
  representativeName = "",
  attackerStats,
  levelCap,
}) {
  const stats =
    attackerStats ||
    getAttackingStats({ pokemonId: member.id, levelCap });
  const damagingMoves = moves.filter((move) => isUsableDamagingMove(move, moves));
  const recommendedMoves = recommendCurrentMoves(member, moves, stats);
  const recommendedDamagingMoves = recommendedMoves.filter(isDamagingMove);
  const stabMoves = damagingMoves
    .filter((move) => member.types.includes(move.type))
    .sort(compareMoveQuality);
  const attackingTypes = summarizeAttackTypes(member, recommendedDamagingMoves, stats);
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
      .map((move) => formatProfileMove(move, member, stats))
      .sort(compareProfileMove)[0] || null,
    bestStabMove: stabMoves[0]
      ? formatProfileMove(stabMoves[0], member, stats)
      : null,
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
    // Recommended moves already carry estimatedDamage (category/STAB-aware) and
    // basePower from formatRecommendedMove, so reuse them rather than recompute.
    const damagingMoves = (profile?.recommendedMoves || []).filter(isDamagingMove);
    const stabMoves = damagingMoves
      .filter((move) => member.types.includes(move.type))
      .sort(compareMoveQuality);

    memberStab.push({
      member,
      moves: stabMoves,
      bestMove: stabMoves[0] || null,
    });

    for (const move of damagingMoves) {
      const estimatedDamage = move.estimatedDamage || 0;

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
        estimatedDamage > entry.bestMove.estimatedDamage ||
        (estimatedDamage === entry.bestMove.estimatedDamage &&
          move.name.localeCompare(entry.bestMove.name) < 0)
      ) {
        entry.bestMove = {
          estimatedDamage,
          basePower: move.basePower,
          category: move.category || null,
          memberName: member.name,
          name: move.name,
        };
      }
      attackTypes.set(move.type, entry);

      for (const defenseType of REBORN_ANALYSIS_TYPES) {
        const multiplier = getTypeMultiplier(move.type, [defenseType]);
        if (multiplier <= 1) continue;

        superEffectiveTargets.get(defenseType).push({
          estimatedDamage: estimatedDamage * multiplier,
          attackType: move.type,
          basePower: move.basePower,
          category: move.category || null,
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
        (a.best?.estimatedDamage || 0) - (b.best?.estimatedDamage || 0) ||
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

function buildTeamExplanation({
  defensive,
  legalMoveEntries,
  lines,
  offensive,
  profiles,
}) {
  const selectedKeys = new Set(
    legalMoveEntries.map(
      ({ row }) => `${row.inputPokemonId || row.inputName}:${row.pokemonId}`,
    ),
  );
  const attackTypeCounts = countRecommendedAttackTypes(profiles);
  const defensiveHoles = getDefensiveHoles(defensive);
  const offensiveHoles = getOffensiveHoles(offensive);

  return {
    pickReasons: legalMoveEntries
      .map(({ profile }) =>
        formatPickReason(profile, {
          attackTypeCounts,
          defensiveHoles,
        }),
      )
      .filter(Boolean)
      .slice(0, 6),
    holes: [...defensiveHoles.map(formatDefensiveHole), ...offensiveHoles]
      .filter(Boolean)
      .slice(0, 6),
    fixSuggestions: buildFixSuggestions({
      defensiveHoles,
      lines,
      offensive,
      selectedKeys,
    }).slice(0, 5),
  };
}

function formatPickReason(profile, { attackTypeCounts, defensiveHoles }) {
  const reasons = [];
  const uniqueAttackTypes = (profile.attackTypes || []).filter(
    (type) => attackTypeCounts.get(type) === 1,
  );
  const coveredWeaknesses = defensiveHoles
    .filter((hole) =>
      resistsOrImmune(profile.currentTypes, hole.type),
    )
    .map((hole) => hole.type);

  if (profile.bestStabMove) {
    reasons.push(`${profile.bestStabMove.name} STAB`);
  }

  if (uniqueAttackTypes.length) {
    reasons.push(`${uniqueAttackTypes.slice(0, 2).join("/")} coverage`);
  } else if (profile.bestCoverageMoves.length) {
    reasons.push(
      `${profile.bestCoverageMoves
        .slice(0, 2)
        .map((entry) => entry.type)
        .join("/")} coverage`,
    );
  }

  if (coveredWeaknesses.length) {
    reasons.push(`covers ${coveredWeaknesses.slice(0, 2).join("/")}`);
  }

  if (!reasons.length) return "";

  return `${profile.inputName}: ${profile.currentName} contributes ${reasons.join(", ")}.`;
}

function getDefensiveHoles(defensive) {
  return defensive
    .filter((entry) => entry.weak.length >= 2)
    .map((entry) => ({
      ...entry,
      coverCount: entry.resist.length + entry.immune.length,
    }))
    .sort(
      (a, b) =>
        b.weak.length - a.weak.length ||
        a.coverCount - b.coverCount ||
        a.type.localeCompare(b.type),
    )
    .slice(0, 6);
}

function formatDefensiveHole(hole) {
  const weakNames = hole.weak
    .slice(0, 3)
    .map(({ member }) => member.name)
    .join(", ");

  if (hole.coverCount === 0) {
    return `${hole.type}: ${hole.weak.length} picks are weak and there is no current resist or immunity (${weakNames}).`;
  }

  return `${hole.type}: ${hole.weak.length} picks are weak; ${hole.coverCount} teammate${hole.coverCount === 1 ? "" : "s"} can switch in.`;
}

function getOffensiveHoles(offensive) {
  const holes = [];

  if (offensive.missingStabMembers.length) {
    holes.push(
      `No recommended STAB for ${offensive.missingStabMembers
        .slice(0, 3)
        .map((entry) => entry.member.name)
        .join(", ")}.`,
    );
  }

  if (offensive.missingSuperEffectiveTargets.length) {
    holes.push(
      `No recommended super-effective hit into ${offensive.missingSuperEffectiveTargets
        .slice(0, 5)
        .join(", ")}.`,
    );
  }

  const weakestHits = offensive.bestCoverageByTarget
    .filter((entry) => entry.best)
    .slice(0, 3);

  for (const entry of weakestHits) {
    holes.push(
      `Weak ${entry.type} answer: best current hit is ${entry.best.moveName} from ${entry.best.memberName}.`,
    );
  }

  return holes;
}

function buildFixSuggestions({ defensiveHoles, lines, offensive, selectedKeys }) {
  const suggestions = [];
  const missingTargets = new Set(offensive.missingSuperEffectiveTargets || []);

  for (const line of lines || []) {
    const lineOptions = [
      line.best,
      line.bestNonMega,
      ...(line.choiceOptions || []),
    ].filter(Boolean);
    const selectedChoice = lineOptions.find((choice) =>
      selectedKeys.has(getChoiceKey(choice)),
    );

    for (const option of line.choiceOptions || []) {
      if (!option?.legalityProfile || selectedKeys.has(getChoiceKey(option))) {
        continue;
      }

      const fixes = getOptionFixes(option.legalityProfile, {
        defensiveHoles,
        missingTargets,
      });

      if (!fixes.length) continue;

      suggestions.push({
        score: fixes.length * 100 + Math.max(0, option.legalityScore || 0) / 100,
        text: `Consider ${option.name} over ${selectedChoice?.name || option.inputName} for ${fixes.slice(0, 2).join(" and ")}.`,
      });
    }
  }

  return suggestions
    .sort((a, b) => b.score - a.score || a.text.localeCompare(b.text))
    .map((entry) => entry.text)
    .filter((text, index, all) => all.indexOf(text) === index);
}

function getChoiceKey(choice) {
  return `${choice.inputPokemonId || choice.inputName}:${choice.pokemonId}`;
}

function getOptionFixes(profile, { defensiveHoles, missingTargets }) {
  const fixes = [];
  const coveredWeaknesses = defensiveHoles
    .filter((hole) => resistsOrImmune(profile.currentTypes, hole.type))
    .map((hole) => hole.type);
  const coverageFixes = [...missingTargets].filter((targetType) =>
    (profile.attackTypes || []).some(
      (attackType) => getTypeMultiplier(attackType, [targetType]) > 1,
    ),
  );

  if (coveredWeaknesses.length) {
    fixes.push(`${coveredWeaknesses.slice(0, 2).join("/")} defensive cover`);
  }

  if (coverageFixes.length) {
    fixes.push(`${coverageFixes.slice(0, 2).join("/")} offensive coverage`);
  }

  return fixes;
}

function countRecommendedAttackTypes(profiles) {
  const counts = new Map();

  for (const profile of profiles) {
    for (const attackType of profile.attackTypes || []) {
      counts.set(attackType, (counts.get(attackType) || 0) + 1);
    }
  }

  return counts;
}

function resistsOrImmune(defenseTypes, attackType) {
  const multiplier = getTypeMultiplier(attackType, defenseTypes || []);
  return multiplier === 0 || (multiplier > 0 && multiplier < 1);
}

function isDamagingMove(move) {
  return move.category !== "Status" && getMovePower(move) > 0;
}

// Snore only deals damage while the user is asleep, so it's a dead move unless
// the set can also put the user to sleep. Rest is the only reliable self-sleep
// move, so gate Snore on having it available.
const SLEEP_GATED_DAMAGING_MOVE_IDS = new Set(["snore"]);
const SELF_SLEEP_MOVE_IDS = new Set(["rest"]);

function hasSelfSleepMove(moves) {
  return moves.some((move) => SELF_SLEEP_MOVE_IDS.has(move.id));
}

// Like isDamagingMove, but accounts for moveset-conditional attacks (Snore).
function isUsableDamagingMove(move, moves) {
  if (!isDamagingMove(move)) return false;
  if (
    SLEEP_GATED_DAMAGING_MOVE_IDS.has(move.id) &&
    !hasSelfSleepMove(moves)
  ) {
    return false;
  }
  return true;
}

function summarizeAttackTypes(member, damagingMoves, attackerStats) {
  const byType = new Map();

  for (const move of damagingMoves) {
    const option = formatProfileMove(move, member, attackerStats);
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

function formatProfileMove(move, member, attackerStats) {
  return {
    adjustedPower: getAdjustedPower(move, member),
    estimatedDamage: getEstimatedDamage(move, member, attackerStats),
    basePower: getMovePower(move),
    category: move.category || null,
    id: move.id,
    name: move.name,
    priority: move.priority || 0,
    type: move.type,
  };
}

function formatRecommendedMove(move, member, attackerStats) {
  return {
    ...formatProfileMove(move, member, attackerStats),
    availableSources: move.availableSources || [],
    category: move.category,
    sourceLabel: formatBestSource(move),
    superEffectiveTargetCount: countSuperEffectiveTargets(move.type),
  };
}

function compareProfileMove(a, b) {
  return (
    b.estimatedDamage - a.estimatedDamage ||
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
    b.estimatedDamage - a.estimatedDamage ||
    b.basePower - a.basePower ||
    a.moveName.localeCompare(b.moveName)
  );
}

function getAdjustedPower(move, member) {
  const basePower = getMovePower(move);
  const stabMultiplier = member.types.includes(move.type) ? 1.5 : 1;
  return basePower * stabMultiplier;
}

// Category/STAB-aware unresisted-damage estimate, used as the ranking key so a
// physical attacker prefers its physical moves and vice versa. Fixed-damage
// moves (handled inside estimateMoveDamage) keep their value on weak attackers.
function getEstimatedDamage(move, member, attackerStats) {
  return estimateMoveDamage({
    basePower: move.basePower,
    effectivePower: getMovePower(move),
    category: move.category,
    type: move.type,
    attackerTypes: member.types,
    attackerStats,
  });
}

function getMovePower(move) {
  return move.basePower || FIXED_DAMAGE_EFFECTIVE_POWER[move.id] || 0;
}

function recommendCurrentMoves(member, moves, attackerStats) {
  const selected = [];
  const damagingMoves = moves
    .filter((move) => isUsableDamagingMove(move, moves))
    .map((move) => decorateMove(move, member, attackerStats));
  const utilityMoves = moves
    .filter((move) => !isDamagingMove(move) && UTILITY_MOVE_WEIGHTS[move.id])
    .map((move) => decorateMove(move, member, attackerStats));

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

function decorateMove(move, member, attackerStats) {
  return {
    ...move,
    basePower: getMovePower(move),
    adjustedPower: getAdjustedPower(move, member),
    estimatedDamage: getEstimatedDamage(move, member, attackerStats),
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
    b.estimatedDamage - a.estimatedDamage ||
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

