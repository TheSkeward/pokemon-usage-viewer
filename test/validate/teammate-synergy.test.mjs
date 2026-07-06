// Phase 3 (usage-convergence): competitive teammate co-use lift, calibrated.
// The blend's contracts, each pinned end-to-end or surgically on the kernel:
//   1. V0 never sees the term (usageWeight is identically 0 under V0).
//   2. Trust gates everything: with lift data but zero trust, the fit is the
//      original hand-built formula, bit-for-bit, at any SYNERGY_SCALE.
//   3. At full trust with full pair data the hand-built judgements are GONE
//      (user ruling: fade to zero) and the fit is exactly
//      COVERAGE_WEIGHT × SYNERGY_SCALE × Σ lift — except the bias-boosted
//      share of coverage, which never fades (bias is the insurance).
//   4. Missing index files degrade silently (trust 0 pairs, no throw).
//   5. At the calibrated scale, a real competitive core (gen7uu regenerator
//      trio, pair lifts +46..+58) wins endgame seats it does NOT win with
//      the term disabled.
import test from "node:test";
import assert from "node:assert/strict";
import { runPool, progressionAt, teamInputNames, teamSet } from "../helpers/harness.mjs";
import {
  REBORN_ANALYSIS_TYPES,
  getRealizedTeamScore,
  getTeamScore,
  prepareFitScoring,
  resetFitScoring,
} from "../../src/teamBuilder/searchKernel.js";
import { setScoringOverrides, tunable } from "../../src/teamBuilder/scoringConstants.js";

const MIDGAME_POOL = ["Machop", "Growlithe", "Tentacool", "Abra", "Doduo", "Mareep", "Gastly", "Rhyhorn"];

test("V0: synergy term is inert even with lift data present", async () => {
  // This pool DOES have cross-line lift data (abra<->gastly +11 among others),
  // so this pins the model gate itself: V0 usageWeight is identically 0.
  const on = await runPool({ pool: MIDGAME_POOL, badge: 8, levelCap: 45, overrides: { SYNERGY_SCALE: 4 } });
  const off = await runPool({ pool: MIDGAME_POOL, badge: 8, levelCap: 45, overrides: { SYNERGY_SCALE: 0 } });
  assert.deepEqual(teamInputNames(on), teamInputNames(off));
  const scoreOf = (result) =>
    result.lines.map((line) => Math.round(line.best?.score ?? 0)).join(",");
  assert.equal(scoreOf(on), scoreOf(off));
});

// --- Surgical kernel contracts on a synthetic full-data team ---------------
// Six mono-Water members (stacked Grass/Electric weaknesses), zero base
// coverage, all 15 pairs carrying +10 lift. teamScore 0 so the realized team
// score IS the weighted fit.
const TYPE_COUNT = REBORN_ANALYSIS_TYPES.length;
const GRASS = REBORN_ANALYSIS_TYPES.indexOf("Grass");

function syntheticTeam({ trust, grassCoverage = 0 }) {
  const ids = ["a", "b", "c", "d", "e", "f"];
  return ids.map((id) => {
    const coverageVector = new Array(TYPE_COUNT).fill(0);
    coverageVector[GRASS] = grassCoverage;
    const teammates = {};
    for (const other of ids) if (other !== id) teammates[other] = 10;
    return {
      pokemonId: id,
      inputPokemonId: id,
      name: id,
      isMega: false,
      score: 0,
      teamScore: 0,
      usageWeight: trust,
      _teammates: teammates,
      legalityProfile: { currentTypes: ["Water"], attackTypes: [], coverageVector },
    };
  });
}

test("zero trust keeps the hand-built formula bit-identical at any scale", () => {
  const team = syntheticTeam({ trust: 0 });
  setScoringOverrides({ SYNERGY_SCALE: 0 });
  const off = getRealizedTeamScore(team, {});
  setScoringOverrides({ SYNERGY_SCALE: 4 });
  const on = getRealizedTeamScore(team, {});
  setScoringOverrides(null);
  assert.equal(on, off);
  // and the hand-built judgements are actually active (stacked weaknesses)
  assert.ok(off < 0, `expected penalties to bite, got ${off}`);
});

test("full trust + full pair data: fit is exactly the synergy term", () => {
  const team = syntheticTeam({ trust: 1 });
  // Σ lift = 15 pairs × 10 = 150; fit weight halves the scale's points.
  const expected = tunable("COVERAGE_WEIGHT") * tunable("SYNERGY_SCALE") * 150;
  const total = getRealizedTeamScore(team, {});
  assert.ok(Math.abs(total - expected) < 1e-9, `${total} !== ${expected}`);
  // kill switch still works at full trust
  setScoringOverrides({ SYNERGY_SCALE: 0 });
  const off = getRealizedTeamScore(team, {});
  setScoringOverrides(null);
  assert.ok(Math.abs(off) < 1e-9, `expected 0, got ${off}`);
});

test("bias-boosted coverage never fades; base coverage does (user ruling)", () => {
  const team = syntheticTeam({ trust: 1, grassCoverage: 0.6 });
  const synergyOnly = tunable("COVERAGE_WEIGHT") * tunable("SYNERGY_SCALE") * 150;
  // No bias: at full trust the base coverage share is fully faded, so the
  // Grass answers are worth nothing — fit is still exactly the synergy term.
  const noBias = getRealizedTeamScore(team, {});
  assert.ok(Math.abs(noBias - synergyOnly) < 1e-9, `${noBias} !== ${synergyOnly}`);
  // Max Grass bias: the boosted share survives full convergence.
  const biased = getRealizedTeamScore(team, { Grass: 6 });
  assert.ok(biased > noBias + 1, `bias share faded: ${biased} <= ${noBias}`);
  // Lockstep: the search's fastTeamFit path scores this identically to the
  // exact path (same trust, same lift, same blend).
  const lines = team.map((choice) => ({ lineKey: choice.pokemonId, best: choice }));
  prepareFitScoring(lines, { Grass: 6 });
  const fast = getTeamScore(team, { Grass: 6 });
  resetFitScoring(lines);
  assert.ok(Math.abs(fast - biased) < 1e-9, `fast ${fast} !== exact ${biased}`);
});

// --- End-to-end, real data --------------------------------------------------
const ENDGAME = {
  progression: {
    ...progressionAt({ badge: 18, levelCap: 100 }),
    daycareUnlocked: true,
    moveRelearnerUnlocked: true,
  },
};

test("missing teammate-index files degrade silently under v1", async () => {
  // No form of any of these lines has a lift entry for any other (verified
  // against the shipped index; psyduck/whismur/azurill lines have no files at
  // all) — so the term must be inert end-to-end even at endgame trust.
  const pool = ["Psyduck", "Whismur", "Azurill", "Doduo", "Mareep", "Rhyhorn"];
  const run = (scale) =>
    runPool({ pool, ...ENDGAME, overrides: { USAGE_MODEL: "v1", SYNERGY_SCALE: scale } });
  const on = await run(4);
  const off = await run(0);
  assert.deepEqual(teamInputNames(on), teamInputNames(off));
  assert.equal(
    Math.round(getRealizedTeamScore(on.team, {})),
    Math.round(getRealizedTeamScore(off.team, {})),
  );
});

test("endgame: the gen7uu regenerator core wins its seats from the synergy term", async () => {
  // Blissey/Quagsire/Alomomola (pair lifts +46..+58) vs same-era strangers.
  // Without the term the trio never sits together; at the calibrated scale
  // the core's co-use record buys the marginal seats.
  const pool = [
    "Blissey", "Quagsire", "Alomomola", "Forretress", "Ambipom", "Arcanine",
    "Altaria", "Golduck", "Exploud", "Swampert", "Gardevoir", "Dodrio",
  ];
  const core = ["Blissey", "Quagsire", "Alomomola"];
  const withSynergy = await runPool({ pool, ...ENDGAME, overrides: { USAGE_MODEL: "v1" } });
  const seated = teamSet(withSynergy);
  for (const name of core) {
    assert.ok(seated.has(name), `${name} missing from ${[...seated].join(", ")}`);
  }
  const without = await runPool({
    pool,
    ...ENDGAME,
    overrides: { USAGE_MODEL: "v1", SYNERGY_SCALE: 0 },
  });
  const seatedOff = teamSet(without);
  assert.ok(
    !core.every((name) => seatedOff.has(name)),
    `core seated together even with synergy disabled: ${[...seatedOff].join(", ")}`,
  );
});
