import { GEN7_BASE_STAT_TOTALS, GEN7_BASE_STATS } from "../generated/gen7BaseStats.generated.js";
import { getTypeMultiplier } from "../reborn/typeChart.js";

export const MIN_MEANINGFUL_USAGE_PERCENT = 0.1;

// Per-tier prior step. Larger than the maximum non-tier prior swing (usage at
// 100% ~ 34k, plus raw/lead/mega), so the first-meaningful tier strictly
// dominates usage when ranking mons. Drives the per-mon `score` — which form
// represents a line, and the bench's worst-pick ranking.
const TIER_DOMINANCE_STEP = 50000;

// Per-tier step for the SEPARATE `teamScore` that team selection sums. Strict
// dominance there would crush coverage: a barely-used higher-tier mon would
// outrank a lower-tier one no matter how badly the team needs the latter's
// typing. Instead the team tier preference is bounded to ~half a coverage
// slot's worth of fit, so a needed answer (the only Water-resist, the only
// Grass attacker) still earns its place across tiers, while among
// coverage-equivalent picks the higher tier wins.
const TEAM_TIER_STEP = 120;

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
// Stone the level cap can't grant). Discount the borrowed prior by how much BULK
// the fielded form gives up versus the form it's valued as — the ratio of their
// *non-attacking* base stats (BST minus Atk and SpA). Offense is deliberately
// excluded because legalityScore already prices it in via the fielded form's real
// attacking stats, so squaring the full ratio (the old approach) double-counted
// the offensive shortfall and crushed perfectly viable mid-evolutions (a Frogadier
// fielded for Greninja's prior dropped to 0.58 and lost to fully-evolved chaff).
// The bulk ratio is used linearly, so a near-peer pre-evo keeps most of its value
// (Frogadier ~0.78) while a genuine shell is still held down — and for a shell
// that can't function (Magikarp, Happiny) legalityScore does the rest.
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

  // Headline usage still decides the "meaningful" cutoff. But for the prior we
  // rank by the first tier with real signal (descending the format×cutoff
  // ladder until usage rounds to >= 0.1%) — the headline tier's raw count is
  // noise for sub-0.1% mons.
  const usagePercent = Math.max(0, usage.value || 0);
  const rawCount = Math.max(0, usage.entry?.rawCount || 0);
  const leadPercent = Math.max(0, bundle.leads?.value || 0);
  const rank = getUsageRanking(bundle, formatOrder, cutoffPriority);

  const usageScore = Math.log1p(rank.value) * 2000 + rank.value * 250;
  const rawScore = Math.log1p(rank.rawCount) * 35;
  const leadScore = leadPercent * 2;
  // A shallower (higher-priority) tier strictly beats a deeper one: the step
  // exceeds the largest possible usage/raw/lead/mega swing, so e.g. a mon
  // meaningful only at AG/0 outranks one meaningful at Ubers/1760 even at 50%.
  // Within a tier, usage decides. Real mons cluster at the top tier, so this is
  // a constant for them (fit/bias/legality still decide) and only orders the
  // low-usage tail.
  const tierStep = rank.totalTiers - rank.tierRank;
  const tierQuality = tierStep * TIER_DOMINANCE_STEP;
  const megaBonus = candidate.isMega ? 300 : 0;
  const legalityScore = scoreLegalityProfile(legalityProfile);

  // The prior (usage/popularity-derived terms) is what's borrowed from the
  // evolved form; the legality score already reflects the form you actually
  // field, so only the prior is discounted by form-readiness.
  const formReadiness = getFormReadiness(legalityProfile);
  const priorBase = usageScore + rawScore + leadScore + megaBonus;
  const prior = priorBase + tierQuality;
  // Same prior, but with the bounded team-tier step instead of strict
  // dominance — see TEAM_TIER_STEP. Used only when team selection sums member
  // scores, so type coverage can trade against tier across the team.
  const teamPrior = priorBase + tierStep * TEAM_TIER_STEP;

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
    teamScore: teamPrior * formReadiness + legalityScore + biasScore,
    legalityScore,
    biasScore,
    formReadiness,
    meaningfulUsage,
    usagePercent,
    rawCount,
    leadPercent,
  };
}

// The first tier whose usage clears the 0.1% bar, used to rank low-usage mons by
// real signal rather than their noisy headline-tier raw count. Prefers the
// precomputed `ranking` from the resolver index; otherwise derives the tier from
// the headline (non-"all" data); falls to the floor when there's no signal.
export function getUsageRanking(bundle, formatOrder = [], cutoffPriority = []) {
  const totalTiers = Math.max(1, formatOrder.length * cutoffPriority.length);
  const ranking = bundle?.ranking;
  if (ranking) {
    return {
      tierRank: ranking.tierRank,
      value: ranking.value,
      rawCount: ranking.rawCount,
      totalTiers,
    };
  }

  const usage = bundle?.usage;
  const value = Math.max(0, usage?.value || 0);
  const rawCount = Math.max(0, usage?.entry?.rawCount || 0);
  if (value >= MIN_MEANINGFUL_USAGE_PERCENT) {
    const formatIndex = formatOrder.indexOf(usage.formatId);
    const cutoffIndex = cutoffPriority.indexOf(usage.cutoff);
    const tierRank =
      formatIndex >= 0 && cutoffIndex >= 0
        ? formatIndex * cutoffPriority.length + cutoffIndex
        : totalTiers;
    return { tierRank, value, rawCount, totalTiers };
  }

  return { tierRank: totalTiers, value, rawCount, totalTiers };
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

// Non-attacking base-stat ratio of the currently-fielded form vs the form whose
// usage prior it borrows: how much defensive bulk you keep by fielding the pre-evo
// (offense is left to legalityScore). 1 when they're the same form (the usual case).
function getFormReadiness(profile) {
  const currentId = profile?.currentId;
  const representativeId = profile?.representativeId;
  if (!currentId || !representativeId || currentId === representativeId) {
    return 1;
  }

  const current = nonAttackingTotal(currentId);
  const representative = nonAttackingTotal(representativeId);
  if (!current || !representative) return 1;

  return Math.min(1, current / representative);
}

// BST minus the two attacking stats (Atk, SpA): the bulk-and-speed portion.
function nonAttackingTotal(id) {
  const total = GEN7_BASE_STAT_TOTALS[id];
  const stats = GEN7_BASE_STATS[id]; // [Atk, Def, SpA, SpD, Spe]
  if (!total || !stats) return null;
  return total - stats[0] - stats[2];
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
