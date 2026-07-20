/**
 * The Pokémon Reborn game descriptor. A descriptor names everything about a
 * game the ENGINE must not hardcode: where its extracted data lives, which
 * localStorage keys hold its per-playthrough state, and which dex generation
 * its species/move data is built from.
 *
 * Reborn predates the registry, so its data paths and storage keys keep their
 * original un-namespaced literal values: renaming the paths would orphan every
 * deployed data manifest, and renaming the keys would silently discard every
 * existing player's saved pool and progression. New games namespace both by
 * game id.
 */
export const REBORN_GAME = Object.freeze({
  id: 'reborn',
  label: 'Pokémon Reborn',
  // Dex generation the generated species/move modules are built from. The
  // engine still imports gen7 generated modules directly; this field is only
  // the declaration.
  dexGen: 7,
  data: Object.freeze({
    legalMovesDir: 'reborn-legal-moves',
    itemAvailability: 'reborn-item-availability.extracted.json',
  }),
  storage: Object.freeze({
    progression: 'pokemon-usage-viewer:reborn-progression:v1',
    pool: 'pokemon-usage-viewer:owned-pool:v1',
  }),
});
