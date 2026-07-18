// Node worker_threads twin of src/teamBuilder/searchWorker.js, spawned by
// the test harness so exact searches use every core, exactly like the
// browser's Web Worker pool.
import { parentPort } from "node:worker_threads";
import "./harness.mjs";
import { searchCombinationRange } from "../../src/teamBuilder/searchKernel.js";

parentPort.on("message", (message) => {
  const { id, compactLines, targetSize, bias, start, end, topCount } = message || {};
  try {
    const result = searchCombinationRange(
      compactLines,
      targetSize,
      bias,
      start,
      end,
      topCount,
    );
    parentPort.postMessage({ id, ok: true, result });
  } catch (error) {
    parentPort.postMessage({
      id,
      ok: false,
      error: String(error?.message || error),
    });
  }
});
