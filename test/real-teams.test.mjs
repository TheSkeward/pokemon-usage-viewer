// Fieldable real team (real-teams.js): the pure buildability + ranking pieces.
// Synthetic fixtures throughout — nothing here depends on team-index data
// files existing.
import test from 'node:test';
import assert from 'node:assert/strict';

await import('./helpers/harness.mjs'); // fetch → filesystem shim
const {
  assignAvailableMembersToLines,
  assignMembersToLines,
  compareRealTeams,
  findFieldableOrClosestRealTeam,
  findFieldableRealTeam,
  getLineFieldableIds,
  teamItemShortages,
  teamItemsCovered,
} = await import('../src/teamBuilder/real-teams.js');
const { renderRealTeamPanel } = await import(
  '../src/reborn/team-analysis-view.js',
);

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

test('partial assignment finds the true maximum instead of getting stuck', () => {
  // A first-free pass strands member 2 after seating members 0 and 1. An
  // augmenting path moves member 0 to line 1, freeing line 0 for member 2.
  const assigned = assignAvailableMembersToLines([
    [0, 1],
    [0, 2],
    [0, 2],
    [1, 3],
  ]);
  assert.equal(new Set(assigned).size, 4);
  assert.ok(assigned.every((lineIndex) => lineIndex !== null));
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
  assert.deepEqual(teamItemShortages(members, { leftovers: 1 }), [
    {
      itemId: 'leftovers',
      item: 'leftovers',
      needed: 2,
      owned: 1,
      missing: 1,
    },
  ]);
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

test('closest team reports distinct species, move, and item blockers', async () => {
  const popularButFar = makeTeam('popular', 100, 10, [
    'tauros',
    'dragonite',
    'pinsir',
    'heracross',
  ]);
  const closest = makeTeam('closest', 5, 1, [
    'tauros',
    'lapras',
    'staraptor',
    'heracross',
  ]);
  closest.members[0].item = 'Leftovers';
  closest.members[0].itemId = 'leftovers';
  closest.members[2].moves = ['Brave Bird'];
  closest.members[2].moveIds = ['bravebird'];

  const match = await findFieldableOrClosestRealTeam({
    teams: [popularButFar, closest],
    lines: [makeLine('tauros'), makeLine('lapras'), makeLine('starly', 'staraptor')],
    progression: { levelCap: '34', ownedItems: {} },
  });

  assert.equal(match.kind, 'closest');
  assert.equal(match.team.key, 'closest', 'species proximity beats popularity');
  assert.equal(match.matchedCount, 3);
  assert.equal(match.memberCount, 4);
  assert.deepEqual(
    match.members.map((member) => member.speciesAvailable),
    [true, true, true, false],
  );
  assert.deepEqual(match.members[2].missingMoves, [
    { id: 'bravebird', name: 'Brave Bird', index: 0 },
  ]);
  assert.deepEqual(match.missingItems, [
    {
      itemId: 'leftovers',
      item: 'Leftovers',
      needed: 1,
      owned: 0,
      missing: 1,
    },
  ]);
});

test('closest-team search ignores parser spill beyond six members', async () => {
  const malformed = makeTeam('spill', 999, 99, [
    'tauros',
    'lapras',
    'pinsir',
    'heracross',
    'skarmory',
    'dragonite',
    'notapokemon',
  ]);
  const valid = makeTeam('valid', 1, 1, [
    'tauros',
    'lapras',
    'pinsir',
    'heracross',
    'dragonite',
    'skarmory',
  ]);
  const match = await findFieldableOrClosestRealTeam({
    teams: [malformed, valid],
    lines: [makeLine('tauros')],
    progression: { levelCap: '100' },
  });
  assert.equal(match.kind, 'closest');
  assert.equal(match.team.key, 'valid');
});

test('closest-team panel stays visible and explains every blocker type', () => {
  const team = makeTeam('visible', 5, 2, [
    'tauros',
    'lapras',
    'staraptor',
    'heracross',
  ]);
  team.members[0].item = 'Leftovers';
  team.members[2].moves = ['Brave Bird'];
  const html = renderRealTeamPanel({
    dataAvailable: true,
    closestMatch: {
      team,
      matchedCount: 3,
      memberCount: 4,
      members: [
        { speciesAvailable: true, missingMoves: [] },
        { speciesAvailable: true, missingMoves: [] },
        {
          speciesAvailable: true,
          missingMoves: [{ id: 'bravebird', name: 'Brave Bird', index: 0 }],
        },
        { speciesAvailable: false, missingMoves: [] },
      ],
      missingItems: [
        { item: 'Leftovers', needed: 1, owned: 0, missing: 1 },
      ],
    },
  });

  assert.match(html, /Closest real team/);
  assert.match(html, /3\/4 Pokémon/);
  assert.match(html, /Missing Pokémon:<\/strong> heracross/);
  assert.match(html, /Moves unavailable now:<\/strong> staraptor: Brave Bird/);
  assert.match(html, /Held items still needed:<\/strong> Leftovers \(own 0\)/);
  assert.match(html, /Missing Pokémon<\/small>/);
  assert.match(html, /team-set-move unavailable/);
});
