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

        return {
          legalMoveData,
          moveIds: new Set(
            getAvailableRebornMoves(legalMoveData, {
              ...progression,
              availableEggMoveIdsForPokemon: [],
            }).map((move) => move.id),
          ),
          species,
        };
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

  let changed = true;
  while (changed) {
    changed = false;

    for (const target of entries) {
      for (const move of target.legalMoveData.moves || []) {
        if (!move.sources?.egg || target.moveIds.has(move.id)) continue;

        const donor = entries.find(
          (candidate) =>
            candidate.species.id !== target.species.id &&
            candidate.moveIds.has(move.id) &&
            canBreed(candidate.species.id, target.species.id),
        );

        if (!donor) continue;

        target.moveIds.add(move.id);
        const targetBreeding = byPokemonId.get(target.species.id);
        targetBreeding.moveIds.add(move.id);
        targetBreeding.sources[move.id] = {
          label: "Egg",
          detail: `${donor.species.name} breeding chain`,
          donorName: donor.species.name,
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
