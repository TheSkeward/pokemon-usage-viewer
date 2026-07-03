import { getTypeMultiplier } from "../reborn/typeChart.js";
import { evolutionChainProof } from "../reborn/evolutionRequirements.js";
import {
  currentFormValue,
  formReadinessRatio,
  CURRENT_VALUE_SCALE,
} from "./currentFormValue.js";
import { tunable } from "./scoringConstants.js";

// Sourced from the constants module (single home for every judgement default;
// this was previously duplicated here as a hardcoded 0.1 while the
// scoringConstants entry was dead). Snapshotted at module load — it is not a
// confidence-sweep axis, so late overrides don't need to reach it.
export const MIN_MEANINGFUL_USAGE_PERCENT = tunable(
  "MIN_MEANINGFUL_USAGE_PERCENT",
);

// ---------------------------------------------------------------------------
// Individual value model (frozen v0 shape — see SCORING_V0.md):
//
//     V = C + α·O·[U − C]₊ + bias − K      (F is computed but NOT spent here)
//
//   C  current-form usefulness (currentFormValue.js) — role-based, stage-
//      relative, usage-independent. On a [0, CURRENT_VALUE_SCALE] scale.
//   U  the line's competitive ceiling, from usage/tier, on the SAME scale as C.
//   O  online/readiness gate in [0,1]: how much the fielded form resembles the
//      final competitive form (1 = you ARE it, ~0 = a baby that only promises it).
//   α  how much competitive usage may matter even when fully online.
//   K  investment friction: evolution requirements (friendship/item/time) plus
//      build friction (e.g. a move that requires delaying evolution).
//
// [U − C]₊ makes usage upside-only: it can lift a pre-evo toward its famous
// ceiling but never drag down a mon already outperforming its reputation now.
// Gated by O, so a high ceiling can't carry a body that can't express it.
// All judgement constants live in scoringConstants.js and are sweepable.
const ONLINE_FINAL = 1.0;
const ONLINE_DEAD = 0.0;

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
  const alpha = tunable("USAGE_INFLUENCE");
  const headroom = Math.max(0, ceiling - currentValue);
  const usagePull = alpha * online * headroom;

  // F — display-only near-future value; NOT added to V. The investment view
  // (Phase 9) owns "worth training toward"; selection judges the present.
  const onlineFloor = tunable("ONLINE_MIDEVO");
  const futureValue =
    online >= onlineFloor && online < ONLINE_FINAL
      ? Math.min(
          tunable("FUTURE_CAP"),
          tunable("FUTURE_WEIGHT") * (1 - online) * headroom,
        )
      : 0;

  // Bias reflects the form you actually field, so it's added to the honest value.
  const biasScore = scoreOpponentTypeBias(opponentTypeBias, legalityProfile);

  // K — friction to have reached this fielded form AND to run this build
  // (delayed-evolution moves). Uniform rules; nothing mon-specific. Profiles
  // built by the optimizer carry frictionCost; the fallback recomputes the
  // evolution-chain friction for profiles built elsewhere (display paths).
  const friction =
    (legalityProfile?.frictionCost ??
      evolutionChainProof(legalityProfile?.currentId).friction) *
    tunable("FRICTION_SCALE");

  // If the caught mon's ability is unknown and the sweep asks "what if it has the
  // secondary ability?", subtract the build's measured sensitivity (V under
  // primary minus V under secondary, damage-derived; 0 when ability is known or
  // the build is ability-insensitive).
  const abilityPenalty =
    tunable("ABILITY_ASSUMPTION") === "secondary"
      ? Math.max(0, legalityProfile?.abilitySensitivity || 0)
      : 0;

  const value =
    currentValue + usagePull + biasScore - friction - abilityPenalty;

  const meaningfulUsage =
    (usagePercent >= MIN_MEANINGFUL_USAGE_PERCENT && online >= onlineFloor) ||
    biasScore >= tunable("BIAS_MEANINGFUL_THRESHOLD");

  return {
    score: value,
    teamScore: value,
    legalityScore: currentValue,
    biasScore,
    ceiling,
    online,
    futureValue,
    friction,
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
    Math.log1p(Math.max(0, rank.value)) /
      Math.log1p(tunable("USAGE_REF_PERCENT")),
  );
  const tierWeight = tunable("USAGE_TIER_WEIGHT");
  const combined = tierWeight * tierNorm + (1 - tierWeight) * usageNorm;
  return CURRENT_VALUE_SCALE * Math.max(0, Math.min(1, combined));
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
    if (defense === 0) score += level * tunable("BIAS_IMMUNE_PER_LEVEL");
    else if (defense < 1) score += level * tunable("BIAS_RESIST_PER_LEVEL");
    else if (defense > 1)
      score -= level * tunable("BIAS_WEAK_PENALTY_PER_LEVEL");

    const hitsSuperEffectively = attackTypes.some(
      (attackType) => getTypeMultiplier(attackType, [type]) > 1,
    );
    if (hitsSuperEffectively) score += level * tunable("BIAS_OFFENSE_PER_LEVEL");
  }

  return score;
}

// The online/readiness gate O: role-online, from concrete facts. A pre-evo that
// can't deal stage-real damage is a baby regardless of bulk or its final form's
// fame; one that already has most of the final form's key stats is near-final.
// ONLINE_JITTER (sweep axis) shifts every non-final judgement one category, so
// the confidence layer can ask "what if my gate calls are one notch off?".
function getReadinessGate(profile, features) {
  const currentId = profile?.currentId;
  const representativeId = profile?.representativeId;
  if (!currentId || !representativeId || currentId === representativeId) {
    return ONLINE_FINAL;
  }
  if ((profile?.legalMoveCount || 0) === 0) return ONLINE_DEAD;

  const ladder = [
    tunable("ONLINE_BABY"),
    tunable("ONLINE_MIDEVO"),
    tunable("ONLINE_NEAR"),
  ];
  let step;
  if (
    (features?.damage_q ?? 0) < tunable("ACT_FLOOR") ||
    (profile?.legalDamagingMoveCount || 0) === 0
  ) {
    step = 0; // baby: can't act at this stage
  } else {
    const readiness = formReadinessRatio(currentId, representativeId);
    step = readiness >= tunable("NEAR_FINAL_RATIO") ? 2 : 1;
  }
  const jitter = tunable("ONLINE_JITTER") | 0;
  step = Math.max(0, Math.min(ladder.length - 1, step + jitter));
  return ladder[step];
}

// Score-first, no boolean gates. `meaningfulUsage` used to be the primary key
// and that made usage SOVEREIGN over the whole value model (invariant 1
// violation) — measured: Kadabra outscored Alakazam 1681 vs 1398 (Link Stone
// friction exceeding the stage-compressed C gap), and the boolean silently
// seated Alakazam anyway because 0.13% usage cleared the old bar while
// Kadabra's 0.002% didn't. Usage already speaks inside score (U, bias);
// here it only breaks exact ties.
export function compareScoredCandidates(a, b) {
  return (
    b.score - a.score ||
    (b.usagePercent || 0) - (a.usagePercent || 0) ||
    (b.rawCount || 0) - (a.rawCount || 0) ||
    a.candidate.name.localeCompare(b.candidate.name)
  );
}
