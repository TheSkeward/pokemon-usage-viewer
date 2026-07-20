import { getCurrentRebornSpeciesForChoice } from "../reborn/currentSpecies.js";
import {
  getAvailableRebornMoves,
  loadRebornLegalMoveData,
} from "../reborn/legalMoves";
import { MAX_TRACKED_ITEM_COUNT } from "../reborn/progression";
import { GEN7_HELD_ITEMS_BY_ID } from "../generated/gen7HeldItems.generated.js";

/**
 * Builds the plain-text "here are my available Pokémon and items" list from
 * the resolved pool lines and the current progression. Each Pokémon is
 * reported as its current playable form with the moves that are currently
 * legal/available.
 * @param {{lines: Array<Object>, progression: Object}} state
 * @return {Promise<string>}
 */
export async function buildPoolAvailabilityText({ lines, progression }) {
  const resolvedLines = (lines || []).filter(
    (line) => line && !line.unresolved && (line.best || line.bestNonMega),
  );

  const entries = await Promise.all(
    resolvedLines.map((line) => describeLine(line, progression)),
  );

  const seenIds = new Set();
  const dedupedEntries = [];

  for (const entry of entries) {
    if (!entry) continue;
    if (seenIds.has(entry.id)) continue;
    seenIds.add(entry.id);
    dedupedEntries.push(entry);
  }

  // Sort by the Pokémon's current display name so the printed list reads
  // alphabetically — input order follows the pool/line order otherwise, which
  // looks scrambled once evolutions rename a line (e.g. Steenee under "Bounsweet").
  dedupedEntries.sort((a, b) => a.name.localeCompare(b.name));

  const monLines = dedupedEntries.map((entry) => {
    const moves = entry.moves.length ? entry.moves.join(", ") : "(none available yet)";
    return `${entry.name} - available move pool: ${moves}`;
  });

  const sections = ["Here are my available Pokémon.", ...monLines];

  const itemsLine = describeOwnedItems(progression.ownedItems);
  sections.push("", `Here are my available held items: ${itemsLine}`);

  return sections.join("\n");
}

async function describeLine(line, progression) {
  const choice = line.best || line.bestNonMega;
  if (!choice) return null;

  const species = getCurrentRebornSpeciesForChoice(choice, progression);
  const speciesId = species?.id || choice.pokemonId;
  const speciesName = species?.name || choice.name;

  let moves = [];

  try {
    const legalMoveData = await loadRebornLegalMoveData(speciesId);
    if (legalMoveData) {
      moves = getAvailableRebornMoves(legalMoveData, progression)
        .map((move) => move.name)
        .sort((a, b) => a.localeCompare(b));
    }
  } catch {
    moves = [];
  }

  return { id: speciesId, name: speciesName, moves };
}

function describeOwnedItems(ownedItems = {}) {
  const owned = Object.entries(ownedItems)
    .map(([id, count]) => ({
      name: GEN7_HELD_ITEMS_BY_ID[id]?.name || id,
      count,
    }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  if (!owned.length) return "(none tracked yet)";

  return owned
    .map((entry) => {
      if (entry.count <= 1) return entry.name;
      const quantity =
        entry.count >= MAX_TRACKED_ITEM_COUNT
          ? `${MAX_TRACKED_ITEM_COUNT}+`
          : `${entry.count}`;
      return `${entry.name} x${quantity}`;
    })
    .join(", ");
}
