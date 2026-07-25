import { getLineRepresentativeCandidates } from '../data';
import { GEN7_PROGRESSION_SPECIES } from '../generated/gen7ProgressionSpecies.generated.js';
import {
  canHatchLine,
} from '../reborn/breeding.js';
import {
  isStrictPreEvolutionOf,
} from '../reborn/current-species.js';
import { buildInputGroups } from './input-groups';

/**
 * Which family forms can this input actually become? Descendants and their
 * Megas always qualify. Strict pre-evolutions and sibling branches require the
 * daycare on a hatchable line, because hatching is the route back down/across.
 */
export function getReachableLineCandidates(
  group,
  pokemonIndex,
  progression = {},
) {
  const input = group?.input;
  if (group?.unresolved || !input) return [];

  const inputBaseId =
    GEN7_PROGRESSION_SPECIES[input.id]?.baseSpeciesId || input.id;
  const daycareReach =
    Boolean(progression?.daycareUnlocked) && canHatchLine(input.id);
  return getLineRepresentativeCandidates(input.id, pokemonIndex).filter(
    (candidate) => {
      if (daycareReach) return true;
      const candidateBaseId = candidate.isMega
        ? GEN7_PROGRESSION_SPECIES[candidate.id]?.baseSpeciesId || candidate.id
        : candidate.id;
      return (
        candidateBaseId === input.id ||
        isStrictPreEvolutionOf(input.id, candidateBaseId) ||
        (inputBaseId !== input.id &&
          (candidateBaseId === inputBaseId ||
            isStrictPreEvolutionOf(inputBaseId, candidateBaseId)))
      );
    },
  );
}

/**
 * A stable fallback identity for lines without a usage signal. Simple
 * pre-evolution/evolution duplicates share their reachable terminal form;
 * branching families retain their distinct terminal sets.
 */
export function getReachableLineFallbackKey(candidates = [], fallbackId = '') {
  const nonMega = candidates.filter((candidate) => !candidate.isMega);
  const rows = nonMega.length ? nonMega : candidates;
  const ids = new Set(rows.map((candidate) => candidate.id));
  const terminalIds = rows
    .filter((candidate) => {
      const evolutions = GEN7_PROGRESSION_SPECIES[candidate.id]?.evos || [];
      return !evolutions.some((id) => ids.has(id));
    })
    .map((candidate) => candidate.id);
  return [...new Set(terminalIds.length ? terminalIds : [...ids])]
    .sort()
    .join('|') || fallbackId;
}

/**
 * How many evolution steps separate a form from its family root (0 for a
 * basic form). Cycle-safe against malformed prevo data.
 * @param {string} pokemonId
 * @return {number}
 */
export function getEvolutionDepth(pokemonId) {
  let depth = 0;
  let cursor = GEN7_PROGRESSION_SPECIES[pokemonId];
  const seen = new Set();
  while (cursor?.prevoId && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    depth += 1;
    cursor = GEN7_PROGRESSION_SPECIES[cursor.prevoId];
  }
  return depth;
}

/**
 * Lightweight, unscored pool lines for real-team ownership matching. This is
 * deliberately built from the complete query, not the optimizer's bounded
 * working set: the 126-line cap controls score/search cost only.
 */
export function buildFieldablePoolLines({
  query = '',
  pokemonIndex = [],
  progression = {},
} = {}) {
  if (!query || !pokemonIndex?.length) return [];

  return buildInputGroups(query, pokemonIndex)
    .filter((group) => !group.unresolved)
    .map((group) => {
      const candidates = getReachableLineCandidates(
        group,
        pokemonIndex,
        progression,
      );
      const choices = (candidates.length ? candidates : [group.input]).map(
        (candidate) => ({
          inputPokemonId: group.input.id,
          inputName: group.input.name,
          pokemonId: candidate.id,
          name: candidate.name,
        }),
      );
      return {
        best: choices[0],
        bestNonMega: null,
        choiceOptions: choices.slice(1),
      };
    });
}
