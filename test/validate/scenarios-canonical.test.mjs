import test from "node:test";
import { runScenario } from "../helpers/fixtureRunner.mjs";

test("early-weak-froakie", async () => {
  await runScenario("early-weak-froakie");
});

test("late-broad-froakie", async () => {
  await runScenario("late-broad-froakie");
});
