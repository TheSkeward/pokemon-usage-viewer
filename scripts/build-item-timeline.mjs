// Generates src/generated/rebornItemTimeline.generated.js: the badge count at
// which each held item first becomes obtainable, merged from three sources
// (earliest wins):
//
//  1. site-data/data/reborn-item-availability.extracted.json — extracted from
//     the community "Pokemon Reborn Ep19 Items & Services Guide" spreadsheet
//     (All Items Locations + Shops + Arcade Lottery tabs), with the sheet's
//     fight order mapped to badge counts (Corey/Kiki/Saphira award no badge;
//     post-game tiers collapse to badge 18).
//  2. The same file's Mining Items tab: everything minable unlocks with the
//     Mining Kit (Grand Stairway hiker, badge 3 — right after Shelly).
//  3. WILD_HELD below (user-curated): items carried by wild Pokémon are
//     obtainable as soon as the holder is catchable. Only entries with a
//     confidently-known holder timing are listed; corrections are one-line
//     edits.
//
// Rerun: node scripts/build-item-timeline.mjs

import { readFileSync, writeFileSync } from "node:fs";

const MINING_KIT_BADGE = 3;

// item id -> { badge, holder } — the earliest confidently-known wild holder.
// User-verified rule: "if they're not findable earlier, they're findable at
// the point where you can catch those mon" (e.g. Grimer is catchable
// immediately, so Black Sludge is available pre-Julia).
const WILD_HELD = {
  blacksludge: { badge: 0, holder: "Grimer (Opal/Peridot, immediate)" },
  metronome: { badge: 0, holder: "Kricketot (Lower Peridot, immediate)" },
  smokeball: { badge: 1, holder: "Koffing (early wards)" },
  widelens: { badge: 1, holder: "Sableye (Obsidia Slums)" },
  kingsrock: { badge: 1, holder: "Poliwag line (early rain puddles)" },
  brightpowder: { badge: 2, holder: "Wurmple line (Rhodochrine Jungle)" },
  shedshell: { badge: 2, holder: "Beautifly/Dustox (Wurmple line)" },
  powerherb: { badge: 2, holder: "Seedot line (Rhodochrine Jungle)" },
  absorbbulb: { badge: 2, holder: "Oddish (early alleys)" },
  mentalherb: { badge: 2, holder: "Lotad (rainy Lapis)" },
};

// item id -> badge — user-verified SHOP stock whose shop-ness the extracted
// sheet hides: the extraction merged to one row per item with the EARLIEST
// source winning, so an item with any pickup before its shop (Oran Berry is
// a badge-0 hidden find) lost its Shop row at extraction time and the raw
// sheet is not in the repo to re-extract. Corrections are one-line edits,
// same contract as WILD_HELD.
// Badge 1: the Obsidia Department Store berry floor (user-verified in game:
// screenshots of the full stock after Badge 1 — the six heal/status berries
// below sit alongside Persim + the EV berries the sheet already credits).
const SHOP_STOCK = {
  oranberry: 1,
  cheriberry: 1,
  pechaberry: 1,
  rawstberry: 1,
  chestoberry: 1,
  aspearberry: 1,
};

const toId = (name) =>
  String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const extracted = JSON.parse(
  readFileSync("site-data/data/reborn-item-availability.extracted.json", "utf8"),
);
const { GEN7_HELD_ITEMS_BY_ID } = await import(
  "../src/generated/gen7HeldItems.generated.js"
);
const { REBORN_EXTRA_INVENTORY_ITEMS } = await import(
  "../src/reborn/itemAvailability.js"
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
  note(toId(name), MINING_KIT_BADGE, "mining");
}
for (const [id, entry] of Object.entries(WILD_HELD)) {
  note(id, entry.badge, `wild ${entry.holder}`);
}

const sorted = [...table.entries()].sort(([a], [b]) => a.localeCompare(b));
const lines = sorted.map(
  ([id, { badge, via }]) =>
    `  ${id}: { badge: ${badge}, via: ${JSON.stringify(via)} },`,
);

// Shop-sourced held items (renewable: buy as many as needed once the shop is
// reachable), keyed to the badge the sheet times the shop at. Built from
// source === "Shop" rows DIRECTLY — the merged table above keeps only the
// EARLIEST source, which hides shop-ness behind any earlier one-off find.
// Limitation, inherited from the extraction: the sheet collapsed to one row
// per item, so an item whose earliest row is "Hidden" never reads as a shop
// item here even if a later shop also stocks it — the SHOP_STOCK overlay
// above carries the user-verified corrections (earliest badge wins when
// both sources know an item).
const shopTable = new Map(
  Object.entries(extracted.items)
    .filter(([, entry]) => entry.source === "Shop")
    .map(([name, entry]) => [toId(name), entry.badges])
    .filter(([id]) => knownIds.has(id)),
);
for (const [id, badge] of Object.entries(SHOP_STOCK)) {
  if (!knownIds.has(id)) continue;
  const current = shopTable.get(id);
  if (current == null || badge < current) shopTable.set(id, badge);
}
const shopSorted = [...shopTable.entries()].sort(([a], [b]) =>
  a.localeCompare(b),
);
const shopLines = shopSorted.map(([id, badge]) => `  ${id}: ${badge},`);

writeFileSync(
  "src/generated/rebornItemTimeline.generated.js",
  `// AUTO-GENERATED by scripts/build-item-timeline.mjs — do not edit by hand.
// The badge count at which each held item first becomes obtainable in
// Pokemon Reborn. ${extracted.provenance}
// Mining items unlock with the Mining Kit (badge ${MINING_KIT_BADGE}); wild-held entries
// (user-curated holders) unlock when the holder is catchable.
export const REBORN_ITEM_UNLOCK_BADGES = {
${lines.join("\n")}
};

// Held items purchasable from shops (renewable), by the badge the shop
// opens at. Drives the inventory panel's one-click "purchasable now" sync.
export const REBORN_SHOP_ITEM_BADGES = {
${shopLines.join("\n")}
};
`,
);

console.log(`[item-timeline] ${shopSorted.length} shop items marked renewable`);

console.log(
  `[item-timeline] ${sorted.length} held items timed (of ${knownIds.size} known ids)`,
);
const unknown = Object.keys(extracted.items).filter(
  (name) => !knownIds.has(toId(name)),
).length;
console.log(`[item-timeline] ${unknown} sheet rows outside the held-item catalog (TMs, medicine, etc.) ignored`);
