/**
 * @fileoverview THE single home for every tunable preference in the scoring
 * model (see SCORING.md). Mechanical observations (stats, types, move data)
 * live in the data layer; everything here is a JUDGEMENT with a default, and
 * every judgement is sweepable by the confidence layer.
 *
 * Change policy: a default here moves only when the badge-anchor corpus, a
 * concrete mechanical correction, or an explicitly recorded decision
 * justifies it.
 * SCORING.md records the current contract and measured calibration effect.
 *
 * Override API: reads go through tunable(key). The confidence sweep (and
 * tests) set a plain object of overrides; production never sets one, so
 * defaults apply. Hot loops (searchKernel) snapshot values once per search in
 * prepareFitScoring rather than calling tunable() per team.
 */

/** @const {string} */
export const SCORING_VERSION = '2.0.0';

/** @const {Object<string, *>} Frozen defaults, keyed by tunable name. */
export const SCORING_DEFAULTS = Object.freeze({
  // --- Individual value (usage-convergence blend — see candidateScoring.js) --
  USAGE_INFLUENCE: 0.3, // α — usage informative, never sovereign
  USAGE_TIER_WEIGHT: 0.6, // ceiling U leans on tier prestige over raw usage %
  USAGE_REF_PERCENT: 20, // usage % where the usage component of U saturates
  // Usage below this is not "meaningful": the U-ceiling fallback treats it as
  // floor-tier and row notes call it trace. The p where 1−(1−p)^25 = 0.5 —
  // the usage share at which a mon has even odds of appearing at least once
  // across 25 games. ≈ 2.7345%. Baked into the resolver/set indexes at build
  // time: regenerate both in the same commit as any change here. Safe as a
  // non-gate ONLY because meaningfulUsage no longer outranks score in any
  // comparator. Making this a gate again would violate SCORING.md's
  // score-sovereignty invariant.
  MIN_MEANINGFUL_USAGE_PERCENT: 100 * (1 - 0.5 ** (1 / 25)),
  // A sustained trace in one of the ladder's strongest formats is evidence
  // that a line is not competitively absent, even when it falls below the
  // first-meaningful-tier ranking bar. It selects only the bounded downward-
  // trust law; it never creates a rank or raises U_rank.
  SHALLOW_TRACE_PRIOR_MIN_PERCENT: 1,
  SHALLOW_TRACE_PRIOR_FORMAT_DEPTH: 3,

  // --- C: current-form value -------------------------------------------------
  CURRENT_VALUE_SCALE: 2000, // points scale shared by C and U
  // Attacker offense is per-build & additive: damageQ = buildPeak·(1 − w·(1 −
  // breadth)). w is the THINNESS PENALTY DEPTH — a one-attack build scores
  // (1−w)·peak, a full coverage build sits at peak (see currentFormValue).
  PORTFOLIO_WEIGHT: 0.3,
  UTILITY_ROLE_WEIGHT: 0.75, // utility roles score below attacker roles
  // complete first-action support shares C's role ceiling
  PRIORITY_UTILITY_ROLE_WEIGHT: 1,
  // Knee of the saturating role ceiling — see softCeiling (currentFormValue).
  ROLE_CEILING_KNEE: 0.9,
  // A protected Speed Boost turn makes the post-boost attacker route reliable;
  // this is only the completion bonus for carrying a full-protect ramp move
  // such as Protect or Detect.
  TEMPO_RELIABILITY_BONUS: 0.15,
  // Net favorable neutral-hit equivalents (defensiveTypeBalance's scale) that
  // move the normalized feature from neutral (0.5) to complete (1.0); the
  // negative side mirrors it.
  TYPE_RESILIENCE_FULL_SURPLUS: 4,
  // How strongly broad defensive typing adjusts the raw two-sided bulk used
  // by ordinary bulky roles. Neutral typing (typeResilienceQ = 0.5) is
  // unchanged; favorable/vulnerable typing moves bulk symmetrically.
  BALANCED_BULK_TYPE_WEIGHT: 0.3,
  // A fast attacker normally gets its move by acting first. When it is neither
  // reliably first nor able to absorb the reply, apply a small bounded access
  // discount. A complete speed or effective-bulk axis removes the discount.
  FAST_ATTACKER_FRAILTY_WEIGHT: 0.03,
  // Field-extender bonus for fangame-original duration extenders (Amplifield
  // Rock): the holder's field-setting move's utility contribution scales by
  // (1 + this). MEASURED, not invented: duration headroom (8/5 − 1 = 0.6) ×
  // the rawCount-weighted conditional propensity of the nearest mainline
  // analog — Light Clay held given screens usage ≈ 0.77–0.8 across 17 gen7
  // mons (dedicated setters 0.9+); the direct Terrain Extender analog is
  // data-starved because gen7 terrain comes from Surge abilities, not the
  // move. Doctrine: applies ONLY to items the usage prior cannot see —
  // mainline extenders are already priced into their holders' ranks.
  FIELD_EXTENDER_UTILITY_BONUS: 0.48,
  REACHABLE_BLEND: 0.5, // speed/bulk percentiles: global vs reachable-at-cap
  DAMAGE_SOFT_RATE: 1.2, // soft saturation rate of damageQ
  NON_PASSIVE_FLOOR: 0.25, // peak damageQ that fully unlocks utility roles
  UTILITY_SATURATION: 1.5, // summed utility value that reads as utilityQ = 1

  // --- O: readiness gate -----------------------------------------------------
  ONLINE_NEAR: 0.65,
  ONLINE_MIDEVO: 0.35,
  ONLINE_BABY: 0.1,
  ONLINE_JITTER: 0, // sweep axis: ±1 shifts every non-final gate one category
  ACT_FLOOR: 0.15, // damageQ below this ⇒ can't act ⇒ baby
  NEAR_FINAL_RATIO: 0.85, // key stats this close to final ⇒ near-final

  // --- F: future value (display / investment view only, never in selection) --
  FUTURE_WEIGHT: 0.35,
  FUTURE_CAP: 300,

  // --- K: investment friction
  // ------------------------------------------------- Acquisition friction is
  // zeroed by design: evolution grind is INFORMATION, not a score term. The
  // requirement machinery stays — receipts still render, access gates still
  // block, owned items still short-circuit gates — but acquisition grind moves
  // no score. The pricing code paths are kept alive (and pinned by tests under
  // explicit overrides) so re-enabling is a constants change, not a rebuild.
  FRIENDSHIP_FRICTION: 0, // friendship grind per evolution step
  ITEM_FRICTION: 0, // held-item / use-item evolution (farmable item)
  TRADE_FRICTION: 0, // Reborn trades via Link Stone — item-like
  TIME_FRICTION: 0, // day/night or minor special condition
  // Build friction is NOT a tiebreaker — delaying evolution to learn a move
  // is a real in-run cost the access model doesn't express.
  DELAYED_EVO_FRICTION: 200,
  FRICTION_SCALE: 1, // sweep multiplier over all K components

  // --- Opponent-type bias ----------------------------------------------------
  BIAS_RESIST_PER_LEVEL: 90,
  BIAS_IMMUNE_PER_LEVEL: 130,
  BIAS_WEAK_PENALTY_PER_LEVEL: 70,
  BIAS_OFFENSE_PER_LEVEL: 90,
  BIAS_MEANINGFUL_THRESHOLD: 270,

  // --- Team score: Σ member V + COVERAGE_WEIGHT × fit ------------------------
  COVERAGE_WEIGHT: 0.5, // team fit vs summed individual values
  COVERAGE_SCALE: 110, // value of fully answering one defense type
  BIAS_COVERAGE_BOOST: 2, // max extra weight on a maxed opponent-bias type
  SHARED_WEAK_PENALTY: 180, // per extra member sharing a weakness
  UNCOVERED_WEAK_PENALTY: 260, // shared weakness with no resist behind it
  RESIST_STACK_BONUS: 45, // per stacked resist (capped)

  // --- Ability assumption (when the caught mon's ability is unknown) ---------
  ABILITY_ASSUMPTION: 'primary', // "secondary" flips unknown mons for the sweep

  // --- Usage-convergence blend (see SCORING.md) ------------------------------
  USAGE_RAMP_EXPONENT: 2, // w ramps as (cap/L*)^k — back-loaded handoff
  // Bounded-trust law saturation (see candidateScoring's model header): the
  // prior may claim at most this fraction of the mon's measured excess over
  // it, however converged.
  // Calibration bracket (offline sweep): the Meowstic-class assertions cap
  // it from above (fails materialize as it approaches ~0.3); the value sits
  // low in the band pending the full calibration pass.
  PRIOR_DRAG_CAP: 0.15,
  // Tier dominance: strictly greater than any possible usage % (100), so a
  // shallower first-meaningful tier ALWAYS outranks any within-tier usage
  // (100 would tie against a mon at exactly 100% usage — 101 is airtight).
  TIER_STEP: 101,
  // Usage % is quantized to this step inside U_rank so the ε·C tiebreak has a
  // provable gap to live in. INVARIANT: keep EPSILON_C × CURRENT_VALUE_SCALE <
  // USAGE_QUANTUM, so ε·C can NEVER override a real usage difference — it
  // only breaks exact (quantized) ties.
  USAGE_QUANTUM: 0.001,
  EPSILON_C: 2.5e-7,
  // --- Phase 3: teammate synergy (team fit degrades into competitive teams) --
  // Pair trust t = min(w_a, w_b) × hasData: the hand-built pair judgements
  // (shared weakness etc.) fade out with the mean pair trust while co-use
  // lift fades in per-pair; bias-driven coverage NEVER fades.
  // Points per percentage point of Smogon teammate lift, applied inside the
  // team fit (so COVERAGE_WEIGHT halves it in the total; 0 disables the term).
  // CALIBRATED against the extracted lift distributions (overall median 6.8pp,
  // p90 20pp; real cores 40–60pp/pair): at 4, a median pair at full trust is
  // worth 14 total points (noise-level), a p90 pair 40, and a true tier core
  // like Blissey+Quagsire+Alomomola (Σlift ≈ 150pp) ≈ 300 — enough to win the
  // marginal endgame seat from equal-usage strangers at realistic trust
  // (0.75–1.0), without approaching the ~50/tier-step usage-rank gaps. The
  // endgame A/B (12-mon UU pool, badge 18): the core seats at 4, not at ≤3.5.
  SYNERGY_SCALE: 4,

  // --- Search ----------------------------------------------------------------
  SHORTLIST_MAX: 28,
  SHORTLIST_CORE: 14,
  // test hook: force shortlist path for regret validation
  FORCE_SHORTLIST: false,
  // Search enumeration budgets in team combinations C(N,6). Interactive
  // latency rules these, not search purity; above them the shortlist+polish
  // path takes over. Tunable so the regret validation can raise the cap to
  // compute a TRUE exact baseline.
  // background auto-reoptimize ceiling (~25 mons)
  AUTO_EXHAUSTIVE_BUDGET: 250_000,
  EXHAUSTIVE_CAP: 1_000_000, // explicit-optimize ceiling (~32 mons)
  // Selection scores an optimistic (max-over-builds) coverage relaxation, so
  // the best relaxed team need not be best after concrete builds are assigned.
  // The search keeps this many top relaxed teams; realization re-ranks them by
  // exact realized score. Sized by regret validation (regret 0 well below
  // this).
  REALIZATION_POOL: 64,
});

/**
 * @param {string} key
 * @return {*} The active override for `key` when one is set, else the
 *     default.
 */
export function tunable(key) {
  const overrides = globalThis.__SCORING_OVERRIDES__;
  if (overrides && key in overrides) return overrides[key];
  return SCORING_DEFAULTS[key];
}

/**
 * @param {?Object<string, *>} overrides Null or empty clears the active
 *     overrides.
 */
export function setScoringOverrides(overrides) {
  globalThis.__SCORING_OVERRIDES__ =
    overrides && Object.keys(overrides).length ? overrides : null;
}

/**
 * @return {?Object<string, *>}
 */
export function getScoringOverrides() {
  return globalThis.__SCORING_OVERRIDES__ || null;
}

/**
 * Stable signature of the active overrides, folded into optimizer cache keys
 * so a sweep or a test never poisons the production caches (and vice versa).
 * @return {string}
 */
export function scoringOverridesSignature() {
  const overrides = globalThis.__SCORING_OVERRIDES__;
  if (!overrides) return 'base';
  return Object.keys(overrides)
    .sort()
    .map((key) => `${key}=${overrides[key]}`)
    .join(',');
}
