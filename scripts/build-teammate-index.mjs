// Builds the teammate-synergy index: for each mon, the co-use LIFT of its
// teammates in its FIRST-MEANINGFUL tier (same tier law as set sourcing),
// from Smogon's text moveset stats ("Teammates" blocks carry P(B|A) − P(B)
// precomputed). Downloads a few highest-volume months per format,
// weight-averages, symmetrizes, and emits per-mon JSONs:
//   site-data/data/teammate-index/<family>/all/<monId>.json
//     { pokemonId, tier: {formatId, cutoff}, teammates: { otherId: liftPct } }
//
// Runs in the data-refresh CI (network to smogon.com); rerun via
//   npm run build:teammate-index
// Missing index files at runtime mean "no opinion" — the synergy term stays
// silent (trust 0).

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";

const MONTHS_PER_FORMAT = 3; // highest-volume months, weight-averaged
const TOP_TEAMMATES = 24;

const toId = (name) =>
  String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) return null;
  return response.text();
}

// Parse the Teammates block per mon from a Smogon text moveset file.
function parseTeammates(text) {
  const byMon = new Map();
  const blocks = text.split(/\n \+-+\+ \n(?= \| \S)/);
  // Walk lines, tracking the current mon and whether we are in its Teammates
  // section.
  let current = null;
  let inTeammates = false;
  let expectName = 0;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("+--")) {
      if (expectName > 0) expectName -= 1;
      inTeammates = false;
      continue;
    }
    const cell = line.replace(/^\|/, "").replace(/\|$/, "").trim();
    if (!cell) continue;
    if (/^Teammates$/i.test(cell)) {
      inTeammates = true;
      continue;
    }
    if (/^(Abilities|Items|Spreads|Moves|Checks and Counters|Raw count|Avg\. weight|Viability Ceiling)/i.test(cell)) {
      inTeammates = false;
      if (/^Raw count: (\d+)/i.test(cell) && current) {
        current.rawCount = Number.parseInt(cell.match(/^Raw count: (\d+)/i)[1], 10);
      }
      continue;
    }
    if (inTeammates && current) {
      const match = /^(.+?)\s+([+-]?\d+(?:\.\d+)?)%$/.exec(cell);
      if (match) current.teammates.set(toId(match[1]), Number.parseFloat(match[2]));
      continue;
    }
    // A name cell: appears alone right after a block boundary, before the
    // "Raw count" line. Heuristic: no colon, no %, not a stat row.
    if (!cell.includes(":") && !cell.includes("%") && /^[A-Z]/.test(cell)) {
      current = { teammates: new Map(), rawCount: 0 };
      byMon.set(toId(cell), current);
    }
  }
  return byMon;
}

async function buildFamily(family) {
  const resolver = JSON.parse(
    readFileSync(`site-data/data/resolver-index/${family}/all.json`, "utf8"),
  );
  // Group mons by their first-meaningful tier.
  const byTier = new Map();
  for (const [monId, entry] of Object.entries(resolver.pokemon || {})) {
    const ranking = entry.ranking;
    if (!ranking?.formatId) continue;
    const key = `${ranking.formatId}-${ranking.cutoff}`;
    if (!byTier.has(key)) {
      byTier.set(key, { formatId: ranking.formatId, cutoff: ranking.cutoff, mons: [] });
    }
    byTier.get(key).mons.push(monId);
  }

  const results = new Map(); // monId -> { tier, teammates: Map(other -> {sum, weight}) }

  for (const tier of byTier.values()) {
    // Highest-volume months for this format, from the moveset files we track.
    const dir = `site-data/data/movesets/${tier.formatId}`;
    if (!existsSync(dir)) continue;
    const months = readdirSync(dir)
      .filter((file) => file.endsWith(".json"))
      .map((file) => {
        const data = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
        const total = Object.values(data.pokemon || {}).reduce(
          (sum, mon) => sum + (mon.rawCount || 0),
          0,
        );
        return { month: file.replace(".json", ""), total };
      })
      .sort((a, b) => b.total - a.total)
      .slice(0, MONTHS_PER_FORMAT);

    for (const { month, total } of months) {
      const url = `https://www.smogon.com/stats/${month}/moveset/${tier.formatId}-${tier.cutoff}.txt`;
      let text = null;
      try {
        text = await fetchText(url);
      } catch {
        text = null;
      }
      if (!text) {
        console.warn(`[teammate-index] missing ${url}`);
        continue;
      }
      const parsed = parseTeammates(text);
      for (const monId of tier.mons) {
        const block = parsed.get(monId);
        if (!block) continue;
        let record = results.get(monId);
        if (!record) {
          record = { tier: { formatId: tier.formatId, cutoff: tier.cutoff }, teammates: new Map() };
          results.set(monId, record);
        }
        for (const [other, lift] of block.teammates) {
          const cell = record.teammates.get(other) || { sum: 0, weight: 0 };
          cell.sum += lift * total;
          cell.weight += total;
          record.teammates.set(other, cell);
        }
      }
    }
  }

  // Weight-average, then symmetrize (mean of defined directions).
  const averaged = new Map();
  for (const [monId, record] of results) {
    const lifts = new Map();
    for (const [other, cell] of record.teammates) {
      if (cell.weight > 0) lifts.set(other, cell.sum / cell.weight);
    }
    averaged.set(monId, { tier: record.tier, lifts });
  }
  const symmetric = new Map();
  const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const pairValues = new Map();
  for (const [monId, { lifts }] of averaged) {
    for (const [other, lift] of lifts) {
      const key = pairKey(monId, other);
      const cell = pairValues.get(key) || [];
      cell.push(lift);
      pairValues.set(key, cell);
    }
  }
  for (const [monId, { tier, lifts }] of averaged) {
    const out = new Map();
    for (const other of lifts.keys()) {
      const values = pairValues.get(pairKey(monId, other)) || [];
      const mean = values.reduce((s, v) => s + v, 0) / (values.length || 1);
      out.set(other, Math.round(mean * 1000) / 1000);
    }
    symmetric.set(monId, { tier, teammates: out });
  }

  const outDir = `site-data/data/teammate-index/${family}/all`;
  mkdirSync(outDir, { recursive: true });
  let written = 0;
  const availableIds = [];
  for (const [monId, { tier, teammates }] of symmetric) {
    const top = [...teammates.entries()]
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, TOP_TEAMMATES);
    if (!top.length) continue;
    writeFileSync(
      path.join(outDir, `${monId}.json`),
      `${JSON.stringify({ pokemonId: monId, tier, teammates: Object.fromEntries(top) })}\n`,
    );
    availableIds.push(monId);
    written += 1;
  }
  // Listing of which mons HAVE an index file, so the runtime loader can skip
  // fetches for the rest instead of eating an expected 404 (browsers log
  // network 404s to the console even when the fetch is caught).
  writeFileSync(
    path.join(outDir, "index.json"),
    `${JSON.stringify(availableIds.sort())}\n`,
  );
  console.log(`[teammate-index] ${family}/all: ${written} mons`);
}

for (const family of ["singles", "doubles"]) {
  await buildFamily(family);
}
