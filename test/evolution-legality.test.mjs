// Evolution legality-with-friction (roadmap 4B acceptance): uniform rules,
// legal-with-K where requirements are satisfiable, UNKNOWN surfaced — never
// silently blocked, never verdict-fitted.
//
// Friction DEFAULTS are 0 (requirements are information, the
// player prices their own grind), so the K-pricing assertions here run under
// explicit overrides — they pin the machinery (tedious multiplier, trade+item
// stacking, chain summing) that a future re-enable would turn back on.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getEvolutionRequirement,
  evolutionChainProof,
} from '../src/reborn/evolution-requirements.js';
import { setScoringOverrides } from '../src/teamBuilder/scoring-constants.js';
import { GEN7_PROGRESSION_SPECIES } from '../src/generated/gen7ProgressionSpecies.generated.js';

const species = (id) => GEN7_PROGRESSION_SPECIES[id];

const PRICED = {
  FRIENDSHIP_FRICTION: 15,
  ITEM_FRICTION: 20,
  TRADE_FRICTION: 20,
  TIME_FRICTION: 5,
};

function withPricedFriction(fn) {
  setScoringOverrides(PRICED);
  try {
    return fn();
  } finally {
    setScoringOverrides(null);
  }
}

test('default friction is 0 across methods: requirements inform, never price', () => {
  for (const id of ['pikachu', 'chansey', 'raichu', 'alakazam', 'steelix', 'sylveon']) {
    const req = getEvolutionRequirement(species(id));
    assert.equal(req.status, 'legal');
    assert.equal(req.friction, 0, `${id} must carry no default friction`);
  }
  assert.equal(evolutionChainProof('blissey').friction, 0);
});

test('level evolution: legal, K = 0, gated by evoLevel', () => {
  const req = getEvolutionRequirement(species('frogadier'));
  assert.equal(req.status, 'legal');
  assert.equal(req.levelRequired, 16);
  assert.equal(req.friction, 0);
});

test('friendship evolution: legal with friendship K (priced overrides)', () => {
  withPricedFriction(() => {
    const req = getEvolutionRequirement(species('pikachu'));
    assert.equal(req.status, 'legal');
    assert.equal(req.method, 'friendship');
    assert.ok(req.friction > 0);
  });
});

test('Happiny -> Chansey: legal via wild-held Oval Stone, with item K + proof', () => {
  withPricedFriction(() => {
    const req = getEvolutionRequirement(species('chansey'));
    assert.equal(req.status, 'legal');
    assert.equal(req.method, 'item');
    assert.ok(req.friction > 0);
    assert.match(req.reason, /Oval Stone/);
    assert.match(req.reason, /farmable/);
  });
});

test('stone evolution: legal, farmable-tedious priced above plain item K', () => {
  withPricedFriction(() => {
    const raichu = getEvolutionRequirement(species('raichu'));
    const chansey = getEvolutionRequirement(species('chansey'));
    assert.equal(raichu.status, 'legal');
    assert.ok(raichu.friction > chansey.friction, 'tedious stone > 50% wild-held item');
  });
});

test('trade evolution: legal via Link Stone (Reborn), trade + item stack for Steelix', () => {
  const alakazam = getEvolutionRequirement(species('alakazam'));
  assert.equal(alakazam.status, 'legal');
  assert.match(alakazam.reason, /Link Stone/);
  withPricedFriction(() => {
    const steelix = getEvolutionRequirement(species('steelix'));
    assert.equal(steelix.status, 'legal');
    const priced = getEvolutionRequirement(species('alakazam'));
    assert.ok(steelix.friction > priced.friction, 'trade WITH item costs more');
  });
});

test('unknown item: surfaced as unknown, not silently blocked or allowed', () => {
  const milotic = getEvolutionRequirement(species('milotic'));
  assert.equal(milotic.status, 'unknown');
  assert.match(milotic.reason, /unknown/i);
});

test("move-based evolution: gated by the pre-evo's learn level", () => {
  const tangrowth = getEvolutionRequirement(species('tangrowth'));
  assert.equal(tangrowth.status, 'legal');
  assert.equal(tangrowth.levelRequired, 38);
});

test('affection condition reads as friendship-like', () => {
  const sylveon = getEvolutionRequirement(species('sylveon'));
  assert.equal(sylveon.status, 'legal');
  assert.equal(sylveon.method, 'affection');
});

test('chain proof sums friction with per-step reasons', () => {
  withPricedFriction(() => {
    const blissey = evolutionChainProof('blissey');
    assert.equal(blissey.steps.length, 2);
    assert.ok(blissey.friction > 0);
    assert.match(blissey.steps[0].reason, /Oval Stone/);
    assert.equal(blissey.steps[1].method, 'friendship');
  });
});

test('chain proof stops at the input form: owned evolutions are already paid', () => {
  withPricedFriction(() => {
    const fromChansey = evolutionChainProof('blissey', null, 'chansey');
    assert.equal(fromChansey.steps.length, 1);
    assert.equal(fromChansey.steps[0].method, 'friendship');
    assert.ok(fromChansey.friction < evolutionChainProof('blissey').friction);

    const fromBlissey = evolutionChainProof('blissey', null, 'blissey');
    assert.equal(fromBlissey.steps.length, 0);
    assert.equal(fromBlissey.friction, 0);

    // An off-chain input id must not truncate the walk.
    const offChain = evolutionChainProof('blissey', null, 'pikachu');
    assert.equal(offChain.steps.length, 2);
  });
});
