// Evolution legality-with-friction (roadmap 4B acceptance): uniform rules,
// legal-with-K where requirements are satisfiable, UNKNOWN surfaced — never
// silently blocked, never verdict-fitted.
import test from "node:test";
import assert from "node:assert/strict";
import {
  getEvolutionRequirement,
  evolutionChainProof,
} from "../src/reborn/evolutionRequirements.js";
import { GEN7_PROGRESSION_SPECIES } from "../src/generated/gen7ProgressionSpecies.generated.js";

const species = (id) => GEN7_PROGRESSION_SPECIES[id];

test("level evolution: legal, K = 0, gated by evoLevel", () => {
  const req = getEvolutionRequirement(species("frogadier"));
  assert.equal(req.status, "legal");
  assert.equal(req.levelRequired, 16);
  assert.equal(req.friction, 0);
});

test("friendship evolution: legal with friendship K", () => {
  const req = getEvolutionRequirement(species("pikachu"));
  assert.equal(req.status, "legal");
  assert.equal(req.method, "friendship");
  assert.ok(req.friction > 0);
});

test("Happiny -> Chansey: legal via wild-held Oval Stone, with item K + proof", () => {
  const req = getEvolutionRequirement(species("chansey"));
  assert.equal(req.status, "legal");
  assert.equal(req.method, "item");
  assert.ok(req.friction > 0);
  assert.match(req.reason, /Oval Stone/);
  assert.match(req.reason, /farmable/);
});

test("stone evolution: legal, farmable-tedious priced above plain item K", () => {
  const raichu = getEvolutionRequirement(species("raichu"));
  const chansey = getEvolutionRequirement(species("chansey"));
  assert.equal(raichu.status, "legal");
  assert.ok(raichu.friction > chansey.friction, "tedious stone > 50% wild-held item");
});

test("trade evolution: legal via Link Stone (Reborn), trade + item stack for Steelix", () => {
  const alakazam = getEvolutionRequirement(species("alakazam"));
  assert.equal(alakazam.status, "legal");
  assert.match(alakazam.reason, /Link Stone/);
  const steelix = getEvolutionRequirement(species("steelix"));
  assert.equal(steelix.status, "legal");
  assert.ok(steelix.friction > alakazam.friction, "trade WITH item costs more");
});

test("unknown item: surfaced as unknown, not silently blocked or allowed", () => {
  const milotic = getEvolutionRequirement(species("milotic"));
  assert.equal(milotic.status, "unknown");
  assert.match(milotic.reason, /unknown/i);
});

test("move-based evolution: gated by the pre-evo's learn level", () => {
  const tangrowth = getEvolutionRequirement(species("tangrowth"));
  assert.equal(tangrowth.status, "legal");
  assert.equal(tangrowth.levelRequired, 38);
});

test("affection condition reads as friendship-like", () => {
  const sylveon = getEvolutionRequirement(species("sylveon"));
  assert.equal(sylveon.status, "legal");
  assert.equal(sylveon.method, "affection");
});

test("chain proof sums friction with per-step reasons", () => {
  const blissey = evolutionChainProof("blissey");
  assert.equal(blissey.steps.length, 2);
  assert.ok(blissey.friction > 0);
  assert.match(blissey.steps[0].reason, /Oval Stone/);
  assert.equal(blissey.steps[1].method, "friendship");
});
