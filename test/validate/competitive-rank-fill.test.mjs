// Step 5 of the move recommender (user ruling, from a 0-badge Liepard with a
// blank fourth slot): when canonical moves are inaccessible, the mandatory
// attack/utility are placed, and the damage-led fill is dry, remaining slots
// fill by the stitched competitive priority order — descending usage within
// the canonical tier, then the fallback tiers down the ladder. Cross-tier
// entries whose usage % was nulled in the stitch (Liepard's AG Assist) are
// visible to this rank; moves with no competitive appearance anywhere still
// never seat.
import test from "node:test";
import assert from "node:assert/strict";
import "../helpers/harness.mjs"; // installs fetch shim

const { buildRebornTeamAnalysis } = await import(
  "../../src/reborn/teamAnalysis.js"
);

test("Liepard@20: the empty fourth slot fills with AG's Assist, not unseen filler", async () => {
  const analysis = await buildRebornTeamAnalysis(
    [{ pokemonId: "liepard", name: "Liepard", inputName: "Purrloin" }],
    { levelCap: 20 },
    { family: "singles", selection: "all" },
  );
  const ids = analysis.profiles[0].recommendedMoves.map((move) => move.id);

  // Steps 1–4 unchanged: no canonical move is legal at cap 20, Pursuit is the
  // hardest hit AND the utility guarantee, Scratch adds a fresh type, Fury
  // Swipes is the any-attack fallback.
  assert.deepEqual(ids.slice(0, 3), ["pursuit", "scratch", "furyswipes"]);

  // Step 5: Assist is the best-ranked remaining legal move on Liepard's
  // stitched ladder (a real AG 1760 set entry, usage-nulled by the stitch).
  // Before the ruling this slot rendered empty while Assist sat legal.
  assert.equal(ids[3], "assist", `got: ${ids.join(", ")}`);

  // The other legal leftovers (Growl / Sand Attack / Torment) rank below
  // Assist on the ladder and must not displace it.
  assert.equal(ids.length, 4);
});
