// Web Worker entry: scores one slice of the team-combination space and posts back
// the best team it found. It imports ONLY the pure kernel (no caches, no DOM, no
// worker orchestration), so the worker bundle stays small and can't recurse.

import { searchCombinationRange } from "./searchKernel.js";

self.onmessage = (event) => {
  const { id, compactLines, targetSize, bias, start, end } = event.data;
  try {
    const result = searchCombinationRange(compactLines, targetSize, bias, start, end);
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({ id, ok: false, error: String(error?.message || error) });
  }
};
