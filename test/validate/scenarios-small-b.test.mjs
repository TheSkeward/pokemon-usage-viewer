import test from "node:test";
import { runScenario } from "../helpers/fixtureRunner.mjs";

test("high-utility-low-offense", async () => {
  await runScenario("high-utility-low-offense");
});

test("high-ceiling-babies", async () => {
  await runScenario("high-ceiling-babies");
});

test("item-friendship-evos", async () => {
  await runScenario("item-friendship-evos");
});

test("midgame-broad", async () => {
  await runScenario("midgame-broad");
});
