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
 * Threads are visited once and remembered (forum-threads.jsonl), so daily
 * runs walk ever deeper under a per-run yield cap.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseShowdownTeam } from './teamscrape/parse-showdown-team.mjs';
import { normalizeSampleTeam, extractPasteIds, groupInlineTeams } from
  './scrape-sample-teams.mjs';
import { readArchiveIds } from './scrape-replay-teams.mjs';
import {
  extractPosts,
  extractThreadRows,
  listingDebugInfo,
  listingPageUrl,
} from './teamscrape/forum-html.mjs';
import { tierFromTitle } from './teamscrape/tier-names.mjs';
import { REAL_FORMATS } from './config.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE_DIR = path.join(scriptDir, 'teamscrape', 'archive');
const SOURCES_PATH = path.join(scriptDir, 'teamscrape', 'sources.json');

const USER_AGENT =
  'pokemon-usage-viewer team harvester (github.com/TheSkeward/pokemon-usage-viewer)';
const REQUEST_GAP_MS = 900;
const MAX_LISTING_PAGES = 10;
const MAX_THREAD_PAGES = 5;
const DEFAULT_MAX_NEW = 40;
const MIN_SETS_PER_TEAM = 4;

const knownFormats = new Set(REAL_FORMATS.map((format) => format.id));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchText(url) {
  await sleep(REQUEST_GAP_MS);
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}

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

const state = new Map(); // formatId → {file, seen}
function forFormat(formatId) {
  if (!state.has(formatId)) {
    const file = path.join(ARCHIVE_DIR, `forum-${formatId}.jsonl`);
    state.set(formatId, { file, seen: readArchiveIds(file) });
  }
  return state.get(formatId);
}

function appendTeam({ pasteId, formatId, thread, sets }) {
  const { file, seen } = forFormat(formatId);
  if (seen.has(pasteId)) return 0;
  const record = normalizeSampleTeam({ pasteId, formatId, thread, sets });
  record.source = 'forum';
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
  seen.add(pasteId);
  return 1;
}

async function harvestThread({ row, fallbackFormat, counters }) {
  for (let page = 1; page <= MAX_THREAD_PAGES; page += 1) {
    let html;
    try {
      html = await fetchText(
        page === 1 ? row.url : `${row.url}page-${page}`);
    } catch (error) {
      if (page === 1) throw error;
      break; // past the last page
    }
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
  }
}

async function walkListing({ listing, gen, listingTier, config, counters,
  visited, visitedFile, maxNew }) {
  const rowFormat = (row) => {
    const tier = tierFromTitle(row.title) || listingTier;
    const formatId = tier ? gen + tier : null;
    return formatId && knownFormats.has(formatId) ? formatId : null;
  };
  for (let page = 1; page <= MAX_LISTING_PAGES; page += 1) {
    if (counters.teams >= maxNew) return;
    const html = await fetchText(listingPageUrl(listing, page));
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
      return;
    }
    for (const row of rows) {
      if (counters.teams >= maxNew) return;
      if (visited.has(row.threadId)) continue;
      const fallbackFormat = rowFormat(row);
      try {
        await harvestThread({ row, fallbackFormat, counters });
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
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  const visitedFile = path.join(ARCHIVE_DIR, 'forum-threads.jsonl');
  const visited = readArchiveIds(visitedFile);
  const counters = { teams: 0 };
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
        visited, visitedFile, maxNew,
      });
    } catch (error) {
      console.warn(`forum listing ${listing}: FAILED — ${error.message}`);
    }
  }
  for (const [formatId, { seen }] of state) {
    console.log(`forum ${formatId}: archive ${seen.size}`);
  }
  console.log(`forums: +${counters.teams} teams this run`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
