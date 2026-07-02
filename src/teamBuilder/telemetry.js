// Browser performance telemetry for the optimizer (external review ask):
// every interactive optimizer run records a sample — resolve/search wall-clock,
// pool size, surviving candidate-build count, browser core count, and cache
// temperature — into localStorage, and the provenance footer reports
// p50/p90/p95 over the accumulated history, grouped by cache temperature
// (mixing a 2ms result-cache hit into a cold-run distribution would make every
// percentile meaningless). There is no analytics backend — this is a static
// site — so "telemetry" means: measured in the user's real browser, on their
// real pools and core count, inspectable in the UI and exportable as JSON via
// `__TEAM_TELEMETRY__` in the console.
//
// Confidence-sweep and test runs (active scoring overrides) are NOT recorded:
// the distribution should describe interactive latency, not the 21-setting
// sweep's deliberately-shortlisted re-runs.

const STORE_KEY = "teamOptimizerTelemetryV1";
const MAX_SAMPLES = 500;

// Cache temperature of a run:
//   "result" — layer-3 hit, no resolution and no search;
//   "warm"   — some line-cache hits and/or an incremental search;
//   "cold"   — every line resolved and the search ran from scratch.
export const CACHE_STATES = Object.freeze(["cold", "warm", "result"]);

function storage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

export function loadTelemetrySamples() {
  try {
    const raw = storage()?.getItem(STORE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed?.samples) ? parsed.samples : [];
  } catch {
    return [];
  }
}

function saveTelemetrySamples(samples) {
  try {
    storage()?.setItem(
      STORE_KEY,
      JSON.stringify({ samples: samples.slice(-MAX_SAMPLES) }),
    );
  } catch {
    // Quota/privacy-mode failures degrade to "no telemetry", never to a crash.
  }
}

export function recordOptimizerSample({
  cache,
  resolveMs,
  searchMs,
  poolSize,
  builds,
}) {
  const sample = {
    t: Date.now(),
    cache: CACHE_STATES.includes(cache) ? cache : "cold",
    resolveMs: Math.max(0, Math.round(resolveMs || 0)),
    searchMs: Math.max(0, Math.round(searchMs || 0)),
    poolSize: poolSize || 0,
    builds: builds || 0,
    cores:
      (typeof navigator !== "undefined" && navigator.hardwareConcurrency) ||
      null,
  };
  const samples = loadTelemetrySamples();
  samples.push(sample);
  saveTelemetrySamples(samples);
  return sample;
}

// Nearest-rank percentile of an ASCENDING numeric array.
export function percentile(sorted, q) {
  if (!sorted.length) return null;
  const rank = Math.ceil((q / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

function distribution(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
  };
}

// Summary over the accumulated history: per cache temperature, sample count,
// resolve/search percentiles, and the pool-size / build-count range they were
// measured on (a p95 without its pool size would say nothing).
export function getTelemetrySummary(samples = loadTelemetrySamples()) {
  const byCache = {};
  for (const state of CACHE_STATES) {
    const group = samples.filter((sample) => sample.cache === state);
    if (!group.length) continue;
    byCache[state] = {
      n: group.length,
      resolveMs: distribution(group.map((sample) => sample.resolveMs)),
      searchMs: distribution(group.map((sample) => sample.searchMs)),
      poolSize: {
        min: Math.min(...group.map((sample) => sample.poolSize)),
        max: Math.max(...group.map((sample) => sample.poolSize)),
      },
      builds: {
        min: Math.min(...group.map((sample) => sample.builds)),
        max: Math.max(...group.map((sample) => sample.builds)),
      },
    };
  }
  return {
    total: samples.length,
    cores:
      (typeof navigator !== "undefined" && navigator.hardwareConcurrency) ||
      null,
    byCache,
  };
}

export function clearTelemetry() {
  try {
    storage()?.removeItem(STORE_KEY);
  } catch {
    // ignore
  }
}

// Console escape hatch: __TEAM_TELEMETRY__.summary() / .samples() / .clear()
// so raw numbers can be pulled out of a real browser session and shared.
if (typeof globalThis !== "undefined") {
  globalThis.__TEAM_TELEMETRY__ = {
    summary: getTelemetrySummary,
    samples: loadTelemetrySamples,
    clear: clearTelemetry,
  };
}
