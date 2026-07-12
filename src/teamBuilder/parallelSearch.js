// Main-thread orchestration of the parallel team search: maintains a small pool
// of Web Workers, partitions the combination space into contiguous lexicographic
// ranges, dispatches a range to each worker, and merges the per-range winners
// with the same comparator the sequential search uses. Falls back to a synchronous
// in-process search on ANY problem (no Worker support, a worker error, a small
// job) — the search is a cache, never load-bearing, so a failure just costs time.

import { searchCombinationRange } from "./searchKernel.js";

// Below this many combinations the worker round-trip (spawn already amortized,
// but message + clone) isn't worth it — the sequential search is sub-second.
export const PARALLEL_THRESHOLD = 150_000;

let workerPool = null;
let workerPoolBroken = false;
let messageSeq = 0;
// Injected by non-browser hosts (the Node test harness) to supply a pool of
// Web-Worker-shaped objects backed by worker_threads, so the exact-search
// fixtures parallelize exactly like the browser does. Also lets the host set
// a timeout matched to its hardware (the 30s browser default assumes a fast
// machine; a CI box splitting a 2M-combo range can legitimately need longer).
let injectedPoolFactory = null;

export function setSearchWorkerPoolFactory(factory, { timeoutMs } = {}) {
  injectedPoolFactory = factory;
  workerPoolBroken = false;
  workerPool = null;
  if (timeoutMs) workerTimeoutMs = timeoutMs;
}
// Serialize parallel searches so they never contend for the same workers; optimize
// calls are normally serial anyway, this just makes overlap safe.
let chain = Promise.resolve();

function getWorkerPool() {
  if (workerPool || workerPoolBroken) return workerPool;
  if (injectedPoolFactory) {
    try {
      workerPool = injectedPoolFactory();
    } catch {
      workerPoolBroken = true;
      workerPool = null;
    }
    return workerPool;
  }
  if (typeof Worker === "undefined" || typeof navigator === "undefined") {
    workerPoolBroken = true;
    return null;
  }
  const cores = navigator.hardwareConcurrency || 4;
  const size = Math.max(1, Math.min(8, cores - 1));
  try {
    workerPool = Array.from(
      { length: size },
      () =>
        new Worker(new URL("./searchWorker.js", import.meta.url), {
          type: "module",
        }),
    );
  } catch {
    workerPoolBroken = true;
    workerPool = null;
  }
  return workerPool;
}

// Returns the top relaxed teams (compact id refs, best first) over the whole
// combination space, found in parallel when possible. `compactLines` is the
// trimmed, worker-cloneable line data; `total` is C(lines, targetSize);
// `topCount` is how many candidates the realization pass wants to re-rank.
export function parallelFullSearch(compactLines, targetSize, bias, total, topCount = 1, onProgress = null) {
  const run = () => dispatch(compactLines, targetSize, bias, total, topCount, onProgress);
  const result = chain.then(run, run);
  // Keep the chain alive regardless of this job's outcome.
  chain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

// Idle reclamation: the pool (up to 8 module workers, one V8 isolate each)
// used to live for the tab's lifetime after the first parallel search. Runs
// are bursty — one optimize, then minutes of reading — so terminate after a
// quiet minute and respawn on the next job (milliseconds; the spawn was
// already amortized per-run, not per-message). Distinct from retireWorkerPool:
// this does NOT set workerPoolBroken, so the pool comes back.
const WORKER_IDLE_MS = 60_000;
let idleTimer = null;

function scheduleIdleRelease() {
  // Injected pools (the Node test harness) manage their own lifecycle.
  if (injectedPoolFactory) return;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (!workerPool) return;
    for (const worker of workerPool) {
      try {
        worker.terminate();
      } catch {
        // ignore
      }
    }
    workerPool = null;
  }, WORKER_IDLE_MS);
}

async function dispatch(compactLines, targetSize, bias, total, topCount, onProgress = null) {
  // A job is starting: don't reap workers out from under it. Dispatches are
  // serialized on `chain`, so clearing here covers the whole job.
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  const pool = total >= PARALLEL_THRESHOLD ? getWorkerPool() : null;

  if (!pool || pool.length < 2) {
    // Synchronous fallback (small job, or no workers): identical code path.
    return searchCombinationRange(compactLines, targetSize, bias, 0, total, topCount, onProgress);
  }

  try {
    const k = pool.length;
    const chunk = Math.ceil(total / k);
    const jobs = [];
    // Per-worker scanned counts, summed into one throttled progress stream
    // for the caption ("Searching team combinations — 43%").
    const scannedByWorker = [];
    let lastReport = 0;
    const reportProgress = () => {
      if (!onProgress) return;
      const now = Date.now();
      if (now - lastReport < 100) return;
      lastReport = now;
      onProgress(
        scannedByWorker.reduce((sum, v) => sum + (v || 0), 0),
        total,
      );
    };
    for (let w = 0; w < k; w++) {
      const start = w * chunk;
      const end = Math.min(total, start + chunk);
      if (start >= end) break;
      const slot = scannedByWorker.length;
      scannedByWorker.push(0);
      jobs.push(
        runOnWorker(pool[w], compactLines, targetSize, bias, start, end, topCount, (scanned) => {
          scannedByWorker[slot] = scanned;
          reportProgress();
        }),
      );
    }
    const results = await Promise.all(jobs);
    return mergeResults(results, topCount);
  } catch {
    // Any worker failure (load error, crash, or hang) → retire the pool so we
    // don't pay the failure again, and recompute synchronously so a correct
    // result is always returned. A broken worker degrades to "no speedup", never
    // to a wrong answer or a frozen UI.
    retireWorkerPool();
    return searchCombinationRange(compactLines, targetSize, bias, 0, total, topCount);
  } finally {
    scheduleIdleRelease();
  }
}

// Backstop for a worker that loads but never answers (e.g. a bad production URL
// that silently fails): bounded well above any real search (3M-combo cap / cores
// is a few seconds) so it only ever fires on a genuine hang. Injected hosts may
// raise it to match slower hardware.
let workerTimeoutMs = 30_000;

function runOnWorker(worker, compactLines, targetSize, bias, start, end, topCount, onProgress = null) {
  const id = ++messageSeq;
  return new Promise((resolve, reject) => {
    let timer = setTimeout(() => {
      cleanup();
      reject(new Error("worker timeout"));
    }, workerTimeoutMs);
    const onMessage = (event) => {
      if (event.data?.id !== id) return;
      // Interim progress: liveness, not completion. Refresh the hang timeout
      // — a range that is visibly scanning must never be declared hung — and
      // feed the caption.
      if (event.data.progress != null && event.data.ok === undefined) {
        clearTimeout(timer);
        timer = setTimeout(() => {
          cleanup();
          reject(new Error("worker timeout"));
        }, workerTimeoutMs);
        onProgress?.(event.data.progress);
        return;
      }
      cleanup();
      if (event.data.ok) resolve(event.data.result);
      else reject(new Error(event.data.error || "worker error"));
    };
    const onError = (event) => {
      cleanup();
      reject(new Error(event?.message || "worker error"));
    };
    const cleanup = () => {
      clearTimeout(timer);
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
    };
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.postMessage({ id, compactLines, targetSize, bias, start, end, topCount });
  });
}

function retireWorkerPool() {
  workerPoolBroken = true;
  if (workerPool) {
    for (const worker of workerPool) {
      try {
        worker.terminate();
      } catch {
        // ignore
      }
    }
    workerPool = null;
  }
}

// Merges the per-range top lists with the SAME ordering as betterEvaluated for
// full teams: all are the target size (equal sizePriority), so it's score, then
// the deterministic identity tie-break. Returns { top: [...] } best-first.
function mergeResults(results, topCount) {
  const merged = [];
  for (const result of results) {
    if (!result?.top) continue;
    merged.push(...result.top);
  }
  if (!merged.length) return null;
  merged.sort(
    (a, b) =>
      b.score - a.score ||
      (a.identityKey < b.identityKey ? -1 : a.identityKey > b.identityKey ? 1 : 0),
  );
  return { top: merged.slice(0, Math.max(1, topCount)) };
}
