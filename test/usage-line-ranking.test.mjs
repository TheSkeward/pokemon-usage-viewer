import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SCORED_POOL_LIMIT,
  compareLineUsageBestFirst,
  deduplicateUsageEntries,
  getLineUsageOrder,
  takeTopUsageEntries,
} from '../src/teamBuilder/usage-line-ranking.js';

function candidate(name, { ranking = null, trace = null } = {}) {
  return {
    candidate: { name },
    bundle: { ranking, trace },
  };
}

test('scoring cutoff uses the numbered-bench usage order', () => {
  const orders = [
    getLineUsageOrder([
      candidate('Deep', { ranking: { tierRank: 2, value: 20 } }),
    ], 'Deep input'),
    getLineUsageOrder([
      candidate('Shallow low', { ranking: { tierRank: 0, value: 3 } }),
    ], 'Shallow low input'),
    getLineUsageOrder([
      candidate('Shallow high', { ranking: { tierRank: 0, value: 8 } }),
    ], 'Shallow high input'),
    getLineUsageOrder([
      candidate('Trace deep', { trace: { tierRank: 6, value: 2 } }),
    ], 'Trace deep input'),
    getLineUsageOrder([
      candidate('Trace shallow', { trace: { tierRank: 2, value: 1.5 } }),
    ], 'Trace shallow input'),
    getLineUsageOrder([], 'Absent input'),
  ];

  orders.sort(compareLineUsageBestFirst);
  assert.deepEqual(
    orders.map((order) => order.fallbackName),
    [
      'Shallow high input',
      'Shallow low input',
      'Deep input',
      // 2% reaches the visibility bar sooner than 1.5%, even from a deeper
      // tier; this is the bench trace-tail rule.
      'Trace deep input',
      'Trace shallow input',
      'Absent input',
    ],
  );
});

test('top-usage selection caps scoring at six team plus 120 bench slots', () => {
  const entries = Array.from(
    { length: SCORED_POOL_LIMIT + 4 },
    (_, index) => ({
      id: index,
      usageOrder: getLineUsageOrder([
        candidate(`Pokemon ${index}`, {
          ranking: { tierRank: 0, value: 1000 - index },
        }),
      ], `Input ${index}`),
    }),
  );

  const selected = takeTopUsageEntries(entries);
  assert.equal(SCORED_POOL_LIMIT, 126);
  assert.equal(selected.length, 126);
  assert.deepEqual(
    selected.map((entry) => entry.id),
    Array.from({ length: 126 }, (_, index) => index),
  );
});

test('an evolutionary line ranks by its best reachable form bundle', () => {
  const order = getLineUsageOrder([
    candidate('Owned pre-evolution', {
      ranking: { tierRank: 5, value: 7 },
    }),
    candidate('Eventual evolution', {
      ranking: { tierRank: 1, value: 4 },
    }),
  ], 'Owned pre-evolution');

  assert.equal(order.ceiling.name, 'Eventual evolution');
  assert.equal(order.ceiling.tierRank, 1);
});

test('duplicate bench identities consume one slot and prefer the exact form', () => {
  const usageOrder = getLineUsageOrder([
    {
      candidate: { id: 'swanna', name: 'Swanna' },
      bundle: { ranking: { tierRank: 5, value: 4.1 } },
    },
  ], 'Ducklett');
  const entries = [
    {
      inputPokemonId: 'ducklett',
      inputEvolutionDepth: 0,
      displayKey: 'swanna',
      usageOrder,
    },
    {
      inputPokemonId: 'swanna',
      inputEvolutionDepth: 1,
      displayKey: 'swanna',
      usageOrder: { ...usageOrder, fallbackName: 'Swanna' },
    },
  ];

  const unique = deduplicateUsageEntries(entries);
  assert.equal(unique.length, 1);
  assert.equal(unique[0].inputPokemonId, 'swanna');
});

test('ability-annotated inputs never merge with differently annotated ones', () => {
  // Regression: dedup once keyed on displayKey alone, so Froakie (Protein)
  // and a plain Greninja input merged onto one bench slot and the annotated
  // line silently vanished from the scored pool.
  const order = { ceiling: { pokemonId: 'greninja', name: 'Greninja', tierRank: 1, value: 9 }, fallbackName: '' };
  const entries = [
    { displayKey: 'greninja', abilityAnnotation: 'Protean',
      inputPokemonId: 'froakie', inputEvolutionDepth: 0, usageOrder: order },
    { displayKey: 'greninja', abilityAnnotation: null,
      inputPokemonId: 'greninja', inputEvolutionDepth: 2, usageOrder: order },
  ];
  const unique = deduplicateUsageEntries(entries);
  assert.equal(unique.length, 2);
});
