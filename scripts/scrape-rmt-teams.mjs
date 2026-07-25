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
 * Same politeness contract as the other scrapers. A durable listing cursor
 * turns the per-run page budget into resumable work, while page 1 is checked
 * every run for new or recently updated RMTs.
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
  extractFirstPostText,
  extractThreadRows,
  hasNextPage,
  listingDebugInfo,
} from './teamscrape/forum-html.mjs';
import {
  forListing,
  importLegacyThreads,
  readCrawlState,
  recordDeferredThread,
  recordSinglePageThread,
  saveCrawlState,
  shouldScanThread,
} from './teamscrape/crawl-state.mjs';
import {
  parseBudget,
  walkListingPages,
} from './teamscrape/listing-walk.mjs';
import { tierFromTitle } from './teamscrape/tier-names.mjs';
import {
  closeTeamSourceFetcher,
  fetchTeamSourceText as fetchText,
} from './teamscrape/forum-fetch.mjs';
import { REAL_FORMATS } from './config.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE_DIR = path.join(scriptDir, 'teamscrape', 'archive');
const SOURCES_PATH = path.join(scriptDir, 'teamscrape', 'sources.json');

const DEFAULT_MAX_NEW_THREADS = 40;
const DEFAULT_LISTING_PAGES_PER_RUN = 8;

const knownFormats = new Set(REAL_FORMATS.map((format) => format.id));

/**
 * Thread → format id: the explicit prefix map first ("SM OU"), else a
 * generation-only prefix ("Gen 7", the past-gen forum's labeling) refined
 * by the tier named in the thread title.
 * @return {?string}
 */
function resolveFormat(row, rmt) {
  if (!row.prefix) return null;
  const direct = rmt.prefixMap?.[row.prefix];
  if (direct) return direct;
  const gen = rmt.genPrefixMap?.[row.prefix];
  if (gen) {
    const tier = tierFromTitle(row.title);
    if (tier) return knownFormats.has(gen + tier) ? gen + tier : null;
  }
  return null;
}

async function harvestThread({ row, formatId, latest, file }) {
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
    return {
      appended: Number(appendJsonlRecord(file, record, latest)),
      found: 1,
      opChars: text.length,
    };
  }
  let appended = 0;
  let found = 0;
  for (const pasteId of extractPasteIds(html)) {
    let pasteText;
    try {
      pasteText = await fetchText(`https://pokepast.es/${pasteId}/raw`);
    } catch {
      continue;
    }
    const paste = parseShowdownTeam(pasteText);
    if (paste.sets.length < MIN_SETS_PER_TEAM) continue;
    found += 1;
    const record = normalizeSampleTeam({
      pasteId,
      formatId,
      thread: row.url,
      sets: paste.sets,
    });
    record.source = 'rmt';
    appended += Number(appendJsonlRecord(file, record, latest));
  }
  return { appended, found, opChars: text.length };
}

async function main() {
  const { rmt } = JSON.parse(fs.readFileSync(SOURCES_PATH, 'utf8'));
  if (!rmt?.listings?.length) {
    console.log('rmt: no listings configured');
    return;
  }
  const maxNew = parseBudget(process.argv, 'max-new', DEFAULT_MAX_NEW_THREADS);
  const listingPagesPerRun =
    parseBudget(process.argv, 'listing-pages', DEFAULT_LISTING_PAGES_PER_RUN);
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  const crawlFile = path.join(ARCHIVE_DIR, 'rmt-crawl-state.json');
  const crawl = readCrawlState(crawlFile);
  for (const name of fs.readdirSync(ARCHIVE_DIR)) {
    if (/^rmt-.*\.jsonl$/.test(name)) {
      importLegacyThreads(crawl, path.join(ARCHIVE_DIR, name));
    }
  }
  saveCrawlState(crawlFile, crawl);
  const archives = createFormatArchives(ARCHIVE_DIR, 'rmt-');

  let fresh = 0;
  const unmappedPrefixes = new Map();
  for (const listing of rmt.listings) {
    try {
      let rowsSeen = 0;
      let pagesWalked = 0;
      const progress = forListing(crawl, listing);
      const processPage = async (html, page) => {
        const rows = extractThreadRows(html, listing);
        if (!rows.length) {
          if (page === 1) {
            console.log(
              `rmt listing ${listing}: 0 rows on page 1 ` +
              `(${listingDebugInfo(html)})`,
            );
          }
          return { handled: true, next: false };
        }
        pagesWalked += 1;
        rowsSeen += rows.length;
        let handled = true;
        for (const row of rows) {
          if (fresh >= maxNew) {
            handled = false;
            break;
          }
          const formatId = resolveFormat(row, rmt);
          if (!formatId) {
            const known =
              rmt.prefixMap?.[row.prefix] || rmt.genPrefixMap?.[row.prefix];
            if (row.prefix && !known)
              unmappedPrefixes.set(
                row.prefix, (unmappedPrefixes.get(row.prefix) || 0) + 1);
            continue;
          }
          const { file, latest } = archives.forFormat(formatId);
          if (!shouldScanThread(
            crawl.threads[row.threadId], row, progress.sweep)) continue;
          try {
            const { appended, found, opChars } =
              await harvestThread({ row, formatId, latest, file });
            if (appended) fresh += 1;
            else if (!found && opChars >= 200) {
              // Persist a teamless marker so later sweeps can distinguish a
              // processed thread from one whose post reader failed.
              // The index builders drop empty-set records. A near-empty
              // extraction means the post reader failed, not that the
              // thread is teamless — leave those unmarked so a fixed
              // reader gets another look.
              const marker = `thread-${row.threadId}`;
              if (!latest.has(marker)) {
                appendJsonlRecord(
                  file,
                  { id: marker, format: formatId, source: 'rmt', sets: [] },
                  latest,
                );
              }
            }
            if (found || opChars >= 200) {
              recordSinglePageThread(crawl, row, progress.sweep);
            } else {
              // A short OP with no qualifying paste is a deterministic
              // non-result (image-only RMTs are common). Defer the thread —
              // retried every run in case the reader was at fault — but let
              // the cursor advance: one such thread must not freeze the
              // sweep for every page behind it.
              recordDeferredThread(crawl, row, progress.sweep);
            }
            saveCrawlState(crawlFile, crawl);
          } catch (error) {
            console.warn(`  thread ${row.threadId}: ${error.message}`);
            handled = false;
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
        outOfBudget: () => fresh >= maxNew,
      });
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
  for (const [formatId, { latest }] of archives.entries()) {
    console.log(`rmt ${formatId}: archive ${latest.size}`);
  }
  if (unmappedPrefixes.size) {
    console.log(
      `rmt: unmapped prefixes (add to sources.json rmt.prefixMap to harvest): ${[...unmappedPrefixes.entries()].map(([p, n]) => `"${p}"×${n}`).join(', ')}`,
    );
  }
  console.log(`rmt: +${fresh} new teams this run`);
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
