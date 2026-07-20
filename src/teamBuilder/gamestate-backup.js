/**
 * @fileoverview Gamestate backup as a downloadable file. Everything that
 * defines a playthrough lives in localStorage — the pool text and the full
 * Reborn progression (badge/caps, TM/tutor checks, item inventory, evolution
 * access, bias) — and localStorage is one browser-data clear away from gone.
 * This module is the pure serialize/parse half; the widget wires it to a
 * download link and a file picker.
 */

import { getActiveGame } from '../games/registry.js';

const FORMAT = 'pokemon-usage-viewer-gamestate';
const VERSION = 1;

/**
 * @param {{query: ?string, progression: ?Object}} state
 * @return {string} Pretty-printed JSON gamestate export.
 */
export function buildGamestateExport({ query, progression }) {
  return JSON.stringify(
    {
      format: FORMAT,
      version: VERSION,
      // Which game this playthrough belongs to. Absent on pre-registry
      // exports, which are all Reborn by construction.
      game: getActiveGame().id,
      exportedAt: new Date().toISOString(),
      pool: String(query || ''),
      progression: progression || {},
    },
    null,
    2,
  );
}

/**
 * Parses an export back into {pool, progression}; throws with a
 * human-readable message on anything that isn't a gamestate file. Old
 * exports carry a scoringModel field (the retired V0/V1 toggle) — ignored,
 * not an error, so every v1-format backup still restores. The progression
 * object is passed through as-is — the caller routes it through the normal
 * save/load path so normalizeRebornProgression sanitizes it the same way it
 * sanitizes every other stored progression.
 * @param {string} text
 * @return {{pool: string, progression: Object, game: string}}
 */
export function parseGamestateImport(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Not a JSON file.');
  }
  if (parsed?.format !== FORMAT) {
    throw new Error('Not a gamestate export from this tool.');
  }
  if (parsed.version !== VERSION) {
    throw new Error(
      `Unsupported gamestate version ${parsed.version} (this build reads v${VERSION}).`,
    );
  }
  if (typeof parsed.pool !== 'string') {
    throw new Error('Gamestate file has no pool text.');
  }
  if (parsed.progression == null || typeof parsed.progression !== 'object') {
    throw new Error('Gamestate file has no progression.');
  }
  return {
    pool: parsed.pool,
    progression: parsed.progression,
    // Pre-registry exports carry no game field; they are all Reborn. The
    // caller decides how to route a backup for a different game than the
    // active one (today there is only one game, so this is a pass-through).
    game: typeof parsed.game === 'string' ? parsed.game : 'reborn',
  };
}

/**
 * @param {Date} now
 * @return {string} Date-stamped .json filename.
 */
export function gamestateFileName(now = new Date()) {
  return `reborn-gamestate-${now.toISOString().slice(0, 10)}.json`;
}
