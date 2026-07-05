// User report: Slaking's set said "requires delayed evolution" on both Focus
// Punch and Play Rough — hiding that they delay DIFFERENT evolutions (Focus
// Punch is Vigoroth@37: delay Vigoroth→Slaking past 36; Play Rough is
// Slakoth@38: delay Slakoth→Vigoroth past 18). Pre-evo level-up entries now
// carry their ancestor, each level is judged against THAT form's own natural
// departure, and the label names the form being kept unevolved.
import test from "node:test";
import assert from "node:assert/strict";
// Side effect: installs the fetch/env/localStorage shims the app modules need.
import "../helpers/harness.mjs";

const { getAvailableRebornMoves, loadRebornLegalMoveData } = await import(
  "../../src/reborn/legalMoves.js"
);

test("delayed moves name the form being kept unevolved (Slaking chain)", async () => {
  const data = await loadRebornLegalMoveData("slaking");
  const moves = getAvailableRebornMoves(data, { levelCap: "40" });
  const label = (id) =>
    moves.find((m) => m.id === id)?.availableSources?.[0]?.label || "";

  assert.match(label("focuspunch"), /keeping Vigoroth unevolved to 37/);
  assert.match(label("playrough"), /keeping Slakoth unevolved to 38/);
  assert.ok(moves.find((m) => m.id === "focuspunch")?.delayedEvolution);
  assert.ok(moves.find((m) => m.id === "playrough")?.delayedEvolution);
});

test("a level is judged against ITS ancestor's departure, not the direct pre-evo's", async () => {
  // Chip Away: Slakoth@25 (needs delaying Slakoth past 18) and Vigoroth/
  // Slaking@27 (natural). The old merged list judged 25 against Vigoroth's
  // departure (36) and displayed a false natural "Level 25".
  const data = await loadRebornLegalMoveData("slaking");
  const moves = getAvailableRebornMoves(data, { levelCap: "40" });
  const chipAway = moves.find((m) => m.id === "chipaway");
  assert.equal(chipAway?.availableSources?.[0]?.label, "Level 27");
  assert.ok(!chipAway?.delayedEvolution);
});
