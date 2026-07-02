// Shared runner for scenario fixtures (test/fixtures/*.json): runs the real
// optimizer once per fixture, asserts the fixture's expectations, and — for
// golden fixtures — compares against (or, with UPDATE_GOLDENS=1, rewrites) the
// stored snapshot. Expectations are deliberately loose where the roadmap says
// so: a fixture pins invariants ("Froakie seats as a fast attacker", "Happiny
// must not seat"), not one blessed six unless the case is obvious.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPool, teamInputNames, bestChoice } from "./harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, "..", "fixtures");
const GOLDEN = path.join(HERE, "..", "golden");

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

// A compact, deterministic snapshot of a result: the seated team (with fielded
// forms) plus each line's rounded score, role, and readiness gate. Small enough
// to review in a diff; complete enough that unexplained scoring drift shows up.
export function snapshotOf(result) {
  const lines = {};
  for (const line of result.lines) {
    const choice = line.best || line.bestNonMega;
    if (!choice) continue;
    lines[choice.inputName] = {
      fielded: choice.legalityProfile?.currentId || choice.pokemonId,
      score: Math.round(choice.score ?? 0),
      role: choice.currentRole || null,
      online: choice.online ?? null,
    };
  }
  return {
    team: result.team
      .map(
        (choice) =>
          `${choice.inputName} -> ${choice.legalityProfile?.currentId || choice.pokemonId}`,
      )
      .sort(),
    searchExact: result.searchExact,
    lines,
  };
}

export function checkGolden(fixture, result) {
  if (!fixture.golden) return;
  const file = path.join(GOLDEN, `${fixture.name}.json`);
  const snapshot = snapshotOf(result);
  if (process.env.UPDATE_GOLDENS) {
    mkdirSync(GOLDEN, { recursive: true });
    writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`);
    return;
  }
  if (!existsSync(file)) {
    throw new Error(
      `${fixture.name}: no golden snapshot; run npm run update-goldens`,
    );
  }
  const golden = JSON.parse(readFileSync(file, "utf8"));
  assert.deepEqual(
    snapshot.team,
    golden.team,
    `${fixture.name}: team drifted from golden — if intentional, update goldens and record why in SCORING_V0.md`,
  );
  assert.equal(snapshot.searchExact, golden.searchExact);
  for (const [name, expected] of Object.entries(golden.lines)) {
    const actual = snapshot.lines[name];
    assert.ok(actual, `${fixture.name}: line ${name} missing from result`);
    assert.equal(
      actual.fielded,
      expected.fielded,
      `${fixture.name}: ${name} fielded form drifted`,
    );
    // Scores may drift by rounding noise; anything beyond ±1 is real drift.
    assert.ok(
      Math.abs(actual.score - expected.score) <= 1,
      `${fixture.name}: ${name} score ${actual.score} vs golden ${expected.score}`,
    );
  }
}

export async function runScenario(name) {
  const fixture = loadFixture(name);
  const result = await runFixture(fixture);
  assertExpectations(fixture, result);
  checkGolden(fixture, result);
  return { fixture, result };
}
