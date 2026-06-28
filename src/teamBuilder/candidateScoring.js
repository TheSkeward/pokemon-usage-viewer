import { GEN7_BASE_STAT_TOTALS } from "../generated/gen7BaseStats.generated.js";
import { getTypeMultiplier } from "../reborn/typeChart.js";

export const MIN_MEANINGFUL_USAGE_PERCENT = 0.1;

// Per bias level (1..6), how much preparedness against a biased opponent type is
// worth. Resisting/being immune to it (you survive its STAB) and hitting it
// super-effectively (you can KO it) are both rewarded; being weak to it is
// penalised. At level 6 a perfectly-prepared pick earns ~1300, comparable to a
// strong usage prior, so a cranked-up bias decisively steers selection.
const BIAS_RESIST_PER_LEVEL = 90;
const BIAS_IMMUNE_PER_LEVEL = 130;
const BIAS_WEAK_PENALTY_PER_LEVEL = 70;
const BIAS_OFFENSE_PER_LEVEL = 90;

// Team selection ranks the number of "meaningful usage" picks above raw score,
// so a low-usage answer can never displace a popular pick on score alone. When a
// pick is a strong enough answer to a biased opponent type, treat it as
// meaningful so it can earn a slot — the threshold means a low bias still only
// nudges ordering, while a cranked-up bias (a dual resist+hit answer at level 2,
// or a single-sided answer at level 3) genuinely pulls dedicated answers in.
const BIAS_MEANINGFUL_THRESHOLD = 270;

// A candidate borrows its usage prior from the competitively-played form it
// represents, but at the current progression you may be stuck fielding a much
// weaker pre-evolution (Happiny valued via Chansey, but Chansey needs an Oval
// Stone the level cap can't grant). Discount the borrowed prior by the squared
// base-stat-total ratio of the form you actually field vs the one it's valued
// as — squared so a genuinely weak shell (Happiny ~0.24) is punished hard while
// a near-peer pre-evo about to evolve (Combusken ~0.58) keeps most of its value.
// Below this readiness the pick also stops counting as "meaningful usage", so
// team selection no longer prefers including it for its borrowed popularity.
const FORM_READINESS_MEANINGFUL_FLOOR = 0.4;

export function scoreCandidate({
  availability,
  bundle,
  candidate,
  family,
  legalityProfile,
  opponentTypeBias,
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

  const usageScore = Math.log1p(usagePercent) * 2000 + usagePercent * 250;
  const rawScore = Math.log1p(rawCount) * 35;
  const leadScore = leadPercent * 2;
  const formatQuality =
    formatIndex >= 0 ? (formatOrder.length - formatIndex) * 20 : 0;
  const cutoffQuality =
    cutoffIndex >= 0 ? (cutoffPriority.length - cutoffIndex) * 6 : 0;
  const megaBonus = candidate.isMega ? 300 : 0;
  const legalityScore = scoreLegalityProfile(legalityProfile);

  // The prior (usage/popularity-derived terms) is what's borrowed from the
  // evolved form; the legality score already reflects the form you actually
  // field, so only the prior is discounted by form-readiness.
  const formReadiness = getFormReadiness(legalityProfile);
  const prior =
    usageScore + rawScore + leadScore + formatQuality + cutoffQuality + megaBonus;

  // Opponent-type bias rewards the form you actually field (its real types and
  // attacks), so it's added to the honest part of the score, not discounted by
  // form-readiness.
  const biasScore = scoreOpponentTypeBias(opponentTypeBias, legalityProfile);

  const meaningfulUsage =
    (usagePercent >= MIN_MEANINGFUL_USAGE_PERCENT &&
      formReadiness >= FORM_READINESS_MEANINGFUL_FLOOR) ||
    biasScore >= BIAS_MEANINGFUL_THRESHOLD;

  return {
    score: prior * formReadiness + legalityScore + biasScore,
    legalityScore,
    biasScore,
    formReadiness,
    meaningfulUsage,
    usagePercent,
    rawCount,
    leadPercent,
  };
}

// Rewards a pick for being prepared against the biased opponent types: resisting
// or being immune to them (so their STAB doesn't threaten it) and being able to
// hit them super-effectively (so it can KO them), scaled by each type's bias
// level. Being weak to a biased type is penalised.
function scoreOpponentTypeBias(opponentTypeBias, profile) {
  if (!opponentTypeBias || !profile) return 0;

  const currentTypes = profile.currentTypes || [];
  const attackTypes = profile.attackTypes || [];
  let score = 0;

  for (const [type, rawLevel] of Object.entries(opponentTypeBias)) {
    const level = Math.max(0, Math.min(6, Number.parseInt(rawLevel, 10) || 0));
    if (!level) continue;

    const defense = getTypeMultiplier(type, currentTypes);
    if (defense === 0) score += level * BIAS_IMMUNE_PER_LEVEL;
    else if (defense < 1) score += level * BIAS_RESIST_PER_LEVEL;
    else if (defense > 1) score -= level * BIAS_WEAK_PENALTY_PER_LEVEL;

    const hitsSuperEffectively = attackTypes.some(
      (attackType) => getTypeMultiplier(attackType, [type]) > 1,
    );
    if (hitsSuperEffectively) score += level * BIAS_OFFENSE_PER_LEVEL;
  }

  return score;
}

// Squared base-stat-total ratio of the currently-fielded form vs the form whose
// usage prior it borrows. 1 when they're the same form (the usual case).
function getFormReadiness(profile) {
  const currentId = profile?.currentId;
  const representativeId = profile?.representativeId;
  if (!currentId || !representativeId || currentId === representativeId) {
    return 1;
  }

  const current = GEN7_BASE_STAT_TOTALS[currentId];
  const representative = GEN7_BASE_STAT_TOTALS[representativeId];
  if (!current || !representative) return 1;

  const ratio = Math.min(1, current / representative);
  return ratio * ratio;
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
