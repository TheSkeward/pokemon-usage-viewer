// THE single home for every tunable preference in the scoring model (see
// SCORING.md). Mechanical observations (stats, types, move data) live in the
// data layer; everything here is a JUDGEMENT with a default, and every
// judgement is sweepable by the confidence layer.
//
// Change policy: a default here only moves when a regression fixture or an
// explicit roadmap item justifies it, and SCORING.md's changelog records why.
//
// Override API: reads go through tunable(key). The confidence sweep (and tests)
// set a plain object of overrides; production never sets one, so defaults apply.
// Hot loops (searchKernel) snapshot values once per search in prepareFitScoring
// rather than calling tunable() per team.

// 2.0.0: scoring V0 retired — the usage-convergence blend is the sole model.
export const SCORING_VERSION = "2.0.0";

export const SCORING_DEFAULTS = Object.freeze({
  // --- Individual value: V = C + α·O·[U−C]₊ + bias − K ----------------------
  USAGE_INFLUENCE: 0.3, // α — usage informative, never sovereign
  USAGE_TIER_WEIGHT: 0.6, // ceiling U leans on tier prestige over raw usage %
  USAGE_REF_PERCENT: 20, // usage % where the usage component of U saturates
  // Usage below this is not "meaningful": the U-ceiling fallback treats it as
  // floor-tier and row notes call it trace. User-derived cutoff (after 1 was
  // "too tilted in favor of fringe AG mons" and 2 still not quite there):
  // the p where 1−(1−p)^25 = 0.5 — the usage share at which a mon has even
  // odds of appearing at least once across 25 games. ≈ 2.7345%. Baked into
  // the resolver/set indexes at build time: regenerate both in the same
  // commit as any change here. Safe as a non-gate ONLY because
  // meaningfulUsage no longer outranks score in any comparator — it briefly
  // did, and the boolean silently seated Alakazam over a higher-scoring
  // Kadabra; see the changelog's "usage sovereignty" entry before making
  // this a gate again.
  MIN_MEANINGFUL_USAGE_PERCENT: 100 * (1 - 0.5 ** (1 / 25)),

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
  // Evolution K is INFORMATION, not a score term (user decision, completing
  // the arc that began with the Kadabra/Alakazam tiebreaker demotion): "I
  // would basically always rather know what the best team is, and then
  // decide for myself if I don't want to spend the time grinding." The
  // requirement machinery stays — receipts ("Link Stone + Deep Sea Tooth,
  // 5% wild-held") still render, access gates still block, owned items
  // still short-circuit gates — but acquisition grind no longer moves any
  // score. The pricing code paths are kept alive (and pinned by tests under
  // explicit overrides) so re-enabling is a constants change, not a rebuild.
  FRIENDSHIP_FRICTION: 0, // friendship grind per evolution step
  ITEM_FRICTION: 0, // held-item / use-item evolution (farmable item)
  TRADE_FRICTION: 0, // Reborn trades via Link Stone — item-like
  TIME_FRICTION: 0, // day/night or minor special condition
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

  // --- Usage-convergence blend (formerly SCORING_V1, now the sole model;
  // see SCORING.md — V0 retired as Rejuvenation prep) -------------------------
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
  // --- Phase 3: teammate synergy (team fit degrades into competitive teams) --
  // Pair trust t = min(w_a, w_b) × hasData: the hand-built pair judgements
  // (shared weakness etc.) fade out with the mean pair trust while co-use
  // lift fades in per-pair; bias-driven coverage NEVER fades (user rulings).
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

  // --- Search ------------------------------------------------------------------
  SHORTLIST_MAX: 28,
  SHORTLIST_CORE: 14,
  FORCE_SHORTLIST: false, // test hook: force shortlist path for regret validation
  // Search enumeration budgets in team combinations C(N,6). Interactive
  // latency rules these, not search purity (a 36-mon pool is 1.95M combos —
  // 30-45s of every-core search per optimize under the old 2M/3M caps, paid
  // again on every background auto-reoptimize; user: "unacceptably long").
  // Above them the shortlist+polish path takes over. Tunable so the regret
  // validation can raise the cap to compute a TRUE exact baseline.
  AUTO_EXHAUSTIVE_BUDGET: 250_000, // background auto-reoptimize ceiling (~25 mons)
  EXHAUSTIVE_CAP: 1_000_000, // explicit-optimize ceiling (~32 mons)
  // Selection scores an optimistic (max-over-builds) coverage relaxation, so the
  // best relaxed team need not be best after concrete builds are assigned. The
  // search keeps this many top relaxed teams; realization re-ranks them by exact
  // realized score. Sized by regret validation (regret 0 well below this).
  REALIZATION_POOL: 64,
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
