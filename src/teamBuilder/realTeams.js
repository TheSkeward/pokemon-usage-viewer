// Which scraped real team (teamIndex.js) the player could field RIGHT NOW:
// every member must be covered by a distinct pool line, every listed move
// must be obtainable under the progression (no breeding context in v1 —
// conservative, so egg-move-dependent teams simply don't qualify yet), and
// every held item must be covered by tracked inventory. Display-only —
// nothing here feeds scoring.
import { GEN7_PROGRESSION_SPECIES } from "../generated/gen7ProgressionSpecies.generated.js";
import { getCurrentRebornSpeciesForChoice } from "../reborn/currentSpecies.js";
import {
  getAvailableRebornMoves,
  loadRebornLegalMoveData,
} from "../reborn/legalMoves.js";
import { toId } from "../utils/ids.js";

// The forms one pool line can field: for each of its choices, the input form,
// the current best-reachable form, and every form on the evolution path
// between them — delaying evolution is always allowed, devolving is not, so
// a pre-evolution of the input never qualifies.
export function getLineFieldableIds(line, progression = {}) {
  const ids = new Set();
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

// One pool line covers at most ONE team member, so seating is a bipartite
// matching — but pools are small and candidate sets barely overlap, so a
// greedy pass (scarcest member first, taking its first free line) stands in
// for full augmenting-path matching, per the ratified design.
// candidateLinesByMember: per member, the line indexes that can field it.
// Returns the chosen line index per member, or null when someone is left
// unseated.
export function assignMembersToLines(candidateLinesByMember) {
  const order = candidateLinesByMember
    .map((candidates, member) => ({ member, candidates }))
    .sort((a, b) => a.candidates.length - b.candidates.length);
  const used = new Set();
  const assigned = new Array(candidateLinesByMember.length).fill(null);

  for (const { member, candidates } of order) {
    const lineIndex = candidates.find((index) => !used.has(index));
    if (lineIndex === undefined) return null;
    used.add(lineIndex);
    assigned[member] = lineIndex;
  }
  return assigned;
}

// Tracked-inventory gate, aggregated across the whole team: two Leftovers
// members need ownedItems.leftovers >= 2. Members with no item pass.
export function teamItemsCovered(members, ownedItems = {}) {
  const needed = new Map();
  for (const member of members || []) {
    const itemId = toId(member.itemId || "");
    if (!itemId) continue;
    needed.set(itemId, (needed.get(itemId) || 0) + 1);
  }
  for (const [itemId, count] of needed) {
    if ((ownedItems[itemId] || 0) < count) return false;
  }
  return true;
}

// Shared species between a real team and the recommended team.
export function teamSimilarity(team, recommendedIds = new Set()) {
  return (team.members || []).filter((member) =>
    recommendedIds.has(toId(member.speciesId)),
  ).length;
}

// Ranking among fieldable teams: most-seen first (weight, then raw count),
// then closest to the recommended team, then stable by key.
export function compareRealTeams(a, b, recommendedIds = new Set()) {
  return (
    (b.weight || 0) - (a.weight || 0) ||
    (b.count || 0) - (a.count || 0) ||
    teamSimilarity(b, recommendedIds) - teamSimilarity(a, recommendedIds) ||
    String(a.key || "").localeCompare(String(b.key || ""))
  );
}

export async function findFieldableRealTeam({
  teams,
  lines = [],
  progression = {},
  recommendedIds = new Set(),
}) {
  const candidates = [...(teams || [])].sort((a, b) =>
    compareRealTeams(a, b, recommendedIds),
  );
  if (!candidates.length) return null;

  const fieldableByLine = (lines || []).map((line) =>
    getLineFieldableIds(line, progression),
  );
  const context = {
    fieldableByLine,
    ownedItems: progression.ownedItems || {},
    progression,
    availableMoveIdsCache: new Map(),
  };

  for (const team of candidates) {
    if (await isTeamFieldable(team, context)) return team;
  }
  return null;
}

async function isTeamFieldable(team, context) {
  const members = team.members || [];
  if (!members.length) return false;
  if (!teamItemsCovered(members, context.ownedItems)) return false;

  const candidateLines = members.map((member) => {
    const speciesId = toId(member.speciesId);
    const indexes = [];
    context.fieldableByLine.forEach((ids, index) => {
      if (ids.has(speciesId)) indexes.push(index);
    });
    return indexes;
  });
  if (!assignMembersToLines(candidateLines)) return false;

  for (const member of members) {
    if (!(await memberMovesAvailable(member, context))) return false;
  }
  return true;
}

async function memberMovesAvailable(member, context) {
  const moveIds = member.moveIds || [];
  if (!moveIds.length) return true;

  const speciesId = toId(member.speciesId);
  if (!context.availableMoveIdsCache.has(speciesId)) {
    context.availableMoveIdsCache.set(
      speciesId,
      loadRebornLegalMoveData(speciesId)
        .then(
          (data) =>
            new Set(
              getAvailableRebornMoves(data, context.progression).map(
                (move) => move.id,
              ),
            ),
        )
        .catch(() => new Set()),
    );
  }
  const available = await context.availableMoveIdsCache.get(speciesId);
  return moveIds.every((id) => available.has(id));
}
