/**
 * @fileoverview Parses Rejuvenation's compiled Data/ directory into the
 * committed JSON extracts under scripts/rejuv/, so downstream builds are
 * reproducible without shipping the raw game files. Re-run when the game
 * updates:
 *   node scripts/build-rejuv-data.mjs path/to/Rejuvenation/Data [version]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMarshal } from './reborn/parse-marshal.mjs';
import {
  dexnumToSpecies,
  extractBosses,
  extractDex,
  extractEncounters,
  extractItems,
  extractLearnsets,
  extractMarts,
  extractMoves,
  extractTrainers,
} from './rejuv/extract-rejuv-data.mjs';

const dataDir = process.argv[2];
const version = process.argv[3] || 'V14.0';
if (!dataDir) {
  console.error(
    'Usage: node scripts/build-rejuv-data.mjs <Rejuvenation Data dir> [version]',
  );
  process.exit(1);
}

const outDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'rejuv',
);
const load = (name) =>
  parseMarshal(fs.readFileSync(path.join(dataDir, name)));

const mons = load('mons.dat');
const bySpeciesNum = dexnumToSpecies(mons);

const extracts = [
  ['rejuv-dex', 'mons.dat', () => extractDex(mons)],
  ['rejuv-learnsets', 'mons.dat', () => extractLearnsets(mons)],
  ['rejuv-moves', 'moves.dat', () => extractMoves(load('moves.dat'))],
  ['rejuv-items', 'items.dat', () => extractItems(load('items.dat'))],
  [
    'rejuv-encounters',
    'encounters.dat + MapInfos.rxdata',
    () =>
      extractEncounters(
        load('encounters.dat'),
        load('MapInfos.rxdata'),
        bySpeciesNum,
      ),
  ],
  ['rejuv-marts', 'marts.dat', () => extractMarts(load('marts.dat'))],
  ['rejuv-trainers', 'trainers.dat', () => extractTrainers(load('trainers.dat'))],
  [
    'rejuv-trainers-story',
    'trainers_story.dat',
    () => extractTrainers(load('trainers_story.dat')),
  ],
  ['rejuv-bosses', 'bossdata.dat', () => extractBosses(load('bossdata.dat'))],
  [
    'rejuv-bosses-story',
    'bossdata_story.dat',
    () => extractBosses(load('bossdata_story.dat')),
  ],
];

for (const [stem, source, run] of extracts) {
  const data = run();
  const outPath = path.join(outDir, `${stem}.generated.json`);
  fs.writeFileSync(
    outPath,
    `${JSON.stringify({ game: 'Rejuvenation', version, source, data })}\n`,
  );
  const count = Array.isArray(data) ? data.length : Object.keys(data).length;
  const kb = Math.round(fs.statSync(outPath).size / 1024);
  console.log(`[rejuv-data] ${stem}: ${count} entries, ${kb} KB`);
}
