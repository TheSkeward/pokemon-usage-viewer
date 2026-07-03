// Hidden Power gating (user request): before the Type Changer, HP's type is a
// per-mon lottery — not a plannable move, so it is excluded from legality
// outright (it was previously scored as the impossible "Hidden Power Normal").
// With the changer unlocked, it expands into every real Gen 7 variant and the
// recommender picks the best type — capped at one Hidden Power per set.
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

// Wormadam-Trash (from the user's real pool) learns Hidden Power via TM10.
const PROGRESSION = { levelCap: "45", availableTmIds: ["tm10"] };

test("locked: Hidden Power is not a legal pick at all", async () => {
  const data = await loadRebornLegalMoveData("wormadamtrash");
  const moves = getAvailableRebornMoves(data, PROGRESSION);
  assert.ok(
    moves.every((move) => !move.id.startsWith("hiddenpower")),
    "no hiddenpower variant may appear before the Type Changer",
  );
});

test("unlocked: all 16 real variants, no Normal or Fairy, distinct ids", async () => {
  const data = await loadRebornLegalMoveData("wormadamtrash");
  const moves = getAvailableRebornMoves(data, {
    ...PROGRESSION,
    hiddenPowerTypeChangerUnlocked: true,
  });
  const variants = moves.filter((move) => move.id.startsWith("hiddenpower"));
  assert.equal(variants.length, 16);
  const types = new Set(variants.map((move) => move.type));
  assert.equal(types.size, 16);
  assert.ok(!types.has("Normal") && !types.has("Fairy"));
  assert.ok(variants.every((move) => move.basePower === 60 && move.category === "Special"));
  assert.equal(new Set(variants.map((move) => move.id)).size, 16);
});

test("a recommended set carries at most one Hidden Power", async () => {
  const data = await loadRebornLegalMoveData("wormadamtrash");
  const moves = getAvailableRebornMoves(data, {
    ...PROGRESSION,
    hiddenPowerTypeChangerUnlocked: true,
  });
  const profile = buildCandidateLegalityProfile({
    member: { id: "wormadamtrash", name: "Wormadam-Trash", types: ["Bug", "Steel"] },
    moves,
    levelCap: 45,
  });
  const hps = (profile.recommendedMoves || []).filter((move) =>
    move.id.startsWith("hiddenpower"),
  );
  assert.ok(hps.length <= 1, `set carries ${hps.length} Hidden Powers`);
});
