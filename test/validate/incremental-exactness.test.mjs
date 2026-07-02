// Proof obligation for the incremental cache's "searchExact: true" claim
// (external review): growing pool S to S ∪ {X}, the true optimum either
// contains no added line (the cached exact optimum remains valid) or contains
// ≥1 added line — and then the incremental step must enumerate every such team
// over the FULL old pool, not just neighborhoods of the old optimum. The code
// does enumerate `choose(a of added) × choose(size−a of ALL old lines)`
// (teamSelection.selectTeamExhaustive), so the trap the review describes —
// "new optimum = X + companions that were NOT all in the old optimum" — must
// be found. This test proves it empirically: the fixture below is a verified
// trap (adding Sandshrew pulls Tentacool into the optimum, which the old
// optimum excluded), and the warm incremental answer must equal a cold full
// exact search of the union pool, member for member.
import test from "node:test";
import assert from "node:assert/strict";
import { runPool, teamInputNames } from "../helpers/harness.mjs";

const { __resetOptimizerCachesForTests } = await import(
  "../../src/teamBuilder/teamOptimizer.js"
);

// Under a Ground/Rock-leaning opponent bias, the old optimum leans on
// Bellsprout/Meowth for offense. Adding Sandshrew (Ground STAB + the bias's
// favorite target profile) restructures the team: the true union optimum
// seats Sandshrew AND swaps in Tentacool, which the old optimum excluded —
// exactly the "companions reshuffled beyond the old optimum" trap. An
// incremental step that only patched X into neighborhoods of the old optimum
// would miss it.
const BASE_POOL = [
  "Wingull", "Pidgey", "Poliwag", "Psyduck", "Slowpoke", "Tentacool",
  "Machop", "Oddish", "Bellsprout", "Abra", "Meowth",
];
const ADDED = "Sandshrew";
const BIAS = { Ground: 1.5, Rock: 1.5 };

test("incremental growth answers exactly (warm S→S∪{X} equals cold S∪{X})", async () => {
  // Cold truth: full exact search of the union pool, no caches.
  __resetOptimizerCachesForTests();
  const cold = await runPool({
    pool: [...BASE_POOL, ADDED],
    badge: 1,
    levelCap: 25,
    opponentTypeBias: BIAS,
  });
  assert.equal(cold.searchExact, true);

  // Warm path: search S first (seeding the incremental cache), then grow.
  __resetOptimizerCachesForTests();
  const before = await runPool({
    pool: BASE_POOL,
    badge: 1,
    levelCap: 25,
    opponentTypeBias: BIAS,
  });
  assert.equal(before.searchExact, true);
  const warm = await runPool({
    pool: [...BASE_POOL, ADDED],
    badge: 1,
    levelCap: 25,
    opponentTypeBias: BIAS,
  });
  assert.equal(warm.searchExact, true, "grown pool must still claim exact");

  // The fixture must actually BE the trap, or this test proves nothing: the
  // cold-truth optimum seats X plus ≥1 companion the old optimum excluded.
  const oldTeam = new Set(teamInputNames(before));
  assert.ok(
    teamInputNames(cold).includes(ADDED),
    "fixture drift: added mon no longer seats in the union optimum",
  );
  assert.ok(
    teamInputNames(cold).some((name) => name !== ADDED && !oldTeam.has(name)),
    "fixture drift: union optimum's companions are a subset of the old optimum — trap no longer springs",
  );

  assert.deepEqual(
    teamInputNames(warm),
    teamInputNames(cold),
    "incremental result diverged from the cold exact optimum — 'searchExact: true' would be false advertising",
  );
});
