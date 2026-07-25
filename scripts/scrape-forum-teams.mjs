/**
 * @fileoverview Competitive-discussion forum harvester: walks the configured
 * forum roots (teamscrape/sources.json `forums.listings`, e.g. Gen 7
 * Competitive Discussion) plus their one-level subforums, and harvests whole
 * teams from every post of every thread — bazaars, teambuilding
 * competitions, resource threads. Community-shared rather than curated, so
 * records carry source:"forum" and the index builders weight them at the
 * community-paste tier, far below samples.
 *
 * Format attribution, most→least reliable: the paste's own "=== [gen7ou] ==="
 * header, the tier named in the thread title, the tier named in the
 * subforum's name — the last two combined with the config's `gen`.
 * Listing and thread cursors are durable, so polite per-run request caps pause
 * work rather than truncating the corpus. Completed listings begin another
 * sweep, and completed threads recheck their final page for later replies.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseShowdownTeam } from './teamscrape/parse-showdown-team.mjs';
import { normalizeSampleTeam, extractPasteIds, groupInlineTeams } from
  './scrape-sample-teams.mjs';
import {
  appendJsonlRecord,
  readJsonlLatest,
} from './teamscrape/jsonl-records.mjs';
import {
  extractPosts,
  extractThreadRows,
  hasNextPage,
  listingDebugInfo,
  listingPageUrl,
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
import { tierFromTitle } from './teamscrape/tier-names.mjs';
import { REAL_FORMATS } from './config.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE_DIR = path.join(scriptDir, 'teamscrape', 'archive');
const SOURCES_PATH = path.join(scriptDir, 'teamscrape', 'sources.json');

const DEFAULT_MAX_NEW = 40;
const DEFAULT_LISTING_PAGES_PER_RUN = 4;
const DEFAULT_THREAD_PAGES_PER_RUN = 40;
const MIN_SETS_PER_TEAM = 4;

const knownFormats = new Set(REAL_FORMATS.map((format) => format.id));
/**
 * Subforum links on a forum index page: the node list's title anchors.
 * @return {!Array<{url: string, name: string}>}
 */
export function extractSubforums(html, baseUrl) {
  const out = [];
  const seen = new Set();
  for (const match of String(html).matchAll(
    /class="node-title"[^>]*>\s*<a href="((?:\/forums)?\/forums\/[^"]+?\.\d+\/)"[^>]*>([^<]*)/g,
  )) {
    const url = new URL(match[1], baseUrl).href;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ url, name: match[2].trim() });
  }
  return out;
}

const archiveState = new Map(); // formatId → {file, latest}
function forFormat(formatId) {
  if (!archiveState.has(formatId)) {
    const file = path.join(ARCHIVE_DIR, `forum-${formatId}.jsonl`);
    archiveState.set(formatId, { file, latest: readJsonlLatest(file) });
  }
  return archiveState.get(formatId);
}

function appendTeam({ pasteId, formatId, thread, sets }) {
  const { file, latest } = forFormat(formatId);
  const record = normalizeSampleTeam({ pasteId, formatId, thread, sets });
  record.source = 'forum';
  return Number(appendJsonlRecord(file, record, latest));
}

async function harvestThread({ row, fallbackFormat, counters, crawl,
  crawlFile, sweep, budget, maxThreadPages, maxNew }) {
  let page = nextThreadPage(crawl.threads[row.threadId]);
  while (budget.threadPages < maxThreadPages) {
    const html = await fetchText(
      page === 1 ? row.url : `${row.url}page-${page}`);
    budget.threadPages += 1;
    const posts = extractPosts(html);
    let postIndex = (page - 1) * 100;
    for (const post of posts.length ? posts : [{ html, text: '' }]) {
      postIndex += 1;
      for (const pasteId of extractPasteIds(post.html)) {
        let parsed;
        try {
          parsed = parseShowdownTeam(
            await fetchText(`https://pokepast.es/${pasteId}/raw`));
        } catch {
          continue;
        }
        const formatId =
          parsed.format && knownFormats.has(parsed.format)
            ? parsed.format
            : fallbackFormat;
        if (!formatId || parsed.sets.length < MIN_SETS_PER_TEAM) continue;
        counters.teams += appendTeam(
          { pasteId, formatId, thread: row.url, sets: parsed.sets });
      }
      if (!fallbackFormat || !post.text) continue;
      const { sets } = parseShowdownTeam(post.text);
      groupInlineTeams(sets).forEach((teamSets, group) => {
        counters.teams += appendTeam({
          pasteId: `thread-${row.threadId}-p${postIndex}-${group}`,
          formatId: fallbackFormat,
          thread: row.url,
          sets: teamSets,
        });
      });
    }
    const next = hasNextPage(html, page);
    recordThreadPage(crawl, row, { page, hasNext: next, sweep });
    saveCrawlState(crawlFile, crawl);
    if (!next) return true;
    if (counters.teams >= maxNew) return false;
    page += 1;
  }
  return false;
}

async function walkListing({ listing, gen, listingTier, config, counters,
  crawl, crawlFile, maxNew, budget, maxThreadPages, listingPagesPerRun }) {
  const rowFormat = (row) => {
    const tier = tierFromTitle(row.title) || listingTier;
    const formatId = tier ? gen + tier : null;
    return formatId && knownFormats.has(formatId) ? formatId : null;
  };
  const progress = forListing(crawl, listing);
  const processPage = async (html, page) => {
    if (page === 1 && config.discoverSubforums) {
      for (const sub of extractSubforums(html, listing)) {
        if (!config.walked.has(sub.url)) {
          config.walked.add(sub.url);
          config.queue.push(
            { listing: sub.url, tier: tierFromTitle(sub.name) });
        }
      }
    }
    const rows = extractThreadRows(html, listing);
    if (!rows.length) {
      if (page === 1) {
        console.log(
          `forum listing ${listing}: 0 rows on page 1 ` +
            `(${listingDebugInfo(html)})`,
        );
      }
      return { handled: true, next: false };
    }
    let handled = true;
    for (const row of rows) {
      if (counters.teams >= maxNew || budget.threadPages >= maxThreadPages) {
        handled = false;
        break;
      }
      const thread = crawl.threads[row.threadId];
      if (!shouldScanThread(thread, row, progress.sweep)) continue;
      const fallbackFormat = rowFormat(row);
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

  // Always inspect the live first page for newly created or recently active
  // threads, independently of the historical backfill cursor.
  const headHtml = await fetchText(listingPageUrl(listing, 1));
  const head = await processPage(headHtml, 1);
  if (!head.handled || counters.teams >= maxNew) return;

  let pages = 0;
  while (
    pages < listingPagesPerRun &&
    counters.teams < maxNew &&
    budget.threadPages < maxThreadPages
  ) {
    const page = progress.page;
    const html = page === 1
      ? headHtml
      : await fetchText(listingPageUrl(listing, page));
    const result = page === 1 ? head : await processPage(html, page);
    if (!result.handled) return;
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
}

async function main() {
  const { forums } = JSON.parse(fs.readFileSync(SOURCES_PATH, 'utf8'));
  if (!forums?.listings?.length) {
    console.log('forums: no listings configured');
    return;
  }
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
  const crawlFile = path.join(ARCHIVE_DIR, 'forum-crawl-state.json');
  const crawl = readCrawlState(crawlFile);
  importLegacyThreads(
    crawl,
    path.join(ARCHIVE_DIR, 'forum-threads.jsonl'),
  );
  saveCrawlState(crawlFile, crawl);
  const counters = { teams: 0 };
  const budget = { threadPages: 0 };
  const gen = forums.gen || 'gen7';
  const config = {
    discoverSubforums: Boolean(forums.discoverSubforums),
    walked: new Set(forums.listings),
    queue: forums.listings.map((listing) => ({ listing, tier: null })),
  };

  while (config.queue.length && counters.teams < maxNew) {
    const { listing, tier } = config.queue.shift();
    try {
      await walkListing({
        listing, gen, listingTier: tier, config, counters,
        crawl, crawlFile, maxNew, budget, maxThreadPages,
        listingPagesPerRun,
      });
    } catch (error) {
      console.warn(`forum listing ${listing}: FAILED — ${error.message}`);
    }
  }
  for (const [formatId, { latest }] of archiveState) {
    console.log(`forum ${formatId}: archive ${latest.size}`);
  }
  console.log(`forums: +${counters.teams} teams this run`);
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
