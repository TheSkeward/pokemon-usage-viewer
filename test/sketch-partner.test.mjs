import test from 'node:test';
import assert from 'node:assert/strict';

const { loadShared, progressionAt } = await import('./helpers/harness.mjs');
const {
  applyBreedingContextToProgression,
} = await import('../src/reborn/breeding.js');
const {
  getAvailableRebornMoves,
  loadRebornLegalMoveData,
} = await import('../src/reborn/legal-moves.js');
const {
  applySketchContextToProgression,
  buildRebornMoveTransferContexts,
} = await import('../src/reborn/sketch.js');
const { buildCandidateLegalityProfile } = await import(
  '../src/reborn/team-analysis.js',
);

async function smeargleMoves({ pokemonIndex, progression, query }) {
  const { breedingContext, sketchContext } =
    await buildRebornMoveTransferContexts({
      pokemonIndex,
      progression,
      query,
    });
  const memberProgression = applySketchContextToProgression(
    applyBreedingContextToProgression(
      progression,
      'smeargle',
      breedingContext,
    ),
    'smeargle',
    sketchContext,
  );
  const data = await loadRebornLegalMoveData('smeargle');
  return getAvailableRebornMoves(data, memberProgression);
}

test('Sketch requires another pool mon that can currently use the move', async () => {
  const { pokemonIndex } = await loadShared();
  const beforeSpore = progressionAt({ badge: 1, levelCap: 21 });
  const atSpore = progressionAt({ badge: 1, levelCap: 22 });

  assert.equal(beforeSpore.daycareUnlocked, false);
  assert.equal(
    (await smeargleMoves({
      pokemonIndex,
      progression: beforeSpore,
      query: 'Smeargle\nParas',
    })).some((move) => move.id === 'spore'),
    false,
    'Paras has not learned Spore yet',
  );
  assert.equal(
    (await smeargleMoves({
      pokemonIndex,
      progression: atSpore,
      query: 'Smeargle',
    })).some((move) => move.id === 'spore'),
    false,
    'Smeargle cannot bootstrap a move from its own theoretical Sketch pool',
  );

  const moves = await smeargleMoves({
    pokemonIndex,
    progression: atSpore,
    query: 'Smeargle\nParas',
  });
  const spore = moves.find((move) => move.id === 'spore');
  assert.ok(spore, 'Paras at level 22 makes Spore sketchable without daycare');
  const source = spore.availableSources.find(
    (entry) => entry.kind === 'sketch',
  );
  assert.equal(source?.partnerId, 'paras');
  assert.equal(source?.label, 'Sketch via Paras');
  assert.match(source?.sourceTitle || '', /Double Battle/);

  const profile = buildCandidateLegalityProfile({
    member: { id: 'smeargle', name: 'Smeargle', types: ['Normal'] },
    moves: [spore],
    levelCap: '22',
    moveUsage: new Map([['spore', 100]]),
  });
  assert.equal(profile.recommendedMoves[0]?.name, 'Spore');
  assert.match(profile.recommendedMoves[0]?.sourceLabel || '', /Sketch via Paras/);
});

test('partner-backed Sketch can feed a later breeding route', async () => {
  const { pokemonIndex } = await loadShared();
  const progression = {
    ...progressionAt({ badge: 18, levelCap: 100 }),
    daycareUnlocked: true,
  };
  const { breedingContext, sketchContext } =
    await buildRebornMoveTransferContexts({
      pokemonIndex,
      progression,
      query: 'Smeargle\nAlomomola\nEevee',
    });

  assert.equal(
    sketchContext.byPokemonId.smeargle.sources.wish.partnerId,
    'alomomola',
    'Sketch crosses the incompatible Water/Field egg-group boundary',
  );
  assert.ok(breedingContext.byPokemonId.eevee.moveIds.includes('wish'));
  assert.equal(
    breedingContext.byPokemonId.eevee.sources.wish.donorName,
    'Smeargle',
    'the sketched move can then follow ordinary egg-group rules',
  );
});
