export const MIN_MEANINGFUL_USAGE_PERCENT = 0.1;

export function scoreCandidate({
  availability,
  bundle,
  candidate,
  family,
  legalityProfile,
}) {
  const usage = bundle?.usage;

  if (!usage) {
    return {
      score: -Infinity,
      meaningfulUsage: false,
      usagePercent: 0,
      rawCount: 0,
      leadPercent: 0,
    };
  }

  const familyConfig = availability?.familyConfigs?.[family] || {};
  const formatOrder = familyConfig.formatOrder || [];
  const cutoffPriority = familyConfig.cutoffPriority || [];

  const formatIndex = formatOrder.indexOf(usage.formatId);
  const cutoffIndex = cutoffPriority.indexOf(usage.cutoff);

  const usagePercent = Math.max(0, usage.value || 0);
  const rawCount = Math.max(0, usage.entry?.rawCount || 0);
  const leadPercent = Math.max(0, bundle.leads?.value || 0);
  const meaningfulUsage = usagePercent >= MIN_MEANINGFUL_USAGE_PERCENT;

  const usageScore = Math.log1p(usagePercent) * 2000 + usagePercent * 250;
  const rawScore = Math.log1p(rawCount) * 35;
  const leadScore = leadPercent * 2;
  const formatQuality =
    formatIndex >= 0 ? (formatOrder.length - formatIndex) * 20 : 0;
  const cutoffQuality =
    cutoffIndex >= 0 ? (cutoffPriority.length - cutoffIndex) * 6 : 0;
  const megaBonus = candidate.isMega ? 300 : 0;
  const legalityScore = scoreLegalityProfile(legalityProfile);

  return {
    score:
      usageScore +
      rawScore +
      leadScore +
      formatQuality +
      cutoffQuality +
      megaBonus +
      legalityScore,
    legalityScore,
    meaningfulUsage,
    usagePercent,
    rawCount,
    leadPercent,
  };
}

function scoreLegalityProfile(profile) {
  if (!profile) return 0;

  // Damage estimates are category/stat-aware, so move quality here reflects how
  // hard the mon actually hits at the current progression — coupling mon
  // selection to whether its good moves match its offensive stats.
  const bestStabPower = profile.bestStabMove?.estimatedDamage || 0;
  const bestDamagePower = profile.bestDamagingMove?.estimatedDamage || 0;
  const coveragePower = profile.bestCoverageMoves.reduce(
    (sum, entry) => sum + Math.min(120, entry.bestMove?.estimatedDamage || 0),
    0,
  );
  const selectedMoveCount = profile.recommendedMoves?.length || 0;
  const selectedDamagingCount = profile.recommendedDamagingMoveCount || 0;

  return (
    Math.min(180, bestStabPower) * 8 +
    Math.min(140, bestDamagePower) * 2 +
    coveragePower * 2 +
    Math.min(8, profile.attackTypes.length) * 55 +
    profile.superEffectiveTargetCount * 45 +
    Math.min(4, selectedMoveCount) * 25 +
    Math.min(4, selectedDamagingCount) * 25 +
    Math.min(8, profile.legalDamagingMoveCount) * 8 +
    (profile.bestStabMove ? 0 : -350) +
    (profile.legalDamagingMoveCount ? 0 : -900)
  );
}

export function compareScoredCandidates(a, b) {
  const meaningfulDiff =
    Number(Boolean(b.meaningfulUsage)) - Number(Boolean(a.meaningfulUsage));

  if (meaningfulDiff) return meaningfulDiff;

  return (
    b.score - a.score ||
    (b.usagePercent || 0) - (a.usagePercent || 0) ||
    (b.rawCount || 0) - (a.rawCount || 0) ||
    a.candidate.name.localeCompare(b.candidate.name)
  );
}
