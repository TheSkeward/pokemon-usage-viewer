import {
  readLocalStorage,
  writeLocalStorage,
} from "../storage/safeLocalStorage";

// A/B layout preference for the pool page. "modern" reorders for playthrough
// cadence (results before episodic inputs, gamestate strip, bias near
// Optimize); "classic" is the original composition, byte-for-byte, so the
// user can flip back if the new layout doesn't earn its keep.
const LAYOUT_KEY = "pokemon-usage-viewer:pool-layout:v1";

export function getPoolLayout() {
  return readLocalStorage(LAYOUT_KEY, "") === "classic" ? "classic" : "modern";
}

export function setPoolLayout(layout) {
  writeLocalStorage(LAYOUT_KEY, layout === "classic" ? "classic" : "modern");
}
