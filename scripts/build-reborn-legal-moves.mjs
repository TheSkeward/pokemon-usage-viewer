/**
 * @fileoverview Builds per-Pokémon Reborn legal-move files from Reborn's own
 * learnsets (scripts/reborn/reborn-learnsets.generated.json, decompiled from
 * the game's mons.dat) rather than mainline {@code @pkmn/dex}. Reborn is the
 * authoritative source for the game this tool targets, and it diverges from
 * mainline (e.g. Bibarel's evolution move is Water Gun in Reborn, Aqua Jet in
 * USUM). Reborn also encodes the evolution move explicitly as a level-0 entry,
 * so no heuristic is needed.
 *
 * {@code @pkmn/dex} is still used for species relationships (pre-evolution
 * chains, types) and to validate move ids; only the learnset *content* comes
 * from Reborn.
 */

import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Dex } from '@pkmn/dex';
import {
  REBORN_TM_OPTIONS,
  REBORN_TMX_OPTIONS,
  REBORN_TUTOR_OPTIONS,
} from '../src/reborn/progressionOptions.js';

const projectRoot = process.cwd();
const dataDir = path.join(projectRoot, 'site-data', 'data');
const outputDir = path.join(dataDir, 'reborn-legal-moves', 'all');
const dex = Dex.forGen(7);
const toId = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

const rebornTmMoveIds = new Set(REBORN_TM_OPTIONS.map((o) => toId(o.move)));
const rebornTmxMoveIds = new Set(REBORN_TMX_OPTIONS.map((o) => toId(o.move)));
const rebornTutorMoveIds = new Set(REBORN_TUTOR_OPTIONS.map((o) => toId(o.move)));

// Reborn code-grants the universal TMs (UNIVERSAL_TM_MOVES below) instead of
// listing them per species: they are the Reborn TMs that appear in 0 species'
// compatible-moves lists (the next-rarest TM appears in 8). These species are
// the exceptions that must NOT receive them: their machine list is empty or,
// like Wobbuffet's Safeguard, entirely explicit in the per-species data.
const NO_UNIVERSAL_TM_SPECIES = new Set([
  'caterpie', 'metapod', 'weedle', 'kakuna', 'magikarp', 'ditto', 'unown',
  'wobbuffet', 'wurmple', 'silcoon', 'cascoon', 'wynaut', 'smeargle',
  'beldum', 'kricketot', 'combee', 'tynamo',
]);

const UNIVERSAL_TM_MOVES = new Set(
  [
    'toxic', 'hiddenpower', 'facade', 'attract', 'substitute', 'frustration',
    'protect', 'round', 'confide', 'sleeptalk', 'swagger', 'return',
    'doubleteam', 'rest', 'secretpower',
  ].filter((id) => rebornTmMoveIds.has(id)),
);

// Mew learns every TM and tutor move by a code rule (its compatible list is
// empty in the data).
const LEARNS_ALL_MACHINES = new Set(['mew']);

// Sketch copies any move ever used in battle, so Smeargle's practical legal
// pool is the entire Reborn move universe, at any level. Gen 7 exceptions:
// Chatter and Struggle cannot be sketched.
const UNSKETCHABLE_MOVES = new Set(['chatter', 'struggle']);

const { learnsets } = JSON.parse(
  readFileSync(
    path.join(projectRoot, 'scripts', 'reborn', 'reborn-learnsets.generated.json'),
    'utf8',
  ),
);
const pokemonIndex = JSON.parse(
  readFileSync(path.join(dataDir, 'pokemon-index.json'), 'utf8'),
);

// The sketchable universe: every move that exists anywhere in Reborn's data
// (any learnset, machine, or tutor), minus the unsketchables.
const SKETCH_UNIVERSE = new Set([
  ...rebornTmMoveIds,
  ...rebornTmxMoveIds,
  ...rebornTutorMoveIds,
]);
for (const learnset of Object.values(learnsets)) {
  for (const [, moveId] of learnset.levelUp) SKETCH_UNIVERSE.add(moveId);
  for (const moveId of learnset.evolutionMoves) SKETCH_UNIVERSE.add(moveId);
  for (const moveId of learnset.eggMoves) SKETCH_UNIVERSE.add(moveId);
  for (const moveId of learnset.relearnerMoves) SKETCH_UNIVERSE.add(moveId);
  for (const moveId of learnset.compatibleMoves) SKETCH_UNIVERSE.add(moveId);
}
for (const moveId of UNSKETCHABLE_MOVES) SKETCH_UNIVERSE.delete(moveId);

await fs.rm(outputDir, { recursive: true, force: true });
await fs.mkdir(outputDir, { recursive: true });

let written = 0;
for (const pokemon of pokemonIndex) {
  const learnset = learnsets[pokemon.id];
  if (!learnset) continue;

  const species = dex.species.get(pokemon.id);
  const preEvolutionIds = getPreEvolutionIds(pokemon.id);

  const sourcesByMove = new Map();
  const get = (moveId) => {
    if (!sourcesByMove.has(moveId)) {
      sourcesByMove.set(moveId, {
        levelUp: [],
        tm: false,
        tmx: false,
        tutor: false,
        egg: false,
      });
    }
    return sourcesByMove.get(moveId);
  };

  // A level-1 block longer than four entries contains relists: Essentials
  // gives a level-1 mon only the LAST four moves of its ≤1 learnset, so head
  // entries (conventionally the relearner catalog) are never actually known
  // at level 1. Those entries become a levelOneRelist flag (move-relearner
  // route) instead of a phantom "Level 1" source; a later natural level for
  // the same move is unaffected.
  const ownRelists = levelOneRelistIds(learnset);
  for (const [level, moveId] of learnset.levelUp) {
    if (level === 1 && ownRelists.has(moveId)) {
      get(moveId).levelOneRelist = true;
      continue;
    }
    get(moveId).levelUp.push(level);
  }
  for (const moveId of learnset.evolutionMoves) get(moveId).evolutionMove = true;
  for (const moveId of learnset.eggMoves) get(moveId).egg = true;
  for (const moveId of learnset.relearnerMoves) get(moveId).rebornRelearner = true;

  // TM/TMX/tutor legality. A move qualifies when Reborn distributes it as that
  // kind of teacher AND the mon can learn it: either it's on the mon's own
  // compatible-moves list, or it's a universally code-granted TM (for mons with
  // a real movepool), or the mon learns everything (Mew).
  const compatible = new Set(learnset.compatibleMoves);
  const learnsAll = LEARNS_ALL_MACHINES.has(pokemon.id);
  const intrinsic = new Set([
    ...learnset.levelUp.map(([, m]) => m),
    ...learnset.evolutionMoves,
    ...learnset.eggMoves,
    ...learnset.compatibleMoves,
  ]);
  const learnsUniversalTms =
    intrinsic.size > 2 && !NO_UNIVERSAL_TM_SPECIES.has(pokemon.id);

  for (const moveId of rebornTmMoveIds) {
    if (
      learnsAll ||
      compatible.has(moveId) ||
      (learnsUniversalTms && UNIVERSAL_TM_MOVES.has(moveId))
    ) {
      get(moveId).tm = true;
    }
  }
  for (const moveId of rebornTmxMoveIds) {
    if (learnsAll || compatible.has(moveId)) get(moveId).tmx = true;
  }
  for (const moveId of rebornTutorMoveIds) {
    if (learnsAll || compatible.has(moveId)) get(moveId).tutor = true;
  }

  // Egg moves inherit through evolution, and a level-up move a pre-evolution
  // learns is reachable before evolving — both pulled from the pre-evolutions'
  // Reborn learnsets.
  const preEvoLevelUp = new Map();
  for (const preEvoId of preEvolutionIds) {
    const preLearnset = learnsets[preEvoId];
    if (!preLearnset) continue;
    for (const moveId of preLearnset.eggMoves) get(moveId).egg = true;
    // A pre-evo's own head-of-block relists must not be inherited as real
    // @1 entries either — but they stay relearner-teachable on this line
    // (relearn on the pre-evo, then evolve), so they carry the same flag.
    const preRelists = levelOneRelistIds(preLearnset);
    for (const [level, moveId] of preLearnset.levelUp) {
      if (level === 1 && preRelists.has(moveId)) {
        get(moveId).levelOneRelist = true;
        continue;
      }
      if (!preEvoLevelUp.has(moveId)) preEvoLevelUp.set(moveId, []);
      // Attributed: WHICH ancestor learns it decides which evolution must be
      // delayed (Slaking's Play Rough is Slakoth@38 — delay Slakoth — while
      // its Focus Punch is Vigoroth@37 — delay Vigoroth).
      preEvoLevelUp.get(moveId).push({ level, from: preEvoId });
    }
  }
  // A move only a pre-evolution learns still needs a sourcesByMove entry:
  // the output loop iterates sourcesByMove, so without this the move would
  // be dropped instead of emitted as preEvolutionLevelUp.
  for (const moveId of preEvoLevelUp.keys()) get(moveId);

  if (pokemon.id === 'smeargle') {
    for (const moveId of SKETCH_UNIVERSE) get(moveId).sketch = true;
  }

  const moves = [];
  for (const [moveId, sources] of sourcesByMove) {
    if (!dex.moves.get(moveId)?.exists) continue;
    moves.push({
      id: moveId,
      sources: normalizeSources(sources, preEvoLevelUp.get(moveId)),
    });
  }
  moves.sort((a, b) => a.id.localeCompare(b.id));

  await fs.writeFile(
    path.join(outputDir, `${pokemon.id}.json`),
    JSON.stringify({
      pokemonId: pokemon.id,
      pokemonName: pokemon.name,
      types: species?.exists ? species.types : [],
      learnsetPokemonId: pokemon.id,
      learnsetPokemonName: pokemon.name,
      moves,
    }) + '\n',
  );
  written += 1;
}

console.log(`[reborn-legal-moves] wrote ${written} Pokémon files (from Reborn mons.dat)`);

// The level-1 entries that are relists rather than genuine starting moves:
// everything in the ≤1 block except its last four entries. Genuine evolution
// moves are exempt — they're granted on evolving and tracked separately.
function levelOneRelistIds(learnset) {
  const block = learnset.levelUp
    .filter(([level]) => level <= 1)
    .map(([, moveId]) => moveId);
  if (block.length <= 4) return new Set();
  const natural = new Set(block.slice(-4));
  const evolution = new Set(learnset.evolutionMoves);
  return new Set(
    block.filter(
      (moveId) => !natural.has(moveId) && !evolution.has(moveId),
    ),
  );
}

// Pre-evolution ids (closest first) via @pkmn/dex relationships, walked from the
// base species so alternate forms (Megas, etc.) inherit the base line's chain.
function getPreEvolutionIds(pokemonId) {
  const species = dex.species.get(pokemonId);
  if (!species?.exists) return [];
  let current = species.baseSpecies
    ? dex.species.get(toId(species.baseSpecies))
    : species;

  const ids = [];
  const seen = new Set();
  while (current?.prevo && !seen.has(current.id)) {
    seen.add(current.id);
    const prevo = dex.species.get(toId(current.prevo));
    if (!prevo?.exists) break;
    ids.push(prevo.id);
    current = prevo;
  }
  return ids;
}

function normalizeSources(sources, preEvolutionLevels) {
  const { evolutionMove, rebornRelearner, sketch, ...base } = sources;
  const normalized = {
    ...base,
    levelUp: [...new Set(sources.levelUp)].sort((a, b) => a - b),
  };

  // Attributed entries { level, from }. The ancestor id lets legality judge
  // each level against THAT form's own natural departure level, and lets the
  // UI say which evolution a delayed move actually delays.
  const seen = new Set();
  const preEvolutionLevelUp = (preEvolutionLevels || [])
    .filter((entry) => {
      const key = `${entry.level}|${entry.from}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.level - b.level || a.from.localeCompare(b.from));
  if (preEvolutionLevelUp.length) normalized.preEvolutionLevelUp = preEvolutionLevelUp;
  if (evolutionMove) normalized.evolutionMove = true;
  if (rebornRelearner) normalized.rebornRelearner = true;
  if (sketch) normalized.sketch = true;

  return normalized;
}
