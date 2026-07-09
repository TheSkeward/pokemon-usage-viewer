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

test("below-arrival pre-evo levels: candy-down at 2+, relearner-only at 1 (Uproar report)", async () => {
  // Slaking's Uproar is Vigoroth@1/@9 — Vigoroth only EXISTS from 18, but
  // Reborn's Common Candy makes @9 reachable (user-verified: candy the
  // Vigoroth below 9, level back up). The @1 entry stays out of reach by
  // leveling — you never level UP to 1.
  const { loadRebornLegalMoveData, getAvailableRebornMoves } = await import(
    "../../src/reborn/legalMoves.js"
  );
  const data = await loadRebornLegalMoveData("slaking");

  const atForty = getAvailableRebornMoves(data, { levelCap: "40" });
  const uproar = atForty.find((move) => move.id === "uproar");
  assert.equal(
    uproar?.availableSources?.[0]?.label,
    "Level 9 (Vigoroth, candy down)",
  );
  assert.ok(!uproar?.delayedEvolution, "candy-down is not a delayed build");

  // Below Vigoroth's arrival (cap 15 < 18) there is no Vigoroth to candy.
  const atFifteen = getAvailableRebornMoves(data, { levelCap: "15" });
  assert.ok(
    !atFifteen.some((move) => move.id === "uproar"),
    "no Vigoroth reachable at cap 15 ⇒ no Uproar",
  );
});

test("candy-down donor at @9 beats a level-up donor at @27 (Manectric's Uproar)", async () => {
  // User ruling: "Available from Vigoroth@9. That's faster than Exploud@27."
  const { pokemonIndex } = await loadShared();
  const context = await buildRebornBreedingContext({
    pokemonIndex,
    progression: {
      levelCap: "60",
      daycareUnlocked: true,
    },
    query: ["Slaking", "Exploud", "Manectric"].join("\n"),
  });

  const uproar = context.byPokemonId.manectric?.sources?.uproar;
  assert.ok(uproar, "Manectric must get Uproar from the chain");
  // Credited to the form that ACTUALLY learns it — Vigoroth, not the
  // fielded Slaking (user report: "Slaking doesn't come to it at all").
  assert.equal(uproar.donorName, "Vigoroth");
  assert.match(uproar.detail, /^Vigoroth breeding chain \(@9\)$/);
  assert.ok(!/@1\b/.test(uproar.detail), "the phantom @1 must be gone");
});

test("level-1 pre-evolution carryover credits the pre-evolution learner", async () => {
  // User report: Lopunny's Fake Out was displayed as "Delcatty breeding
  // chain (@1)" because Skitty's level-1 carryover collapsed to the fielded
  // Delcatty. The easiest root learner is Skitty.
  const { pokemonIndex } = await loadShared();
  const context = await buildRebornBreedingContext({
    pokemonIndex,
    progression: { levelCap: "60", daycareUnlocked: true },
    query: ["Skitty", "Buneary"].join("\n"),
  });

  const fakeOut = context.byPokemonId.lopunny?.sources?.fakeout;
  assert.ok(fakeOut, "Lopunny must get Fake Out from the pool chain");
  assert.equal(fakeOut.donorName, "Skitty");
  assert.equal(fakeOut.detail, "Skitty breeding chain (@1)");
  assert.match(fakeOut.sourceTitle, /Root source: Skitty learns Fake Out at level 1\./);
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

test("egg-group compatibility resolves over the FAMILY, not the fielded form", async () => {
  // Mantyke's own egg groups are ["Undiscovered"] — you daycare Mantine
  // (Water 1) and hatch the Mantyke. A fielded baby form could never receive
  // an egg move before the family resolution (audit finding: same for every
  // baby and Nidorina/Nidoqueen).
  const { pokemonIndex } = await loadShared();
  const context = await buildRebornBreedingContext({
    pokemonIndex,
    progression: { levelCap: "50", daycareUnlocked: true },
    query: ["Mantyke", "Dratini"].join("\n"),
  });

  const mantyke = context.byPokemonId.mantyke;
  assert.ok(
    (mantyke?.moveIds || []).length > 0,
    "Mantyke must receive egg moves through Mantine's Water 1",
  );
  assert.ok(mantyke.moveIds.includes("twister"), "Dratini passes Twister");
});

test("breeding provenance is independent of pool text order", async () => {
  // Two donors can tie on (hops, level, path) while differing only in
  // provenance text — a fielded Vigoroth's "Level 9" vs a fielded Slaking's
  // "Level 9 (Vigoroth, candy down)" both cost @9 via Vigoroth. With a
  // partial order the winner was whichever came first in the pool TEXT,
  // which leaked input ordering into breedingContext and from there into
  // every stableStringify'd cache signature (a pool reorder recomputed the
  // whole pool cold) and flipped the Egg tooltip between orderings.
  const { pokemonIndex } = await loadShared();
  const progression = { levelCap: "30", daycareUnlocked: true };
  const orderA = await buildRebornBreedingContext({
    pokemonIndex,
    progression,
    query: ["Vigoroth", "Slaking", "Diglett"].join("\n"),
  });
  const orderB = await buildRebornBreedingContext({
    pokemonIndex,
    progression,
    query: ["Slaking", "Vigoroth", "Diglett"].join("\n"),
  });
  assert.deepEqual(
    orderA.byPokemonId,
    orderB.byPokemonId,
    "the breeding context must not depend on pool text order",
  );
});

test("a fielded evolution's own below-arrival entry never outprices the pre-evo route", async () => {
  // User report: Pineco's Pin Missile donor read "Drapion breeding chain
  // (@9)" — Drapion's OWN learnset lists 9, but Drapion arrives at 40, so
  // that route is evolve-then-candy-down; Skorupi@9 is just leveling. The
  // fielded form's own entries now obey the same arrival window as pre-evo
  // entries, and equal-level ties prefer less hassle (plain level-up over
  // candy-down/delayed).
  const { pokemonIndex } = await loadShared();
  const context = await buildRebornBreedingContext({
    pokemonIndex,
    progression: { levelCap: "40", daycareUnlocked: true },
    query: ["Pineco", "Skorupi"].join("\n"),
  });

  const pinMissile = context.byPokemonId.pineco?.sources?.pinmissile;
  assert.ok(pinMissile, "Pineco must get Pin Missile from the Skorupi line");
  assert.equal(pinMissile.donorName, "Skorupi");
  assert.equal(pinMissile.detail, "Skorupi breeding chain (@9)");
  assert.match(pinMissile.sourceTitle, /Skorupi learns Pin Missile at level 9\./);
});
