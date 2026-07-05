// User request: among multiple legal breeding donors, prefer the one that
// gets the move EARLIEST — not whichever happens to sit first in pool order.
// Real-data pin: Azumarill's Amnesia can come from Golduck (@41), Slowbro
// (@43), or Quagsire (@24). With Golduck listed first, the old first-match
// pick chose Golduck; the chain must choose Quagsire.
import test from "node:test";
import assert from "node:assert/strict";
import { loadShared } from "../helpers/harness.mjs";

const { buildRebornBreedingContext } = await import(
  "../../src/reborn/breeding.js"
);

test("breeding chains pick the earliest-acquisition donor", async () => {
  const { pokemonIndex } = await loadShared();
  const context = await buildRebornBreedingContext({
    pokemonIndex,
    progression: { levelCap: "60", daycareUnlocked: true },
    query: ["Golduck", "Slowbro", "Quagsire", "Lapras", "Azumarill"].join("\n"),
  });

  const azumarill = context.byPokemonId.azumarill;
  assert.ok(azumarill, "Azumarill must be in the breeding context");
  assert.ok(azumarill.moveIds.includes("amnesia"));

  const amnesia = azumarill.sources.amnesia;
  assert.equal(amnesia.donorName, "Quagsire");
  assert.match(amnesia.detail, /@24/);

  // Body Slam: Lapras @18 beats Poliwrath-class @21 and everything else here.
  const bodySlam = azumarill.sources.bodyslam;
  assert.equal(bodySlam?.donorName, "Lapras");
  assert.match(bodySlam.detail, /@18/);
});
