// THE single home for every tunable preference in the scoring model ("frozen
// v0" policy — see SCORING_V0.md). Mechanical observations (stats, types, move
// data) live in the data layer; everything here is a JUDGEMENT with a default,
// and every judgement is sweepable by the confidence layer.
//
// Change policy: a default here only moves when a regression fixture or an
// explicit roadmap item justifies it, and SCORING_V0.md's changelog records why.
//
// Override API: reads go through tunable(key). The confidence sweep (and tests)
// set a plain object of overrides; production never sets one, so defaults apply.
// Hot loops (searchKernel) snapshot values once per search in prepareFitScoring
// rather than calling tunable() per team.

export const SCORING_VERSION = "1.0.0";

export const SCORING_DEFAULTS = Object.freeze({
  // --- Individual value: V = C + α·O·[U−C]₊ + bias − K ----------------------
  USAGE_INFLUENCE: 0.3, // α — usage informative, never sovereign
  USAGE_TIER_WEIGHT: 0.6, // ceiling U leans on tier prestige over raw usage %
  USAGE_REF_PERCENT: 20, // usage % where the usage component of U saturates
  MIN_MEANINGFUL_USAGE_PERCENT: 0.1,

  // --- C: current-form value --------------------------------------------------
  CURRENT_VALUE_SCALE: 2000, // points scale shared by C and U
  PORTFOLIO_WEIGHT: 0.15, // attacker damage_q = (1−w)·peak + w·top-3 portfolio
  UTILITY_ROLE_WEIGHT: 0.75, // utility roles score below attacker roles
  REACHABLE_BLEND: 0.5, // speed/bulk percentiles: global vs reachable-at-cap
  DAMAGE_SOFT_RATE: 1.2, // soft saturation rate of damage_q
  NON_PASSIVE_FLOOR: 0.25, // peak damage_q that fully unlocks utility roles
  UTILITY_SATURATION: 1.5, // summed utility value that reads as utility_q = 1

  // --- O: readiness gate ------------------------------------------------------
  ONLINE_NEAR: 0.65,
  ONLINE_MIDEVO: 0.35,
  ONLINE_BABY: 0.1,
  ONLINE_JITTER: 0, // sweep axis: ±1 shifts every non-final gate one category
  ACT_FLOOR: 0.15, // damage_q below this ⇒ can't act ⇒ baby
  NEAR_FINAL_RATIO: 0.85, // key stats this close to final ⇒ near-final

  // --- F: future value (display / investment view only, never in selection) --
  FUTURE_WEIGHT: 0.35,
  FUTURE_CAP: 300,

  // --- K: investment friction -------------------------------------------------
  FRIENDSHIP_FRICTION: 180, // friendship grind per evolution step
  ITEM_FRICTION: 260, // held-item / use-item evolution (farmable item)
  TRADE_FRICTION: 260, // Reborn trades via Link Stone (mining) — item-like
  TIME_FRICTION: 60, // day/night or minor special condition
  DELAYED_EVO_FRICTION: 200, // build uses a move that requires delaying evolution
  FRICTION_SCALE: 1, // sweep multiplier over all K components

  // --- Opponent-type bias ------------------------------------------------------
  BIAS_RESIST_PER_LEVEL: 90,
  BIAS_IMMUNE_PER_LEVEL: 130,
  BIAS_WEAK_PENALTY_PER_LEVEL: 70,
  BIAS_OFFENSE_PER_LEVEL: 90,
  BIAS_MEANINGFUL_THRESHOLD: 270,

  // --- Team score: Σ member V + COVERAGE_WEIGHT × fit -------------------------
  COVERAGE_WEIGHT: 0.5, // team fit vs summed individual values
  COVERAGE_SCALE: 110, // value of fully answering one defense type
  BIAS_COVERAGE_BOOST: 2, // max extra weight on a maxed opponent-bias type
  SHARED_WEAK_PENALTY: 180, // per extra member sharing a weakness
  UNCOVERED_WEAK_PENALTY: 260, // shared weakness with no resist behind it
  RESIST_STACK_BONUS: 45, // per stacked resist (capped)

  // --- Ability assumption (when the caught mon's ability is unknown) ----------
  ABILITY_ASSUMPTION: "primary", // "secondary" flips unknown mons for the sweep

  // --- Search ------------------------------------------------------------------
  SHORTLIST_MAX: 28,
  SHORTLIST_CORE: 14,
  FORCE_SHORTLIST: false, // test hook: force shortlist path for regret validation
});

export function tunable(key) {
  const overrides = globalThis.__SCORING_OVERRIDES__;
  if (overrides && key in overrides) return overrides[key];
  return SCORING_DEFAULTS[key];
}

export function setScoringOverrides(overrides) {
  globalThis.__SCORING_OVERRIDES__ =
    overrides && Object.keys(overrides).length ? overrides : null;
}

export function getScoringOverrides() {
  return globalThis.__SCORING_OVERRIDES__ || null;
}

// Stable signature of the active overrides, folded into optimizer cache keys so
// a sweep or a test never poisons the production caches (and vice versa).
export function scoringOverridesSignature() {
  const overrides = globalThis.__SCORING_OVERRIDES__;
  if (!overrides) return "base";
  return Object.keys(overrides)
    .sort()
    .map((key) => `${key}=${overrides[key]}`)
    .join(",");
}
