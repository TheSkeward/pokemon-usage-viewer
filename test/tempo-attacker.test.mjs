import assert from 'node:assert/strict';
import test from 'node:test';

import {
  currentFormFeatures,
  currentFormValue,
  hasReliableTempoRamp,
  hasSpeedBoostTempo,
} from '../src/teamBuilder/current-form-value.js';
import { buildRebornTeamAnalysis } from '../src/reborn/team-analysis.js';
import { progressionAt, runPool } from './helpers/harness.mjs';

const attack = (name, estimatedDamage) => ({
  id: name.toLowerCase().replaceAll(' ', ''),
  name,
  category: 'Physical',
  estimatedDamage,
  roles: [],
  accuracy: 100,
});

const protect = {
  id: 'protect',
  name: 'Protect',
  category: 'Status',
  priority: 4,
  roles: [],
  accuracy: 100,
};

function profile({
  assumedAbility = 'Speed Boost',
  preMegaAbility = null,
  moves = [attack('Flare Blitz', 280), attack('Superpower', 240), protect],
} = {}) {
  const damaging = moves.filter((move) => move.category !== 'Status');
  return {
    currentId: 'blaziken',
    currentTypes: ['Fire', 'Fighting'],
    assumedAbility,
    preMegaAbility,
    bestDamagingMove: damaging[0] || null,
    bestStabMove: damaging[0] || null,
    recommendedDamagingMoveCount: damaging.length,
    recommendedMoves: moves,
  };
}

test('Speed Boost exposes post-turn speed and Protect completes the tempo ramp', () => {
  const speedBoost = profile();
  const features = currentFormFeatures(speedBoost, 100);
  const value = currentFormValue(speedBoost, 100);

  assert.equal(hasSpeedBoostTempo(speedBoost), true);
  assert.equal(hasReliableTempoRamp(speedBoost), true);
  assert.ok(features.tempoSpeedQ > features.speedQ);
  assert.equal(features.tempoReliabilityQ, 1);
  assert.equal(value.bestRole, 'tempo_attacker');
  assert.ok(value.value <= 2000);
});

test('Protect alone is neither tempo nor priority utility', () => {
  const ordinary = profile({ assumedAbility: 'Blaze' });
  const value = currentFormValue(ordinary, 100);

  assert.equal(hasSpeedBoostTempo(ordinary), false);
  assert.equal(hasReliableTempoRamp(ordinary), false);
  assert.equal(value.features.tempoSpeedQ, 0);
  assert.equal(value.features.tempoReliabilityQ, 0);
  assert.equal(value.features.priorityUtilityQ, 0);
  assert.equal(value.roles.tempo_attacker, 0);
});

test('Speed Boost still has earned tempo without a protected ramp', () => {
  const unprotected = profile({
    moves: [attack('Flare Blitz', 280), attack('Superpower', 240)],
  });
  const value = currentFormValue(unprotected, 100);

  assert.equal(hasSpeedBoostTempo(unprotected), true);
  assert.equal(hasReliableTempoRamp(unprotected), false);
  assert.ok(value.features.tempoSpeedQ > value.features.speedQ);
  assert.equal(value.features.tempoReliabilityQ, 0);
  assert.ok(value.roles.tempo_attacker < 1);
});

test('Speed Boost can come from either side of Mega Evolution', () => {
  const sharpedoPath = profile({
    assumedAbility: 'Strong Jaw',
    preMegaAbility: 'Speed Boost',
  });
  const blazikenPath = profile({
    assumedAbility: 'Speed Boost',
    preMegaAbility: 'Blaze',
  });

  assert.equal(hasReliableTempoRamp(sharpedoPath), true);
  assert.equal(hasReliableTempoRamp(blazikenPath), true);
});

test('real Mega Sharpedo uses its battle form and preserves caught-ability sensitivity', async () => {
  const progression = progressionAt({ badge: 18, levelCap: 100 });
  const result = await runPool({
    pool: ['Sharpedo'],
    progression,
  });
  const mega = result.lines[0].choiceOptions.find(
    (choice) => choice.pokemonId === 'sharpedomega',
  );

  assert.ok(mega);
  assert.equal(mega.legalityProfile.currentId, 'sharpedomega');
  assert.equal(mega.legalityProfile.fieldedId, 'sharpedo');
  assert.equal(mega.legalityProfile.megaReady, true);
  assert.equal(mega.legalityProfile.assumedAbility, 'Strong Jaw');
  assert.equal(mega.legalityProfile.preMegaAbility, 'Speed Boost');
  assert.equal(mega.currentRole, 'tempo_attacker');
  assert.ok(mega.abilitySensitivity > 0);

  const analysis = await buildRebornTeamAnalysis(result.team, progression, {
    family: 'singles',
    selection: 'all',
    lines: result.lines,
  });
  const shown = analysis.profiles[0];
  assert.equal(shown.currentId, 'sharpedomega');
  assert.equal(shown.fieldedId, 'sharpedo');
  assert.equal(shown.assumedAbility, 'Strong Jaw');
  assert.equal(shown.preMegaAbility, 'Speed Boost');
  assert.equal(shown.recommendedSet.species, 'Sharpedo-Mega');
});

test('a Mega candidate cannot borrow its battle form before the base evolves', async () => {
  const result = await runPool({
    pool: ['Carvanha'],
    badge: 1,
    levelCap: 20,
  });
  const megaCandidate = result.lines[0].choiceOptions.find(
    (choice) => choice.pokemonId === 'sharpedomega',
  );

  assert.ok(megaCandidate);
  assert.equal(megaCandidate.legalityProfile.currentId, 'carvanha');
  assert.equal(megaCandidate.legalityProfile.fieldedId, 'carvanha');
  assert.equal(megaCandidate.legalityProfile.megaReady, false);
  assert.equal(megaCandidate.legalityProfile.preMegaAbility, null);
});
