# Scoring model — frozen core

This document freezes the scoring model's SHAPE. The main danger to this
project is no longer a missing feature — it is "one more clever tweak" turning
the scorer back into a credence laundry that reproduces whatever verdict its
author already believed. So:

> **Change policy.** The model shape below only changes through an explicit
> roadmap item. A constant in `src/teamBuilder/scoringConstants.js` only moves
> when a regression fixture (test/fixtures/) or an explicit roadmap item
> justifies it, and the changelog at the bottom of this file records which
> invariant or fixture the change improves. Golden snapshots (test/golden/)
> must be regenerated in the same commit, and unexplained snapshot drift is a
> review blocker, not a formality.

## The frozen shape (v0)

Individual value of a fielded build:

```
V = C + α·O·[U − C]₊ + bias − K          (selection uses V; F is display-only)

C   current-form usefulness = CURRENT_VALUE_SCALE × max(role scores)
      roles: fast_attacker, bulky_attacker, bulky_utility, fast_utility
      from stage-relative mechanical features (damage_q, speed_q, bulk_q,
      utility_q), geometric means so a role needs ALL its axes
U   competitive ceiling from usage/tier, on C's scale
O   readiness gate ∈ {0, BABY, MIDEVO, NEAR, 1} from concrete facts
α   usage influence — upside-only, gated by O, never sovereign
K   investment friction (evolution requirements + build friction), uniform rules
F   near-future option value — computed, shown, NEVER added to V
```

Team value:

```
teamScore(T) = Σ member V
             + COVERAGE_WEIGHT × [ damage-aware noisy-OR coverage
                                   + defensive shared-weakness term ]

coverage = Σ_types w_type · (1 − Π_members (1 − A(member, type)))
A(member, type) = min(1, best real hit into type / stage reference hit)
```

Invariants the shape encodes (each guarded by fixtures):

1. **Usage is upside-only** — reputation can lift a mon toward its ceiling,
   never drag down a mon that outperforms it now (`[U − C]₊`).
2. **A famous ceiling cannot carry a body that can't express it** — the O gate;
   a pre-evo that can't deal stage-real damage is a baby (`happiny-swap`,
   `weak-shell`, `high-ceiling-babies`).
3. **Chip moves are not coverage** — A(b,e) is damage-relative, so a 30-BP
   Lick contributes ~nothing (`coverage-semantics`).
4. **Coverage saturates** — the first real answer to a threat is worth a lot,
   the fourth almost nothing (noisy-OR by construction).
5. **Future value never picks the current six** — F is quarantined to the
   investment view (`high-ceiling-babies`).
6. **Legality is legal-with-friction, never verdict-fitting** — evolutions are
   gated by their real requirements plus uniform K, and unknown data is
   surfaced as unknown, not silently blocked (`item-friendship-evos`).
7. **Utility is real but subordinate** — a support movepool can't bench a
   genuine threat (`high-utility-low-offense`).

## Where things live

- **All tunable judgements**: `src/teamBuilder/scoringConstants.js` (one file,
  every default, sweepable via `setScoringOverrides`). Anything not in that
  file is a mechanical observation, not a preference.
- **C features/roles**: `src/teamBuilder/currentFormValue.js`
- **V assembly, U, O, bias**: `src/teamBuilder/candidateScoring.js`
- **Team coverage/defense**: `src/teamBuilder/searchKernel.js`
- **Evolution legality + friction**: `src/reborn/evolutionRequirements.js`,
  surfaced through `src/reborn/currentSpecies.js`
- **Score breakdown schema** (locked; consumers rely on these fields):
  `score`, `teamScore`, `legalityScore` (=C), `biasScore`, `ceiling` (=U),
  `online` (=O), `futureValue` (=F), `friction` (=K), `currentRole`,
  `currentFeatures`, `meaningfulUsage`, `usagePercent`, `rawCount`,
  `leadPercent` — plus build fields (`buildKey`, `buildAlternatives`) and
  provenance (`legalityProof`).

## Validation

- `npm test` — fast unit tests (damage/ability/coverage semantics).
- `npm run validate` — scenario fixtures + golden snapshots + shortlist regret.
- `npm run update-goldens` — regenerate snapshots (justify in the changelog).
- Fixtures assert INVARIANTS (must-seat / must-not-seat / role / fielded form),
  not a blessed six, unless the case is obvious.

## Changelog

- **v0 baseline** (scoring version 1.0.0-pre): the model as frozen at the
  start of the nine-phase roadmap — role-based stage-relative C, upside-only
  gated usage, damage-aware noisy-OR coverage, friction-based K, display-only
  F. Goldens captured before any roadmap phase landed.
- **Phase 4A (delayed-evolution K)**: moves that require delaying an evolution
  past its natural level are split out of the default build; using them costs
  `DELAYED_EVO_FRICTION` and is labelled. Improves invariant 6 (legality
  honesty). Affected fixtures: late-broad-froakie (Greninja's default set no
  longer assumes delayed-evo Hydro Pump).
- **Phase 4B (evolution requirements)**: item/hold/trade/time evolutions become
  legal-with-friction when their item is farmable (curated, sourced table),
  `unknown` stays blocked but surfaced. Improves invariant 6. Affected
  fixtures: item-friendship-evos (Happiny→Chansey legal via wild-held Oval
  Stone), weak-shell/happiny-swap re-verified — the Chansey line still must not
  seat at cap 25 (invariant 2 outranks the wider legality).
- **Phase 3 (multi-build)**: selection uses each line's best build with an
  optimistic coverage relaxation; the chosen six are realized by a
  post-selection build assignment (at most one build per line, dominance-pruned
  variants). Goldens regenerated where the realized build differs from the old
  single recommended set. Constant change: `portfolio_q` now uses a fixed
  3-slot denominator — without it a 2-attack utility set weakly dominated the
  standard set by averaging away its thin offense (caught by the multi-build
  smoke: every pick flipped to its utility build). Improves invariant 7.
- **Phase 4C (ability specificity)**: the optimizer never chooses an ability —
  a user annotation ("Froakie (Torrent)") pins it; otherwise the primary
  competitive ability is assumed, the assumption is displayed, and its measured
  sensitivity feeds the confidence sweep's `ABILITY_ASSUMPTION` axis.
- **Phase 5 (confidence)**: a fixed 21-setting one-at-a-time perturbation grid
  over every judgement axis (usage α, coverage weight/scale, portfolio,
  utility strictness, O-gate jitter, collapse penalties, R_cap blend, friction
  scale, ability assumption, shortlist size) reports per-mon inclusion
  frequency: core ≥90%, likely 60–90%, flex 25–60%, fragile <25%.
- **Phase 6 (search)**: the shortlist adds best-provider seats for immunities,
  speed, priority, utility infrastructure, and friction-free evolved forms;
  regret vs true exact search is a committed test (`test/validate/regret`).
- **Phase 9 (investment)**: future value moved wholly into the investment view
  (re-optimizing at the next level caps); `F` remains display-only in
  selection, as frozen.
- **Post-review correctness pass** (external review of the phase delivery):
  1. *Realization soundness*: the optimistic build relaxation can overstate a
     line by combining virtues of mutually incompatible builds, so the single
     best relaxed team need not be best after realization. Every search path
     now keeps the top `REALIZATION_POOL` (64) relaxed teams; realization
     assigns concrete builds to each and re-ranks by exact realized score.
     Improves the meaning of "exact"; goldens regenerated.
  2. *Sweep-safe build pruning*: dominance pruning across build variants now
     uses MECHANICAL facts only (per-type coverage, utility value, peak damage,
     friction — all invariant under every sweep axis), never scored value, and
     the confidence sweep re-picks each line's representative build per
     setting. Prevents default constants from deciding which alternatives
     exist during robustness testing ("stability theater").
  3. *Investment labeling*: the Phase 9 panel is a LEVEL-CAP projection and now
     says so — future TM/tutor/item/location unlocks are not modeled.
  4. *Performance*: damage estimates memoized across build variants (the
     multi-build resolution hot spot); wall-clock resolve/search timings
     surfaced in the provenance footer.
- **Audit pass** (second external review round):
  1. *Component-wise utility in pruning*: item 2 above still compared builds by
     the scalar `utilityValue` — a weighted judgement score, not sweep-invariant
     (its role weights are exactly what `UTILITY_ROLE_WEIGHT` perturbs). Build
     dominance now compares an accuracy-weighted per-tag utility VECTOR
     (`utilityTagVector`: recovery, hazards, hazard removal, speed control,
     setup, pivot, phazing, screens, disruption, status, priority) component-
     wise: A dominates B only if A ≥ B on every tag, every coverage component,
     peak damage, and A ≤ B on friction. A build that trades hazards for
     recovery now survives against one that trades recovery for hazards, no
     matter what the sweep thinks utility is worth. Strictly fewer prunes, so
     kept build sets can only widen; in the committed fixtures the surviving
     sets and goldens are unchanged (the scalar had not been pruning anything
     the vector keeps — the fix closes a latent hole, not a live bug).
  2. *Incremental-search exactness proven*: the incremental optimizer path
     (grown pool, warm cache) claims `searchExact: true`; the claim is sound
     because the step enumerates `choose(a of added) × choose(size−a of ALL
     old lines)` for every a ≥ 1 plus the cached exact optimum — not just
     neighborhoods of the old optimum. `test/validate/incremental-exactness`
     commits the adversarial fixture from the review: adding Sandshrew under a
     Ground/Rock opponent bias reshuffles the companions beyond the old optimum
     (Tentacool enters), and the warm incremental answer must equal a cold full
     exact search of the union pool, member for member. The fixture asserts the
     trap actually springs, so it can't silently decay into a trivial case.
  3. *Damage-memo key audit*: the memo key covers move, form-specific member
     id, ability, held item, and atk/spa/level (the only paths stats and level
     cap take into the estimate); data signature is unnecessary in-process
     (data is immutable per deploy; the persisted result cache is already
     data-signature-versioned). Documented in-code that any future field/boss
     awareness must join the key.
  4. *Browser performance telemetry* (`src/teamBuilder/telemetry.js`): every
     interactive optimizer run records resolve/search wall-clock, pool size,
     surviving build count, core count, and cache temperature (cold / warm /
     result-hit) into localStorage (last 500 samples); the provenance footer
     reports p50/p90/p95, and `__TEAM_TELEMETRY__` in the console exports raw
     samples. Confidence-sweep runs (active scoring overrides) and the
     investment projection's future-cap re-runs are excluded — they would
     corrupt the interactive latency distribution. Scoring-neutral: no golden
     impact.
- **Telemetry hardening** (third external review round; schema 2):
  1. *Environment stamping*: every sample carries `telemetry schema | app
     build id (vite __BUILD_ID__) | scoring version | data signature`, and the
     summary reads only samples matching the newest sample's environment — a
     deploy that changes any of those retires the old implementation's
     latencies from the percentiles (counted and shown as "N runs from
     previous builds excluded") instead of averaging slow-old with fast-new.
  2. *Workload segmentation*: percentiles are computed per (cache temperature
     × pool-size bucket 1–12 / 13–24 / 25–36 / 37+), with the build-count
     range and a low/≤48 / medium/≤96 / high bucket per segment — a cold run
     on pool 7 and one on pool 45 are different distributions.
  3. *Copy performance report*: a footer button copies redacted JSON (summary
     segments, last run, environment, core count — no pool, team, or query
     content; a unit test walks every key in the report tree to keep it that
     way) for pasting into bug reports.
  4. *Cancellation-ready schema*: samples record `cancelled` (always false
     today) and summaries count-but-exclude cancelled runs, so when optimizer
     cancellation lands it must record the aborted phase and elapsed ms — slow
     abandoned runs stay visible rather than vanishing.
  5. *Build-count fix* (caught by the first real-world report): the telemetry
     build counter read `buildChoices` off line-level choices, but makeChoice
     renames that field to `buildAlternatives` — so the `|| 1` fallback fired
     on every line and `builds` always equalled pool size (the report's 61/61
     giveaway). Now counts the real kept-variant total (e.g. 27 builds across
     a 12-line pool at badge 8).
- **Full-pipeline telemetry** (schema 3; a real 65-mon report showed a 44s
  user wait while telemetry claimed 2.9s — it measured only the optimizer
  core): the optimizer no longer records samples; it stamps
  `result.telemetryMeta` (cache temperature, pool size, builds, data
  signature, setup/resolve/search ms) and the pool widget records ONE sample
  per completed interactive pipeline with a `phases` breakdown — setup,
  resolve, search, items (team item context + usage), render (full page incl.
  the analysis panel), confidence, investment — plus `totalMs` (click → team
  on screen) and `fullMs` (click → post-analysis done). Summary segments gain
  a totalMs distribution and per-phase medians; the footer shows the last
  run's phase attribution. Superseded runs (a newer optimize started
  mid-analysis) are dropped, not recorded partially. The progress bar is
  phase-aware: line resolution shows a real fraction, then the label walks
  search → item loading with an indeterminate pulse instead of sitting at
  100% (N/N) through the actual wait.
- **Moveset starvation fix** (found by the schema-3 phase data on the same
  65-mon report: "44s to the moveset" while the optimizer core took ~3s): the
  confidence sweep's 21 settings each resolve synchronously, so the whole
  sweep ran inside ONE browser task — no paints, no fetch callbacks — and the
  async Team Analysis (movesets) panel starved behind it. Three changes:
  (1) the sweep yields a macrotask between settings; (2) post-analysis waits
  (bounded, 20s) for the movesets panel to be on screen before the sweep
  starts, and records that moment as `movesetMs` in telemetry; (3) the panel
  build is memoized by input signature — it used to be recomputed 4–5× per
  optimize (result render, pending render, confidence render, investment
  render), which also flashed the placeholder each time. Verified in headless
  Chromium on the 65-mon pool: movesets land WITH the team (+33s on a slow
  4-core container, sweep still running) instead of minutes behind it.
  Scoring-neutral: no golden impact.
- **Adaptive progress bar + cheaper sweep** (user report: the bar "spends most
  of its time on the right side, uselessly", and a 68-mon report showing
  confidence at 60–82s wall-clock on 16 cores):
  1. The bar now spans the whole optimizer window on per-phase TIME budgets
     estimated from this browser's telemetry history for the same pool bucket
     (`estimateRunBudget`; static defaults on first run, personal medians
     after). Countable scoring advances by real fraction; the search advances
     by elapsed-vs-budget with an asymptotic tail capped at 97%, pulsing only
     when a phase runs 2× past its budget. Verified in headless Chromium: a
     strictly increasing width series through a 30s search.
  2. Sweep-only cost reductions, verdict-preserving in intent: settings run
     with `REALIZATION_POOL: 8` (the sweep asks WHICH SIX SEAT, not for a
     perfectly re-ranked realization) and `benchSwaps: false` (hundreds of
     full team evaluations per setting feeding a UI the sweep never reads).
     The confidence-investment fixture still passes; representative tiers
     unchanged on the committed pools.
- **Sweep form-collapse: the actual whale** (CPU profile after the trims above
  barely moved the needle): 97% of sweep time was `bestAssignmentForLines` ×
  `fastTeamFit` — the per-combination cartesian re-assignment of every line's
  FORM options, paid on all C(20,6) combinations of every setting. Sweep lines
  now hand the search ONE form, removing the cartesian product. Measured:
  24-mon sweep 339s → 2.8s, 65-mon 816s → 8.5s in Node (~100×). The
  production search keeps full per-combination form assignment (exactness
  there is a promise).
  CORRECTION caught by re-tiering the real 65-mon pool: the first version
  fixed each line to its BASELINE best form rescored, so settings that perturb
  form choice — friction above all — read as "the line drops" instead of "the
  line downgrades a form" (Gastly went core→fragile because friction-heavy
  could no longer field Haunter instead of Link-Stone Gengar). The collapse
  therefore re-picks the representative form PER SETTING across all rescored
  form options (deterministic: teamScore, then pokemonId); what the sweep
  gives up is only per-TEAM-CONTEXT form switching for SAME-TYPING forms.
  The raw seat-frequency comparison (both sweep variants on the same 65-mon
  result) showed one-form-per-line was grossly unfaithful on branching lines
  (Eevee 18/21 → 8/21 seats, Cottonee 13→3, Magikarp 10→1, with single-form
  lines inheriting the seats) — team-context form choice is load-bearing
  exactly where forms differ in typing. Final shape: per setting, keep the
  argmax form plus up to two alternates whose TYPING differs from the kept
  ones (same-typing variants are pure score/friction choices the per-setting
  argmax already made — Gastly held its seats with Haunter/Gengar collapsed).
  Measured on the 65-mon pool: full-form sweep 812s, one-form 4.5s (broken),
  top-3-forms 515s (faithful, too slow), typing-aware 14.5s with every seat
  count within ±1 of the full sweep (Poliwag ±2, sitting exactly on the
  core/likely boundary at 90.5%). Fixture green.
- **Threshold split: scoring gate vs display demotion** (user asked to raise
  the 0.1% meaningful-usage bar to 1%, suspecting it no longer mattered): the
  full validate run proved it still does — `meaningfulUsage` is the FIRST key
  in candidate ordering, and at a 1% bar Kadabra outranked Alakazam (the
  fixture's fielded form flipped) because Alakazam's ~0.5% tier usage fell
  under it while score no longer got a vote. So the knobs are now separate:
  `MIN_MEANINGFUL_USAGE_PERCENT` stays 0.1 (scoring/ordering; also un-deadened
  — candidateScoring now reads it from the constants module instead of a
  hardcoded duplicate), and the new `TRACE_USAGE_PERCENT` (1) drives only the
  row-note "trace usage" label. Zero golden drift.
- **Evolution-method access gates** (user request — Probopass was recommended
  while the magnetic field area is locked behind Shade's gym / the Yureyal
  key): seven flat progression booleans (`evoAccess*`: friendship/affection,
  stones & held items, Link Stone, magnetic field, Moss Rock, Ice Rock, other
  special locations) gate `getEvolutionRequirement`. An explicit `false`
  makes the evolution BLOCKED — surfaced in blockedEvolutions and the
  explanation layer, never silent — instead of legal-with-friction; absent
  fields mean accessible, so old saved progressions and every existing
  fixture behave identically (zero golden drift). Trade-with-item evolutions
  require both the Link Stone and the item gate. Access rides the progression
  object, so cache keys (contextSig) separate gated and ungated runs
  automatically. UI: an "Evolution access" checkbox group in the Reborn
  Progression panel. Committed test: Nosepass fields Probopass by default and
  Nosepass (with Probopass listed as blocked, reason naming the gate) when
  magnetic-field access is off, end-to-end through the optimizer.
- **Usage sovereignty removed; friction made player-state-aware; meaningful
  bar to 1%** (user challenged the Kadabra/Alakazam flip — "if not for being
  propped up by usage, Kadabra was outscoring Alakazam?? I want to understand
  and solve whatever was causing this"):
  1. *Diagnosis*: Kadabra genuinely outscored Alakazam 1681 vs 1398 at badge
     4 / cap 45 — Alakazam's C lead is only ~107 points (both saturate the
     stage-relative percentiles; the extra 15 SpA / 15 Speed is mostly
     overkill at that stage) while its Link Stone costs K=390. The old
     `meaningfulUsage`-FIRST comparator silently seated Alakazam anyway
     because 0.13% usage cleared the 0.1% bar and Kadabra's 0.002% didn't —
     a lexicographic usage boolean overriding the entire value model is
     exactly what invariant 1 forbids.
  2. *Fix (comparators)*: `compareScoredCandidates` and `compareChoices` are
     score-first; usage breaks exact ties only. Usage still speaks INSIDE
     score (U, bias) — informative, never sovereign.
  3. *Fix (friction honesty)*: evolution items tracked in the owned-items
     inventory zero their step's acquisition friction and override their
     access gate ("Link Stone (owned)" in the proof) — friction models the
     grind of GETTING the item, and an owned item is already in the bag. Link
     Stone added to the inventory picker (REBORN_EXTRA_INVENTORY_ITEMS). With
     a Link Stone owned, Alakazam (C 1788, K 0) beats Kadabra again — the
     verdict now tracks the player's actual state instead of a usage artifact.
  4. *Bar to 1% everywhere*: `MIN_MEANINGFUL_USAGE_PERCENT` = 1 is now safe
     (no comparator gate) and single-sourced: `build-resolver-index.mjs`
     imports it, so `bundle.ranking` (Usage column, U-ceiling ranking, bench
     tiers) and the set-index tier sourcing regenerate at ≥1% — a mon shows
     "trace" only when NO tier reaches 1%. TRACE_USAGE_PERCENT (the interim
     display-only split) is removed. Goldens regenerated: representatives may
     legitimately shift where a boolean previously overrode score, and sets
     now source from first-≥1% tiers.
  Guarded by `test/validate/usage-sovereignty.test.mjs`: every line's
  representative must be its highest-scoring candidate, and an owned Link
  Stone must zero trade friction and flip the Abra line to Alakazam.
  Observed golden drift, audited fixture by fixture: midgame-broad fields
  Kadabra for the Abra line (the diagnosed case — no Link Stone owned in the
  fixture gamestate); item-friendship-evos seats Growlithe→Arcanine and
  fields Poliwhirl over Poliwag (score-first comparison letting evolved forms
  win where the usage boolean previously vetoed their trace usage — their
  SCORES always won); all other drift is score-only (−52 to +79) from
  ≥1%-tier set sourcing and the U-ranking floor. Every fixture's own
  invariant expectations (must-seat / must-not-seat / role / form arrays)
  passed before regeneration.
