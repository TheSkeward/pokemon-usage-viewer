/**
 * @fileoverview Loads the data-provenance manifest
 * (scripts/build-manifest.mjs). Used to fold the data signature into
 * optimizer cache keys and to show the user exactly which Reborn/data/scoring
 * versions produced a recommendation.
 */
import { dataUrl } from "./utils/dataUrl.js";

import { setDataVersionTag } from "./utils/dataUrl.js";

let manifestPromise = null;

/** @return {!Promise<?Object>} The manifest, or null when it fails to load. */
export function loadManifest() {
  if (!manifestPromise) {
    // no-store: the manifest is the freshness root — reading a CDN-stale
    // manifest would version every data fetch with the OLD signature and
    // pin the whole session to stale data (the Mawile incident).
    manifestPromise = fetch(dataUrl("manifest.json"), { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((manifest) => {
        if (manifest?.dataSignature) setDataVersionTag(manifest.dataSignature);
        return manifest;
      })
      .catch(() => null);
  }
  return manifestPromise;
}

/**
 * @return {!Promise<string>} The manifest's dataSignature, or 'unversioned'
 *     when the manifest is unavailable.
 */
export async function getDataSignature() {
  const manifest = await loadManifest();
  return manifest?.dataSignature || "unversioned";
}
