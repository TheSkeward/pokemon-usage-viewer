/**
 * @fileoverview Builds the committed Rejuvenation → Gen 9 identity map from
 * the rejuv extracts and @pkmn/dex. Fully reproducible from the repo alone:
 *   node scripts/build-rejuv-dex-map.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mapItems,
  mapMoves,
  mapSpecies,
} from './rejuv/map-rejuv-dex.mjs';

const rejuvDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'rejuv',
);
const loadExtract = (stem) =>
  JSON.parse(
    fs.readFileSync(path.join(rejuvDir, `${stem}.generated.json`), 'utf8'),
  ).data;

const species = mapSpecies(loadExtract('rejuv-dex'));
const moves = mapMoves(loadExtract('rejuv-moves'));
const items = mapItems(loadExtract('rejuv-items'));

const outPath = path.join(rejuvDir, 'rejuv-dex-map.generated.json');
fs.writeFileSync(
  outPath,
  `${JSON.stringify({
    game: 'Rejuvenation',
    dexGen: 9,
    summary: {
      species: species.summary,
      moves: moves.summary,
      items: items.summary,
    },
    species: species.species,
    moves: moves.moves,
    items: items.items,
  })}\n`,
);
for (const [what, { summary }] of
  [['species forms', species], ['moves', moves], ['items', items]]) {
  console.log(`[rejuv-dex-map] ${what}: ${JSON.stringify(summary)}`);
}
