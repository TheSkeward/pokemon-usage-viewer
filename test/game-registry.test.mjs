import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getActiveGame,
  getGame,
  listGames,
  setActiveGame,
} from '../src/games/registry.js';
import {
  buildGamestateExport,
  parseGamestateImport,
} from '../src/teamBuilder/gamestate-backup.js';

test('reborn is the default active game with its pre-registry keys intact', () => {
  const game = getActiveGame();
  assert.equal(game.id, 'reborn');
  // These literals are load-bearing: changing either one silently discards
  // every existing player's saved pool/progression or orphans deployed data.
  assert.equal(game.storage.progression, 'pokemon-usage-viewer:reborn-progression:v1');
  assert.equal(game.storage.pool, 'pokemon-usage-viewer:owned-pool:v1');
  assert.equal(game.data.legalMovesDir, 'reborn-legal-moves');
  assert.equal(getGame('reborn'), game);
  assert.ok(listGames().includes(game));
});

test('activating an unregistered game is an explicit error', () => {
  assert.throws(() => setActiveGame('rejuvenation'), /Unknown game/);
  assert.equal(getActiveGame().id, 'reborn');
});

test('gamestate backups are tagged with their game and legacy files read as reborn', () => {
  const exported = buildGamestateExport({
    query: 'Froakie',
    progression: { levelCap: '25' },
  });
  assert.equal(JSON.parse(exported).game, 'reborn');
  assert.equal(parseGamestateImport(exported).game, 'reborn');

  const legacy = JSON.stringify({
    format: 'pokemon-usage-viewer-gamestate',
    version: 1,
    pool: 'Froakie',
    progression: {},
  });
  assert.equal(parseGamestateImport(legacy).game, 'reborn');
});
