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
- **Fixed-damage honesty** (user report: lvl-25 Mankey recommended Seismic
  Toss; distrust of Super Fang's number): the old model faked fixed-damage
  moves as base-power equivalents run through the stat/STAB formula — Seismic
  Toss priced as "60 BP with STAB" (90 flat at ANY level), Super Fang as "90
  BP" (135 with STAB). `damageModel.fixedMoveDamage` now returns real in-game
  damage: Seismic Toss / Night Shade = the user's level; Psywave = 0.75×level;
  Sonic Boom 20 / Dragon Rage 40 flat; Super Fang / Nature's Madness = half a
  typical body's HP at that level (`referenceHp`: median base-70 HP, IV 31 —
  the same neutral-wall convention as defenses; 77 HP at 25 → 39); no stats,
  no STAB, no item boosts. Verified: Mankey at cap 25 now headlines Cross
  Chop (47) with Seismic Toss unpicked; Watchog drops Super Fang. Improves
  invariant 3 (chip and fiction are not coverage). Unit tests added.
- **Evolution K demoted to a tiebreaker** (user decision, closing the
  Kadabra/Alakazam case): with evolution ACCESS modeled explicitly (gates +
  owned items), charging acquisition friction on top double-counted
  obtainability and let a pre-evolution outscore its own evolution (Kadabra
  1681 vs Alakazam 1398 at K=390). Ground truth — Alakazam is better — is now
  restored through score itself: FRIENDSHIP/ITEM/TRADE/TIME friction drop to
  15/20/20/5 (tiebreak toward the cheaper line among near-equals, never
  outweighing a real stat gap; measured: Alakazam 1758 vs Kadabra 1681,
  fielded again). The score-first comparators stay — Kadabra never traded on
  Alakazam's reputation, because C and the O gate score the fielded form's
  own body; the removed usage boolean was protecting nothing.
  DELAYED_EVO_FRICTION (200) is unchanged: delaying evolution for a move is a
  real in-run cost the access model doesn't express. Goldens regenerated for
  both entries in one audited pass.
  Fixture consequences of the K demotion, each audited: item-friendship-evos
  now accepts Raichu-Alola for the Pichu line (the stone is farmable and
  accessible, so the better final form fielding IS the new model working — the
  old expectation encoded price-K reasoning); the incremental-exactness trap
  was re-tuned (the old Sandshrew/Ground-Rock reshuffle relied on
  friction-heavy dynamics; grid search found a fresh verified trap — waterfly
  pool + Gastly under Flying bias, Surskit entering from outside the old
  optimum — and the fixture's own anti-decay guard is what caught the stale
  trap). Invariant-2 guards (Chansey line must not seat at cap 25) passed
  throughout the K change untouched.
  (Also accepted after the same audit: the Happiny line may field Blissey —
  Oval Stone + friendship are both accessible chains under tiebreaker K. The
  seating guard is untouched: weak-shell / happiny-swap still assert the line
  cannot SEAT at cap 25, and they pass.)
- **Fixed-damage coverage semantics** (follow-up to the fixed-damage fix; the
  residual inaccuracy was called out and the user asked for it closed): a
  fixed-damage move's coverage contribution was still multiplied by type
  effectiveness. Gen 7 rules now apply everywhere: flat damage into everything
  the move's type can touch — never super effective, never resisted — and
  zero into immunities (Seismic Toss can't touch Ghosts, Night Shade can't
  touch Normals). `damageModel.coverageDamageIntoType` is the single rule;
  fixed moves also stopped claiming super-effective targets in the offense
  summaries and no longer make a member "a Fighting attacker" for
  attack-type/bias-counter purposes (their type only decides immunities).
  Improves invariant 3. Unit-tested.
- **Mantyke/Mantine pair of fixes** (user report: an owned Mantyke was
  recommended Mantine despite no Remoraid in the party):
  1. *Party-condition access gate — the reported bug*: "with a Remoraid in
     party" was mapped as a trivial condition (no gate); it now has its own
     evolution-access checkbox — a Mantyke input without Remoraid access
     stays Mantyke, with Mantine surfaced as blocked.
  2. *Pre-evolution representatives excluded — a latent bug found while
     chasing the report*: a line's usage representative could be a strict
     PRE-evolution of the input (an owned Mantine name-badged and set-sourced
     as Eviolite Mantyke because Mantyke owns the LC tier), boosting the
     line's U with a tier the fielded form can never inhabit again.
     Candidates that are strict ancestors of the input are now dropped at
     line resolution (descendants and megas stay — those are real futures).
     Persisted result cache bumped to v10 (this plus the fixed-damage and
     tiebreaker-K changes all altered optimizer output without a
     data-signature change).
  Committed tests cover both: the gate in both directions, and that an owned
  Mantine's line never carries a Mantyke candidate.
- **Hidden Power gated behind the Type Changer** (user report: recommended
  Hidden Power scored as the impossible "Hidden Power Normal"): before
  Reborn's Type Changer, HP's type is a per-mon IV lottery — not a plannable
  move — so it is excluded from legality outright (new progression checkbox,
  default locked). Once unlocked, it expands into all 16 real Gen 7 variants
  (every type except Normal and Fairy) with distinct ids, the recommender
  evaluates each type separately and picks the best, and a set carries at
  most ONE Hidden Power. Committed tests cover the gate, the variant
  expansion, and the one-per-set cap.
- **Do-nothing status moves carry no utility; fixed damage is a first-class
  attack again** (user report: Lopunny recommended Splash):
  1. *The actual cause, established by reproduction*: base Lopunny's stitched
     set index is primary-sourced from Gen 7 ZU @ 1500, where meme Splash
     sets are real enough for 17.7% move usage; the move-meta generator
     blanket-flagged every status move as utility; and the UTILITY-preference
     build ranks utility moves by usage — so Splash out-ranked genuine role
     moves into the utility build (`return, healingwish, magiccoat, splash`).
     It was never in the canonical top-4 (Switcheroo / Return / High Jump
     Kick / Fake Out), and the default and coverage builds never carried it.
  2. *The fix — generator truth only*: a reviewed do-nothing list (Splash,
     Celebrate, Hold Hands, Happy Hour, Gen-7 Teleport — no effect in a
     Gen 7 trainer battle) now gets `utility: false`, so no utility-ranked
     path (utility build, utility-slot guarantee, bonus-utility fill) can
     seat them. Splash stays fully LEGAL.
  3. *Explicit non-fix (user decision)*: the canonical top-4 is NOT gated —
     a first attempted fix that barred non-valuable moves from the canonical
     step was reverted. If the meaningful tier's real sets run a move, the
     recommendation may too; usage stays sovereign for the canonical set,
     and a committed test locks that in.
  4. *Latent regression found while investigating*: since the fixed-damage
     honesty change deleted the fake effective-power table,
     `isDamagingMove` (base power > 0) had classified Seismic Toss-class
     moves as NON-attacks — they could only enter sets as if they were
     status moves, contributed zero coverage (the flat-into-non-immune
     semantics from the coverage-semantics entry above were dead code on
     the profile path — Bronzor's Psywave and Gastly's Night Shade carried
     no offense), and were invisible to the one-attack guarantee.
     `isDamagingMove` now counts fixed-damage moves; their flat typeless
     coverage contribution is live; and every type-reasoning site
     (attack-type summaries, STAB picks, coverage-type sets, gem
     assignment) explicitly skips them. Improves invariants 3 and 6.
     Golden drift audited and regenerated: Bronzor 818→853 (Psywave's flat
     coverage going live) and Gastly 1198→1228 (Night Shade) — the
     previously-approved fixed-damage coverage semantics finally taking
     effect on the profile path. No team-seating changes. One recorded O
     flip inside the Gastly line (1→0.35): both Gengar candidates rose and
     the Mega Gengar-ceiling candidate (1228, O=0.35 mid-evo readiness
     toward the mega) now edges the plain-Gengar candidate (1226, O=1) in
     a near-tie; fielded form (gengar), role, and seating are unchanged,
     and Night Shade at 25 flat genuinely is the line's hardest hit at
     cap 25.
  Committed tests cover the meta flags, the utility build refusing Splash
  under the real ZU-shaped usage, canonical sovereignty (a top-4 Splash IS
  kept), and the fixed-damage profile semantics (counts as attack, no attack
  type, no SE targets, no STAB, flat coverage with Ghost immunity at zero).
- **Splash verdict reversed (user decision), and canonical sets now source
  from the eventual form** (follow-ups to the Lopunny/Splash entry above):
  1. *Do-nothing list deleted*: Splash on ZU Lopunny is a real fringe set
     (Z-Splash = +3 Atk), not a meme artifact — and in Gen 7 every status
     move has a Z-effect, so "does nothing" cannot be decided from the dex.
     The generator's blanket "status ⇒ utility" rule is restored; usage is
     the arbiter. What actually keeps filler out is unchanged and now
     tested: every utility-ranked path requires usage > 0 or a curated
     utility weight, so a move nobody runs is never recommended. Result
     cache bumped to v12 (utility builds change back).
  2. *Set sourcing follows the ultimate eventual form* (user decision:
     Venusaur, not Bulbasaur; FEAR Rattata stays Rattata because its OWN
     meaningful AG usage makes it the representative): the Team Analysis
     pane sourced its displayed set from the FIELDED form's stitched index,
     while the optimizer scored with the CHOSEN CANDIDATE's — a
     Lopunny-Mega pick (meaningful at AG 1760) displayed base Lopunny's
     ZU-primary sets, which is where the Splash sighting actually came
     from. The analysis now sources spread/ability/item/move usage from the
     representative id, exactly what the score was built on (fielded-form
     fallback when a representative has no set data). Committed tests
     cover both directions (mega rep → AG set, Scrappy, Lopunnite; base
     rep → ZU set, Klutz) plus the zero-usage-filler guard.
- **Snore's sleep gate is set-conditional** (user report: a Sub/Nuzzle/Volt
  Switch Dedenne was recommended Snore): Snore only deals damage while its
  user sleeps, but the gate asked whether Rest was in the LEGAL POOL —
  Dedenne's pool has Rest, so Snore counted as a usable attack (and, with
  SpA investment, out-ranked Facade as the "best Normal hit") in a set with
  no way to sleep. The recommender now judges the sleep context against the
  SET BEING BUILT, re-evaluated as it grows: Snore is dead until Rest is
  actually selected, and a canonical Rest earlier in usage order still
  re-enables a canonical Snore (RestSnore sets stay real). Pool-level
  counts (legalDamagingMoveCount) keep constructibility semantics.
  Improves invariant 3 (chip and fiction are not coverage). Result cache
  v13. Committed tests cover both directions.
- **Pre-evolution-only level-up moves restored to legality** (user report:
  Linoone recommended Double-Edge + Headbutt over Pin Missile — Pin Missile
  was missing from Linoone's legal pool entirely): the legal-moves generator
  attached pre-evolution level-up LEVELS only to moves the evolved form also
  knows itself; a move the evolved form dropped (Zigzagoon's Pin Missile 19
  vs Gen 7 Linoone) never got an entry at all. Pre-evo egg moves were
  unaffected. One-line generator fix; 181 Pokémon files gained moves
  (Poliwrath: Hydro Pump / Belly Drum / Body Slam; Kanto Raichu: Nasty
  Plot / Discharge; Vigoroth: Slack Off; the eeveelutions: Eevee's kit...).
  Improves invariant 6 (legality honesty) — this is a data-truth fix, so
  caches retire via the data signature, no result-cache bump.
  Golden drift audited and regenerated — every fixture INVARIANT passed
  throughout; only snapshots moved:
  - unique-immunity: Poliwag fields Poliwrath over Poliwhirl (a stone evo
    reaches every pre-evo level, and Poliwrath now carries the real kit).
  - item-friendship-evos: Pichu fields Kanto Raichu over Alolan (Nasty
    Plot / Discharge flip a near-tie between two stone forms).
  - midgame-broad: Eevee fields Sylveon over Jolteon (both gained Eevee's
    moves; a near-tie reshuffled).
  - Score-only drifts (Slakoth −37, Crabrawler +5, Shellder +11): set
    recomposition under the wider pools; the greedy set builder is
    deliberately not monotone in pool size.
- **Delayed evolutions name the form being delayed, judged per-ancestor**
  (user report: Slaking's set said "requires delayed evolution" on both
  Focus Punch and Play Rough, hiding that they delay DIFFERENT evolutions —
  Focus Punch is Vigoroth@37, delay Vigoroth→Slaking past 36; Play Rough is
  Slakoth@38, delay Slakoth→Vigoroth past 18): pre-evolution level-up
  entries now carry their ancestor id ({ level, from }), each level is
  judged against THAT form's own natural departure, and the label reads
  "Level 38 (requires keeping Slakoth unevolved to 38)".
  This also fixes a latent misclassification the old merged list admitted
  in a comment — every level was judged against the DIRECT pre-evo's
  departure only:
  - Deep-chain moves from the first stage read as natural when the later
    hop had no level (Machop's late moves on Machamp — trade evo;
    Gastly's post-25 moves on Gengar; Mareep's 16–30 moves on Ampharos).
    Now correctly delayed. Slaking's Chip Away headline corrects from a
    false natural "Level 25" (Slakoth's) to the honest "Level 27".
  - Friendship-chain first-stage moves read as delayed against the later
    level hop (Azurill's moves on Azumarill judged against Marill→18).
    Friendship evolutions have no forced level, so these are natural
    (weak-shell golden: Azurill 1269→1376).
  Improves invariant 6. Golden drift audited and regenerated: midgame-broad
  reseats (Gengar and Ampharos in; Arcanine and Machamp out) as the
  corrected legality rebalances the pool; all fixture INVARIANTS passed
  throughout. Data-format change (attributed entries) regenerated across
  all legal-move files; caches retire via the data signature.
- **Confession audit** (user request: find other comments admitting their own
  misclassifications, after the Slaking case). Full sweep of src/ and the
  generators; the ability assumption, naive-damage labeling, investment-view
  scope note, and the charge/recharge tempo weights were re-reviewed and
  deliberately left alone (surfaced or defensible judgments). Four fixes:
  1. *Psywave at expected value*: code said 0.75×level while its own comment
     said "uniform 0.5×–1.5×" (mean 1.0×). The model prices randomness at
     expected value everywhere else; now here too. Bronzor 853→931 (flat
     coverage of Psywave).
  2. *Multi-hit expected count*: "[min,max] average" used the midpoint 3.5,
     but the Gen 5+ 2–5-hit roll is 35/35/15/15 → E[hits]=3.1; every Pin
     Missile-class move was overrated ~13%. Hoppip 1433→1383 (Bullet Seed),
     Shellder 1244→1214 (Icicle Spear).
  3. *Universal TMs denied to the no-TM species* (user-verified ground truth:
     Wobbuffet's only machine move is its explicitly-listed Safeguard, as in
     USUM): the movepool-size guard was nearly a no-op — intrinsic counts
     egg/compatible moves, so even Caterpie cleared it — and all of
     Caterpie / Metapod / Weedle / Kakuna / Wurmple / Silcoon / Cascoon /
     Kricketot / Combee / Magikarp / Ditto / Unown / Wobbuffet / Wynaut /
     Beldum / Tynamo / Smeargle carried ~15 bogus TMs (Toxic Magikarp,
     Facade Caterpie). Curated exclusion list; explicit per-species machine
     listings survive (Wobbuffet keeps Safeguard, Tynamo keeps Reborn's
     explicit Charge Beam / Thunder Wave). No golden drift — no fixture set
     leaned on the bogus TMs.
  4. *Doc rot*: currentFormValue's header still claimed utility_q was
     "coarse — only a boolean utility flag"; the role-aware, accuracy-
     weighted system has long since landed. Header corrected.
  Golden drift audited and regenerated: score-only, no seating changes.
- **Smeargle sketches the whole move universe** (user note, extending the
  no-TM-species fix): Smeargle's legal pool was literally [Sketch]. Sketch
  copies any move ever used in battle, so its practical pool is every move
  in Reborn's data (691 moves), at any level, with no unlock — now emitted
  with a `sketch` source rendered as "Sketch". Gen 7 exceptions honored:
  Chatter and Struggle cannot be sketched. Smeargle stays on the
  no-universal-TM list (its machine list is genuinely empty; the moves come
  from Sketch, not TMs). No golden drift — Smeargle is in no fixture pool.
- **Elective evolutions gate every pre-evolution move** (user report: a
  Musharna card listed Munna's Moonlight@17 / Calm Mind@35 / Psychic@37 as
  plain naturals — "a classic stone evolution where many moves are
  permanently gated behind the pre-evo"): the attribution fix had classified
  ALL no-forced-level hops as "nothing is delayed", which is right for
  friendship (the grind builds gradually while training, so the pre-evo
  naturally spans levels) but wrong for elective triggers. Departure is now
  per hop TYPE: level hops use their recorded level; friendship/affection
  hops stay Infinity (natural); item / trade / location / party hops are 0 —
  the default evolve-ASAP path takes them the moment they're available, so
  EVERY pre-evo level-up move requires deliberately keeping the form
  unevolved, priced as the delayed build. Improves invariant 6.
  Golden drift audited and regenerated — the classic stone-gated bodies drop
  to their honest evolve-ASAP value: Growlithe/Arcanine 1561→1361 (Arcanine
  learns almost nothing itself), Shellder/Cloyster 1214→1091, Igglybuff/
  Wigglytuff 1165→1030, Crabrawler/Crabominable −5; item-friendship-evos
  reseats Steelix over the deflated Arcanine. All fixture invariants held.
  Committed tests pin Musharna's three moves as delay-gated and Azurill's
  friendship chain as natural.
- **Alolan evolutions require Apophyll** (user report: "friendship, then a
  Thunder Stone is insufficient to get Raichu-Alola. You need friendship,
  then a Thunder Stone *in Apophyll*" — Reborn's Alola-equivalent area):
  the dex's `evoRegion` field now flows into the progression species table,
  and species whose evolution is region-locked to Alola gate on a new
  `evoAccessApophyll` toggle (default open, like every access gate).
  Affected: Raichu-Alola, Exeggutor-Alola. User-verified exception:
  Reborn removed Marowak-Alola's location requirement — Cubone picks the
  form by time of day (Kanto Marowak by day at 28, Alolan at night at 28),
  so `marowakalola` is exempt and both Marowak paths note the time-of-day
  rider instead. Evolution notes and legality reasons name the rider
  ("friendship, then Thunder Stone, in Apophyll"). No golden drift
  expected: the gate defaults to accessible and no friction changed.
- **Badge-keyed progression timeline (usage-convergence Phase 0)** — UI/data
  only, NO scoring change: the atomic unit the player deals with is now
  badges earned (or post-game tier), not a hand-typed level cap. A curated
  timeline (`src/reborn/badgeTimeline.js`, from BIGJRA's walkthrough — the
  project's canonical progression source) maps each of the 19 badge
  checkpoints and 10 post-game tiers to its level cap (20→150; Strike,
  Gravity, and Torrent are flat; Corey and Kiki award no badge) plus the
  badge at which scheduled unlocks are reached (daycare @1, Link Stone and
  magnetic field @3, Apophyll @4, Mossy Rock + relearner @5, Icy Rock @7,
  HP Type Changer @9, headline items like Eviolite @9). The picker derives
  `levelCap`; user clicks stay the sole authority for what is available NOW
  — the timeline only schedules ("N obtainable now" hints). 14 TMs missing
  badge availability (caught by the new panel↔timeline consistency test)
  were filled from the walkthrough. `levelCap` normalization now allows
  post-game caps up to 150 (stat/damage math still clamps to 100
  internally). Golden drift audited and regenerated: badge-derived fixture
  progressions now GRANT the 14 previously-invisible TMs (the harness
  derives TM sets from these very availability strings), so legal pools
  grew at badge >= 4 — Slaking 1648→1695 and Swirlix 932→1061 (TM44 Rest:
  full-weight recovery), Butterfree reroles to fast_utility, Slaking seats
  over Forretress in a near-tie; Tentacruel 1388→1362 reroles to
  fast_attacker (new Sludge Wave/Venoshock re-pick its set and displace
  utility moves — set selection is not monotone in pool size). All fixture
  invariants held.
- **Breeding chains: shortest chain first, earliest acquisition as the
  tiebreak** (user request, corrected after gameplay): among multiple legal
  donors the old chain took whichever sat first in pool order. First
  attempt ranked by acquisition level with hops as tiebreak — wrong: a
  2-step Granbull chain (Granbull's own Double-Edge is egg-only) beat
  Zebstrika's direct donors. User rule: FEWEST HOPS is primary, lowest
  acquisition level breaks ties, then path names for determinism.
  Multi-hop chains inherit the upstream donor's level/root-acquisition and
  spell every step ("Azumarill → Granbull breeding chain (@1)"). The
  parenthetical always demonstrates how the ROOT learner gets the move:
  "@24" level-up, "evo@32" evolution move (Pangoro's Bullet Punch),
  "TM42"/"Sketch" for taught sources. No golden drift — every fixture has
  the daycare locked. Pinned by real-data tests (Azumarill's Amnesia:
  Quagsire@24 over Golduck@41/Slowbro@43; Zebstrika's Double-Edge:
  Linoone@35 direct over any 2-step chain; Hariyama's Bullet Punch:
  "Pangoro breeding chain (evo@32)").
- **Canonical-set readiness badges (usage-convergence Phase 1)** — display
  only, NO scoring change: every analysis set card now carries one line of
  truth about the represented form's competitive set ("Competitive set: 1/4
  moves · item ? · full at cap 80", per-element breakdown in the tooltip).
  Each element of the canonical top-4-usage set plus the canonical item maps
  to when it becomes assemblable: level-up moves at their level, TM/tutor
  moves at their unlock badge's cap (from the Phase 0 timeline +
  availability strings), items at their timeline badge, egg-only moves
  flagged as daycare/chain-dependent. Definitional rules (user-ratified): a
  level-scaling move (Seismic Toss class) in the canonical set pins "full
  at" to cap 100; abilities are ALWAYS ready (user-verified Reborn
  mechanics: HAs distributed evenly at catch, Ability Capsules switch
  between all abilities from the start — this also closes the roadmap's
  HA-availability audit: the optimizer's assumed competitive ability is
  legitimate in Reborn). When everything missing is already reachable at
  the current gamestate, the line says "pickups pending" instead of naming
  an already-passed cap. This is the calibration gate for Phase 2's sliding
  usage blend: L* only becomes a scoring input once these badges survive
  gameplay. No golden drift — readiness is computed in the analysis path
  and never feeds V.
- **SCORING_V1: the usage-convergence blend (Phase 2)** — opt-in per run
  (UI toggle next to Optimize, default V1 in the app; the frozen DEFAULTS
  stay V0 so every existing golden is byte-stable and tests opt in
  explicitly). User-ratified design:
  `V1 = C + w_up·[U−C]₊ − w_down·[C−U]₊ + bias − (1−w_down)·(K + ability)`
  with `w_up = max(α·O, ramp)`, `w_down = ramp`,
  `ramp = O_rep · min((cap/L*)², r_now)`. The α·O floor keeps V0's
  upside-only shape early; only the EARNED ramp can drag an
  over-performing C down toward the usage prior or melt friction — at
  ramp = 1 the score IS the usage prior (+ bias). O_rep: the ramp applies
  only when the fielded form is the line's usage representative
  (a deliberately-unevolved pre-evo keeps V0 treatment). L* from the
  Phase 1 readiness schedule; r_now (canonical moves actually assembled)
  caps the ramp so reachable-but-unclicked never scores as done; items
  reach w only through L* (endgame items are purchasable at will).
  U is redefined as the tier-dominant rank scalar
  `U_rank = 101·tierIndex + quantize(usage%, 0.001) + ε·C` (user design;
  101 strictly exceeds any usage% — the user's proposed 50 fails on
  >50%-usage mons), monotonically rescaled to C's scale. ε·C is a PROVABLE
  tiebreak: ε·C_max < one usage quantum, asserted by a validate test.
  Invariants (revised per user: team composition stays coverage-driven,
  early-cap byte-identity dropped — FEAR-class mons legitimately converge
  early): pairwise endgame rank agreement among fully-converged lines,
  w monotone in cap at a fixed schedule, pre-evo never ramps, plus a V1
  golden (v1-midgame-broad: Dodrio 1536→1117 dragged to its honest prior,
  Arcanine +156, Magnezone +124 — the blend working as intended).
  V0 goldens untouched; model choice folded into every cache signature.
- **SCORING_V1 correction: w is line-anchored** (user report, same session:
  base Doduo outseated Dodrio at high cap): per-candidate w let a pre-evo
  with a trivially-complete set keep its raw C at w=0 while the line's real
  form (Dodrio, NU — Doduo is only LC, a deeper tier) converged to its
  scaled prior and lost to its own pre-evolution. User law: the line's
  representative is the form with the best FIRST-MEANINGFUL TIER (usage %
  breaks ties; FEAR-class pre-evos win this legitimately), and its ramp is
  THE line's w — every form blends under that same w against its OWN
  prior. Consequences verified: Dodrio 1199 now beats Doduo 507 (both
  w=0.75); a line whose representative cannot field yet (Dragonite at cap
  45) carries zero usage trust, so its fieldable mid-form keeps the honest
  V0 shape — the intended early-game semantics. V1 golden regenerated and
  audited (near-tie midgame reseats: Dragonair/Poliwhirl in, Arcanine/
  Ampharos out, Eevee flips Vaporeon→Sylveon; per-line deltas ≤ 13 points,
  amplified by team coverage). V0 goldens untouched.
- **Full held-item timeline** (user request + user-supplied community item
  guide): item readiness previously knew only 16 hand-curated headline
  items; the timeline now times 352 of the 370 known held items. Sources,
  earliest wins: (1) the community "Ep19 Items & Services Guide"
  spreadsheet (All Items Locations + Shops + Arcade Lottery), its fight
  order mapped to badge counts (Corey/Kiki/Saphira award no badge;
  post-game collapses to 18) — extracted to
  site-data/data/reborn-item-availability.extracted.json and compiled by
  scripts/build-item-timeline.mjs; (2) the Mining Items tab, all unlocked
  with the Mining Kit at badge 3 (Grand Stairway, right after Shelly);
  (3) a user-curated wild-held table ("available when the holder is
  catchable"): Black Sludge @0 (Grimer immediate), Metronome @0
  (Kricketot), King's Rock @1 (Poliwag line — beats the sheet's badge-13
  pickup), etc. Hand-curated checkpoint entries stay authoritative and
  cross-validated against the sheet (Eviolite 9, Focus Sash 2, Choice
  Band 14 all agree). V0 goldens untouched (readiness never feeds V0);
  V1 golden regenerated and audited — canonical items that were
  "timing untracked" now resolve, so L* firms up and the midgame team
  reseats toward Dodrio/Gengar/Ampharos (Dodrio 1117→1423).
- **Badge-0 items no longer pin L* to cap 100** (user report: Roserade read
  "full at cap 100" when its only real gate was a badge-14 tutor, because
  its canonical Black Sludge — obtainable immediately via wild Grimer,
  badge 0 — fell through a `badge-0` checkpoint lookup to the cap-100
  fallback; the badge-0 checkpoint is named "start"). Earliest-available
  items were reading as the LATEST possible gate. Readiness details now
  phrase badge 0 as "from the start". No golden drift. Pinned by a test
  (badge-0 item + badge-13 TM ⇒ full at cap 80).
- **Per-stone evolution access** (user request: "check individually which
  stones I have access to at the moment"): the blanket "Evolution stones &
  held items" gate split into ten per-stone gates (Fire/Water/Thunder/Leaf/
  Moon/Sun/Shiny/Dusk/Dawn/Ice Stone) plus one "Other evolution items"
  gate for the Metal Coat class. Each stone's evolution now checks ITS OWN
  gate (blocking Fire Stone no longer touches Vileplume); the panel
  annotates each stone with its earliest badge from the item timeline
  (Moon @1; Fire/Water/Thunder/Leaf/Ice @2; Sun/Shiny/Dusk/Dawn @3, two
  via mining). Owning the specific stone still overrides its gate. Legacy
  saves with `evoAccessStones: false` block all item gates, both raw and
  via a normalization migration to the new keys. No golden drift —
  fixtures never blocked stones.
- **MIN_MEANINGFUL_USAGE_PERCENT 1 → 2** (user judgement, after playing
  with V1: "a little too tilted in favor of fringe AG mons"): 1–2%
  appearances in a tier no longer count as that mon's first-meaningful
  tier. This moves everything the threshold feeds: first-meaningful-tier
  ranking (and therefore V1's tier-dominant U_rank and the line-anchored
  representative choice), the eventual-form law (a pre-evo whose only
  claim was a 1–2% AG showing loses its own-representative status), the
  Usage column, trace-usage notes, and the resolver/set indexes
  (regenerated in this commit, 785 data files — set sourcing now skips
  tiers where usage sits below 2%). Golden drift audited and regenerated:
  score-only shifts across 8 fixtures (U ceilings reshuffled as headline
  tiers moved deeper for fringe mons; e.g. early-weak-froakie lines ±20–50
  points); NO fixture team reseated. All invariants held, 61/61.
- **MIN_MEANINGFUL_USAGE_PERCENT 2 → 2.7345 (derived)** (user judgement,
  second iteration: "better, but not quite"): the cutoff is now the p
  solving 1−(1−p)^25 = 0.5 — the usage share at which a mon has even odds
  of appearing at least once across 25 games — stored as the exact
  expression `100·(1 − 0.5^(1/25))`, not a magic decimal. Same blast
  radius as the 1→2 change: first-meaningful-tier ranking (V1 U_rank +
  line representative), eventual-form law, Usage column, trace notes
  (display now rounds to "<2.73%"), and the baked resolver/set indexes
  (regenerated, 384 data files). Golden drift audited and regenerated:
  score-only, 7 fixtures, ±11–28 points, no seats changed. 61/61.
- **Below-arrival pre-evo levels are relearner-only** (user report: Manectric's
  Uproar recommended "Slaking breeding chain (@1)" — an invalid donor):
  Slaking's Uproar is attributed Vigoroth@1/@9, but Vigoroth only EXISTS
  from level 18 (Slakoth's departure) — levels below a form's ARRIVAL are
  unreachable by leveling on any path. The natural-path filter checked only
  the upper bound (level ≤ departure); it now also requires level ≥ arrival
  (the form's own evolution level; base forms arrive at 1, non-level
  evolutions any time). Below-arrival entries surface only when the move
  relearner is unlocked, labeled "Move relearner". Second half (user: "even
  if I did, much more work than a level-up"): breeding donor pricing now
  rates relearner sources ABOVE any natural level (cost 200), so a
  relearner donor can never win the earliest-acquisition tiebreak — Exploud
  (@27 level-up) beats Slaking even with the relearner unlocked. No golden
  drift; pinned by two tests (Slaking loses Uproar entirely without the
  relearner; Exploud wins the Manectric chain with it).
  CORRECTED same session (user): Reborn's Common Candy makes below-arrival
  levels at 2+ reachable — candy the form below the level, level back up
  (Vigoroth candies to 8, learns Uproar at 9). Only level-1 entries stay
  relearner-only (you never level UP to 1). Below-arrival 2+ entries are
  now a natural source labeled "Level 9 (Vigoroth, candy down)", gated on
  the form being reachable at the cap (no Uproar at cap 15 — no Vigoroth
  to candy). Donor pricing follows the user's ruling ("Vigoroth@9 is
  faster than Exploud@27"): Slaking wins the Manectric chain at @9, and
  the phantom @1 stays dead. Tests updated to pin the corrected behavior.
- **Breeding chains credit the form that actually learns the move** (user
  report, same thread: "Slaking breeding chain (@9)" for a move only
  Vigoroth learns — "Slaking doesn't come to it at all"): when a donor's
  acquisition source names the learning form ("Level 9 (Vigoroth, candy
  down)", "Level 38 (Slakoth)"), the chain's donor step is that form, not
  the fielded species: "Vigoroth breeding chain (@9)". Intermediate hops
  keep species names. No golden drift (fixtures keep daycare locked).
- **Phase 3 scaffolding: team fit degrades into competitive teams** (user
  design, extending V1's philosophy): as pair trust grows, the hand-built
  team-fit judgements fade out and competitive teammate co-use lift fades
  in. Pair trust t = min(w_a, w_b) × hasData (the two lines' V1 ramps, only
  where the extracted teammate index has an opinion). Synergy = SYNERGY_SCALE
  × Σ t·lift fades IN per-pair; the coverage noisy-OR, shared-weakness,
  uncovered-weakness, and resist-stack judgements all fade OUT with the
  MEAN pair trust — to ZERO at full convergence with data (user ruling) —
  EXCEPT the bias-boosted share of coverage, which never fades (bias is the
  Reborn-specific insurance no ladder prior covers). All-trust-0 (V0 model,
  incomplete sets, or missing data) reduces EXACTLY to the original
  formula, so V0 goldens are byte-stable by construction. Data:
  scripts/build-teammate-index.mjs extracts each mon's FIRST-MEANINGFUL-
  tier Teammates lift (same tier law as sets) from Smogon text stats,
  weight-averaged over the 3 highest-volume months, symmetrized, top-24
  per mon — runs in the data-refresh CI (Smogon unreachable from dev
  containers); missing files mean trust 0. SYNERGY_SCALE: 3 is
  PROVISIONAL pending calibration against the extracted lift
  distributions (0 = kill switch; sweepable). Both team-fit paths
  (fastTeamFit and the exact fallback) carry the blend in lockstep.
- **Own-form arrival window + donor hassle tiebreak** (user report:
  Pineco's Pin Missile donor read "Drapion breeding chain (@9)" — but
  Drapion arrives at 40, so Drapion@9 means evolve-then-candy-down while
  Skorupi@9 is plain leveling). Two rules:
  (1) A fielded evolution's OWN level-up entries obey the same arrival
  window as pre-evo entries — a below-arrival own entry is a candy-down
  route (level ≥ 2, form reachable at cap) or relearner-teachable, never
  a phantom natural "Level N". In practice the pre-evo natural window
  almost always covers the same move (learnsets are inherited), so the
  fielded Drapion now resolves Pin Missile as natural "Level 9" with
  learner SKORUPI — the honest zero-cost route — and the provenance
  tooltip says so.
  (2) acquisitionOf and compareBreedingCosts carry a `hassle` rank:
  candy-down and delayed routes lose EQUAL-LEVEL ties to plain level-ups
  (structured candyDown/delayedEvolution flags, label fallback). Never
  overrides a level advantage — Vigoroth@9 candy-down still beats
  Exploud@27 per the ratified hops → level order; the ratified keys are
  untouched above the tie. Zero golden drift (availability unchanged —
  only pricing, labels, and chain crediting move); pinned by a Pineco/
  Skorupi regression test. RESULT_CACHE_VERSION 16 → 17.
- **Review fixes for the breeding-provenance commit (1611e89d)**. An
  adversarial review of the provenance layer confirmed two defects, both
  reproduced by executing the real modules:
  (1) The relearner route for a level-1 relist vanished whenever a
  delayed/candy pre-evo route entered the cap — it was the LAST else-if
  in the source chain, so Honchkrow's Sucker Punch (own [1], Murkrow@55)
  was relearner-only at cap 50 but delayed-ONLY at cap 55: raising the
  badge cap made the signature move strictly worse (delayed friction on
  every build, breeding donors priced @55 instead of the relearner's
  last-resort 200). The relearner source is now pushed independently of
  the level-route branches; the move-level delayedEvolution flag
  (sources.every) then correctly clears. Left by the batch-B audit fix
  (6ae48bbd); surfaced by the provenance tooltips asserting a wrong sole
  route. RESULT_CACHE_VERSION 15 → 16.
  (2) compareBreedingCosts was a PARTIAL order: donors tying on the
  user-ratified keys (hops, level, path) could differ in the new
  provenance text (fielded Vigoroth "Level 9" vs fielded Slaking
  "Level 9 (Vigoroth, candy down)" — both @9 via Vigoroth), and the
  winner was whichever came first in pool TEXT order. That leaked input
  ordering into breedingContext and thus into every stableStringify'd
  cache signature — reordering the same pool recomputed everything cold
  and flipped the Egg tooltip. Final tiebreaks on how/sourceTitle make
  the order total; they can never reorder candidates the ratified keys
  distinguish. Both pinned by regression tests; golden drift (if any)
  audited alongside.
  (same audit). (1) A mega usage representative could never satisfy the
  O_rep gate: currentSpecies never fields mega ids, so `currentId ===
  representativeId` was unsatisfiable and every mega-anchored line kept
  the V0 shape FOREVER — no convergence at cap 100 with a complete set
  (the calibration's endgame w=0.00 megas, previously misattributed to
  mega-stone gating). A mega representative is now "fielded" through its
  base form (megas happen in battle; availability stays ungated per the
  owner's ruling). Golden drift (audited): v1-midgame-broad only — Abra
  1758→1714 (Mega-Alakazam anchor now drags the inflated C down), Gastly
  1671→1677; V0 byte-stable. Endgame A/B re-run post-fix: Swampert-Mega
  converges to w=1.00 (1602→1564), Altaria-Mega's trace-usage inflation
  collapses (1456→1372, benched on merit), and the calibrated
  SYNERGY_SCALE 4 behavior stands (regenerator core still seats at 4,
  not at 0 — pinned by the validate test). (2) The incremental search
  seeded the tournament with the REALIZED cached team (real vectors, no
  fit precompute) while challengers scored on the optimistic relaxation
  — the known optimum competed deflated and could be evicted by
  challengers that realize worse, ratcheting the optimum downward across
  pool edits. The seed is re-mapped onto the current prepared choices;
  the team store (complete for subsets) now outranks the seed-only path
  for pure deletions. No golden drift (pinned by incremental-exactness).
- **Legality audit fixes (adversarial audit, release hardening)**. Three
  rule corrections, each repro-verified against the auditor's concrete
  cases with regression tests added:
  (1) An evolved form's own level-1 relist is relearner-teachable
  REGARDLESS of pre-evolution entries — the rule demanded "no pre-evo
  entries", so whenever the pre-evo's entries were out of reach the move
  had NO source at all (Honchkrow's Sucker Punch at cap 50; ~101 such
  cases). The Blaziken Flare Blitz semantics are unchanged.
  (2) Elective evolution hops (stones/trades/hold/location) depart at the
  pre-evo's ARRIVAL level, not 0: the empty [arrival, 0] window priced
  even moves the form already knows at arrival — hatch moves (Munna's
  level-1 Psywave on Musharna, stone-Eeveelution level-1s) and
  same-moment moves (Kirlia@20 on Gallade) — as DELAYED_EVO_FRICTION.
  The Musharna ruling stands: above-arrival entries (Calm Mind@35) stay
  delay-gated, because fielding a Munna to 35 is a real cost.
  (3) Egg-group compatibility resolves over the evolutionary FAMILY, not
  the fielded form: babies and Nidorina/Nidoqueen are ["Undiscovered"]
  themselves, so no fielded Mantyke/Riolu/Azurill could ever receive an
  egg move — you daycare Mantine and hatch the Mantyke.
  Golden drift (audited): item-friendship-evos Growlithe 1157→1186,
  unique-fast-attacker Cloyster 1102→1114 / Exeggutor 1428→1442 — the
  three stone lines shedding phantom hatch-move delay friction; no seat
  changes. Display readiness also hardened (same audit): Hidden Power
  variants now satisfy the canonical "hiddenpower" id (readiness could
  never mark it ready, understating V1 trust); level-1 relists on evolved
  forms no longer set a phantom "@1" cap-equivalent (Slaking Hammer Arm
  claimed the set completes now when the gate is the relearner or cap
  61); the level-scaling sentinel alone no longer reports "pickups
  pending" on a complete set at cap 100.
- **Phase 3 calibration + plumbing fix; SYNERGY_SCALE 3 → 4** (user:
  "run the calibration"). The calibration's first A/B found the scaffolding
  DEAD END-TO-END: attachTeammateLift walked `line.candidates` — the raw
  scored rows, which carry `candidate.id`, not `pokemonId` — while the
  search kernel scores the makeChoice clones (best / bestNonMega /
  choiceOptions / buildAlternatives), so `_teammates` never reached a
  single choice the search touched; independently, buildCompactLines
  dropped both `usageWeight` and `_teammates` at the worker boundary, so
  even a correct attach would have scored trust 0 in parallel searches.
  Both fixed (the attach now walks exactly the kernel-visible choice
  objects; compact lines carry the two fields). V0 is untouched by
  construction — usageWeight is identically 0 under V0, so every pair's
  trust is 0 and the blend reduces to the original formula (V0 goldens
  byte-stable; pinned by a test that runs a lift-rich pool under V0 at
  scales 0 and 4). Calibration, against the shipped index (481 singles
  mons, 9,222 symmetric pairs, pp = percentage points of co-use lift):
  overall median 6.8pp / p90 20.2pp / p99 52.5pp; per-tier medians run
  2.9 (Ubers) to 9.8 (ZU). Effective total points per pair =
  lift × t × SYNERGY_SCALE × COVERAGE_WEIGHT(0.5). At scale 4 and full
  trust: median pair 14 pts (noise), p90 pair 40 pts, and a true tier
  core — Blissey+Quagsire+Alomomola, gen7uu regenerator trio, pair lifts
  +46.1/+47.7/+58.0 — ≈ 300 pts across its three pairs; reference: one
  fully-answered coverage type = 55 pts (fades out with trust), one
  shared-weakness stack = 90 pts (fades), one usage tier step ≈ 49 pts
  (never fades). Endgame A/B (12-mon gen7uu-era pool, badge 18 / cap 100,
  daycare + relearner, model v1): the trio seats together at scale 4 and
  not at ≤ 3.5, displacing Gardevoir + one of Forretress/Swampert-Mega;
  the flip needs scale 4 here because canonical-set egg moves without a
  chain parent in the 12-mon pool cap trust at 0.75 — at a realistic
  full-pool trust of 1.0 the same flip lands at ≈ 3. Scale 4 therefore
  makes real cores decisive at realistic endgame trust while keeping
  median-lift pairs at noise level, and stays well under the mega/V gaps
  (~130–300 pts) that should still dominate seat choices when co-use is
  ordinary. V1 golden drift audited alongside (this changes v1 team fit
  everywhere trust > 0: the fade-out of hand-built terms now actually
  engages). New contracts pinned: zero-trust-with-data keeps the
  hand-built formula bit-identical at any scale; full-trust + full-pair-
  data fit is EXACTLY 0.5 × scale × Σlift with hand-built judgements gone;
  the bias-boosted coverage share survives full convergence (and the fast/
  exact paths agree to 1e-9 on that team); missing index files stay
  silent end-to-end; and the regenerator core wins its endgame seats from
  the synergy term (seated at default scale, never seated together at
  scale 0).
- **Perf package: post-analysis persistence + sweep/investment cost model**
  (user: Chrome flagged the tab for high resource use; telemetry showed a
  cold 160-mon run kept the CPU busy ~6 minutes AFTER the team rendered —
  confidence 140s + investment 218s — and a result-cache-hit run still
  re-paid 26s of both). Five changes, none of which touch team selection:
  (1) confidence + investment now persist WITH the result (memory memo and
  IndexedDB) and are restored on any hit instead of recomputed; an aborted
  pass never persists (a mid-investment abort returns null, and persisting
  it would replay an empty panel forever). (2) The sweep RESCORES only the
  plausible seat contenders — baseline top 40 lines plus the current team —
  instead of every line×form×build 21 times; the grid's one-knob nudges
  can't promote a line that isn't already near the seats, and the searched
  shortlist (20) is unchanged. Alternatives can now only surface from those
  contenders (they were the only lines that ever seated anyway).
  (3) Investment's two future-cap runs use searchMode "fast": line scores —
  and therefore every `gain` — are exact and search-independent; only
  `seatsLater` reads the future team, which is now shortlist-grade. Fast
  runs are quarantined: cache keys carry a "search:fast" tag, they never
  read or seed the incremental search cache (they used to CLOBBER it — every
  post-analysis destroyed Layer 2, forcing the next pool edit into a full
  cold search), and they don't write IndexedDB. computeInvestmentPlan also
  aborts between caps, so a user optimize no longer queues behind both
  future runs. (4) The parsed Smogon month files (sources/*, 1–4MB JSON
  each — the resolver can pin hundreds of MB) are released when the
  pipeline finishes; within-run sharing is untouched. (5) Idle search
  workers terminate after 60s and respawn on demand. RESULT_CACHE_VERSION
  unchanged (17): team output is identical; persisted pre-package records
  simply lack the analysis field and recompute it once. NOTE: future sweep-
  grid/contender/investment changes are output changes for the persisted
  analysis and need a version bump.
- **Breeding gender direction: donors must father, recipients must mother**
  (user report: NidoranF recommended as Zebstrika's Double Kick donor —
  "without Ditto, female pokemon can't breed a move onto a Blitzle").
  The daycare model had no gender at all. Without Ditto the mother fixes
  the hatched species, so an egg-move donor must be able to be MALE and
  the recipient line must supply a female mother. gen7ProgressionSpecies
  now carries the fixed-gender marker ("M"/"F"/"N"/"" mixed) from
  @pkmn/dex; canBreed requires, at family granularity (any form counts,
  matching the egg-group union): donor family can produce a male —
  female-only lines (NidoranF/Nidorina/Nidoqueen) and genderless lines
  never donate across lines — and target family can produce a female —
  male-only (Tauros) and genderless (Magnemite) lines never receive.
  Cache correctness is automatic: the breeding signature is the context's
  reachable-egg-moves content, so affected pools re-key themselves; no
  RESULT_CACHE_VERSION bump. Goldens: zero drift (no golden scenario
  used a gender-illegal chain). Pinned: NidoranF cannot donate Double
  Kick to Blitzle, NidoranM can, Magnemite receives nothing.
- **Perf-package regression: partial revert** (user report: "performance
  is now a lot slower... blank white... kill the page"; telemetry: cold
  search 29s → 223s, cold confidence 140s → 336s, warm investment
  18.8s → 426s on a 161-mon pool). Two package items interacted badly:
  releasing the parsed source files per pipeline meant every fresh
  resolve — each auto-reoptimize, and both of investment's future-cap
  runs — re-fetched and re-JSON.parsed the whole working set (hundreds
  of MB) on the MAIN THREAD, once per pipeline instead of once per tab;
  and the fast-mode quarantine kept future-cap results out of IndexedDB,
  so investment lost all cross-session warmth and re-paid two full
  future runs per reload, on top of the parse storm. The unresponsive
  stretches also starved the interactive search (29s → 223s). Fixes:
  the source cache is permanent again (documented as deliberate — the
  real memory fix is smaller data, not eviction); fast-mode results now
  memoize AND persist under their "search:fast"-tagged keys (store cap
  40 → 60: a gamestate writes now + two future caps), keeping the one
  quarantine that was correct — fast runs still never read or seed the
  incremental search cache. Kept from the package: post-analysis
  persistence, the sweep contender cut, fast-mode future runs, worker
  idle release. Also kept: the user's own size valve (6985a280) — pools
  over 80 mons / 200 builds skip fresh confidence/investment entirely
  (persisted analysis still displays), and startup auto-optimize is
  non-exhaustive and non-blocking.
- **Swap-polish: shortlist verdicts are repaired to a 1-swap local optimum
  over the FULL pool** (user design ask: "mons in the pool that get
  non-shortlisted SHOULD seat... designate the last few shortlist slots at
  random [as a canary]?" — built as the strictly-stronger deterministic
  version: instead of randomly sampling the excluded set, audit ALL of it,
  every run, and repair what's found). On the shortlist path (pool too big
  to enumerate; at 120 mons the incremental layer never engages either, so
  this was every run), after realization the engine scans every non-team
  line x seat x form with the exact realized scorer, applies the best
  strictly-improving swap, re-realizes builds, and repeats to a fixed
  point (deterministic tie-breaks; strict-improvement termination; cap 8).
  Sound but one-sided: a repair PROVES a shortlist miss; zero repairs
  certify 1-swap local optimality, not global — the synergy-pair blind
  spot (both partners excluded) remains, mitigable later by seeding the
  shortlist with teammate-lift partners. Each repair carries attribution
  (rank under the shortlist's own ordering + which gates the incomer
  matched) so a miss reads as the known team-context blind spot vs a
  heuristic bug. Surfacing: provenance footer shows the audit verdict
  including the healthy case ("swap audit: shortlist held (N lines
  audited)" — silence must not be mistakable for "didn't look"); status
  line gains a sentence only when repairs fired; telemetry samples carry
  polishSwaps/polishGain with a per-segment aggregate (audited /
  repairedRuns / totalSwaps / maxGain) — the repair RATE over time is the
  shortlist-quality metric; the audit's final scan doubles as
  benchSwapScores, so the shortlist path always carries bench droppability
  data again (un-degrading the bench flags that the 6985a280 valve's
  benchSwaps gating had cost auto-reoptimize runs). Measured on the regret
  fixture: forced shortlist sizes 8-16 miss a seat (Wormadam-Trash, ranked
  18/36, wins no gate slot) and ONE repair recovers the true exact optimum
  at every size; sizes 20+ hold. Pinned: repair fires and restores the
  exact team + score at size 8; audit record present with zero swaps at
  24; existing 24/28/32 zero-regret pins unchanged. The confidence sweep's
  FORCE_SHORTLIST settings now also polish (engine consistency: the sweep
  must measure the engine that ships). RESULT_CACHE_VERSION 17 -> 18
  (large-pool teams can differ; results carry searchPolish).
- **Focus Punch / Shell Trap: fail-if-disrupted amortization** (user
  report: "double-check how Focus Punch is being calculated? I think
  it's a two-stage move"). The effective-power model already amortized
  exposed two-turn charges (Solar Beam 1/3), recharge (Hyper Beam 2/3),
  and multi-hit expectations — but Focus Punch's focus mechanic (fails
  outright if the user takes damage before its -3-priority resolution)
  is encoded in the dex as a custom CONDITION, not flags.charge, so it
  slipped the net and was priced as a clean 150 BP / 100% hit — the
  strongest Fighting move in the model. Shell Trap (fails unless hit by
  a physical move first) had the identical hole. Both now take the
  exposed-charge 1/3 rule via a curated FAILS_IF_DISRUPTED set: the
  payoff is exposed to disruption exactly like Solar Beam's charge turn.
  Audited siblings: Beak Blast shares the dex shape but its attack never
  fails (the condition is the contact burn) — full power kept;
  Counter/Mirror Coat are BP 0 and never enter the BP model; Avalanche
  is unconditional at face value. Effect: recommended sets, damage
  estimates, and damage-aware coverage change wherever the two were
  picked as the hardest hit. Pinned: Focus Punch deals ~1/3 of an
  otherwise-identical clean 150 BP move through the profile API. Golden
  drift: none (no golden scenario carried either move in a recommended
  set). RESULT_CACHE_VERSION 18 -> 19.
- **Leaky-dodge charge moves amortize to 2/3** (user ruling, refining the
  semi-invulnerable exemption: "for moves with no punch-through — either
  by making you untargetable or by stealing the opponent's turn — keep em
  at full power. but for the ones with leaky dodges, put em to 2/3").
  Fly/Bounce/Dig/Dive previously kept FULL power on the claim that the
  charge turn blanks the opponent's turn too — but their dodges leak
  (Gust/Twister hit Fly/Bounce at 2x, Thunder hits airborne outright,
  Earthquake/Magnitude hit Dig at 2x, Surf/Whirlpool hit Dive at 2x) and
  the telegraphed lock-in gifts a free switch/setup turn unless the
  opponent was attacking anyway. Valuing the dodge turn at HALF a turn
  under the model's double-weight-the-earlier-turn convention gives
  (2·1/2 + 1·1)/3 = 2/3 — the same convention behind Hyper Beam 2/3 and
  Solar Beam 1/3, not an ad-hoc haircut. Full power stays only where
  there is genuinely no punch-through: Phantom Force / Shadow Force
  vanish completely, and Sky Drop carries the target with it, stealing
  its turn. Pinned via synthetic same-BP charge moves: Dig ≈ 2/3 of
  Phantom Force, an exposed charge ≈ 1/3. RESULT_CACHE_VERSION 19 → 20
  (Dig/Bounce are common mid-game Reborn moves; sets/coverage reprice).
  Golden drift (audited): all decreases, exactly the Bounce/Dig carriers —
  late-broad-froakie Steelix 1486→1479 and midgame-broad(+v1) Rapidash
  1407→1400 (Dig/Bounce marginal in kit; no seat/role changes); weak-shell
  Azumarill 1366→1239 with role bulky_utility→bulky_attacker (Bounce — its
  Flying coverage AND its paralysis-utility flag — drops out of the
  recommended build at 2/3 power, so both credits leave together). No
  seats changed in any golden.
- **Bench tail: relaxed seen-within-N-games labels (DISPLAY ONLY)** (user
  design: "when something has no usage data, iteratively add 5 to the
  number of games played in the '50% chance of having been seen in N
  games played' calculation, and have that be a tail to the current
  tiers... it should absolutely not change the mechanics"). The
  meaningful-usage bar IS that calculation at N=25 (2.73%); mons below it
  everywhere used to pool into one flat "no usage data" bucket. The
  resolver index now carries a display-only `trace` field per unranked
  mon — its best sub-bar row (highest average usage, earliest tier on
  ties: the row that qualifies first as the bar relaxes) — and the bench
  tail labels each such line "ZU 1500 (30)": at that row's usage, 50%
  odds of seeing one within 30 games. Tail ordering per the user's
  example: games ascending (30-band above 35-band), higher trace usage
  first within a band, mons with zero usage anywhere stay in an honest
  "no usage data" bucket dead last. Group tooltip explains the horizon so
  the parenthetical isn't mistaken for a percent. Verified against the
  user's live examples: Beartic → ZU 1760 (30) (2.726% — missed the
  2.732% bar by a hair), Barbaracle → RU 1760 (35), Bastiodon → ZU 0
  (35), Castform → ZU 0 (165), Cherrim → ZU 0 (320). Mechanics untouched
  BY CONSTRUCTION and by proof: scoring never reads `trace` (only the
  bench renderer does), red-flag ordering still keys on the unchanged
  ceiling field, and the golden suite is byte-stable across the index
  regeneration (dataSignature changed, zero score drift — the exact
  meaning of "display only"). No RESULT_CACHE_VERSION bump: the new
  dataSignature retires caches on its own, and results render the tail
  from freshly resolved bundles.
- **Bench-tail ordering correction** (user ruling superseding their earlier
  example): within an N-horizon the tail sorts by the SAME ladder order as
  the meaningful groups — shallower tier first (UU 0 (65) before
  ZU 1630 (65)) — not by raw trace usage across tiers. Primary key stays
  games ascending; entries within a group stay usage-descending. Display
  only, as before.
- **Item inventory UX overhaul** (user: entering a shop haul was "really
  janky" — per item it took a search, a click on Add (which inserted at
  count 1), a scan of the alphabetical list, and a dropdown change to 6+,
  with an auto-reoptimize potentially firing between every edit). Five
  changes, no scoring impact: (1) the add box gains a sticky count picker
  defaulting to 6+ (most tracked items are renewable shop stock), and
  adds never LOWER an existing stack; (2) Enter in the search box adds,
  and focus returns to it after the re-render, so hauls chain
  type-Enter-type-Enter; (3) the touched row flashes and scrolls into
  view; (4) inventory edits schedule the re-optimize on a 5s debounce
  (vs the global 600ms) with a "re-optimizing after edits settle" status,
  so a burst of edits costs one recompute; (5) a "Purchasable at your
  badge, not tracked yet" block lists shop-sourced items from the
  community guide (new generated REBORN_SHOP_ITEM_BADGES map, built from
  source=Shop rows directly — the merged unlock table hides shop-ness
  behind earlier one-off finds) with one-click "add all as 6+", via a
  bulk addRebornOwnedItems that raises-never-lowers. Known data
  limitation, documented in the generator: the guide extraction kept one
  row per item, so an item found earlier as Hidden never reads as shop
  stock even if a shop later sells it. Progression shape and scoring
  inputs unchanged (ownedItems is the same map; the sync writes count 6
  exactly as manual entry would).
- **Progression checkbox mechanics: no re-render on tick, scroll preserved,
  burst debounce** (user: "sometimes this causes the screen to jump").
  A checkbox change used to rebuild the entire page DOM — pure waste (the
  browser had already toggled the box) that reset the viewport mid-burst,
  and the 600ms debounce ran a full recompute at every pause. Now: option
  ticks patch in place (twin renderings synced, "obtainable" highlight
  retoggled from a render-stamped badge flag, the group's N/M · K counter
  recounted from the live DOM) with NO render — the next render arrives
  with the settled re-optimize, on the same 5s batch debounce items got.
  Fallback: with no result on screen there's no re-optimize to deliver
  that render, so the old full-render path remains (nothing above the
  panel to jump). Belt-and-braces: render() itself now restores
  window scroll across the full-page rebuild, so every OTHER render
  trigger (progress bar mounting, status lines) stops jumping too.
  Verified in the built app: checkbox click leaves the app DOM intact
  (marker survives), twins sync, counter updates live, scroll pinned.
- **Progression checkbox navigation: obtainable rail + per-location tutor
  "All"** (user: "I usually have to scroll past a lot of already-checked
  boxes to get to the ones I want to add"). Each option group now pins an
  "Obtainable now, not checked" rail at the top — the K options the badge
  schedule says are pickable but untracked (the same K the counter
  already reported), rendered as live checkboxes; the canonical full list
  below keeps its stable order (the rail is a second view, not a
  reordering — twin-sync keeps both honest). Tutor subgroups gain an
  "All" button that UNIONS the location's moves into the selection
  (unlike the group-level Select all, which replaces) — a new tutor is
  one click. Display/UX only; progression shape and scoring untouched.
- **Egg tooltips: runner-up routes + the scarce-resource pricing finding**
  (user: "recommended to learn Leaf Storm from breeding Victreebel...
  that costs a whole Leaf Stone, so I'm a bit skeptical"). Investigation
  first (asked: "see if the code is sensitive to not wanting to spend
  scarce resources"): the donor ranking prices hops, LEVELS, candy-down/
  delayed hassle (equal-level tiebreak), and the relearner's Heart Scale
  (last resort) — but evolution ITEMS a donor's form consumes are
  invisible TWICE: getCurrentRebornSpecies presumes elective evolutions
  once their access is unlocked (input Bellsprout reads as a fielded
  Victreebel), and the evolved form's level-up entries then price as
  plain level-ups (Victreebel's Leaf Storm = "@32", Leaf Stone
  unpriced). Also noted for a future ruling: evolution-MOVE entries with
  no numeric evoLevel (stone evolutions' "on evolution" moves) price at
  level 0 — cheaper than any level-up. Where item costs should sit in
  the ratified hops → level → hassle order is a values call left to the
  user; the shipped mitigation is transparency: breeding sources are now
  built in a single post-convergence pass that ranks EVERY viable donor
  under the same total order and appends up to two runner-up routes to
  the tooltip ("Other pool routes: Sceptile breeding chain (@63)."),
  deduped by ROOT learner — a longer chain through the winner's own root
  (Victreebel → Fomantis) is the same acquisition wearing a detour and
  is not shown. Pool-order independence preserved (routes rank under the
  total order; deepEqual pinned); the Pineco/Skorupi and provenance pins
  unchanged. No RESULT_CACHE_VERSION bump: sourceTitles live inside the
  breeding signature, so affected pools re-key themselves.
- **Scarce-resource ruling ratified: stone routes lose to any grinding**
  (user, closing the Leaf Storm finding: "I think a Leaf Stone is
  basically worth any levels of grinding. Stone routes lose ties with
  either grinding or candy-downs"). acquisitionOf now charges every
  evolution ITEM consumed between the player's ACTUAL input form and the
  form that learns the move: useItem stones, and Reborn's trade
  replacements (Link Stone + any trade hold-item), per source (a
  Drapion's "Level 9 (Skorupi)" hatches a fresh Skorupi — no items; its
  Victreebel-class sources owe their stones). Charged routes price out
  of the level range entirely (+300 per item — above every real cap and
  the relearner's 200, so they lose to grinding, candy-downs, AND a
  Heart Scale trip, winning only over no-route-at-all) and label
  honestly: "Victreebel breeding chain (@32 + Leaf Stone)". Waivers,
  both from existing semantics: an input listed AS the evolved form has
  already sunk its stone (no charge), and items tracked renewably (6+ =
  "buy as many as I need") aren't scarce. Edge left as ratified
  previously: chain length stays SOVEREIGN (hops before level), so a
  direct stone donor still beats a two-hop stone-free chain — flagged
  for a future ruling if it ever bites. Pinned: unspent-stone
  Bellsprout loses to Sceptile@63 with the stone route as an honestly-
  priced runner-up; input Victreebel and renewable-stone cases win at
  @32; a stone-only pool still offers the route. No RESULT_CACHE_VERSION
  bump (breeding signatures re-key on content).
- **Daycare reachability ratified: a hatchable line fields any family form**
  (user ruling: "as long as I have daycare unlocked, higher evolutions can
  reach lower evolutions... if I put in Beedrill but Kakuna was better,
  field Kakuna — I can hatch more Weedles; if my input was Mothim, I reach
  the Wormadams by breeding and evolving a Burmy"). The line-resolution
  filter was daycare-blind in BOTH directions: strict pre-evolutions were
  always excluded (v10's "an owned Mantine can never be a Mantyke again" —
  true only without the daycare), while sibling branches were always
  allowed (an owned Mothim fielded Wormadam with no path to a female
  Burmy). New rule: descendants and their megas are always reachable
  (evolving up is a real future); everything else — pre-evolutions AND
  sibling branches — requires daycareUnlocked on a HATCHABLE line
  (breedable egg groups + a possible mother, via canHatchLine — so
  genderless Magnezone and male-only lines still can't reach downward).
  Form-variant inputs fall back to their base species for the descendant
  walk (a Burmy-Sandy's cloak is mutable in-game, so every Burmy evolution
  counts as its descendant). Once fielded, a lower form's own kit resolves
  from its own legal-move data as usual, so Weedle/Kakuna-only moves come
  with it. Pinned: Beedrill±daycare, Mothim±daycare (both directions),
  Magnezone+daycare. RESULT_CACHE_VERSION 20 → 21 (same progression can
  now produce different candidates). Golden drift audited with the regen.
  Calibration-fixture note (audited during this change): the synergy
  acceptance scenario ("gen7uu regenerator trio seats at the shipped
  scale") ran with the daycare on, and the reachability ruling upgrades
  its Blissey line to CHANSEY — a shallower OU record (the Eviolite set),
  whose co-use lifts don't include the UU core, so the trio's glue
  vanishes. That is the ruling working as intended (Chansey-over-Blissey
  is the canonical better-pre-evo case), not a synergy regression: the
  points-table, exactness, zero-trust, and inertness contracts all still
  hold, and the trio contract holds verbatim with the daycare off
  (relearner-only trust still flips at scale 4, and scale 0 still drops
  Alomomola). The fixture now pins that gamestate explicitly, with the
  reasoning in the test.
- **Gamestate export/import (downloadable file)** (user: "yeah, you're so
  right about this! And this should be a quick fix. I prefer the version
  with a downloadable file"). Everything defining a playthrough — pool
  text, full progression (badge/cap, TM/tutor checks, item inventory,
  evolution access, bias), scoring model — lives in localStorage, one
  browser-data clear from gone. "Export gamestate" downloads a
  date-stamped versioned JSON; "Import gamestate" restores it through
  the NORMAL save/load path (so normalizeRebornProgression sanitizes an
  imported blob exactly like any stored one), confirms before replacing
  a non-empty pool, and re-optimizes. Round-trip + rejection pins in
  test/gamestate-backup.test.mjs. No engine impact.
- **Sibling-form egg donors** (user: "yeah, those should be a thing").
  Donor entries were input + presumed-current only, so a branch sibling's
  exclusive moves were undonatable (input Mothim couldn't lend a
  Wormadam-only move even though hatching a Burmy and raising a Wormadam
  is routine). Hatchable lines (canHatchLine, same gate as fielding
  reachability) now contribute EVERY family form as a donor entry.
  Composition came free: a hatched branch keeps the listed input as its
  scarcity anchor, so unspentEvolutionItems charges its whole path — an
  input Vaporeon donating Jolteon's Thunder Fang reads "@20 + Thunder
  Stone". Precision added with it: CROSS-family donation now requires a
  male-capable KNOWER (the learner form or a descendant — carryover
  follows evolution), so Wormadam/Vespiquen-exclusive moves can't ride a
  cross-family egg even though their families have males; within the
  family the mother carries the move instead (Gen 6+), so no father is
  needed there. Tooltip runner-ups dedup by root learner FAMILY now
  (Grovyle@58 vs Sceptile@63 is one route, not two opinions).
  Consequence pinned: Bulbasaur's Leaf Storm winner improves to
  Grovyle@58 (hatch + level beats both Sceptile@63 and the stone route).
  Order independence re-pinned with family entries. No
  RESULT_CACHE_VERSION bump (breeding signatures re-key on content).
- **E2E suite: the browser smokes are now a command** (infrastructure
  item B, user-approved). The playwright verifications used for the
  inventory UX, the checkbox mechanics, and the gamestate backup were
  ad-hoc session scripts; they now live in test/e2e/*.e2e.mjs with a
  runner (scripts/run-e2e.mjs, `npm run e2e`) that builds the site,
  serves it via vite preview with site-data symlinked, runs every spec,
  and exits non-zero on failure. Specs cover what the unit suites
  cannot see: Enter-to-add focus retention, row flash, never-lower
  re-adds, one-click shop sync, the obtainable rail, in-place checkbox
  ticking (page DOM not rebuilt, twins synced, live counters), viewport
  pinning across renders, the tutor subgroup union, gamestate download/
  restore round-trip, and corrupt-file rejection. Deliberately not in
  CI (needs the full data tree + a browser); playwright resolves from a
  local install or the managed environment's global one, with install
  instructions in the error. No src changes.
- **Usage column joins the relaxed-horizon treatment** (user report: with
  pool Froakie/Hoothoot/Rattata, "both Raticate and Noctowl are showing
  as trace usage... I'd like that to be expanded, same as the end of the
  bench ones"). The team table's Usage cell rendered a flat muted
  "trace" for any form below the meaningful bar — hiding that Raticate
  and Noctowl have very different sub-bar records. It now renders the
  same seen-within-N-games label as the bench tail from the resolver
  index's display-only trace row — Raticate reads ZU 1500 (40), Noctowl
  ZU 0 (50) — with the horizon explained in the tooltip, and an honest
  "no usage data" only when the form has no recorded usage anywhere.
  Display only; verified against the reported pool in the built app.
- **Usage-column sort follows the relaxed labels** (user report: "The
  usage sort isn't working. The sort should be the same as we did for
  the bench display" — the tail rendered Pachirisu PU 0 (235) above
  Noctowl ZU 0 (50) above Raticate ZU 1500 (40)). The tier sort in
  getSortedTeam treated every unranked row as an identical
  Infinity/-Infinity tie, so trace rows fell through to the score
  tie-break. The comparator now extends past rank/value with the bench
  tail's keys: seen-within-N games ascending, then the trace tier
  ladder (shallower first at equal N, per the ruling "primarily
  ascending N; other than that, the same sort as everything else"),
  then trace usage descending; rows with no usage anywhere sort dead
  last regardless of score. Pinned in test/trace-usage.test.mjs with a
  fixture whose scores reproduce the reported wrong order under the old
  fall-through. Display only; ranked rows unaffected.
- **Ability damage layer** (user report: "abilities aren't really factoring
  into the damage calculations. And some of them absolutely should!").
  Correct — only Protean (universal STAB) and Adaptability (2x STAB) were
  modeled; the assumed set's ability (topSet.ability, already threaded into
  every build variant and the damage memo key) otherwise did nothing. Every
  damage estimate now applies the abilities whose condition is a property of
  the MOVE rather than of the battle state:
  * stat rewrites: Huge/Pure Power 2x physical; Hustle 1.2x physical (1.5x
    Atk × 0.8 accuracy folded in); Slow Start 0.5x physical (always-on for
    the first five turns — most of a fight);
  * base-power boosts: Technician 1.5x at ≤60 per-hit BP (multi-hit moves
    qualify per hit); Tough Claws 1.3x contact; Strong Jaw 1.5x bite; Mega
    Launcher 1.5x pulse; Iron Fist 1.2x punch; Reckless 1.2x recoil/crash;
    Sheer Force 1.3x secondary-carrying moves;
  * type-keyed: Water Bubble 2x Water; Steelworker 1.5x Steel; Dark/Fairy
    Aura 4/3 own type;
  * type CONVERSION: Aerilate/Pixilate/Refrigerate/Galvanize turn Normal
    moves into Flying/Fairy/Ice/Electric at 1.2x (Gen 7 value), Liquid Voice
    turns sound moves Water, Normalize turns everything Normal at 1.2x. The
    decorated move carries the converted type (pre-conversion preserved as
    rawType for idempotency), so STAB, effectiveness, the coverage vector,
    super-effective counts, opponent bias, type-Gem recommendations, and the
    display all see what the battle would — Aerilate Return IS a Flying move
    and is real Ghost coverage;
  * hit counts: Skill Link lands the maximum multi-hit count (Icicle Spear
    a flat 5 instead of the 3.1 expectation); Parental Bond 1.25x on
    single-hit moves (Gen 7 second-hit value).
  Battle-state-conditional abilities stay unmodeled on purpose — the
  estimate prices a typical unconditioned turn: Guts/Toxic Boost/Flare
  Boost (status), Blaze/Torrent/Overgrow/Swarm (pinch HP), Sand Force/
  Solar Power (weather), Analytic/Stakeout/Tinted Lens/Sniper/Rivalry
  (target/order/crit), Defeatist (assumed above half HP) — pinned as
  no-ops. Move meta gains sparse ability-interaction flags (contact/punch/
  bite/pulse/sound/recoil/secondary) from @pkmn/dex; fixed-damage moves
  remain untouched by all of it, as in the games.
  Golden drift audited — every drifted line is an ability holder boosted in
  the right direction, and no non-holder moved (Greninja unchanged: Protean
  was already priced): Azurill 1239→1407 (Azumarill Huge Power — recovering
  most of the leaky-dodge-era drop, now as a correctly priced attacker),
  Shellder 1114→1193 (Cloyster Skill Link), Scyther 1551→1603 (Scizor
  Technician; now SEATS in midgame-broad, displacing Gastly→Gengar, with
  Eevee's eventual flipping sylveon→vaporeon in the team-fit rebalance),
  Eevee's eventual espeon→sylveon in item-friendship-evos (Pixilate Hyper
  Voice), Crabrawler 1404→1466 / Pancham 1435→1480 / Tyrogue 1400→1446
  (Iron Fist: Crabominable/Pangoro/Hitmonchan), Meowth 1171→1197, 1669→1680
  (Persian Technician), Kricketot 1065→1106 (Kricketune Technician).
  Pinned in test/validate/ability-damage.test.mjs (8 tests: each multiplier
  family, the ≤60 per-hit Technician gate, conversion STAB/coverage, the
  conditional-ability no-op guard, decorated-move idempotency).
  RESULT_CACHE_VERSION 21→22 (output changes with no data-signature change).
- **Trace mons source their canonical set from their trace tier** (user
  ruling: "that *is* their best 'usage tier', in the sense that, while no
  one is using them much, that tier is the place where they're seeing
  competitive play. So, for sorting purposes, they should remain tailed at
  the end. I don't want their scoring to directly change either. But for
  the sake of determining their canonical set, you should pick from that
  usage tier."). The set-index generator's primary-tier choice for mons
  below the meaningful bar everywhere fell back to the DEEPEST tier they
  merely appeared in; it now prefers the resolver index's `trace` tier —
  the same best-sub-bar signal the display shows — with the deepest-own-
  family fallback kept only for mons with no usage signal at all. Raticate's
  primary set moves ZU 0 → ZU 1500, Pachirisu's ZU 0 → PU 0; Noctowl's was
  already its trace tier (ZU 0). 131 singles trace mons flipped primary;
  ZERO ranked mons did (audited against the resolver index — the ranked
  branch is untouched, and the remaining 63 changed files are month-counter
  catch-up from the morning's bot data refresh, which updates resolver-index
  but never regenerates set-index). Sorting stays tailed (unchanged) and the
  trace VALUE still never enters scoring; only the set a trace mon is
  assumed to run (spread/ability/item/canonical moves) changes, which is the
  point of the ruling. Goldens are byte-stable — no scenario mon's canonical
  set changed. Pinned in test/validate/set-sourcing.test.mjs (trace-tier
  primaries for Raticate/Pachirisu with concrete gen7zu/1500 and gen7pu/0
  anchors). Data-signature change re-keys caches; no RESULT_CACHE_VERSION
  bump needed.
- **Recommender step 5: competitive-rank slot fill** (user report: a 0-badge
  Liepard rendered Pursuit / Scratch / Fury Swipes and a BLANK fourth slot
  while Assist sat legal; ruling: "In cases where it's made it through the
  first three bullets of that algorithm, I think remaining moves should be
  selected by descending usage within its canonical tier (fallback to all
  tiers in descending order, the usual way)"). Root cause: when the stitch
  appends another tier's moves it nulls their usage % (cross-tier
  percentages aren't comparable), and moveUsage drops null entries — so
  Liepard's Assist, a REAL Gen 7 AG 1760 set entry, was invisible to the
  recommender, whose fill loop then refused to seat "neither used nor
  notable" filler and broke with an empty slot. loadTopSet now also exposes
  moveRank — the stitched array order, which IS the ruling's ranking:
  primary tier by descending usage, then each fallback tier down the
  ladder, sub-bar trace tail last. When the damage-led fill (fresh-type →
  utility-by-usage → any-attack) runs dry with slots left, the recommender
  takes the best-ranked remaining legal move on that ladder. Moves with no
  competitive appearance anywhere still never seat — an empty slot stays
  honest. Liepard@20 now reads Pursuit / Scratch / Fury Swipes / Assist
  (pinned in test/validate/competitive-rank-fill.test.mjs). Analysis-path
  only: the optimizer's build variants never passed moveUsage and still
  don't, so scores are untouched and goldens are byte-stable — no
  RESULT_CACHE_VERSION bump.
- **Post-analysis deferral for background runs** (user report: "ruinously
  bad performance... multiple minutes of loading... can't even scroll",
  with a perf report showing search at a normal 28.5s and INVESTMENT at
  614.5s of the 648.6s pipeline). Root-cause audit first: browser A/B of
  the deployed build vs the pre-ability-layer build measured IDENTICAL
  cold pipelines (to-table 120.8s vs 120.3s; full 408.7s vs 411.0s on the
  same 25-mon pool), and the node investment path is likewise flat across
  every commit (main 35s / investment ~70s at both ends) — no engine
  regression anywhere in the day's commits. What actually happened: the
  investment projection costs two more full-price optimizer runs at future
  caps (fast mode skips exhaustive search + bench swaps but still pays full
  line resolution, which dominates), that cost is only ever felt COLD, and
  the day shipped three cache-retiring changes back-to-back (the morning
  Smogon data refresh, RESULT_CACHE_VERSION 22, and the set-index/manifest
  data change) — so every page load auto-started a ~10-minute, every-core
  post-analysis the user never asked for. Fix: background-triggered
  optimizes (page load with a saved pool, the auto-reoptimize debounce,
  gamestate import) DEFER the post-analysis when no persisted copy exists —
  the panel says so and offers "Compute stability & investment now" — while
  explicit Optimize clicks and persisted restores behave exactly as before.
  Verified in the built app: load-triggered optimize renders the team with
  the deferred button and starts no future-cap runs; the button computes on
  demand; an explicit optimize still computes inline. No scoring change;
  no cache bump (results and their persisted post-analysis are unchanged —
  only WHEN the computation starts moved).
- **Hint-grade investment runs + progressive delivery + cooperative yields**
  (user ruling on the residual cold cost: "ten minutes of blocking loading
  is totally untenable no matter where it is in the user experience").
  CPU-profiling one "fast" future-cap run showed the minutes were NOT line
  resolution but the SEARCH KERNEL: fast mode only skipped full enumeration
  above the 2M-combination auto budget, which a 34-mon pool (1.3M combos)
  never reaches — so each future-cap run paid a full parallel search, with
  future caps' richer per-line options multiplying the per-combination cost.
  The investment plan reads LINE scores (exact under any search path) plus a
  rough future six for "projected to SEAT", so fast runs now run HINT-grade:
  * search budget 20k combinations, shortlist capped at 12 (924 combos),
    swap-polish and bench-swap scans skipped by contract;
  * build variants trimmed to the default set only (no coverage/utility/
    delayed variants, no ability-sensitivity probe) — the plan never read
    them;
  * the fast context tag bumped ("search:fast" → "search:fast2") so stale
    full-fat fast entries retire while every exact result stays warm — a
    RESULT_CACHE_VERSION bump would have forced another cold MAIN search on
    everyone for an investment-only change (exact-search output is
    untouched: goldens byte-stable, validate 93/93).
  Plus two UX guarantees: the plan renders PROGRESSIVELY (the first future
  cap's list appears as soon as it lands, marked "still computing"), and
  line resolution now takes a time-sliced event-loop yield (~20/s), so the
  main thread stays scrollable through any long resolve pass. Measured:
  node investment 69.1s → 1.8s (same 7 train-soon entries); browser cold
  full pipeline 408.7s → 140.6s with the post-analysis share 288s → 18s
  (the remainder is the untouched exact main search). The panel notes that
  projections are hint-grade. Combined with the previous commit, a cold
  gamestate now costs one main search, panels fill in seconds behind it,
  and nothing auto-starts minutes of work on page load.
- **Interactive search budgets + live search progress** (user report: a
  36-mon pool took "unacceptably long" in "searching team combinations",
  plus "I would like the progress bar to accurately display where we are
  and... surface more granularity... about where we are in that
  subprocess"). C(36,6) = 1.95M combinations sat just UNDER the old
  enumeration caps (auto 2M / explicit 3M), so every optimize — including
  every background auto-reoptimize after a progression tick — fully
  enumerated ~2M teams: 30–45s of every-core kernel work per edit. The
  budgets now price interactive latency: AUTO_EXHAUSTIVE_BUDGET 250k
  (background runs exact through ~25 mons) and EXHAUSTIVE_CAP 1M (explicit
  optimizes exact through ~32), both tunables so the regret validation can
  raise the cap for TRUE exact baselines. Above them the shortlist+polish
  path takes over — exact on the shortlist, repaired by the full-pool
  1-swap audit, honest in the provenance footer. Golden audit: the three
  36-mon fixtures (early-weak-froakie, late-broad-froakie, happiny-swap)
  now route to shortlist+polish and their goldens changed ONLY in the
  searchExact flag — teams and scores byte-identical, i.e. the polish
  recovered the exact optimum on every one, exactly what the regret suite
  (baselines now run with the cap raised) continues to prove. No
  RESULT_CACHE_VERSION bump: persisted exact results remain valid optima.
  Progress: search workers now stream scanned-combination counts (one
  message per 65k-combo stride, which also refreshes the hang-detection
  timeout so a long visibly-working range is never declared hung); the
  caption reads "Searching team combinations — 52% of 377k..." and the bar
  projects remaining time from the measured scan rate instead of the
  pre-run budget guess. Verified in the built app: 36-mon explicit
  optimize 26.2s to table on the slow verification box (the search share
  fell from ~100s to ~3s), live percent captions, "swap audit: shortlist
  held (36 lines audited)" in the footer.
- **Score what you show** (user report, ratified: "The sets it's
  recommending to me in the display come apart from the sets that give it
  its score? that seems bad" → "okay, go ahead"). The optimizer's build
  variants never passed canonical move usage into profile building — the
  resolveCandidateBuilds doc comment claimed "default — the usage-anchored
  competitive set" but the anchoring only ever happened in the display
  path, so a pick could be seated on a damage-led set (Greninja scored on
  hydropump/extrasensory/round/substitute) while the pane recommended a
  different one (extrasensory/hydropump/round/nightslash). The default and
  delayed builds (and the ability-sensitivity probe) now anchor on
  canonical move usage + the stitched competitive move rank — the same
  inputs the analysis pane displays. Coverage/utility variants stay
  damage-/role-led by design (they exist as alternatives). TWO deliberate
  score/display differences remain, both documented at the code: items
  (inventory-dependent, priced by the owned-item system) and investment
  stats — anchoring the top spread's real EVs/nature was TRIED and
  REVERTED, because competitive singles spreads are often defensive
  (Arcanine's canonical spread is Impish 248 HP/252 Def; Growlithe's scored
  Atk fell 91→68) and collapsed PvE attacker offense pool-wide; scoring
  keeps ideal offensive investment ("best obtainable", the ability
  philosophy).
  Alongside it, the NON-PASSIVE FLOOR is hardened to its documented
  intent: the gate now multiplies the utility roles outside the geomean
  (inside it, a mon at 29% of the floor kept 66% of its utility value).
  This was latent while passive mons' canonical utility moves went
  unpriced — the anchoring exposed it when Shuckle's real Sticky Web/
  Encore set jumped it 1045→1277 and seated a base-10-offense wall over a
  real attacker, violating the high-utility-low-offense guard. With the
  hard gate the guard holds.
  Golden drift audited — every move is one of the two mechanisms:
  floor-subsidized utility bodies drop (Joltik 1158→1025, Ledyba
  1202→1076, Spinarak 1220→1100, Swirlix 1061→892, Tangela 1127→994);
  canonical sets with REAL infrastructure gain (Trubbish 945→1032 —
  Toxic Spikes now priced; Tentacool 1028→1118); roles flip
  utility→attacker where the subsidy vanished (Burmy, Pancham, Poliwrath,
  Kricketune); fielded forms move where a floor-subsidized pre-evo lost
  its edge (Surskit now fields Masquerain; Happiny fields Chansey);
  midgame-broad's team rebalances (Eevee's eventual vaporeon→jolteon,
  Tentacool seats over Mareep) and unique-immunity's (Tentacool over
  Hoothoot — its must-seat pins hold). The incremental-exactness trap
  fixture was re-tuned with its documented procedure (find-reshuffle
  grid search): mixed pool + Flying:2 + Sandshrew springs the trap under
  v23 scoring. The Shuckle, delayed-evolution, and regret suites all
  pass — regret's exact baselines now run with the (tunable) search cap
  raised, per the budgets change. RESULT_CACHE_VERSION 22→23.
- **Search-phase stage captions** (user follow-up: the caption never left
  "Searching team combinations" — because on a fast machine the worker
  scan, the only instrumented part, finishes in about a second, and the
  VISIBLE time under that caption was everything around it). The search
  phase's other stages now report themselves: "Search prep — loading
  teammate synergy..." (per-line index fetches before the scan — most of
  the visible gap on a cold load), the live scan percentages, "Search done
  — auditing shortlist swaps (round k)...", "— realizing best builds...",
  and "— ranking bench swaps...". The polish loop is now async with
  time-sliced paint yields so those captions can actually render (they
  were synchronous blocks the browser never repainted through); each stage
  emits once and only lingers when that stage is genuinely slow. No
  scoring change; goldens byte-stable.
