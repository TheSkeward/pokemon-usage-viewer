import assert from 'node:assert/strict';
import test from 'node:test';

import { currentFormValue } from '../src/teamBuilder/currentFormValue.js';

const moves = [
  {
    name: 'Primary STAB',
    category: 'Physical',
    estimatedDamage: 120,
    roles: [],
    accuracy: 100,
  },
  {
    name: 'Coverage',
    category: 'Physical',
    estimatedDamage: 90,
    roles: [],
    accuracy: 100,
  },
];

function profile(currentId, currentTypes) {
  return {
    currentId,
    currentTypes,
    bestDamagingMove: moves[0],
    bestStabMove: moves[0],
    recommendedDamagingMoveCount: moves.length,
    recommendedMoves: moves,
  };
}

test('fast attackers pay only for the overlap of middling speed and frailty', () => {
  const vulnerable = currentFormValue(
    profile('delibird', ['Ice', 'Flying']),
    25,
  );
  const neutral = currentFormValue(profile('delibird', ['Normal']), 25);

  assert.ok(vulnerable.features.speed_q > 0.5);
  assert.equal(vulnerable.features.effective_bulk_q, 0);
  assert.ok(vulnerable.features.fast_attacker_penalty_q > 0);
  assert.ok(
    vulnerable.features.fast_attacker_penalty_q >
      neutral.features.fast_attacker_penalty_q,
  );
  assert.ok(vulnerable.roles.fast_attacker < neutral.roles.fast_attacker);
});

test('complete speed preserves the legitimate glass-cannon route', () => {
  const value = currentFormValue(
    profile('deoxysspeed', ['Psychic']),
    100,
  );

  assert.equal(value.features.speed_q, 1);
  assert.equal(value.features.fast_attacker_penalty_q, 0);
});
