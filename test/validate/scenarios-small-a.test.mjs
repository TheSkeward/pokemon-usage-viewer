import test from "node:test";
import { runScenario } from "../helpers/fixtureRunner.mjs";

test("weak-shell", async () => {
  await runScenario("weak-shell");
});

test("unique-immunity", async () => {
  await runScenario("unique-immunity");
});

test("unique-fast-attacker", async () => {
  await runScenario("unique-fast-attacker");
});
