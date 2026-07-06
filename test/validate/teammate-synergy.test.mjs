// Phase 3 scaffolding invariants: with no teammate-index data (none is
// shipped until the data-refresh CI runs the extractor), the synergy term is
// SILENT — pair trust 0 everywhere, hand-built team fit at full strength —
// so results are bit-identical with the term enabled or disabled, under both
// scoring models. The behavior tests (cores win ties, bias never fades)
// land with the extracted data and its calibration.
import test from "node:test";
import assert from "node:assert/strict";
import { runPool, teamInputNames } from "../helpers/harness.mjs";

const POOL = ["Machop", "Growlithe", "Tentacool", "Abra", "Doduo", "Mareep", "Gastly", "Rhyhorn"];

test("no teammate data ⇒ synergy is silent under both models", async () => {
  for (const model of [null, "v1"]) {
    const overridesOn = { SYNERGY_SCALE: 3, ...(model ? { USAGE_MODEL: model } : {}) };
    const overridesOff = { SYNERGY_SCALE: 0, ...(model ? { USAGE_MODEL: model } : {}) };
    const on = await runPool({ pool: POOL, badge: 8, levelCap: 45, overrides: overridesOn });
    const off = await runPool({ pool: POOL, badge: 8, levelCap: 45, overrides: overridesOff });
    assert.deepEqual(
      teamInputNames(on),
      teamInputNames(off),
      `model=${model || "v0"}: synergy scale must be inert without data`,
    );
    const scoreOf = (result) =>
      result.lines.map((line) => Math.round(line.best?.score ?? 0)).join(",");
    assert.equal(scoreOf(on), scoreOf(off));
  }
});
