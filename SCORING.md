# Scoring model

This document describes the scoring model that the app currently ships and the
evidence allowed to change it. Historical experiments and retired validation
strategies remain available in Git history; this file is the present contract.

## Change policy

Scoring has two different kinds of evidence:

1. **Mechanical correctness** — move legality, damage math, evolution access,
   cache exactness, serialization, and similar facts. Fast focused tests should
   guard these behaviors.
2. **Product judgment** — which Pokemon are excellent or poor choices for a
   Reborn playthrough. The badge-bucket anchor corpus is the calibration
   contract for those verdicts.

A scoring shape or constant changes only when it is justified by the anchor
corpus, a concrete mechanical correction, or an explicit user decision. Do not
add one-off team scenarios as permanent scoring requirements. A failing anchor
is a finding to understand, not permission to fit a special case.

## Individual value

Selection uses the value of a concrete fieldable build:

```text
V = C + w_up * max(U_rank - C, 0)
      - w_down * max(C - U_rank, 0)
      + bias
      - (1 - w_down) * (K + ability)
```

`F`, the near-future option value, is computed for the investment view but is
never added to `V`.

### Current usefulness: C

`C` is usage-independent, stage-relative mechanical value on a 0–2000 scale.
It is the maximum of eight role scores:

```text
fast_attacker_penalty_q = fast_frailty_weight
  * (1 - speed_q) * (1 - effective_bulk_q)
fast_attacker  = geomean(damage_q, speed_q)
  * (1 - fast_attacker_penalty_q)
effective_bulk_q = clamp01(
  bulk_q + balanced_bulk_type_weight * (type_resilience_q - 0.5)
)
bulky_attacker = geomean(damage_q, effective_bulk_q)
specialist_bulky_attacker = soft_ceiling(
  geomean(damage_q, max(physical_bulk_q, special_bulk_q))
  + type_resilience_q - 0.5
)
tempo_attacker = soft_ceiling(
  geomean(damage_q, tempo_speed_q)
  + tempo_reliability_bonus * tempo_reliability_q
)
fast_utility   = utility_weight * non_passive * geomean(speed_q, utility_q)
bulky_utility  = utility_weight * non_passive * geomean(effective_bulk_q, utility_q)
priority_utility = priority_utility_weight * non_passive * priority_utility_q
screen_support = non_passive
  * geomean(screen_protection_q, screen_delivery_q)
```

Geometric means require every axis of a role to be credible. Speed and bulk are
percentiles blended between the full dex and forms reachable at the current
cap. Damage is measured against a stage-reference hit.

The additive routes (specialist bulk, tempo, and the priority-utility
saturation) can overshoot 1, so they saturate through `soft_ceiling` rather
than a hard clamp: identity up to a knee (default `0.9`), then asymptotic to —
never reaching — 1 above it:

```text
soft_ceiling(x) = x                                        for x <= knee
soft_ceiling(x) = knee + (1 - knee)
  * (1 - exp(-(x - knee) / (1 - knee)))                    for x > knee
```

A hard clamp mapped every overshoot to exactly 1, which tied several elite
mons at an identical `C = 2000` and flattened the local gradient the
confidence sweep depends on (a clamped role reads as stable under every
knob). The knee preserves the 2000-point bound and strict ordering; every
sub-knee score is unchanged.

The fast-attacker route receives a small, bounded action-access discount when
the build is both likely to move second and unable to absorb the reply. The
default maximum discount is `0.03`; either complete Speed or complete effective
bulk removes it. This preserves truly fast glass cannons while preventing a
merely middling-speed, paper-thin body from treating initiative as guaranteed.

The ordinary bulky roles require credible physical and special bulk. Their
neutral-hit bulk is adjusted by broad defensive typing with a weight of `0.3`:
neutral typing is unchanged, while favorable or vulnerable typing moves usable
bulk symmetrically before the role's geometric mean. The specialist route may
instead use the better defensive side, but only when typing supplies broadly
useful switch-in opportunities. Type balance sums
`1 - incoming_multiplier` across all 18 attack types: resistance contributes
`+0.5`, immunity `+1`, weakness `-1`, and a 4x weakness `-3`. Neutral balance
is normalized to `type_resilience_q = 0.5`; a net four favorable equivalents
reaches `1.0`, with the negative side mirrored. The signed adjustment is added
only inside this alternate role, and the soft ceiling preserves the 2000-point
bound. This lets a real one-sided tank count without letting a broadly
vulnerable body launder one high defensive stat.

Attacker offense is per-build and additive:

```text
damage_q = build_peak * (1 - portfolio_weight * (1 - breadth))
```

`build_peak` is the best attack actually carried by that build. Secondary
attacks add diminishing breadth through a noisy-OR, bounded by the peak threat.
This distinguishes a coverage build from a support build without inflating the
top of the score distribution.

Utility is currently derived from accuracy-weighted move roles such as
recovery, hazards, removal, speed control, setup, pivoting, phazing, screens,
disruption, status, and priority. The utility roles are gated by the Pokemon's
global best attack so a support build does not lose the fact that its body can
still threaten something.

`priority_utility_q` is the portion of that real support kit delivered by
Status moves that actually act above normal priority, either intrinsically or
through the assumed ability (notably Prankster). It is a separate role because
priority itself answers whether support gets a turn; base Speed or bulk should
not be used as a proxy. Damaging priority and role-less moves such as Protect
do not qualify. Each qualifying move earns its ordinary utility-role value plus
the existing priority-role value. A complete priority-support kit may share but
never exceed the same 2000-point ceiling as a complete attacker, and it keeps
the same non-passive guard.

`screen_support` values the amount of team protection delivered by one
executable action. Reflect or Light Screen protects one of the physical/special
axes, so either is `screen_protection_q = 0.5`; carrying both does not union two
turns into one action. Aurora Veil protects both axes and reaches `1.0`, but only
when hail is supplied by Snow Warning or a carried Hail move. Delivery is
complete when the screen genuinely acts at positive priority (including
Prankster), otherwise it is the user's stage-relative Speed percentile. A
complete protection action shares, but cannot exceed, the common 2000-point C
ceiling and keeps the non-passive guard. The same per-action fact participates
in build dominance, so a two-axis screen is not pruned as equivalent to a
one-axis screen.

The tempo-attacker route prices the unconditional turn-by-turn speed earned
from Speed Boost. `tempo_speed_q` is the form's +1 Speed percentile after one
turn, measured against the same stage reference as ordinary Speed. A set with
Speed Boost and a full-protect ramp move (Protect, Detect, King's Shield,
Spiky Shield, or Baneful Bunker) gets the bounded reliability completion bonus.
Speed Boost without protection still earns its observed post-turn speed but
not that bonus; protection without Speed Boost earns neither. The role remains
capped at the common 2000-point ceiling.

A reachable Mega is modeled as two explicit states. Evolution/readiness tracks
the base species the player fields, while damage, typing, stats, and legal moves
use the Mega battle form. The caught base ability remains a pre-Mega fact: a
Sharpedo can gain Speed Boost before becoming Mega Sharpedo with Strong Jaw.
Ability annotations and sensitivity swap that caught ability without replacing
the Mega's fixed active ability. Before the base species is reachable, a Mega
candidate continues to use the actual pre-evolution's battle form and ability.

### Usage prior: U_rank

Smogon usage is a prior, not a verdict. `U_rank` is a tier-dominant rank scalar
on the same scale as `C`:

```text
101 * tier_index + quantized_usage_percent + epsilon * C
```

A shallower first-meaningful tier always outranks within-tier usage. Mechanical
current value only breaks exact quantized ties.

### Usage trust

The readiness ramp is line-anchored: the representative form's canonical set
determines one earned-evidence ramp for the line, while every fielded form is
blended against its own prior.

```text
ramp   = representative_readiness * min((cap / target_level)^2, readiness_now)
w_up   = max(usage_influence * online_gate, ramp)
w_down = ramp                         for a dead line
       = min(ramp, prior_drag_cap)     for a line with real prior presence
```

The split encodes two decisions:

- **Absence law:** no meaningful presence in any tier is transferable negative
  evidence, so a dead line may converge fully downward.
- **Bounded-trust law:** presence somewhere proves that the body functions, but
  the magnitude of a deep PvP prior is meta-confounded for PvE. Downward drag is
  capped; upward convergence remains available.

Prior presence normally means a first-meaningful-tier ranking. A sustained
trace of at least `1%` in one of the ordered ladder's first three formats also
selects bounded downward trust: it is evidence against "absence everywhere,"
but remains a trace. It does not create `U_rank`, raise the score, or alter the
bench tier ordering. Deep-tier traces and weaker shallow traces remain under
the absence law.

### Online gate, friction, and bias

The online gate is derived from concrete readiness: fieldable representative,
legal damaging moves, current stats, and canonical-set assembly. A famous final
form cannot carry a body that cannot act at the current cap.

Evolution requirements are access gates and displayed information. Acquisition
grind defaults to zero score cost: the app recommends the strongest satisfiable
team and lets the player decide whether the grind is worthwhile. Delaying an
evolution to learn a move remains an in-run strength cost.

Usage and presentation metadata may break exact ties, but no boolean usage rule
may override `V`.

## Team value

Team selection starts with the sum of member values and adds team-fit terms:

- damage-aware offensive coverage, combined with a saturating noisy-OR;
- defensive shared-weakness and immunity value;
- usage-derived teammate synergy, phased in by pair readiness;
- explicit opponent-type bias when the user supplies it.

Chip damage contributes little coverage, the first real answer to a type is
worth more than duplicates, and future value never chooses the current six.
Large pools may use a coverage-preserving shortlist and swap polish when exact
enumeration would exceed the interactive search budget.

## Product invariants

1. Score is sovereign; seating may add team context but cannot secretly replace
   the individual value model.
2. If the user inputs an evolved species, the app evaluates that owned species
   rather than silently replacing it with its base form.
3. Current usefulness is measured against the stage and dex, not relative to a
   weak input pool.
4. Usage can inform current value without erasing strong PvE mechanics merely
   because a Pokemon has a deep competitive niche.
5. Legal moves, progression, breeding, evolution access, and held items remain
   factual constraints rather than verdict-fitting switches.
6. Near-future value is explanatory and must not select the current team.
7. Coverage is damage-aware and saturating.
8. Acquisition friction is informational by default; delayed-evolution strength
   costs remain priced.

## Where things live

- Tunable judgments and scoring version: `src/teamBuilder/scoringConstants.js`
- Current features and roles: `src/teamBuilder/currentFormValue.js`
- Usage rank, readiness, and final value: `src/teamBuilder/candidateScoring.js`
- Team coverage and defensive fit: `src/teamBuilder/searchKernel.js`
- Teammate usage synergy: `src/teamBuilder/teammateSynergy.js`
- Search orchestration and result cache version: `src/teamBuilder/teamOptimizer.js`
- Reborn legality and progression: `src/reborn/`
- Badge-bucket anchors: `test/calibration/`

The score-breakdown schema is consumed by the UI and caches. Important fields
include `score`, `teamScore`, `legalityScore` (`C`), `biasScore`, `ceiling`
(`U_rank`), `online`, `futureValue`, `friction`, `currentRole`,
`currentFeatures`, `meaningfulUsage`, `usagePercent`, `buildKey`,
`buildAlternatives`, and `legalityProof`.

## Validation

```bash
npm test
npm run validate:calibration
npm run e2e
```

- `npm test` is the fast mechanical/correctness suite. It should stay focused
  and cheap enough to run routinely.
- `npm run validate:calibration` runs the 19 real badge buckets. It is the only
  score-ranking calibration contract. CI runs it whenever the scoring engine or
  its inputs change; scoring-affecting changes must not land while it is red.
  UI-only and documentation-only changes do not run this expensive suite.
- `npm run e2e` covers a small browser-level product smoke surface.

The calibration injects seven consensus-strong anchors into every rolling badge
bucket and expects them to clear that bucket's top-quartile score:

```text
Excadrill, Scizor, Blaziken, Sharpedo, Aegislash, Primarina, Meowstic
```

Injected anchors receive scores in the shared optimizer run but do not move the
reference q75/q25 cutoffs. Those cutoffs come only from the real current-plus-
previous rolling bucket. Seven consensus-poor anchors must enter the bottom
quartile once obtainable:

```text
Tropius, Dunsparce, Sunflora, Ledian, Luvdisc, Delibird, Unown
```

Assertions are on score rank, not team seating. New subjective cases belong in
this corpus only when the user deliberately expands the anchor set.

## Current scoring work

The two-clause convergence law removed the previous late-game collapse of
strong PvE anchors. The remaining relative-rank findings were then addressed
as independent mechanical role misses rather than species-specific bonuses.

The recent work added a Speed Boost tempo-attacker role and corrected the Mega
battle-state model. Both signals are mechanical rather than species-specific:
post-turn Speed is measured directly, full protection only completes a real
Speed Boost ramp, and Mega stats/typing/active ability are separated from the
fielded base and its caught pre-Mega ability. Tempo facts participate in build
dominance, ability sensitivity sees the pre-Mega state, the confidence grid
sweeps the ramp completion bonus.

Measured against the exact 23-finding specialist-bulk baseline, the tempo and
Mega correction initially reduced rank violations to 8. Rebaselining the
instrument so injected probes no longer move their own percentile bar leaves 2
findings and 17 of 19 fully passing buckets. Every strong anchor now passes all
19 checkpoints.

The latest correction makes the ordinary balanced-bulk attacker and utility
routes consume typing-adjusted effective bulk. The coefficient bracket was
measured across all 19 buckets: `0.2` left Sunflora 28 points above q25; `0.3`
made both Sunflora and Tropius pass while exposing one independent Delibird
cutoff finding; `0.4` overcorrected the population and produced Delibird and
Dunsparce findings. The selected `0.3` is the smallest bracketed value that
completes the shared type-blind-bulk correction. It leaves 18 of 19 buckets
green with every strong anchor passing; Delibird scores 920 against badge 1's
q25 of 910. The confidence grid sweeps `0.2` and `0.4`, explanations expose raw
and effective bulk, and result cache version 34 invalidates older outputs.

The final Delibird finding exposed a gap between the fast-attacker label and
its action access: a merely middling-speed attacker could ignore a paper-thin,
broadly vulnerable body. The route now receives a bounded discount only where
its Speed deficit and effective-bulk deficit overlap. The weight bracket was
measured at badge 1: `0.02` left Delibird at 911 against q25 910, `0.03` moved
it to 907, and `0.05` was unnecessary. At the selected `0.03`, all 19 badge
buckets pass, every strong anchor clears q75, and every attainable poor anchor
clears q25. The confidence grid sweeps `0.02` and `0.05`, and result cache
version 35 invalidates older outputs.

The blinded follow-up cohort exposed two independent general signals. First,
team protection was being treated only as ordinary utility, so Aurora Veil's
two-axis protection in one action was indistinguishable from a conventional
screen. The new `screen_support` route measures single-action coverage,
execution requirements, and delivery. Second, a line just below the meaningful
usage bar in OU or higher was being treated as competitively absent. Sustained
shallow trace now selects bounded downward trust without receiving a rank or
upward credit.

With both corrections, the permanent badge calibration remains 19/19 green.
Among the six objective-compatible blinded best candidates, every candidate
meets the preregistered 10/19 minimum: Volcarona 19, Azumarill 13, Lucario 19,
Alakazam 19, Salamence 19, and Ninetales-Alola 10 (up from 4). The even best
cohort totals 48/57 against its preregistered 43/57 threshold. The six
objective-compatible weak candidates pass all 12 attainable bottom-quartile
checks, including Bastiodon evaluated through its Shieldon unlock. Rotom and
Simisear remain interpretation exclusions because their community penalties
price form flexibility and scarce-stone opportunity cost, respectively, while
the optimizer deliberately scores the strongest satisfiable team. Result
cache version 36 invalidates older outputs.

After each scoring-output change, bump `RESULT_CACHE_VERSION` in
`src/teamBuilder/teamOptimizer.js`. If generated data changes, regenerate the
manifest before committing.
