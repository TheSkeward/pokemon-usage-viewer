// Runs ALONE in its own process: the shortlist-required fixture asserts that a
// cold 45-line pool takes the shortlist path (searchExact false). Run after
// another same-progression fixture in one process, the optimizer's incremental
// cache can legitimately answer the grown pool EXACTLY (the cached 36-pool
// optimum was exact; only added-line teams need enumeration) — a feature, not a
// bug, but it makes the cold-path assertion order-dependent.
import test from "node:test";
import { runScenario } from "../helpers/fixtureRunner.mjs";

test("shortlist-required", async () => {
  await runScenario("shortlist-required");
});
