import { getTypeMultiplier } from "../reborn/typeChart.js";
import { evolutionChainProof } from "../reborn/evolutionRequirements.js";
import { GEN7_PROGRESSION_SPECIES } from "../generated/gen7ProgressionSpecies.generated.js";
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
// Individual value model (the usage-convergence blend, formerly SCORING_V1 —
// the sole model since V0's retirement; see SCORING.md):
//
//     V = C + w_up·[U_rank − C]₊ − w_down·[C − U_rank]₊ + bias
//         − (1 − w_down)·(K + ability)          (F is computed but NOT spent)
//
//   C       current-form usefulness (currentFormValue.js) — role-based, stage-
//           relative, usage-independent. On a [0, CURRENT_VALUE_SCALE] scale.
//   U_rank  the usage prior as a tier-dominant rank scalar on C's scale.
//   w_up    max(α·O, ramp) — upward convergence is FULL trust: presence of
//           usage transfers across the PvP→PvE domain gap (it proves the
//           body performs somewhere), so a famous line converges all the
//           way up to its prior.
//   w_down  two-clause law (user-ratified; the calibration corpus's Meowstic
//           trajectory 1543 → 587 is the measured counterexample that killed
//           the old "at w = 1 the score IS the prior" law):
//           - ABSENCE law (dead lines): a line with no meaningful usage in
//             ANY tier converges fully — w_down = ramp. Absence everywhere
//             is the one usage signal strong enough to override the
//             mechanical model (it is domain-transferable: thousands of
//             players found nothing).
//           - BOUNDED-TRUST law (present priors): a line with real
//             competitive presence anywhere has its downward trust capped —
//             w_down = min(ramp, PRIOR_DRAG_CAP) — so the prior may claim at
//             most that fraction of the mon's measured excess, no matter how
//             converged. The MAGNITUDE of a deep prior is meta-confounded
//             for PvE; set-completion cannot shrink that domain error.
//           At ramp = 0 both clauses reduce to the historic V0 shape:
//           C + α·O·[U − C]₊ + bias − K.
//   O       online/readiness gate in [0,1]: how much the fielded form
//           resembles the final competitive form.
//   K       build friction (delayed-evolution builds); acquisition friction
//           defaults to 0 — see SCORING.md "Acquisition friction zeroed".
//
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
  // The line-anchored usage trust (see comment at the use site).
  lineRamp = null,
  // Whether ANY form of this line has real competitive evidence (a meaningful
  // rank or sustained shallow-format trace) — selects between the absence law
  // and the bounded-trust law. Callers without line context use this bundle.
  linePriorPresent = null,
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

  // Ceiling — a smooth tier+usage blend on C's scale. Not part of V (U_rank
  // is the scored prior); it feeds the display-only future value below and
  // is surfaced per candidate for the investment/explanation layers.
  const ceiling = usageCeiling(rank);

  // O — how much the fielded form resembles the ceiling form.
  const online = getReadinessGate(legalityProfile, current.features);

  const alpha = tunable("USAGE_INFLUENCE");
  const headroom = Math.max(0, ceiling - currentValue);

  // w ramps with how far the canonical competitive set is toward complete.
  // `lineRamp` (the optimizer's line-anchored w — computed from the LINE's
  // representative, the form with the best first-meaningful tier) is the
  // authoritative source: every form in a line blends under the SAME w
  // against its OWN prior, so a lesser line-mate can't dodge the endgame
  // drag the real form is subject to (user report: base Doduo outseated
  // Dodrio by keeping its raw C while Dodrio converged to its NU prior).
  // Callers without line context (display paths) fall back to this form's
  // own ramp.
  const ramp =
    lineRamp != null ? lineRamp : computeUsageRamp(legalityProfile, levelCap);

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
      evolutionChainProof(
        legalityProfile?.fieldedId || legalityProfile?.currentId,
      ).friction) *
    tunable("FRICTION_SCALE");

  // If the caught mon's ability is unknown and the sweep asks "what if it has the
  // secondary ability?", subtract the build's measured sensitivity (V under
  // primary minus V under secondary, including damage and priority utility;
  // 0 when ability is known or the build is ability-insensitive).
  const abilityPenalty =
    tunable("ABILITY_ASSUMPTION") === "secondary"
      ? Math.max(0, legalityProfile?.abilitySensitivity || 0)
      : 0;

  // The α·O floor stays upside-only; the earned ramp lifts at full trust.
  // Downward, the two-clause law applies (see the header): dead lines
  // converge fully toward their ~zero prior; present-prior lines keep at
  // least (1 − PRIOR_DRAG_CAP) of C at every w.
  const uRank = usageRankScore(rank, currentValue);
  const priorPresent =
    linePriorPresent != null
      ? linePriorPresent
      : hasCompetitivePriorEvidence(
          bundle,
          formatOrder,
          cutoffPriority,
        );
  const wUp = Math.max(alpha * online, ramp);
  const wDown = priorPresent
    ? Math.min(ramp, tunable("PRIOR_DRAG_CAP"))
    : ramp;
  // Exposed trust is the RAMP (how much instance evidence has accrued);
  // the drag applied is wDown, which the bounded-trust law may cap below it.
  const usageWeight = ramp;
  const value =
    currentValue +
    wUp * Math.max(0, uRank - currentValue) -
    wDown * Math.max(0, currentValue - uRank) +
    biasScore -
    (1 - wDown) * (friction + abilityPenalty);

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
    // need the usage-prior ordering itself (convergence tests, displays).
    tierRank: rank.tierRank,
    // The earned usage trust (the ramp): 0 = pure C shape, 1 = full instance
    // evidence. NOTE: since the two-clause law, this is NOT the applied
    // downward weight — present-prior lines cap that at PRIOR_DRAG_CAP.
    // Exposed for the convergence/monotonicity tests, the usage-trust
    // tooltip, and the explanation layer.
    usageWeight,
  };
}

// The usage trust w before the α·O floor:
//   ramp = O_rep · min((cap/L*)^k, r_now)
// O_rep: only a fielded form that IS this profile's usage representative can
// ramp — the usage prior describes THAT form; a deliberately unevolved
// pre-evo keeps the upside-only α·O treatment. L* comes from the Phase 1 readiness
// schedule; r_now (canonical moves actually assembled) caps it so "reachable
// but not picked up yet" never scores as done. Items influence w only through
// L* — endgame items are purchasable at will, so an unowned Eviolite must not
// hold w below 1 at cap 100.
// The id the player actually FIELDS to express an archetype: a mega
// representative is fielded by fielding its BASE form (the mega happens in
// battle, and currentSpecies never walks onto mega ids). Readiness — both O
// and the w ramp — must judge the fielded form against this, or a
// mega-anchored archetype reads as perpetually "near-final" (never online,
// never converging) even when the base form is in hand.
export function fieldableRepresentativeId(representativeId) {
  if (!representativeId) return representativeId;
  const record = GEN7_PROGRESSION_SPECIES[representativeId];
  return record?.isMega ? record.baseSpeciesId || representativeId : representativeId;
}

export function computeUsageRamp(legalityProfile, levelCap) {
  const readiness = legalityProfile?.setReadiness || null;
  const representativeId = legalityProfile?.representativeId;
  const fieldedId = legalityProfile?.fieldedId || legalityProfile?.currentId;
  const isRepresentativeForm =
    !representativeId ||
    fieldedId === fieldableRepresentativeId(representativeId);
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

// U_rank: a tier-dominant rank scalar on C's scale (user design).
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

// Competitive evidence used only to select the downward-trust law. A ranked
// row is already meaningful. Below that bar, sustained trace usage in one of
// the ordered ladder's first few formats is enough to reject "absence
// everywhere" without manufacturing a rank from noisy tail data.
export function hasCompetitivePriorEvidence(
  bundle,
  formatOrder = [],
  cutoffPriority = [],
) {
  const rank = getUsageRanking(bundle, formatOrder, cutoffPriority);
  if (rank.tierRank < rank.totalTiers) return true;

  const trace = bundle?.trace;
  if (
    !trace ||
    Math.max(0, trace.value || 0) <
      tunable("SHALLOW_TRACE_PRIOR_MIN_PERCENT")
  ) {
    return false;
  }
  const formatIndex = formatOrder.indexOf(trace.formatId);
  return (
    formatIndex >= 0 &&
    formatIndex < tunable("SHALLOW_TRACE_PRIOR_FORMAT_DEPTH")
  );
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
  const currentId = profile?.fieldedId || profile?.currentId;
  const representativeId = profile?.representativeId;
  // Match against the FIELDABLE representative (mega → base): a base form in
  // hand that megas in battle IS the competitive object, so it is online,
  // not merely near-final. Consistent with computeUsageRamp.
  if (
    !currentId ||
    !representativeId ||
    currentId === fieldableRepresentativeId(representativeId)
  ) {
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
