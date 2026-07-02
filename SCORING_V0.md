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
