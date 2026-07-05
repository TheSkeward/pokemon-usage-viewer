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
  // Usage below this is not "meaningful": the U-ceiling fallback treats it as
  // floor-tier and row notes call it trace. At 1 (user judgement: sub-1%
  // appearances in a tier are noise). Safe at 1% ONLY because meaningfulUsage
  // no longer outranks score in any comparator — it briefly did, and the
  // boolean silently seated Alakazam over a higher-scoring Kadabra; see the
  // changelog's "usage sovereignty" entry before making this a gate again.
  MIN_MEANINGFUL_USAGE_PERCENT: 1,

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
  // Evolution K is a TIEBREAKER, not a price (user decision, after the
  // Kadabra/Alakazam case): obtainability is modeled explicitly by the
  // evolution-access gates and owned evolution items, so charging the BETTER
  // mon hundreds of points for a purchasable stone double-counted the cost
  // and let a pre-evolution outscore its own evolution. These values only
  // break near-exact ties toward the cheaper line; they can never outweigh a
  // real stat gap. (Owned items still zero them; blocked access still blocks.)
  FRIENDSHIP_FRICTION: 15, // friendship grind per evolution step
  ITEM_FRICTION: 20, // held-item / use-item evolution (farmable item)
  TRADE_FRICTION: 20, // Reborn trades via Link Stone — item-like
  TIME_FRICTION: 5, // day/night or minor special condition
  // Build friction is NOT a tiebreaker — delaying evolution to learn a move
  // is a real in-run cost the access model doesn't express.
  DELAYED_EVO_FRICTION: 200,
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

  // --- SCORING_V1: usage-convergence blend (Phase 2; see SCORING_V0.md) -------
  // Selected per run (UI toggle → setActiveUsageModel), never a default:
  // the frozen defaults keep every V0 golden byte-stable.
  USAGE_MODEL: "v0",
  USAGE_RAMP_EXPONENT: 2, // w ramps as (cap/L*)^k — back-loaded handoff
  // Tier dominance: strictly greater than any possible usage % (100), so a
  // shallower first-meaningful tier ALWAYS outranks any within-tier usage.
  // (User proposed 50/100; 50 fails on >50%-usage mons, 100 ties at exactly
  // 100% — 101 is airtight.)
  TIER_STEP: 101,
  // Usage % is quantized to this step inside U_rank so the ε·C tiebreak has a
  // provable gap to live in: EPSILON_C × CURRENT_VALUE_SCALE < USAGE_QUANTUM,
  // asserted by a validate test — ε-C can NEVER override a real usage
  // difference, it only breaks exact (quantized) ties.
  USAGE_QUANTUM: 0.001,
  EPSILON_C: 2.5e-7,

  // --- Search ------------------------------------------------------------------
  SHORTLIST_MAX: 28,
  SHORTLIST_CORE: 14,
  FORCE_SHORTLIST: false, // test hook: force shortlist path for regret validation
  // Selection scores an optimistic (max-over-builds) coverage relaxation, so the
  // best relaxed team need not be best after concrete builds are assigned. The
  // search keeps this many top relaxed teams; realization re-ranks them by exact
  // realized score. Sized by regret validation (regret 0 well below this).
  REALIZATION_POOL: 64,
});

export function tunable(key) {
  const overrides = globalThis.__SCORING_OVERRIDES__;
  if (overrides && key in overrides) return overrides[key];
  // The scoring model is a SESSION selection (UI toggle), deliberately outside
  // the overrides object so the confidence sweep's setScoringOverrides calls
  // can't silently reset it mid-run.
  if (key === "USAGE_MODEL" && activeUsageModel) return activeUsageModel;
  return SCORING_DEFAULTS[key];
}

let activeUsageModel = null;

export function setActiveUsageModel(model) {
  activeUsageModel = model === "v1" ? "v1" : null;
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
  const model = activeUsageModel ? `|model=${activeUsageModel}` : "";
  if (!overrides) return `base${model}`;
  return (
    Object.keys(overrides)
      .sort()
      .map((key) => `${key}=${overrides[key]}`)
      .join(",") + model
  );
}
