// Shortlist regret validation (roadmap Phase 6 acceptance): on a pool where the
// TRUE exact optimum is computable, force the shortlist path at several sizes and
// require it to recover the exact team. "Exact-on-shortlist" earns the word
// "exact" only while this stays at (near-)zero regret. One file on purpose: the
// three sizes share one exact baseline (the expensive part).
import test from "node:test";
import assert from "node:assert/strict";
import { loadFixture } from "../helpers/fixtureRunner.mjs";
import { runPool, teamInputNames } from "../helpers/harness.mjs";

test("shortlist regret on exact-feasible 36-mon pool (sizes 24/28/32)", async () => {
  const fixture = loadFixture("early-weak-froakie");
  // The interactive budgets route C(36,6)=1.95M to shortlist+polish, so the
  // TRUE exact baseline needs the cap raised — a test-only override, exactly
  // what the tunable exists for.
  const exact = await runPool({
    pool: fixture.pool,
    badge: fixture.badge,
    levelCap: fixture.levelCap,
    overrides: { EXHAUSTIVE_CAP: 3_000_000 },
  });
  assert.equal(exact.searchExact, true, "baseline must be the true exact search");
  const exactTeam = teamInputNames(exact);

  for (const size of [24, 28, 32]) {
    const shortlisted = await runPool({
      pool: fixture.pool,
      badge: fixture.badge,
      levelCap: fixture.levelCap,
      overrides: { FORCE_SHORTLIST: true, SHORTLIST_MAX: size },
    });
    assert.deepEqual(
      teamInputNames(shortlisted),
      exactTeam,
      `shortlist size ${size} diverged from the exact optimum (regret > 0)`,
    );
    assert.ok(
      shortlisted.searchPolish,
      "the shortlist path must always carry the swap-audit record",
    );
  }
});

test("swap-polish repairs a shortlist miss back to the exact optimum", async () => {
  // At tiny forced shortlist sizes the heuristics provably miss a seat —
  // the team-context blind spot the audit exists for. The polish must (a)
  // detect it — swaps recorded with attribution — and (b) repair it all the
  // way back to the true exact team. Re-planted whenever the scoring model
  // changes (the plantable pool/size is model-dependent): under the
  // per-build additive-damage model the miss lives in the late-broad-froakie
  // pool at size 6 (measured: shortlist misses, the polish records swaps and
  // repairs all the way to the exact optimum; production SHORTLIST_MAX is 28,
  // far above this). If a future change makes this lossless, re-plant the
  // miss rather than deleting the assert.
  const fixture = loadFixture("late-broad-froakie");
  const exact = await runPool({
    pool: fixture.pool,
    badge: fixture.badge,
    levelCap: fixture.levelCap,
    overrides: { EXHAUSTIVE_CAP: 3_000_000 },
  });
  assert.equal(exact.searchExact, true, "baseline must be the true exact search");
  const exactTeam = teamInputNames(exact);

  const repaired = await runPool({
    pool: fixture.pool,
    badge: fixture.badge,
    levelCap: fixture.levelCap,
    overrides: { FORCE_SHORTLIST: true, SHORTLIST_MAX: 6 },
  });
  const polish = repaired.searchPolish;
  assert.ok(polish, "shortlist path must run the audit");
  assert.ok(
    polish.swaps.length >= 1,
    "the planted miss must trigger at least one repair",
  );
  for (const swap of polish.swaps) {
    assert.ok(swap.gain > 0, "every accepted swap must strictly improve");
    assert.ok(
      swap.attribution.rank >= 1 && swap.attribution.rank <= swap.attribution.of,
      "attribution must rank the incomer within the pool",
    );
  }
  assert.deepEqual(
    teamInputNames(repaired),
    exactTeam,
    "the polished team must recover the exact optimum",
  );
  // Same team, but the two search paths sum member/coverage terms in a
  // different order — equal to float round-off, not bit-for-bit.
  assert.ok(
    Math.abs(repaired.teamScore - exact.teamScore) < 1e-9,
    `and its exact score (${repaired.teamScore} vs ${exact.teamScore})`,
  );
  assert.ok(
    repaired.benchSwapScores instanceof Map && repaired.benchSwapScores.size > 0,
    "the audit's final scan doubles as the bench swap map",
  );

  // The healthy case is a record too: at a size the shortlist handles, the
  // audit must still report it RAN and held (silence would be
  // indistinguishable from "didn't look").
  const held = await runPool({
    pool: fixture.pool,
    badge: fixture.badge,
    levelCap: fixture.levelCap,
    overrides: { FORCE_SHORTLIST: true, SHORTLIST_MAX: 24 },
  });
  assert.ok(held.searchPolish, "audit record must exist");
  assert.equal(held.searchPolish.swaps.length, 0, "shortlist held at 24");
  assert.ok(held.searchPolish.audited > 0, "audit must report coverage");
});
