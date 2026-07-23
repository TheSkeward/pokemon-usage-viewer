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
  buildRebornSketchContext,
  buildRebornMoveTransferContexts,
} = await import('../src/reborn/sketch.js');
const {
  buildCandidateLegalityProfile,
  buildRebornTeamAnalysis,
} = await import(
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

test('a compatible donor beats the extra, costlier Smeargle transfer',
  async () => {
    const { pokemonIndex } = await loadShared();
    const progression = {
      ...progressionAt({ badge: 5, levelCap: 50 }),
      daycareUnlocked: true,
    };
    const { breedingContext } = await buildRebornMoveTransferContexts({
      pokemonIndex,
      progression,
      query: 'Eevee\nSmeargle\nNatu\nMunna',
    });

    const synchronoise =
      breedingContext.byPokemonId.eevee.sources.synchronoise;
    assert.equal(synchronoise.donorName, 'Munna');
    assert.equal(synchronoise.detail, 'Munna breeding chain (@25)');
    assert.equal(
      breedingContext.byPokemonId.eevee.sources.wish.donorName,
      'Smeargle',
      'Smeargle remains valid when the source cannot breed with Eevee',
    );
  });

test('Sketch prices evolution levels and lists distinct alternative routes',
  async () => {
    const { pokemonIndex } = await loadShared();
    const progression = progressionAt({ badge: 5, levelCap: 50 });
    const query = 'Smeargle\nAipom\nVenipede';
    const { breedingContext, sketchContext } =
      await buildRebornMoveTransferContexts({
        pokemonIndex,
        progression,
        query,
      });

    const batonPass = sketchContext.byPokemonId.smeargle.sources.batonpass;
    assert.equal(
      batonPass.partnerId,
      'aipom',
      'Aipom@11 beats Scolipede evolution@30',
    );
    assert.equal(batonPass.partnerLevel, 11);
    assert.equal(batonPass.partnerInputId, 'aipom');
    assert.match(batonPass.sourceTitle, /Other pool routes: Scolipede — On evolution/);

    const preferred = await buildRebornSketchContext({
      pokemonIndex,
      progression,
      query,
      breedingContext,
      preferredPartnerIds: new Set(['scolipede']),
      preferredMoveIdsByPartnerId: new Map([
        ['scolipede', new Set(['batonpass'])],
      ]),
    });
    const preferredBatonPass =
      preferred.byPokemonId.smeargle.sources.batonpass;
    assert.equal(preferredBatonPass.partnerId, 'scolipede');
    assert.equal(preferredBatonPass.partnerLevel, 30);
    assert.equal(preferredBatonPass.partnerInputId, 'venipede');
    assert.match(preferredBatonPass.sourceTitle, /Other pool routes: Aipom — Level 11/);
  });

test('team analysis prefers a selected partner already carrying the move',
  async () => {
    const { pokemonIndex } = await loadShared();
    const progression = progressionAt({ badge: 5, levelCap: 50 });
    const analysis = await buildRebornTeamAnalysis(
      [
        {
          pokemonId: 'smeargle',
          inputPokemonId: 'smeargle',
          name: 'Smeargle',
          inputName: 'Smeargle',
        },
        {
          pokemonId: 'scolipede',
          inputPokemonId: 'venipede',
          name: 'Scolipede',
          inputName: 'Venipede',
        },
      ],
      progression,
      {
        family: 'singles',
        selection: 'all',
        pokemonIndex,
        query: 'Smeargle\nAipom\nVenipede',
      },
    );
    const smeargle = analysis.profiles.find(
      (profile) => profile.currentId === 'smeargle',
    );
    const batonPass = smeargle.recommendedMoves.find(
      (move) => move.id === 'batonpass',
    );
    assert.equal(
      batonPass.availableSources.find((source) => source.kind === 'sketch')
        .partnerId,
      'scolipede',
    );
    assert.match(batonPass.sourceTitle, /Other pool routes: Aipom — Level 11/);
    assert.ok(
      !(smeargle.donorInterimGuides || []).some(
        (guide) => guide.donorId === 'scolipede',
      ),
      'a Sketch partner on the selected team is not an interim donor',
    );
  });

test('off-team leveled Sketch partners receive interim donor guides',
  async () => {
    const { pokemonIndex } = await loadShared();
    const analysis = await buildRebornTeamAnalysis(
      [{
        pokemonId: 'smeargle',
        inputPokemonId: 'smeargle',
        name: 'Smeargle',
        inputName: 'Smeargle',
      }],
      progressionAt({ badge: 5, levelCap: 50 }),
      {
        family: 'singles',
        selection: 'all',
        pokemonIndex,
        query: 'Smeargle\nAipom\nVenipede\nFoongus\nSurskit',
      },
    );
    const smeargle = analysis.profiles.find(
      (profile) => profile.currentId === 'smeargle',
    );
    const guides = smeargle.donorInterimGuides || [];
    const aipom = guides.find((guide) => guide.donorId === 'aipom');
    assert.ok(aipom, 'Aipom is temporary when only Smeargle makes the team');
    assert.equal(aipom.interimLevelCap, 10);
    assert.deepEqual(
      aipom.forMoves.map((move) => move.name),
      ['Baton Pass'],
    );
    assert.ok(
      !aipom.moves.some((move) => move.name === 'Baton Pass'),
      'the guide stops before Aipom learns the move it will supply',
    );
    assert.ok(
      !guides.some((guide) =>
        guide.forMoves.some((move) => move.name === 'Substitute'),
      ),
      'an immediately teachable TM route is not an interim leveling donor',
    );
  });
