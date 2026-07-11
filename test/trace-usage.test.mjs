// Display-only seen-within-N-games relaxation (bench tail labels). The
// meaningful bar is 50%-seen-within-25-games (≈2.73%); below it, the label's
// N is the smallest 5-step ≥ the exact horizon for that usage.
import test from "node:test";
import assert from "node:assert/strict";
import {
  BASE_SEEN_GAMES,
  SEEN_GAMES_STEP,
  gamesToLikelySee,
} from "../src/teamBuilder/traceUsage.js";

test("gamesToLikelySee inverts the 50%-seen bar and steps by 5", () => {
  // Exact horizons: ln(0.5)/ln(1−v). 2.5% → 27.4 → 30; 2.0% → 34.3 → 35;
  // 1.0% → 69.0 → 70; 0.5% → 138.3 → 140.
  assert.equal(gamesToLikelySee(2.5), 30);
  assert.equal(gamesToLikelySee(2.0), 35);
  assert.equal(gamesToLikelySee(1.0), 70);
  assert.equal(gamesToLikelySee(0.5), 140);

  // Band edges are exclusive on the fast side: exactly the N=30 bar
  // (≈2.284%) qualifies at 30, a hair above it still needs 30, a hair below
  // the 25-bar can never label better than the first relaxation step.
  const bar = (n) => 100 * (1 - 0.5 ** (1 / n));
  assert.equal(gamesToLikelySee(bar(30)), 30);
  assert.equal(gamesToLikelySee(bar(25) - 1e-9), 30);

  // Defensive floor: values at/above the meaningful bar (which should never
  // reach this code — they carry a ranking) still clamp to the first step.
  assert.equal(gamesToLikelySee(5), BASE_SEEN_GAMES + SEEN_GAMES_STEP);

  // No usage stays honest "no usage data".
  assert.equal(gamesToLikelySee(0), null);
  assert.equal(gamesToLikelySee(null), null);
  assert.equal(gamesToLikelySee(undefined), null);
});
