/**
 * @fileoverview Durable progress for bounded forum crawls. Per-run request
 * budgets keep CI polite, while listing and thread cursors make those budgets
 * resumable instead of silently becoming corpus boundaries.
 */
import fs from 'node:fs';
import path from 'node:path';

const VERSION = 1;

/** @return {{version: number, listings: !Object, threads: !Object}} */
export function readCrawlState(file) {
  if (!fs.existsSync(file)) {
    return { version: VERSION, listings: {}, threads: {} };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      version: VERSION,
      listings: parsed?.listings && typeof parsed.listings === 'object'
        ? parsed.listings
        : {},
      threads: parsed?.threads && typeof parsed.threads === 'object'
        ? parsed.threads
        : {},
    };
  } catch {
    // The state is only a cursor. Archives dedupe a restarted scan, so a torn
    // state file is safe to rebuild from the beginning.
    return { version: VERSION, listings: {}, threads: {} };
  }
}

/** Persist a compact snapshot after each completed unit of crawl work. */
export function saveCrawlState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
}

/**
 * Import the old one-shot thread marker logs conservatively. A legacy marker
 * proves page 1 was fetched successfully, but not whether it had another page;
 * recheck page 1 and let normal end-of-pagination detection settle it.
 * RMT archives use thread-<id> record ids, while forum marker logs use bare
 * numeric ids, so both forms are accepted.
 */
export function importLegacyThreads(state, file) {
  if (!fs.existsSync(file)) return 0;
  let imported = 0;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      const match = /^(?:thread-)?(\d+)$/.exec(String(record.id || ''));
      if (!match || state.threads[match[1]]) continue;
      state.threads[match[1]] = {
        url: record.thread || null,
        lastPage: 1,
        nextPage: 1,
        complete: false,
        lastSweep: -1,
        listingUpdatedAt: null,
      };
      imported += 1;
    } catch {
      // Ignore torn legacy lines just like the archive readers do.
    }
  }
  return imported;
}

/** @return {{page: number, sweep: number}} */
export function forListing(state, listing) {
  if (!state.listings[listing]) state.listings[listing] = { page: 1, sweep: 0 };
  return state.listings[listing];
}

/**
 * The first encounter scans page 1. Interrupted threads resume at nextPage;
 * completed threads recheck their final page, where later replies land.
 */
export function nextThreadPage(thread) {
  if (!thread) return 1;
  if (!thread.complete) return Math.max(1, Number(thread.nextPage) || 1);
  return Math.max(1, Number(thread.lastPage) || 1);
}

/**
 * Recheck incomplete/new threads immediately. Completed threads are revisited
 * when the listing says they changed, or once per full listing sweep as a
 * fallback for markup that exposes no reliable update timestamp.
 */
export function shouldScanThread(thread, row, sweep) {
  if (!thread || !thread.complete) return true;
  if (row.updatedAt != null) {
    return Number(row.updatedAt) !== Number(thread.listingUpdatedAt);
  }
  return Number(thread.lastSweep) !== Number(sweep);
}

/** Record one successfully parsed thread page. */
export function recordThreadPage(
  state,
  row,
  { page, hasNext, sweep },
) {
  state.threads[row.threadId] = {
    url: row.url,
    lastPage: page,
    nextPage: hasNext ? page + 1 : page,
    complete: !hasNext,
    lastSweep: sweep,
    listingUpdatedAt: row.updatedAt ?? null,
  };
  return state.threads[row.threadId];
}

/**
 * Record a thread whose scan deterministically produced nothing usable this
 * run — a bare or unreadable opening post, or a permanently refused fetch.
 * Kept incomplete so every later run retries it (page 1), while the listing
 * cursor moves on: one stubborn thread must not freeze the sweep for every
 * page behind it.
 * @return {!Object} The stored thread state.
 */
export function recordDeferredThread(state, row, sweep) {
  state.threads[row.threadId] = {
    url: row.url,
    lastPage: 1,
    nextPage: 1,
    complete: false,
    lastSweep: sweep,
    listingUpdatedAt: row.updatedAt ?? null,
  };
  return state.threads[row.threadId];
}

/** Record a single-page source such as an RMT opening post. */
export function recordSinglePageThread(state, row, sweep) {
  return recordThreadPage(
    state,
    row,
    { page: 1, hasNext: false, sweep },
  );
}

/**
 * Advance the durable listing cursor only after every row on the page was
 * handled. Reaching the real final page starts a new sweep instead of freezing
 * the crawler forever, so edits and revived old threads are eventually seen.
 * The return value says whether the CURRENT sweep has another page; callers
 * must stop their per-run loop on false so they do not wrap into a second
 * sweep during the same harvest.
 * @return {boolean}
 */
export function recordListingPage(state, listing, page, hasNext) {
  const progress = forListing(state, listing);
  if (page !== progress.page) return false;
  if (hasNext) progress.page = page + 1;
  else {
    progress.page = 1;
    progress.sweep += 1;
  }
  return Boolean(hasNext);
}
