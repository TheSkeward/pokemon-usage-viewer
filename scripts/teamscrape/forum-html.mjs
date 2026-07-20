/**
 * @fileoverview XenForo HTML helpers shared by the forum scrapers (rmt,
 * tournament, samples): listing-row extraction, opening-post isolation, and
 * tag-stripping. Regex-on-HTML by design — the scrapers only need links,
 * labels, and text runs, and a parser dependency would outweigh them.
 */

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
 * rows in listing order; prefix null when unlabeled.
 *
 * @return {!Array<{threadId: string, url: string, prefix: ?string,
 *     title: string}>}
 */
export function extractThreadRows(html, baseUrl) {
  const rows = [];
  const seen = new Set();
  // Smogon serves site-rooted hrefs (/forums/threads/...); the bare
  // /threads/... form appears in other XenForo installs' roots.
  const rowRegex =
    /(?:<span[^>]*class="label[^"]*"[^>]*>([^<]+)<\/span>[\s\S]{0,400}?)?<a[^>]+href="((?:\/forums)?\/threads\/[^"]*?\.(\d+)\/)"[^>]*(?:data-preview-url|class="")[^>]*>([^<]*)/g;
  for (const match of html.matchAll(rowRegex)) {
    const [, prefix, href, threadId, title] = match;
    if (seen.has(threadId)) continue;
    seen.add(threadId);
    rows.push({
      threadId,
      url: new URL(href, baseUrl).href,
      prefix: prefix ? htmlToText(prefix).trim() : null,
      title: htmlToText(title || '').trim(),
    });
  }
  return rows;
}

/**
 * The opening post is the first message body on page 1. The article form is
 * tried on the whole document first: the div fallback stops at the first
 * closing div, so nested markup (spoilers) truncates it, and an
 * earlier-positioned div must not outrank a complete article match.
 * @return {string}
 */
export function extractFirstPostText(html) {
  const article = String(html).match(
    /<article[^>]*class="[^"]*message-body[^"]*"[^>]*>([\s\S]*?)<\/article>/,
  );
  if (article) return htmlToText(article[1]);
  const wrapper = String(html).match(
    /<div[^>]*class="[^"]*bbWrapper[^"]*"[^>]*>([\s\S]*?)<\/div>/,
  );
  return wrapper ? htmlToText(wrapper[1]) : '';
}

/**
 * One-line structural fingerprint of a listing page, logged when row
 * extraction comes up empty: enough to tell "markup shifted under the row
 * regex" from "genuinely empty page" without shipping the HTML.
 * @return {string}
 */
export function listingDebugInfo(html) {
  const text = String(html);
  const count = (regex) => (text.match(regex) || []).length;
  return (
    `len ${text.length}, thread hrefs ${count(/href="[^"]*\/threads\//g)}, ` +
    `preview attrs ${count(/data-preview-url/g)}, ` +
    `labels ${count(/class="label/g)}`
  );
}
