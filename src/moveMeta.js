import { Dex } from '@pkmn/dex';

const dex = Dex.forGen(7);
const cache = new Map();

const TYPE_COLORS = {
  Normal: '#A8A77A', Fire: '#EE8130', Water: '#6390F0', Electric: '#F7D02C',
  Grass: '#7AC74C', Ice: '#96D9D6', Fighting: '#C22E28', Poison: '#A33EA1',
  Ground: '#E2BF65', Flying: '#A98FF3', Psychic: '#F95587', Bug: '#A6B91A',
  Rock: '#B6A136', Ghost: '#735797', Dragon: '#6F35FC', Dark: '#705746',
  Steel: '#B7B7CE', Fairy: '#D685AD',
};

const CATEGORY_COLORS = {
  Physical: '#E85D75',
  Special: '#5DA9E9',
  Status: '#9AA5B1',
};

export function getMoveMeta(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;
  if (cache.has(trimmed)) return cache.get(trimmed);

  const move = dex.moves.get(trimmed);
  if (!move?.exists) {
    cache.set(trimmed, null);
    return null;
  }

  const meta = {
    type: move.type,
    category: move.category,
  };

  cache.set(trimmed, meta);
  return meta;
}

export function getTypeColor(type) {
  return TYPE_COLORS[type] || '#AAB5C3';
}

export function getCategoryColor(category) {
  return CATEGORY_COLORS[category] || '#AAB5C3';
}
