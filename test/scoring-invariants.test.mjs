import test from 'node:test';
import assert from 'node:assert/strict';

const { SCORING_DEFAULTS } = await import(
  '../src/teamBuilder/scoring-constants.js',
);

test('ε·C tiebreak can never override a real quantized usage difference', () => {
  const maxTiebreak =
    SCORING_DEFAULTS.EPSILON_C * SCORING_DEFAULTS.CURRENT_VALUE_SCALE;
  assert.ok(
    maxTiebreak < SCORING_DEFAULTS.USAGE_QUANTUM,
    `EPSILON_C × CURRENT_VALUE_SCALE (${maxTiebreak}) must stay below USAGE_QUANTUM (${SCORING_DEFAULTS.USAGE_QUANTUM})`,
  );
});

test('tier steps always dominate within-tier usage', () => {
  assert.ok(SCORING_DEFAULTS.TIER_STEP > 100);
});
