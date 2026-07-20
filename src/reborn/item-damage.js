import { GEN7_ITEM_DAMAGE } from '../generated/gen7ItemDamage.generated.js';
import { toId } from '../utils/ids.js';

/**
 * The damage multiplier a held item grants a given move: 1 when the item has no
 * damage effect, doesn't apply to this move's type/category, or (for signature
 * items like Light Ball) isn't held by an eligible species. Type Gems are
 * modeled as a persistent boost — an approximation of their single-use ×1.3.
 * @param {?string} itemId
 * @param {{type: string, category: string, pokemonId: string}=} move
 * @return {number}
 */
export function getItemDamageMultiplier(
  itemId, { type, category, pokemonId } = {}) {
  if (!itemId) return 1;
  const rule = GEN7_ITEM_DAMAGE[toId(itemId)];
  if (!rule) return 1;
  if (rule.users && !rule.users.includes(toId(pokemonId))) return 1;
  if (rule.category && rule.category !== category) return 1;
  if (rule.type && rule.type !== type) return 1;
  if (rule.types && !rule.types.includes(type)) return 1;
  return rule.mult;
}
