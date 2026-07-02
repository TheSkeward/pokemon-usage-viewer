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
import { GEN7_PROGRESSION_SPECIES } from "../generated/gen7ProgressionSpecies.generated.js";
import { SCORING_DEFAULTS, tunable } from "./scoringConstants.js";

// Points scale for C; shared with the usage ceiling U so the two are directly
// comparable (see candidateScoring). Not sweepable — it defines the scale the
// other judgements are expressed in.
export const CURRENT_VALUE_SCALE = SCORING_DEFAULTS.CURRENT_VALUE_SCALE;

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
// Effective bulk is multiplicative (HP × defensive stat), scored per side so a
// one-sided wall can't hide a fake defence behind a real one — Happiny's SpD 65
// must not launder its Def 5.
function physBulkOf(id) {
  const s = statsOf(id);
  const hp = hpOf(id);
  if (!s || hp == null) return null;
  return hp * s[1]; // HP × Def
}
function specBulkOf(id) {
  const s = statsOf(id);
  const hp = hpOf(id);
  if (!s || hp == null) return null;
  return hp * s[3]; // HP × SpD
}
// Combined bulk (used to bucket readiness): the whole non-attacking mass.
function bulkOf(id) {
  const s = statsOf(id);
  const hp = hpOf(id);
  if (!s || hp == null) return null;
  return hp + s[1] + s[3];
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
const PHYS_BULK_REF = buildSorted(physBulkOf);
const SPEC_BULK_REF = buildSorted(specBulkOf);

// R_cap: the forms plausibly reachable by the current level cap, so an early
// workhorse is ranked against what it actually competes with, not the full dex
// of late-game evolutions and legendaries. A form is reachable if its whole
// evolution chain is satisfiable — level steps at or below the cap; friendship/
// item steps assumed grindable. Percentiles blend global and R_cap 50/50 so the
// reference shifts with progression without lurching. Reference arrays cached
// per cap (built at most once each).
function reachableByCap(id, cap) {
  const s = GEN7_PROGRESSION_SPECIES[id];
  if (!s || !s.prevoId) return true; // base form / unknown: always available
  if (s.evoLevel != null && s.evoLevel > cap) return false; // level evo above cap
  return reachableByCap(s.prevoId, cap);
}
const capRefCache = new Map();
function capRefs(levelCap) {
  const cap = Math.max(1, Math.min(100, levelCap || 100));
  let refs = capRefCache.get(cap);
  if (!refs) {
    const ids = Object.keys(GEN7_BASE_STATS).filter((id) =>
      reachableByCap(id, cap),
    );
    const sortedFrom = (fn) => {
      const arr = [];
      for (const id of ids) {
        const v = fn(id);
        if (v != null) arr.push(v);
      }
      arr.sort((a, b) => a - b);
      return arr;
    };
    refs = {
      speed: sortedFrom(speedOf),
      phys: sortedFrom(physBulkOf),
      spec: sortedFrom(specBulkOf),
    };
    capRefCache.set(cap, refs);
  }
  return refs;
}
// Percentile blended between the full dex and the reachable-at-cap set.
function stagePercentile(value, globalRef, capRef) {
  const blend = tunable("REACHABLE_BLEND");
  return (
    (1 - blend) * percentile(value, globalRef) +
    blend * percentile(value, capRef)
  );
}

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
export function stageReferenceDamage(levelCap) {
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

// How much each utility role is worth as team infrastructure. Recovery / hazards /
// speed control / setup are real jobs; a lone status or priority tag is minor.
const ROLE_WEIGHTS = {
  recovery: 1.0,
  hazard_set: 0.9,
  speed_control: 0.8,
  setup: 0.7,
  pivot: 0.7,
  hazard_remove: 0.7,
  phazing: 0.6,
  screen: 0.6,
  disruption: 0.6,
  status: 0.4,
  priority: 0.4,
};

// Summed utility value of a recommended set: each move contributes its best
// role's weight, scaled by hit rate. Saturated by the caller. Exported as a
// MECHANICAL fact (fixed role weights, no sweepable constants) for build
// dominance pruning.
export function utilityValue(recommendedMoves) {
  let total = 0;
  for (const move of recommendedMoves || []) {
    let best = 0;
    for (const role of move.roles || []) {
      best = Math.max(best, ROLE_WEIGHTS[role] || 0);
    }
    if (best > 0) total += best * ((move.accuracy ?? 100) / 100);
  }
  return total;
}

// The five features for the fielded form, all in [0,1].
export function currentFormFeatures(profile, levelCap) {
  const currentId = profile?.currentId;

  // Offensive quality is mostly the PEAK hit (an attacker's one job) plus a small,
  // capped portfolio term — its 2nd/3rd best attacks — so a one-strong-move mon
  // that's hard-walled scores a touch below a mon with real secondary threats.
  // This is a narrow anti-wall measure, NOT per-type breadth spam: it's the mon's
  // actual recommended set, and it's where Protean earns individual credit (its
  // coverage moves are STAB-boosted, so its portfolio rises).
  const ref = stageReferenceDamage(levelCap);
  // Soft saturation (never a hard 1.0): a hit at the reference reads ~0.7.
  const softRate = tunable("DAMAGE_SOFT_RATE");
  const soft = (d) => 1 - Math.exp(-softRate * (d / ref));

  const peakDamage = Math.max(
    profile?.bestStabMove?.estimatedDamage || 0,
    profile?.bestDamagingMove?.estimatedDamage || 0,
  );
  const peak_damage_q = soft(peakDamage);

  const portfolio = (profile?.recommendedMoves || [])
    .filter((m) => m.category !== "Status" && (m.estimatedDamage || 0) > 0)
    .map((m) => m.estimatedDamage)
    .sort((a, b) => b - a)
    .slice(0, 3);
  // Fixed 3-slot denominator: a set with fewer real attacks pays for its thin
  // offense instead of averaging it away (otherwise a 2-attack utility build
  // weakly dominates the standard set by dropping its weakest attack).
  const portfolio_q = portfolio.length
    ? portfolio.map(soft).reduce((a, b) => a + b, 0) / 3
    : 0;

  // Attacker damage leans mostly on the peak hit plus a small, capped portfolio
  // term — "one role" doesn't mean "one move", but breadth must not dominate peak.
  const w = tunable("PORTFOLIO_WEIGHT");
  const damage_q = (1 - w) * peak_damage_q + w * portfolio_q;

  const cr = capRefs(levelCap);
  const speed_q = stagePercentile(speedOf(currentId), SPEED_REF, cr.speed);
  // General bulk is the geometric mean of the two sides — a wall that's fake on
  // one axis (Happiny: real SpD, paper Def) scores as the frail thing it is.
  const bulk_q = geomean([
    stagePercentile(physBulkOf(currentId), PHYS_BULK_REF, cr.phys),
    stagePercentile(specBulkOf(currentId), SPEC_BULK_REF, cr.spec),
  ]);

  // Functional attacking kit: a couple of real damaging options.
  const damagingOptions = profile?.recommendedDamagingMoveCount || 0;
  const reliability_q = clamp01((damagingOptions + 1) / 4);

  // Utility, role-aware and accuracy-weighted: real team infrastructure
  // (recovery, hazards, speed control, setup, pivot) counts far more than chip
  // status, so an annoying baby's Sweet Kiss / Charm doesn't read as support.
  // A 75%-accurate move is discounted vs reliable ones.
  const utility_q = clamp01(
    utilityValue(profile?.recommendedMoves) / tunable("UTILITY_SATURATION"),
  );

  return { damage_q, peak_damage_q, speed_q, bulk_q, reliability_q, utility_q };
}

// C = max over a few mechanically-derived roles. Returns the score in points plus
// the breakdown, for instrumentation.
export function currentFormValue(profile, levelCap) {
  if (!profile) {
    return { value: 0, bestRole: "none", features: {}, roles: {} };
  }
  const f = currentFormFeatures(profile, levelCap);

  // A utility mon still has to threaten something — otherwise it's passive and
  // gets walled for free. Gate the utility roles by PEAK damage (can it hurt
  // anything at all), not the portfolio-blended figure.
  const nonPassive = clamp01(
    (f.peak_damage_q ?? f.damage_q) / tunable("NON_PASSIVE_FLOOR"),
  );

  // reliability_q is deliberately NOT a role axis: with the available move data it
  // saturates to ~1 for almost everyone (every mon has a few damaging moves), so
  // it only inflates every score, and accuracy — the part that would discriminate
  // — is already folded into damage_q by the damage estimate. Kept in features for
  // display, unused here.
  // Utility roles are valued but capped below attacker roles: a support movepool
  // (recovery/hazards/setup) is real, but in this PvE context it must not let a
  // mediocre mon outscore a genuine threat — otherwise a full-TM utility body
  // benches a strong attacker at high level caps.
  const utilityWeight = tunable("UTILITY_ROLE_WEIGHT");
  const roles = {
    fast_attacker: geomean([f.damage_q, f.speed_q]),
    bulky_attacker: geomean([f.damage_q, f.bulk_q]),
    bulky_utility: utilityWeight * geomean([f.bulk_q, f.utility_q, nonPassive]),
    fast_utility: utilityWeight * geomean([f.speed_q, f.utility_q, nonPassive]),
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

// (Investment friction K lives in src/reborn/evolutionRequirements.js — the
// legality engine is the single source of K truth.)

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
