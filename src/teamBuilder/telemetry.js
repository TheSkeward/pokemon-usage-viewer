// Browser performance telemetry for the optimizer (external review ask):
// every interactive optimizer run records a sample — resolve/search wall-clock,
// pool size, surviving candidate-build count, browser core count, and cache
// temperature — into localStorage, and the provenance footer reports
// p50/p90/p95 grouped by cache temperature AND pool-size bucket (a cold run on
// a 7-mon pool and one on a 45-mon pool are different distributions; mixing
// them — or a 2ms result-cache hit — would make every percentile meaningless).
// There is no analytics backend — this is a static site — so "telemetry"
// means: measured in the user's real browser, on their real pools and core
// count, inspectable in the UI, copyable as a redacted report for bug filings,
// and exportable raw via `__TEAM_TELEMETRY__` in the console.
//
// Every sample is stamped with an environment signature (telemetry schema |
// app build id | scoring version | data signature) and the summary only reads
// samples matching the newest sample's environment: after a deploy changes any
// of those, the old implementation's latencies stop contributing — no
// percentiles that average a slow old optimizer with a fast new one. Stale
// samples age out of the bounded history naturally.
//
// Confidence-sweep runs (active scoring overrides) and background callers that
// opt out (investment future-cap re-runs) are NOT recorded: the distribution
// should describe interactive latency.
//
// `cancelled` is recorded (always false today) so that when optimize
// cancellation lands, aborted runs stay visible in the latency story instead
// of silently vanishing — a cancelling caller must record the phase it stopped
// in ("resolve"/"search") and the elapsed ms up to the abort.
import { SCORING_VERSION } from "./scoringConstants.js";

const STORE_KEY = "teamOptimizerTelemetryV1";
const MAX_SAMPLES = 500;
export const TELEMETRY_SCHEMA = 2;

// Cache temperature of a run:
//   "result" — layer-3 hit, no resolution and no search;
//   "warm"   — some line-cache hits and/or an incremental search;
//   "cold"   — every line resolved and the search ran from scratch.
export const CACHE_STATES = Object.freeze(["cold", "warm", "result"]);

// The running bundle's build id (vite `define`); absent in dev/Node.
const BUILD_ID =
  typeof __BUILD_ID__ !== "undefined" && __BUILD_ID__ ? __BUILD_ID__ : "dev";

export function telemetryEnv(dataSignature) {
  return {
    schema: TELEMETRY_SCHEMA,
    build: BUILD_ID,
    scoring: SCORING_VERSION,
    data: dataSignature || "unversioned",
  };
}

function envKey(env) {
  return `${env.schema}|${env.build}|${env.scoring}|${env.data}`;
}

// Workload buckets (external review: "a p95 over cold runs from pool 7 and
// pool 45 is not one distribution").
export function poolBucket(poolSize) {
  if (poolSize <= 12) return "1–12";
  if (poolSize <= 24) return "13–24";
  if (poolSize <= 36) return "25–36";
  return "37+";
}

// Build-count bucket, scaled to the ≤4-builds-per-line cap at the pool-bucket
// edges (pool 12 → ≤48 builds, pool 24 → ≤96).
export function buildBucket(builds) {
  if (builds <= 48) return "low";
  if (builds <= 96) return "medium";
  return "high";
}

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
  dataSignature,
  cancelled = false,
  cancelledPhase = null,
}) {
  const sample = {
    t: Date.now(),
    env: envKey(telemetryEnv(dataSignature)),
    cache: CACHE_STATES.includes(cache) ? cache : "cold",
    resolveMs: Math.max(0, Math.round(resolveMs || 0)),
    searchMs: Math.max(0, Math.round(searchMs || 0)),
    poolSize: poolSize || 0,
    builds: builds || 0,
    cores:
      (typeof navigator !== "undefined" && navigator.hardwareConcurrency) ||
      null,
    cancelled: Boolean(cancelled),
    ...(cancelled ? { cancelledPhase } : {}),
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

function range(values) {
  return { min: Math.min(...values), max: Math.max(...values) };
}

// Summary over the CURRENT environment's history (the newest sample's env —
// by definition the running deployment): one segment per (cache temperature ×
// pool-size bucket), each with resolve/search percentiles and the build-count
// range it was measured over. Samples from older builds/scoring/data are
// counted as `stale` and excluded.
export function getTelemetrySummary(samples = loadTelemetrySamples()) {
  const currentEnv = samples.length ? samples[samples.length - 1].env : null;
  const current = samples.filter(
    (sample) => sample.env === currentEnv && !sample.cancelled,
  );
  const cancelled = samples.filter(
    (sample) => sample.env === currentEnv && sample.cancelled,
  );

  const segments = [];
  for (const state of CACHE_STATES) {
    const inState = current.filter((sample) => sample.cache === state);
    for (const bucket of ["1–12", "13–24", "25–36", "37+"]) {
      const group = inState.filter(
        (sample) => poolBucket(sample.poolSize) === bucket,
      );
      if (!group.length) continue;
      segments.push({
        cache: state,
        poolBucket: bucket,
        n: group.length,
        resolveMs: distribution(group.map((sample) => sample.resolveMs)),
        searchMs: distribution(group.map((sample) => sample.searchMs)),
        builds: range(group.map((sample) => sample.builds)),
        buildBucket: buildBucket(
          Math.round(
            group.reduce((sum, sample) => sum + sample.builds, 0) /
              group.length,
          ),
        ),
      });
    }
  }
  return {
    env: currentEnv,
    total: current.length,
    stale: samples.length - current.length - cancelled.length,
    cancelled: cancelled.length,
    cores:
      (typeof navigator !== "undefined" && navigator.hardwareConcurrency) ||
      null,
    segments,
  };
}

// Redacted performance report for bug filings (the footer's copy button): the
// summary, the last run, and the environment that produced them. No pool
// content, no team, no query text, nothing user-identifying beyond core count.
export function buildPerformanceReport() {
  const samples = loadTelemetrySamples();
  const summary = getTelemetrySummary(samples);
  const last = samples[samples.length - 1] || null;
  return {
    report: "team-optimizer-performance",
    schema: TELEMETRY_SCHEMA,
    generatedAt: new Date().toISOString(),
    env: summary.env,
    cores: summary.cores,
    summary: {
      runs: summary.total,
      staleRunsExcluded: summary.stale,
      cancelledRuns: summary.cancelled,
      segments: summary.segments,
    },
    lastRun: last
      ? {
          cache: last.cache,
          resolveMs: last.resolveMs,
          searchMs: last.searchMs,
          poolSize: last.poolSize,
          builds: last.builds,
          cancelled: last.cancelled || false,
        }
      : null,
  };
}

export function clearTelemetry() {
  try {
    storage()?.removeItem(STORE_KEY);
  } catch {
    // ignore
  }
}

// Console escape hatch: __TEAM_TELEMETRY__.summary() / .samples() / .report()
// / .clear() so raw numbers can be pulled out of a real browser session.
if (typeof globalThis !== "undefined") {
  globalThis.__TEAM_TELEMETRY__ = {
    summary: getTelemetrySummary,
    samples: loadTelemetrySamples,
    report: buildPerformanceReport,
    clear: clearTelemetry,
  };
}
