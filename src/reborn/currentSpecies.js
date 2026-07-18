import { GEN7_PROGRESSION_SPECIES } from "../generated/gen7ProgressionSpecies.generated.js";
import { toId } from "../utils/ids.js";
import {
  getEvolutionRequirement,
  evolutionChainProof,
} from "./evolutionRequirements.js";

export function getCurrentRebornSpeciesForChoice(choice, progression = {}) {
  const inputId = toId(choice?.inputPokemonId || choice?.pokemonId);
  const representativeId = toId(choice?.pokemonId);

  if (!inputId) return null;

  const current = getBestLevelReachableSpecies({
    inputId,
    levelCap: normalizeLevelCap(progression.levelCap),
    representativeId,
    access: progression,
  });

  if (!current) return null;

  const proof = evolutionChainProof(current.id, progression, inputId);
  // "The representative lies AHEAD of the current form" — true only when the
  // current form is an ancestor of the representative (Frogadier → Greninja).
  // When the representative is a PRE-evolution of the current form (a Noivern
  // pick whose usage bundle is Noibat's), it is the pick's past, not its
  // future, and must never render as "Eventual".
  const representativeIsFuture =
    current.id !== representativeId &&
    Boolean(representativeId) &&
    getAncestorIds(representativeId).includes(current.id);
  return {
    id: current.id,
    name: current.name,
    differsFromRepresentative: current.id !== representativeId,
    representativeIsFuture,
    representativeId,
    representativeName: choice?.name || GEN7_PROGRESSION_SPECIES[representativeId]?.name || "",
    // K for having reached this form, with the per-step proof, plus any
    // evolutions that were NOT taken because their requirements are unknown —
    // surfaced so the recommendation can say "Raichu unavailable: Thunder Stone
    // availability unknown" instead of silently pretending.
    evolutionFriction: proof.friction,
    evolutionSteps: proof.steps,
    blockedEvolutions: current.blockedEvolutions || [],
  };
}

// A strict pre-evolution is a form the owned mon can never be again — this
// keeps a line's usage representative from being a baby the player already
// evolved past (an owned Mantine must not be presented as an Eviolite Mantyke
// because Mantyke owns the LC tier).
export function isStrictPreEvolutionOf(candidateId, inputId) {
  const candidate = toId(candidateId);
  const input = toId(inputId);
  if (!candidate || !input || candidate === input) return false;
  return getAncestorIds(input).includes(candidate);
}

export function getCurrentRebornSpecies(pokemonId, progression = {}) {
  const inputId = toId(pokemonId);
  if (!inputId) return null;

  const current = getBestLevelReachableSpecies({
    inputId,
    levelCap: normalizeLevelCap(progression.levelCap),
    representativeId: "",
    access: progression,
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

function getBestLevelReachableSpecies({ inputId, levelCap, representativeId, access = null }) {
  const input = GEN7_PROGRESSION_SPECIES[inputId];
  if (!input) return null;

  const { reachable, blocked } = collectReachableSpecies(input.id, levelCap, access);
  if (!reachable.length) return { ...input, blockedEvolutions: blocked };

  const representativeLine = representativeId
    ? new Set(getAncestorIds(representativeId))
    : null;
  const sameLineReachable = representativeLine
    ? reachable.filter((species) => representativeLine.has(species.id))
    : [];
  const candidates = sameLineReachable.length ? sameLineReachable : reachable;

  const best = candidates.sort(
    (a, b) => getDepth(b.id) - getDepth(a.id) || a.name.localeCompare(b.name),
  )[0];
  return { ...best, blockedEvolutions: blocked };
}

// Every form reachable from the input under the evolution-requirement rules
// (legal-with-friction), plus the evolutions that were NOT taken because their
// requirements are unknown — kept for surfacing, never silently dropped.
function collectReachableSpecies(inputId, levelCap, access = null) {
  const input = GEN7_PROGRESSION_SPECIES[inputId];
  if (!input) return { reachable: [], blocked: [] };

  const reachable = [];
  const blocked = [];
  const queue = [input];
  const seen = new Set();

  while (queue.length) {
    const current = queue.shift();
    if (!current || seen.has(current.id)) continue;
    seen.add(current.id);
    reachable.push(current);

    for (const evoId of current.evos || []) {
      const evo = GEN7_PROGRESSION_SPECIES[evoId];
      if (!evo || evo.isMega) continue;
      const requirement = getEvolutionRequirement(evo, access);
      if (requirement.status !== "legal") {
        blocked.push({ from: current.id, to: evo.id, reason: requirement.reason });
        continue;
      }
      if (
        requirement.levelRequired != null &&
        requirement.levelRequired > levelCap
      ) {
        continue; // level-gated, not blocked: it unlocks with the cap
      }
      queue.push(evo);
    }
  }

  return { reachable, blocked };
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
