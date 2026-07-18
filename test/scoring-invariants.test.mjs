// Numeric invariants of the scoring constants that no other test guards.
import test from "node:test";
import assert from "node:assert/strict";

const { SCORING_DEFAULTS } = await import(
  "../src/teamBuilder/scoringConstants.js"
);

test("ε·C tiebreak can never override a real quantized usage difference", () => {
  // The ε·C term breaks exact (quantized) usage-rank ties by current value.
  // Its maximum possible contribution — EPSILON_C at the full C scale — must
  // stay strictly below one usage quantum, or the tiebreak could reorder
  // rows with genuinely different usage. Comments long claimed a test
  // asserted this; now one does.
  const maxTiebreak =
    SCORING_DEFAULTS.EPSILON_C * SCORING_DEFAULTS.CURRENT_VALUE_SCALE;
  assert.ok(
    maxTiebreak < SCORING_DEFAULTS.USAGE_QUANTUM,
    `EPSILON_C × CURRENT_VALUE_SCALE (${maxTiebreak}) must stay below USAGE_QUANTUM (${SCORING_DEFAULTS.USAGE_QUANTUM})`,
  );
});

test("tier steps always dominate within-tier usage", () => {
  // A shallower first-meaningful tier must outrank ANY within-tier usage
  // value; usage % maxes at 100, so the step must exceed it.
  assert.ok(SCORING_DEFAULTS.TIER_STEP > 100);
});
