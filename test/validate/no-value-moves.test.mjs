// User report: Lopunny was recommended Splash. The ACTUAL cause (established
// by reproduction, not the first theory): base Lopunny's stitched set index is
// primary-sourced from Gen 7 ZU @ 1500, where meme Splash sets are real enough
// for 17.7% usage; the move-meta generator blanket-flagged every status move
// as utility; and the UTILITY-preference build ranks utility moves by usage —
// so Splash out-ranked real role moves into the utility build. It was never in
// the canonical top-4 (Switcheroo / Return / High Jump Kick / Fake Out).
//
// The fix is generator truth: a reviewed do-nothing list (Splash, Celebrate,
// Hold Hands, Happy Hour, Gen-7 Teleport) is no longer utility, so no
// utility-ranked path can seat those moves. The canonical top-4 is
// deliberately NOT gated (user decision): if the meaningful tier's real sets
// run a move, the recommendation may too — usage is sovereign for the
// canonical set.
import test from "node:test";
import assert from "node:assert/strict";
// Side effect: installs the fetch/env/localStorage shims the app modules need.
import "../helpers/harness.mjs";

const { MOVE_META } = await import(
  "../../src/generated/gen7MoveMeta.generated.js"
);
const { getAvailableRebornMoves, loadRebornLegalMoveData } = await import(
  "../../src/reborn/legalMoves.js"
);
const { buildCandidateLegalityProfile } = await import(
  "../../src/reborn/teamAnalysis.js"
);
const { REBORN_ANALYSIS_TYPES } = await import(
  "../../src/reborn/typeChart.js"
);

// The reported scenario's shape: Splash carries real meme usage, but is NOT in
// the canonical top-4.
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

test("do-nothing status moves are not utility; real ones still are", () => {
  for (const id of ["splash", "celebrate", "holdhands", "happyhour", "teleport"]) {
    assert.equal(MOVE_META[id]?.utility, false, `${id} must not be utility`);
  }
  for (const id of ["protect", "recover", "toxic", "stealthrock", "swordsdance"]) {
    assert.equal(MOVE_META[id]?.utility, true, `${id} must stay utility`);
  }
});

test("the utility build cannot seat Splash on usage alone (the reported bug)", async () => {
  const moves = await lopunnyMoves();
  assert.ok(
    moves.some((move) => move.id === "splash"),
    "sanity: Splash is still a LEGAL move — it just carries no value",
  );
  const member = { id: "lopunny", name: "Lopunny", types: ["Normal"] };
  for (const movePreference of ["default", "utility", "coverage"]) {
    const profile = buildCandidateLegalityProfile({
      member,
      moves,
      levelCap: 75,
      moveUsage: ZU_LIKE_USAGE,
      movePreference,
    });
    assert.ok(profile.recommendedMoves.length > 0);
    assert.ok(
      profile.recommendedMoves.every((move) => move.id !== "splash"),
      `${movePreference} build recommended Splash: ${profile.recommendedMoves
        .map((move) => move.id)
        .join(", ")}`,
    );
  }
});

test("the canonical top-4 stays sovereign — even a do-nothing move in it is kept", async () => {
  // User decision: the recommender must not second-guess the meaningful
  // tier's real sets. If Splash IS canonical, it is recommendable.
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
