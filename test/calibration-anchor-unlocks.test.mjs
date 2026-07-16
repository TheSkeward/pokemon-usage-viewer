import assert from "node:assert/strict";
import test from "node:test";

import {
  activePoorAnchors,
  poorAnchor,
  poorAnchorInput,
  poorAnchorLabel,
} from "./helpers/calibrationAnchors.mjs";

test("evolved poor anchors enter calibration through their caught form", () => {
  const bastiodon = poorAnchor("Bastiodon", "Shieldon");
  assert.deepEqual(activePoorAnchors([bastiodon], ["Shieldon"]), [bastiodon]);
  assert.equal(poorAnchorInput(bastiodon), "Shieldon");
  assert.equal(poorAnchorLabel(bastiodon), "Bastiodon (via Shieldon)");
  assert.deepEqual(activePoorAnchors([bastiodon], ["Bastiodon"]), []);
});
