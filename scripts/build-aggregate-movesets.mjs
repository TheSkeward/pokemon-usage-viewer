/**
 * @fileoverview Builds movesets/<formatId>/all.json — the "All available"
 * aggregate of a format's monthly moveset files — so the browser's detail pane
 * can show genuinely aggregated sets instead of silently falling back to the
 * latest month (which for thin formats is one player's single set at 100%).
 *
 * Aggregation matches scripts/set-index/aggregateMovesets.mjs: an entry's
 * monthly usage% is converted back to a count (usage/100 × that month's
 * rawCount for the mon), counts are summed across months, and the final
 * percentage is count / total rawCount. Output shape mirrors the monthly
 * files ({ source, pokemon }) so the viewer renders it unchanged.
 */

import fs from 'node:fs';
import path from 'node:path';

const MOVESETS_ROOT = path.resolve('site-data', 'data', 'movesets');
const MONTH_FILE = /^\d{4}-\d{2}\.json$/;
const SECTIONS = ['moves', 'items', 'abilities', 'spreads'];

function aggregateFormat(formatId) {
  const dir = path.join(MOVESETS_ROOT, formatId);
  const months = fs
    .readdirSync(dir)
    .filter((file) => MONTH_FILE.test(file))
    .sort();
  if (!months.length) return null;

  const byPokemon = new Map();

  for (const file of months) {
    const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    for (const [pokemonId, entry] of Object.entries(data.pokemon || {})) {
      let aggregate = byPokemon.get(pokemonId);
      if (!aggregate) {
        aggregate = {
          pokemonId,
          name: entry.name,
          rawCount: 0,
          monthsPresent: 0,
          sections: Object.fromEntries(SECTIONS.map((s) => [s, new Map()])),
        };
        byPokemon.set(pokemonId, aggregate);
      }
      const rawCount = entry.rawCount || 0;
      aggregate.name = entry.name || aggregate.name;
      aggregate.rawCount += rawCount;
      aggregate.monthsPresent += 1;
      for (const section of SECTIONS) {
        for (const item of entry[section] || []) {
          const weight = ((item.usage || 0) / 100) * rawCount;
          const map = aggregate.sections[section];
          map.set(item.name, (map.get(item.name) || 0) + weight);
        }
      }
    }
  }

  const pokemon = {};
  for (const [pokemonId, aggregate] of [...byPokemon.entries()].sort()) {
    if (!aggregate.rawCount) continue;
    pokemon[pokemonId] = {
      pokemonId,
      name: aggregate.name,
      rawCount: aggregate.rawCount,
      monthsPresent: aggregate.monthsPresent,
      ...Object.fromEntries(
        SECTIONS.map((section) => [
          section,
          [...aggregate.sections[section].entries()]
            .map(([name, weight]) => ({
              name,
              usage: (weight / aggregate.rawCount) * 100,
            }))
            .sort((a, b) => b.usage - a.usage || a.name.localeCompare(b.name)),
        ]),
      ),
    };
  }

  return {
    source: {
      formatId,
      selection: 'all',
      months: months.map((file) => file.replace(/\.json$/, '')),
      note: "Aggregated across all available months, weighted by each month's raw usage count.",
    },
    pokemon,
  };
}

function main() {
  const formatIds = fs
    .readdirSync(MOVESETS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  let written = 0;
  for (const formatId of formatIds) {
    const aggregate = aggregateFormat(formatId);
    if (!aggregate) continue;
    fs.writeFileSync(
      path.join(MOVESETS_ROOT, formatId, 'all.json'),
      JSON.stringify(aggregate),
    );
    written += 1;
  }
  console.log(`Wrote ${written} aggregated moveset files.`);
}

main();
