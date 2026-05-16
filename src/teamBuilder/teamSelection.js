export function choosePoolTeam(lines) {
  const resolvedLines = lines.filter((line) => line.best || line.bestNonMega);
  const unresolved = lines.filter((line) => line.unresolved);

  const nonMegaPool = resolvedLines
    .filter((line) => line.bestNonMega)
    .map((line) => line.bestNonMega)
    .sort(compareChoices);

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
      .sort(compareChoices)
      .slice(0, 5);

    candidateTeams.push({
      team: [line.best, ...others],
      megaUsed: line.best,
    });
  }

  const bestTeam = candidateTeams
    .filter((candidate) => candidate.team.length > 0)
    .sort(compareCandidateTeams)[0] || {
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

function compareChoices(a, b) {
  const meaningfulDiff =
    Number(Boolean(b.meaningfulUsage)) - Number(Boolean(a.meaningfulUsage));

  if (meaningfulDiff) return meaningfulDiff;

  return (
    b.score - a.score ||
    getUsagePercent(b) - getUsagePercent(a) ||
    a.name.localeCompare(b.name)
  );
}

function compareCandidateTeams(a, b) {
  return (
    countMeaningfulChoices(b.team) - countMeaningfulChoices(a.team) ||
    sumTeamScore(b.team) - sumTeamScore(a.team)
  );
}

function countMeaningfulChoices(team) {
  return team.reduce((sum, row) => sum + (row.meaningfulUsage ? 1 : 0), 0);
}

function sumTeamScore(team) {
  return team.reduce((sum, row) => sum + (row.score || 0), 0);
}

function getUsagePercent(choice) {
  return Math.max(0, choice.bundle?.usage?.value || 0);
}
