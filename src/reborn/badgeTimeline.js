/**
 * @fileoverview The Reborn progression timeline: what the world looks like at
 * each badge count (and post-game tier). Curated from BIGJRA's Pokemon Reborn
 * walkthrough (bigjra.github.io/reborn, E19.5) — the project's canonical
 * progression source — by mapping each walkthrough episode to the badge count
 * the player holds while playing it.
 *
 * Two distinct authorities, deliberately kept apart:
 *   - The user's own progression clicks (TMs, tutors, evolution access,
 *     owned items) remain the ONLY source of truth for what is available NOW.
 *   - This timeline is the SCHEDULE: it derives the level cap from the badge
 *     picker, annotates controls with when their unlock is normally reached,
 *     and prices how far a mon's competitive set is from fully assembled
 *     (setReadiness.js).
 *
 * `unlocks` on a checkpoint lists what FIRST becomes obtainable there:
 *   - access: evolution-access keys (EVOLUTION_ACCESS_FIELDS) — areas reached
 *   - flags:  boolean progression fields (daycare, relearner, HP changer)
 *   - items:  headline competitive held items (normalized item ids)
 * Mechanic-style access keys (friendship, party-condition, other-locations)
 * have no schedule entry: they are available from the start.
 *
 * Notes against the walkthrough:
 *   - Corey and Kiki award no badge ("No gym badge or TM is awarded to you
 *     after this fight"), so the 18 badges are the list below.
 *   - Strike, Gravity, and Torrent do not raise the level cap.
 *   - Post-game raises the cap in ten silent steps of 5, to 150.
 */

import { REBORN_ITEM_UNLOCK_BADGES } from '../generated/rebornItemTimeline.generated.js';

/**
 * The timeline, in play order: 19 badge checkpoints then 10 post-game tiers.
 */
export const REBORN_PROGRESSION_CHECKPOINTS = [
  { id: 'start', badges: 0, label: 'No badges', detail: 'Game start', levelCap: 20, unlocks: {} },
  {
    id: 'badge-1', badges: 1, label: 'Volt Badge (Julia)', levelCap: 25,
    unlocks: {
      flags: ['daycareUnlocked'], // Onyx warehouse: freeing the real daycare couple
      items: ['quickclaw'],
    },
  },
  {
    id: 'badge-2', badges: 2, label: 'Canopy Badge (Florinia)', levelCap: 35,
    // Stone access is per-stone, timed by the item timeline.
    unlocks: { items: ['focussash'] },
  },
  {
    id: 'badge-3', badges: 3, label: 'Cocoon Badge (Shelly)', levelCap: 40,
    unlocks: {
      // Beryl vendor sells the first Link Stone; Shade's arena is the old
      // power plant, the magnetic-field evolution spot.
      access: ['evoAccessLinkStone', 'evoAccessMagneticField'],
    },
  },
  {
    id: 'badge-4', badges: 4, label: 'Omen Badge (Shade)', levelCap: 45,
    unlocks: {
      access: ['evoAccessApophyll'], // Apophyll Beach/Cave chapter
    },
  },
  {
    id: 'badge-5', badges: 5, label: 'Blight Badge (Aya)', levelCap: 50,
    unlocks: {
      access: ['evoAccessMossyRock'], // burning field chamber above the Railnet
      flags: ['moveRelearnerUnlocked'], // House Key returned in Onyx Ward
      items: ['weaknesspolicy'],
    },
  },
  { id: 'badge-6', badges: 6, label: 'Rime Badge (Serra)', levelCap: 55, unlocks: {} },
  {
    id: 'badge-7', badges: 7, label: 'Standard Badge (Noel)', levelCap: 60,
    unlocks: {
      access: ['evoAccessIcyRock'], // Ametrine ice puzzle
      items: ['metalcoat'],
    },
  },
  { id: 'badge-8', badges: 8, label: 'Millenium Badge (Radomus)', levelCap: 65, unlocks: {} },
  {
    id: 'badge-9', badges: 9, label: 'Eclipse Badge (Luna)', levelCap: 70,
    unlocks: {
      flags: ['hiddenPowerTypeChangerUnlocked'], // Agate Circus NPC
      items: ['eviolite'], // Agate Circus general goods
    },
  },
  {
    id: 'badge-10', badges: 10, label: 'Strike Badge (Samson)', levelCap: 70,
    unlocks: { items: ['reapercloth'] },
  },
  {
    id: 'badge-11', badges: 11, label: 'Cinder Badge (Charlotte)', levelCap: 75,
    unlocks: { items: ['magmarizer'] },
  },
  {
    id: 'badge-12', badges: 12, label: 'Gravity Badge (Terra)', levelCap: 75,
    unlocks: { items: ['razorfang'] },
  },
  {
    id: 'badge-13', badges: 13, label: 'Suspension Badge (Ciel)', levelCap: 80,
    unlocks: { items: ['expertbelt', 'leftovers'] },
  },
  {
    id: 'badge-14', badges: 14, label: 'Amaranth Badge (Adrienn)', levelCap: 85,
    unlocks: { items: ['choiceband', 'choicespecs', 'assaultvest'] },
  },
  { id: 'badge-15', badges: 15, label: 'Alloy Badge (Titania)', levelCap: 90, unlocks: {} },
  {
    id: 'badge-16', badges: 16, label: 'Torrent Badge (Amaria)', levelCap: 90,
    unlocks: { items: ['lifeorb', 'muscleband'] },
  },
  { id: 'badge-17', badges: 17, label: 'Geode Badge (Hardy)', levelCap: 95, unlocks: {} },
  {
    id: 'badge-18', badges: 18, label: 'Treasure Badge (Labyrinth)', levelCap: 100,
    unlocks: { items: ['choicescarf'] },
  },
  // Post-game: no badges, silent cap raises per quest arc.
  { id: 'post-1', badges: 18, postgame: 1, label: 'Post: A Whole New World', levelCap: 105, unlocks: {} },
  { id: 'post-2', badges: 18, postgame: 2, label: 'Post: Fetch, Doggy!', levelCap: 110, unlocks: {} },
  { id: 'post-3', badges: 18, postgame: 3, label: 'Post: The Umbral Issue (early)', levelCap: 115, unlocks: {} },
  { id: 'post-4', badges: 18, postgame: 4, label: 'Post: The Umbral Issue (late)', levelCap: 120, unlocks: {} },
  { id: 'post-5', badges: 18, postgame: 5, label: 'Post: Wish Upon a Star', levelCap: 125, unlocks: {} },
  { id: 'post-6', badges: 18, postgame: 6, label: 'Post: Lights Out', levelCap: 130, unlocks: {} },
  { id: 'post-7', badges: 18, postgame: 7, label: "Post: Up, Down, n' All Around (early)", levelCap: 135, unlocks: {} },
  { id: 'post-8', badges: 18, postgame: 8, label: "Post: Up, Down, n' All Around (late)", levelCap: 140, unlocks: {} },
  { id: 'post-9', badges: 18, postgame: 9, label: 'Post: A Canvas of Cyclical Conflict', levelCap: 145, unlocks: {} },
  { id: 'post-10', badges: 18, postgame: 10, label: 'Post: Pokemon Reborn, Reborn!', levelCap: 150, unlocks: {} },
];

const BY_ID = new Map(
  REBORN_PROGRESSION_CHECKPOINTS.map((checkpoint, index) => [
    checkpoint.id,
    { checkpoint, index },
  ]),
);

/**
 * @param {?string} id
 * @return {?Object} Null for unknown ids.
 */
export function getRebornCheckpoint(id) {
  return BY_ID.get(String(id || ''))?.checkpoint || null;
}

/**
 * @param {?string} id
 * @return {number} Position in timeline order; -1 for unknown ids.
 */
export function getRebornCheckpointOrdinal(id) {
  const entry = BY_ID.get(String(id || ''));
  return entry ? entry.index : -1;
}

/**
 * Everything the schedule expects to be obtainable once the given checkpoint
 * is reached (cumulative through that checkpoint).
 * @param {?string} id Checkpoint id; unknown ids yield empty sets.
 * @return {{accessKeys: Set<string>, flags: Set<string>, itemIds: Set<string>}}
 */
export function getExpectedUnlocks(id) {
  const ordinal = getRebornCheckpointOrdinal(id);
  const expected =
    { accessKeys: new Set(), flags: new Set(), itemIds: new Set() };
  if (ordinal < 0) return expected;

  for (
    const checkpoint of REBORN_PROGRESSION_CHECKPOINTS.slice(0, ordinal + 1)) {
    for (const key of checkpoint.unlocks.access || []) expected.accessKeys.add(
      key);
    for (const key of checkpoint.unlocks.flags || []) expected.flags.add(key);
    for (const item of checkpoint.unlocks.items || []) expected.itemIds.add(
      item);
  }
  return expected;
}

/**
 * The badge count at which the schedule first expects an unlock (access key or
 * boolean flag); null when it is never scheduled (available from the start).
 * @param {string} key
 * @return {?number}
 */
export function getUnlockBadge(key) {
  for (const checkpoint of REBORN_PROGRESSION_CHECKPOINTS) {
    if (
      (checkpoint.unlocks.access || []).includes(key) ||
      (checkpoint.unlocks.flags || []).includes(key)
    ) {
      return checkpoint.badges;
    }
  }
  return null;
}

/**
 * The badge count at which a held item first becomes obtainable; null when
 * nothing tracks it (treat as timing-unknown, not unobtainable). The
 * hand-curated checkpoint entries above (walkthrough-verified) win; the
 * generated table (community item guide: locations, shops, arcade, mining,
 * user-curated wild holders) covers the other ~350 held items.
 * @param {string} itemId Normalized item id.
 * @return {?number}
 */
export function getItemUnlockBadge(itemId) {
  for (const checkpoint of REBORN_PROGRESSION_CHECKPOINTS) {
    if ((checkpoint.unlocks.items || []).includes(itemId)) {
      return checkpoint.badges;
    }
  }
  return REBORN_ITEM_UNLOCK_BADGES[itemId]?.badge ?? null;
}

/**
 * @param {?Object} checkpoint
 * @return {string} "Post N" for post-game tiers, "N badges" otherwise; "" for
 *     null.
 */
export function getRebornCheckpointShortLabel(checkpoint) {
  if (!checkpoint) return '';
  if (checkpoint.postgame) return `Post ${checkpoint.postgame}`;
  return `${checkpoint.badges} badge${checkpoint.badges === 1 ? '' : 's'}`;
}
