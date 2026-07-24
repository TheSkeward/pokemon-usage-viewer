/**
 * Reborn-only inventory items that aren't in the Gen 7 held-items list but
 * belong in the owned-items tracker.
 * @type {Array<{id: string, name: string}>}
 */
export const REBORN_EXTRA_INVENTORY_ITEMS = Object.freeze([
  { id: 'linkstone', name: 'Link Stone' },
  // Reborn-original (E16+): the holder's area-altering moves last 8 turns
  // instead of 5 — the fangame's generalized Terrain Extender. Outside the
  // usage prior's universe, so its scoring signal is the borrowed-prior
  // field-extender bonus (see scoringConstants FIELD_EXTENDER_UTILITY_BONUS).
  { id: 'amplifieldrock', name: 'Amplifield Rock' },
]);
