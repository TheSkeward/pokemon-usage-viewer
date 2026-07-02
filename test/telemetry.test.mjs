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
  buildPerformanceReport,
  clearTelemetry,
  percentile,
  poolBucket,
  buildBucket,
} = await import("../src/teamBuilder/telemetry.js");

test("percentile is nearest-rank", () => {
  const sorted = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  assert.equal(percentile(sorted, 50), 50);
  assert.equal(percentile(sorted, 90), 90);
  assert.equal(percentile(sorted, 95), 100);
  assert.equal(percentile([42], 95), 42);
  assert.equal(percentile([], 50), null);
});

test("workload buckets", () => {
  assert.equal(poolBucket(7), "1–12");
  assert.equal(poolBucket(12), "1–12");
  assert.equal(poolBucket(13), "13–24");
  assert.equal(poolBucket(30), "25–36");
  assert.equal(poolBucket(45), "37+");
  assert.equal(buildBucket(30), "low");
  assert.equal(buildBucket(60), "medium");
  assert.equal(buildBucket(140), "high");
});

test("summary segments by cache temperature and pool bucket", () => {
  clearTelemetry();
  for (let i = 1; i <= 10; i++) {
    recordOptimizerSample({
      cache: "cold",
      resolveMs: i * 100,
      searchMs: i * 10,
      poolSize: 7,
      builds: 20 + i,
      dataSignature: "sig-a",
    });
  }
  // Same temperature, different workload: must be its own segment.
  recordOptimizerSample({
    cache: "cold",
    resolveMs: 30_000,
    searchMs: 9_000,
    poolSize: 45,
    builds: 150,
    dataSignature: "sig-a",
  });
  recordOptimizerSample({
    cache: "result",
    resolveMs: 0,
    searchMs: 0,
    poolSize: 7,
    builds: 25,
    dataSignature: "sig-a",
  });

  const summary = getTelemetrySummary();
  assert.equal(summary.total, 12);
  assert.equal(summary.stale, 0);
  assert.equal(summary.segments.length, 3);

  const smallCold = summary.segments.find(
    (s) => s.cache === "cold" && s.poolBucket === "1–12",
  );
  assert.equal(smallCold.n, 10);
  assert.equal(smallCold.resolveMs.p50, 500);
  assert.equal(smallCold.resolveMs.p90, 900);
  assert.equal(smallCold.resolveMs.p95, 1000);
  assert.deepEqual(smallCold.builds, { min: 21, max: 30 });
  assert.equal(smallCold.buildBucket, "low");

  // The 45-mon cold run does not contaminate the 7-mon percentiles.
  const bigCold = summary.segments.find(
    (s) => s.cache === "cold" && s.poolBucket === "37+",
  );
  assert.equal(bigCold.n, 1);
  assert.equal(bigCold.resolveMs.p95, 30_000);
  assert.equal(bigCold.buildBucket, "high");
});

test("a deploy (env change) retires older samples from the summary", () => {
  clearTelemetry();
  for (let i = 0; i < 5; i++) {
    recordOptimizerSample({
      cache: "cold",
      resolveMs: 9_000,
      searchMs: 900,
      poolSize: 7,
      builds: 20,
      dataSignature: "old-data",
    });
  }
  // "Deploy": the data signature changes; new runs are fast.
  recordOptimizerSample({
    cache: "cold",
    resolveMs: 100,
    searchMs: 10,
    poolSize: 7,
    builds: 20,
    dataSignature: "new-data",
  });

  const summary = getTelemetrySummary();
  assert.equal(summary.total, 1, "only current-env runs summarize");
  assert.equal(summary.stale, 5, "old-implementation runs counted as stale");
  const segment = summary.segments.find((s) => s.cache === "cold");
  assert.equal(
    segment.resolveMs.p95,
    100,
    "old 9s runs must not curse the new build's percentiles",
  );
});

test("cancelled runs are stored, counted, and kept out of percentiles", () => {
  clearTelemetry();
  recordOptimizerSample({
    cache: "cold",
    resolveMs: 200,
    searchMs: 20,
    poolSize: 7,
    builds: 20,
    dataSignature: "sig",
  });
  recordOptimizerSample({
    cache: "cold",
    resolveMs: 5_000,
    searchMs: 0,
    poolSize: 7,
    builds: 20,
    dataSignature: "sig",
    cancelled: true,
    cancelledPhase: "resolve",
  });
  const summary = getTelemetrySummary();
  assert.equal(summary.total, 1);
  assert.equal(summary.cancelled, 1);
  assert.equal(summary.segments[0].resolveMs.p95, 200);
  const stored = loadTelemetrySamples().find((sample) => sample.cancelled);
  assert.equal(stored.cancelledPhase, "resolve");
});

test("performance report is redacted and self-describing", () => {
  clearTelemetry();
  recordOptimizerSample({
    cache: "warm",
    resolveMs: 300,
    searchMs: 40,
    poolSize: 20,
    builds: 55,
    dataSignature: "sig",
  });
  const report = buildPerformanceReport();
  assert.equal(report.report, "team-optimizer-performance");
  assert.ok(report.env.includes("sig"));
  assert.equal(report.summary.runs, 1);
  assert.equal(report.lastRun.cache, "warm");
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

test("history is bounded and clear() resets", () => {
  clearTelemetry();
  for (let i = 0; i < 520; i++) {
    recordOptimizerSample({
      cache: "cold",
      resolveMs: i,
      searchMs: i,
      poolSize: 1,
      builds: 1,
      dataSignature: "sig",
    });
  }
  assert.equal(loadTelemetrySamples().length, 500);
  const kept = loadTelemetrySamples();
  assert.equal(kept[kept.length - 1].resolveMs, 519);
  assert.equal(kept[0].resolveMs, 20);
  clearTelemetry();
  assert.equal(loadTelemetrySamples().length, 0);
  assert.equal(getTelemetrySummary().total, 0);
});
