/** The 18 Gen 7 types, in the fixed order the analysis grids index by. */
export const REBORN_ANALYSIS_TYPES = [
  'Normal',
  'Fire',
  'Water',
  'Electric',
  'Grass',
  'Ice',
  'Fighting',
  'Poison',
  'Ground',
  'Flying',
  'Psychic',
  'Bug',
  'Rock',
  'Ghost',
  'Dragon',
  'Dark',
  'Steel',
  'Fairy',
];

/**
 * Combined effectiveness of an attacking type against a defensive typing:
 * the product of the per-type multipliers (0 on any immunity), so 0–4 for
 * standard dual types. Unknown type names contribute ×1.
 * @param {string} attackType
 * @param {Array<string>} defenseTypes
 * @return {number}
 */
export function getTypeMultiplier(attackType, defenseTypes = []) {
  let multiplier = 1;

  for (const defenseType of defenseTypes) {
    const code = TYPE_DAMAGE_TAKEN[defenseType]?.[attackType];

    if (code === 3) return 0;
    if (code === 1) multiplier *= 2;
    if (code === 2) multiplier *= 0.5;
  }

  return multiplier;
}

const TYPE_DAMAGE_TAKEN = {
  Normal: { Fighting: 1, Ghost: 3 },
  Fire: {
    Ground: 1, Rock: 1, Water: 1, Bug: 2, Fairy: 2, Fire: 2, Grass: 2, Ice: 2,
    Steel: 2,
  },
  Water: { Electric: 1, Grass: 1, Fire: 2, Ice: 2, Steel: 2, Water: 2 },
  Electric: { Ground: 1, Electric: 2, Flying: 2, Steel: 2 },
  Grass: {
    Bug: 1, Fire: 1, Flying: 1, Ice: 1, Poison: 1, Electric: 2, Grass: 2,
    Ground: 2, Water: 2,
  },
  Ice: { Fighting: 1, Fire: 1, Rock: 1, Steel: 1, Ice: 2 },
  Fighting: { Fairy: 1, Flying: 1, Psychic: 1, Bug: 2, Dark: 2, Rock: 2 },
  Poison: {
    Ground: 1, Psychic: 1, Bug: 2, Fairy: 2, Fighting: 2, Grass: 2, Poison: 2,
  },
  Ground: { Grass: 1, Ice: 1, Water: 1, Electric: 3, Poison: 2, Rock: 2 },
  Flying: {
    Electric: 1, Ice: 1, Rock: 1, Ground: 3, Bug: 2, Fighting: 2, Grass: 2,
  },
  Psychic: { Bug: 1, Dark: 1, Ghost: 1, Fighting: 2, Psychic: 2 },
  Bug: { Fire: 1, Flying: 1, Rock: 1, Fighting: 2, Grass: 2, Ground: 2 },
  Rock: {
    Fighting: 1, Grass: 1, Ground: 1, Steel: 1, Water: 1, Fire: 2, Flying: 2,
    Normal: 2, Poison: 2,
  },
  Ghost: { Dark: 1, Ghost: 1, Fighting: 3, Normal: 3, Bug: 2, Poison: 2 },
  Dragon: {
    Dragon: 1, Fairy: 1, Ice: 1, Electric: 2, Fire: 2, Grass: 2, Water: 2,
  },
  Dark: { Bug: 1, Fairy: 1, Fighting: 1, Psychic: 3, Dark: 2, Ghost: 2 },
  Steel: {
    Fighting: 1, Fire: 1, Ground: 1, Poison: 3, Bug: 2, Dragon: 2, Fairy: 2,
    Flying: 2, Grass: 2, Ice: 2, Normal: 2, Psychic: 2, Rock: 2, Steel: 2,
  },
  Fairy: { Poison: 1, Steel: 1, Dragon: 3, Bug: 2, Dark: 2, Fighting: 2 },
};
