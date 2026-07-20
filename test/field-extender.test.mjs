// The field-extender (Amplifield Rock) borrowed-prior signal: owning the
// Reborn-original duration extender scales a build's field-setting move's
// utility contribution by 1 + FIELD_EXTENDER_UTILITY_BONUS (measured from the
// Light Clay | screens conditional propensity — see scoringConstants). The
// bonus exists ONLY because the item is outside the usage prior's universe;
// mainline extenders are already priced into their holders' ranks.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.__ENV__ ??= { BASE_URL: '/' };
const { utilityValue, FIELD_SETTING_MOVE_IDS, currentFormFeatures } =
  await import('../src/teamBuilder/currentFormValue.js');
const { SCORING_DEFAULTS } = await import(
  '../src/teamBuilder/scoringConstants.js',
);
const { withFieldExtenderCandidate, assignTeamItems, teamMemberKey } =
  await import('../src/teamBuilder/itemRecommendations.js');

const terrainMove = {
  id: 'electricterrain',
  name: 'Electric Terrain',
  category: 'Status',
  roles: ['setup'],
  accuracy: 100,
};
const recoveryMove = {
  id: 'recover',
  name: 'Recover',
  category: 'Status',
  roles: ['recovery'],
  accuracy: 100,
};

test("extender ownership scales exactly the field-setting move's contribution", () => {
  const moves = [terrainMove, recoveryMove];
  const base = utilityValue(moves, false);
  const boosted = utilityValue(moves, true);
  const terrainAlone = utilityValue([terrainMove], false);
  const expected =
    base + terrainAlone * SCORING_DEFAULTS.FIELD_EXTENDER_UTILITY_BONUS;
  assert.ok(Math.abs(boosted - expected) < 1e-12);
  assert.equal(utilityValue([recoveryMove], true), utilityValue([recoveryMove], false));
});


test('all four terrain moves and nothing else are field-setting', () => {
  assert.deepEqual(
    [...FIELD_SETTING_MOVE_IDS].sort(),
    ['electricterrain', 'grassyterrain', 'mistyterrain', 'psychicterrain'],
  );
});

test('the rock is injected, weighted by setter share, and assigned to the setter', () => {
  const setter = { inputPokemonId: 'a', pokemonId: 'a' };
  const other = { inputPokemonId: 'b', pokemonId: 'b' };
  const setterKey = teamMemberKey(setter);
  const itemContext = new Map([
    [setterKey, { fieldSetterShare: 0.5 }],
    [teamMemberKey(other), { fieldSetterShare: 0 }],
  ]);
  const usageByMember = new Map([
    [
      setterKey,
      withFieldExtenderCandidate(
        [{ id: 'leftovers', name: 'Leftovers', weight: 0.3 }],
        0.5,
      ),
    ],
    [
      teamMemberKey(other),
      withFieldExtenderCandidate(
        [{ id: 'leftovers', name: 'Leftovers', weight: 0.6 }],
        0,
      ),
    ],
  ]);
  const assignments = assignTeamItems({
    team: [setter, other],
    usageByMember,
    ownedItems: { amplifieldrock: 1, leftovers: 1 },
    itemContext,
  });
  // Setter's rock candidate weighs 0.8 × 0.5 = 0.4 > its Leftovers 0.3.
  assert.equal(assignments[setterKey]?.id, 'amplifieldrock');
  assert.equal(assignments[teamMemberKey(other)]?.id, 'leftovers');
  // A non-setter never gets the rock, even as a leftover fallback.
  const fallbackOnly = assignTeamItems({
    team: [other],
    usageByMember: new Map([[teamMemberKey(other), []]]),
    ownedItems: { amplifieldrock: 1 },
    itemContext,
  });
  assert.equal(fallbackOnly[teamMemberKey(other)], undefined);
});
