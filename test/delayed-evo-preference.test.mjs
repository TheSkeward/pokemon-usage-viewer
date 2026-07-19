// Delayed-evolution route preference (user ruling): among delayed routes,
// the LEAST evolutionary delay wins — leveling a Staravia to 43 beats
// carrying a Starly to 37 when the cap allows it; the deeper delay is only
// taken when the cap forces it, and the fielded form's own level-up beats
// both once reachable.
import test from "node:test";
import assert from "node:assert/strict";

await import("./helpers/harness.mjs"); // fetch → filesystem shim
const { getAvailableRebornMoves, loadRebornLegalMoveData } = await import(
  "../src/reborn/legalMoves.js"
);

const staraptor = await loadRebornLegalMoveData("staraptor");

function braveBirdSource(levelCap) {
  return getAvailableRebornMoves(staraptor, { levelCap }).find(
    (move) => move.id === "bravebird",
  )?.availableSources?.[0];
}

test("cap 45: shallow delay (Staravia@43) beats deep delay (Starly@37)", () => {
  const source = braveBirdSource("45");
  assert.equal(source.learnerId, "staravia");
  assert.equal(source.label, "Level 43 (Staravia)");
  assert.equal(source.delayedEvolution, true);
});

test("cap 40: Staravia's 43 is out of reach, Starly@37 is the route", () => {
  const source = braveBirdSource("40");
  assert.equal(source.learnerId, "starly");
  assert.equal(source.label, "Level 37 (Starly)");
});

test("cap 50: Staraptor's own Level 49 needs no delay at all", () => {
  const source = braveBirdSource("50");
  assert.equal(source.learnerId, "staraptor");
  assert.equal(source.delayedEvolution, undefined);
});
