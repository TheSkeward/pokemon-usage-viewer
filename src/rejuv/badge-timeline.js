/**
 * @fileoverview The Rejuvenation progression timeline: what the world looks
 * like at each badge count. Curated from BIGJRA's Pokemon Rejuvenation
 * walkthrough (bigjra.github.io/rejuvenation, raw chapters in the site's
 * source repo) — the project's canonical progression source, as for Reborn —
 * by reading each chapter's badge award and level-cap lines in play order.
 *
 * Mirrors src/reborn/badge-timeline.js in shape so game-registry integration
 * can consume either game's schedule alike. `unlocks` entries stay empty
 * until the Rejuvenation progression controls exist to name their keys.
 *
 * Notes against the walkthrough:
 *   - The pre-badge cap is 18 (stated at the Venam fight).
 *   - The Glacier Badge is handed over by Kreiss in Kristiline Town after
 *     the Angie arc; there is no gym fight at the award itself.
 *   - The Trickery Badge follows the Magenta & Neon puppet double battle.
 *   - Rose Badge: the player fights Flora or Florin; either path awards the
 *     same badge and cap.
 *   - Pyramid Point (Ryland's arena) raises no level cap.
 *   - The Fate Badge (a chapter-15 story battle reward) is not a gym badge:
 *     it changes neither the count nor the cap — the walkthrough's shop
 *     headers count 15 badges after Forgery.
 *   - Walkthrough coverage currently ends with V13.5 content (Chapter 15,
 *     Forgery Badge, cap 90). The V14 chapters beyond it get appended when
 *     BIGJRA's coverage lands.
 */

/** The timeline, in play order: game start then 15 badge checkpoints. */
export const REJUV_PROGRESSION_CHECKPOINTS = [
  { id: 'start', badges: 0, label: 'No badges', detail: 'Game start', levelCap: 18, unlocks: {} },
  { id: 'badge-1', badges: 1, label: 'PoisonHeart Badge (Venam)', levelCap: 25, unlocks: {} },
  { id: 'badge-2', badges: 2, label: 'Diamond Punch Badge (Keta)', levelCap: 30, unlocks: {} },
  { id: 'badge-3', badges: 3, label: 'Normality Badge (Marianette)', levelCap: 35, unlocks: {} },
  { id: 'badge-4', badges: 4, label: 'Phantasm Badge (Narcissa)', levelCap: 40, unlocks: {} },
  { id: 'badge-5', badges: 5, label: 'Dewdrop Badge (Valarie)', levelCap: 45, unlocks: {} },
  { id: 'badge-6', badges: 6, label: 'Infested Badge (Crawli)', levelCap: 50, unlocks: {} },
  { id: 'badge-7', badges: 7, label: 'Glacier Badge (Angie)', levelCap: 55, unlocks: {} },
  { id: 'badge-8', badges: 8, label: 'Lyric Badge (Amber)', levelCap: 60, unlocks: {} },
  { id: 'badge-9', badges: 9, label: 'Pulse Badge (Erick)', levelCap: 65, unlocks: {} },
  { id: 'badge-10', badges: 10, label: 'Rose Badge (Flora or Florin)', levelCap: 70, unlocks: {} },
  { id: 'badge-11', badges: 11, label: 'Trickery Badge (Magenta & Neon)', levelCap: 75, unlocks: {} },
  { id: 'badge-12', badges: 12, label: 'Golden Wing Badge (Souta)', levelCap: 80, unlocks: {} },
  { id: 'badge-13', badges: 13, label: 'Rugged Badge (Adam)', levelCap: 85, unlocks: {} },
  { id: 'badge-14', badges: 14, label: 'Pyramid Point Badge (Ryland)', levelCap: 85, unlocks: {} },
  { id: 'badge-15', badges: 15, label: 'Forgery Badge (Saki)', levelCap: 90, unlocks: {} },
];

const BY_ID = new Map(
  REJUV_PROGRESSION_CHECKPOINTS.map((checkpoint, index) => [
    checkpoint.id,
    { checkpoint, index },
  ]),
);

/**
 * @param {?string} id
 * @return {?Object} Null for unknown ids.
 */
export function getRejuvCheckpoint(id) {
  return BY_ID.get(String(id || ''))?.checkpoint || null;
}

/**
 * @param {?string} id
 * @return {number} Position in timeline order; -1 for unknown ids.
 */
export function getRejuvCheckpointOrdinal(id) {
  const entry = BY_ID.get(String(id || ''));
  return entry ? entry.index : -1;
}

/**
 * @param {?Object} checkpoint
 * @return {string} "N badges" ("" for null).
 */
export function getRejuvCheckpointShortLabel(checkpoint) {
  if (!checkpoint) return '';
  return `${checkpoint.badges} badge${checkpoint.badges === 1 ? '' : 's'}`;
}
