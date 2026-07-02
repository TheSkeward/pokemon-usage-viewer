// Phase 5 + 9 acceptance: every recommendation carries inclusion frequencies
// (close calls identified as close calls), and future value lives in the
// investment view — flagging "one badge from payoff" mons — without ever
// touching current-six selection.
import test from "node:test";
import assert from "node:assert/strict";
import {
  runPool,
  loadShared,
  progressionAt,
  teamInputNames,
} from "../helpers/harness.mjs";
import { loadFixture } from "../helpers/fixtureRunner.mjs";

const { computeTeamConfidence } = await import(
  "../../src/teamBuilder/confidence.js"
);
const { computeInvestmentPlan } = await import(
  "../../src/teamBuilder/investment.js"
);
const { getScoringOverrides } = await import(
  "../../src/teamBuilder/scoringConstants.js"
);

test("confidence: every member gets a frequency + tier; sweep leaves no override residue", async () => {
  const fixture = loadFixture("weak-shell");
  const result = await runPool({
    pool: fixture.pool,
    badge: fixture.badge,
    levelCap: fixture.levelCap,
  });
  const { availability } = await loadShared();
  const progression = progressionAt({
    badge: fixture.badge,
    levelCap: fixture.levelCap,
  });

  const confidence = await computeTeamConfidence({
    result,
    availability,
    family: "singles",
    progression,
  });
  assert.ok(confidence, "confidence must compute");
  assert.equal(confidence.members.length, result.team.length);
  for (const member of confidence.members) {
    assert.ok(member.frequency > 0 && member.frequency <= 1);
    assert.ok(["core", "likely", "flex", "fragile"].includes(member.tier));
  }
  assert.equal(getScoringOverrides(), null, "sweep must clear overrides");

  // Determinism: the sweep is a fixed grid — same inputs, same frequencies.
  const again = await computeTeamConfidence({
    result,
    availability,
    family: "singles",
    progression,
  });
  assert.deepEqual(
    again.members.map((m) => [m.inputPokemonId, m.frequency]),
    confidence.members.map((m) => [m.inputPokemonId, m.frequency]),
  );
});

test("investment: Magikarp at cap 19 is flagged as near payoff (Gyarados at 20), and F never seats it now", async () => {
  const fixture = loadFixture("high-ceiling-babies");
  const result = await runPool({
    pool: fixture.pool,
    badge: fixture.badge,
    levelCap: fixture.levelCap,
  });
  assert.ok(
    !teamInputNames(result).includes("Magikarp"),
    "future value must not seat Magikarp in the current six",
  );

  const { availability, pokemonIndex } = await loadShared();
  const plan = await computeInvestmentPlan({
    availability,
    family: "singles",
    pokemonIndex,
    progression: progressionAt({
      badge: fixture.badge,
      levelCap: fixture.levelCap,
    }),
    query: fixture.pool.join("\n"),
    selection: "all",
    result,
  });
  assert.ok(plan, "investment plan must compute");
  const magikarp = plan.trainSoon.find(
    (entry) => entry.inputName === "Magikarp",
  );
  assert.ok(
    magikarp,
    `Magikarp should be in trainSoon; got [${plan.trainSoon.map((e) => e.inputName).join(", ")}]`,
  );
  assert.ok(magikarp.evolves, "the payoff is the evolution");
});
