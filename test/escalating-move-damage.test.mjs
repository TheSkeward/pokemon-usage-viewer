import test from 'node:test';
import assert from 'node:assert/strict';

const { getEffectiveHitMultiplier } = await import(
  '../src/reborn/team-analysis.js',
);

test('Rollout and Ice Ball account for chain-ending misses', () => {
  const rollout = getEffectiveHitMultiplier({
    id: 'rollout',
    accuracy: 90,
  });
  const iceBall = getEffectiveHitMultiplier({
    id: 'iceball',
    accuracy: 90,
  });

  assert.ok(Math.abs(rollout - 2.1136) < 1e-12);
  assert.ok(Math.abs(iceBall - 2.1136) < 1e-12);
  assert.ok(Math.abs(rollout * 0.9 - 1.90224) < 1e-12);
});

test('a perfectly accurate escalating chain retains the five-turn weighting', () => {
  const multiplier = getEffectiveHitMultiplier({
    id: 'rollout',
    accuracy: 100,
  });

  assert.equal(multiplier, 5 / (1 + 1 / 2 + 1 / 4 + 1 / 8 + 1 / 16));
});
