import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGamestateExport,
  gamestateFileName,
  parseGamestateImport,
} from "../src/teamBuilder/gamestateBackup.js";

test("export/import round-trips pool and progression", () => {
  const progression = {
    checkpoint: "badge-8",
    levelCap: "45",
    daycareUnlocked: true,
    availableTmIds: ["tm28", "tm39"],
    ownedItems: { leftovers: 6, leafstone: 2 },
    opponentTypeBias: { Water: 3 },
  };
  const text = buildGamestateExport({
    query: "Froakie\nOnix (Sturdy)\nSpearow",
    progression,
  });
  const back = parseGamestateImport(text);
  assert.equal(back.pool, "Froakie\nOnix (Sturdy)\nSpearow");
  assert.deepEqual(back.progression, progression);
});

test("old exports carrying the retired scoringModel field still import", () => {
  const old = JSON.stringify({
    format: "pokemon-usage-viewer-gamestate",
    version: 1,
    pool: "Froakie",
    progression: { levelCap: "20" },
    scoringModel: "v0",
  });
  const back = parseGamestateImport(old);
  assert.equal(back.pool, "Froakie");
  assert.deepEqual(back.progression, { levelCap: "20" });
  assert.ok(!("scoringModel" in back), "retired field must not round-trip");
});

test("parser rejects non-gamestate input with readable messages", () => {
  assert.throws(() => parseGamestateImport("not json"), /Not a JSON file/);
  assert.throws(() => parseGamestateImport('{"a":1}'), /Not a gamestate export/);
  assert.throws(
    () =>
      parseGamestateImport(
        JSON.stringify({ format: "pokemon-usage-viewer-gamestate", version: 99, pool: "", progression: {} }),
      ),
    /Unsupported gamestate version 99/,
  );
  assert.throws(
    () =>
      parseGamestateImport(
        JSON.stringify({ format: "pokemon-usage-viewer-gamestate", version: 1, progression: {} }),
      ),
    /no pool text/,
  );
  assert.throws(
    () =>
      parseGamestateImport(
        JSON.stringify({ format: "pokemon-usage-viewer-gamestate", version: 1, pool: "" }),
      ),
    /no progression/,
  );
});

test("file name is date-stamped", () => {
  assert.equal(
    gamestateFileName(new Date("2026-07-12T08:00:00Z")),
    "reborn-gamestate-2026-07-12.json",
  );
});
