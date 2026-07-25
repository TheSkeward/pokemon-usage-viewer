/**
 * @fileoverview Which scraped real team (team-index.js) the player could field
 * RIGHT NOW: every member must be covered by a distinct pool line, every
 * listed move must be obtainable under the progression + breeding context
 * (the same egg-move availability the analysis panel's own sets use), and
 * every held item must be covered by tracked inventory. Display-only —
 * nothing here feeds scoring.
 */
import { GEN7_PROGRESSION_SPECIES } from '../generated/gen7ProgressionSpecies.generated.js';
import { getCurrentRebornSpeciesForChoice } from '../reborn/current-species.js';
import {
  applyBreedingContextToProgression,
  canHatchLine,
  familyForms,
} from '../reborn/breeding.js';
import {
  getAvailableRebornMoves,
  loadRebornLegalMoveData,
} from '../reborn/legal-moves.js';
import { applySketchContextToProgression } from '../reborn/sketch.js';
import { toId } from '../utils/ids.js';

/**
 * The forms one pool line can field: for each of its choices, the input
 * form, the current best-reachable form, and every form on the evolution
 * path between them — delaying evolution is always allowed, devolving is
 * not. EXCEPT under daycare reachability (result-cache changelog v21,
 * teamOptimizer line resolution): with the daycare unlocked, a hatchable
 * line fields ANY family form from any input — breed an egg, raise the
 * hatchling — so the set expands to every form reachable from the family
 * root at the cap under the evolution-access rules, devolved forms and
 * sibling branches included.
 * @param {Object} line
 * @param {Object} progression
 * @return {Set<string>} Species ids.
 */
export function getLineFieldableIds(line, progression = {}) {
  const ids = new Set();
  const hatchExpanded = new Set();
  const choices = [
    line?.best,
    line?.bestNonMega,
    ...(line?.choiceOptions || []),
  ].filter(Boolean);

  for (const choice of choices) {
    const inputId = toId(choice.inputPokemonId || choice.pokemonId);
    if (!inputId) continue;
    const currentId = toId(
      getCurrentRebornSpeciesForChoice(choice, progression)?.id || inputId,
    );
    for (const id of evolutionPathIds(inputId, currentId)) ids.add(id);

    if (
      !progression?.daycareUnlocked ||
      hatchExpanded.has(inputId) ||
      !canHatchLine(inputId)
    ) {
      continue;
    }
    hatchExpanded.add(inputId);
    // A hatchling starts at the family root, so "reachable family form" is
    // exactly what getCurrentRebornSpeciesForChoice answers with the root as
    // input and each form as the representative: it walks the same evolution-
    // access rules and returns the deepest reachable form on that branch —
    // the root→current path is then fieldable by delaying, branch by branch.
    const forms = familyForms(inputId);
    const rootId = forms[0]?.id;
    for (const form of forms) {
      if (!rootId || form.isMega) continue;
      const current = getCurrentRebornSpeciesForChoice(
        { inputPokemonId: rootId, pokemonId: form.id },
        progression,
      );
      for (const id of evolutionPathIds(rootId, toId(current?.id || rootId))) {
        ids.add(id);
      }
    }
  }
  return ids;
}

// Input, current, and everything between, walking the prevo chain back from
// current and stopping AT the input — nothing below it (a devolution) leaks
// in. If current isn't actually an evolution of input (unknown data), only
// the exact forms themselves are safe claims.
function evolutionPathIds(inputId, currentId) {
  const path = [];
  const seen = new Set();
  let cursor = GEN7_PROGRESSION_SPECIES[currentId];

  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    path.push(cursor.id);
    if (cursor.id === inputId) return path;
    cursor = GEN7_PROGRESSION_SPECIES[cursor.prevoId];
  }
  return [inputId, currentId];
}

/**
 * One pool line covers at most ONE team member, so seating is a bipartite
 * matching. Pools are small, so an augmenting-path pass can find a complete
 * assignment without letting one flexible member hide a valid team.
 * @param {Array<Array<number>>} candidateLinesByMember Per member, the line
 *     indexes that can field it.
 * @return {?Array<number>} The chosen line index per member, or null when
 *     someone is left unseated.
 */
export function assignMembersToLines(candidateLinesByMember) {
  const assigned = assignAvailableMembersToLines(candidateLinesByMember);
  return assigned.every((lineIndex) => lineIndex !== null) ? assigned : null;
}

/**
 * Maximum matching when only part of a team can be seated. The
 * augmenting-path step can move an already-seated member to another valid
 * line when that opens a seat for somebody else, which keeps the
 * closest-team count exact while retaining one-line-per-member semantics.
 * @param {Array<Array<number>>} candidateLinesByMember
 * @return {Array<?number>} The chosen line per member; null means unseated.
 */
export function assignAvailableMembersToLines(candidateLinesByMember) {
  const order = candidateLinesByMember
    .map((candidates, member) => ({ member, candidates }))
    .sort(
      (a, b) =>
        a.candidates.length - b.candidates.length || a.member - b.member,
    );
  const memberByLine = new Map();
  const assigned = new Array(candidateLinesByMember.length).fill(null);

  for (const { member, candidates } of order) {
    seatMember(member, candidates, new Set(), new Set());
  }
  return assigned;

  function seatMember(member, candidates, visitedLines, visitedMembers) {
    if (visitedMembers.has(member)) return false;
    visitedMembers.add(member);

    for (const lineIndex of candidates) {
      if (visitedLines.has(lineIndex)) continue;
      visitedLines.add(lineIndex);
      const previousMember = memberByLine.get(lineIndex);
      if (
        previousMember === undefined ||
        seatMember(
          previousMember,
          candidateLinesByMember[previousMember],
          visitedLines,
          visitedMembers,
        )
      ) {
        memberByLine.set(lineIndex, member);
        assigned[member] = lineIndex;
        return true;
      }
    }
    return false;
  }
}

/**
 * Tracked-inventory gate, aggregated across the whole team: two Leftovers
 * members need ownedItems.leftovers >= 2. Members with no item pass.
 * @param {Array<Object>} members
 * @param {Object<string, number>} ownedItems
 * @return {boolean}
 */
export function teamItemsCovered(members, ownedItems = {}) {
  return teamItemShortages(members, ownedItems).length === 0;
}

/**
 * Item shortfalls with display names and counts for closest-team receipts.
 * @param {Array<Object>} members
 * @param {Object<string, number>} ownedItems
 * @return {Array<{itemId: string, item: string, needed: number,
 *     owned: number, missing: number}>}
 */
export function teamItemShortages(members, ownedItems = {}) {
  const needed = new Map();
  for (const member of members || []) {
    const itemId = toId(member.itemId || '');
    if (!itemId) continue;
    const entry = needed.get(itemId) || {
      itemId,
      item: member.item || member.itemId || itemId,
      needed: 0,
    };
    entry.needed += 1;
    needed.set(itemId, entry);
  }
  return [...needed.values()].flatMap((entry) => {
    const owned = Number(ownedItems[entry.itemId]) || 0;
    return owned >= entry.needed
      ? []
      : [{ ...entry, owned, missing: entry.needed - owned }];
  });
}

/**
 * Shared species between a real team and the recommended team.
 * @param {Object} team
 * @param {Set<string>} recommendedIds
 * @return {number}
 */
export function teamSimilarity(team, recommendedIds = new Set()) {
  return (team.members || []).filter((member) =>
    recommendedIds.has(toId(member.speciesId)),
  ).length;
}

/**
 * Ranking among fieldable teams: most-seen first (weight, then raw count),
 * then closest to the recommended team, then stable by key.
 * @param {Object} a
 * @param {Object} b
 * @param {Set<string>} recommendedIds
 * @return {number}
 */
export function compareRealTeams(a, b, recommendedIds = new Set()) {
  return (
    (b.weight || 0) - (a.weight || 0) ||
    (b.count || 0) - (a.count || 0) ||
    teamSimilarity(b, recommendedIds) - teamSimilarity(a, recommendedIds) ||
    String(a.key || '').localeCompare(String(b.key || ''))
  );
}

/**
 * Finds the best-ranked team whose members, moves, and items the pool can
 * all field. When there is no exact result, returns the team with the
 * greatest share of members that
 * distinct pool lines can field (then greatest raw member count, then the
 * normal popularity/recommended-team ordering), plus a blocker receipt.
 * Teams over the six-Pokemon game limit are parser spill and are ignored.
 *
 * Move checks stay lazy: every plausible team gets the cheap species match,
 * but only exact candidates and the single displayed fallback load moves.
 * @return {Promise<?Object>}
 */
export async function findFieldableOrClosestRealTeam({
  teams,
  lines = [],
  progression = {},
  recommendedIds = new Set(),
  breedingContext = null,
  sketchContext = null,
}) {
  const candidates = [...(teams || [])].sort((a, b) =>
    compareRealTeams(a, b, recommendedIds),
  ).filter((team) => {
    const count = team.members?.length || 0;
    return count > 0 && count <= 6;
  });
  if (!candidates.length) return null;

  const fieldableByLine = (lines || []).map((line) =>
    getLineFieldableIds(line, progression),
  );
  const context = {
    fieldableByLine,
    ownedItems: progression.ownedItems || {},
    progression,
    breedingContext,
    sketchContext,
    availableMoveIdsCache: new Map(),
  };
  let closest = null;

  for (const team of candidates) {
    const speciesMatch = teamSpeciesMatch(team, fieldableByLine);
    if (isCloserSpeciesMatch(speciesMatch, closest)) {
      closest = speciesMatch;
    }
    if (
      speciesMatch.matchedCount === speciesMatch.memberCount &&
      teamItemsCovered(team.members, context.ownedItems) &&
      (await teamMovesAvailable(team, context))
    ) {
      return { kind: 'fieldable', team };
    }
  }

  if (!closest) return null;
  const members = await Promise.all(
    closest.team.members.map(async (member, index) => ({
      speciesAvailable: closest.lineIndexes[index] !== null,
      lineIndex: closest.lineIndexes[index],
      missingMoves:
        closest.lineIndexes[index] === null
          ? []
          : await unavailableMemberMoves(member, context),
    })),
  );
  return {
    kind: 'closest',
    team: closest.team,
    matchedCount: closest.matchedCount,
    memberCount: closest.memberCount,
    members,
    missingItems: teamItemShortages(
      closest.team.members,
      context.ownedItems,
    ),
  };
}

function teamSpeciesMatch(team, fieldableByLine) {
  const members = team.members || [];
  const candidateLines = members.map((member) => {
    const speciesId = toId(member.speciesId);
    const indexes = [];
    fieldableByLine.forEach((ids, index) => {
      if (ids.has(speciesId)) indexes.push(index);
    });
    return indexes;
  });
  const lineIndexes = assignAvailableMembersToLines(candidateLines);
  return {
    team,
    lineIndexes,
    matchedCount: lineIndexes.filter((index) => index !== null).length,
    memberCount: members.length,
  };
}

function isCloserSpeciesMatch(candidate, current) {
  if (!current) return true;
  const candidateShare = candidate.matchedCount * current.memberCount;
  const currentShare = current.matchedCount * candidate.memberCount;
  if (candidateShare !== currentShare) return candidateShare > currentShare;
  return candidate.matchedCount > current.matchedCount;
}

async function teamMovesAvailable(team, context) {
  for (const member of team.members || []) {
    if ((await unavailableMemberMoves(member, context)).length) return false;
  }
  return true;
}

async function unavailableMemberMoves(member, context) {
  const moveIds = member.moveIds || [];
  if (!moveIds.length) return [];

  const speciesId = toId(member.speciesId);
  if (!context.availableMoveIdsCache.has(speciesId)) {
    // Same memberProgression pattern as buildMemberLegalMoveEntry: the
    // breeding context supplies this species' poolable egg moves, so egg-
    // move-dependent real teams qualify when the pool can breed those moves.
    const memberProgression = applySketchContextToProgression(
      applyBreedingContextToProgression(
        context.progression,
        speciesId,
        context.breedingContext,
      ),
      speciesId,
      context.sketchContext,
    );
    context.availableMoveIdsCache.set(
      speciesId,
      loadRebornLegalMoveData(speciesId)
        .then(
          (data) =>
            new Set(
              getAvailableRebornMoves(data, memberProgression).map(
                (move) => move.id,
              ),
            ),
        )
        .catch(() => new Set()),
    );
  }
  const available = await context.availableMoveIdsCache.get(speciesId);
  return moveIds.flatMap((id, index) =>
    available.has(id)
      ? []
      : [{ id, name: member.moves?.[index] || id, index }],
  );
}
