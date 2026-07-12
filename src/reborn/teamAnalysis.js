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
import {
  coverageDamageIntoType,
  estimateMoveDamage,
  getAbilityDamageMultiplier,
  getAbilityEffectiveMoveType,
  getAttackingStats,
  isFixedDamageMove,
  normalizeLevel,
  parseSpread,
} from "./damageModel.js";
import { loadTopSet } from "./topSpread.js";
import { computeSetReadiness } from "./setReadiness.js";
import { teamMemberKey } from "../teamBuilder/itemRecommendations.js";
import { toId } from "../utils/ids.js";
import { MAX_OPPONENT_TYPE_BIAS } from "./progression.js";
import { getItemDamageMultiplier } from "./itemDamage.js";
import { stageReferenceDamage } from "../teamBuilder/currentFormValue.js";

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
  const { family, selection, itemAssignments } = breedingOptions;
  const legalMoveEntries = await Promise.all(
    team.map(async (row) => {
      const assignedItem = itemAssignments?.[teamMemberKey(row)];
      const entry = await buildMemberLegalMoveEntry({
        row,
        progression,
        breedingContext,
        family,
        selection,
        assignedItem,
        itemAware: true,
      });
      entry.profile.recommendedSet = buildRecommendedSet({
        member: entry.member,
        profile: entry.profile,
        topSet: entry.topSet,
        assignedItem,
        levelCap: progression.levelCap,
      });
      return entry;
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
    }),
    offensive,
    profiles,
  };
}

// Loads one team member's current species, its progression-legal moves, and the
// derived legality profile (including the recommended set of moves). Shared by
// the full analysis and the lighter move-type lookup below so both see exactly
// the same recommended moves. Does NOT attach a recommendedSet — that needs the
// assigned item, which is computed separately.
async function buildMemberLegalMoveEntry({
  row,
  progression,
  breedingContext,
  family,
  selection,
  assignedItem = null,
  itemAware = false,
}) {
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

  // Pull the most-used competitive set (top spread / ability / item / move
  // usage) from the CHOSEN CANDIDATE (the line's usage representative, e.g.
  // Lopunny-Mega at AG 1760) — the same source the optimizer scored with —
  // NOT the fielded form. Sourcing by the fielded form showed a different
  // tier's sets than the score was built on (a Lopunny-Mega pick displayed
  // base Lopunny's ZU sets). Falls back to the fielded form for rows with no
  // representative data.
  let topSet = await loadTopSet({
    family,
    pokemonId: member.representativeId || member.id,
    selection,
  });
  if (
    !topSet.moveUsage?.size &&
    member.representativeId &&
    member.representativeId !== member.id
  ) {
    topSet = await loadTopSet({ family, pokemonId: member.id, selection });
  }
  const attackerStats = getAttackingStats({
    pokemonId: member.id,
    levelCap: progression.levelCap,
    spread: topSet.spread,
  });

  // The item the mon is recommended to hold (owned-item assignment, else its top
  // competitive item) factors into its damage. Only when this entry feeds the
  // displayed analysis — the gem-gating prepass stays item-blind.
  const heldItem = itemAware
    ? (assignedItem?.name ?? topSet.item)
    : null;

  const profile = buildCandidateLegalityProfile({
    member,
    moves,
    representativeName: row.name,
    attackerStats,
    levelCap: progression.levelCap,
    moveUsage: topSet.moveUsage,
    moveRank: topSet.moveRank,
    heldItem,
    ability: topSet.ability,
    opponentTypeBias: progression.opponentTypeBias,
  });

  // Display-only: how much of the represented form's competitive set is
  // assemblable now, and the cap where it completes (Phase 1 readiness).
  profile.setReadiness = computeSetReadiness({
    legalMoveData,
    availableMoves: moves,
    topSet,
    progression: memberProgression,
  });

  return { member, moves, profile, topSet, row };
}

// Per-member context the item recommender needs but can only get from the move
// analysis: the types its *recommended* damaging moves cover, and whether its
// top competitive set actually runs Unburden. Both gate gem recommendations —
// a type Gem is useless without a move of its type, and the Unburden speed
// payoff only applies if Unburden is the set's ability (not merely a legal one,
// e.g. Liepard's top sets run Prankster). Uses the same pipeline as the analysis
// panel so the gates match what the player sees.
export async function getTeamItemContext(
  team = [],
  progression = {},
  breedingOptions = {},
) {
  const breedingContext = await buildRebornBreedingContext({
    ...breedingOptions,
    progression,
  });
  const { family, selection } = breedingOptions;
  const byMember = new Map();

  await Promise.all(
    team.map(async (row) => {
      const entry = await buildMemberLegalMoveEntry({
        row,
        progression,
        breedingContext,
        family,
        selection,
      });
      const damageTypes = new Set(
        (entry.profile.recommendedMoves || [])
          // Gems and plates can't boost fixed damage, so its type never
          // justifies a type-boosting item.
          .filter((move) => isDamagingMove(move) && !isFixedDamageMove(move.id))
          .map((move) => move.type),
      );
      byMember.set(teamMemberKey(row), {
        damageTypes,
        unburden: toId(entry.topSet?.ability) === "unburden",
      });
    }),
  );

  return byMember;
}

export function buildCandidateLegalityProfile({
  member: rawMember,
  moves = [],
  representativeName = "",
  attackerStats,
  levelCap,
  moveUsage = new Map(),
  moveRank = new Map(),
  opponentTypeBias = {},
  heldItem = null,
  ability = null,
  evolution = null,
  buildFriction = 0,
  movePreference = "default",
}) {
  // Carry the recommended held item AND the mon's competitive ability on the
  // member, so every damage estimate (display, ranking, bias, team scoring)
  // reflects them — Protean/Libero make every move STAB.
  const member =
    heldItem || ability
      ? { ...rawMember, ...(heldItem ? { heldItem } : {}), ...(ability ? { ability } : {}) }
      : rawMember;
  const stats =
    attackerStats ||
    getAttackingStats({ pokemonId: member.id, levelCap });
  const damagingMoves = moves.filter((move) => isUsableDamagingMove(move, moves));
  const recommendedMoves = recommendCurrentMoves(
    member,
    moves,
    stats,
    moveUsage,
    opponentTypeBias,
    movePreference,
    moveRank,
  );
  const recommendedDamagingMoves = recommendedMoves.filter(isDamagingMove);
  const stabMoves = damagingMoves
    // Typeless fixed damage never gets STAB, so it can't be the STAB pick.
    .filter(
      (move) =>
        member.types.includes(move.type) && !isFixedDamageMove(move.id),
    )
    .sort(compareMoveQuality);
  // Display order: the mon's canonical moves (its top-4 by usage) lead, in
  // descending-usage order, mirroring how its competitive set reads; the
  // remaining picks follow in descending estimated damage. (Damage already
  // factors STAB and the attacker's level/nature/EVs vs a neutral defender, so
  // it ranks the user's own clicks without "knowing" super-effectiveness.)
  const canonicalRankById = new Map(
    [...moveUsage.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([id], index) => [id, index]),
  );
  const formattedRecommendedMoves = recommendedMoves
    .map((move) => formatRecommendedMove(move, member, stats))
    .sort((a, b) => compareDisplayOrder(a, b, canonicalRankById));
  const attackingTypes = summarizeAttackTypes(
    member,
    recommendedDamagingMoves,
    stats,
  );
  const superEffectiveTargetTypes = new Set();

  for (const move of recommendedDamagingMoves) {
    // Fixed-damage moves are never super effective (they ignore effectiveness
    // multipliers in-game), so they claim no super-effective targets.
    if (isFixedDamageMove(move.id)) continue;
    for (const defenseType of REBORN_ANALYSIS_TYPES) {
      if (getTypeMultiplier(move.type, [defenseType]) > 1) {
        superEffectiveTargetTypes.add(defenseType);
      }
    }
  }

  // Damage-aware coverage vector: A(this build, e) for each defense type e — the
  // build's best real hit into e (its recommended damaging moves' estimated damage,
  // ability/STAB/effectiveness-aware) as a fraction of a stage-typical strong hit.
  // So a 30-BP Lick contributes ~nothing to Ghost coverage while a Protean Ice
  // Beam into Ground/Dragon contributes a lot. Consumed by the team coverage term.
  const coverageRef = stageReferenceDamage(levelCap) || 1;
  const recommendedMoveDamage = recommendedDamagingMoves.map((move) => ({
    id: move.id,
    type: move.type,
    damage: getEstimatedDamage(move, member, stats),
  }));
  const coverageVector = REBORN_ANALYSIS_TYPES.map((defenseType) => {
    let best = 0;
    for (const md of recommendedMoveDamage) {
      // Fixed-damage moves land flat into everything their type can touch —
      // never boosted, never resisted, zero only into immunities.
      const dealt = coverageDamageIntoType(md.id, md.type, md.damage, defenseType);
      if (dealt > best) best = dealt;
    }
    return Math.min(1, best / coverageRef);
  });

  return {
    coverageVector,
    // The ability the score ASSUMES (the form's primary competitive ability, e.g.
    // Protean for the Greninja line). Surfaced so the assumption is visible — the
    // actual caught mon's ability isn't known here, so this is "best obtainable,
    // noted", not a claim about legality.
    assumedAbility: ability || null,
    movePreference,
    // K for having reached this fielded form (evolution requirements) plus any
    // build friction (e.g. delayed-evolution moves), with the auditable proof.
    frictionCost: (evolution?.friction || 0) + (buildFriction || 0),
    legalityProof: {
      fielded: member.id,
      evolutionSteps: evolution?.steps || [],
      blockedEvolutions: evolution?.blocked || [],
      buildFriction: buildFriction || 0,
    },
    attackTypes: attackingTypes.map((entry) => entry.type),
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
    recommendedMoves: formattedRecommendedMoves,
    representativeId: member.representativeId || member.id,
    representativeName,
    sourceCounts: countMoveSources(moves),
    superEffectiveTargetCount: superEffectiveTargetTypes.size,
  };
}

// Assembles a complete recommended set for a pick: its current species, the
// owned-item recommendation (falling back to the top competitive item), the most-
// used ability and EV spread + nature, the level cap, and the recommended moves.
function buildRecommendedSet({ member, profile, topSet, assignedItem, levelCap }) {
  const parsed = topSet.spread ? parseSpread(topSet.spread) : null;

  return {
    species: member.name,
    representativeName: member.representativeName || "",
    item: assignedItem?.name || topSet.item || null,
    ability: topSet.ability || null,
    nature: parsed?.nature ? capitalize(parsed.nature) : null,
    evs: parsed?.evs || null,
    level: normalizeLevel(levelCap),
    moves: (profile.recommendedMoves || []).map((entry) => entry.name),
  };
}

const EV_LABELS = ["HP", "Atk", "Def", "SpA", "SpD", "Spe"];

// Renders the team's recommended sets as Showdown/poképaste text.
export function formatTeamPokepaste(sets = []) {
  return sets.filter(Boolean).map(formatShowdownSet).join("\n\n");
}

export function formatShowdownSet(set) {
  if (!set) return "";

  const lines = [set.item ? `${set.species} @ ${set.item}` : set.species];
  if (set.ability) lines.push(`Ability: ${set.ability}`);
  if (set.level && set.level !== 100) lines.push(`Level: ${set.level}`);

  const evLine = formatEvLine(set.evs);
  if (evLine) lines.push(`EVs: ${evLine}`);
  if (set.nature) lines.push(`${set.nature} Nature`);

  for (const move of set.moves || []) lines.push(`- ${move}`);

  return lines.join("\n");
}

function formatEvLine(evs) {
  if (!Array.isArray(evs)) return "";

  return evs
    .map((value, index) => (value > 0 ? `${value} ${EV_LABELS[index]}` : null))
    .filter(Boolean)
    .join(" / ");
}

function capitalize(value) {
  const text = String(value || "");
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
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
      // Typeless fixed damage is neither STAB nor an attack-type entry below.
      .filter(
        (move) =>
          member.types.includes(move.type) && !isFixedDamageMove(move.id),
      )
      .sort(compareMoveQuality);

    memberStab.push({
      member,
      moves: stabMoves,
      bestMove: stabMoves[0] || null,
    });

    for (const move of damagingMoves) {
      // Fixed damage is typeless offense: it doesn't make the team "a Fighting
      // attacker", and it can't be super effective.
      if (isFixedDamageMove(move.id)) continue;
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

// Only the fix suggestions survive here: "Why This Team?" recomputed a
// second best-STAB that could disagree with the realized set on the same
// page, and "Team Holes" restated the Defensive Profile / Team Coverage
// tables (which show names AND answers). One fact, one source, one place.
function buildTeamExplanation({ defensive, legalMoveEntries, lines, offensive }) {
  const selectedKeys = new Set(
    legalMoveEntries.map(
      ({ row }) => `${row.inputPokemonId || row.inputName}:${row.pokemonId}`,
    ),
  );
  const defensiveHoles = getDefensiveHoles(defensive);

  return {
    fixSuggestions: buildFixSuggestions({
      defensiveHoles,
      lines,
      offensive,
      selectedKeys,
    }).slice(0, 5),
  };
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

// Suggests bench (unselected pool) Pokémon that patch a named team hole — a
// shared weakness with no switch-in, or a type nothing hits super-effectively.
// Only ever references picks NOT on the team, spoken as the form you'd field, so
// it can't degenerate into "swap a pick for itself" or another of its evolutions.
function buildFixSuggestions({ defensiveHoles, lines, offensive, selectedKeys }) {
  const bench = collectBenchOptions(lines, selectedKeys);
  if (!bench.length) return [];

  const suggestions = [];

  // Defensive holes first, the uncovered ones (no resist/immunity) most urgent.
  const holes = [...defensiveHoles].sort(
    (a, b) => a.coverCount - b.coverCount || b.weak.length - a.weak.length,
  );
  for (const hole of holes) {
    const pick = bench
      .filter((option) => resistsOrImmune(option.profile.currentTypes, hole.type))
      .sort((a, b) => b.score - a.score)[0];
    if (!pick) continue;

    suggestions.push({
      priority: (hole.coverCount === 0 ? 200 : 100) + hole.weak.length,
      text: `Weak to ${hole.type} (${hole.weak.length} picks): ${pick.name} resists it.`,
    });
  }

  // Then types the team can't hit super effectively at all.
  for (const targetType of offensive.missingSuperEffectiveTargets || []) {
    const pick = bench
      .filter((option) =>
        (option.profile.attackTypes || []).some(
          (attackType) => getTypeMultiplier(attackType, [targetType]) > 1,
        ),
      )
      .sort((a, b) => b.score - a.score)[0];
    if (!pick) continue;

    suggestions.push({
      priority: 90,
      text: `No super-effective hit on ${targetType}: ${pick.name} covers it.`,
    });
  }

  return suggestions
    .sort((a, b) => b.priority - a.priority || a.text.localeCompare(b.text))
    .map((entry) => entry.text)
    .filter((text, index, all) => all.indexOf(text) === index)
    .slice(0, 5);
}

// Best fielded option from each pool line that isn't on the team.
function collectBenchOptions(lines, selectedKeys) {
  const bench = [];

  for (const line of lines || []) {
    const options = [
      line.best,
      line.bestNonMega,
      ...(line.choiceOptions || []),
    ].filter(Boolean);
    if (options.some((choice) => selectedKeys.has(getChoiceKey(choice)))) {
      continue;
    }

    const choice = line.best || line.bestNonMega;
    if (!choice?.legalityProfile) continue;

    bench.push({
      name: choice.legalityProfile.currentName || choice.name,
      profile: choice.legalityProfile,
      score: choice.legalityScore || 0,
    });
  }

  return bench;
}

function getChoiceKey(choice) {
  return `${choice.inputPokemonId || choice.inputName}:${choice.pokemonId}`;
}

function resistsOrImmune(defenseTypes, attackType) {
  const multiplier = getTypeMultiplier(attackType, defenseTypes || []);
  return multiplier === 0 || (multiplier > 0 && multiplier < 1);
}

function isDamagingMove(move) {
  // Fixed-damage moves (Seismic Toss, Night Shade, ...) have base power 0 but
  // deal real damage (damageModel.fixedMoveDamage), so they count as attacks.
  // Their offense is typeless, though — sites that reason about a move's TYPE
  // (attack-type summaries, coverage-type sets, gem assignment) must skip them
  // via isFixedDamageMove.
  return (
    move.category !== "Status" &&
    (getMovePower(move) > 0 || isFixedDamageMove(move.id))
  );
}

// Snore only deals damage while the user is asleep, so it's a dead move unless
// its own SET can put the user to sleep (Rest is the only reliable self-sleep
// move). Callers pass the relevant context: the recommender passes the set
// being built — Rest merely existing in the legal pool doesn't make Snore
// usable in a set that didn't take Rest.
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
    // Fixed-damage moves are effectively typeless offense (their type only
    // decides immunities) — they don't make the member "a Fighting attacker",
    // can't be super effective, and must not satisfy bias-counter checks.
    if (isFixedDamageMove(move.id)) continue;
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
    // Utility role kinds + hit rate, so utility scoring can value real
    // infrastructure (recovery/hazards/speed control) above chip status.
    roles: move.roles || [],
    accuracy: typeof move.accuracy === "number" ? move.accuracy : 100,
  };
}

function formatRecommendedMove(move, member, attackerStats) {
  return {
    ...formatProfileMove(move, member, attackerStats),
    availableSources: move.availableSources || [],
    category: move.category,
    sourceLabel: formatBestSource(move),
    sourceTitle: formatBestSourceTitle(move),
    superEffectiveTargetCount: isFixedDamageMove(move.id)
      ? 0 // fixed damage is never super effective
      : countSuperEffectiveTargets(move.type),
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
// Damage estimates are recomputed for every build variant of every candidate of
// every line (the same move × member × stats many times over) — the hot spot of
// multi-build line resolution. Memoized on everything the estimate depends on;
// bounded so a long session can't leak.
//
// Key-completeness audit: `member.id` is the FORM-specific id (megas and
// regional forms have distinct ids), ability and held item are explicit, and
// attacker stats enter as atk/spa/level — level cap and stat spreads reach the
// estimate only through those three numbers, so they're covered. The game data
// itself (base stats, move meta) is immutable for a process lifetime — a data
// update ships as a new deploy, and the manifest's data signature already
// versions the optimizer's persisted result cache — so the in-process memo
// needs no data signature. If damage ever becomes field-aware (boss fields,
// weather, terrain), the active field MUST join this key; a field that scales
// damage without entering the key would silently poison every estimate.
const damageMemo = new Map();
const DAMAGE_MEMO_LIMIT = 200_000;

function getEstimatedDamage(move, member, attackerStats) {
  const key = `${move.id}|${member.id}|${member.ability || ""}|${member.heldItem || ""}|${attackerStats?.atk ?? ""}|${attackerStats?.spa ?? ""}|${attackerStats?.level ?? ""}`;
  const cached = damageMemo.get(key);
  if (cached !== undefined) return cached;
  const value = computeEstimatedDamage(move, member, attackerStats);
  if (damageMemo.size >= DAMAGE_MEMO_LIMIT) damageMemo.clear();
  damageMemo.set(key, value);
  return value;
}

function computeEstimatedDamage(move, member, attackerStats) {
  // The type the move actually deals damage as under the set's ability
  // (Pixilate Hyper Voice is Fairy). Feeds STAB, effectiveness, and the item
  // layer — a type Gem boosts the CONVERTED move, matching the games.
  const effectiveType = getAbilityEffectiveMoveType(member.ability, move);
  const perHit = estimateMoveDamage({
    // Fixed-damage moves (Seismic Toss, Super Fang, ...) are resolved by id
    // inside the model at their REAL in-game damage for the attacker's level.
    moveId: move.id,
    // Scale base power by the move's effective-hit factor (multi-hit average,
    // recharge amortization, escalating-move weighting), so ranking and the
    // shown estimate reflect a turn's real output, not a single hit.
    basePower: move.basePower * getEffectiveHitMultiplier(move, member.ability),
    category: move.category,
    type: effectiveType,
    attackerTypes: member.types,
    attackerStats,
    // The held item the mon is recommended to carry boosts the damage it deals
    // (Life Orb, Choice Band, type items/Gems, ...). Applied to both the shown
    // estimate and the move ranking, so they stay consistent.
    itemMultiplier: getItemDamageMultiplier(member.heldItem, {
      type: effectiveType,
      category: move.category,
      pokemonId: member.id,
    }),
    // Move-property-conditional ability boosts (Huge Power, Technician, Sheer
    // Force, ...): computed from the RAW move so Technician's ≤60 BP gate sees
    // per-hit power, not the effective-hit-scaled figure above.
    abilityMultiplier: getAbilityDamageMultiplier(member.ability, move),
    ability: member.ability,
  });
  // Expected damage weights a hit by how often it lands, so an inaccurate nuke
  // (Focus Blast: 120 BP @ 70%) ranks below a reliable lower-power move (e.g. a
  // 90 BP @ 100% move: 84 vs 90 expected). Applied after the per-hit estimate so
  // it also scales fixed-damage/OHKO moves (Fissure @ 30%).
  return Math.round(perHit * getAccuracyFactor(move));
}

// A move's hit rate as a 0–1 factor. Never-miss and perfect-accuracy moves
// (normalized to 100 in the meta) and any move without numeric accuracy return 1.
function getAccuracyFactor(move) {
  const accuracy = move.accuracy;
  if (!accuracy || accuracy >= 100) return 1;
  return accuracy / 100;
}

function getMovePower(move) {
  // Fixed-damage moves have no base power; their real damage lives in the
  // estimatedDamage field (damageModel.fixedMoveDamage), not here.
  return move.basePower || 0;
}

// Escalating multi-turn moves whose effective power isn't a simple multi-hit or
// recharge. Rollout/Ice Ball double their power each consecutive turn (up to 5)
// but rarely complete the sequence, so we weight each turn at half the previous:
// with power doubling and weight halving, every turn contributes its base power,
// so the weighted-average power is 5·BP / (1 + 1/2 + 1/4 + 1/8 + 1/16) ≈ 2.58·BP.
const ESCALATING_HIT_MULTIPLIER = {
  rollout: 2.58,
  iceball: 2.58,
};

// Semi-invulnerable charge moves, split by punch-through (user ruling):
//   - No punch-through → full power. Phantom Force / Shadow Force vanish
//     completely (no move hits through), and Sky Drop carries the target
//     along, stealing its turn — the charge turn is genuinely offset.
//   - Leaky dodge → 2/3. Fly/Bounce are hit through by Gust/Twister at 2x
//     power and by Thunder outright; Dig by Earthquake/Magnitude at 2x;
//     Dive by Surf/Whirlpool at 2x — and the telegraphed lock-in gifts the
//     opponent a free switch/setup turn unless they were attacking anyway.
//     Valuing the dodge turn at HALF a turn under the same double-weight-
//     the-earlier-turn rule as recharge/exposed-charge: (2·½ + 1·1)/3 = 2/3.
const UNTARGETABLE_CHARGE = new Set(["phantomforce", "shadowforce", "skydrop"]);
const LEAKY_DODGE_CHARGE = new Set(["fly", "bounce", "dig", "dive"]);

// Telegraph-then-fail-if-disrupted moves (user report: "double-check Focus
// Punch — I think it's a two-stage move"). The dex encodes their mechanic as
// a custom condition, NOT flags.charge, so the exposed-charge amortization
// missed them and both were priced as clean 150 BP hits — the strongest
// moves of their types. Focus Punch (priority -3) fails outright if the user
// takes damage before it resolves; Shell Trap fails unless hit by a physical
// move first. The payoff is exposed to disruption exactly like Solar Beam's
// charge turn, so they take the same 1/3 rule. Beak Blast shares the dex
// shape (condition, -3) but its attack NEVER fails — the condition is the
// contact burn — so it keeps full power; Counter/Mirror Coat are BP 0 and
// never enter this model.
const FAILS_IF_DISRUPTED = new Set(["focuspunch", "shelltrap"]);

// How many "hits' worth" of base power a move lands per commitment, used to scale
// the damage estimate so multi-hit and multi-turn moves are ranked by real output:
//   - multi-hit: a fixed count (Double Kick → 2) or the EXPECTED count of its
//     [min,max] range — 2–5-hit moves roll 35%/35%/15%/15% for 2/3/4/5 hits
//     (Gen 5+), so Fury Swipes [2,5] → 3.1, not the naive midpoint 3.5;
//   - recharge: hit, then a lost turn. Double-weighting the earlier (hit) turn
//     gives (2·1 + 1·0)/3 = 2/3 of a single hit (Hyper Beam);
//   - exposed charge: a lost turn, then hit. Same double-weight-the-earlier-turn
//     rule, but now the dead turn is first: (2·0 + 1·1)/3 = 1/3 (Solar Beam);
//   - leaky-dodge charge: the dodge turn is worth HALF a turn (punch-through
//     at 2x, telegraphed lock-in): (2·½ + 1·1)/3 = 2/3 (Fly/Bounce/Dig/Dive);
//   - fails-if-disrupted (Focus Punch/Shell Trap): exposed like Solar Beam's
//     charge turn → 1/3;
//   - escalating: a curated weighting (Rollout/Ice Ball).
// Single-hit moves — and no-punch-through charge moves (Phantom Force/Shadow
// Force vanish outright; Sky Drop steals the target's turn) — keep full power.
function getEffectiveHitMultiplier(move, ability = null) {
  const escalating = ESCALATING_HIT_MULTIPLIER[move.id];
  if (escalating) return escalating;

  const multihit = move.multihit;
  if (typeof multihit === "number") return multihit;
  if (Array.isArray(multihit) && multihit.length === 2) {
    // Skill Link always lands the maximum count — Icicle Spear at a flat 5
    // hits is Cloyster's entire identity.
    if (toId(ability) === "skilllink") return multihit[1];
    // The standard 2–5 roll is 35/35/15/15 → E[hits] = 3.1; the midpoint 3.5
    // overrated every Pin Missile-class move by ~13%. Other ranges (none in
    // Gen 7 data today) fall back to the midpoint.
    if (multihit[0] === 2 && multihit[1] === 5) return 3.1;
    return (multihit[0] + multihit[1]) / 2;
  }

  if (move.recharge) return 2 / 3;
  if (move.charge) {
    if (UNTARGETABLE_CHARGE.has(move.id)) return 1;
    if (LEAKY_DODGE_CHARGE.has(move.id)) return 2 / 3;
    return 1 / 3; // exposed charge (Solar Beam, Sky Attack, ...)
  }
  if (FAILS_IF_DISRUPTED.has(move.id)) return 1 / 3;

  return 1;
}

// Builds the recommended 4-move set for the mon as currently fielded. The order
// of operations encodes the agreed heuristic:
//   1. Canonical moves — the mon's top-4 by raw Smogon usage, ignoring
//      progression — are locked in absolutely whenever they're legally available
//      right now. A locked canonical move is skipped, not substituted; a weaker
//      same-type stand-in only enters later, on damage.
//   2. Guarantee the single hardest-hitting available attack.
//   3. Guarantee one utility move — but a damaging move that ALSO has utility (a
//      burn/flinch attack) satisfies this, so a pure attacker isn't handed a
//      junk status move; utility is ranked by usage.
//   4. Fill the rest by damage, skipping attacking types already covered (a
//      second same-type attack adds nothing); fall back to more utility, then to
//      a duplicate-type attack only as a last resort.
//   5. Slots STILL empty with legal moves remaining (user ruling, from a
//      0-badge Liepard with a blank fourth slot): fill by the stitched
//      competitive priority order — "descending usage within its canonical
//      tier (fallback to all tiers in descending order, the usual way)".
//      That order lives in moveRank (set-index array order), which also sees
//      cross-tier entries whose usage % was nulled in the stitch — Liepard's
//      AG Assist. Moves with no competitive appearance anywhere still never
//      fill a slot; an empty slot stays honest.
// With no usage data (obscure NFEs) step 1 is empty and the static utility-
// quality table stands in for usage ranking, so the mon still gets a sensible
// damage-led set. There is deliberately no "must have an attack" guarantee: a mon
// whose pros run four status moves keeps four status moves.
function recommendCurrentMoves(
  member,
  moves,
  attackerStats,
  moveUsage = new Map(),
  opponentTypeBias = {},
  movePreference = "default",
  moveRank = new Map(),
) {
  const decorated = moves.map((move) =>
    decorateMove(move, member, attackerStats, moveUsage, opponentTypeBias),
  );
  const byId = new Map(decorated.map((move) => [move.id, move]));
  const selected = [];
  // Set-conditional usability: Snore only deals damage if THIS SET can put
  // its user to sleep, so the sleep context is the set being built — not the
  // legal pool (Dedenne has Rest in its pool, but a Sub/Nuzzle/Volt Switch
  // set has no way to sleep, so recommending Snore beside them is a dead
  // slot). Evaluated live as the set grows: once Rest is selected, Snore
  // becomes a real attack.
  const usableInSet = (move) => isUsableDamagingMove(move, selected);
  const usableDamaging = () =>
    decorated.filter((move) => usableInSet(move));
  const usableUtility = decorated.filter(
    (move) => move.utility && isSelectableMove(move, selected),
  );

  const coveredTypes = new Set();
  const isHiddenPower = (id) => String(id).startsWith("hiddenpower");
  const add = (move) => {
    if (!move || selected.length >= 4) return false;
    if (selected.some((entry) => entry.id === move.id)) return false;
    // A mon has ONE Hidden Power — the typed variants are alternatives, not
    // stackable coverage.
    if (
      isHiddenPower(move.id) &&
      selected.some((entry) => isHiddenPower(entry.id))
    ) {
      return false;
    }
    selected.push(move);
    // Fixed damage is typeless offense — it never claims a coverage type.
    if (usableInSet(move) && !isFixedDamageMove(move.id)) {
      coveredTypes.add(move.type);
    }
    return true;
  };

  if (movePreference === "coverage") {
    // Coverage build: best STAB nuke first, then greedily add fresh attacking
    // types by damage (the shared fill loop below keeps extending coverage).
    // A build the team optimizer can pick when it needs THIS mon's off-type
    // answers rather than its canonical competitive set.
    add(
      usableDamaging()
        .filter(
          (move) =>
            member.types.includes(move.type) && !isFixedDamageMove(move.id),
        )
        .sort(compareByDamage)[0],
    );
  } else if (movePreference === "utility") {
    // Utility build: the strongest role moves (recovery/hazards/speed control
    // rank above chip status via utilityWeight), plus the guaranteed attack
    // from the shared steps so it can't go fully passive.
    const rankedUtility = usableUtility
      .filter((move) => move.usage > 0 || move.utilityWeight > 0)
      .sort(compareUtilityByUsage);
    for (const move of rankedUtility.slice(0, 3)) add(move);
  } else {
    // 1. Canonical (top-4 by usage), in usage order, each kept if available now.
    const canonicalIds = [...moveUsage.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([id]) => id);
    for (const id of canonicalIds) {
      const move = byId.get(id);
      if (move && isSelectableMove(move, selected)) add(move);
    }
  }

  // 2. Guarantee at least one attack — but only if none was picked yet. A mon
  // that already has a damaging move (even a weak one like Rapid Spin, kept for
  // its utility) is left as-is; we don't shove its hardest hitter on top.
  if (
    selected.length < 4 &&
    !selected.some((move) => usableInSet(move))
  ) {
    add(usableDamaging().sort(compareByDamage)[0]);
  }

  // 3. One utility move, if none is present yet (a damage+utility move counts).
  if (selected.length < 4 && !selected.some((move) => move.utility)) {
    add(bestUtility(usableUtility, selected));
  }

  // 4. Fill by damage with type diversity, then bonus utility, then any attack.
  while (selected.length < 4) {
    const freshType = usableDamaging()
      .filter(
        (move) =>
          !coveredTypes.has(move.type) &&
          !isFixedDamageMove(move.id) && // typeless — can't add a fresh type
          !isSelected(move, selected),
      )
      .sort(compareByDamage)[0];
    if (add(freshType)) continue;
    if (add(bestUtility(usableUtility, selected))) continue;
    const anyAttack = usableDamaging()
      .filter((move) => !isSelected(move, selected))
      .sort(compareByDamage)[0];
    if (add(anyAttack)) continue;
    // Step 5: the damage-led fill is dry — take the best-ranked remaining
    // move on the stitched competitive ladder (canonical tier first, then
    // the fallback tiers in order). Only moves that appear SOMEWHERE in the
    // mon's competitive record qualify; unseen filler still never seats.
    const byCompetitiveRank = decorated
      .filter(
        (move) =>
          moveRank.has(move.id) &&
          !isSelected(move, selected) &&
          isSelectableMove(move, selected),
      )
      .sort((a, b) => moveRank.get(a.id) - moveRank.get(b.id))[0];
    if (add(byCompetitiveRank)) continue;
    break;
  }

  return selected.slice(0, 4);
}

function isSelected(move, selected) {
  return selected.some((entry) => entry.id === move.id);
}

// A move is selectable if it's a usable damaging move, or any non-damaging
// (status/utility) move — the sleep-gating only restricts attacks like Snore
// that need the user asleep, judged against the SET being built. A mon's
// canonical top-4 is otherwise deliberately NOT second-guessed: if the
// meaningful tier's real sets run a move, the recommendation may too (a
// canonical Rest earlier in usage order re-enables a canonical Snore).
function isSelectableMove(move, sleepContext) {
  return isDamagingMove(move) ? isUsableDamagingMove(move, sleepContext) : true;
}

// Highest-usage utility move not already chosen. Falls back to the static
// utility-quality table when there's no usage data, and never returns a move
// that is neither used nor notable, so a pure attacker isn't handed filler.
function bestUtility(utilityMoves, selected) {
  return utilityMoves
    .filter((move) => !isSelected(move, selected))
    .filter((move) => move.usage > 0 || move.utilityWeight > 0)
    .sort(compareUtilityByUsage)[0];
}

function decorateMove(
  move,
  member,
  attackerStats,
  moveUsage = new Map(),
  opponentTypeBias = {},
) {
  // Ability type conversion (-ate abilities, Liquid Voice, Normalize): the
  // decorated move carries the type it actually deals damage as, so every
  // downstream consumer — coverage vector, super-effective counts, opponent
  // bias, attack-type grouping, gem recommendations, display — sees what the
  // battle would (Aerilate Return IS a Flying move). The pre-conversion type
  // is preserved as rawType, which keeps the damage-model helpers idempotent
  // when a decorated move is fed back through them.
  const effectiveType = getAbilityEffectiveMoveType(member.ability, move);
  const typed =
    effectiveType === move.type
      ? move
      : { ...move, type: effectiveType, rawType: move.type };
  const estimatedDamage = getEstimatedDamage(typed, member, attackerStats);
  return {
    ...typed,
    basePower: getMovePower(typed),
    adjustedPower: getAdjustedPower(typed, member),
    estimatedDamage,
    // The damage used purely to *rank* attacks while filling slots. When the
    // opponent type-bias is set, a move that hits a biased type super-effectively
    // is scored with a gentle boost (the accuracy-stage curve: bias 1 = 1.33×,
    // 3 = 2×, 6 = 3×), so anti-bias coverage is preferred. This never leaves the
    // ranker — the displayed "X dmg" stays the unboosted estimatedDamage.
    rankingDamage: biasAdjustedDamage(
      typed,
      member,
      attackerStats,
      estimatedDamage,
      opponentTypeBias,
    ),
    sourcePriority: getBestSourcePriority(typed),
    superEffectiveTargetCount: isFixedDamageMove(typed.id)
      ? 0 // fixed damage is never super effective
      : countSuperEffectiveTargets(effectiveType),
    utilityWeight: UTILITY_MOVE_WEIGHTS[typed.id] || 0,
    usage: moveUsage.get(typed.id) || 0,
  };
}

// The bias multiplier for a move that hits any biased opponent type super-
// effectively; 1 otherwise. Uses Pokémon's accuracy/evasion stage curve
// ((3 + level) / 3) rather than the steeper Atk/SpA one, so the nudge stays
// gentle: bias 1 = 1.33×, 3 = 2×, 6 = 3×. The strongest applicable bias wins —
// a move answering a level-6 threat isn't diluted by also chipping a level-1 one.
function biasMoveMultiplier(move, opponentTypeBias = {}) {
  let level = 0;
  for (const [type, rawLevel] of Object.entries(opponentTypeBias || {})) {
    const clamped = Math.max(0, Math.min(MAX_OPPONENT_TYPE_BIAS, rawLevel || 0));
    if (clamped <= level) continue;
    if (getTypeMultiplier(move.type, [type]) > 1) level = clamped;
  }
  return level ? (3 + level) / 3 : 1;
}

// Re-scores a move as though the attacker's offensive stat were boosted by the
// bias level's worth of stages, by recomputing damage with the scaled stat.
function biasAdjustedDamage(move, member, attackerStats, estimatedDamage, opponentTypeBias) {
  const multiplier = biasMoveMultiplier(move, opponentTypeBias);
  if (multiplier === 1 || !attackerStats) return estimatedDamage;
  return getEstimatedDamage(move, member, {
    ...attackerStats,
    atk: attackerStats.atk * multiplier,
    spa: attackerStats.spa * multiplier,
  });
}

// Attack ranking used while filling damaging slots. Ranks by rankingDamage —
// estimated damage, already folding in STAB and the attacker's level/nature/EVs,
// plus any opponent-bias boost. It deliberately does NOT consider raw type-
// effectiveness against a hypothetical neutral target; the bias is the only way
// matchup enters the ranking, and only for types you've explicitly biased.
function compareByDamage(a, b) {
  return (
    b.rankingDamage - a.rankingDamage ||
    (b.priority || 0) - (a.priority || 0) ||
    a.sourcePriority - b.sourcePriority ||
    a.name.localeCompare(b.name)
  );
}

function compareUtilityByUsage(a, b) {
  return (
    b.usage - a.usage ||
    b.utilityWeight - a.utilityWeight ||
    a.sourcePriority - b.sourcePriority ||
    a.name.localeCompare(b.name)
  );
}

// Card/export ordering: canonical moves (in the mon's top-4 usage) first, in
// descending-usage order (their rank), then every other move by damage.
function compareDisplayOrder(a, b, canonicalRankById) {
  const rankA = canonicalRankById.has(a.id) ? canonicalRankById.get(a.id) : Infinity;
  const rankB = canonicalRankById.has(b.id) ? canonicalRankById.get(b.id) : Infinity;
  if (rankA !== rankB) return rankA - rankB;
  if (rankA !== Infinity) return 0; // both canonical: already in usage-rank order
  return compareProfileMove(a, b); // both non-canonical: by damage
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

function formatBestSourceTitle(move) {
  const source = [...(move.availableSources || [])].sort(
    (a, b) => getSourcePriority(a) - getSourcePriority(b),
  )[0];

  if (!source) return "";
  return source.sourceTitle || source.detail || source.label || "";
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


