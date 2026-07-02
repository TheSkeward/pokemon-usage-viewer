// Loads the data-provenance manifest (scripts/build-manifest.mjs). Used to fold
// the data signature into optimizer cache keys and to show the user exactly
// which Reborn/data/scoring versions produced a recommendation.
import { dataUrl } from "./utils/dataUrl.js";

let manifestPromise = null;

export function loadManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch(dataUrl("manifest.json"))
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null);
  }
  return manifestPromise;
}

export async function getDataSignature() {
  const manifest = await loadManifest();
  return manifest?.dataSignature || "unversioned";
}
