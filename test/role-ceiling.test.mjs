import assert from "node:assert/strict";
import test from "node:test";

import { softCeiling } from "../src/teamBuilder/currentFormValue.js";
import { setScoringOverrides } from "../src/teamBuilder/scoringConstants.js";

test("soft ceiling is identity below the knee", () => {
  for (const x of [0, 0.2, 0.5, 0.9]) {
    assert.equal(softCeiling(x), x);
  }
  assert.equal(softCeiling(-0.3), 0);
});

test("soft ceiling keeps overshooting roles ordered and strictly below 1", () => {
  const inputs = [0.91, 0.95, 1.0, 1.01, 1.05, 1.1, 1.5];
  const outputs = inputs.map(softCeiling);
  for (let i = 0; i < outputs.length; i++) {
    assert.ok(outputs[i] < 1, `softCeiling(${inputs[i]}) must stay below 1`);
    if (i > 0) {
      assert.ok(
        outputs[i] > outputs[i - 1],
        `softCeiling must be strictly increasing at ${inputs[i]}`,
      );
    }
  }
  // Continuous at the knee: no jump where the two branches meet.
  assert.ok(softCeiling(0.9 + 1e-9) - 0.9 < 1e-6);
});

test("the knee is a sweepable judgement", () => {
  setScoringOverrides({ ROLE_CEILING_KNEE: 0.95 });
  try {
    assert.equal(softCeiling(0.93), 0.93);
    assert.ok(softCeiling(1.1) > 0.95);
    assert.ok(softCeiling(1.1) < 1);
  } finally {
    setScoringOverrides(null);
  }
});
