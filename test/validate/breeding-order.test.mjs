// User rules for donor choice among multiple legal chains:
//   1. the SHORTEST chain wins (fewest breeding hops) — a 2-step chain must
//      never beat a direct donor;
//   2. earliest acquisition (lowest level) is only the tiebreak;
//   3. every chain names how the root learner gets the move ("@24",
//      "evo@32", "TM42") and multi-hop chains spell all steps.
// Real-data pins below; Azumarill's Amnesia (Quagsire@24 over Golduck@41 /
// Slowbro@43) also guards against the original first-in-pool-order pick.
import test from "node:test";
import assert from "node:assert/strict";
import { loadShared } from "../helpers/harness.mjs";

const { buildRebornBreedingContext, compareBreedingCosts } = await import(
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

test("shortest chain is primary: a direct donor beats any multi-hop chain", async () => {
  // User report: Zebstrika's Double-Edge jumped to a 2-step Granbull chain
  // (Granbull's own Double-Edge is egg-only) because level was primary.
  // Direct donors exist — Linoone @35 is the best of them.
  const { pokemonIndex } = await loadShared();
  const context = await buildRebornBreedingContext({
    pokemonIndex,
    progression: { levelCap: "60", daycareUnlocked: true },
    query: ["Granbull", "Azumarill", "Gogoat", "Dunsparce", "Linoone", "Zebstrika"].join("\n"),
  });

  const doubleEdge = context.byPokemonId.zebstrika?.sources?.doubleedge;
  assert.ok(doubleEdge, "Zebstrika must get Double-Edge from the chain");
  assert.equal(doubleEdge.donorName, "Linoone");
  assert.match(doubleEdge.detail, /^Linoone breeding chain \(@35\)$/);

  // Pure ordering rule: 1 hop @35 beats 2 hops @1.
  assert.ok(
    compareBreedingCosts(
      { hops: 1, level: 35, path: ["Linoone"] },
      { hops: 2, level: 1, path: ["Azumarill", "Granbull"] },
    ) < 0,
  );
});

test("chains name how the root learner gets the move, including evolution moves", async () => {
  // User report: "Egg: Pangoro breeding chain" demonstrated nothing —
  // Pangoro's Bullet Punch is an evolution move, so the chain must say so.
  const { pokemonIndex } = await loadShared();
  const context = await buildRebornBreedingContext({
    pokemonIndex,
    progression: { levelCap: "60", daycareUnlocked: true },
    query: ["Pangoro", "Hariyama"].join("\n"),
  });

  const bulletPunch = context.byPokemonId.hariyama?.sources?.bulletpunch;
  assert.ok(bulletPunch, "Hariyama must get Bullet Punch from Pangoro");
  assert.equal(bulletPunch.detail, "Pangoro breeding chain (evo@32)");
});
