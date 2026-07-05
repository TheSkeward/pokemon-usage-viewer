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
