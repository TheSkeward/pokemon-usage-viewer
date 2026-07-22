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
import { parseShowdownTeam } from './teamscrape/parse-showdown-team.mjs';
import { normalizeSampleTeam } from './scrape-sample-teams.mjs';
import {
  appendJsonlRecord,
  readJsonlLatest,
} from './teamscrape/jsonl-records.mjs';
import {
  archivePath,
  normalizeReplay,
  readArchiveIds,
} from './scrape-replay-teams.mjs';
import {
  extractThreadRows,
  hasNextPage,
  htmlToText,
  listingDebugInfo,
  listingPageUrl,
} from './teamscrape/forum-html.mjs';
import {
  forListing,
  importLegacyThreads,
  nextThreadPage,
  readCrawlState,
  recordListingPage,
  recordThreadPage,
  saveCrawlState,
  shouldScanThread,
} from './teamscrape/crawl-state.mjs';
import {
  closeTeamSourceFetcher,
  fetchTeamSourceText as fetchText,
} from './teamscrape/forum-fetch.mjs';
import { REAL_FORMATS } from './config.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE_DIR = path.join(scriptDir, 'teamscrape', 'archive');
const SOURCES_PATH = path.join(scriptDir, 'teamscrape', 'sources.json');

const DEFAULT_MAX_NEW = 40;
const DEFAULT_LISTING_PAGES_PER_RUN = 4;
const DEFAULT_THREAD_PAGES_PER_RUN = 40;
const MIN_SETS_PER_TEAM = 4;

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

const pasteState = new Map(); // formatId → {file, latest}
function forFormat(formatId) {
  if (!pasteState.has(formatId)) {
    const file = path.join(ARCHIVE_DIR, `tournament-${formatId}.jsonl`);
    pasteState.set(formatId, { file, latest: readJsonlLatest(file) });
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
    const { file, latest } = forFormat(formatId);
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
  const maxNew =
    Number(process.argv.find((a) => a.startsWith('--max-new='))?.split('=')[1]) ||
    DEFAULT_MAX_NEW;
  const listingPagesPerRun =
    Number(process.argv.find((a) => a.startsWith('--listing-pages='))?.split('=')[1]) ||
    DEFAULT_LISTING_PAGES_PER_RUN;
  const maxThreadPages =
    Number(process.argv.find((a) => a.startsWith('--thread-pages='))?.split('=')[1]) ||
    DEFAULT_THREAD_PAGES_PER_RUN;
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
            handled = false;
          }
        }
        return { handled, next: hasNextPage(html, page) };
      };

      const headHtml = await fetchText(listingPageUrl(listing, 1));
      const head = await processPage(headHtml, 1);
      if (!head.handled) continue;
      let pages = 0;
      while (
        pages < listingPagesPerRun &&
        counters.pastes + counters.replays < maxNew &&
        budget.threadPages < maxThreadPages
      ) {
        const page = progress.page;
        const html = page === 1
          ? headHtml
          : await fetchText(listingPageUrl(listing, page));
        const result = page === 1 ? head : await processPage(html, page);
        if (!result.handled) break;
        const sweepContinues = recordListingPage(
          crawl,
          listing,
          page,
          result.next,
        );
        saveCrawlState(crawlFile, crawl);
        pages += 1;
        if (!sweepContinues) break;
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
