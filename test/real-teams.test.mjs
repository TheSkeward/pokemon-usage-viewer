// Fieldable real team (realTeams.js): the pure buildability + ranking pieces.
// Synthetic fixtures throughout — nothing here depends on team-index data
// files existing.
import test from 'node:test';
import assert from 'node:assert/strict';

await import('./helpers/harness.mjs'); // fetch → filesystem shim
const {
  assignMembersToLines,
  compareRealTeams,
  findFieldableRealTeam,
  getLineFieldableIds,
  teamItemsCovered,
} = await import('../src/teamBuilder/realTeams.js');

function makeLine(inputPokemonId, pokemonId = inputPokemonId) {
  return {
    best: {
      inputPokemonId,
      inputName: inputPokemonId,
      pokemonId,
      name: pokemonId,
    },
    bestNonMega: null,
    choiceOptions: [],
  };
}

function makeMember(speciesId, { itemId = null, moveIds = [] } = {}) {
  return {
    species: speciesId,
    speciesId,
    item: itemId,
    itemId,
    ability: '',
    abilityId: '',
    nature: 'Serious',
    level: 50,
    evs: {},
    ivs: {},
    moves: [],
    moveIds,
  };
}

function makeTeam(key, weight, count, speciesIds) {
  return {
    key,
    weight,
    count,
    sources: { sample: count },
    formatId: 'gen7ou',
    members: speciesIds.map((id) => makeMember(id)),
  };
}

test('line can field input, current, and every delayed form between them', () => {
  const line = makeLine('starly', 'staraptor');

  const atFullCap = getLineFieldableIds(line, { levelCap: '100' });
  assert.ok(atFullCap.has('starly'), 'delaying evolution is always allowed');
  assert.ok(atFullCap.has('staravia'));
  assert.ok(atFullCap.has('staraptor'));

  const atLowCap = getLineFieldableIds(line, { levelCap: '20' });
  assert.ok(atLowCap.has('staravia'), 'current best-reachable at cap 20');
  assert.ok(!atLowCap.has('staraptor'), 'not reachable under the cap yet');
});

test('a devolved form is not fieldable without the daycare', () => {
  const evolvedInput = makeLine('staravia', 'staraptor');
  const ids = getLineFieldableIds(evolvedInput, { levelCap: '100' });
  assert.ok(ids.has('staravia'));
  assert.ok(ids.has('staraptor'));
  assert.ok(!ids.has('starly'), 'no daycare: devolving is not allowed');
});

test('daycare + hatchable line fields any family form (v21 rule)', () => {
  const evolvedInput = makeLine('staravia', 'staraptor');
  const ids = getLineFieldableIds(evolvedInput, {
    levelCap: '100',
    daycareUnlocked: true,
  });
  assert.ok(ids.has('starly'), 'hatch an egg and keep the hatchling unevolved');
  assert.ok(ids.has('staravia'));
  assert.ok(ids.has('staraptor'));

  // The hatchling still obeys the level cap on the way back up.
  const capped = getLineFieldableIds(evolvedInput, {
    levelCap: '20',
    daycareUnlocked: true,
  });
  assert.ok(capped.has('starly'));
  assert.ok(capped.has('staravia'), 'input form itself is always fieldable');
  assert.ok(!capped.has('staraptor'), 'level 34 evolution is out of cap reach');
});

test('assignment: one line covers at most one member, scarcest member seats first', () => {
  // Member 1 can only use line 0, so it must seat first even though member 0
  // (listed earlier) also wants line 0.
  assert.deepEqual(assignMembersToLines([[0, 1], [0]]), [1, 0]);

  // Two members both needing the same single line: no assignment exists.
  assert.equal(assignMembersToLines([[0], [0]]), null);
});

test('item gate aggregates counts across the whole team', () => {
  const members = [
    makeMember('a', { itemId: 'leftovers' }),
    makeMember('b', { itemId: 'leftovers' }),
    makeMember('c'), // no item always passes
  ];

  assert.equal(teamItemsCovered(members, { leftovers: 1 }), false);
  assert.equal(teamItemsCovered(members, { leftovers: 2 }), true);
  assert.equal(teamItemsCovered([makeMember('c')], {}), true);
});


test('findFieldableRealTeam returns the best FIELDABLE team, or null', async () => {
  const lines = [
    makeLine('tauros'),
    makeLine('lapras'),
    makeLine('pinsir'),
    makeLine('heracross'),
    makeLine('skarmory'),
  ];
  const progression = { levelCap: '100' };

  const unfieldable = makeTeam('unfieldable', 99, 9, [
    'dragonite',
    'lapras',
    'pinsir',
    'heracross',
  ]);
  const heavy = makeTeam('heavy', 10, 3, [
    'tauros',
    'lapras',
    'pinsir',
    'heracross',
  ]);
  const light = makeTeam('light', 2, 9, [
    'tauros',
    'lapras',
    'pinsir',
    'skarmory',
  ]);

  const picked = await findFieldableRealTeam({
    teams: [light, unfieldable, heavy],
    lines,
    progression,
    recommendedIds: new Set(['skarmory']),
  });
  assert.equal(picked.key, 'heavy', 'weight wins among fieldable teams');

  // Weight/count tie: similarity to the recommended team decides.
  const tieA = makeTeam('aaa', 5, 4, ['tauros', 'lapras', 'pinsir', 'heracross']);
  const tieB = makeTeam('bbb', 5, 4, ['tauros', 'lapras', 'pinsir', 'skarmory']);
  const pickedTie = await findFieldableRealTeam({
    teams: [tieA, tieB],
    lines,
    progression,
    recommendedIds: new Set(['skarmory']),
  });
  assert.equal(pickedTie.key, 'bbb');

  // An unmet item requirement blocks fielding outright.
  const needsItems = makeTeam('items', 50, 5, ['tauros', 'lapras', 'pinsir', 'heracross']);
  needsItems.members[0].itemId = 'leftovers';
  needsItems.members[1].itemId = 'leftovers';
  const pickedItems = await findFieldableRealTeam({
    teams: [needsItems],
    lines,
    progression: { ...progression, ownedItems: { leftovers: 1 } },
    recommendedIds: new Set(),
  });
  assert.equal(pickedItems, null, '1 owned Leftovers cannot cover 2 members');

  assert.equal(
    await findFieldableRealTeam({ teams: [], lines, progression }),
    null,
  );
});

test('moves gate: every listed move must be obtainable under the progression', async () => {
  const lines = [makeLine('starly', 'staraptor')];
  const team = makeTeam('birds', 5, 2, ['staraptor']);
  team.members[0].moveIds = ['bravebird'];

  // Brave Bird's earliest route is Starly@37 (delayed evolution), so at cap
  // 34 Staraptor is fieldable but the move is not obtainable yet.
  assert.equal(
    await findFieldableRealTeam({ teams: [team], lines, progression: { levelCap: '34' } }),
    null,
  );
  const picked = await findFieldableRealTeam({
    teams: [team],
    lines,
    progression: { levelCap: '45' },
  });
  assert.equal(picked?.key, 'birds');
});

test('moves gate honors the breeding context for egg moves', async () => {
  const lines = [makeLine('starly', 'staraptor')];
  const team = makeTeam('eggbirds', 5, 2, ['staraptor']);
  team.members[0].moveIds = ['doubleedge']; // egg-only on Staraptor
  const progression = { levelCap: '100', daycareUnlocked: true };

  assert.equal(
    await findFieldableRealTeam({ teams: [team], lines, progression }),
    null,
    'no breeding context: egg-only moves are not obtainable',
  );

  const picked = await findFieldableRealTeam({
    teams: [team],
    lines,
    progression,
    breedingContext: {
      byPokemonId: {
        staraptor: {
          moveIds: ['doubleedge'],
          sources: { doubleedge: { label: 'Egg', detail: 'test donor' } },
        },
      },
    },
  });
  assert.equal(picked?.key, 'eggbirds');
});
