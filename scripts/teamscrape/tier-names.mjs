/**
 * @fileoverview Tier names as they appear in thread and subforum titles,
 * shared by the scrapers that attribute a format from free text (RMT's
 * generation-labeled threads, the competitive-discussion forum walk).
 */

// Most-specific first: "Doubles UU" must not read as UU, and "OU" appears
// inside almost every compound tier name.
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
 * @param {string} text Free text naming a tier (thread or subforum title).
 * @return {?string} The tier segment of a format id ("ou", "doublesuu"),
 *     or null when no tier is named.
 */
export function tierFromTitle(text) {
  for (const [tier, pattern] of TIER_PATTERNS) {
    if (pattern.test(text || '')) return tier;
  }
  return null;
}
