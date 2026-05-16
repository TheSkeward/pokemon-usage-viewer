import { getLineRepresentativeCandidates } from "../data";
import { buildInputGroups } from "./inputGroups";
import {
  MIN_MEANINGFUL_USAGE_PERCENT,
  compareScoredCandidates,
  scoreCandidate,
} from "./candidateScoring";
import { resolveRepresentativeLightBundle } from "./representativeBundle";
import { choosePoolTeam } from "./teamSelection";

export async function optimizeTeamFromPool({
  availability,
  family,
  pokemonIndex,
  query,
  selection,
}) {
  const groups = buildInputGroups(query, pokemonIndex);
  const lines = (
    await Promise.all(
      groups.map((group) =>
        resolvePoolLine({
          availability,
          family,
          group,
          pokemonIndex,
          selection,
        }),
      ),
    )
  ).filter(Boolean);

  return choosePoolTeam(lines);
}

async function resolvePoolLine({
  availability,
  family,
  group,
  pokemonIndex,
  selection,
}) {
  if (group.unresolved || !group.entries.length) {
    return {
      unresolved: true,
      inputName: group.token,
      lineKey: `unresolved:${group.token}`,
      best: null,
      bestNonMega: null,
      candidates: [],
    };
  }

  const input = group.input;
  const candidates = getLineRepresentativeCandidates(input.id, pokemonIndex);

  const scored = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        const bundle = await resolveRepresentativeLightBundle({
          availability,
          family,
          minMeaningfulUsagePercent: MIN_MEANINGFUL_USAGE_PERCENT,
          pokemonId: candidate.id,
          selection,
        });

        return {
          input,
          candidate,
          bundle,
          ...scoreCandidate({
            availability,
            bundle,
            candidate,
            family,
          }),
        };
      } catch (error) {
        console.warn("Failed to score team-builder candidate", {
          candidate,
          error,
          input,
        });

        return {
          input,
          candidate,
          bundle: { usage: null, leads: null },
          score: -Infinity,
          meaningfulUsage: false,
          usagePercent: 0,
          rawCount: 0,
          leadPercent: 0,
          error,
        };
      }
    }),
  );

  const ranked = scored
    .filter((candidate) => Number.isFinite(candidate.score))
    .sort(compareScoredCandidates);

  if (!ranked.length) {
    return {
      unresolved: false,
      inputName: input.name,
      lineKey: getLineKey(candidates, input.id),
      best: null,
      bestNonMega: null,
      candidates: scored,
    };
  }

  const best = ranked[0];
  const bestNonMega = ranked.find((entry) => !entry.candidate.isMega) || null;

  return {
    unresolved: false,
    inputName: input.name,
    lineKey: getLineKey(candidates, input.id),
    best: makeChoice(
      input,
      best,
      best.candidate.isMega ? "Best overall; uses Mega slot" : "Best overall",
    ),
    bestNonMega: bestNonMega
      ? makeChoice(
          input,
          bestNonMega,
          best.candidate.isMega ? "Best non-Mega fallback" : "Best non-Mega",
        )
      : null,
    candidates: ranked,
  };
}

function makeChoice(input, result, note) {
  const usageNote = result.meaningfulUsage
    ? note
    : `${note}; trace usage (<${MIN_MEANINGFUL_USAGE_PERCENT}%)`;

  return {
    inputPokemonId: input.id,
    inputName: input.name,
    pokemonId: result.candidate.id,
    name: result.candidate.name,
    isMega: Boolean(result.candidate.isMega),
    score: result.score,
    meaningfulUsage: result.meaningfulUsage,
    bundle: result.bundle,
    note: usageNote,
  };
}

function getLineKey(candidates, fallbackId) {
  if (!candidates.length) return fallbackId;

  return candidates
    .map((candidate) => candidate.id)
    .sort()
    .join("|");
}
