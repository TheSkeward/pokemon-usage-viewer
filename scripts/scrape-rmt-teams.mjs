/**
 * @fileoverview RMT-forum harvester: walks the Smogon RMT forum listings in
 * teamscrape/sources.json (rmt.listings), maps each thread's prefix label
 * ("SM OU") to a format id via rmt.prefixMap, and harvests the OPENING POST
 * only — the team being rated. Replies are suggested edits, not teams.
 * RMT teams are usually pasted inline rather than pokepaste-linked, so both
 * are extracted. Lowest-trust source: the index builders weight rmt below
 * curated samples and rated replays.
 *
 * Same politeness contract as the other scrapers; --max-new bounds fresh
 * threads per run, and already-seen threads skip fast, so successive
 * scheduled runs walk ever deeper into the listings.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseShowdownTeam } from './teamscrape/parse-showdown-team.mjs';
import { normalizeSampleTeam } from './scrape-sample-teams.mjs';
import { readArchiveIds } from './scrape-replay-teams.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE_DIR = path.join(scriptDir, 'teamscrape', 'archive');
const SOURCES_PATH = path.join(scriptDir, 'teamscrape', 'sources.json');

const USER_AGENT =
  'pokemon-usage-viewer team harvester (github.com/TheSkeward/pokemon-usage-viewer)';
const REQUEST_GAP_MS = 900;
const MAX_LISTING_PAGES = 30;
const DEFAULT_MAX_NEW_THREADS = 40;
const MIN_SETS_PER_TEAM = 4; // an RMT below this is a fragment, not a team

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchText(url) {
  await sleep(REQUEST_GAP_MS);
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}

/** @return {string} Plain text: tags stripped, common entities decoded. */
export function htmlToText(html) {
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|blockquote)>/gi, '\n')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/**
 * Listing rows: prefix label span(s) followed by the thread link. Returns
 * [{threadId, url, prefix}] in listing order; prefix null when unlabeled.
 *
 * @return {!Array<{threadId: string, url: string, prefix: ?string}>}
 */
export function extractThreadRows(html, baseUrl) {
  const rows = [];
  const seen = new Set();
  const rowRegex =
    /(?:<span[^>]*class="label[^"]*"[^>]*>([^<]+)<\/span>[\s\S]{0,400}?)?<a[^>]+href="(\/threads\/[^"]*?\.(\d+)\/)"[^>]*(?:data-preview-url|class="")/g;
  for (const match of html.matchAll(rowRegex)) {
    const [, prefix, href, threadId] = match;
    if (seen.has(threadId)) continue;
    seen.add(threadId);
    rows.push({
      threadId,
      url: new URL(href, baseUrl).href,
      prefix: prefix ? htmlToText(prefix).trim() : null,
    });
  }
  return rows;
}

/** The opening post is the first message body on page 1. */
export function extractFirstPostText(html) {
  const match = String(html).match(
    /<article[^>]*class="[^"]*message-body[^"]*"[^>]*>([\s\S]*?)<\/article>|<div[^>]*class="[^"]*bbWrapper[^"]*"[^>]*>([\s\S]*?)<\/div>/,
  );
  return match ? htmlToText(match[1] || match[2] || '') : '';
}

async function harvestThread({ row, formatId, seen, file }) {
  const html = await fetchText(row.url);
  const text = extractFirstPostText(html);
  const { sets } = parseShowdownTeam(text);
  // Inline sets first; pokepaste links are the fallback for OPs that link out.
  if (sets.length >= MIN_SETS_PER_TEAM) {
    const record = normalizeSampleTeam({
      pasteId: `thread-${row.threadId}`,
      formatId,
      thread: row.url,
      sets,
    });
    record.source = 'rmt';
    fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
    seen.add(record.id);
    return 1;
  }
  let appended = 0;
  for (const pasteId of [...new Set(
    [...html.matchAll(/pokepast\.es\/([0-9a-f]{8,16})/g)].map((m) => m[1]),
  )]) {
    if (seen.has(pasteId)) continue;
    let pasteText;
    try {
      pasteText = await fetchText(`https://pokepast.es/${pasteId}/raw`);
    } catch {
      continue;
    }
    const paste = parseShowdownTeam(pasteText);
    if (paste.sets.length < MIN_SETS_PER_TEAM) continue;
    const record = normalizeSampleTeam({
      pasteId,
      formatId,
      thread: row.url,
      sets: paste.sets,
    });
    record.source = 'rmt';
    fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
    seen.add(pasteId);
    appended += 1;
  }
  return appended;
}

async function main() {
  const { rmt } = JSON.parse(fs.readFileSync(SOURCES_PATH, 'utf8'));
  if (!rmt?.listings?.length) {
    console.log('rmt: no listings configured');
    return;
  }
  const maxNew =
    Number(process.argv.find((a) => a.startsWith('--max-new='))?.split('=')[1]) ||
    DEFAULT_MAX_NEW_THREADS;
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  const files = new Map(); // formatId → {file, seen}
  const forFormat = (formatId) => {
    if (!files.has(formatId)) {
      const file = path.join(ARCHIVE_DIR, `rmt-${formatId}.jsonl`);
      files.set(formatId, { file, seen: readArchiveIds(file) });
    }
    return files.get(formatId);
  };

  let fresh = 0;
  const unmappedPrefixes = new Map();
  for (const listing of rmt.listings) {
    try {
      for (
        let page = 1; page <= MAX_LISTING_PAGES && fresh < maxNew; page += 1) {
        const url = page === 1 ? listing : `${listing}page-${page}`;
        const rows = extractThreadRows(await fetchText(url), listing);
        if (!rows.length) break;
        for (const row of rows) {
          if (fresh >= maxNew) break;
          const formatId = row.prefix ? rmt.prefixMap?.[row.prefix] : null;
          if (!formatId) {
            if (row.prefix)
              unmappedPrefixes.set(
                row.prefix, (unmappedPrefixes.get(row.prefix) || 0) + 1);
            continue;
          }
          const { file, seen } = forFormat(formatId);
          if (seen.has(`thread-${row.threadId}`)) continue;
          try {
            const appended = await harvestThread({ row, formatId, seen, file });
            if (appended) fresh += 1;
            else {
              // Persist a teamless marker so later runs never refetch it.
              // The index builders drop empty-set records.
              const marker = `thread-${row.threadId}`;
              fs.appendFileSync(
                file,
                `${JSON.stringify({ id: marker, format: formatId, source: 'rmt', sets: [] })}\n`,
              );
              seen.add(marker);
            }
          } catch (error) {
            console.warn(`  thread ${row.threadId}: ${error.message}`);
          }
        }
      }
    } catch (error) {
      console.warn(`rmt listing ${listing}: FAILED — ${error.message}`);
    }
  }
  for (const [formatId, { seen }] of files) {
    console.log(`rmt ${formatId}: archive ${seen.size}`);
  }
  if (unmappedPrefixes.size) {
    console.log(
      `rmt: unmapped prefixes (add to sources.json rmt.prefixMap to harvest): ${[...unmappedPrefixes.entries()].map(([p, n]) => `"${p}"×${n}`).join(', ')}`,
    );
  }
  console.log(`rmt: +${fresh} new teams this run`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
