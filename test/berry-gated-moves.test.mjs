// Belch berry gate regression: Skuntank was recommended Belch while
// holding no berry. Belch only works after the holder has eaten a berry, so
// without a held berry it must not count as a damaging move.
import test from 'node:test';
import assert from 'node:assert/strict';

await import('./helpers/harness.mjs'); // fetch → filesystem shim
const { isUsableDamagingMove } = await import('../src/reborn/team-analysis.js');

const belch = { id: 'belch', name: 'Belch', type: 'Poison', category: 'Special', basePower: 120 };
const sludgeBomb = { id: 'sludgebomb', name: 'Sludge Bomb', type: 'Poison', category: 'Special', basePower: 90 };
const moves = [belch, sludgeBomb];

test('Belch is not a usable attack without a held berry', () => {
  assert.equal(isUsableDamagingMove(belch, moves, null), false);
  assert.equal(isUsableDamagingMove(belch, moves, 'Black Sludge'), false);
});

test('Belch is a usable attack with a held berry', () => {
  assert.equal(isUsableDamagingMove(belch, moves, 'Sitrus Berry'), true);
});

test('the berry gate touches only berry-gated moves', () => {
  assert.equal(isUsableDamagingMove(sludgeBomb, moves, null), true);
});
