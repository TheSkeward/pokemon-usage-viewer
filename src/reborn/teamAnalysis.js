import {
  getAvailableRebornMoves,
  loadRebornLegalMoveData,
} from "./legalMoves";
import { getCurrentRebornSpeciesForChoice } from "./currentSpecies.js";

export const REBORN_ANALYSIS_TYPES = [
  "Normal",
  "Fire",
  "Water",
  "Electric",
  "Grass",
  "Ice",
  "Fighting",
  "Poison",
  "Ground",
  "Flying",
  "Psychic",
  "Bug",
  "Rock",
  "Ghost",
  "Dragon",
  "Dark",
  "Steel",
  "Fairy",
];

export async function buildRebornTeamAnalysis(team = [], progression = {}) {
  const legalMoveEntries = await Promise.all(
    team.map(async (row) => {
      const currentSpecies = getCurrentRebornSpeciesForChoice(row, progression);
      const legalMoveData = await loadRebornLegalMoveData(
        currentSpecies?.id || row.pokemonId,
      );
      const member = {
        id: currentSpecies?.id || row.pokemonId,
        name: currentSpecies?.name || row.name,
        representativeName: currentSpecies?.differsFromRepresentative
          ? currentSpecies.representativeName
          : "",
        types: legalMoveData?.types || [],
      };

      return {
        member,
        moves: getAvailableRebornMoves(legalMoveData, progression),
      };
    }),
  );
  const members = legalMoveEntries.map((entry) => entry.member);

  return {
    members,
    defensive: analyzeDefensiveProfile(members),
    offensive: analyzeOffensiveCoverage(legalMoveEntries),
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

  for (const { member, moves } of legalMoveEntries) {
    const damagingMoves = moves.filter(isDamagingMove);
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
          basePower: move.basePower || 0,
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
          basePower: move.basePower || 0,
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
  return move.category !== "Status" && (move.basePower || 0) > 0;
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
  const basePower = move.basePower || 0;
  const stabMultiplier = member.types.includes(move.type) ? 1.5 : 1;
  return basePower * stabMultiplier;
}

function getTypeMultiplier(attackType, defenseTypes = []) {
  let multiplier = 1;

  for (const defenseType of defenseTypes) {
    const code = TYPE_DAMAGE_TAKEN[defenseType]?.[attackType];

    if (code === 3) return 0;
    if (code === 1) multiplier *= 2;
    if (code === 2) multiplier *= 0.5;
  }

  return multiplier;
}

const TYPE_DAMAGE_TAKEN = {
  Normal: { Fighting: 1, Ghost: 3 },
  Fire: { Ground: 1, Rock: 1, Water: 1, Bug: 2, Fairy: 2, Fire: 2, Grass: 2, Ice: 2, Steel: 2 },
  Water: { Electric: 1, Grass: 1, Fire: 2, Ice: 2, Steel: 2, Water: 2 },
  Electric: { Ground: 1, Electric: 2, Flying: 2, Steel: 2 },
  Grass: { Bug: 1, Fire: 1, Flying: 1, Ice: 1, Poison: 1, Electric: 2, Grass: 2, Ground: 2, Water: 2 },
  Ice: { Fighting: 1, Fire: 1, Rock: 1, Steel: 1, Ice: 2 },
  Fighting: { Fairy: 1, Flying: 1, Psychic: 1, Bug: 2, Dark: 2, Rock: 2 },
  Poison: { Ground: 1, Psychic: 1, Bug: 2, Fairy: 2, Fighting: 2, Grass: 2, Poison: 2 },
  Ground: { Grass: 1, Ice: 1, Water: 1, Electric: 3, Poison: 2, Rock: 2 },
  Flying: { Electric: 1, Ice: 1, Rock: 1, Ground: 3, Bug: 2, Fighting: 2, Grass: 2 },
  Psychic: { Bug: 1, Dark: 1, Ghost: 1, Fighting: 2, Psychic: 2 },
  Bug: { Fire: 1, Flying: 1, Rock: 1, Fighting: 2, Grass: 2, Ground: 2 },
  Rock: { Fighting: 1, Grass: 1, Ground: 1, Steel: 1, Water: 1, Fire: 2, Flying: 2, Normal: 2, Poison: 2 },
  Ghost: { Dark: 1, Ghost: 1, Fighting: 3, Normal: 3, Bug: 2, Poison: 2 },
  Dragon: { Dragon: 1, Fairy: 1, Ice: 1, Electric: 2, Fire: 2, Grass: 2, Water: 2 },
  Dark: { Bug: 1, Fairy: 1, Fighting: 1, Psychic: 3, Dark: 2, Ghost: 2 },
  Steel: { Fighting: 1, Fire: 1, Ground: 1, Poison: 3, Bug: 2, Dragon: 2, Fairy: 2, Flying: 2, Grass: 2, Ice: 2, Normal: 2, Psychic: 2, Rock: 2, Steel: 2 },
  Fairy: { Poison: 1, Steel: 1, Dragon: 3, Bug: 2, Dark: 2, Fighting: 2 },
};
