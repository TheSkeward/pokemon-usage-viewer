import {
  getLineRepresentativeCandidates,
  resolveBestAvailableLightBundle,
  resolveQueryEntries,
} from "../data";
import { parsePoolTokens } from "./poolParsing";

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

function buildInputGroups(query, pokemonIndex) {
  const tokens = parsePoolTokens(query, pokemonIndex);
  const groups = [];

  for (const token of tokens) {
    const entries = resolveQueryEntries(token, pokemonIndex);

    if (!entries.length) {
      groups.push({
        token,
        input: { id: normalizeName(token), name: token, token },
        entries: [],
        unresolved: true,
      });
      continue;
    }

    const exact = entries.find(
      (entry) => normalizeName(entry.name) === normalizeName(token),
    );
    const chosen = exact || entries[0];

    groups.push({
      token,
      input: chosen,
      entries: [chosen],
      ambiguousCount: entries.length,
      unresolved: false,
    });
  }

  return groups;
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
        const bundle = await resolveBestAvailableLightBundle({
          availability,
          family,
          selection,
          pokemonId: candidate.id,
        });

        return {
          input,
          candidate,
          bundle,
          score: scoreCandidate({
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
          error,
        };
      }
    }),
  );

  const ranked = scored
    .filter((candidate) => Number.isFinite(candidate.score))
    .sort((a, b) => b.score - a.score);

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

function choosePoolTeam(lines) {
  const resolvedLines = lines.filter((line) => line.best || line.bestNonMega);
  const unresolved = lines.filter((line) => line.unresolved);

  const nonMegaPool = resolvedLines
    .filter((line) => line.bestNonMega)
    .map((line) => line.bestNonMega)
    .sort((a, b) => b.score - a.score);

  const candidateTeams = [
    {
      team: nonMegaPool.slice(0, 6),
      megaUsed: null,
    },
  ];

  for (const line of resolvedLines) {
    if (!line.best?.isMega) continue;

    const others = resolvedLines
      .filter((other) => other.lineKey !== line.lineKey && other.bestNonMega)
      .map((other) => other.bestNonMega)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    candidateTeams.push({
      team: [line.best, ...others],
      megaUsed: line.best,
    });
  }

  const bestTeam = candidateTeams
    .filter((candidate) => candidate.team.length > 0)
    .sort((a, b) => sumTeamScore(b.team) - sumTeamScore(a.team))[0] || {
    team: [],
    megaUsed: null,
  };

  bestTeam.team = bestTeam.team.slice(0, 6);

  return {
    team: bestTeam.team,
    megaUsed: bestTeam.megaUsed,
    lines,
    unresolved,
    linesConsidered: resolvedLines.length,
  };
}

function scoreCandidate({ availability, bundle, candidate, family }) {
  const usage = bundle?.usage;
  if (!usage) return -Infinity;

  const familyConfig = availability?.familyConfigs?.[family] || {};
  const formatOrder = familyConfig.formatOrder || [];
  const cutoffPriority = familyConfig.cutoffPriority || [];

  const formatIndex = formatOrder.indexOf(usage.formatId);
  const cutoffIndex = cutoffPriority.indexOf(usage.cutoff);

  const usagePercent = Math.max(0, usage.value || 0);
  const rawCount = Math.max(0, usage.entry?.rawCount || 0);
  const leadPercent = Math.max(0, bundle.leads?.value || 0);

  const usageScore = Math.log1p(usagePercent) * 2000 + usagePercent * 250;
  const rawScore = Math.log1p(rawCount) * 35;
  const leadScore = leadPercent * 2;
  const formatQuality =
    formatIndex >= 0 ? (formatOrder.length - formatIndex) * 20 : 0;
  const cutoffQuality =
    cutoffIndex >= 0 ? (cutoffPriority.length - cutoffIndex) * 6 : 0;
  const megaBonus = candidate.isMega ? 300 : 0;

  return (
    usageScore +
    rawScore +
    leadScore +
    formatQuality +
    cutoffQuality +
    megaBonus
  );
}

function makeChoice(input, result, note) {
  return {
    inputPokemonId: input.id,
    inputName: input.name,
    pokemonId: result.candidate.id,
    name: result.candidate.name,
    isMega: Boolean(result.candidate.isMega),
    score: result.score,
    bundle: result.bundle,
    note,
  };
}

function getLineKey(candidates, fallbackId) {
  if (!candidates.length) return fallbackId;

  return candidates
    .map((candidate) => candidate.id)
    .sort()
    .join("|");
}

function sumTeamScore(team) {
  return team.reduce((sum, row) => sum + (row.score || 0), 0);
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}
