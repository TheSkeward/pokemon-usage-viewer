// Builds site-data/data/observed-sets/<family>/<speciesId>.json from the
// curated sample-team archives: whole sets as they were actually run,
// deduped with counts, most-common first. Only paste-sourced sets qualify —
// replay reveals are partial and never enter this index.
// Mirrors the teammate-index runtime conventions: per-mon files plus an
// index.json id list so the app can skip 404-generating fetches.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { REAL_FORMATS } from "./config.mjs";
import { writeJson } from "./set-index/io.mjs";
import { teamWeight } from "./teamscrape/weights.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE_DIR = path.join(scriptDir, "teamscrape", "archive");
const OUT_ROOT = path.join(scriptDir, "..", "site-data", "data", "observed-sets");

const MAX_SETS_PER_MON = 20;
const familyOf = new Map(REAL_FORMATS.map((f) => [f.id, f.family]));

export function readArchive(dir, prefix) {
  const records = [];
  if (!fs.existsSync(dir)) return records;
  for (const file of fs.readdirSync(dir)) {
    if (!file.startsWith(prefix) || !file.endsWith(".jsonl")) continue;
    for (const line of fs.readFileSync(path.join(dir, file), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        records.push(JSON.parse(line));
      } catch {
        // torn tail line from an interrupted append — drop it
      }
    }
  }
  return records;
}

function setKey(formatId, set) {
  const evs = set.evs
    ? ["hp", "atk", "def", "spa", "spd", "spe"].map((k) => set.evs[k] || 0).join(".")
    : "";
  return [
    formatId,
    set.itemId || "",
    set.abilityId || "",
    (set.nature || "").toLowerCase(),
    evs,
    [...(set.moveIds || [])].sort().join(","),
  ].join("|");
}

export function buildObservedSetIndex(teams) {
  // family → speciesId → key → {count, set}
  const byFamily = new Map();
  for (const team of teams) {
    const family = familyOf.get(team.format);
    if (!family) continue;
    for (const set of team.sets || []) {
      if (!set.speciesId || !(set.moveIds || []).length) continue;
      const perMon = (
        byFamily.get(family) || byFamily.set(family, new Map()).get(family)
      );
      const buckets = perMon.get(set.speciesId) || new Map();
      perMon.set(set.speciesId, buckets);
      const key = setKey(team.format, set);
      const bucket = buckets.get(key) || {
        count: 0,
        weight: 0,
        formatId: team.format,
        set,
      };
      bucket.count += 1;
      bucket.weight += teamWeight(team);
      buckets.set(key, bucket);
    }
  }
  const out = new Map();
  for (const [family, perMon] of byFamily) {
    const files = new Map();
    for (const [speciesId, buckets] of perMon) {
      const sets = [...buckets.values()]
        .sort((a, b) => b.weight - a.weight)
        .slice(0, MAX_SETS_PER_MON)
        .map(({ count, weight, formatId, set }) => ({
          count,
          weight,
          formatId,
          species: set.species,
          item: set.item,
          ability: set.ability,
          nature: set.nature,
          level: set.level,
          evs: set.evs,
          ivs: set.ivs,
          moves: set.moves,
          moveIds: set.moveIds,
        }));
      files.set(speciesId, { pokemonId: speciesId, sets });
    }
    out.set(family, files);
  }
  return out;
}

async function main() {
  const teams = [
    ...readArchive(ARCHIVE_DIR, "samples-"),
    ...readArchive(ARCHIVE_DIR, "rmt-"),
    ...readArchive(ARCHIVE_DIR, "tournament-"),
  ];
  const byFamily = buildObservedSetIndex(teams);
  let written = 0;
  for (const [family, files] of byFamily) {
    const dir = path.join(OUT_ROOT, family);
    for (const [speciesId, detail] of files) {
      await writeJson(path.join(dir, `${speciesId}.json`), detail);
      written += 1;
    }
    await writeJson(path.join(dir, "index.json"), [...files.keys()].sort());
  }
  console.log(`observed-sets: ${written} mons from ${teams.length} sample teams`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
