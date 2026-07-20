import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getUsageRanking,
  hasCompetitivePriorEvidence,
  scoreCandidate,
} from '../src/teamBuilder/candidateScoring.js';

const formats = [
  'gen7anythinggoes',
  'gen7ubers',
  'gen7ou',
  'gen7uu',
];
const cutoffs = ['0'];
const traced = (formatId, value) => ({
  usage: { value: 0, formatId: 'gen7zu', cutoff: '0', entry: {} },
  trace: { formatId, value },
});

test('sustained shallow trace selects bounded trust without creating a rank', () => {
  const bundle = traced('gen7ou', 1);
  assert.equal(hasCompetitivePriorEvidence(bundle, formats, cutoffs), true);
  const rank = getUsageRanking(bundle, formats, cutoffs);
  assert.equal(rank.tierRank, rank.totalTiers);
});

test('weak or deep trace remains absence evidence', () => {
  assert.equal(
    hasCompetitivePriorEvidence(traced('gen7ou', 0.99), formats, cutoffs),
    false,
  );
  assert.equal(
    hasCompetitivePriorEvidence(traced('gen7uu', 2), formats, cutoffs),
    false,
  );
});

test('an existing meaningful rank remains prior evidence', () => {
  const bundle = {
    usage: { value: 0, entry: {} },
    ranking: { tierRank: 2, value: 3, rawCount: 100 },
  };
  assert.equal(hasCompetitivePriorEvidence(bundle, formats, cutoffs), true);
});

test('shallow trace changes only the downward-trust law', () => {
  const attack = {
    id: 'moonblast',
    name: 'Moonblast',
    category: 'Special',
    estimatedDamage: 120,
    roles: [],
    accuracy: 100,
  };
  const common = {
    availability: {
      familyConfigs: {
        singles: { formatOrder: formats, cutoffPriority: cutoffs },
      },
    },
    candidate: {},
    family: 'singles',
    legalityProfile: {
      currentId: 'ninetalesalola',
      fieldedId: 'ninetalesalola',
      representativeId: 'ninetalesalola',
      currentTypes: ['Ice', 'Fairy'],
      legalMoveCount: 1,
      recommendedDamagingMoveCount: 1,
      recommendedMoves: [attack],
      bestDamagingMove: attack,
      bestStabMove: attack,
      frictionCost: 0,
    },
    levelCap: 85,
    lineRamp: 1,
  };
  const dead = scoreCandidate({
    ...common,
    bundle: traced('gen7ou', 0.99),
  });
  const present = scoreCandidate({
    ...common,
    bundle: traced('gen7ou', 1),
  });
  assert.equal(dead.tierRank, present.tierRank);
  assert.equal(dead.ceiling, present.ceiling);
  assert.ok(present.score > dead.score);
});
