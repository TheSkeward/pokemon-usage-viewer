// One heavyweight fixture per file: node --test runs FILES concurrently, so
// serializing two ~150s scenarios in one file doubled the suite's wall time.
import test from "node:test";
import { runScenario } from "../helpers/fixtureRunner.mjs";

test("late-broad-froakie", async () => {
  await runScenario("late-broad-froakie");
});
