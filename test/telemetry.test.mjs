import test from "node:test";
import assert from "node:assert/strict";

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
  clearTelemetry,
  percentile,
} = await import("../src/teamBuilder/telemetry.js");

test("percentile is nearest-rank", () => {
  const sorted = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  assert.equal(percentile(sorted, 50), 50);
  assert.equal(percentile(sorted, 90), 90);
  assert.equal(percentile(sorted, 95), 100);
  assert.equal(percentile([42], 95), 42);
  assert.equal(percentile([], 50), null);
});

test("samples round-trip and summarize per cache temperature", () => {
  clearTelemetry();
  for (let i = 1; i <= 10; i++) {
    recordOptimizerSample({
      cache: "cold",
      resolveMs: i * 100,
      searchMs: i * 10,
      poolSize: 20 + i,
      builds: 50 + i,
    });
  }
  recordOptimizerSample({
    cache: "warm",
    resolveMs: 30,
    searchMs: 5,
    poolSize: 25,
    builds: 60,
  });
  recordOptimizerSample({
    cache: "result",
    resolveMs: 0,
    searchMs: 0,
    poolSize: 25,
    builds: 60,
  });

  assert.equal(loadTelemetrySamples().length, 12);
  const summary = getTelemetrySummary();
  assert.equal(summary.total, 12);
  assert.equal(summary.byCache.cold.n, 10);
  assert.equal(summary.byCache.cold.resolveMs.p50, 500);
  assert.equal(summary.byCache.cold.resolveMs.p90, 900);
  assert.equal(summary.byCache.cold.resolveMs.p95, 1000);
  assert.equal(summary.byCache.cold.searchMs.p95, 100);
  assert.deepEqual(summary.byCache.cold.poolSize, { min: 21, max: 30 });
  assert.deepEqual(summary.byCache.cold.builds, { min: 51, max: 60 });
  assert.equal(summary.byCache.warm.n, 1);
  assert.equal(summary.byCache.result.n, 1);
});

test("history is bounded and clear() resets", () => {
  clearTelemetry();
  for (let i = 0; i < 520; i++) {
    recordOptimizerSample({ cache: "cold", resolveMs: i, searchMs: i, poolSize: 1, builds: 1 });
  }
  assert.equal(loadTelemetrySamples().length, 500);
  // The oldest samples fell off the front, the newest survived.
  const kept = loadTelemetrySamples();
  assert.equal(kept[kept.length - 1].resolveMs, 519);
  assert.equal(kept[0].resolveMs, 20);
  clearTelemetry();
  assert.equal(loadTelemetrySamples().length, 0);
  assert.equal(getTelemetrySummary().total, 0);
});
