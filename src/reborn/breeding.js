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
        // already checked). `how` keeps the human-readable root acquisition
        // ("@35", "evo@32", "TM42") for the chain detail. Drives donor
        // ranking below.
        const costs = new Map();
        for (const move of getAvailableRebornMoves(legalMoveData, {
          ...progression,
          availableEggMoveIdsForPokemon: [],
        })) {
          costs.set(move.id, {
            ...acquisitionOf(move, species.id),
            hops: 0,
            path: [],
          });
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

  // Shortest-chain relaxation: among every legal donor, prefer the SHORTEST
  // chain first (user rule: fewest breeding hops is primary), and only then
  // the donor that gets the move earliest (lowest acquisition level) as the
  // tiebreak — instead of the old "first in pool order" pick. Multi-hop
  // chains inherit the upstream donor's level, root acquisition, and path.
  // Costs only ever improve, so this terminates.
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
            hops: donorCost.hops + 1,
            level: donorCost.level,
            how: donorCost.how,
            sourceTitle: donorCost.sourceTitle || "",
            // A direct donor is credited as the form that actually learns
            // the move (Vigoroth, not the fielded Slaking) when the source
            // names one; intermediate hops keep their species names.
            path:
              donorCost.hops === 0
                ? [donorCost.learner || donor.species.name]
                : [...donorCost.path, donor.species.name],
          };
          if (!best || compareBreedingCosts(candidate, best) < 0) best = candidate;
        }
        if (!best) continue;

        const current = target.costs.get(move.id);
        if (current && compareBreedingCosts(best, current) >= 0) continue;

        target.costs.set(move.id, best);
        const targetBreeding = byPokemonId.get(target.species.id);
        targetBreeding.moveIds.add(move.id);
        // The path spells every step; the parenthetical is how the ROOT
        // learner gets the move: "Azumarill → Granbull breeding chain (@1)".
        const detail = `${best.path.join(" → ")} breeding chain${
          best.how ? ` (${best.how})` : ""
        }`;
        targetBreeding.sources[move.id] = {
          label: "Egg",
          detail,
          donorName: best.path[best.path.length - 1],
          sourceTitle: formatBreedingSourceTitle({
            detail,
            moveName: move.name,
            rootSourceTitle: best.sourceTitle,
            targetName: target.species.name,
          }),
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

// The cheapest way a species gets a move without breeding, as
// {level, how}: level-up sources cost their level ("@35"); evolution moves
// cost the species' evolution level ("evo@32" — you must evolve to learn
// it); anything else (TM/tutor/Sketch) is teachable outright at level 0,
// labelled by its source ("TM42"). Delayed-evolution level-ups
// ("Level 38 (Slakoth)") still parse to their level.
export function acquisitionOf(move, speciesId) {
  let best = null;
  for (const source of move.availableSources || []) {
    const label = source.label || "";
    let candidate;
    // "Level 9 (Vigoroth, candy down)" / "Level 38 (Slakoth)": the
    // parenthetical names the form that ACTUALLY learns the move — the chain
    // must credit it, not the fielded species (user report: "Slaking
    // breeding chain (@9)" for a move only Vigoroth learns).
    const levelMatch = /^Level (\d+)(?:\s*\(([^,)]+)[,)])?/.exec(label);
    if (levelMatch) {
      const level = Number.parseInt(levelMatch[1], 10);
      candidate = {
        level,
        how: `@${level}`,
        learner: source.learnerName || levelMatch[2] || null,
        sourceTitle: source.sourceTitle || source.detail || source.label || "",
      };
    } else if (/relearner/i.test(label)) {
      // Relearning costs a Heart Scale + a trip — a real hassle the user
      // rates above ANY level-up (and it was masquerading as the cheapest
      // donor at level 0: "Slaking breeding chain (@1)"). Sorted after every
      // natural level so it's a last resort, never a tiebreak winner.
      candidate = {
        level: 200,
        how: "Relearner",
        learner: source.learnerName || null,
        sourceTitle: source.sourceTitle || source.detail || source.label || "",
      };
    } else if (/evolution/i.test(label)) {
      const evoLevel = GEN7_PROGRESSION_SPECIES[speciesId]?.evoLevel ?? null;
      candidate = {
        level: evoLevel ?? 0,
        how: evoLevel ? `evo@${evoLevel}` : "on evolution",
        learner: source.learnerName || null,
        sourceTitle: source.sourceTitle || source.detail || source.label || "",
      };
    } else {
      // "TM42: After Badge 01" → "TM42"; "Sketch" → "Sketch"; etc.
      candidate = {
        level: 0,
        how: label.split(":")[0].trim() || "taught",
        learner: source.learnerName || null,
        sourceTitle: source.sourceTitle || source.detail || source.label || "",
      };
    }
    if (!best || candidate.level < best.level) best = candidate;
  }
  return best || { level: 0, how: "" };
}

function formatBreedingSourceTitle({
  detail,
  moveName,
  rootSourceTitle,
  targetName,
}) {
  return [
    `${moveName}: egg move for ${targetName}.`,
    `Breeding route: ${detail}.`,
    rootSourceTitle ? `Root source: ${rootSourceTitle}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

// User rule: the shortest possible chain wins; earliest acquisition is only
// the tiebreak, then path names for determinism.
export function compareBreedingCosts(a, b) {
  if (a.hops !== b.hops) return a.hops - b.hops;
  if (a.level !== b.level) return a.level - b.level;
  return (a.path || []).join("→").localeCompare((b.path || []).join("→"));
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

// Egg-group compatibility is a property of the evolutionary FAMILY, not the
// fielded form: you daycare Mantine and hatch a Mantyke, so a fielded
// Mantyke's egg moves come through Mantine's Water 1 — but Mantyke's OWN
// groups are ["Undiscovered"], as are every baby form's and Nidorina/
// Nidoqueen's (audit: no fielded baby or Nido could ever receive an egg
// move). Union the breedable groups across the whole line, walking down to
// the root and up through every branch.
function getBreedableEggGroups(pokemonId) {
  let rootId = pokemonId;
  const seen = new Set();
  while (GEN7_PROGRESSION_SPECIES[rootId]?.prevoId && !seen.has(rootId)) {
    seen.add(rootId);
    rootId = GEN7_PROGRESSION_SPECIES[rootId].prevoId;
  }

  const groups = new Set();
  const walked = new Set();
  const visit = (id) => {
    const record = GEN7_PROGRESSION_SPECIES[id];
    if (!record || walked.has(id)) return;
    walked.add(id);
    for (const group of record.eggGroups || []) {
      if (!BLOCKED_EGG_GROUPS.has(group)) groups.add(group);
    }
    for (const evoId of record.evos || []) visit(evoId);
  };
  visit(rootId);
  return [...groups];
}

function emptyContext() {
  return {
    byPokemonId: {},
    ownedSpecies: [],
  };
}
