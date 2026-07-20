/**
 * @fileoverview Current-form usefulness (the C term of the individual value
 * model): how good is the form you can actually field RIGHT NOW at doing its
 * ONE best job.
 *
 * Built from a small set of mechanical, stage-relative features — not a
 * sprawling role junk drawer and not raw peak damage (which is blind to speed,
 * bulk, and role). The features are observations; only a handful of role
 * combines carry any judgement:
 *
 *   damage_q   how hard it hits now, vs a stage-typical strong hit
 *   speed_q    base Speed percentile (full dex blended with reachable-at-cap)
 *   physical_bulk_q / special_bulk_q  side-specific HP x defense percentiles
 *   bulk_q     geometric mean of the two bulk sides
 *   type_resilience_q  defensive type balance, with neutral centered at 0.5
 *   effective_bulk_q  balanced bulk adjusted by broad defensive typing
 *   fast_attacker_penalty_q  bounded failure-to-act discount when both speed
 *              and effective bulk are poor
 *   reliability_q  does it have a functional attacking kit (a few real options)
 *   utility_q  role-aware utility value — recovery / setup / hazards / speed
 *              control tags from the move meta, accuracy-weighted, saturating
 *              at UTILITY_SATURATION (real infrastructure counts; chip status
 *              barely does)
 *   priority_utility_q  the utility_q subset that acts with positive priority,
 *              either intrinsically or through the assumed ability
 *   screen_protection_q  physical/special axes protected by one executable
 *              screen action (Aurora Veil covers both; ordinary screens one)
 *   screen_delivery_q  whether that action arrives by priority or base Speed
 *   screen_support_q  geometric completion of protection and delivery
 *   tempo_speed_q  post-turn +1 Speed percentile supplied by Speed Boost
 *   tempo_reliability_q  does the set carry a full-protect ramp turn
 *
 * Then a few role scores (geometric means, so a role needs ALL its axes) and
 * C = max(role). A fast frail attacker, a bulky pivot, and a hard hitter each
 * get a legitimate route to a high C.
 *
 * Percentiles are taken against the dex (global blended with reachable-at-cap
 * — see capRefs), never within the (possibly weak) input pool — otherwise the
 * best trash becomes king of the dump. damage_q is the stage-relative axis: it
 * scales with the level cap via the damage estimate.
 */

import {
  GEN7_BASE_STATS,
  GEN7_BASE_STAT_TOTALS,
} from '../generated/gen7BaseStats.generated.js';
import { GEN7_PROGRESSION_SPECIES } from '../generated/gen7ProgressionSpecies.generated.js';
import {
  getTypeMultiplier,
  REBORN_ANALYSIS_TYPES,
} from '../reborn/typeChart.js';
import { SCORING_DEFAULTS, tunable } from './scoringConstants.js';

/**
 * Not sweepable — it defines the scale the other judgements are expressed in.
 * @const {number}
 */
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
// The whole non-attacking mass.
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

// Reference distributions for stage-independent stat percentiles.
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
// item steps assumed grindable. Percentiles blend global and R_cap by
// REACHABLE_BLEND so the reference shifts with progression without lurching.
function reachableByCap(id, cap) {
  const s = GEN7_PROGRESSION_SPECIES[id];
  if (!s || !s.prevoId) return true; // base form / unknown: always available
  if (s.evoLevel != null && s.evoLevel > cap) return false;
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
function stagePercentile(value, globalRef, capRef) {
  const blend = tunable('REACHABLE_BLEND');
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

/**
 * A stage-typical strong hit at this level cap, using the same core math as the
 * damage estimator (base-70 reference defender). damage_q divides the mon's best
 * hit by this, so "hits hard" is judged against the current stage rather than an
 * absolute bar.
 * @param {number} levelCap
 * @return {number}
 */
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

/**
 * Saturating ceiling for the additive role routes: identity below the knee,
 * asymptotic to (never reaching) 1 above it. Sub-knee values are bit-identical
 * to a hard clamp01, so only the elite band decompresses — overshoots stay
 * ordered instead of tying at 1.0, which would flatten top-mon ordering and the
 * local gradient the confidence sweep needs.
 * @param {number} x
 * @return {number}
 */
export function softCeiling(x) {
  if (x <= 0) return 0;
  const knee = tunable('ROLE_CEILING_KNEE');
  if (x <= knee) return x;
  const band = 1 - knee;
  return knee + band * (1 - Math.exp(-(x - knee) / band));
}

/**
 * Signed standalone defensive value in neutral-hit equivalents. This is the
 * same type chart the team-fit layer uses, but it answers a different question:
 * whether one member's strong defensive side has enough broadly useful switch-
 * in opportunities to count as a real specialist role. Neutral matchups add 0;
 * resistance 0.5, immunity 1, weakness -1, and a 4x weakness -3.
 * @param {!Array<string>=} defenseTypes
 * @return {number}
 */
export function defensiveTypeBalance(defenseTypes = []) {
  return REBORN_ANALYSIS_TYPES.reduce(
    (total, attackType) =>
      total + (1 - getTypeMultiplier(attackType, defenseTypes)),
    0,
  );
}

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

// Component-wise utility tag vector of a recommended set: for each role tag,
// the accuracy-weighted count of moves carrying it. PURELY mechanical — no
// weights of any kind — so build dominance pruning can compare utility
// per-component ("A has recovery, B has two status moves" are incomparable,
// and both survive) instead of collapsing to a weighted scalar that a future
// sweep axis could reorder.
const UTILITY_TAGS = Object.freeze([
  'recovery',
  'hazard_set',
  'hazard_remove',
  'speed_control',
  'setup',
  'pivot',
  'phazing',
  'screen',
  'disruption',
  'status',
  // Maximum protection axes delivered by ONE screen action. Kept separate
  // from the ordinary screen count so Reflect + Light Screen cannot dominate
  // away an Aurora Veil build merely by unioning two turns of work.
  'screen_compression',
  'priority',
]);

function normalizedAbility(ability) {
  return String(ability || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

const RELIABLE_TEMPO_RAMP_MOVES = new Set([
  'banefulbunker',
  'detect',
  'kingsshield',
  'protect',
  'spikyshield',
]);

/**
 * Mega Evolution happens after the pre-Mega ability has had a chance to
 * matter. A Sharpedo that begins the turn with Speed Boost and then becomes
 * Mega Sharpedo therefore keeps the earned boost even though Strong Jaw is
 * the active ability used by its attacks.
 * @return {boolean}
 */
export function hasSpeedBoostTempo(profile) {
  return [profile?.preMegaAbility, profile?.assumedAbility].some(
    (ability) => normalizedAbility(ability) === 'speedboost',
  );
}

/**
 * @return {boolean} Speed Boost tempo plus a full-protect ramp move on the
 *     recommended set.
 */
export function hasReliableTempoRamp(profile) {
  if (!hasSpeedBoostTempo(profile)) return false;
  return (profile?.recommendedMoves || []).some((move) =>
    RELIABLE_TEMPO_RAMP_MOVES.has(
      normalizedAbility(move?.id || move?.name),
    ),
  );
}

/**
 * Priority utility is deliberately narrower than either "status move" or
 * "priority move": it must perform a scored support job, be a Status move,
 * and actually execute above normal priority. Prankster supplies that last
 * fact for every Status move on the assumed build. Protect-style priority
 * with no infrastructure role and damaging priority attacks do not qualify.
 * @return {boolean}
 */
export function isPriorityUtilityMove(move, assumedAbility = null) {
  if (move?.category !== 'Status') return false;
  const hasUtilityRole = (move.roles || []).some(
    (role) => role !== 'priority' && (ROLE_WEIGHTS[role] || 0) > 0,
  );
  if (!hasUtilityRole) return false;
  const intrinsicPriority = move.priority || 0;
  const pranksterMakesPositive =
    normalizedAbility(assumedAbility) === 'prankster' && intrinsicPriority >= 0;
  return intrinsicPriority > 0 || pranksterMakesPositive;
}

function weatherIsAvailable(weather, recommendedMoves, assumedAbility) {
  if (!weather) return true;
  const weatherId = normalizedAbility(weather);
  if (
    weatherId === 'hail' &&
    normalizedAbility(assumedAbility) === 'snowwarning'
  ) {
    return true;
  }
  return (recommendedMoves || []).some(
    (move) =>
      normalizedAbility(move?.id || move?.name) === weatherId,
  );
}

/**
 * Team protection is valued per action, not by unioning a whole set. A normal
 * screen covers one damage axis; Aurora Veil covers both, but only when its
 * hail requirement is actually supplied by the set or assumed ability.
 * Priority is complete delivery; otherwise the user's measured Speed is the
 * delivery axis. Return the best executable single screen action on the set.
 * @return {{protection_q: number, delivery_q: number, value_q: number}}
 */
export function singleActionScreenSupport(
  recommendedMoves,
  assumedAbility = null,
  speed_q = 0,
) {
  let best = {
    protection_q: 0,
    delivery_q: 0,
    value_q: 0,
  };
  for (const move of recommendedMoves || []) {
    const axes = new Set(
      (move?.screenAxes || []).filter(
        (axis) => axis === 'physical' || axis === 'special',
      ),
    );
    if (!axes.size) continue;
    if (
      !weatherIsAvailable(
        move?.requiresWeather,
        recommendedMoves,
        assumedAbility,
      )
    ) {
      continue;
    }
    const protection_q = clamp01(axes.size / 2);
    const delivery_q = isPriorityUtilityMove(move, assumedAbility)
      ? 1
      : clamp01(speed_q);
    const value_q = geomean([protection_q, delivery_q]);
    if (
      value_q > best.value_q ||
      (value_q === best.value_q && protection_q > best.protection_q)
    ) {
      best = { protection_q, delivery_q, value_q };
    }
  }
  return best;
}

/**
 * @return {!Array<number>} Accuracy-weighted role counts, one slot per
 *     UTILITY_TAGS entry.
 */
export function utilityTagVector(recommendedMoves, assumedAbility = null) {
  const vector = new Array(UTILITY_TAGS.length).fill(0);
  for (const move of recommendedMoves || []) {
    const hitRate = (move.accuracy ?? 100) / 100;
    for (const role of move.roles || []) {
      const index = UTILITY_TAGS.indexOf(role);
      if (index >= 0) vector[index] += hitRate;
    }
    if (
      isPriorityUtilityMove(move, assumedAbility) &&
      !(move.roles || []).includes('priority')
    ) {
      vector[UTILITY_TAGS.indexOf('priority')] += hitRate;
    }
  }
  vector[UTILITY_TAGS.indexOf('screen_compression')] =
    singleActionScreenSupport(recommendedMoves, assumedAbility, 0)
      .protection_q;
  return vector;
}

/** The moves whose area-altering effect a duration-extender item prolongs. */
export const FIELD_SETTING_MOVE_IDS = new Set([
  'electricterrain',
  'grassyterrain',
  'mistyterrain',
  'psychicterrain',
]);

/**
 * @return {number} Accuracy-weighted sum of each move's best utility-role
 *     weight.
 */
export function utilityValue(recommendedMoves, fieldExtenderOwned = false) {
  let total = 0;
  for (const move of recommendedMoves || []) {
    let best = 0;
    for (const role of move.roles || []) {
      best = Math.max(best, ROLE_WEIGHTS[role] || 0);
    }
    if (best > 0) {
      let value = best * ((move.accuracy ?? 100) / 100);
      if (fieldExtenderOwned && FIELD_SETTING_MOVE_IDS.has(move.id)) {
        value *= 1 + tunable('FIELD_EXTENDER_UTILITY_BONUS');
      }
      total += value;
    }
  }
  return total;
}

/**
 * @return {number} The priority-executing subset of utility value.
 */
export function priorityUtilityValue(recommendedMoves, assumedAbility = null) {
  let total = 0;
  for (const move of recommendedMoves || []) {
    if (!isPriorityUtilityMove(move, assumedAbility)) continue;
    let bestRole = 0;
    for (const role of move.roles || []) {
      if (role === 'priority') continue;
      bestRole = Math.max(bestRole, ROLE_WEIGHTS[role] || 0);
    }
    // Priority is an additional property of delivering the support job, not
    // an alternative label for it: a priority screen is worth screen +
    // priority, while the ordinary utility scalar still counts only screen.
    total +=
      (bestRole + ROLE_WEIGHTS.priority) * ((move.accuracy ?? 100) / 100);
  }
  return total;
}

/**
 * The fielded form's features, all in [0,1].
 * @return {!Object<string, number>}
 */
export function currentFormFeatures(profile, levelCap) {
  const currentId = profile?.currentId;

  const ref = stageReferenceDamage(levelCap);
  // Soft saturation (never a hard 1.0): a hit at the reference reads ~0.7.
  const softRate = tunable('DAMAGE_SOFT_RATE');
  const soft = (d) => 1 - Math.exp(-softRate * (d / ref));

  // The nonPassive gate ("can this mon threaten anything at all") uses the
  // mon's GLOBAL best attack — build-independent, so a support build keeps
  // its utility roles even when it personally runs few attacks.
  const peakDamage = Math.max(
    profile?.bestStabMove?.estimatedDamage || 0,
    profile?.bestDamagingMove?.estimatedDamage || 0,
  );
  const peak_damage_q = soft(peakDamage);

  // Attacker-role offense is PER-BUILD and ADDITIVE. The build's OWN best
  // attack is the ceiling; its SECONDARY attacks fill a bounded breadth factor
  // via noisy-OR, so each extra attack adds less and breadth can never push
  // past the peak threat. A thin build pays a penalty down to
  // (1 − PORTFOLIO_WEIGHT) of its peak; a full coverage build sits at its peak
  // — so only thin builds move, which is what differentiates a coverage build
  // from a support build of the same mon (the support build's attacker role
  // drops, letting its utility role win the role max). A narrow anti-wall
  // measure over the actual recommended set, not per-type breadth spam; it's
  // also where Protean earns individual credit (its coverage moves are
  // STAB-boosted, so its portfolio rises).
  const attackQ = (profile?.recommendedMoves || [])
    .filter((m) => m.category !== 'Status' && (m.estimatedDamage || 0) > 0)
    .map((m) => soft(m.estimatedDamage))
    .sort((a, b) => b - a);
  const buildPeak = attackQ[0] || 0;
  const breadth =
    attackQ.length > 1
      ? 1 - attackQ.slice(1).reduce((p, d) => p * (1 - d), 1)
      : 0;
  const w = tunable('PORTFOLIO_WEIGHT');
  const damage_q = buildPeak * (1 - w * (1 - breadth));

  const cr = capRefs(levelCap);
  const speed_q = stagePercentile(speedOf(currentId), SPEED_REF, cr.speed);
  const speedBoostTempo = hasSpeedBoostTempo(profile);
  const tempo_speed_q = speedBoostTempo
    ? stagePercentile(speedOf(currentId) * 1.5, SPEED_REF, cr.speed)
    : 0;
  const tempo_reliability_q = hasReliableTempoRamp(profile) ? 1 : 0;
  const physical_bulk_q = stagePercentile(
    physBulkOf(currentId),
    PHYS_BULK_REF,
    cr.phys,
  );
  const special_bulk_q = stagePercentile(
    specBulkOf(currentId),
    SPEC_BULK_REF,
    cr.spec,
  );
  const bulk_q = geomean([physical_bulk_q, special_bulk_q]);
  const typeSpan = Math.max(
    0.1,
    tunable('TYPE_RESILIENCE_FULL_SURPLUS'),
  );
  const type_resilience_q = clamp01(
    0.5 +
      defensiveTypeBalance(profile?.currentTypes) / (2 * typeSpan),
  );
  // Raw HP x defenses answer how many neutral hits the body can take. Bulky
  // roles also need to answer whether its actual typing exposes that body to
  // broadly stronger or weaker incoming hits. Neutral typing is the fixed
  // point; this deliberately does not replace either side-specific stat.
  const effective_bulk_q = clamp01(
    bulk_q +
      tunable('BALANCED_BULK_TYPE_WEIGHT') *
        (type_resilience_q - 0.5),
  );
  // Moving first and surviving a reply are alternate ways for an attacker to
  // access its damage. The fast route remains fully legitimate for a true
  // glass cannon: the joint deficit vanishes as Speed approaches complete.
  // Only the overlap between "may move second" and "cannot take the hit" is
  // discounted, and even the worst overlap is bounded by the tunable weight.
  const fast_attacker_penalty_q =
    tunable('FAST_ATTACKER_FRAILTY_WEIGHT') *
    (1 - speed_q) *
    (1 - effective_bulk_q);

  const damagingOptions = profile?.recommendedDamagingMoveCount || 0;
  const reliability_q = clamp01((damagingOptions + 1) / 4);

  const utility_q = clamp01(
    utilityValue(
      profile?.recommendedMoves,
      Boolean(profile?.fieldExtenderOwned),
    ) / tunable('UTILITY_SATURATION'),
  );
  // Acting first is its own route to delivering support: it does not need the
  // user's base Speed or bulk to stand in as a proxy for whether the move gets
  // a turn. The feature still prices the actual role quality and depth, so one
  // minor priority status move cannot masquerade as a complete support kit.
  const priority_utility_q = softCeiling(
    priorityUtilityValue(
      profile?.recommendedMoves,
      profile?.assumedAbility,
    ) / tunable('UTILITY_SATURATION'),
  );
  const screenSupport = singleActionScreenSupport(
    profile?.recommendedMoves,
    profile?.assumedAbility,
    speed_q,
  );

  return {
    damage_q,
    peak_damage_q,
    speed_q,
    physical_bulk_q,
    special_bulk_q,
    bulk_q,
    type_resilience_q,
    effective_bulk_q,
    fast_attacker_penalty_q,
    reliability_q,
    utility_q,
    priority_utility_q,
    screen_protection_q: screenSupport.protection_q,
    screen_delivery_q: screenSupport.delivery_q,
    screen_support_q: screenSupport.value_q,
    tempo_speed_q,
    tempo_reliability_q,
  };
}

/**
 * C = max over a few mechanically-derived roles. Returns the score in points plus
 * the breakdown, for instrumentation.
 * @return {{value: number, bestRole: string, features: !Object,
 *     roles: !Object}}
 */
export function currentFormValue(profile, levelCap) {
  if (!profile) {
    return { value: 0, bestRole: 'none', features: {}, roles: {} };
  }
  const f = currentFormFeatures(profile, levelCap);

  // A utility mon still has to threaten something — otherwise it's passive and
  // gets walled for free. Gate the utility roles by PEAK damage (can it hurt
  // anything at all), not the portfolio-blended figure.
  const nonPassive = clamp01(
    (f.peak_damage_q ?? f.damage_q) / tunable('NON_PASSIVE_FLOOR'),
  );

  // reliability_q is deliberately NOT a role axis: with the available move data it
  // saturates to ~1 for almost everyone (every mon has a few damaging moves), so
  // it only inflates every score, and accuracy — the part that would discriminate
  // — is already folded into damage_q by the damage estimate. Kept in features for
  // display, unused here.
  const utilityWeight = tunable('UTILITY_ROLE_WEIGHT');
  const priorityUtilityWeight = tunable('PRIORITY_UTILITY_ROLE_WEIGHT');
  const specialistBulk = Math.max(
    f.physical_bulk_q,
    f.special_bulk_q,
  );
  // The non-passive gate multiplies the utility roles OUTSIDE the geomean.
  // Keeping it outside makes the floor real instead of softening it through a
  // root. Mons at or above the floor are untouched (nonPassive clamps to 1).
  const roles = {
    fast_attacker:
      geomean([f.damage_q, f.speed_q]) *
      (1 - f.fast_attacker_penalty_q),
    bulky_attacker: geomean([f.damage_q, f.effective_bulk_q]),
    // A one-sided bulky attacker earns a separate route only when its typing
    // supplies enough broadly useful switch-in opportunities. The signed type
    // adjustment prevents a special wall with many weaknesses from laundering
    // one good stat into a complete role.
    specialist_bulky_attacker: softCeiling(
      geomean([f.damage_q, specialistBulk]) +
        (f.type_resilience_q - 0.5),
    ),
    // Speed Boost is an earned-tempo attacker route: the mon must still hit
    // hard, and its post-turn +1 Speed is measured against the same stage
    // reference as ordinary Speed. A full-protect move makes that ramp
    // reliable enough to approach, but never exceed, the common C ceiling.
    tempo_attacker: softCeiling(
      geomean([f.damage_q, f.tempo_speed_q]) +
        tunable('TEMPO_RELIABILITY_BONUS') * f.tempo_reliability_q,
    ),
    bulky_utility:
      utilityWeight *
      nonPassive *
      geomean([f.effective_bulk_q, f.utility_q]),
    fast_utility: utilityWeight * nonPassive * geomean([f.speed_q, f.utility_q]),
    // May share, never exceed, the perfect-attacker ceiling (rationale at
    // priority_utility_q).
    priority_utility:
      priorityUtilityWeight * nonPassive * f.priority_utility_q,
    screen_support: nonPassive * f.screen_support_q,
  };

  let bestRole = 'fast_attacker';
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

/**
 * Fraction of the represented final form's key attributes the fielded form
 * already has — the best of its offense / bulk / speed ratios. Used only to
 * bucket the readiness gate (near-final vs mid-evo), so an OFFENSIVE line that's
 * nearly ready on offense counts as near-final even if it never gets bulky.
 * @return {number}
 */
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
