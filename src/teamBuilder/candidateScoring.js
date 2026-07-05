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
  // SCORING_V1: the line-anchored usage trust (see comment at the use site).
  lineRamp = null,
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

  // --- SCORING_V1 (usage-convergence blend, Phase 2) ------------------------
  // w ramps with how far the canonical competitive set is toward complete.
  // `lineRamp` (the optimizer's line-anchored w — computed from the LINE's
  // representative, the form with the best first-meaningful tier) is the
  // authoritative source: every form in a line blends under the SAME w
  // against its OWN prior, so a lesser line-mate can't dodge the endgame
  // drag the real form is subject to (user report: base Doduo outseated
  // Dodrio by keeping its raw C while Dodrio converged to its NU prior).
  // Callers without line context (display paths) fall back to this form's
  // own ramp.
  const model = tunable("USAGE_MODEL");
  const ramp =
    model === "v1"
      ? lineRamp != null
        ? lineRamp
        : computeUsageRamp(legalityProfile, levelCap)
      : 0;

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

  // V0: V = C + α·O·[U−C]₊ + bias − K (usage upside-only, friction always).
  // V1 generalizes it: the α·O floor stays upside-only, but the EARNED part of
  // w (the ramp) blends fully — it can drag an over-performing C down toward
  // the usage prior, and it melts friction/ability caution away, so at
  // w_down = 1 the score IS the usage prior (+ bias):
  //   V1 = C + w_up·[U−C]₊ − w_down·[C−U]₊ + bias − (1−w_down)·(K + ability)
  // At ramp = 0 this is exactly the V0 shape (with U redefined to the
  // tier-dominant rank scalar).
  let value;
  let usageWeight = 0;
  if (model === "v1") {
    const uRank = usageRankScore(rank, currentValue);
    const wUp = Math.max(alpha * online, ramp);
    const wDown = ramp;
    usageWeight = wDown;
    value =
      currentValue +
      wUp * Math.max(0, uRank - currentValue) -
      wDown * Math.max(0, currentValue - uRank) +
      biasScore -
      (1 - wDown) * (friction + abilityPenalty);
  } else {
    value = currentValue + usagePull + biasScore - friction - abilityPenalty;
  }

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
    // First-meaningful-tier rank (lower = shallower tier), for consumers that
    // need the usage-prior ordering itself (V1 convergence tests, displays).
    tierRank: rank.tierRank,
    // V1 only: how much of the score is the usage prior (0 = pure V0 shape,
    // 1 = fully converged). Exposed for the convergence/monotonicity tests
    // and the explanation layer; always 0 under V0.
    usageWeight,
  };
}

// SCORING_V1's w before the α·O floor:
//   ramp = O_rep · min((cap/L*)^k, r_now)
// O_rep: only a fielded form that IS this profile's usage representative can
// ramp — the usage prior describes THAT form; a deliberately unevolved
// pre-evo keeps the V0 α·O treatment. L* comes from the Phase 1 readiness
// schedule; r_now (canonical moves actually assembled) caps it so "reachable
// but not picked up yet" never scores as done. Items influence w only through
// L* — endgame items are purchasable at will, so an unowned Eviolite must not
// hold w below 1 at cap 100.
export function computeUsageRamp(legalityProfile, levelCap) {
  const readiness = legalityProfile?.setReadiness || null;
  const isRepresentativeForm =
    !legalityProfile?.representativeId ||
    legalityProfile?.currentId === legalityProfile?.representativeId;
  if (!readiness || !isRepresentativeForm) return 0;

  const cap = Math.max(1, Math.min(100, levelCap || 0));
  const lStar = readiness.fullAtCap;
  const schedule =
    lStar == null
      ? 1
      : Math.min(1, Math.pow(cap / lStar, tunable("USAGE_RAMP_EXPONENT")));
  const totalMoves = readiness.moves?.length || 0;
  const rNow = totalMoves ? (readiness.readyMoveCount || 0) / totalMoves : 0;
  return Math.min(schedule, rNow);
}

// SCORING_V1's U: a tier-dominant rank scalar on C's scale (user design).
//   U_rank = TIER_STEP·tierIndex + quantize(usage%) + ε·C
// TIER_STEP (101) strictly exceeds any usage %, so a shallower
// first-meaningful tier ALWAYS dominates within-tier usage; usage is
// quantized so ε·C (bounded below the quantum by a tested invariant) can
// only break exact ties. Monotonically rescaled onto CURRENT_VALUE_SCALE —
// any monotone rescale preserves the ordering guarantees.
export function usageRankScore(rank, currentValue = 0) {
  const totalTiers = Math.max(1, rank.totalTiers || 1);
  const tierIndex = Math.max(0, totalTiers - rank.tierRank);
  const quantum = tunable("USAGE_QUANTUM");
  const usageQuantized =
    Math.floor(Math.max(0, rank.value || 0) / quantum) * quantum;
  const step = tunable("TIER_STEP");
  const raw =
    step * tierIndex +
    usageQuantized +
    tunable("EPSILON_C") * Math.max(0, currentValue);
  const rawMax = step * (totalTiers + 1);
  return CURRENT_VALUE_SCALE * (raw / rawMax);
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
