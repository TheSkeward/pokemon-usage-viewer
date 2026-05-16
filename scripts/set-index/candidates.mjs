export function getMovesetCandidates(availability, family, selection) {
  const familyConfig = availability?.familyConfigs?.[family];

  if (!familyConfig) {
    throw new Error(`Missing family config for ${family}`);
  }

  const candidates = [];
  const formatOrder = familyConfig.formatOrder || [];
  const cutoffPriority = familyConfig.cutoffPriority || [];

  for (const formatId of formatOrder) {
    for (const cutoff of cutoffPriority) {
      const months = getCandidateMonths(
        availability,
        selection,
        formatId,
        "moveset",
        cutoff,
      );

      if (!months.length) continue;

      candidates.push({
        family,
        selection,
        formatId,
        cutoff,
        months,
      });
    }
  }

  return candidates;
}

export function getCandidateMonths(
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

export function formatSource(source, formatsIndex) {
  const label =
    formatsIndex.find((format) => format.id === source.formatId)?.label ||
    source.formatId;

  if (source.selection === "all") {
    return `${label} @ ${source.cutoff} (${source.monthsPresent}/${source.monthsAvailable} mo)`;
  }

  return `${label} @ ${source.cutoff}`;
}
