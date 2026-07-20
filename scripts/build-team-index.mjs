/**
 * @fileoverview Builds site-data/data/team-index/<family>/<formatId>.json:
 * whole real teams from the paste-sourced archives (samples, tournament
 * dumps, RMT), deduped by composition+sets with summed source weight. The
 * runtime's "fieldable real team" panel filters these against the player's
 * pool, progression, and tracked inventory. Uncapped: see real harvest volume
 * before deciding any cap is needed.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { REAL_FORMATS } from "./config.mjs";
import { writeJson } from "./set-index/io.mjs";
import { readArchive } from "./build-observed-sets.mjs";
import { teamWeight } from "./teamscrape/weights.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE_DIR = path.join(scriptDir, "teamscrape", "archive");
const OUT_ROOT = path.join(scriptDir, "..", "site-data", "data", "team-index");

const MIN_MEMBERS = 4;
const familyOf = new Map(REAL_FORMATS.map((f) => [f.id, f.family]));

function memberKey(set) {
  return [
    set.speciesId,
    set.itemId || "",
    set.abilityId || "",
    (set.nature || "").toLowerCase(),
    [...(set.moveIds || [])].sort().join(","),
  ].join("~");
}

/**
 * @param {!Array<!Object>} records Paste-sourced team records.
 * @return {!Map<string, !Map<string, {formatId: string,
 *     teams: !Array<!Object>}>>} family → formatId → per-format file payload,
 *     teams heaviest-first.
 */
export function buildTeamIndex(records) {
  // family → formatId → key → entry
  const byFamily = new Map();
  for (const record of records) {
    const family = familyOf.get(record.format);
    const sets = (record.sets || []).filter(
      (set) => set.speciesId && (set.moveIds || []).length,
    );
    if (!family || sets.length < MIN_MEMBERS) continue;
    const key = sets
      .map(memberKey)
      .sort()
      .join("|");
    const perFormat = (
      byFamily.get(family) || byFamily.set(family, new Map()).get(family)
    );
    const teams = perFormat.get(record.format) || new Map();
    perFormat.set(record.format, teams);
    const entry = teams.get(key) || {
      key,
      weight: 0,
      count: 0,
      sources: {},
      members: sets.map((set) => ({
        species: set.species,
        speciesId: set.speciesId,
        item: set.item ?? null,
        itemId: set.itemId ?? null,
        ability: set.ability ?? null,
        abilityId: set.abilityId ?? null,
        nature: set.nature ?? null,
        level: set.level ?? null,
        evs: set.evs ?? null,
        ivs: set.ivs ?? null,
        moves: set.moves,
        moveIds: set.moveIds,
      })),
    };
    entry.weight += teamWeight(record);
    entry.count += 1;
    const source = record.source || "sample";
    entry.sources[source] = (entry.sources[source] || 0) + 1;
    teams.set(key, entry);
  }

  const out = new Map();
  for (const [family, perFormat] of byFamily) {
    const files = new Map();
    for (const [formatId, teams] of perFormat) {
      files.set(formatId, {
        formatId,
        teams: [...teams.values()].sort(
          (a, b) => b.weight - a.weight || b.count - a.count,
        ),
      });
    }
    out.set(family, files);
  }
  return out;
}

async function main() {
  const records = [
    ...readArchive(ARCHIVE_DIR, "samples-"),
    ...readArchive(ARCHIVE_DIR, "rmt-"),
    ...readArchive(ARCHIVE_DIR, "tournament-"),
  ];
  const byFamily = buildTeamIndex(records);
  for (const [family, files] of byFamily) {
    const dir = path.join(OUT_ROOT, family);
    let teams = 0;
    for (const [formatId, detail] of files) {
      await writeJson(path.join(dir, `${formatId}.json`), detail);
      teams += detail.teams.length;
    }
    await writeJson(path.join(dir, "index.json"), [...files.keys()].sort());
    console.log(`team-index/${family}: ${teams} teams across ${files.size} formats`);
  }
  if (!byFamily.size) console.log("team-index: no archives yet — nothing to build");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
