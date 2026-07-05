// Roadmap 4A acceptance: normal-path Greninja at cap 60 lacks Hydro Pump
// (Frogadier-only level-up above its natural evolution level); the delayed
// build variant may carry it, pays DELAYED_EVO_FRICTION, and says so.
import test from "node:test";
import assert from "node:assert/strict";
import { runPool, bestChoice } from "../helpers/harness.mjs";
import { SCORING_DEFAULTS } from "../../src/teamBuilder/scoringConstants.js";

test("delayed-evolution moves: excluded from the default build, priced in the delayed build", async () => {
  const result = await runPool({
    pool: ["Froakie", "Rattata", "Pidgey", "Ekans", "Machop", "Growlithe", "Zubat"],
    badge: 8,
    levelCap: 60,
  });
  const greninja = bestChoice(result, "Froakie");
  assert.ok(greninja, "Froakie line must resolve");

  const defaultBuild = (greninja.buildAlternatives || []).find(
    (build) => build.buildKey === "default",
  ) || greninja;
  const defaultMoves = (defaultBuild.legalityProfile?.recommendedMoves || []).map(
    (move) => move.id,
  );
  assert.ok(
    !defaultMoves.includes("hydropump"),
    "normal-path Greninja must not assume Hydro Pump",
  );

  const delayed = (greninja.buildAlternatives || []).find(
    (build) => build.buildKey === "delayed",
  );
  assert.ok(delayed, "a delayed-evolution build variant must exist");
  const delayedMoves = (delayed.legalityProfile?.recommendedMoves || []).map(
    (move) => move.id,
  );
  assert.ok(delayedMoves.includes("hydropump"));
  assert.ok(
    (delayed.legalityProfile?.frictionCost || 0) >=
      SCORING_DEFAULTS.DELAYED_EVO_FRICTION,
    "the delayed build pays DELAYED_EVO_FRICTION",
  );
  const proof = delayed.legalityProfile?.legalityProof?.delayedMoves || [];
  assert.ok(
    proof.some((entry) => /keeping .+ unevolved to \d+/i.test(entry.source)),
    "the explanation names the form kept unevolved and the level required",
  );
});
