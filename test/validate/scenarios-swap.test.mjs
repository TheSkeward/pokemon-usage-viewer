import test from "node:test";
import { runScenario } from "../helpers/fixtureRunner.mjs";

test("happiny-swap", async () => {
  await runScenario("happiny-swap");
});
