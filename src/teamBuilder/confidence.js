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

export const CONFIDENCE_GRID = [
  { key: "usage-low", overrides: { USAGE_INFLUENCE: 0.15 } },
  { key: "usage-high", overrides: { USAGE_INFLUENCE: 0.45 } },
  { key: "coverage-light", overrides: { COVERAGE_WEIGHT: 0.3 } },
  { key: "coverage-heavy", overrides: { COVERAGE_WEIGHT: 0.75 } },
  { key: "coverage-scale-low", overrides: { COVERAGE_SCALE: 80 } },
  { key: "coverage-scale-high", overrides: { COVERAGE_SCALE: 150 } },
  { key: "portfolio-off", overrides: { PORTFOLIO_WEIGHT: 0 } },
  { key: "portfolio-heavy", overrides: { PORTFOLIO_WEIGHT: 0.25 } },
  { key: "utility-strict", overrides: { UTILITY_ROLE_WEIGHT: 0.55 } },
  { key: "utility-generous", overrides: { UTILITY_ROLE_WEIGHT: 0.9 } },
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
}) {
  const lines = (result?.lines || []).filter(
    (line) => line.best || line.bestNonMega,
  );
  if (!lines.length || !result?.team?.length) return null;

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
    setScoringOverrides({
      ...setting.overrides,
      FORCE_SHORTLIST: true,
      SHORTLIST_MAX: setting.overrides.SHORTLIST_MAX || SWEEP_SHORTLIST,
    });
    try {
      const rescored = lines.map((line) => rescoreLine(line, context));
      const swept = await choosePoolTeam(rescored, opponentTypeBias, {
        exhaustive: false,
      });
      record(new Set(swept.team.map((c) => c.inputPokemonId)), setting.key);
    } finally {
      setScoringOverrides(null);
    }
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

// Re-scores a line's choices under the ACTIVE overrides. Profiles and bundles
// are reused untouched (they are mechanical facts); only the judgement layer
// (scoreCandidate) re-runs. Clones everything it touches so sweep state never
// leaks into the real result.
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
      }),
    };
    if (choice.buildAlternatives?.length) {
      rescored.buildAlternatives = choice.buildAlternatives.map((build) =>
        build === choice ? rescored : rescoreChoice({ ...build, buildAlternatives: undefined }),
      );
    }
    return rescored;
  };
  clone.best = rescoreChoice(line.best);
  clone.bestNonMega = rescoreChoice(line.bestNonMega);
  if (line.choiceOptions) {
    clone.choiceOptions = line.choiceOptions.map(rescoreChoice);
  }
  return clone;
}
