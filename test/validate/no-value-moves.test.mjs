// The Splash-Lopunny case, settled after two rounds with the user:
//   - Splash on ZU Lopunny is a REAL fringe set (Z-Splash = +3 Atk in Gen 7),
//     not a meme artifact — and in Gen 7 every status move has a Z-effect, so
//     "does nothing" cannot be decided from the dex. Usage is the arbiter:
//     a status move with real usage is recommendable, in the canonical top-4
//     AND as a usage-ranked utility pick.
//   - What actually keeps filler out: every utility-ranked path (utility
//     build, utility-slot guarantee, bonus fill) requires usage > 0 or a
//     curated utility weight — a move nobody runs is never recommended.
// The same investigation restored fixed-damage moves (Seismic Toss et al.,
// base power 0) as first-class attacks: they count as damage and contribute
// flat typeless coverage, but never claim an attack type, STAB, or a
// super-effective target.
import test from "node:test";
import assert from "node:assert/strict";
// Side effect: installs the fetch/env/localStorage shims the app modules need.
import "../helpers/harness.mjs";

const { getAvailableRebornMoves, loadRebornLegalMoveData } = await import(
  "../../src/reborn/legalMoves.js"
);
const { buildCandidateLegalityProfile } = await import(
  "../../src/reborn/teamAnalysis.js"
);
const { REBORN_ANALYSIS_TYPES } = await import(
  "../../src/reborn/typeChart.js"
);

// The reported scenario's shape: base Lopunny's stitched index (primary source
// Gen 7 ZU @ 1500) — Splash carries real usage but is NOT in the top-4.
const ZU_LIKE_USAGE = new Map([
  ["switcheroo", 53.3],
  ["return", 43.9],
  ["highjumpkick", 36.0],
  ["fakeout", 29.1],
  ["healingwish", 28.7],
  ["splash", 17.7],
  ["encore", 11.6],
]);

async function lopunnyMoves() {
  const data = await loadRebornLegalMoveData("lopunny");
  return getAvailableRebornMoves(data, {
    levelCap: "75",
    moveRelearnerUnlocked: true,
  });
}

test("usage-backed Splash IS a legitimate utility pick (Z-Splash is a real set)", async () => {
  const moves = await lopunnyMoves();
  const profile = buildCandidateLegalityProfile({
    member: { id: "lopunny", name: "Lopunny", types: ["Normal"] },
    moves,
    levelCap: 75,
    moveUsage: ZU_LIKE_USAGE,
    movePreference: "utility",
  });
  assert.ok(
    profile.recommendedMoves.some((move) => move.id === "splash"),
    `the utility build should keep usage-ranked Splash, got: ${profile.recommendedMoves
      .map((move) => move.id)
      .join(", ")}`,
  );
});

test("zero-usage status filler is never recommended", async () => {
  const moves = await lopunnyMoves();
  const member = { id: "lopunny", name: "Lopunny", types: ["Normal"] };
  // Usage that mentions only real moves: Splash (and every other unused
  // status move) has no usage entry, so no utility-ranked path may pick it.
  const usage = new Map([
    ["return", 60],
    ["highjumpkick", 55],
  ]);
  for (const movePreference of ["default", "utility", "coverage"]) {
    const profile = buildCandidateLegalityProfile({
      member,
      moves,
      levelCap: 75,
      moveUsage: usage,
      movePreference,
    });
    assert.ok(
      profile.recommendedMoves.every((move) => move.id !== "splash"),
      `${movePreference} build recommended zero-usage Splash: ${profile.recommendedMoves
        .map((move) => move.id)
        .join(", ")}`,
    );
  }
});

test("the canonical top-4 stays sovereign — a top-4 Splash is kept", async () => {
  const moves = await lopunnyMoves();
  const profile = buildCandidateLegalityProfile({
    member: { id: "lopunny", name: "Lopunny", types: ["Normal"] },
    moves,
    levelCap: 75,
    moveUsage: new Map([
      ["splash", 99],
      ["return", 60],
      ["highjumpkick", 55],
      ["fakeout", 40],
    ]),
  });
  assert.ok(
    profile.recommendedMoves.some((move) => move.id === "splash"),
    "a canonical top-4 Splash must be kept",
  );
});

test("fixed damage is a real attack: typeless coverage, no attack type, no SE targets", () => {
  const seismicToss = {
    id: "seismictoss",
    name: "Seismic Toss",
    type: "Fighting",
    category: "Physical",
    basePower: 0,
    priority: 0,
    utility: false,
    accuracy: 100,
    availableSources: [{ kind: "level-up", label: "Level 15" }],
  };
  const profile = buildCandidateLegalityProfile({
    member: { id: "mankey", name: "Mankey", types: ["Fighting"] },
    moves: [seismicToss],
    levelCap: 25,
    moveUsage: new Map([["seismictoss", 80]]),
  });

  assert.equal(
    profile.recommendedDamagingMoveCount,
    1,
    "Seismic Toss counts as the set's attack",
  );
  assert.ok(
    !profile.attackTypes.includes("Fighting"),
    "typeless offense must not read as a Fighting attacker",
  );
  assert.equal(profile.superEffectiveTargetCount, 0);
  assert.equal(profile.bestStabMove, null, "fixed damage never gets STAB");

  // Coverage: flat into every type Fighting can touch, zero only into the
  // Ghost immunity.
  const ghostIndex = REBORN_ANALYSIS_TYPES.indexOf("Ghost");
  const normalIndex = REBORN_ANALYSIS_TYPES.indexOf("Normal");
  const rockIndex = REBORN_ANALYSIS_TYPES.indexOf("Rock");
  assert.equal(profile.coverageVector[ghostIndex], 0);
  assert.ok(profile.coverageVector[normalIndex] > 0);
  assert.equal(
    profile.coverageVector[normalIndex],
    profile.coverageVector[rockIndex],
    "flat damage is never boosted or resisted",
  );
});
