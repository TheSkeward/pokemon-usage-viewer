/**
 * @fileoverview Generates src/generated/rebornItemTimeline.generated.js: the
 * badge count at which each held item first becomes obtainable, merged from
 * three sources (earliest wins):
 *
 *  1. site-data/data/reborn-item-availability.extracted.json — extracted from
 *     the community "Pokemon Reborn Ep19 Items & Services Guide" spreadsheet
 *     (All Items Locations + Shops + Arcade Lottery tabs), with the sheet's
 *     fight order mapped to badge counts (Corey/Kiki/Saphira award no badge;
 *     post-game tiers collapse to badge 18).
 *  2. The same file's Mining Items tab: everything minable unlocks with the
 *     Mining Kit (Grand Stairway hiker, badge 3 — right after Shelly).
 *  3. WILD_HELD below (user-curated): items carried by wild Pokémon are
 *     obtainable as soon as the holder is catchable. Only entries with a
 *     confidently-known holder timing are listed; corrections are one-line
 *     edits.
 *
 * Rerun: node scripts/build-item-timeline.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';

const MINING_KIT_BADGE = 3;

// item id -> { badge, holder } — the earliest confidently-known wild holder.
// Rule: an item not findable earlier is findable at the point where its wild
// holder is catchable (e.g. Grimer is catchable immediately, so Black Sludge
// is available pre-Julia).
const WILD_HELD = {
  blacksludge: { badge: 0, holder: 'Grimer (Opal/Peridot, immediate)' },
  metronome: { badge: 0, holder: 'Kricketot (Lower Peridot, immediate)' },
  smokeball: { badge: 1, holder: 'Koffing (early wards)' },
  widelens: { badge: 1, holder: 'Sableye (Obsidia Slums)' },
  kingsrock: { badge: 1, holder: 'Poliwag line (early rain puddles)' },
  brightpowder: { badge: 2, holder: 'Wurmple line (Rhodochrine Jungle)' },
  shedshell: { badge: 2, holder: 'Beautifly/Dustox (Wurmple line)' },
  powerherb: { badge: 2, holder: 'Seedot line (Rhodochrine Jungle)' },
  absorbbulb: { badge: 2, holder: 'Oddish (early alleys)' },
  mentalherb: { badge: 2, holder: 'Lotad (rainy Lapis)' },
};

// item id -> badge — user-verified SHOP stock kept as a cross-check overlay
// on the sheet's shopItems map (earliest badge wins). These should always
// agree with the sheet; a disagreement (warned below) is a signal one of the
// two is wrong. Badge 1: the Obsidia Department Store berry floor, verified
// in game.
const SHOP_STOCK = {
  oranberry: 1,
  cheriberry: 1,
  pechaberry: 1,
  rawstberry: 1,
  chestoberry: 1,
  aspearberry: 1,
};

const toId = (name) =>
  String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

const extracted = JSON.parse(
  readFileSync('site-data/data/reborn-item-availability.extracted.json', 'utf8'),
);
const { GEN7_HELD_ITEMS_BY_ID } = await import(
  '../src/generated/gen7HeldItems.generated.js',
);
const { REBORN_EXTRA_INVENTORY_ITEMS } = await import(
  '../src/reborn/extra-inventory-items.js',
);

const knownIds = new Set([
  ...Object.keys(GEN7_HELD_ITEMS_BY_ID),
  ...REBORN_EXTRA_INVENTORY_ITEMS.map((item) => item.id),
]);

const table = new Map();
const note = (id, badge, via) => {
  if (!knownIds.has(id)) return;
  const current = table.get(id);
  if (!current || badge < current.badge) table.set(id, { badge, via });
};

for (const [name, entry] of Object.entries(extracted.items)) {
  note(toId(name), entry.badges, entry.source.toLowerCase());
}
for (const name of extracted.miningItems) {
  note(toId(name), MINING_KIT_BADGE, 'mining');
}
for (const [id, entry] of Object.entries(WILD_HELD)) {
  note(id, entry.badge, `wild ${entry.holder}`);
}

const sorted = [...table.entries()].sort(([a], [b]) => a.localeCompare(b));
const lines = sorted.map(
  ([id, { badge, via }]) =>
    `  ${id}: { badge: ${badge}, via: ${JSON.stringify(via)} },`,
);

// Preserve the mining source independently of the earliest-obtainable table:
// a mineable item may have an earlier one-off pickup, but it is still renewable
// once the Mining Kit is available.
const miningTable = new Map();
for (const name of extracted.miningItems) {
  const id = toId(name);
  if (knownIds.has(id)) miningTable.set(id, MINING_KIT_BADGE);
}
const miningSorted = [...miningTable.entries()].sort(([a], [b]) =>
  a.localeCompare(b),
);
const miningLines =
  miningSorted.map(([id, badge]) => `  ${id}: ${badge},`);

// Shop-sourced held items (renewable: buy as many as needed once the shop is
// reachable), from the extraction's shopItems map — built from the Shops tab
// directly, so an item with an earlier one-off pickup keeps its shop row.
// An entry with `until` would be a stock window that permanently closes; the
// current sheet has none (every windowed mart row chains into a permanent
// seller), and the simple id -> badge table below can't express one, so
// surface it loudly rather than silently promise expired stock forever.
const shopTable = new Map();
for (const [name, entry] of Object.entries(extracted.shopItems)) {
  const id = toId(name);
  if (!knownIds.has(id)) continue;
  if (entry.until != null) {
    console.warn(
      `[item-timeline] WARNING: shop window for ${name} closes at badge ${entry.until}; expiry is unmodeled — item will read as purchasable forever`,
    );
  }
  const current = shopTable.get(id);
  if (current == null || entry.badge < current) shopTable.set(id, entry.badge);
}
for (const [id, badge] of Object.entries(SHOP_STOCK)) {
  if (!knownIds.has(id)) continue;
  const current = shopTable.get(id);
  if (current == null) {
    console.warn(`[item-timeline] SHOP_STOCK ${id} missing from sheet shopItems`);
  } else if (current !== badge) {
    console.warn(`[item-timeline] SHOP_STOCK ${id} badge ${badge} disagrees with sheet ${current}`);
  }
  if (current == null || badge < current) shopTable.set(id, badge);
}
const shopSorted = [...shopTable.entries()].sort(([a], [b]) =>
  a.localeCompare(b),
);
const shopLines = shopSorted.map(([id, badge]) => `  ${id}: ${badge},`);

writeFileSync(
  'src/generated/rebornItemTimeline.generated.js',
  `// AUTO-GENERATED by scripts/build-item-timeline.mjs — do not edit by hand.
// The badge count at which each held item first becomes obtainable in
// Pokemon Reborn. ${extracted.provenance}
// Mining items unlock with the Mining Kit (badge ${MINING_KIT_BADGE}); wild-held entries
// (user-curated holders) unlock when the holder is catchable.
export const REBORN_ITEM_UNLOCK_BADGES = {
${lines.join('\n')}
};

// Mineable inventory items (renewable by mining-rock resets), by the badge at
// which the Mining Kit becomes available. Kept separate from earliest unlocks
// so an earlier one-off copy does not hide the later renewable source.
export const REBORN_MINING_ITEM_BADGES = {
${miningLines.join('\n')}
};

// Held items purchasable from shops (renewable), by the badge the shop
// opens at. Drives the inventory panel's one-click "purchasable now" sync.
export const REBORN_SHOP_ITEM_BADGES = {
${shopLines.join('\n')}
};
`,
);

console.log(`[item-timeline] ${shopSorted.length} shop items marked renewable`);
console.log(`[item-timeline] ${miningSorted.length} mining items marked renewable`);

console.log(
  `[item-timeline] ${sorted.length} held items timed (of ${knownIds.size} known ids)`,
);
const unknown = Object.keys(extracted.items).filter(
  (name) => !knownIds.has(toId(name)),
).length;
console.log(`[item-timeline] ${unknown} sheet rows outside the held-item catalog (TMs, medicine, etc.) ignored`);
