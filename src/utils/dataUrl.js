/**
 * @fileoverview Builds a URL into the static /data tree, honouring Vite's
 * BASE_URL so the same code works on the dev server and under the GitHub
 * Pages base path.
 */

// Once the manifest loads, every data URL carries ?v=<dataSignature>. GitHub
// Pages caches for 10 minutes with no purge-on-deploy, so an unversioned URL
// can serve files from the PREVIOUS deploy long after the bundle updated; a
// signature-keyed query busts that cache exactly when the data changes. The
// manifest itself is fetched no-store (manifest.js) and must stay unversioned
// — it is the freshness root the tag comes from.
let versionTag = null;

/** @param {?string} tag Data signature to append as ?v=; null clears it. */
export function setDataVersionTag(tag) {
  versionTag = tag ? String(tag).slice(0, 16) : null;
}

/**
 * @param {string} path Path under the data root.
 * @return {string}
 */
export function dataUrl(path) {
  const base = import.meta.env.BASE_URL || '/';
  const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
  const cleanPath = String(path).replace(/^\/+/, '');
  const version =
    versionTag && cleanPath !== 'manifest.json' ? `?v=${versionTag}` : '';
  return `${cleanBase}/data/${cleanPath}${version}`;
}
