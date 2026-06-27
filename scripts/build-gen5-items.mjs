// Generates per-Pokémon Gen 5 held-item usage from Smogon moveset stats, used
// to blend real historic item data (especially type Gems, which were legal and
// used in Gen 5 but don't exist in USUM) into the Team Builder recommendations.
//
// Network-bound: this can only run where smogon.com is reachable (CI). It reuses
// the same moveset-table parser as build-data.mjs, so the parsing is the proven
// path; only the formats it points at are new. Output is one JSON per Pokémon
// under site-data/data/gen5-items/, fetched on demand at runtime.

import fs from "node:fs/promises";
import path from "node:path";
import { STATS_ROOT } from "./config.mjs";

const OUT_DIR = path.resolve("site-data", "data", "gen5-items");

const GEN5_FORMATS = [
  "gen5ubers",
  "gen5ou",
  "gen5uu",
  "gen5ru",
  "gen5nu",
  "gen5pu",
  "gen5lc",
];
const CUTOFFS = [1500, 0];

async function main() {
  const months = await fetchAvailableMonths();
  const month = await findLatestGen5Month(months);

  if (!month) {
    throw new Error("No month with Gen 5 moveset data was found.");
  }

  console.log(`Using Gen 5 stats from ${month}`);

  // Aggregate item usage per Pokémon, weighted by raw count across formats.
  const byPokemon = new Map();

  for (const formatId of GEN5_FORMATS) {
    const text = await fetchFirstAvailable(month, formatId);
    if (!text) {
      console.warn(`  ${formatId}: no moveset file`);
      continue;
    }

    const parsed = parseMovesetItems(text);
    let count = 0;

    for (const entry of Object.values(parsed)) {
      count += 1;
      const agg = byPokemon.get(entry.pokemonId) || {
        pokemonId: entry.pokemonId,
        name: entry.name,
        rawCount: 0,
        weighted: new Map(),
      };

      agg.rawCount += entry.rawCount || 0;
      for (const item of entry.items) {
        const weight = (item.usage / 100) * (entry.rawCount || 0);
        agg.weighted.set(item.name, (agg.weighted.get(item.name) || 0) + weight);
      }

      byPokemon.set(entry.pokemonId, agg);
    }

    console.log(`  ${formatId}: ${count} Pokémon`);
  }

  await fs.rm(OUT_DIR, { recursive: true, force: true });
  await fs.mkdir(OUT_DIR, { recursive: true });

  let written = 0;
  for (const agg of byPokemon.values()) {
    if (!agg.rawCount) continue;

    const items = [...agg.weighted.entries()]
      .map(([name, weight]) => ({
        name,
        usage: (weight / agg.rawCount) * 100,
      }))
      .filter((item) => item.usage > 0)
      .sort((a, b) => b.usage - a.usage);

    if (!items.length) continue;

    await fs.writeFile(
      path.join(OUT_DIR, `${agg.pokemonId}.json`),
      JSON.stringify({ pokemonId: agg.pokemonId, name: agg.name, month, items }),
    );
    written += 1;
  }

  console.log(`Wrote Gen 5 item usage for ${written} Pokémon to ${OUT_DIR}`);
}

async function findLatestGen5Month(months) {
  for (const month of [...months].reverse()) {
    if (await fetchFirstAvailable(month, "gen5ou")) return month;
  }
  return null;
}

async function fetchFirstAvailable(month, formatId) {
  for (const cutoff of CUTOFFS) {
    const text = await fetchMovesetText(month, formatId, cutoff);
    if (text) return text;
  }
  return null;
}

async function fetchMovesetText(month, formatId, cutoff) {
  const url = `${STATS_ROOT}/${month}/moveset/${formatId}-${cutoff}.txt`;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return await response.text();
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
    throw new Error("No monthly stats directories found.");
  }

  return deduped;
}

// --- moveset-table parsing (mirrors scripts/build-data.mjs) ---

function parseMovesetItems(text) {
  const normalizedText = text.replace(/\r/g, "");
  const pokemon = {};

  const monBlockRegex =
    /\+\-+\+\s*\|\s*([^|\n]+?)\s*\|\s*\+\-+\+\s*\|\s*Raw count:\s*([\d,]+)\s*([\s\S]*?)(?=\+\-+\+\s*\|\s*[^|\n]+?\s*\|\s*\+\-+\+\s*\|\s*Raw count:|$)/g;

  let match;
  while ((match = monBlockRegex.exec(normalizedText)) !== null) {
    const name = match[1].trim();
    const pokemonId = toPokemonId(name);
    const rawCount = Number.parseInt(match[2].replaceAll(",", ""), 10);
    const body = match[3];

    pokemon[pokemonId] = {
      pokemonId,
      name,
      rawCount,
      items: extractSectionEntries(body, "Items"),
    };
  }

  return pokemon;
}

function extractSectionEntries(body, sectionName) {
  const escaped = escapeRegex(sectionName);
  const boundary =
    "(?:Abilities|Items|Spreads|Moves|Teammates|Checks and Counters)";

  const sectionRegex = new RegExp(
    `\\+[-+]+\\+\\s*\\|\\s*${escaped}\\s*\\|\\s*([\\s\\S]*?)(?=\\+[-+]+\\+\\s*\\|\\s*${boundary}\\s*\\||$)`,
    "i",
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
    if (name.toLowerCase() === "other" || name.toLowerCase() === "nothing") {
      continue;
    }
    entries.push({ name, usage });
  }

  return entries;
}

function toPokemonId(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
