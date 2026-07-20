// Level-1 relists: a level-1 Mawile always has Astonish, Fairy
// Wind, Growl, and Taunt — the LAST four entries of its ≤1 learnset block.
// Play Rough and Iron Head sit at the head of that block as move-relearner
// catalog entries, never actual level-1 moves, so they must not appear as
// "Level 1" sources. Iron Head keeps its genuine later level (45).
import test from "node:test";
import assert from "node:assert/strict";

await import("./helpers/harness.mjs"); // fetch → filesystem shim
const { getAvailableRebornMoves, loadRebornLegalMoveData } = await import(
  "../src/reborn/legalMoves.js"
);

const mawile = await loadRebornLegalMoveData("mawile");

function availableIds(progression) {
  return new Map(
    getAvailableRebornMoves(mawile, progression).map((move) => [
      move.id,
      move.availableSources,
    ]),
  );
}

test("head-of-block level-1 relists are not level-up moves", () => {
  const moves = availableIds({ levelCap: "20" });
  for (const id of ["astonish", "fairywind", "growl", "taunt"]) {
    const sources = moves.get(id);
    assert.ok(sources, `${id} is a genuine starting move`);
    assert.equal(sources[0].label, "Level 1");
  }
  assert.ok(!moves.has("playrough"), "Play Rough is relearner catalog, not Level 1");
  assert.ok(!moves.has("ironhead"), "Iron Head is relearner catalog below 45");
});

test("relists come back through the relearner, and real levels still count", () => {
  const withRelearner = availableIds({
    levelCap: "20",
    moveRelearnerUnlocked: true,
  });
  assert.equal(withRelearner.get("playrough")?.[0]?.kind, "relearner");
  assert.equal(withRelearner.get("ironhead")?.[0]?.kind, "relearner");

  const atFullCap = availableIds({ levelCap: "50" });
  assert.equal(atFullCap.get("ironhead")?.[0]?.label, "Level 45");
  assert.equal(atFullCap.get("playrough")?.[0]?.label, "Level 49");
});
