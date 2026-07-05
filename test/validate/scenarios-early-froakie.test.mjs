// One heavyweight fixture per file: node --test runs FILES concurrently, so
// serializing two ~150s scenarios in one file doubled the suite's wall time.
import test from "node:test";
import { runScenario } from "../helpers/fixtureRunner.mjs";

test("early-weak-froakie", async () => {
  await runScenario("early-weak-froakie");
});
