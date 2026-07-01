import { getTypeMultiplier } from "../reborn/typeChart.js";
import {
  currentFormValue,
  formReadinessRatio,
  CURRENT_VALUE_SCALE,
} from "./currentFormValue.js";

export const MIN_MEANINGFUL_USAGE_PERCENT = 0.1;

// ---------------------------------------------------------------------------
// Individual value model.
//
//     V = C + α·O·[U − C]₊   (+ bias; F is computed but NOT spent here)
//
//   C  current-form usefulness (see currentFormValue.js) — role-based, stage-
//      relative, usage-independent. On a [0, CURRENT_VALUE_SCALE] scale.
//   U  the line's competitive ceiling, from usage/tier, on the SAME scale as C.
//   O  online/readiness gate in [0,1]: how much the fielded form resembles the
//      final competitive form (1 = you ARE it, ~0 = a baby that only promises it).
//   α  how much competitive usage may matter even when fully online.
//
// [U − C]₊ makes usage upside-only: it can lift a pre-evo toward its famous
// ceiling but never drag down a mon already outperforming its reputation now.
// Gated by O, so a high ceiling can't carry a body that can't express it.
//
// Because C and U share a scale, the knobs have auditable bounds: the usage term
// is at most α·(U − C), and with α = 0.3 that's ≤ ~15% of the value range for a
// realistic online mon — informative, not sovereign.
const USAGE_INFLUENCE = 0.3; // α

// The competitive ceiling U, on C's scale. All ~40 usage buckets collapse into one
// [0,1] number (a shallow/high-prestige tier and higher usage both push it up),
// then scaled to points.
const USAGE_CEILING = CURRENT_VALUE_SCALE;
const USAGE_TIER_WEIGHT = 0.6;
const USAGE_REF_PERCENT = 20;

// Near-future option value. QUARANTINED from team selection: "usable mid-evo" and
// "big upgrade reachable soon" are different facts, and we don't yet simulate the
// latter. So F is computed for display only ("worth training toward") and is NOT
// added to V — crude future value must not pick the current six.
const FUTURE_WEIGHT = 0.35;
const FUTURE_CAP = 300;

// Readiness gate O — coarse, inspectable, ROLE-online (not bulk-based, which would
// misjudge frail-but-ready attackers). A pre-evo that can't deal stage-real damage
// is a baby no matter how bulky or how famous its final form.
const ONLINE_FINAL = 1.0;
const ONLINE_NEAR = 0.65;
const ONLINE_MIDEVO = 0.35;
const ONLINE_BABY = 0.1;
const ONLINE_DEAD = 0.0;
const ONLINE_FLOOR = ONLINE_MIDEVO; // "online enough" to count usage / be meaningful
const ACT_FLOOR = 0.15; // damage_q below this ⇒ can't meaningfully act (stage-relative)
const NEAR_FINAL_RATIO = 0.85; // key stats this close to final ⇒ near-final

// Per bias level (1..6): preparedness against a biased opponent type. Added onto
// the honest current-form value, since it reflects the form you actually field.
const BIAS_RESIST_PER_LEVEL = 90;
const BIAS_IMMUNE_PER_LEVEL = 130;
const BIAS_WEAK_PENALTY_PER_LEVEL = 70;
const BIAS_OFFENSE_PER_LEVEL = 90;
const BIAS_MEANINGFUL_THRESHOLD = 270;

export function scoreCandidate({
  availability,
  bundle,
  candidate,
  family,
  legalityProfile,
  levelCap = 0,
  opponentTypeBias,
}) {
  const usage = bundle?.usage;

  if (!usage) {
    return {
      score: -Infinity,
      teamScore: -Infinity,
      meaningfulUsage: false,
      usagePercent: 0,
      rawCount: 0,
      leadPercent: 0,
    };
  }

  const familyConfig = availability?.familyConfigs?.[family] || {};
  const formatOrder = familyConfig.formatOrder || [];
  const cutoffPriority = familyConfig.cutoffPriority || [];

  const usagePercent = Math.max(0, usage.value || 0);
  const rawCount = Math.max(0, usage.entry?.rawCount || 0);
  const leadPercent = Math.max(0, bundle.leads?.value || 0);
  const rank = getUsageRanking(bundle, formatOrder, cutoffPriority);

  // C — current-form usefulness (role-based, usage-independent).
  const current = currentFormValue(legalityProfile, levelCap);
  const currentValue = current.value;

  // U — competitive ceiling on C's scale.
  const ceiling = usageCeiling(rank);

  // O — how much the fielded form resembles the ceiling form.
  const online = getReadinessGate(legalityProfile, current.features);

  // Usage pulls C toward the ceiling: gated by O, capped by α, upside-only.
  const headroom = Math.max(0, ceiling - currentValue);
  const usagePull = USAGE_INFLUENCE * online * headroom;

  // F — display-only near-future value; NOT added to V (see comment above).
  const futureValue =
    online >= ONLINE_FLOOR && online < ONLINE_FINAL
      ? Math.min(FUTURE_CAP, FUTURE_WEIGHT * (1 - online) * headroom)
      : 0;

  // Bias reflects the form you actually field, so it's added to the honest value.
  const biasScore = scoreOpponentTypeBias(opponentTypeBias, legalityProfile);

  const value = currentValue + usagePull + biasScore;

  const meaningfulUsage =
    (usagePercent >= MIN_MEANINGFUL_USAGE_PERCENT && online >= ONLINE_FLOOR) ||
    biasScore >= BIAS_MEANINGFUL_THRESHOLD;

  return {
    score: value,
    teamScore: value,
    legalityScore: currentValue,
    biasScore,
    ceiling,
    online,
    futureValue,
    currentRole: current.bestRole,
    currentFeatures: current.features,
    meaningfulUsage,
    usagePercent,
    rawCount,
    leadPercent,
  };
}

// Collapses the ~40 usage buckets into one competitive-ceiling number on C's
// scale. A shallow (high-priority) tier and higher usage both push it up; a mon
// that only shows up deep in the ladder lands low, never-used lands at ~0.
function usageCeiling(rank) {
  const totalTiers = Math.max(1, rank.totalTiers || 1);
  const tierNorm = Math.max(0, (totalTiers - rank.tierRank) / totalTiers);
  const usageNorm = Math.min(
    1,
    Math.log1p(Math.max(0, rank.value)) / Math.log1p(USAGE_REF_PERCENT),
  );
  const combined =
    USAGE_TIER_WEIGHT * tierNorm + (1 - USAGE_TIER_WEIGHT) * usageNorm;
  return USAGE_CEILING * Math.max(0, Math.min(1, combined));
}

// The first tier whose usage clears the 0.1% bar, used to rank low-usage mons by
// real signal rather than their noisy headline-tier raw count.
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
// or being immune to them, and being able to hit them super-effectively, scaled
// by each type's bias level. Being weak to a biased type is penalised.
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

// The online/readiness gate O: role-online, from concrete facts. A pre-evo that
// can't deal stage-real damage is a baby regardless of bulk or its final form's
// fame; one that already has most of the final form's key stats is near-final.
function getReadinessGate(profile, features) {
  const currentId = profile?.currentId;
  const representativeId = profile?.representativeId;
  if (!currentId || !representativeId || currentId === representativeId) {
    return ONLINE_FINAL;
  }
  if ((profile?.legalMoveCount || 0) === 0) return ONLINE_DEAD;

  // Can it act at this stage? damage_q is best-hit vs a stage-typical hit.
  if (
    (features?.damage_q ?? 0) < ACT_FLOOR ||
    (profile?.legalDamagingMoveCount || 0) === 0
  ) {
    return ONLINE_BABY;
  }

  const readiness = formReadinessRatio(currentId, representativeId);
  return readiness >= NEAR_FINAL_RATIO ? ONLINE_NEAR : ONLINE_MIDEVO;
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
