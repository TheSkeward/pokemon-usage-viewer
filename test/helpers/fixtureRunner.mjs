// Shared runner for scenario fixtures (test/fixtures/*.json): runs the real
// optimizer once per fixture and asserts the fixture's explicit expectations
// (mustSeat / mustNotSeat / role / fielded form). Golden snapshots were
// retired once the badge-bucket rank-calibration corpus became the primary
// scoring test (user decision: goldens were ad-hoc and slowed velocity, and
// most of these fixtures will be retired once the corpus passes). Fixtures
// pin invariants ("Froakie seats as a fast attacker"), never a blessed six.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPool, teamInputNames, bestChoice } from "./harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, "..", "fixtures");

export function loadFixture(name) {
  return JSON.parse(
    readFileSync(path.join(FIXTURES, `${name}.json`), "utf8"),
  );
}

export async function runFixture(fixture) {
  return runPool({
    pool: fixture.pool,
    badge: fixture.badge,
    levelCap: fixture.levelCap,
    opponentTypeBias: fixture.opponentTypeBias || {},
  });
}

export function assertExpectations(fixture, result) {
  const expectations = fixture.expectations || {};
  const seated = new Set(teamInputNames(result));

  for (const name of expectations.mustSeat || []) {
    assert.ok(
      seated.has(name),
      `${fixture.name}: expected ${name} on the team, got [${[...seated].join(", ")}]`,
    );
  }
  for (const name of expectations.mustNotSeat || []) {
    assert.ok(
      !seated.has(name),
      `${fixture.name}: ${name} must not seat, got [${[...seated].join(", ")}]`,
    );
  }
  for (const [name, acceptableRoles] of Object.entries(expectations.roles || {})) {
    const choice = bestChoice(result, name);
    assert.ok(choice, `${fixture.name}: no resolved line for ${name}`);
    assert.ok(
      acceptableRoles.includes(choice.currentRole),
      `${fixture.name}: ${name} role ${choice.currentRole}, expected one of ${acceptableRoles}`,
    );
  }
  for (const [name, form] of Object.entries(expectations.fieldedForm || {})) {
    const choice = bestChoice(result, name);
    assert.ok(choice, `${fixture.name}: no resolved line for ${name}`);
    const fielded = choice.legalityProfile?.currentId || choice.pokemonId;
    const acceptable = Array.isArray(form) ? form : [form];
    assert.ok(
      acceptable.includes(fielded),
      `${fixture.name}: ${name} fielded as ${fielded}, expected ${acceptable.join(" | ")}`,
    );
  }
  if ("searchExact" in expectations) {
    assert.equal(
      result.searchExact,
      expectations.searchExact,
      `${fixture.name}: searchExact mismatch`,
    );
  }
  if ("teamSize" in expectations) {
    assert.equal(result.team.length, expectations.teamSize);
  }
}

export async function runScenario(name) {
  const fixture = loadFixture(name);
  const result = await runFixture(fixture);
  assertExpectations(fixture, result);
  return { fixture, result };
}
