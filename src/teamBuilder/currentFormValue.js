// Current-form usefulness (the C term of the individual value model): how good is
// the form you can actually field RIGHT NOW at doing its ONE best job.
//
// Built from a small set of mechanical, stage-relative features — not a sprawling
// role junk drawer and not raw peak damage (which is blind to speed, bulk, and
// role). The features are observations; only a handful of role combines carry any
// judgement:
//
//   damage_q   how hard it hits now, vs a stage-typical strong hit
//   speed_q    base Speed percentile across the whole species dex
//   bulk_q     HP+Def+SpD percentile across the whole species dex
//   reliability_q  does it have a functional attacking kit (a few real options)
//   utility_q  status/priority access (coarse — the move data has only a boolean
//              utility flag, no recovery/setup/hazard tags)
//
// Then a few role scores (geometric means, so a role needs ALL its axes) and
// C = max(role). A fast frail attacker, a bulky pivot, and a hard hitter each get
// a legitimate route to a high C.
//
// Percentiles are taken against the FULL dex, never within the (possibly weak)
// input pool — otherwise the best trash becomes king of the dump. damage_q is the
// stage-relative axis: it scales with the level cap via the damage estimate.

import {
  GEN7_BASE_STATS,
  GEN7_BASE_STAT_TOTALS,
} from "../generated/gen7BaseStats.generated.js";

// Points scale for C; shared with the usage ceiling U so the two are directly
// comparable (see candidateScoring).
export const CURRENT_VALUE_SCALE = 2000;

function statsOf(id) {
  return GEN7_BASE_STATS[id] || null; // [Atk, Def, SpA, SpD, Spe]
}
function hpOf(id) {
  const total = GEN7_BASE_STAT_TOTALS[id];
  const s = statsOf(id);
  if (total == null || !s) return null;
  return total - (s[0] + s[1] + s[2] + s[3] + s[4]);
}
function speedOf(id) {
  return statsOf(id)?.[4] ?? null;
}
function bulkOf(id) {
  const s = statsOf(id);
  const hp = hpOf(id);
  if (!s || hp == null) return null;
  return hp + s[1] + s[3]; // HP + Def + SpD
}
function mainAttackOf(id) {
  const s = statsOf(id);
  return s ? Math.max(s[0], s[2]) : null; // better of Atk / SpA
}

// Reference distributions for stage-independent stat percentiles, built once.
function buildSorted(fn) {
  const arr = [];
  for (const id of Object.keys(GEN7_BASE_STATS)) {
    const v = fn(id);
    if (v != null) arr.push(v);
  }
  arr.sort((a, b) => a - b);
  return arr;
}
const SPEED_REF = buildSorted(speedOf);
const BULK_REF = buildSorted(bulkOf);

// Fraction of the dex with a value <= this one (0..1).
function percentile(value, sorted) {
  if (value == null || !sorted.length) return 0;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo / sorted.length;
}

// A stage-typical strong hit: what a neutral base-100 attacker does with a 90-BP
// STAB move at this level cap, using the same core math as the damage estimator
// (base-70 reference defender). damage_q divides the mon's best hit by this, so
// "hits hard" is judged against the current stage rather than an absolute bar.
function stageReferenceDamage(levelCap) {
  const lvl = Math.max(1, Math.min(100, levelCap || 50));
  const statAt = (base) => Math.floor((2 * base * lvl) / 100) + 5;
  // A genuinely strong attacker (base-115 offense, 100-BP STAB) as the "1.0" bar,
  // so damage_q spreads instead of clumping high — a mediocre hit reads as
  // mediocre, not near-max.
  const atk = statAt(115);
  const def = statAt(70);
  const base =
    Math.floor(Math.floor(((2 * lvl) / 5 + 2) * 100 * atk) / def / 50) + 2;
  return base * 1.5; // STAB
}

function geomean(values) {
  let product = 1;
  for (const v of values) {
    if (v <= 0) return 0; // a role needs all its axes; a zero axis kills it
    product *= v;
  }
  return Math.pow(product, 1 / values.length);
}
const clamp01 = (x) => Math.max(0, Math.min(1, x));

// The five features for the fielded form, all in [0,1].
export function currentFormFeatures(profile, levelCap) {
  const currentId = profile?.currentId;

  const bestDamage = Math.max(
    profile?.bestStabMove?.estimatedDamage || 0,
    profile?.bestDamagingMove?.estimatedDamage || 0,
  );
  const damage_q = clamp01(bestDamage / stageReferenceDamage(levelCap));

  const speed_q = percentile(speedOf(currentId), SPEED_REF);
  const bulk_q = percentile(bulkOf(currentId), BULK_REF);

  // Functional attacking kit: a couple of real damaging options.
  const damagingOptions = profile?.recommendedDamagingMoveCount || 0;
  const reliability_q = clamp01((damagingOptions + 1) / 4);

  // Coarse utility: status moves + priority attackers in the recommended set.
  const moves = profile?.recommendedMoves || [];
  let utilityCount = 0;
  for (const move of moves) {
    if (move.category === "Status") utilityCount += 1;
    else if ((move.priority || 0) > 0) utilityCount += 1;
  }
  const utility_q = clamp01(utilityCount / 3);

  return { damage_q, speed_q, bulk_q, reliability_q, utility_q };
}

// C = max over a few mechanically-derived roles. Returns the score in points plus
// the breakdown, for instrumentation.
export function currentFormValue(profile, levelCap) {
  if (!profile) {
    return { value: 0, bestRole: "none", features: {}, roles: {} };
  }
  const f = currentFormFeatures(profile, levelCap);

  // A utility mon still has to threaten something — otherwise it's passive and
  // gets walled for free. This floor gates the utility roles by damage.
  const nonPassive = clamp01(f.damage_q / 0.25);

  // reliability_q is deliberately NOT a role axis: with the available move data it
  // saturates to ~1 for almost everyone (every mon has a few damaging moves), so
  // it only inflates every score, and accuracy — the part that would discriminate
  // — is already folded into damage_q by the damage estimate. Kept in features for
  // display, unused here.
  const roles = {
    fast_attacker: geomean([f.damage_q, f.speed_q]),
    bulky_attacker: geomean([f.damage_q, f.bulk_q]),
    bulky_utility: geomean([f.bulk_q, f.utility_q, nonPassive]),
    fast_utility: geomean([f.speed_q, f.utility_q, nonPassive]),
  };

  let bestRole = "fast_attacker";
  let best = 0;
  for (const [role, score] of Object.entries(roles)) {
    if (score > best) {
      best = score;
      bestRole = role;
    }
  }

  return {
    value: CURRENT_VALUE_SCALE * best,
    bestRole,
    features: f,
    roles,
  };
}

// Fraction of the represented final form's key attributes the fielded form
// already has — the best of its offense / bulk / speed ratios. Used only to
// bucket the readiness gate (near-final vs mid-evo), so an OFFENSIVE line that's
// nearly ready on offense counts as near-final even if it never gets bulky.
export function formReadinessRatio(currentId, representativeId) {
  const ratios = [
    ratio(mainAttackOf(currentId), mainAttackOf(representativeId)),
    ratio(bulkOf(currentId), bulkOf(representativeId)),
    ratio(speedOf(currentId), speedOf(representativeId)),
  ].filter((r) => r != null);
  if (!ratios.length) return 1;
  return Math.max(...ratios);
}
function ratio(a, b) {
  if (a == null || b == null || !b) return null;
  return Math.min(1, a / b);
}
