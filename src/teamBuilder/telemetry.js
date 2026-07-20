/**
 * @fileoverview Browser performance telemetry for the optimizer:
 * every interactive optimizer run records a sample — resolve/search
 * wall-clock, pool size, surviving candidate-build count, browser core
 * count, and cache temperature — into localStorage, and the provenance
 * footer reports p50/p90/p95 grouped by cache temperature AND pool-size
 * bucket (a cold run on a 7-mon pool and one on a 45-mon pool are different
 * distributions; mixing them — or a 2ms result-cache hit — would make every
 * percentile meaningless). There is no analytics backend — this is a static
 * site — so "telemetry" means: measured in the user's real browser, on their
 * real pools and core count, inspectable in the UI, copyable as a redacted
 * report for bug filings, and exportable raw via `__TEAM_TELEMETRY__` in the
 * console.
 *
 * Every sample is stamped with an environment signature (telemetry schema |
 * app build id | scoring version | data signature) and the summary only
 * reads samples matching the newest sample's environment: after a deploy
 * changes any of those, the old implementation's latencies stop contributing
 * — no percentiles that average a slow old optimizer with a fast new one.
 * Stale samples age out of the bounded history naturally.
 *
 * Confidence-sweep runs (active scoring overrides) and background callers
 * that opt out (investment future-cap re-runs) are NOT recorded: the
 * distribution should describe interactive latency.
 *
 * `cancelled` is recorded (always false today) so that when optimize
 * cancellation lands, aborted runs stay visible in the latency story instead
 * of silently vanishing — a cancelling caller must record the phase it
 * stopped in ("resolve"/"search") and the elapsed ms up to the abort.
 */
import { SCORING_VERSION } from './scoring-constants.js';

const STORE_KEY = 'teamOptimizerTelemetryV1';
const MAX_SAMPLES = 500;
/**
 * Schema 3: samples cover the FULL user-perceived pipeline, not just the
 * optimizer core. `phases` breaks the wait down (setup / resolve / search /
 * items / render / confidence / investment), `totalMs` is click →
 * team-and-movesets rendered, `fullMs` is click → post-analysis (stability +
 * investment) done. Schema 2 measured only resolve+search; the schema bump
 * retires those samples via the env signature.
 */
export const TELEMETRY_SCHEMA = 3;

/**
 * Cache temperature of a run:
 *   "result" — layer-3 hit, no resolution and no search;
 *   "warm"   — some line-cache hits and/or an incremental search;
 *   "cold"   — every line resolved and the search ran from scratch.
 */
export const CACHE_STATES = Object.freeze(['cold', 'warm', 'result']);

// The running bundle's build id (vite `define`); absent in dev/Node.
const BUILD_ID =
  typeof __BUILD_ID__ !== 'undefined' && __BUILD_ID__ ? __BUILD_ID__ : 'dev';

/**
 * @param {?string} dataSignature
 * @return {{schema: number, build: string, scoring: string, data: string}}
 */
export function telemetryEnv(dataSignature) {
  return {
    schema: TELEMETRY_SCHEMA,
    build: BUILD_ID,
    scoring: SCORING_VERSION,
    data: dataSignature || 'unversioned',
  };
}

function envKey(env) {
  return `${env.schema}|${env.build}|${env.scoring}|${env.data}`;
}

/**
 * Workload buckets: a p95 over cold runs from pool 7 and pool 45 is not one
 * distribution.
 * @param {number} poolSize
 * @return {string}
 */
export function poolBucket(poolSize) {
  if (poolSize <= 12) return '1–12';
  if (poolSize <= 24) return '13–24';
  if (poolSize <= 36) return '25–36';
  return '37+';
}

/**
 * Build-count bucket, scaled to the ≤4-builds-per-line cap at the
 * pool-bucket edges (pool 12 → ≤48 builds, pool 24 → ≤96).
 * @param {number} builds
 * @return {string}
 */
export function buildBucket(builds) {
  if (builds <= 48) return 'low';
  if (builds <= 96) return 'medium';
  return 'high';
}

function storage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

/**
 * @return {Array<Object>} Stored samples; empty when localStorage is
 *     unavailable or unparsable.
 */
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

const PHASE_KEYS = Object.freeze([
  'setup', // optimizer: input groups, cache hydration, breeding context, keys
  'resolve', // optimizer: per-line scoring/builds
  'search', // optimizer: team search + realization
  'items', // item context + usage loading for the chosen team
  'render', // full page render (team, movesets, analysis panel, bench)
  'confidence', // post-analysis: robustness sweep
  'investment', // post-analysis: level-cap projection
]);

function roundMs(value) {
  return Math.max(0, Math.round(value || 0));
}

/**
 * @return {Object} The stored sample, env-stamped and appended to the
 *     bounded history.
 */
export function recordOptimizerSample({
  cache,
  resolveMs,
  searchMs,
  poolSize,
  builds,
  dataSignature,
  phases = null,
  totalMs = null,
  movesetMs = null,
  fullMs = null,
  // Swap-polish audit (shortlist runs only, null on exact paths): repairs
  // applied and their total realized-score gain. The repair rate over time is
  // the shortlist-quality metric the audit exists to measure.
  polishSwaps = null,
  polishGain = null,
  cancelled = false,
  cancelledPhase = null,
}) {
  const sample = {
    t: Date.now(),
    env: envKey(telemetryEnv(dataSignature)),
    cache: CACHE_STATES.includes(cache) ? cache : 'cold',
    resolveMs: roundMs(resolveMs),
    searchMs: roundMs(searchMs),
    poolSize: poolSize || 0,
    builds: builds || 0,
    cores:
      (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) ||
      null,
    ...(phases
      ? {
        phases: Object.fromEntries(
          PHASE_KEYS.filter((key) => phases[key] != null).map((key) => [
            key,
            roundMs(phases[key]),
          ]),
        ),
      }
      : {}),
    ...(totalMs != null ? { totalMs: roundMs(totalMs) } : {}),
    // Click → movesets (Team Analysis panel) on screen: the wait users
    // actually stopwatch, distinct from totalMs (team rows rendered).
    ...(movesetMs != null ? { movesetMs: roundMs(movesetMs) } : {}),
    ...(fullMs != null ? { fullMs: roundMs(fullMs) } : {}),
    ...(polishSwaps != null
      ? { polishSwaps, polishGain: Math.round(polishGain || 0) }
      : {}),
    cancelled: Boolean(cancelled),
    ...(cancelled ? { cancelledPhase } : {}),
  };
  const samples = loadTelemetrySamples();
  samples.push(sample);
  saveTelemetrySamples(samples);
  return sample;
}

/**
 * Nearest-rank percentile of an ASCENDING numeric array.
 * @param {Array<number>} sorted
 * @param {number} q Percentile in [0, 100].
 * @return {?number} Null for an empty array.
 */
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

/**
 * Summary over the CURRENT environment's history (the newest sample's env —
 * by definition the running deployment): one segment per (cache temperature
 * × pool-size bucket), each with resolve/search percentiles and the
 * build-count range it was measured over. Samples from older
 * builds/scoring/data are counted as `stale` and excluded.
 * @param {Array<Object>} samples
 * @return {Object}
 */
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
    for (const bucket of ['1–12', '13–24', '25–36', '37+']) {
      const group = inState.filter(
        (sample) => poolBucket(sample.poolSize) === bucket,
      );
      if (!group.length) continue;
      const withTotals = group.filter((sample) => sample.totalMs != null);
      segments.push({
        cache: state,
        poolBucket: bucket,
        n: group.length,
        resolveMs: distribution(group.map((sample) => sample.resolveMs)),
        searchMs: distribution(group.map((sample) => sample.searchMs)),
        // Click → team-and-movesets rendered (the wait the user feels), and
        // per-phase medians so a report attributes it without raw samples.
        ...(withTotals.length
          ? {
            totalMs: distribution(withTotals.map((sample) => sample.totalMs)),
            ...(withTotals.some((sample) => sample.movesetMs != null)
              ? {
                movesetMs: distribution(
                  withTotals
                    .filter((sample) => sample.movesetMs != null)
                    .map((sample) => sample.movesetMs),
                ),
              }
              : {}),
            phaseP50: Object.fromEntries(
              PHASE_KEYS.map((key) => [
                key,
                percentile(
                  withTotals
                    .map((sample) => sample.phases?.[key])
                    .filter((value) => value != null)
                    .sort((a, b) => a - b),
                  50,
                ),
              ]).filter(([, value]) => value != null),
            ),
          }
          : {}),
        builds: range(group.map((sample) => sample.builds)),
        buildBucket: buildBucket(
          Math.round(
            group.reduce((sum, sample) => sum + sample.builds, 0) /
              group.length,
          ),
        ),
        // Shortlist-quality aggregate: of the runs that ran the swap audit,
        // how many needed repairs, how many swaps total, and the largest
        // single-run gain. audited=0 means every run in this segment was
        // exact (nothing to audit). A persistent repair rate is the signal
        // the shortlist heuristics need work.
        ...(() => {
          const audited = group.filter(
            (sample) => sample.polishSwaps != null,
          );
          if (!audited.length) return {};
          const repaired = audited.filter(
            (sample) => sample.polishSwaps > 0,
          );
          return {
            polish: {
              audited: audited.length,
              repairedRuns: repaired.length,
              totalSwaps: repaired.reduce(
                (sum, sample) => sum + sample.polishSwaps,
                0,
              ),
              maxGain: repaired.length
                ? Math.max(...repaired.map((sample) => sample.polishGain || 0))
                : 0,
            },
          };
        })(),
      });
    }
  }
  return {
    env: currentEnv,
    total: current.length,
    stale: samples.length - current.length - cancelled.length,
    cancelled: cancelled.length,
    cores:
      (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) ||
      null,
    segments,
  };
}

/**
 * Redacted performance report for bug filings (the footer's copy button):
 * the summary, the last run, and the environment that produced them. No pool
 * content, no team, no query text, nothing user-identifying beyond core
 * count.
 * @return {Object}
 */
export function buildPerformanceReport() {
  const samples = loadTelemetrySamples();
  const summary = getTelemetrySummary(samples);
  const last = samples[samples.length - 1] || null;
  return {
    report: 'team-optimizer-performance',
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
        ...(last.phases ? { phases: last.phases } : {}),
        ...(last.totalMs != null ? { totalMs: last.totalMs } : {}),
        ...(last.movesetMs != null ? { movesetMs: last.movesetMs } : {}),
        ...(last.fullMs != null ? { fullMs: last.fullMs } : {}),
        ...(last.polishSwaps != null
          ? { polishSwaps: last.polishSwaps, polishGain: last.polishGain }
          : {}),
        poolSize: last.poolSize,
        builds: last.builds,
        cancelled: last.cancelled || false,
      }
      : null,
  };
}

// Per-phase time budget for a run on THIS machine at this pool size, from the
// current environment's history (medians of cold/warm samples in the same
// pool bucket, else any bucket), falling back to rough static defaults for a
// first run. Feeds the adaptive progress bar — display only, never scoring.
const FALLBACK_BUDGETS = {
  '1–12': { resolveMs: 600, searchMs: 300 },
  '13–24': { resolveMs: 1200, searchMs: 900 },
  '25–36': { resolveMs: 2000, searchMs: 1600 },
  '37+': { resolveMs: 2600, searchMs: 3200 },
};

/**
 * @param {number} poolSize
 * @return {{resolveMs: number, searchMs: number, tailMs: number}}
 *     Milliseconds per phase.
 */
export function estimateRunBudget(poolSize) {
  const bucket = poolBucket(poolSize || 0);
  const samples = loadTelemetrySamples();
  const env = samples.length ? samples[samples.length - 1].env : null;
  // Result-cache hits are ~0ms and would drag every median to nothing.
  const usable = samples.filter(
    (sample) =>
      sample.env === env &&
      !sample.cancelled &&
      sample.phases &&
      sample.cache !== 'result',
  );
  const inBucket = usable.filter(
    (sample) => poolBucket(sample.poolSize) === bucket,
  );
  const source = inBucket.length ? inBucket : usable;
  if (source.length) {
    const median = (key) =>
      percentile(
        source
          .map((sample) => sample.phases[key] ?? 0)
          .sort((a, b) => a - b),
        50,
      ) || 0;
    return {
      resolveMs: Math.max(200, median('resolve')),
      searchMs: Math.max(200, median('search')),
      tailMs: Math.max(150, median('items') + median('render')),
    };
  }
  const fallback = FALLBACK_BUDGETS[bucket];
  return {
    resolveMs: fallback.resolveMs,
    searchMs: fallback.searchMs,
    tailMs: 300,
  };
}

/** Removes the sample store from localStorage; failures are ignored. */
export function clearTelemetry() {
  try {
    storage()?.removeItem(STORE_KEY);
  } catch {
    // ignore
  }
}

// Console escape hatch: __TEAM_TELEMETRY__.summary() / .samples() / .report()
// / .clear() so raw numbers can be pulled out of a real browser session.
if (typeof globalThis !== 'undefined') {
  globalThis.__TEAM_TELEMETRY__ = {
    summary: getTelemetrySummary,
    samples: loadTelemetrySamples,
    report: buildPerformanceReport,
    clear: clearTelemetry,
  };
}
