import {
  getLineRepresentativeCandidates,
  resolveBestAvailableLightBundle,
  resolveQueryEntries,
} from "../data";
import { toId as normalizeName } from "../utils/ids.js";

/**
 * Resolves each query token to result rows: normally one row carrying the
 * token's best-scoring line representative (exact form-specific inputs force
 * their own form), or one literal row per match when the token is a broad
 * match, spans multiple lines, or is a form-specific prefix. Literal groups
 * larger than `literalResolveLimit` skip bundle resolution and come back as
 * literalSearchOnly rows with empty bundles. Rows are deduped by
 * representative id (highest score wins) and sorted by lead% descending,
 * broad matches last.
 * @param {{availability: ?Object, family: string, pokemonIndex: !Object,
 *     query: string, selection: string, literalResolveLimit: number}} params
 * @return {!Promise<!Array<!Object>>} representativeScore is -Infinity on
 *     literal and unresolved rows.
 */
export async function computeResolverRepresentativeResults({
  availability,
  family,
  pokemonIndex,
  query,
  selection,
  literalResolveLimit = 25,
}) {
  const entries = resolveQueryEntries(query, pokemonIndex);
  const groups = groupResolverEntries(entries, pokemonIndex);

  const rawResults = await Promise.all(
    groups.map(async (group) => {
      if (group.mode === "literal") {
        return resolveLiteralSearchGroup({
          availability,
          family,
          group,
          literalResolveLimit,
          selection,
        });
      }

      const representativeCandidates = buildRepresentativeCandidatePool(
        group.entries,
        pokemonIndex,
      );

      const forcedExact = getForcedExactRepresentative(
        group.entries,
        representativeCandidates,
      );

      const candidatesToScore = forcedExact
        ? [forcedExact]
        : representativeCandidates;

      const candidateResults = await Promise.all(
        candidatesToScore.map(async (candidate) => {
          const bundle = await resolveBestAvailableLightBundle({
            availability,
            family,
            selection,
            pokemonId: candidate.id,
          });

          return {
            candidate,
            bundle,
            score: scoreRepresentativeCandidate(candidate, bundle, {
              availability,
              family,
            }),
          };
        }),
      );

      const best =
        candidateResults
          .filter((result) => Number.isFinite(result.score))
          .sort((a, b) => b.score - a.score)[0] ||
        candidateResults.find((result) => result.candidate.isExactInput) ||
        candidateResults[0];

      const bestNonMega =
        candidateResults
          .filter(
            (result) =>
              Number.isFinite(result.score) && !result.candidate.isMega,
          )
          .sort((a, b) => b.score - a.score)[0] || null;

      const displayInput = getDisplayInputForGroup(group.entries);

      if (!best) {
        return {
          pokemonId: displayInput.id,
          name: displayInput.name,
          inputPokemonId: displayInput.id,
          inputName: displayInput.name,
          token: displayInput.token,
          representativeIsMega: false,
          representativeScore: -Infinity,
          bundle: { usage: null, leads: null },
        };
      }

      return {
        pokemonId: best.candidate.id,
        name: best.candidate.name,
        inputPokemonId: displayInput.id,
        inputName: displayInput.name,
        token: displayInput.token,
        representativeIsMega: Boolean(best.candidate.isMega),
        representativeScore: best.score,
        bestNonMegaPokemonId: bestNonMega?.candidate.id || null,
        bestNonMegaName: bestNonMega?.candidate.name || null,
        bestNonMegaScore: bestNonMega?.score ?? null,
        bestNonMegaUsage: bestNonMega?.bundle?.usage?.value ?? null,
        candidateCount: representativeCandidates.length,
        bundle: best.bundle,
      };
    }),
  );

  return sortResolverRows(dedupeRepresentativeRows(rawResults.flat()));
}

async function resolveLiteralSearchGroup({
  availability,
  family,
  group,
  literalResolveLimit,
  selection,
}) {
  const shouldResolveData = group.entries.length <= literalResolveLimit;

  return Promise.all(
    group.entries.map(async (entry) => ({
      pokemonId: entry.id,
      name: entry.name,
      inputPokemonId: entry.id,
      inputName: entry.name,
      token: entry.token,
      representativeIsMega: false,
      representativeScore: -Infinity,
      broadMatch: true,
      literalSearchOnly: !shouldResolveData,
      bundle: shouldResolveData
        ? await resolveBestAvailableLightBundle({
            availability,
            family,
            selection,
            pokemonId: entry.id,
          })
        : { usage: null, leads: null },
    })),
  );
}

function groupResolverEntries(entries, pokemonIndex) {
  const tokenGroups = new Map();

  for (const entry of entries) {
    const tokenKey = normalizeName(entry.token || entry.name);
    if (!tokenGroups.has(tokenKey)) tokenGroups.set(tokenKey, []);
    tokenGroups.get(tokenKey).push(entry);
  }

  const groups = [];

  for (const tokenEntries of tokenGroups.values()) {
    const entriesByLine = new Map();

    for (const entry of tokenEntries) {
      const lineKey = getRepresentativeLineKey(entry.id, pokemonIndex);
      if (!entriesByLine.has(lineKey)) entriesByLine.set(lineKey, []);
      entriesByLine.get(lineKey).push(entry);
    }

    const hasBroadMatch = tokenEntries.some((entry) => entry.broadMatch);
    const token = normalizeName(tokenEntries[0]?.token || "");
    const formSpecificPrefix =
      tokenEntries.length > 1 &&
      tokenLooksLikeSpecificFormPrefix(token) &&
      tokenEntries.every((entry) => isSpecificFormId(entry.id));

    if (hasBroadMatch || entriesByLine.size > 1 || formSpecificPrefix) {
      groups.push({ mode: "literal", entries: tokenEntries });
      continue;
    }

    groups.push({ mode: "representative", entries: tokenEntries });
  }

  return groups;
}

function tokenLooksLikeSpecificFormPrefix(token) {
  return (
    token.includes("mega") ||
    token.endsWith("m") ||
    token.includes("alola") ||
    token.includes("galar") ||
    token.includes("hisui")
  );
}

function getRepresentativeLineKey(pokemonId, pokemonIndex) {
  const candidates = getLineRepresentativeCandidates(pokemonId, pokemonIndex);
  if (!candidates.length) return pokemonId;

  return candidates
    .map((candidate) => candidate.id)
    .sort()
    .join("|");
}

function buildRepresentativeCandidatePool(group, pokemonIndex) {
  const candidateMap = new Map();

  for (const entry of group) {
    for (const candidate of getLineRepresentativeCandidates(
      entry.id,
      pokemonIndex,
    )) {
      const existing = candidateMap.get(candidate.id);

      if (existing) {
        existing.isExactInput ||= candidate.id === entry.id;
        existing.sourceInputs.push(entry);
      } else {
        candidateMap.set(candidate.id, {
          ...candidate,
          isExactInput: candidate.id === entry.id,
          sourceInputs: [entry],
        });
      }
    }
  }

  return [...candidateMap.values()];
}

function getForcedExactRepresentative(group, candidates) {
  for (const entry of group) {
    const tokenId = normalizeName(entry.token || "");
    const exactId = normalizeName(entry.name || "");

    if (tokenId === exactId && isSpecificFormId(entry.id)) {
      return candidates.find((candidate) => candidate.id === entry.id) || null;
    }
  }

  return null;
}

function isSpecificFormId(pokemonId) {
  return (
    pokemonId.includes("mega") ||
    pokemonId.includes("alola") ||
    pokemonId.includes("galar") ||
    pokemonId.includes("hisui")
  );
}

function getDisplayInputForGroup(group) {
  const exactNonForm = group.find(
    (entry) =>
      normalizeName(entry.token || "") === normalizeName(entry.name || "") &&
      !isSpecificFormId(entry.id),
  );
  if (exactNonForm) return exactNonForm;

  const nonForm = group.find((entry) => !isSpecificFormId(entry.id));
  if (nonForm) return nonForm;

  return group[0];
}

function dedupeRepresentativeRows(rows) {
  const byRepresentative = new Map();

  for (const row of rows) {
    if (!row?.pokemonId) continue;

    const existing = byRepresentative.get(row.pokemonId);
    if (!existing) {
      byRepresentative.set(row.pokemonId, row);
      continue;
    }

    const existingScore = existing.representativeScore ?? -Infinity;
    const rowScore = row.representativeScore ?? -Infinity;

    if (rowScore > existingScore) {
      byRepresentative.set(row.pokemonId, row);
    }
  }

  return [...byRepresentative.values()];
}

function sortResolverRows(results) {
  results.sort((a, b) => {
    if (a.broadMatch || b.broadMatch) {
      if (a.broadMatch !== b.broadMatch) return a.broadMatch ? 1 : -1;

      const usageA = a.bundle.usage?.value ?? -Infinity;
      const usageB = b.bundle.usage?.value ?? -Infinity;
      if (usageB !== usageA) return usageB - usageA;

      return a.name.localeCompare(b.name);
    }

    const leadA = a.bundle.leads?.value ?? -Infinity;
    const leadB = b.bundle.leads?.value ?? -Infinity;
    if (leadB !== leadA) return leadB - leadA;

    const scoreA = a.representativeScore ?? -Infinity;
    const scoreB = b.representativeScore ?? -Infinity;
    if (scoreB !== scoreA) return scoreB - scoreA;

    const usageA = a.bundle.usage?.value ?? -Infinity;
    const usageB = b.bundle.usage?.value ?? -Infinity;
    if (usageB !== usageA) return usageB - usageA;

    return a.name.localeCompare(b.name);
  });

  return results;
}

function scoreRepresentativeCandidate(
  candidate,
  bundle,
  { availability, family },
) {
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
  const exactFormBonus =
    candidate.isExactInput && isSpecificFormId(candidate.id) ? 100000 : 0;
  const exactBonus = candidate.isExactInput ? 1 : 0;

  return (
    usageScore +
    rawScore +
    leadScore +
    formatQuality +
    cutoffQuality +
    megaBonus +
    exactFormBonus +
    exactBonus
  );
}
