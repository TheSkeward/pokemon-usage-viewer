// Confidence layer (roadmap Phase 5): the recommendation is not one team from
// one parameter vector — it is the distribution of teams across every plausible
// setting of the model's judgement knobs. This module re-scores the already-
// resolved lines under a DETERMINISTIC grid of one-at-a-time perturbations
// (every axis the roadmap names: usage α, coverage weight/scale, portfolio,
// utility strictness, O-gate jitter, collapse penalty, R_cap blend, shortlist
// size, ability assumption, K friction) and reports, per mon, how often it is
// seated:
//
//   core     ≥ 90%   — recommend without hedging
//   likely   60–90%
//   flex     25–60%  — a genuine close call; say so
//   fragile  < 25%   — assumption-sensitive; never present as confident
//
// One-at-a-time perturbation is deliberate: it answers the reviewable question
// "does changing ONE knob silently produce a different confident team?", which
// is the false-precision failure mode this layer exists to defeat.
//
// Deterministic by construction (fixed grid, no randomness): reloads reproduce.

import { scoreCandidate } from "./candidateScoring.js";
import { choosePoolTeam } from "./teamSelection.js";
import { setScoringOverrides } from "./scoringConstants.js";

// CONSTRAINT for new settings: overrides are process-globals on THIS thread.
// Web Workers never receive them, so a setting that perturbs a constant read
// inside the search kernel (COVERAGE_WEIGHT, SYNERGY_SCALE, penalties, ...)
// must keep its search under PARALLEL_THRESHOLD combinations (SHORTLIST_MAX
// ≤ ~24 → C(24,6) ≈ 135k) so it runs synchronously on the main thread. Only
// shortlist-36 exceeds the threshold today, and it perturbs main-thread-read
// knobs only.
export const CONFIDENCE_GRID = [
  { key: "usage-low", overrides: { USAGE_INFLUENCE: 0.15 } },
  { key: "usage-high", overrides: { USAGE_INFLUENCE: 0.45 } },
  { key: "coverage-light", overrides: { COVERAGE_WEIGHT: 0.3 } },
  { key: "coverage-heavy", overrides: { COVERAGE_WEIGHT: 0.75 } },
  { key: "coverage-scale-low", overrides: { COVERAGE_SCALE: 80 } },
  { key: "coverage-scale-high", overrides: { COVERAGE_SCALE: 150 } },
  { key: "portfolio-off", overrides: { PORTFOLIO_WEIGHT: 0 } },
  { key: "portfolio-heavy", overrides: { PORTFOLIO_WEIGHT: 0.5 } },
  {
    key: "type-specialist-strict",
    overrides: { TYPE_RESILIENCE_FULL_SURPLUS: 6 },
  },
  {
    key: "type-specialist-generous",
    overrides: { TYPE_RESILIENCE_FULL_SURPLUS: 3 },
  },
  {
    key: "balanced-bulk-type-light",
    overrides: { BALANCED_BULK_TYPE_WEIGHT: 0.2 },
  },
  {
    key: "balanced-bulk-type-heavy",
    overrides: { BALANCED_BULK_TYPE_WEIGHT: 0.4 },
  },
  {
    key: "fast-frailty-light",
    overrides: { FAST_ATTACKER_FRAILTY_WEIGHT: 0.02 },
  },
  {
    key: "fast-frailty-heavy",
    overrides: { FAST_ATTACKER_FRAILTY_WEIGHT: 0.05 },
  },
  {
    key: "tempo-strict",
    overrides: { TEMPO_RELIABILITY_BONUS: 0.1 },
  },
  {
    key: "tempo-generous",
    overrides: { TEMPO_RELIABILITY_BONUS: 0.2 },
  },
  {
    key: "extender-light",
    overrides: { FIELD_EXTENDER_UTILITY_BONUS: 0.24 },
  },
  {
    key: "extender-heavy",
    overrides: { FIELD_EXTENDER_UTILITY_BONUS: 0.6 },
  },
  {
    key: "ceiling-knee-low",
    overrides: { ROLE_CEILING_KNEE: 0.85 },
  },
  {
    key: "ceiling-knee-high",
    overrides: { ROLE_CEILING_KNEE: 0.95 },
  },
  {
    key: "utility-strict",
    overrides: {
      UTILITY_ROLE_WEIGHT: 0.55,
      PRIORITY_UTILITY_ROLE_WEIGHT: 0.75,
    },
  },
  {
    key: "utility-generous",
    overrides: {
      UTILITY_ROLE_WEIGHT: 0.9,
      PRIORITY_UTILITY_ROLE_WEIGHT: 1,
    },
  },
  {
    key: "collapse-mild",
    overrides: { SHARED_WEAK_PENALTY: 120, UNCOVERED_WEAK_PENALTY: 170 },
  },
  {
    key: "collapse-harsh",
    overrides: { SHARED_WEAK_PENALTY: 260, UNCOVERED_WEAK_PENALTY: 380 },
  },
  { key: "gate-down", overrides: { ONLINE_JITTER: -1 } },
  { key: "gate-up", overrides: { ONLINE_JITTER: 1 } },
  { key: "rcap-global", overrides: { REACHABLE_BLEND: 0.25 } },
  { key: "rcap-local", overrides: { REACHABLE_BLEND: 0.75 } },
  { key: "friction-light", overrides: { FRICTION_SCALE: 0.5 } },
  { key: "friction-heavy", overrides: { FRICTION_SCALE: 2 } },
  { key: "ability-secondary", overrides: { ABILITY_ASSUMPTION: "secondary" } },
  { key: "shortlist-24", overrides: { SHORTLIST_MAX: 24 } },
  { key: "shortlist-36", overrides: { SHORTLIST_MAX: 36 } },
];

// The sweep trades a little optimality for a lot of speed: every setting runs
// exact-on-shortlist over the strongest 20 lines (the baseline team always
// re-competes; a setting that changes the verdict shows up regardless).
const SWEEP_SHORTLIST = 20;
// Only the plausible seat contenders are RESCORED per setting: the baseline
// top CONTENDER_LIMIT lines plus the current team. The grid's perturbations
// are one-knob nudges — a line has to already be near the seats for one to
// promote it — so rescoring the rest of the pool per setting is almost pure
// waste (the rescoring, not the search, dominates sweep time). Double the
// search's own shortlist keeps a wide apron of near-misses competing for the
// alternatives list.
const CONTENDER_LIMIT = 40;
// Forms per line handed to the sweep's search — see rescoreLine for the
// measured fidelity/speed trade behind the value.
const SWEEP_FORM_OPTIONS = 3;

export function classifyFrequency(frequency) {
  if (frequency >= 0.9) return "core";
  if (frequency >= 0.6) return "likely";
  if (frequency >= 0.25) return "flex";
  return "fragile";
}

export async function computeTeamConfidence({
  result,
  availability,
  family,
  progression,
  // Checked before every grid setting; truthy abandons the sweep (returns
  // null). The caller uses this to guarantee a NEW optimize never executes
  // inside a setting's scoring-override window — overrides are process
  // globals, and a concurrent optimize scored under them would be cached
  // and persisted under the base signature.
  shouldAbort = () => false,
}) {
  const allLines = (result?.lines || []).filter(
    (line) => line.best || line.bestNonMega,
  );
  if (!allLines.length || !result?.team?.length) return null;
  const lines = selectSweepContenders(allLines, result.team);

  const levelCap = Number.parseInt(progression?.levelCap, 10) || 0;
  const opponentTypeBias = progression?.opponentTypeBias || {};
  const context = { availability, family, levelCap, opponentTypeBias };

  const seatCounts = new Map(); // inputPokemonId -> settings seated
  const dropConditions = new Map(); // inputPokemonId -> [setting keys where absent]
  const baseTeamIds = new Set(result.team.map((c) => c.inputPokemonId));
  const record = (teamIds, settingKey) => {
    for (const id of teamIds) {
      seatCounts.set(id, (seatCounts.get(id) || 0) + 1);
    }
    for (const id of baseTeamIds) {
      if (!teamIds.has(id)) {
        if (!dropConditions.has(id)) dropConditions.set(id, []);
        dropConditions.get(id).push(settingKey);
      }
    }
  };

  // The baseline run counts too — the real recommendation is one of the grid's
  // data points, not an outside observer.
  record(baseTeamIds, "baseline");

  for (const setting of CONFIDENCE_GRID) {
    if (shouldAbort()) return null;
    setScoringOverrides({
      ...setting.overrides,
      FORCE_SHORTLIST: true,
      SHORTLIST_MAX: setting.overrides.SHORTLIST_MAX || SWEEP_SHORTLIST,
      // The sweep asks WHICH SIX SEAT, not for a perfectly re-ranked
      // realization: a small realization pool keeps each setting cheap
      // (the production run keeps its full 64).
      REALIZATION_POOL: 8,
    });
    try {
      const rescored = lines.map((line) => rescoreLine(line, context));
      const swept = await choosePoolTeam(rescored, opponentTypeBias, {
        exhaustive: false,
        // Bench-swap ranking is hundreds of full team evaluations per call
        // and only feeds the bench UI — the sweep never reads it.
        benchSwaps: false,
      });
      record(new Set(swept.team.map((c) => c.inputPokemonId)), setting.key);
    } finally {
      setScoringOverrides(null);
    }
    // Yield a real macrotask between settings. Each setting's search resolves
    // synchronously (shortlist path, no worker round-trip), so without this
    // the whole sweep runs inside ONE task — no paints, no fetch callbacks,
    // and async panels starve behind it.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const totalSettings = CONFIDENCE_GRID.length + 1;
  const members = result.team.map((choice) => {
    const count = seatCounts.get(choice.inputPokemonId) || 0;
    const frequency = count / totalSettings;
    return {
      inputPokemonId: choice.inputPokemonId,
      inputName: choice.inputName,
      frequency,
      tier: classifyFrequency(frequency),
      dropConditions: dropConditions.get(choice.inputPokemonId) || [],
    };
  });

  // Bench mons that seat under some settings: the honest "flex alternatives".
  const alternatives = [];
  for (const [id, count] of seatCounts) {
    if (baseTeamIds.has(id)) continue;
    const frequency = count / totalSettings;
    if (frequency < 0.1) continue;
    const line = lines.find(
      (entry) => (entry.best || entry.bestNonMega)?.inputPokemonId === id,
    );
    alternatives.push({
      inputPokemonId: id,
      inputName: (line?.best || line?.bestNonMega)?.inputName || id,
      frequency,
    });
  }
  alternatives.sort((a, b) => b.frequency - a.frequency);

  return { settings: totalSettings, members, alternatives };
}

// The baseline top CONTENDER_LIMIT lines by realized score, plus every line
// carrying a current team member (they must always re-compete). Deterministic:
// score, then inputPokemonId — same inputs, same contender set, same sweep.
function selectSweepContenders(allLines, team) {
  if (allLines.length <= CONTENDER_LIMIT) return allLines;
  const scoreOf = (line) => {
    const choice = line.best || line.bestNonMega;
    return choice?.teamScore ?? choice?.score ?? -Infinity;
  };
  const idOf = (line) => (line.best || line.bestNonMega)?.inputPokemonId || "";
  const ranked = [...allLines].sort(
    (a, b) => scoreOf(b) - scoreOf(a) || idOf(a).localeCompare(idOf(b)),
  );
  const teamIds = new Set(team.map((choice) => choice.inputPokemonId));
  const kept = new Set(ranked.slice(0, CONTENDER_LIMIT));
  for (const line of allLines) {
    if (teamIds.has(idOf(line))) kept.add(line);
  }
  // Original pool order, so the contender cut can't reorder anything
  // downstream reads.
  return allLines.filter((line) => kept.has(line));
}

// Re-scores a line's choices under the ACTIVE overrides. Profiles and bundles
// are reused untouched (they are mechanical facts — and build variants are
// dominance-pruned on mechanical facts only, so no alternative a setting might
// prefer was discarded under default constants); only the judgement layer
// (scoreCandidate) re-runs. The representative build is RE-PICKED per setting:
// under "utility-strict" a different build of the same form may deserve to
// carry the line. Clones everything it touches so sweep state never leaks.
function rescoreLine(line, context) {
  const clone = { ...line, _choiceOptions: undefined };
  const rescoreChoice = (choice) => {
    if (!choice || !choice.legalityProfile) return choice;
    const rescored = {
      ...choice,
      ...scoreCandidate({
        availability: context.availability,
        bundle: choice.bundle,
        candidate: { id: choice.pokemonId, isMega: choice.isMega },
        family: context.family,
        legalityProfile: choice.legalityProfile,
        levelCap: context.levelCap,
        opponentTypeBias: context.opponentTypeBias,
        // Same line-anchored usage trust as the production run — without it
        // scoreCandidate falls back to a PER-FORM ramp, so every setting
        // would re-score under a different w regime than the baseline it's
        // compared against (a pre-evo could dodge the endgame drag).
        lineRamp: line.lineRamp ?? 0,
        linePriorPresent: line.linePriorPresent ?? null,
      }),
    };
    if (choice.buildAlternatives?.length) {
      const builds = choice.buildAlternatives.map((build) =>
        rescoreChoice({ ...build, buildAlternatives: undefined }),
      );
      // Representative = best build UNDER THIS SETTING; alternatives and the
      // optimistic vector (settings-independent) ride along.
      const best = builds.reduce((lead, build) =>
        (build.teamScore ?? -Infinity) > (lead.teamScore ?? -Infinity)
          ? build
          : lead,
      );
      return {
        ...best,
        buildAlternatives: builds,
        optimisticCoverageVector:
          choice.optimisticCoverageVector || best.optimisticCoverageVector,
      };
    }
    return rescored;
  };
  // Rescore every form option, then hand the search the setting's best form
  // plus alternates ONLY where they differ in TYPING from it. The search's
  // per-team form assignment is its cartesian hot loop (bestAssignmentForLines
  // × fastTeamFit), and at low caps nearly every line legally fields 2–3
  // forms — but a form that shares the leader's typing is a pure
  // score/friction variant, and the per-setting argmax already chose among
  // those. Team-CONTEXT choice only matters when forms differ in shape —
  // Eevee's branches, Magikarp/Gyarados, Cottonee/Whimsicott — collapsing
  // those measurably distorts seat counts; collapsing same-typing variants
  // does not. Deterministic: teamScore, then pokemonId.
  const rescoredForms = new Map();
  for (const option of [line.best, line.bestNonMega, ...(line.choiceOptions || [])]) {
    if (option && !rescoredForms.has(option.pokemonId)) {
      rescoredForms.set(option.pokemonId, rescoreChoice(option));
    }
  }
  const ranked = [...rescoredForms.values()].sort((a, b) => {
    const aScore = a.teamScore ?? a.score ?? -Infinity;
    const bScore = b.teamScore ?? b.score ?? -Infinity;
    return bScore - aScore || String(a.pokemonId).localeCompare(String(b.pokemonId));
  });
  const typingOf = (option) =>
    (option.legalityProfile?.currentTypes || []).join("/");
  const kept = ranked.length ? [ranked[0]] : [];
  for (const option of ranked.slice(1)) {
    if (kept.length >= SWEEP_FORM_OPTIONS) break;
    if (kept.every((k) => typingOf(k) !== typingOf(option))) kept.push(option);
  }
  // The mega constraint needs a non-mega fallback available to the search.
  if (kept.length && kept.every((option) => option.isMega)) {
    const nonMega = ranked.find((option) => !option.isMega);
    if (nonMega) kept.push(nonMega);
  }
  clone.choiceOptions = kept;
  clone.best = kept[0] || null;
  clone.bestNonMega = kept.find((option) => !option.isMega) || null;
  return clone;
}
