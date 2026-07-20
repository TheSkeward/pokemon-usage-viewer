import { REBORN_SHOP_ITEM_BADGES } from "../generated/rebornItemTimeline.generated.js";
import { GEN7_HELD_ITEMS_BY_ID } from "../generated/gen7HeldItems.generated.js";
import { HIDDEN_INVENTORY_ITEM_IDS } from "./rebornSeeds";
import { toId } from "../utils/ids.js";
// Curated evolution-item availability for Pokémon Reborn.
//
// This is a small, SOURCED table — not scraped data and not guesswork dressed
// as data. Every entry states why we believe the item is obtainable; anything
// not listed is "unknown" and the evolution engine surfaces that as unknown
// (blocked, with the reason shown) rather than silently pretending either way.
//
// Sources of belief:
//  - WILD-HELD: mainline Gen-7 wild held items, which Reborn's mons.dat
//    preserves — the evolving line itself carries the item in the wild, so a
//    player who can catch the mon can farm the item (e.g. wild Happiny holds an
//    Oval Stone 50% of the time).
//  - MINING/COMMERCE: Reborn's mining rocks and department store stock the
//    standard evolution stones and the Link Stone (Reborn's replacement for
//    trade evolutions) across the game; farmable, but tedious.
//
// status values: "farmable" (reliably obtainable), "farmable-tedious"
// (obtainable with real grind), absent = unknown.

const ITEM_AVAILABILITY = {
  // Wild-held by the evolving line itself (50% — reliably farmable).
  ovalstone: { status: "farmable", source: "wild-held by Happiny (50%)" },

  // Wild-held at low rates (5%) by common wild lines — farmable, tedious.
  metalcoat: { status: "farmable-tedious", source: "wild-held (Magnemite/Beldum, 5%)" },
  kingsrock: { status: "farmable-tedious", source: "wild-held (Poliwhirl/Politoed line, 5%)" },
  razorclaw: { status: "farmable-tedious", source: "wild-held (Sneasel, 5%)" },
  razorfang: { status: "farmable-tedious", source: "wild-held (Bruxish, 5%)" },
  electirizer: { status: "farmable-tedious", source: "wild-held (Elekid, 5%)" },
  magmarizer: { status: "farmable-tedious", source: "wild-held (Magby, 5%)" },
  dragonscale: { status: "farmable-tedious", source: "wild-held (Horsea/Seadra, 5%)" },
  deepseatooth: { status: "farmable-tedious", source: "wild-held (Carvanha/Sharpedo, 5%)" },
  deepseascale: { status: "farmable-tedious", source: "wild-held (Chinchou/Lanturn/Relicanth, 5%)" },
  lightball: { status: "farmable-tedious", source: "wild-held (Pikachu, 5%)" },

  // Reborn systems: mining rocks + department store carry the standard stones
  // and the Link Stone across the playthrough.
  linkstone: { status: "farmable-tedious", source: "Reborn mining / commerce (trade-evolution item)" },
  firestone: { status: "farmable-tedious", source: "Reborn mining / dept. store" },
  waterstone: { status: "farmable-tedious", source: "Reborn mining / dept. store" },
  thunderstone: { status: "farmable-tedious", source: "Reborn mining / dept. store" },
  leafstone: { status: "farmable-tedious", source: "Reborn mining / dept. store" },
  moonstone: { status: "farmable-tedious", source: "Reborn mining / dept. store" },
  sunstone: { status: "farmable-tedious", source: "Reborn mining / dept. store" },
  shinystone: { status: "farmable-tedious", source: "Reborn mining / dept. store" },
  duskstone: { status: "farmable-tedious", source: "Reborn mining / dept. store" },
  dawnstone: { status: "farmable-tedious", source: "Reborn mining / dept. store" },
  icestone: { status: "farmable-tedious", source: "Reborn mining / dept. store" },
  everstone: { status: "farmable-tedious", source: "Reborn mining" },
};

/**
 * Reborn-only inventory items that aren't in the Gen 7 held-items list but
 * belong in the owned-items tracker (owning one zeroes the matching evolution
 * friction and overrides its access gate).
 * @type {Array<{id: string, name: string}>}
 */
export const REBORN_EXTRA_INVENTORY_ITEMS = Object.freeze([
  { id: "linkstone", name: "Link Stone" },
  // Reborn-original (E16+): the holder's area-altering moves last 8 turns
  // instead of 5 — the fangame's generalized Terrain Extender. Outside the
  // usage prior's universe, so its scoring signal is the borrowed-prior
  // field-extender bonus (see scoringConstants FIELD_EXTENDER_UTILITY_BONUS).
  { id: "amplifieldrock", name: "Amplifield Rock" },
]);

/**
 * Every item id that participates in evolution requirements — owning one of
 * THESE changes optimization results (friction/access), unlike ordinary held
 * items, so progression-staleness checks must watch them.
 * @return {Array<string>}
 */
export function getEvolutionItemIds() {
  return Object.keys(ITEM_AVAILABILITY);
}

/**
 * @param {?string} itemName Item name or id (normalized internally).
 * @return {{status: string, source: string}} status is "farmable",
 *     "farmable-tedious", or "unknown"; source states the basis for belief.
 */
export function getItemAvailability(itemName) {
  const id = toId(itemName);
  if (!id) return { status: "unknown", source: "no item recorded" };
  return (
    ITEM_AVAILABILITY[id] || {
      status: "unknown",
      source: `no availability data for ${itemName}`,
    }
  );
}

/**
 * The shop-purchasable held items the player could stock RIGHT NOW but isn't
 * tracking yet: reachable at their badge count, in the held-item catalog,
 * not a hidden/replaced id, and absent from (or under-stocked in) the owned
 * list. Drives the inventory panel's one-click "purchasable now" sync — the
 * data already knows what the shops sell, so discovering shops shouldn't
 * mean transcribing them. Sorted by name for a stable display list.
 * `badges` and `ownedItems` arrive as plain values (not the progression
 * object) to keep this module import-cycle-free.
 * @param {number} badges
 * @param {Object<string, number>=} ownedItems id -> owned count.
 * @param {number=} minCount Owned count at which an item stops qualifying.
 * @return {Array<{id: string, name: string, badge: number}>}
 */
export function getPurchasableShopItems(badges, ownedItems = {}, minCount = 1) {
  if (!Number.isFinite(badges)) return [];
  const extrasById = Object.fromEntries(
    REBORN_EXTRA_INVENTORY_ITEMS.map((item) => [item.id, item]),
  );
  const results = [];
  for (const [id, badge] of Object.entries(REBORN_SHOP_ITEM_BADGES)) {
    if (badge > badges) continue;
    if (HIDDEN_INVENTORY_ITEM_IDS.has(id)) continue;
    const item = GEN7_HELD_ITEMS_BY_ID[id] || extrasById[id];
    if (!item) continue;
    if ((ownedItems[id] || 0) >= minCount) continue;
    results.push({ id, name: item.name, badge });
  }
  return results.sort((a, b) => a.name.localeCompare(b.name));
}
