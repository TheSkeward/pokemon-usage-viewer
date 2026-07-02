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

export function getItemAvailability(itemName) {
  const id = String(itemName || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  if (!id) return { status: "unknown", source: "no item recorded" };
  return (
    ITEM_AVAILABILITY[id] || {
      status: "unknown",
      source: `no availability data for ${itemName}`,
    }
  );
}
