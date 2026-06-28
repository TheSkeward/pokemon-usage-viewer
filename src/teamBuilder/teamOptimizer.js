import { getLineRepresentativeCandidates } from "../data";
import {
  applyBreedingContextToProgression,
  buildRebornBreedingContext,
} from "../reborn/breeding.js";
import { getCurrentRebornSpeciesForChoice } from "../reborn/currentSpecies.js";
import {
  getAvailableRebornMoves,
  loadRebornLegalMoveData,
} from "../reborn/legalMoves";
import { buildCandidateLegalityProfile } from "../reborn/teamAnalysis";
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
  progression = {},
  query,
  selection,
  onProgress,
}) {
  const groups = buildInputGroups(query, pokemonIndex);
  const total = groups.length;
  let completed = 0;
  onProgress?.({ completed, total });

  const breedingContext = await buildRebornBreedingContext({
    pokemonIndex,
    progression,
    query,
  });
  const lines = (
    await Promise.all(
      groups.map((group) =>
        resolvePoolLine({
          availability,
          breedingContext,
          family,
          group,
          pokemonIndex,
          progression,
          selection,
        }).then((line) => {
          completed += 1;
          onProgress?.({ completed, total });
          return line;
        }),
      ),
    )
  ).filter(Boolean);

  return choosePoolTeam(lines, progression.opponentTypeBias);
}

async function resolvePoolLine({
  availability,
  breedingContext,
  family,
  group,
  pokemonIndex,
  progression,
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
        const legalityProfile = await resolveCandidateLegalityProfile({
          breedingContext,
          candidate,
          input,
          progression,
        });

        return {
          input,
          candidate,
          bundle,
          legalityProfile,
          ...scoreCandidate({
            availability,
            bundle,
            candidate,
            family,
            legalityProfile,
            opponentTypeBias: progression.opponentTypeBias,
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
          legalityProfile: null,
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
    choiceOptions: buildChoiceOptions(input, ranked, best, bestNonMega),
    candidates: ranked,
  };
}

function buildChoiceOptions(input, ranked, best, bestNonMega) {
  const options = [];

  for (const result of ranked.slice(0, 5)) {
    options.push(
      makeChoice(
        input,
        result,
        getChoiceOptionNote(result, best, bestNonMega),
      ),
    );
  }

  if (
    bestNonMega &&
    !options.some((choice) => choice.pokemonId === bestNonMega.candidate.id)
  ) {
    options.push(
      makeChoice(
        input,
        bestNonMega,
        getChoiceOptionNote(bestNonMega, best, bestNonMega),
      ),
    );
  }

  return options;
}

function getChoiceOptionNote(result, best, bestNonMega) {
  if (result.candidate.id === best.candidate.id) {
    return best.candidate.isMega
      ? "Best overall; uses Mega slot"
      : "Best overall";
  }

  if (bestNonMega && result.candidate.id === bestNonMega.candidate.id) {
    return best.candidate.isMega ? "Best non-Mega fallback" : "Best non-Mega";
  }

  return result.candidate.isMega
    ? "Team-fit option; uses Mega slot"
    : "Team-fit option";
}

function makeChoice(input, result, note) {
  const usageNote = result.meaningfulUsage
    ? note
    : `${note}; trace usage (<${MIN_MEANINGFUL_USAGE_PERCENT}%)`;
  const legalityNote = formatLegalityNote(result.legalityProfile);

  return {
    inputPokemonId: input.id,
    inputName: input.name,
    pokemonId: result.candidate.id,
    name: result.candidate.name,
    isMega: Boolean(result.candidate.isMega),
    score: result.score,
    meaningfulUsage: result.meaningfulUsage,
    legalityProfile: result.legalityProfile,
    legalityScore: result.legalityScore,
    bundle: result.bundle,
    note: legalityNote ? `${usageNote}; ${legalityNote}` : usageNote,
  };
}

function formatLegalityNote(profile) {
  if (!profile) return "";

  const bestStab = profile.bestStabMove?.name
    ? `best legal STAB: ${profile.bestStabMove.name}`
    : "no current legal STAB";

  return `${bestStab}; ${profile.attackTypes.length} recommended attack types`;
}

async function resolveCandidateLegalityProfile({
  breedingContext,
  candidate,
  input,
  progression,
}) {
  const choice = {
    inputPokemonId: input.id,
    inputName: input.name,
    pokemonId: candidate.id,
    name: candidate.name,
  };
  const currentSpecies = getCurrentRebornSpeciesForChoice(choice, progression);
  const legalMoveData = await loadRebornLegalMoveData(
    currentSpecies?.id || candidate.id,
  );
  const memberProgression = applyBreedingContextToProgression(
    progression,
    legalMoveData?.pokemonId,
    breedingContext,
  );
  const member = {
    id: currentSpecies?.id || candidate.id,
    inputName: input.name,
    name: currentSpecies?.name || candidate.name,
    representativeId: candidate.id,
    representativeName: currentSpecies?.differsFromRepresentative
      ? currentSpecies.representativeName
      : "",
    types: legalMoveData?.types || [],
  };
  const moves = getAvailableRebornMoves(legalMoveData, memberProgression);

  return buildCandidateLegalityProfile({
    member,
    moves,
    representativeName: candidate.name,
    levelCap: progression.levelCap,
    opponentTypeBias: progression.opponentTypeBias,
  });
}

function getLineKey(candidates, fallbackId) {
  if (!candidates.length) return fallbackId;

  return candidates
    .map((candidate) => candidate.id)
    .sort()
    .join("|");
}
