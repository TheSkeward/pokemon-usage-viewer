import { loadSourceData } from "../data";

const LEAD_SMOOTHING_K = 200;

export async function resolveRepresentativeLightBundle({
  availability,
  family,
  minMeaningfulUsagePercent,
  pokemonId,
  selection,
}) {
  let bestTrace = null;

  for (const candidate of iterateCandidateSources(
    availability,
    family,
    selection,
    "usage",
  )) {
    const usage = await aggregateUsageCandidate(candidate, pokemonId);
    if (!usage) continue;

    const leads = await aggregateLeadsCandidate(candidate, pokemonId);

    const bundle = { usage, leads };

    if (usage.value >= minMeaningfulUsagePercent) {
      return bundle;
    }

    if (!bestTrace || usage.value > bestTrace.usage.value) {
      bestTrace = bundle;
    }
  }

  return bestTrace || { usage: null, leads: null };
}

function* iterateCandidateSources(availability, family, selection, dataKind) {
  const familyConfig = availability?.familyConfigs?.[family];
  const formatOrder = familyConfig?.formatOrder || [];
  const cutoffPriority = familyConfig?.cutoffPriority || [];

  for (const formatId of formatOrder) {
    for (const cutoff of cutoffPriority) {
      const months = getCandidateMonths(
        availability,
        selection,
        formatId,
        dataKind,
        cutoff,
      );

      if (!months.length) continue;

      yield { formatId, cutoff, months, selection, family };
    }
  }
}

function getCandidateMonths(
  availability,
  selection,
  formatId,
  dataKind,
  cutoff,
) {
  if (selection === "all") {
    return Object.keys(availability?.months || {})
      .sort()
      .filter((month) =>
        availability?.months?.[month]?.[formatId]?.[dataKind]?.includes(cutoff),
      );
  }

  return availability?.months?.[selection]?.[formatId]?.[dataKind]?.includes(
    cutoff,
  )
    ? [selection]
    : [];
}

async function aggregateUsageCandidate(candidate, pokemonId) {
  let totalUsage = 0;
  let totalRawCount = 0;
  let monthsPresent = 0;
  let name = null;

  for (const month of candidate.months) {
    const source = await loadSourceData(
      month,
      candidate.formatId,
      candidate.cutoff,
      "usage",
    );
    const entry = source?.pokemon?.[pokemonId];
    if (!entry) continue;

    name = entry.name;
    totalUsage += entry.usage;
    totalRawCount += entry.rawCount;
    monthsPresent += 1;
  }

  if (monthsPresent === 0) return null;

  return {
    selection: candidate.selection,
    family: candidate.family,
    month: candidate.selection === "all" ? null : candidate.months[0],
    formatId: candidate.formatId,
    cutoff: candidate.cutoff,
    monthsAvailable: candidate.months.length,
    monthsPresent,
    entry: {
      pokemonId,
      name,
      usage: totalUsage / candidate.months.length,
      rawCount: totalRawCount,
    },
    value: totalUsage / candidate.months.length,
  };
}

async function aggregateLeadsCandidate(candidate, pokemonId) {
  let totalUsageRawForPrior = 0;
  let totalLeadRawForPrior = 0;
  let usageRawCount = 0;
  let leadRawCount = 0;
  let monthsPresent = 0;
  let name = null;

  for (const month of candidate.months) {
    const usageSource = await loadSourceData(
      month,
      candidate.formatId,
      candidate.cutoff,
      "usage",
    );
    const leadsSource = await loadSourceData(
      month,
      candidate.formatId,
      candidate.cutoff,
      "leads",
    );

    if (!usageSource || !leadsSource) continue;

    totalUsageRawForPrior += leadsSource.summary?.totalUsageRaw || 0;
    totalLeadRawForPrior += leadsSource.summary?.totalLeadRaw || 0;

    const usageEntry = usageSource.pokemon?.[pokemonId];
    const leadEntry = leadsSource.pokemon?.[pokemonId];

    if (usageEntry) {
      name = usageEntry.name;
      usageRawCount += usageEntry.rawCount;
      monthsPresent += 1;
    }

    if (leadEntry) {
      leadRawCount += leadEntry.leadRawCount || 0;
    }
  }

  if (usageRawCount === 0 || monthsPresent === 0) return null;

  const prior =
    totalUsageRawForPrior > 0
      ? totalLeadRawForPrior / totalUsageRawForPrior
      : 0;
  const value =
    ((leadRawCount + LEAD_SMOOTHING_K * prior) /
      (usageRawCount + LEAD_SMOOTHING_K)) *
    100;

  return {
    selection: candidate.selection,
    family: candidate.family,
    month: candidate.selection === "all" ? null : candidate.months[0],
    formatId: candidate.formatId,
    cutoff: candidate.cutoff,
    monthsAvailable: candidate.months.length,
    monthsPresent,
    entry: { pokemonId, name, usageRawCount, leadRawCount },
    value,
  };
}
