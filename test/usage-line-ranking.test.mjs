import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SCORED_POOL_LIMIT,
  compareLineUsageBestFirst,
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
