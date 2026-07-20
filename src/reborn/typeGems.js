/**
 * @fileoverview Reborn has the full set of type Gems — one-use items that boost
 * the power of a move of their type. They don't exist in USUM, so there's no
 * Gen 7 Smogon usage for them. We proxy each gem's competitive demand with the
 * matching Gen 7 Z-Crystal, which is also a one-use, type-keyed damage boost:
 * if a Pokémon runs Buginium Z, it's a good bet it would want a Bug Gem in
 * Reborn.
 */

/** @type {Array<{type: string, gemName: string, zCrystalName: string}>} */
export const TYPE_GEMS = [
  { type: "Normal", gemName: "Normal Gem", zCrystalName: "Normalium Z" },
  { type: "Fire", gemName: "Fire Gem", zCrystalName: "Firium Z" },
  { type: "Water", gemName: "Water Gem", zCrystalName: "Waterium Z" },
  { type: "Electric", gemName: "Electric Gem", zCrystalName: "Electrium Z" },
  { type: "Grass", gemName: "Grass Gem", zCrystalName: "Grassium Z" },
  { type: "Ice", gemName: "Ice Gem", zCrystalName: "Icium Z" },
  { type: "Fighting", gemName: "Fighting Gem", zCrystalName: "Fightinium Z" },
  { type: "Poison", gemName: "Poison Gem", zCrystalName: "Poisonium Z" },
  { type: "Ground", gemName: "Ground Gem", zCrystalName: "Groundium Z" },
  { type: "Flying", gemName: "Flying Gem", zCrystalName: "Flyinium Z" },
  { type: "Psychic", gemName: "Psychic Gem", zCrystalName: "Psychium Z" },
  { type: "Bug", gemName: "Bug Gem", zCrystalName: "Buginium Z" },
  { type: "Rock", gemName: "Rock Gem", zCrystalName: "Rockium Z" },
  { type: "Ghost", gemName: "Ghost Gem", zCrystalName: "Ghostium Z" },
  { type: "Dragon", gemName: "Dragon Gem", zCrystalName: "Dragonium Z" },
  { type: "Dark", gemName: "Dark Gem", zCrystalName: "Darkinium Z" },
  { type: "Steel", gemName: "Steel Gem", zCrystalName: "Steelium Z" },
  { type: "Fairy", gemName: "Fairy Gem", zCrystalName: "Fairium Z" },
];
