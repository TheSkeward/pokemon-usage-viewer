import { GEN7_PROGRESSION_SPECIES } from "../generated/gen7ProgressionSpecies.generated.js";
import { toId } from "../utils/ids.js";

export function getCurrentRebornSpeciesForChoice(choice, progression = {}) {
  const inputId = toId(choice?.inputPokemonId || choice?.pokemonId);
  const representativeId = toId(choice?.pokemonId);

  if (!inputId) return null;

  const current = getBestLevelReachableSpecies({
    inputId,
    levelCap: normalizeLevelCap(progression.levelCap),
    representativeId,
  });

  if (!current) return null;

  return {
    id: current.id,
    name: current.name,
    differsFromRepresentative: current.id !== representativeId,
    representativeId,
    representativeName: choice?.name || GEN7_PROGRESSION_SPECIES[representativeId]?.name || "",
  };
}

export function getCurrentRebornSpecies(pokemonId, progression = {}) {
  const inputId = toId(pokemonId);
  if (!inputId) return null;

  const current = getBestLevelReachableSpecies({
    inputId,
    levelCap: normalizeLevelCap(progression.levelCap),
    representativeId: "",
  });

  if (!current) return null;

  return {
    id: current.id,
    name: current.name,
    differsFromRepresentative: current.id !== inputId,
    representativeId: inputId,
    representativeName: GEN7_PROGRESSION_SPECIES[inputId]?.name || inputId,
  };
}

function getBestLevelReachableSpecies({ inputId, levelCap, representativeId }) {
  const input = GEN7_PROGRESSION_SPECIES[inputId];
  if (!input) return null;

  const reachable = collectLevelReachableSpecies(input.id, levelCap);
  if (!reachable.length) return input;

  const representativeLine = representativeId
    ? new Set(getAncestorIds(representativeId))
    : null;
  const sameLineReachable = representativeLine
    ? reachable.filter((species) => representativeLine.has(species.id))
    : [];
  const candidates = sameLineReachable.length ? sameLineReachable : reachable;

  return candidates.sort((a, b) => getDepth(b.id) - getDepth(a.id) || a.name.localeCompare(b.name))[0];
}

function collectLevelReachableSpecies(inputId, levelCap) {
  const input = GEN7_PROGRESSION_SPECIES[inputId];
  if (!input) return [];

  const reachable = [];
  const queue = [input];
  const seen = new Set();

  while (queue.length) {
    const current = queue.shift();
    if (!current || seen.has(current.id)) continue;
    seen.add(current.id);
    reachable.push(current);

    for (const evoId of current.evos || []) {
      const evo = GEN7_PROGRESSION_SPECIES[evoId];
      if (!isLevelEvolutionReachable(evo, levelCap)) continue;
      queue.push(evo);
    }
  }

  return reachable;
}

function isLevelEvolutionReachable(species, levelCap) {
  if (!species || species.isMega) return false;
  if (species.evoType && species.evoType !== "levelFriendship") return false;
  if (!Number.isFinite(species.evoLevel)) return species.evoType === "levelFriendship";
  return species.evoLevel <= levelCap;
}

function getAncestorIds(speciesId) {
  const ids = [];
  let current = GEN7_PROGRESSION_SPECIES[toId(speciesId)];
  const seen = new Set();

  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    ids.push(current.id);

    if (current.isMega && current.baseSpeciesId) {
      current = GEN7_PROGRESSION_SPECIES[current.baseSpeciesId];
    } else {
      current = GEN7_PROGRESSION_SPECIES[current.prevoId];
    }
  }

  return ids;
}

function getDepth(speciesId) {
  let depth = 0;
  let current = GEN7_PROGRESSION_SPECIES[toId(speciesId)];
  const seen = new Set();

  while (current?.prevoId && !seen.has(current.id)) {
    seen.add(current.id);
    depth += 1;
    current = GEN7_PROGRESSION_SPECIES[current.prevoId];
  }

  return depth;
}

function normalizeLevelCap(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 100;
  if (parsed < 1) return 1;
  if (parsed > 100) return 100;
  return parsed;
}
