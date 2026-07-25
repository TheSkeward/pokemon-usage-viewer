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
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  MIN_SETS_PER_TEAM,
  parseShowdownTeam,
} from './teamscrape/parse-showdown-team.mjs';
import { extractPasteIds, normalizeSampleTeam } from
  './scrape-sample-teams.mjs';
import {
  appendJsonlRecord,
  createFormatArchives,
} from './teamscrape/jsonl-records.mjs';
import {
  archivePath,
  normalizeReplay,
  readArchiveIds,
} from './scrape-replay-teams.mjs';
import {
  extractThreadRows,
  hasNextPage,
  listingDebugInfo,
} from './teamscrape/forum-html.mjs';
import {
  forListing,
  importLegacyThreads,
  nextThreadPage,
  readCrawlState,
  recordDeferredThread,
  recordListingPage,
  recordThreadPage,
  saveCrawlState,
  shouldScanThread,
} from './teamscrape/crawl-state.mjs';
import {
  closeTeamSourceFetcher,
  fetchTeamSourceText as fetchText,
} from './teamscrape/forum-fetch.mjs';
import {
  parseBudget,
  walkListingPages,
} from './teamscrape/listing-walk.mjs';
import { REAL_FORMATS } from './config.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE_DIR = path.join(scriptDir, 'teamscrape', 'archive');
const SOURCES_PATH = path.join(scriptDir, 'teamscrape', 'sources.json');

const DEFAULT_MAX_NEW = 40;
const DEFAULT_LISTING_PAGES_PER_RUN = 4;
const DEFAULT_THREAD_PAGES_PER_RUN = 40;

const knownFormats = new Set(REAL_FORMATS.map((f) => f.id));
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

const archives = createFormatArchives(ARCHIVE_DIR, 'tournament-');

async function harvestThreadPage(html, { fallbackFormat, thread, counters }) {
  for (const pasteId of extractPasteIds(html)) {
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
    const { file, latest } = archives.forFormat(formatId);
    const record =
      normalizeSampleTeam({ pasteId, formatId, thread, sets: parsed.sets });
    record.source = 'tournament';
    counters.pastes += Number(appendJsonlRecord(file, record, latest));
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
    record.source = 'tournament';
    if (record.teams.every((team) => team.length)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
      seen.add(replayId);
      counters.replays += 1;
    }
  }
}

async function harvestThread({ row, fallbackFormat, counters, crawl,
  crawlFile, sweep, budget, maxThreadPages, maxNew }) {
  let page = nextThreadPage(crawl.threads[row.threadId]);
  while (budget.threadPages < maxThreadPages) {
    const html = await fetchText(
      page === 1 ? row.url : `${row.url}page-${page}`);
    budget.threadPages += 1;
    await harvestThreadPage(
      html,
      { fallbackFormat, thread: row.url, counters },
    );
    const next = hasNextPage(html, page);
    recordThreadPage(crawl, row, { page, hasNext: next, sweep });
    saveCrawlState(crawlFile, crawl);
    if (!next) return true;
    if (counters.pastes + counters.replays >= maxNew) return false;
    page += 1;
  }
  return false;
}

async function main() {
  const config = JSON.parse(fs.readFileSync(SOURCES_PATH, 'utf8'));
  const tournament = config.tournament || {};
  const prefixMap =
    { ...(config.rmt?.prefixMap || {}), ...(tournament.prefixMap || {}) };
  const maxNew = parseBudget(process.argv, 'max-new', DEFAULT_MAX_NEW);
  const listingPagesPerRun =
    parseBudget(process.argv, 'listing-pages', DEFAULT_LISTING_PAGES_PER_RUN);
  const maxThreadPages =
    parseBudget(process.argv, 'thread-pages', DEFAULT_THREAD_PAGES_PER_RUN);
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  const counters = { pastes: 0, replays: 0, replaySeen: new Map() };
  const budget = { threadPages: 0 };
  const crawlFile = path.join(ARCHIVE_DIR, 'tournament-crawl-state.json');
  const crawl = readCrawlState(crawlFile);
  importLegacyThreads(
    crawl,
    path.join(ARCHIVE_DIR, 'tournament-threads.jsonl'),
  );
  saveCrawlState(crawlFile, crawl);

  // Standalone dump threads: {url, format?} — the whole thread is harvested
  // (replies ARE team dumps by other players, unlike RMT).
  for (const [index, entry] of (tournament.dumpThreads || []).entries()) {
    const { url, format = null } = typeof entry === 'string' ? { url: entry } : entry;
    const row = {
      threadId: /\.(\d+)\/?$/.exec(url)?.[1] || `dump-${index}`,
      url,
      updatedAt: null,
    };
    const listingKey = `dump:${url}`;
    const progress = forListing(crawl, listingKey);
    try {
      const complete = await harvestThread({
        row,
        fallbackFormat: format,
        counters,
        crawl,
        crawlFile,
        sweep: progress.sweep,
        budget,
        maxThreadPages,
        maxNew,
      });
      if (complete) {
        recordListingPage(crawl, listingKey, progress.page, false);
        saveCrawlState(crawlFile, crawl);
      }
    } catch (error) {
      console.warn(`tournament dump ${url}: FAILED — ${error.message}`);
    }
  }

  // Forum listings: page 1 is always live discovery; the durable cursor walks
  // the remaining listing pages and every page of each discovered thread.
  for (const listing of tournament.listings || []) {
    try {
      const progress = forListing(crawl, listing);
      const processPage = async (html, page) => {
        const rows = extractThreadRows(html, listing);
        if (!rows.length) {
          if (page === 1) {
            console.log(
              `tournament listing ${listing}: 0 rows on page 1 ` +
                `(${listingDebugInfo(html)})`,
            );
          }
          return { handled: true, next: false };
        }
        let handled = true;
        for (const row of rows) {
          if (
            counters.pastes + counters.replays >= maxNew ||
            budget.threadPages >= maxThreadPages
          ) {
            handled = false;
            break;
          }
          if (!shouldScanThread(
            crawl.threads[row.threadId], row, progress.sweep)) continue;
          const fallbackFormat =
            row.prefix ? prefixMap[row.prefix] || null : null;
          try {
            const complete = await harvestThread({
              row,
              fallbackFormat,
              counters,
              crawl,
              crawlFile,
              sweep: progress.sweep,
              budget,
              maxThreadPages,
              maxNew,
            });
            if (!complete) handled = false;
          } catch (error) {
            console.warn(`  thread ${row.threadId}: ${error.message}`);
            // A per-thread 4xx (locked or deleted thread) never resolves;
            // defer it so the cursor advances. Anything else may be
            // transient and must block the cursor for a retry next run.
            if (error.status >= 400 && error.status < 500 &&
                error.status !== 429) {
              recordDeferredThread(crawl, row, progress.sweep);
              saveCrawlState(crawlFile, crawl);
            } else {
              handled = false;
            }
          }
        }
        return { handled, next: hasNextPage(html, page) };
      };

      await walkListingPages({
        listing,
        fetchText,
        processPage,
        crawl,
        crawlFile,
        listingPagesPerRun,
        outOfBudget: () =>
          counters.pastes + counters.replays >= maxNew ||
          budget.threadPages >= maxThreadPages,
      });
    } catch (error) {
      console.warn(`tournament listing ${listing}: FAILED — ${error.message}`);
    }
  }
  console.log(
    `tournament: +${counters.pastes} paste teams, +${counters.replays} replays`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const run = async () => {
    try {
      await main();
    } finally {
      await closeTeamSourceFetcher();
    }
  };
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
