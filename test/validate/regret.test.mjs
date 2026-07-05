// Shortlist regret validation (roadmap Phase 6 acceptance): on a pool where the
// TRUE exact optimum is computable, force the shortlist path at several sizes and
// require it to recover the exact team. "Exact-on-shortlist" earns the word
// "exact" only while this stays at (near-)zero regret. One file on purpose: the
// three sizes share one exact baseline (the expensive part).
import test from "node:test";
import assert from "node:assert/strict";
import { loadFixture, runFixture } from "../helpers/fixtureRunner.mjs";
import { runPool, teamInputNames } from "../helpers/harness.mjs";

test("shortlist regret on exact-feasible 36-mon pool (sizes 24/28/32)", async () => {
  const fixture = loadFixture("early-weak-froakie");
  const exact = await runFixture(fixture);
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
  }
});
