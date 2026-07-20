/**
 * @fileoverview Reborn replaces the Gen 7 Terrain Seeds with four Field Seeds
 * that trigger on its Field Effects, each giving a conditional free stat boost
 * (plus a side effect). They don't exist in USUM, so they have no Gen 7 usage.
 * We proxy their demand from a Pokémon's aggregate Gen 7 terrain-seed usage —
 * the same item category (a conditional, field-triggered defensive/utility
 * seed).
 *
 * The proxy is category-level (not per-field), since which Reborn field a
 * player is on is a playthrough variable, not a property of the Pokémon.
 */

/** The four Reborn Field Seeds. Display names. */
export const REBORN_SEEDS = [
  'Elemental Seed',
  'Telluric Seed',
  'Synthetic Seed',
  'Magical Seed',
];

/**
 * Gen 7 terrain seeds. Their combined usage gives D — how much a Pokémon runs a
 * field-triggered seed at all — which scales the seed recommendation.
 */
export const GEN7_TERRAIN_SEEDS = [
  'Electric Seed',
  'Grassy Seed',
  'Misty Seed',
  'Psychic Seed',
];

/**
 * In Reborn the terrain seeds are replaced by the field seeds, so they're
 * hidden from the inventory picker. The mapping follows the wiki: each
 * terrain's seed in Reborn is Elemental (Electric/Grassy/Misty Terrain) or
 * Magical (Psychic Terrain). An already-owned terrain seed migrates to its
 * replacement.
 */
export const TERRAIN_SEED_REPLACEMENTS = {
  'Electric Seed': 'Elemental Seed',
  'Grassy Seed': 'Elemental Seed',
  'Misty Seed': 'Elemental Seed',
  'Psychic Seed': 'Magical Seed',
};

const seedId = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * id -> replacement id, for migrating saved inventory off the hidden seeds.
 * @type {Object<string, string>}
 */
export const TERRAIN_SEED_MIGRATION = Object.fromEntries(
  Object.entries(TERRAIN_SEED_REPLACEMENTS).map(([from, to]) => [
    seedId(from),
    seedId(to),
  ]),
);

/**
 * Item ids that must not be selectable in the inventory picker.
 * @type {Set<string>}
 */
export const HIDDEN_INVENTORY_ITEM_IDS = new Set(
  Object.keys(TERRAIN_SEED_MIGRATION),
);

// Each seed's stat-boost profile, summed over every field it activates on (from
// the wiki Seed Interaction table) as [Atk, Def, SpA, SpD, Spe]. The stat-fit
// model weights these against a Pokémon's above-average base stats, so each seed
// gravitates to the archetype it amplifies: Elemental→fast, Telluric→physical
// bulk, Synthetic→special wall, Magical→special attacker.
const RAW_SEED_STAT_VECTORS = {
  'Elemental Seed': [2, 1, 3, 2, 6],
  'Telluric Seed': [3, 6, 3, 2, 1],
  'Synthetic Seed': [1, 1, 2, 2, 0],
  'Magical Seed': [2, 2, 8, 3, 2],
};

/**
 * Normalized so each seed's weights sum to 1 (keeps the stat-fit shares
 * comparable and guarantees no seed structurally dominates another).
 * @type {Object<string, Array<number>>}
 */
export const REBORN_SEED_STAT_VECTORS = Object.fromEntries(
  Object.entries(RAW_SEED_STAT_VECTORS).map(([name, vec]) => {
    const total = vec.reduce((sum, value) => sum + value, 0);
    return [name, vec.map((value) => value / total)];
  }),
);
