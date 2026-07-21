/**
 * @fileoverview XenForo HTML helpers shared by the forum scrapers (rmt,
 * tournament, samples): listing-row extraction, opening-post isolation, and
 * tag-stripping. Regex-on-HTML by design — the scrapers only need links,
 * labels, and text runs, and a parser dependency would outweigh them.
 */

/** @return {string} Plain text: tags stripped, entities decoded. */
export function htmlToText(html) {
  return String(html)
    // XenForo pretty-prints a source newline after every <br>. Consume that
    // formatting whitespace with the tag: otherwise each visible line gets
    // two newlines and the importable parser mistakes every line for a new
    // blank-line-delimited set. Consecutive <br> tags still become the two
    // newlines that separate Showdown sets.
    .replace(/<br\s*\/?>\s*/gi, '\n')
    .replace(/<\/(p|div|li|blockquote)>/gi, '\n')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    // Numeric entities before named ones: Smogon posts are full of &#8203;
    // (zero-width space) as a formatting hack, and any invisible character
    // left inside a line breaks the set parser's line shapes.
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ');
}

// Smogon serves site-rooted hrefs (/forums/threads/...); the bare
// /threads/... form appears in other XenForo installs' roots.
const THREAD_ANCHOR =
  /<a[^>]+href="((?:\/forums)?\/threads\/[^"]*?\.(\d+)\/)"[^>]*>([^<]*)/;

/**
 * Listing rows: each thread's prefix label, link, and title. XenForo wraps
 * exactly these in a structItem-title block, so rows are read block-scoped —
 * a flat proximity regex mis-associates labels whenever other row furniture
 * (icons, last-post links) sits between the label and the title anchor,
 * which is how a whole listing of labeled threads read as unlabeled. The
 * flat form remains as the fallback for markup without structItem blocks
 * (other XenForo skins).
 *
 * @return {!Array<{threadId: string, url: string, prefix: ?string,
 *     title: string, updatedAt: ?number}>}
 */
export function extractThreadRows(html, baseUrl) {
  const rows = [];
  const seen = new Set();
  const push = (threadId, href, prefix, title, updatedAt = null) => {
    if (seen.has(threadId)) return;
    seen.add(threadId);
    rows.push({
      threadId,
      url: new URL(href, baseUrl).href,
      prefix: prefix ? htmlToText(prefix).trim() : null,
      title: htmlToText(title || '').trim(),
      updatedAt,
    });
  };

  const blocks = String(html).split(/class="structItem-title"/).slice(1);
  if (blocks.length) {
    for (const block of blocks) {
      const anchor = block.match(THREAD_ANCHOR);
      if (!anchor) continue;
      const labels = [...block.slice(0, anchor.index).matchAll(
        /<span[^>]*class="label[^"]*"[^>]*>([^<]+)<\/span>/g,
      )];
      const times = [...block.matchAll(/data-time="(\d+)"/g)]
        .map((match) => Number(match[1]));
      push(
        anchor[2],
        anchor[1],
        labels.length ? labels[labels.length - 1][1] : null,
        anchor[3],
        times.length ? Math.max(...times) : null,
      );
    }
    return rows;
  }

  const rowRegex = new RegExp(
    `(?:<span[^>]*class="label[^"]*"[^>]*>([^<]+)</span>[\\s\\S]{0,400}?)?` +
      `${THREAD_ANCHOR.source.replace('<a[^>]+', '<a[^>]+')}`,
    'g',
  );
  for (const match of html.matchAll(rowRegex)) {
    const [, prefix, href, threadId, title] = match;
    push(threadId, href, prefix, title);
  }
  return rows;
}

/**
 * Listing page N's URL. XenForo paginates with a /page-N path segment, which
 * must precede any query string (a prefix-filtered listing keeps its
 * ?prefix_id= across pages).
 * @return {string}
 */
export function listingPageUrl(listing, page) {
  if (page === 1) return listing;
  const [base, query] = String(listing).split('?');
  const paged = `${base.endsWith('/') ? base : `${base}/`}page-${page}`;
  return query ? `${paged}?${query}` : paged;
}

/**
 * Whether XenForo advertises another page. This is deliberately driven by
 * pagination markup rather than probing page N+1: oversized page requests can
 * redirect to the final page with HTTP 200, which otherwise creates an
 * infinite crawl once hard page ceilings are removed.
 */
export function hasNextPage(html, currentPage) {
  for (const tag of String(html).match(/<(?:a|link)\b[^>]*>/gi) || []) {
    if (/\brel="next"/i.test(tag) || /pageNav-jump--next/i.test(tag)) {
      return true;
    }
    const page = /\bdata-page="(\d+)"/i.exec(tag)?.[1];
    if (page && Number(page) > currentPage && /pageNav/i.test(tag)) return true;
  }
  return false;
}

/**
 * Every post on a thread page: author plus body (raw html and text).
 * XenForo stamps data-author on each message article; the body is scoped to
 * the message-body article inside it, so signatures and quoted previews
 * outside the body do not leak in.
 * @return {!Array<{author: string, html: string, text: string}>}
 */
export function extractPosts(html) {
  const parts = String(html).split(/<article[^>]+data-author="([^"]*)"/);
  const posts = [];
  for (let i = 1; i < parts.length; i += 2) {
    const chunk = parts[i + 1] || '';
    const body = chunk.match(
      /<article[^>]*class="[^"]*message-body[^"]*"[^>]*>([\s\S]*?)<\/article>/,
    );
    posts.push({
      author: parts[i],
      html: body ? body[1] : '',
      text: body ? htmlToText(body[1]) : '',
    });
  }
  return posts;
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
