/**
 * @fileoverview Shared driver for the forum listing scrapers: one walk over
 * a thread listing that combines a live head-page check with the
 * durable-cursor backfill loop, plus the per-run budget flags that bound
 * each harvest.
 */
import {
  forListing,
  recordListingPage,
  saveCrawlState,
} from './crawl-state.mjs';
import { listingPageUrl } from './forum-html.mjs';

/**
 * Reads a `--<flag>=<count>` per-run budget from argv.
 * @param {!Array<string>} argv Process arguments.
 * @param {string} flag Flag name without the leading dashes, e.g. 'max-new'.
 * @param {number} fallback Budget when the flag is absent or unreadable.
 * @return {number}
 */
export function parseBudget(argv, flag, fallback) {
  const prefix = `--${flag}=`;
  const value = argv.find((arg) => arg.startsWith(prefix))?.split('=')[1];
  return Number(value) || fallback;
}

/**
 * Walks one forum listing within this run's budgets. The live first page is
 * always fetched and processed so newly created or recently active threads
 * are seen every run, independently of the historical backfill cursor. The
 * cursor then advances through at most listingPagesPerRun pages of the
 * current sweep, persisting crawl state after each handled page. An
 * unhandled page (processPage returned handled: false — the budget ran out
 * mid-page or a thread needs a retry) ends the walk without advancing the
 * cursor, and a sweep that wraps ends the walk rather than starting a
 * second sweep in the same run.
 *
 * @param {{
 *   listing: string,
 *   fetchText: function(string): !Promise<string>,
 *   processPage: function(string, number):
 *       !Promise<{handled: boolean, next: boolean}>,
 *   crawl: !Object,
 *   crawlFile: string,
 *   listingPagesPerRun: number,
 *   outOfBudget: function(): boolean,
 * }} options listing is the crawl-state key and page-URL base; processPage
 *     receives (html, pageNumber); outOfBudget reports whether this run's
 *     harvest budgets are exhausted.
 * @return {!Promise<void>}
 */
export async function walkListingPages({ listing, fetchText, processPage,
  crawl, crawlFile, listingPagesPerRun, outOfBudget }) {
  const progress = forListing(crawl, listing);
  const headHtml = await fetchText(listingPageUrl(listing, 1));
  const head = await processPage(headHtml, 1);
  if (!head.handled) return;
  let pages = 0;
  while (pages < listingPagesPerRun && !outOfBudget()) {
    const page = progress.page;
    const html = page === 1
      ? headHtml
      : await fetchText(listingPageUrl(listing, page));
    const result = page === 1 ? head : await processPage(html, page);
    if (!result.handled) return;
    const sweepContinues =
      recordListingPage(crawl, listing, page, result.next);
    saveCrawlState(crawlFile, crawl);
    pages += 1;
    if (!sweepContinues) return;
  }
}
