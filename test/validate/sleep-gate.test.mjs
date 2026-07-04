// User report: Dedenne (Sub/Nuzzle/Volt Switch) was recommended Snore. Snore
// only deals damage while its user sleeps, and the old gate asked "is Rest in
// the LEGAL POOL?" — Dedenne's pool has Rest, so Snore counted as a usable
// attack even in a set with no way to sleep. The gate now judges the SET
// being built: Snore is only recommendable once Rest is actually selected
// (e.g. a canonical Rest earlier in usage order re-enables a canonical Snore).
import test from "node:test";
import assert from "node:assert/strict";
// Side effect: installs the fetch/env/localStorage shims the app modules need.
import "../helpers/harness.mjs";

const { buildCandidateLegalityProfile } = await import(
  "../../src/reborn/teamAnalysis.js"
);

const level = (name, extra = {}) => ({
  id: name.toLowerCase().replace(/[^a-z0-9]/g, ""),
  name,
  basePower: 0,
  category: "Status",
  priority: 0,
  utility: true,
  accuracy: 100,
  availableSources: [{ kind: "level-up", label: "Level 1" }],
  ...extra,
});

const DEDENNE_MOVES = [
  level("Substitute", { type: "Normal" }),
  level("Nuzzle", {
    type: "Electric",
    category: "Physical",
    basePower: 20,
  }),
  level("Volt Switch", {
    type: "Electric",
    category: "Special",
    basePower: 70,
    utility: true,
  }),
  level("Rest", { type: "Psychic" }),
  level("Snore", {
    type: "Normal",
    category: "Special",
    basePower: 50,
  }),
  level("Tackle", {
    type: "Normal",
    category: "Physical",
    basePower: 40,
    utility: false,
  }),
];

const MEMBER = { id: "dedenne", name: "Dedenne", types: ["Electric", "Fairy"] };

test("Snore is never recommended into a set that cannot sleep (the Dedenne report)", () => {
  const profile = buildCandidateLegalityProfile({
    member: MEMBER,
    moves: DEDENNE_MOVES,
    levelCap: 35,
    // The real canonical set is Recycle/Sub/Thunderbolt/Nuzzle; the two legal
    // canonical moves here leave two slots for the fill loop — which used to
    // grab Snore as the "best Normal hit" off Rest merely being in the pool.
    moveUsage: new Map([
      ["substitute", 75],
      ["nuzzle", 65],
      ["voltswitch", 40],
    ]),
  });
  const ids = profile.recommendedMoves.map((move) => move.id);
  assert.ok(
    !ids.includes("snore"),
    `Snore recommended without a sleep source: ${ids.join(", ")}`,
  );
});

test("a canonical Rest ahead of Snore re-enables it (RestSnore sets stay real)", () => {
  const profile = buildCandidateLegalityProfile({
    member: MEMBER,
    moves: DEDENNE_MOVES,
    levelCap: 35,
    moveUsage: new Map([
      ["rest", 80],
      ["snore", 75],
      ["substitute", 60],
      ["nuzzle", 50],
    ]),
  });
  const ids = profile.recommendedMoves.map((move) => move.id);
  assert.ok(ids.includes("rest"), `expected Rest: ${ids.join(", ")}`);
  assert.ok(
    ids.includes("snore"),
    `canonical Snore behind Rest should be kept: ${ids.join(", ")}`,
  );
});
