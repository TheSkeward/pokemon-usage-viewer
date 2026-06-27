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

// Gen 7 terrain seeds. Their combined usage gives D — how much a Pokémon runs a
// field-triggered seed at all — which scales the seed recommendation.
export const GEN7_TERRAIN_SEEDS = [
  "Electric Seed",
  "Grassy Seed",
  "Misty Seed",
  "Psychic Seed",
];

// Each seed's stat-boost profile, summed over every field it activates on (from
// the wiki Seed Interaction table) as [Atk, Def, SpA, SpD, Spe]. The stat-fit
// model weights these against a Pokémon's above-average base stats, so each seed
// gravitates to the archetype it amplifies: Elemental→fast, Telluric→physical
// bulk, Synthetic→special wall, Magical→special attacker.
const RAW_SEED_STAT_VECTORS = {
  "Elemental Seed": [2, 1, 3, 2, 6],
  "Telluric Seed": [3, 6, 3, 2, 1],
  "Synthetic Seed": [1, 1, 2, 2, 0],
  "Magical Seed": [2, 2, 8, 3, 2],
};

// Normalized so each seed's weights sum to 1 (keeps the stat-fit shares
// comparable and guarantees no seed structurally dominates another).
export const REBORN_SEED_STAT_VECTORS = Object.fromEntries(
  Object.entries(RAW_SEED_STAT_VECTORS).map(([name, vec]) => {
    const total = vec.reduce((sum, value) => sum + value, 0);
    return [name, vec.map((value) => value / total)];
  }),
);
