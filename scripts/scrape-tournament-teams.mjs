/**
 * @fileoverview Tournament harvester: walks the configured tournament
 * forums/threads (team dumps and replay threads — SPL old-gen slots, RoA
 * cups). Two yields:
 *   pastes  → tournament-<format>.jsonl (whole sets, elite prepared play)
 *   replays → replays-<format>.jsonl with source:"tournament", so the core
 *             index prices them as tournament play instead of unrated.
 * Format attribution, most→least reliable: the paste's own "=== [gen7ou] ==="
 * header, the replay id's format segment, the thread's prefix label via
 * rmt.prefixMap, a per-listing pinned format in the config.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseShowdownTeam } from "./teamscrape/parseShowdownTeam.mjs";
import { normalizeSampleTeam } from "./scrape-sample-teams.mjs";
import {
  archivePath,
  normalizeReplay,
  readArchiveIds,
} from "./scrape-replay-teams.mjs";
import { extractThreadRows, htmlToText } from "./scrape-rmt-teams.mjs";
import { REAL_FORMATS } from "./config.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE_DIR = path.join(scriptDir, "teamscrape", "archive");
const SOURCES_PATH = path.join(scriptDir, "teamscrape", "sources.json");

const USER_AGENT =
  "pokemon-usage-viewer team harvester (github.com/TheSkeward/pokemon-usage-viewer)";
const REQUEST_GAP_MS = 900;
const MAX_LISTING_PAGES = 20;
const DEFAULT_MAX_NEW = 40;
const MIN_SETS_PER_TEAM = 4;

const knownFormats = new Set(REAL_FORMATS.map((f) => f.id));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchText(url) {
  await sleep(REQUEST_GAP_MS);
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}

/**
 * replay.pokemonshowdown.com/<id> ids embed the format:
 * "gen7ou-967241" and "smogtours-gen7ou-406712" both attribute to gen7ou.
 *
 * @return {?string} The format id, or null when absent or not tracked.
 */
export function replayLinkFormat(replayId) {
  const match = replayId.match(/(?:^|-)((?:gen\d)[a-z0-9]+)-\d+$/);
  return match && knownFormats.has(match[1]) ? match[1] : null;
}

/** @return {!Array<string>} Unique replay ids linked in the HTML. */
export function extractReplayIds(html) {
  return [
    ...new Set(
      [...String(html).matchAll(
        /replay\.pokemonshowdown\.com\/([a-z0-9-]+-\d+)/g,
      )].map((match) => match[1]),
    ),
  ];
}

const pasteState = new Map(); // formatId → {file, seen}
function forFormat(formatId) {
  if (!pasteState.has(formatId)) {
    const file = path.join(ARCHIVE_DIR, `tournament-${formatId}.jsonl`);
    pasteState.set(formatId, { file, seen: readArchiveIds(file) });
  }
  return pasteState.get(formatId);
}

async function harvestThreadPage(html, { fallbackFormat, thread, counters }) {
  for (const pasteId of [...new Set(
    [...html.matchAll(/pokepast\.es\/([0-9a-f]{8,16})/g)].map((m) => m[1]),
  )]) {
    let parsed;
    try {
      parsed = parseShowdownTeam(await fetchText(`https://pokepast.es/${pasteId}/raw`));
    } catch {
      continue;
    }
    const formatId =
      parsed.format && knownFormats.has(parsed.format)
        ? parsed.format
        : fallbackFormat;
    if (!formatId || parsed.sets.length < MIN_SETS_PER_TEAM) continue;
    const { file, seen } = forFormat(formatId);
    if (seen.has(pasteId)) continue;
    const record = normalizeSampleTeam({ pasteId, formatId, thread, sets: parsed.sets });
    record.source = "tournament";
    fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
    seen.add(pasteId);
    counters.pastes += 1;
  }

  for (const replayId of extractReplayIds(html)) {
    const formatId = replayLinkFormat(replayId);
    if (!formatId) continue;
    const file = archivePath(formatId);
    const seen = counters.replaySeen.get(formatId) || readArchiveIds(file);
    counters.replaySeen.set(formatId, seen);
    if (seen.has(replayId)) continue;
    let replay;
    try {
      replay = await fetchText(
        `https://replay.pokemonshowdown.com/${replayId}.json`,
      ).then(JSON.parse);
    } catch {
      continue;
    }
    const record = normalizeReplay(replay, formatId);
    record.source = "tournament";
    if (record.teams.every((team) => team.length)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
      seen.add(replayId);
      counters.replays += 1;
    }
  }
}

async function main() {
  const config = JSON.parse(fs.readFileSync(SOURCES_PATH, "utf8"));
  const tournament = config.tournament || {};
  const prefixMap = { ...(config.rmt?.prefixMap || {}), ...(tournament.prefixMap || {}) };
  const maxNew =
    Number(process.argv.find((a) => a.startsWith("--max-new="))?.split("=")[1]) ||
    DEFAULT_MAX_NEW;
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  const counters = { pastes: 0, replays: 0, replaySeen: new Map() };
  const visited = readArchiveIds(path.join(ARCHIVE_DIR, "tournament-threads.jsonl"));
  const visitedFile = path.join(ARCHIVE_DIR, "tournament-threads.jsonl");

  // Standalone dump threads: {url, format?} — the whole thread is harvested
  // (replies ARE team dumps by other players, unlike RMT).
  for (const entry of tournament.dumpThreads || []) {
    const { url, format = null } = typeof entry === "string" ? { url: entry } : entry;
    try {
      const html = await fetchText(url);
      await harvestThreadPage(html, { fallbackFormat: format, thread: url, counters });
    } catch (error) {
      console.warn(`tournament dump ${url}: FAILED — ${error.message}`);
    }
  }

  // Forum listings: walk pages, harvest each unvisited thread once (page 1
  // only — dump/replay threads front-load their links).
  for (const listing of tournament.listings || []) {
    try {
      for (
        let page = 1;
        page <= MAX_LISTING_PAGES && counters.pastes + counters.replays < maxNew;
        page += 1
      ) {
        const url = page === 1 ? listing : `${listing}page-${page}`;
        const rows = extractThreadRows(await fetchText(url), listing);
        if (!rows.length) break;
        for (const row of rows) {
          if (counters.pastes + counters.replays >= maxNew) break;
          if (visited.has(row.threadId)) continue;
          const fallbackFormat = row.prefix ? prefixMap[row.prefix] || null : null;
          try {
            const html = await fetchText(row.url);
            await harvestThreadPage(html, {
              fallbackFormat,
              thread: row.url,
              counters,
            });
            fs.appendFileSync(
              visitedFile,
              `${JSON.stringify({ id: row.threadId, thread: row.url })}\n`,
            );
            visited.add(row.threadId);
          } catch (error) {
            console.warn(`  thread ${row.threadId}: ${error.message}`);
          }
        }
      }
    } catch (error) {
      console.warn(`tournament listing ${listing}: FAILED — ${error.message}`);
    }
  }
  console.log(
    `tournament: +${counters.pastes} paste teams, +${counters.replays} replays`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
