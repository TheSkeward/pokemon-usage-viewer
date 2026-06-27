// Reborn replaces the Gen 7 Terrain Seeds with four Field Seeds that trigger on
// its Field Effects, each giving a conditional free stat boost (plus a side
// effect). They don't exist in USUM, so they have no Gen 7 usage. We proxy their
// demand from a Pokémon's aggregate Gen 7 terrain-seed usage — the same item
// category (a conditional, field-triggered defensive/utility seed).
//
// The proxy is category-level (not per-field), since which Reborn field a player
// is on is a playthrough variable, not a property of the Pokémon.

export const REBORN_SEEDS = [
  "Elemental Seed",
  "Telluric Seed",
  "Synthetic Seed",
  "Magical Seed",
];

// Gen 7 terrain seeds whose usage signals affinity for a field-triggered seed.
export const GEN7_TERRAIN_SEEDS = [
  "Electric Seed",
  "Grassy Seed",
  "Misty Seed",
  "Psychic Seed",
];
