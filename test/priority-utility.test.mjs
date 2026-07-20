import assert from 'node:assert/strict';
import test from 'node:test';

import {
  currentFormFeatures,
  currentFormValue,
  priorityUtilityValue,
  utilityTagVector,
} from '../src/teamBuilder/currentFormValue.js';

const screen = (name) => ({
  name,
  category: 'Status',
  priority: 0,
  roles: ['screen'],
  accuracy: 100,
});

const supportMoves = [
  screen('Reflect'),
  screen('Light Screen'),
  {
    name: 'Calm Mind',
    category: 'Status',
    priority: 0,
    roles: ['setup'],
    accuracy: 100,
  },
];

test('Prankster turns a substantive status kit into priority utility', () => {
  assert.equal(priorityUtilityValue(supportMoves, 'Competitive'), 0);
  assert.equal(priorityUtilityValue(supportMoves, 'Prankster'), 3.1);

  const ordinary = utilityTagVector(supportMoves, 'Competitive');
  const prankster = utilityTagVector(supportMoves, 'Prankster');
  assert.equal(ordinary.at(-1), 0);
  assert.equal(prankster.at(-1), 3);
});

test('priority utility excludes attacks and role-less defensive timing', () => {
  const moves = [
    {
      name: 'Quick Attack',
      category: 'Physical',
      priority: 1,
      roles: ['priority'],
      accuracy: 100,
    },
    {
      name: 'Protect',
      category: 'Status',
      priority: 4,
      roles: [],
      accuracy: 100,
    },
    {
      name: 'Trick Room',
      category: 'Status',
      priority: -7,
      roles: ['speed_control'],
      accuracy: 100,
    },
  ];
  assert.equal(priorityUtilityValue(moves, 'Prankster'), 0);
});

test('intrinsic positive-priority support qualifies without Prankster', () => {
  const move = {
    name: 'Fast Tailwind',
    category: 'Status',
    priority: 1,
    roles: ['speed_control'],
    accuracy: 100,
  };
  assert.ok(
    Math.abs(priorityUtilityValue([move], 'Competitive') - 1.2) < 1e-9,
  );
});

test('priority support is a distinct current-value role', () => {
  const baseProfile = {
    currentId: 'meowstic',
    bestDamagingMove: { estimatedDamage: 164 },
    bestStabMove: { estimatedDamage: 164 },
    recommendedDamagingMoveCount: 1,
    recommendedMoves: [
      {
        name: 'Psychic',
        category: 'Special',
        estimatedDamage: 164,
        roles: [],
        accuracy: 100,
      },
      ...supportMoves,
    ],
  };
  const ordinary = currentFormFeatures(
    { ...baseProfile, assumedAbility: 'Competitive' },
    85,
  );
  const pranksterProfile = { ...baseProfile, assumedAbility: 'Prankster' };
  const prankster = currentFormFeatures(pranksterProfile, 85);

  assert.equal(ordinary.priorityUtilityQ, 0);
  // A saturated kit approaches the ceiling through the soft knee instead of
  // pinning at exactly 1, so deeper kits still order above shallower ones.
  assert.ok(prankster.priorityUtilityQ > 0.95);
  assert.ok(prankster.priorityUtilityQ < 1);
  assert.equal(
    currentFormValue(pranksterProfile, 85).bestRole,
    'priority_utility',
  );
});
