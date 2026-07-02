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
// Serialize parallel searches so they never contend for the same workers; optimize
// calls are normally serial anyway, this just makes overlap safe.
let chain = Promise.resolve();

function getWorkerPool() {
  if (workerPool || workerPoolBroken) return workerPool;
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
export function parallelFullSearch(compactLines, targetSize, bias, total, topCount = 1) {
  const run = () => dispatch(compactLines, targetSize, bias, total, topCount);
  const result = chain.then(run, run);
  // Keep the chain alive regardless of this job's outcome.
  chain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function dispatch(compactLines, targetSize, bias, total, topCount) {
  const pool = total >= PARALLEL_THRESHOLD ? getWorkerPool() : null;

  if (!pool || pool.length < 2) {
    // Synchronous fallback (small job, or no workers): identical code path.
    return searchCombinationRange(compactLines, targetSize, bias, 0, total, topCount);
  }

  try {
    const k = pool.length;
    const chunk = Math.ceil(total / k);
    const jobs = [];
    for (let w = 0; w < k; w++) {
      const start = w * chunk;
      const end = Math.min(total, start + chunk);
      if (start >= end) break;
      jobs.push(
        runOnWorker(pool[w], compactLines, targetSize, bias, start, end, topCount),
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
  }
}

// Backstop for a worker that loads but never answers (e.g. a bad production URL
// that silently fails): bounded well above any real search (3M-combo cap / cores
// is a few seconds) so it only ever fires on a genuine hang.
const WORKER_TIMEOUT_MS = 30_000;

function runOnWorker(worker, compactLines, targetSize, bias, start, end, topCount) {
  const id = ++messageSeq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("worker timeout"));
    }, WORKER_TIMEOUT_MS);
    const onMessage = (event) => {
      if (event.data?.id !== id) return;
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
