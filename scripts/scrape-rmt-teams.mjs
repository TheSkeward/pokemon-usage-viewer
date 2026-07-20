/**
 * @fileoverview RMT-forum harvester: walks the Smogon RMT forum listings in
 * teamscrape/sources.json (rmt.listings), maps each thread's prefix label
 * to a format id — directly via rmt.prefixMap ("SM OU"), or a
 * generation-only label ("Gen 7", rmt.genPrefixMap) refined by the tier in
 * the thread title — and harvests the OPENING POST only — the team being
 * rated. Replies are suggested edits, not teams.
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
import {
  extractFirstPostText,
  extractThreadRows,
  listingDebugInfo,
} from './teamscrape/forum-html.mjs';
import { REAL_FORMATS } from './config.mjs';

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

const knownFormats = new Set(REAL_FORMATS.map((format) => format.id));

// Tier named in a thread title, most-specific first ("Doubles UU" must not
// read as UU; "OU" appears inside almost every compound tier name).
const TIER_PATTERNS = [
  ['doublesubers', /\bdoubles?\s*ubers\b/i],
  ['doublesuu', /\bdoubles?\s*uu\b/i],
  ['doublesou', /\bdoubles\b/i],
  ['anythinggoes', /\banything\s*goes\b|\bAG\b/],
  ['ubers', /\bubers?\b/i],
  ['nfe', /\bNFE\b/i],
  ['zu', /\bZU\b/i],
  ['lc', /\bLC\b|\blittle\s*cup\b/i],
  ['pu', /\bPU\b/i],
  ['nu', /\bNU\b/i],
  ['ru', /\bRU\b/i],
  ['uu', /\bUU\b/i],
  ['ou', /\bOU\b/i],
];

/**
 * Thread → format id: the explicit prefix map first ("SM OU"), else a
 * generation-only prefix ("Gen 7", the RMT Archive's labeling) refined by
 * the tier named in the thread title.
 * @return {?string}
 */
function resolveFormat(row, rmt) {
  if (!row.prefix) return null;
  const direct = rmt.prefixMap?.[row.prefix];
  if (direct) return direct;
  const gen = rmt.genPrefixMap?.[row.prefix];
  if (gen) {
    for (const [tier, pattern] of TIER_PATTERNS) {
      if (pattern.test(row.title || '')) {
        return knownFormats.has(gen + tier) ? gen + tier : null;
      }
    }
  }
  return null;
}

async function fetchText(url) {
  await sleep(REQUEST_GAP_MS);
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
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
      let rowsSeen = 0;
      let pagesWalked = 0;
      for (
        let page = 1; page <= MAX_LISTING_PAGES && fresh < maxNew; page += 1) {
        const url = page === 1 ? listing : `${listing}page-${page}`;
        const html = await fetchText(url);
        const rows = extractThreadRows(html, listing);
        if (!rows.length) {
          if (page === 1) {
            console.log(
              `rmt listing ${listing}: 0 rows on page 1 ` +
                `(${listingDebugInfo(html)})`,
            );
          }
          break;
        }
        pagesWalked += 1;
        rowsSeen += rows.length;
        for (const row of rows) {
          if (fresh >= maxNew) break;
          const formatId = resolveFormat(row, rmt);
          if (!formatId) {
            const known =
              rmt.prefixMap?.[row.prefix] || rmt.genPrefixMap?.[row.prefix];
            if (row.prefix && !known)
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
      if (rowsSeen) {
        console.log(
          `rmt listing ${listing}: ${rowsSeen} row(s) across ` +
            `${pagesWalked} page(s)`,
        );
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
