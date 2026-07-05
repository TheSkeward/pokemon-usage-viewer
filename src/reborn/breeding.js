import { GEN7_PROGRESSION_SPECIES } from "../generated/gen7ProgressionSpecies.generated.js";
import { buildInputGroups } from "../teamBuilder/inputGroups";
import { getCurrentRebornSpecies } from "./currentSpecies.js";
import {
  getAvailableRebornMoves,
  loadRebornLegalMoveData,
} from "./legalMoves";

const BLOCKED_EGG_GROUPS = new Set(["Undiscovered", "Ditto"]);

export async function buildRebornBreedingContext({
  pokemonIndex = [],
  progression = {},
  query = "",
} = {}) {
  if (!progression.daycareUnlocked) return emptyContext();

  const ownedSpecies = getOwnedCurrentSpecies({ pokemonIndex, progression, query });
  if (!ownedSpecies.length) return emptyContext();

  const entries = (
    await Promise.all(
      ownedSpecies.map(async (species) => {
        const legalMoveData = await loadRebornLegalMoveData(species.id);
        if (!legalMoveData) return null;

        // Acquisition cost of each move the species can get WITHOUT breeding:
        // the lowest level any source demands (TM/tutor/etc. count as 0 — they
        // are teachable the moment they're unlocked, which availability has
        // already checked). Drives donor ranking below.
        const costs = new Map();
        for (const move of getAvailableRebornMoves(legalMoveData, {
          ...progression,
          availableEggMoveIdsForPokemon: [],
        })) {
          costs.set(move.id, { level: acquisitionLevel(move), hops: 0 });
        }

        return { legalMoveData, costs, species };
      }),
    )
  ).filter(Boolean);

  const byPokemonId = new Map(
    entries.map((entry) => [
      entry.species.id,
      {
        moveIds: new Set(),
        sources: {},
      },
    ]),
  );

  // Cheapest-chain relaxation: among every legal donor, prefer the one that
  // gets the move EARLIEST (lowest acquisition level), then the shortest
  // chain, then name for determinism — instead of the old "first in pool
  // order" pick. Multi-hop chains inherit the upstream donor's level and add
  // a hop. Costs only ever improve, so this terminates.
  let changed = true;
  while (changed) {
    changed = false;

    for (const target of entries) {
      for (const move of target.legalMoveData.moves || []) {
        if (!move.sources?.egg) continue;
        const intrinsic = target.costs.get(move.id);
        if (intrinsic && intrinsic.hops === 0) continue; // has it without breeding

        let best = null;
        for (const donor of entries) {
          if (donor.species.id === target.species.id) continue;
          const donorCost = donor.costs.get(move.id);
          if (!donorCost || !canBreed(donor.species.id, target.species.id)) {
            continue;
          }
          const candidate = {
            level: donorCost.level,
            hops: donorCost.hops + 1,
            donor,
          };
          if (!best || compareCosts(candidate, best) < 0) best = candidate;
        }
        if (!best) continue;

        const current = target.costs.get(move.id);
        if (current && compareCosts(best, current) >= 0) continue;

        target.costs.set(move.id, { level: best.level, hops: best.hops });
        const targetBreeding = byPokemonId.get(target.species.id);
        targetBreeding.moveIds.add(move.id);
        targetBreeding.sources[move.id] = {
          label: "Egg",
          detail: `${best.donor.species.name} breeding chain${
            best.level > 0 ? ` (@${best.level})` : ""
          }${best.hops > 1 ? `, ${best.hops}-step` : ""}`,
          donorName: best.donor.species.name,
        };
        changed = true;
      }
    }
  }

  return {
    byPokemonId: Object.fromEntries(
      [...byPokemonId.entries()].map(([pokemonId, entry]) => [
        pokemonId,
        {
          moveIds: [...entry.moveIds].sort(),
          sources: entry.sources,
        },
      ]),
    ),
    ownedSpecies,
  };
}

// Lowest level any available source demands; non-level sources (TM, tutor,
// relearner, Sketch) are teachable outright and count as 0. Delayed-evolution
// level-ups ("Level 38 (Slakoth)") still parse to their level.
function acquisitionLevel(move) {
  let min = Infinity;
  for (const source of move.availableSources || []) {
    const match = /^Level (\d+)/.exec(source.label || "");
    min = Math.min(min, match ? Number.parseInt(match[1], 10) : 0);
  }
  return Number.isFinite(min) ? min : 0;
}

function compareCosts(a, b) {
  if (a.level !== b.level) return a.level - b.level;
  if (a.hops !== b.hops) return a.hops - b.hops;
  const nameA = a.donor?.species?.name || "";
  const nameB = b.donor?.species?.name || "";
  return nameA.localeCompare(nameB);
}

export function applyBreedingContextToProgression(
  progression,
  pokemonId,
  breedingContext,
) {
  const breeding = breedingContext?.byPokemonId?.[pokemonId];
  if (!breeding?.moveIds?.length) {
    return {
      ...progression,
      availableEggMoveIdsForPokemon: [],
      availableEggMoveSourcesForPokemon: {},
    };
  }

  return {
    ...progression,
    availableEggMoveIdsForPokemon: breeding.moveIds,
    availableEggMoveSourcesForPokemon: breeding.sources || {},
  };
}

function getOwnedCurrentSpecies({ pokemonIndex, progression, query }) {
  const seen = new Set();
  const species = [];

  for (const group of buildInputGroups(query, pokemonIndex)) {
    if (group.unresolved || !group.input?.id) continue;

    const current = getCurrentRebornSpecies(group.input.id, progression);
    for (const candidate of [current, group.input]) {
      const id = candidate?.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      species.push({
        id,
        name: GEN7_PROGRESSION_SPECIES[id]?.name || candidate.name || id,
      });
    }
  }

  return species;
}

function canBreed(donorId, targetId) {
  const donorGroups = getBreedableEggGroups(donorId);
  const targetGroups = getBreedableEggGroups(targetId);

  return donorGroups.some((group) => targetGroups.includes(group));
}

function getBreedableEggGroups(pokemonId) {
  return (GEN7_PROGRESSION_SPECIES[pokemonId]?.eggGroups || []).filter(
    (group) => !BLOCKED_EGG_GROUPS.has(group),
  );
}

function emptyContext() {
  return {
    byPokemonId: {},
    ownedSpecies: [],
  };
}
