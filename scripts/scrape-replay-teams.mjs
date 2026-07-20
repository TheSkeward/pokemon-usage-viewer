/**
 * @fileoverview Incremental Showdown replay harvester: for every format the
 * app tracks (scripts/config.mjs REAL_FORMATS — singles AND doubles), page
 * through the public replay search and append each new replay's team
 * compositions to a committed JSONL archive. The archive is the accumulating
 * dataset the derived indexes (core-index) are built from; raw fetches are
 * not kept.
 *
 * Politeness contract: one request at a time, REQUEST_GAP_MS between
 * requests, identifying User-Agent, and a per-run cap on new replays per
 * format so a scheduled run is bounded. Runs where network policy allows
 * (CI / user machines); a blocked or failing format logs and moves on.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { REAL_FORMATS } from "./config.mjs";
import { parseReplayTeams, toTeamSheetId } from "./teamscrape/replayLog.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
/** Directory holding the committed JSONL archives. @type {string} */
export const ARCHIVE_DIR = path.join(scriptDir, "teamscrape", "archive");

const REPLAY_ROOT = "https://replay.pokemonshowdown.com";
const USER_AGENT =
  "pokemon-usage-viewer team harvester (github.com/TheSkeward/pokemon-usage-viewer)";
const REQUEST_GAP_MS = 600;
const SEARCH_PAGE_SIZE = 51; // search.json returns up to 51; fewer means the end
const DEFAULT_MAX_NEW_PER_FORMAT = 300;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson(url) {
  await sleep(REQUEST_GAP_MS);
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

/** @return {string} The replay archive file for a format. */
export function archivePath(formatId) {
  return path.join(ARCHIVE_DIR, `replays-${formatId}.jsonl`);
}

/** @return {!Set<string>} Record ids already present in a JSONL archive file. */
export function readArchiveIds(file) {
  if (!fs.existsSync(file)) return new Set();
  const ids = new Set();
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      ids.add(JSON.parse(line).id);
    } catch {
      // A torn line (interrupted append) loses one record, never the run.
    }
  }
  return ids;
}

/**
 * @param {!Object} replay Raw replay JSON (with battle log).
 * @return {{id: string, format: string, uploadtime: ?number, rating: ?number,
 *     teams: !Array<!Array<string>>}} The archive record: both sides'
 *     team-sheet species ids, deduped and sorted.
 */
export function normalizeReplay(replay, formatId) {
  const teams = parseReplayTeams(replay.log).map((side) =>
    [...new Set(side.map(toTeamSheetId))].sort(),
  );
  return {
    id: replay.id,
    format: formatId,
    uploadtime: replay.uploadtime ?? null,
    rating: replay.rating ?? null,
    teams,
  };
}

async function harvestFormat(formatId, { maxNew }) {
  const file = archivePath(formatId);
  const seen = readArchiveIds(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let appended = 0;
  let before = null;

  while (appended < maxNew) {
    const url = `${REPLAY_ROOT}/search.json?format=${formatId}${before ? `&before=${before}` : ""}`;
    const page = await fetchJson(url);
    if (!Array.isArray(page) || !page.length) break;
    for (const entry of page) {
      if (appended >= maxNew) break;
      before = entry.uploadtime ?? before;
      if (seen.has(entry.id)) continue;
      let replay;
      try {
        replay = await fetchJson(`${REPLAY_ROOT}/${entry.id}.json`);
      } catch (error) {
        console.warn(`  skip ${entry.id}: ${error.message}`);
        continue;
      }
      const record = normalizeReplay(replay, formatId);
      if (record.teams.every((team) => team.length)) {
        fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
        seen.add(entry.id);
        appended += 1;
      }
    }
    if (page.length < SEARCH_PAGE_SIZE) break;
  }
  return { appended, total: seen.size };
}

async function main() {
  const maxNew =
    Number(process.argv.find((a) => a.startsWith("--max-new="))?.split("=")[1]) ||
    DEFAULT_MAX_NEW_PER_FORMAT;
  let failures = 0;
  for (const { id } of REAL_FORMATS) {
    try {
      const { appended, total } = await harvestFormat(id, { maxNew });
      console.log(`${id}: +${appended} (archive ${total})`);
    } catch (error) {
      failures += 1;
      console.warn(`${id}: harvest failed — ${error.message}`);
    }
  }
  // All-formats failure means no network (policy denial), not empty ladders.
  if (failures === REAL_FORMATS.length) {
    console.error("every format failed — is this environment allowed to reach replay.pokemonshowdown.com?");
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
