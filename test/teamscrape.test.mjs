// Team-scrape pipeline units: the Showdown paste parser, replay-log
// composition extraction, and the two derived-index builders, all on
// synthetic fixtures (the real archives are CI-harvested).
import test from 'node:test';
import assert from 'node:assert/strict';

const { parseShowdownTeam, parseShowdownSet } = await import(
  '../scripts/teamscrape/parseShowdownTeam.mjs',
);
const { parseReplayTeams, toTeamSheetId } = await import(
  '../scripts/teamscrape/replayLog.mjs',
);
const { buildObservedSetIndex } = await import(
  '../scripts/build-observed-sets.mjs',
);
const { collectCompositions, buildCoreIndex } = await import(
  '../scripts/build-core-index.mjs',
);

const PASTE = `=== [gen7ou] Sample ===

Landorus-Therian (M) @ Rocky Helmet
Ability: Intimidate
EVs: 252 HP / 240 Def / 16 Spe
Impish Nature
- Stealth Rock
- Earthquake
- U-turn
- Hidden Power [Ice]

Chansey (F) @ Eviolite
Ability: Natural Cure
Level: 97
EVs: 4 HP / 252 Def / 252 SpD
Bold Nature
IVs: 0 Atk
- Soft-Boiled
- Toxic
- Seismic Toss
- Stealth Rock

garbage block without any set shape
that should be dropped not fatal`;

test('parseShowdownTeam reads sets, tolerates junk blocks', () => {
  const { sets, dropped, format } = parseShowdownTeam(PASTE);
  assert.equal(format, 'gen7ou'); // read from the === header
  assert.equal(sets.length, 2);
  assert.equal(dropped, 1);
  const lando = sets[0];
  assert.equal(lando.speciesId, 'landorustherian');
  assert.equal(lando.itemId, 'rockyhelmet');
  assert.equal(lando.abilityId, 'intimidate');
  assert.equal(lando.nature, 'Impish');
  assert.deepEqual(lando.evs, { hp: 252, def: 240, spe: 16 });
  assert.equal(lando.moveIds[3], 'hiddenpowerice');
  const chansey = sets[1];
  assert.equal(chansey.level, 97);
  assert.deepEqual(chansey.ivs, { atk: 0 });
});

test('header variants: nickname, gender, itemless', () => {
  assert.equal(
    parseShowdownSet('Big Bird (Zapdos) @ Leftovers\n- Roost').speciesId,
    'zapdos',
  );
  assert.equal(parseShowdownSet('Mimikyu (F)\n- Play Rough').speciesId, 'mimikyu');
  assert.equal(parseShowdownSet('Mimikyu (F)\n- Play Rough').item, null);
});

test('replay teams: poke lines union switch reveals, forms collapse', () => {
  const log = [
    '|poke|p1|Mawile, F|item',
    '|poke|p1|Skuntank, M|',
    '|poke|p2|Yanmega, M|',
    '|switch|p1a: May|Mawile-Mega, F|100/100',
    '|switch|p2a: Zoro|Zoroark, M|100/100',
  ].join('\n');
  const [p1, p2] = parseReplayTeams(log);
  assert.deepEqual(p1.map(toTeamSheetId).sort(), ['mawile', 'mawile', 'skuntank']);
  assert.deepEqual(p2, ['yanmega', 'zoroark']);
  assert.equal(toTeamSheetId('yanmega'), 'yanmega');
  assert.equal(toTeamSheetId('charizardmegax'), 'charizard');
});

const SAMPLE_TEAMS = [
  {
    format: 'gen7ou',
    sets: [
      {
        speciesId: 'skuntank', species: 'Skuntank', itemId: 'blacksludge',
        item: 'Black Sludge', abilityId: 'aftermath', ability: 'Aftermath',
        nature: 'Adamant', evs: { hp: 252, atk: 252 },
        moves: ['Crunch', 'Poison Jab', 'Sucker Punch', 'Taunt'],
        moveIds: ['crunch', 'poisonjab', 'suckerpunch', 'taunt'],
      },
    ],
  },
  {
    format: 'gen7ou',
    sets: [
      {
        speciesId: 'skuntank', species: 'Skuntank', itemId: 'blacksludge',
        item: 'Black Sludge', abilityId: 'aftermath', ability: 'Aftermath',
        nature: 'Adamant', evs: { hp: 252, atk: 252 },
        moves: ['Crunch', 'Poison Jab', 'Sucker Punch', 'Taunt'],
        moveIds: ['crunch', 'poisonjab', 'suckerpunch', 'taunt'],
      },
    ],
  },
  { format: 'gen9ou', sets: [{ speciesId: 'x', moveIds: ['a'] }] },
];

test('observed-set index dedups identical sets and skips unknown formats', () => {
  const byFamily = buildObservedSetIndex(SAMPLE_TEAMS);
  assert.deepEqual([...byFamily.keys()], ['singles']);
  const detail = byFamily.get('singles').get('skuntank');
  assert.equal(detail.sets.length, 1);
  assert.equal(detail.sets[0].count, 2);
  assert.equal(detail.sets[0].item, 'Black Sludge');
});

test('core index: symmetric lift, min pair support, quality weighting', () => {
  const replays = [
    { format: 'gen7uu', rating: 1800, teams: [['aggron', 'blissey', 'crobat'], ['aggron', 'blissey', 'crobat']] },
    { format: 'gen7uu', rating: null, teams: [['aggron', 'crobat', 'emolga'], ['blissey', 'dugtrio', 'flygon']] },
  ];
  const byFamily = collectCompositions({ replays, samples: [] });
  const index = buildCoreIndex(byFamily.get('singles'));
  const aggron = index.get('aggron');
  // aggron+blissey: 1.0 per side of the 1760+ replay = 2.0, at the pair
  // floor. Symmetric across both files.
  assert.equal(aggron.partners.blissey.count, 2);
  assert.equal(index.get('blissey').partners.aggron.lift, aggron.partners.blissey.lift);
  // emolga only appears in the unrated mixture (0.005/pair) — floored out.
  assert.equal(index.get('emolga'), undefined);
  assert.ok(aggron.trios.length >= 1);
});


const { htmlToText, extractThreadRows, extractFirstPostText } = await import(
  '../scripts/scrape-rmt-teams.mjs',
);

test('rmt: listing rows carry prefixes, first post yields inline sets', () => {
  const listing = `
    <span class="label label--primary">SM OU</span>
    <a href="/threads/my-cool-team.3651234/" data-preview-url="/threads/3651234/preview">My cool team</a>
    <a href="/threads/unlabeled-thread.999/" data-preview-url="x">No prefix</a>`;
  const rows = extractThreadRows(listing, 'https://www.smogon.com/forums/');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].prefix, 'SM OU');
  assert.equal(rows[0].threadId, '3651234');
  assert.equal(rows[1].prefix, null);

  const post = `<article class="message-body js-selectToQuote"><div class="bbWrapper">
    Skuntank @ Black Sludge<br>Ability: Aftermath<br>Adamant Nature<br>- Crunch<br>- Poison Jab
  </div></article>`;
  const { sets } = parseShowdownTeam(extractFirstPostText(post));
  assert.equal(sets.length, 1);
  assert.equal(sets[0].speciesId, 'skuntank');
  assert.equal(htmlToText('a &amp; b<br>c'), 'a & b\nc');
});


const { WEIGHTS, replayWeight, teamWeight } = await import(
  '../scripts/teamscrape/weights.mjs',
);
const { replayLinkFormat, extractReplayIds } = await import(
  '../scripts/scrape-tournament-teams.mjs',
);

test('weight ladder: bands, tournament override, unrated-mixture inversion', () => {
  assert.equal(replayWeight({ rating: null }), WEIGHTS.unrated_replay);
  assert.equal(replayWeight({ rating: 1400 }), WEIGHTS.rated_below_1500);
  assert.ok(replayWeight({ rating: null }) > replayWeight({ rating: 1400 }));
  assert.equal(replayWeight({ rating: 1630 }), 0.2);
  assert.equal(replayWeight({ rating: 1900 }), 1.0);
  assert.equal(replayWeight({ rating: null, source: 'tournament' }), 60);
  assert.equal(teamWeight({ source: 'rmt' }), 5);
  assert.equal(teamWeight({ source: 'tournament' }), 60);
  assert.equal(teamWeight({}), 1000);
});

test('tournament: replay-link format attribution incl. smogtours ids', () => {
  assert.equal(replayLinkFormat('gen7ou-967241'), 'gen7ou');
  assert.equal(replayLinkFormat('smogtours-gen7uu-406712'), 'gen7uu');
  assert.equal(replayLinkFormat('gen9ou-1'), null); // untracked format
  assert.deepEqual(
    extractReplayIds(
      '<a href="https://replay.pokemonshowdown.com/smogtours-gen7ou-1234">g1</a> replay.pokemonshowdown.com/smogtours-gen7ou-1234 x',
    ),
    ['smogtours-gen7ou-1234'],
  );
});

