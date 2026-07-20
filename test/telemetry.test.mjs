import test from 'node:test';
import assert from 'node:assert/strict';

// In-memory localStorage so record/load round-trips like a real browser.
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

const {
  recordOptimizerSample,
  loadTelemetrySamples,
  getTelemetrySummary,
  buildPerformanceReport,
  clearTelemetry,
  percentile,
  poolBucket,
  buildBucket,
  estimateRunBudget,
} = await import('../src/teamBuilder/telemetry.js');







test('performance report is redacted and self-describing', () => {
  clearTelemetry();
  recordOptimizerSample({
    cache: 'warm',
    resolveMs: 300,
    searchMs: 40,
    poolSize: 20,
    builds: 55,
    dataSignature: 'sig',
  });
  const report = buildPerformanceReport();
  assert.equal(report.report, 'team-optimizer-performance');
  assert.ok(report.env.includes('sig'));
  assert.equal(report.summary.runs, 1);
  assert.equal(report.lastRun.cache, 'warm');
  assert.equal(report.lastRun.poolSize, 20);
  // Nothing that could carry pool/team content: every key in the tree is a
  // known metric/metadata key — no query text, mon names, or move lists.
  const keys = new Set();
  JSON.stringify(report, (key, value) => {
    if (key) keys.add(key);
    return value;
  });
  for (const key of keys) {
    assert.ok(
      !/query|pokemon|mon|move|species|input/i.test(key),
      `content-shaped key in report: ${key}`,
    );
  }
});


