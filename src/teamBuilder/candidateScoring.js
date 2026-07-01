import { GEN7_BASE_STAT_TOTALS, GEN7_BASE_STATS } from "../generated/gen7BaseStats.generated.js";
import { getTypeMultiplier } from "../reborn/typeChart.js";

export const MIN_MEANINGFUL_USAGE_PERCENT = 0.1;

// ---------------------------------------------------------------------------
// Individual value model.
//
// A pick is judged mostly by what the form you can actually field does RIGHT NOW
// (its real stats, its real legal moves at this progression) — computed with no
// reference to competitive usage. Competitive usage is only a prior that pulls
// that honest current judgement toward the fully-evolved line's ceiling, and
// only to the extent the fielded form actually resembles that ceiling form:
//
//     V = C + α·O·[U − C]₊ + F − K
//
//   C  current-form usefulness (legality/combat score; usage-independent)
//   U  the line's competitive ceiling, from usage/tier, in the same units as C
//   O  online/readiness gate in [0,1]: how much the fielded form resembles the
//      final competitive form (1 = you ARE it, ~0 = a baby that only promises it)
//   α  how much competitive usage is allowed to matter, even when fully online
//   F  small, capped near-future option value (evolves into something better soon)
//   K  investment friction (grinding / rare items) — reserved, 0 for now
//
// The [U − C]₊ (positive part) makes usage upside-only: it can lift a pre-evo
// toward its famous ceiling, but never drag down a mon that is already doing a
// better job right now than its competitive reputation suggests (the reliable
// early-game workhorses). Because the pull is gated by O, a high ceiling cannot
// carry a body that can't yet express it — Greninja's reputation barely reaches
// Frogadier and doesn't reach Happiny-via-Chansey at all.
//
// These are the only tunable *preferences* (everything feeding C/U/O is a
// mechanical observation, not a knob). Overridable via globalThis for tuning.
const USAGE_INFLUENCE = 0.3; // α — usage informative but never sovereign (≤ ~0.35)

// The competitive ceiling U, in the same points as the legality/combat score C.
// All ~40 usage buckets (formats × skill cutoffs) collapse into one [0,1] number:
// a shallow (high-prestige) tier and higher usage both push it up. Then it's
// scaled into combat-score points. USAGE_CEILING is roughly the combat score of a
// strong current attacker, so a top-of-the-metagame line can pull a fully-online
// mon up to about that, and no further.
const USAGE_CEILING = 2000;
const USAGE_TIER_WEIGHT = 0.6; // ceiling leans on tier prestige over raw usage %
const USAGE_REF_PERCENT = 20; // usage % at which the usage component saturates

// Near-future option value: a usable pre-evo of a higher-ceiling line gets a
// small, capped credit for the upside it's about to reach. Capped hard so
// "eventually becomes great" can never outweigh "useful now" — a promise is not a
// starter. Gated on being at least a coherent mid-evo (O ≥ ONLINE_FLOOR) so a
// baby that can't function now earns no speculative credit either.
const FUTURE_WEIGHT = 0.35;
const FUTURE_CAP = 300;

// Readiness gate O — coarse and inspectable, from concrete facts, not a fitted
// curve. A pre-evo drops to the "baby / incoherent" level when it can't deal real
// damage now, regardless of how bulky it looks or how famous its final form is.
const ONLINE_FINAL = 1.0; // you are fielding the competitive form itself
const ONLINE_NEAR = 0.65; // near-final: keeps most of the final form's bulk
const ONLINE_MIDEVO = 0.35; // a usable mid-evo with coherent stats + moves
const ONLINE_BABY = 0.1; // can't meaningfully act yet; mostly future promise
const ONLINE_DEAD = 0.0; // no legal moves at all
const ONLINE_FLOOR = ONLINE_MIDEVO; // "online enough" for usage credit / future
const NEAR_FINAL_BULK_RATIO = 0.85; // fielded bulk this close to final ⇒ near-final
const COHERENT_DAMAGE_FLOOR = 20; // best damaging move below this ⇒ can't act

// Per bias level (1..6), how much preparedness against a biased opponent type is
// worth. Resisting/being immune to it (you survive its STAB) and hitting it
// super-effectively (you can KO it) are both rewarded; being weak to it is
// penalised. Added straight onto the honest current-form value, since it reflects
// the form you actually field.
const BIAS_RESIST_PER_LEVEL = 90;
const BIAS_IMMUNE_PER_LEVEL = 130;
const BIAS_WEAK_PENALTY_PER_LEVEL = 70;
const BIAS_OFFENSE_PER_LEVEL = 90;

// A strong enough answer to a biased opponent type reads as "meaningful" even at
// trace usage, so a dedicated counter can still earn a slot.
const BIAS_MEANINGFUL_THRESHOLD = 270;

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

  // C — current-form usefulness, from the fielded form's real combat ability. No
  // usage in here: this is "how good is the thing I can put on the field today".
  const currentValue = scoreLegalityProfile(legalityProfile);

  // U — the line's competitive ceiling, derived from usage/tier, in C's units.
  const ceiling = usageCeiling(rank);

  // O — how much the fielded form resembles the ceiling form.
  const online = getReadinessGate(legalityProfile);

  // Usage pulls the current judgement toward the ceiling, gated by O and capped by
  // α, and only ever upward (a mon already better than its reputation keeps its
  // current value).
  const headroom = Math.max(0, ceiling - currentValue);
  const usagePull = USAGE_INFLUENCE * online * headroom;

  // F — capped near-future option value for a usable pre-evo of a higher line.
  const futureValue =
    online >= ONLINE_FLOOR && online < ONLINE_FINAL
      ? Math.min(FUTURE_CAP, FUTURE_WEIGHT * (1 - online) * headroom)
      : 0;

  // Bias reflects the form you actually field, so it's added to the honest value.
  const biasScore = scoreOpponentTypeBias(opponentTypeBias, legalityProfile);

  // K — investment friction. Reserved for a later pass; 0 today.
  const friction = 0;

  const value =
    currentValue + usagePull + futureValue - friction + biasScore;

  const meaningfulUsage =
    (usagePercent >= MIN_MEANINGFUL_USAGE_PERCENT && online >= ONLINE_FLOOR) ||
    biasScore >= BIAS_MEANINGFUL_THRESHOLD;

  return {
    // score (per-mon ranking: which form represents a line, bench ordering) and
    // teamScore (summed by team selection) are the same value now — one honest
    // axis, with coverage handled at the team level.
    score: value,
    teamScore: value,
    legalityScore: currentValue,
    biasScore,
    ceiling,
    online,
    futureValue,
    meaningfulUsage,
    usagePercent,
    rawCount,
    leadPercent,
  };
}

// Collapses the ~40 usage buckets into one competitive-ceiling number, in the
// same points as the current-form combat score. A shallow (high-priority) tier
// and higher usage both push it up; a mon that only shows up deep in the ladder
// lands low, and a never-used mon lands at ~0.
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

// The online/readiness gate O: coarse, ordinal, and driven by concrete facts
// about the fielded form. A pre-evo that can't deal real damage now is a baby no
// matter how bulky it is or how famous its final form is (this is what keeps
// Happiny — valued via Chansey — from riding a high ceiling); a pre-evo that
// already carries most of its final form's bulk and can fight is near-final.
function getReadinessGate(profile) {
  const currentId = profile?.currentId;
  const representativeId = profile?.representativeId;
  // Fielding the competitive form itself (or no line info): fully online.
  if (!currentId || !representativeId || currentId === representativeId) {
    return ONLINE_FINAL;
  }

  if ((profile?.legalMoveCount || 0) === 0) return ONLINE_DEAD;

  // Can it deal meaningful damage at this progression? This — not raw bulk — is
  // what separates a usable mid-evo from a baby that only promises its final form.
  const bestDamage = Math.max(
    profile?.bestStabMove?.estimatedDamage || 0,
    profile?.bestDamagingMove?.estimatedDamage || 0,
  );
  if (
    bestDamage < COHERENT_DAMAGE_FLOOR ||
    (profile?.legalDamagingMoveCount || 0) === 0
  ) {
    return ONLINE_BABY;
  }

  // Coherent attacker: grade by how much of the final form's bulk it already has.
  const bulkRatio = bulkReadiness(currentId, representativeId);
  return bulkRatio >= NEAR_FINAL_BULK_RATIO ? ONLINE_NEAR : ONLINE_MIDEVO;
}

// Fraction of the represented final form's non-attacking bulk (BST minus the two
// attacking stats) that the fielded form already has. Used only to bucket the
// readiness gate, never as a continuous multiplier.
function bulkReadiness(currentId, representativeId) {
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

// C — current-form combat usefulness: how well the fielded form does its ONE best
// job at this progression, from its real moves and the stats behind them (damage
// estimates are category/stat-aware). No usage/tier here.
//
// This deliberately rewards PEAK output (best STAB, best damaging move) and a
// functional attacking kit, NOT breadth. Number-of-attack-types and SE-target
// breadth are left out on purpose: coverage is scored once, at the team level
// (fastTeamFit), so rewarding it again per-mon double-counts it and inflates
// wide-but-weak gimmick mons (a Beautifly with many feeble move types) over a
// focused hard-hitter. A mon only needs to be good at one thing.
function scoreLegalityProfile(profile) {
  if (!profile) return 0;

  const bestStabPower = profile.bestStabMove?.estimatedDamage || 0;
  const bestDamagePower = profile.bestDamagingMove?.estimatedDamage || 0;
  const selectedMoveCount = profile.recommendedMoves?.length || 0;
  const selectedDamagingCount = profile.recommendedDamagingMoveCount || 0;

  // Peak offensive output — the mon's best single job.
  const peak =
    Math.min(180, bestStabPower) * 12 + Math.min(160, bestDamagePower) * 5;

  // A functional attacking kit: a few real options and enough legal damaging
  // moves to actually operate. Reliability, not coverage breadth.
  const reliability =
    Math.min(4, selectedDamagingCount) * 45 +
    Math.min(4, selectedMoveCount) * 15 +
    Math.min(6, profile.legalDamagingMoveCount) * 10;

  return (
    peak +
    reliability +
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
