/**
 * @fileoverview Generates per-Pokémon Gen 5 held-item usage from Smogon
 * moveset stats, used to blend real historic item data (especially type Gems,
 * legal and used in Gen 5 but absent from USUM) into the Team Builder
 * recommendations.
 *
 * Aggregates across EVERY available Gen 5 month, weighted by raw count, so the
 * high-population old-gen years dominate and sparse modern ladders wash out.
 * Sample-size filters drop noise (a few meme sets on a near-dead modern ladder
 * must not become "56% Ghost Gem"). Successful fetches are cached, since
 * old-gen monthly stats are immutable — so re-runs don't re-hammer Smogon.
 *
 * Network-bound: runs only where smogon.com is reachable (CI).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { STATS_ROOT } from './config.mjs';

const OUT_DIR = path.resolve('site-data', 'data', 'gen5-items');
const CACHE_DIR = path.resolve('cache', 'gen5');

const GEN5_FORMATS = [
  'gen5ubers',
  'gen5ou',
  'gen5uu',
  'gen5ru',
  'gen5nu',
  'gen5pu',
  'gen5lc',
];
const CUTOFFS = [1500, 0];

// A Pokémon needs this many total sampled sets across all of Gen 5 history for
// its item distribution to be trustworthy; below it, drop the Pokémon entirely.
const MIN_MON_RAW_COUNT = 500;
// An item must appear in this many effective games (summed, weighted) to be
// kept, so single/few-game oddities don't surface as recommendations.
const MIN_ITEM_GAMES = 20;

// How many Smogon files to fetch at once. Bounded so a few hundred months ×
// formats complete in a reasonable time without hammering the server.
const FETCH_CONCURRENCY = 10;

async function main() {
  const months = await fetchAvailableMonths();
  console.log(`Scanning ${months.length} months for Gen 5 data...`);

  const jobs = [];
  for (const month of months) {
    for (const formatId of GEN5_FORMATS) jobs.push({ month, formatId });
  }

  const texts = await mapLimit(jobs, FETCH_CONCURRENCY, (job) =>
    fetchFirstAvailable(job.month, job.formatId),
  );

  const byPokemon = new Map();
  let filesUsed = 0;

  for (const text of texts) {
    if (!text) continue;
    filesUsed += 1;

    for (const entry of Object.values(parseMovesetItems(text))) {
      const agg = byPokemon.get(entry.pokemonId) || {
        name: entry.name,
        rawCount: 0,
        weighted: new Map(),
      };

      agg.name = entry.name || agg.name;
      agg.rawCount += entry.rawCount || 0;
      for (const item of entry.items) {
        const games = (item.usage / 100) * (entry.rawCount || 0);
        agg.weighted.set(item.name, (agg.weighted.get(item.name) || 0) + games);
      }

      byPokemon.set(entry.pokemonId, agg);
    }
  }

  console.log(`Aggregated ${filesUsed} Gen 5 moveset files.`);

  await fs.rm(OUT_DIR, { recursive: true, force: true });
  await fs.mkdir(OUT_DIR, { recursive: true });

  let written = 0;
  for (const [id, agg] of byPokemon) {
    if (agg.rawCount < MIN_MON_RAW_COUNT) continue;

    const items = [...agg.weighted.entries()]
      .filter(([, games]) => games >= MIN_ITEM_GAMES)
      .map(([name, games]) => ({ name, usage: (games / agg.rawCount) * 100 }))
      .sort((a, b) => b.usage - a.usage);

    if (!items.length) continue;

    await fs.writeFile(
      path.join(OUT_DIR, `${id}.json`),
      JSON.stringify({ pokemonId: id, name: agg.name, rawCount: agg.rawCount, items }),
    );
    written += 1;
  }

  console.log(
    `Wrote Gen 5 item usage for ${written} Pokémon (>= ${MIN_MON_RAW_COUNT} samples).`,
  );
}

// Runs fn over items with at most `limit` in flight at once, preserving order.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );

  return results;
}

async function fetchFirstAvailable(month, formatId) {
  for (const cutoff of CUTOFFS) {
    const text = await fetchMovesetText(month, formatId, cutoff);
    if (text) return text;
  }
  return null;
}

async function fetchMovesetText(month, formatId, cutoff) {
  const cachePath = path.join(CACHE_DIR, month, `${formatId}-${cutoff}.txt`);

  try {
    return await fs.readFile(cachePath, 'utf8');
  } catch {
    // not cached yet
  }

  const url = `${STATS_ROOT}/${month}/moveset/${formatId}-${cutoff}.txt`;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const text = await response.text();
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, text);
    return text;
  } catch {
    return null;
  }
}

async function fetchAvailableMonths() {
  const response = await fetch(`${STATS_ROOT}/`);
  if (!response.ok) {
    throw new Error(`Failed to fetch stats index: ${response.status}`);
  }

  const html = await response.text();
  const months = [...html.matchAll(/href="(\d{4}-\d{2})\/?"/g)].map((m) => m[1]);
  const deduped = [...new Set(months)].sort();

  if (deduped.length === 0) {
    throw new Error('No monthly stats directories found.');
  }

  return deduped;
}

// --- moveset-table parsing (mirrors scripts/build-data.mjs) ---

function parseMovesetItems(text) {
  const normalizedText = text.replace(/\r/g, '');
  const pokemon = {};

  const monBlockRegex =
    /\+\-+\+\s*\|\s*([^|\n]+?)\s*\|\s*\+\-+\+\s*\|\s*Raw count:\s*([\d,]+)\s*([\s\S]*?)(?=\+\-+\+\s*\|\s*[^|\n]+?\s*\|\s*\+\-+\+\s*\|\s*Raw count:|$)/g;

  let match;
  while ((match = monBlockRegex.exec(normalizedText)) !== null) {
    const name = match[1].trim();
    const pokemonId = toPokemonId(name);
    const rawCount = Number.parseInt(match[2].replaceAll(',', ''), 10);
    const body = match[3];

    pokemon[pokemonId] = {
      pokemonId,
      name,
      rawCount,
      items: extractSectionEntries(body, 'Items'),
    };
  }

  return pokemon;
}

function extractSectionEntries(body, sectionName) {
  const escaped = escapeRegex(sectionName);
  const boundary =
    '(?:Abilities|Items|Spreads|Moves|Teammates|Checks and Counters)';

  const sectionRegex = new RegExp(
    `\\+[-+]+\\+\\s*\\|\\s*${escaped}\\s*\\|\\s*([\\s\\S]*?)(?=\\+[-+]+\\+\\s*\\|\\s*${boundary}\\s*\\||$)`,
    'i',
  );

  const sectionMatch = body.match(sectionRegex);
  if (!sectionMatch) return [];

  const entries = [];
  const entryRegex = /\|\s*([^|]+?)\s+([\d.]+)%\s*(?=\||$)/g;

  let entryMatch;
  while ((entryMatch = entryRegex.exec(sectionMatch[1])) !== null) {
    const name = entryMatch[1].trim();
    const usage = Number.parseFloat(entryMatch[2]);
    if (!name || !Number.isFinite(usage)) continue;
    if (name.toLowerCase() === 'other' || name.toLowerCase() === 'nothing') {
      continue;
    }
    entries.push({ name, usage });
  }

  return entries;
}

function toPokemonId(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
