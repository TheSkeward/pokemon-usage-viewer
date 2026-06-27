import { dataUrl } from "../utils/dataUrl.js";
import { toId } from "../utils/ids.js";
import { TYPE_GEMS } from "../reborn/typeGems.js";
import {
  GEN7_HELD_ITEMS,
  GEN7_HELD_ITEMS_BY_ID,
} from "../generated/gen7HeldItems.generated.js";

// Map each Z-Crystal id to the gem it stands in for, so a member's Z-Crystal
// usage can be reused as a proxy for the equivalent Reborn type Gem.
const GEM_BY_Z_CRYSTAL_ID = new Map(
  TYPE_GEMS.map((gem) => [
    toId(gem.zCrystalName),
    { id: toId(gem.gemName), name: gem.gemName },
  ]),
);

// Generically-good-item ordering for the ultimate fallback: GEN7_HELD_ITEMS is
// sorted by how broadly each item is used, so a lower index = better default.
const ITEM_QUALITY_RANK = new Map(
  GEN7_HELD_ITEMS.map((item, index) => [item.id, index]),
);

// Smogon itemizes the most-used items and folds the rest into "Other"; the set
// index then stitches a tail from other elos/formats/pre-evolutions that has no
// usage %. We still want those as candidates, just ranked below any real %, so
// they get a small descending weight that stays under the meaningful floor.
const TAIL_BASE_WEIGHT = 0.09;
const TAIL_STEP = 0.0005;

export function teamMemberKey(choice) {
  return `${choice.inputPokemonId}|${choice.pokemonId}`;
}

// Loads each team member's observed Smogon held-item usage (id + usage%), keyed
// by member. Cached by the caller so recommendations can recompute instantly
// when the owned-item inventory changes without re-fetching.
export async function loadTeamItemUsage({ team, family, selection }) {
  const usageByMember = new Map();

  await Promise.all(
    (team || []).map(async (choice) => {
      const items = await fetchMemberItems({
        family,
        pokemonId: choice.pokemonId,
        selection,
      });
      usageByMember.set(teamMemberKey(choice), items);
    }),
  );

  return usageByMember;
}

// Assigns at most one owned held item to each team member, respecting how many
// of each the player owns. Two phases:
//   1. weighted greedy over each member's observed items (incl. the stitched
//      tail and gem proxies) so the best fit wins scarce items;
//   2. an ultimate fallback that hands any leftover owned items to still-
//      itemless members — a held item beats none — giving the best generic
//      item to the highest-scoring member first.
export function assignTeamItems({ team, usageByMember, ownedItems }) {
  const remaining = { ...(ownedItems || {}) };
  const assignments = {};
  const members = team || [];

  const pairs = [];
  for (const choice of members) {
    const key = teamMemberKey(choice);
    for (const item of usageByMember.get(key) || []) {
      if ((remaining[item.id] || 0) > 0) pairs.push({ key, item });
    }
  }

  pairs.sort((a, b) => b.item.weight - a.item.weight);

  for (const pair of pairs) {
    if (assignments[pair.key]) continue;
    if ((remaining[pair.item.id] || 0) <= 0) continue;

    assignments[pair.key] = pair.item;
    remaining[pair.item.id] -= 1;
  }

  const itemless = members
    .filter((choice) => !assignments[teamMemberKey(choice)])
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  for (const choice of itemless) {
    const itemId = bestRemainingItem(remaining);
    if (!itemId) break;

    assignments[teamMemberKey(choice)] = {
      id: itemId,
      name: GEN7_HELD_ITEMS_BY_ID[itemId]?.name || itemId,
      usage: null,
      fallback: true,
    };
    remaining[itemId] -= 1;
  }

  return assignments;
}

function bestRemainingItem(remaining) {
  let best = null;
  let bestRank = Infinity;

  for (const [itemId, count] of Object.entries(remaining)) {
    if (count <= 0) continue;
    const rank = ITEM_QUALITY_RANK.get(itemId) ?? Number.MAX_SAFE_INTEGER;
    if (rank < bestRank) {
      bestRank = rank;
      best = itemId;
    }
  }

  return best;
}

async function fetchMemberItems({ family, pokemonId, selection }) {
  const data =
    (await fetchSetIndex({ family, pokemonId, selection })) ||
    (selection !== "all"
      ? await fetchSetIndex({ family, pokemonId, selection: "all" })
      : null);

  if (!data?.items) return [];

  // Keep the best (highest-weight) entry per item id across primary + tail.
  const byId = new Map();
  let tailRank = 0;

  for (const item of data.items) {
    const id = toId(item.name);
    if (!id) continue;

    const hasUsage = typeof item.usage === "number";
    const weight = hasUsage
      ? item.usage
      : Math.max(0.0001, TAIL_BASE_WEIGHT - tailRank * TAIL_STEP);
    if (!hasUsage) tailRank += 1;

    const entry = {
      id,
      name: item.name,
      usage: hasUsage ? item.usage : null,
      weight,
    };

    const existing = byId.get(id);
    if (!existing || weight > existing.weight) byId.set(id, entry);
  }

  // Type Gems have no USUM usage; proxy each from this member's matching
  // Z-Crystal (primary or tail) — both are one-use, type-keyed damage boosts.
  for (const entry of [...byId.values()]) {
    const gem = GEM_BY_Z_CRYSTAL_ID.get(entry.id);
    if (gem && !byId.has(gem.id)) {
      byId.set(gem.id, {
        id: gem.id,
        name: gem.name,
        usage: entry.usage,
        weight: entry.weight,
        proxy: true,
      });
    }
  }

  return [...byId.values()];
}

async function fetchSetIndex({ family, pokemonId, selection }) {
  try {
    const response = await fetch(
      dataUrl(`set-index/${family}/${selection}/${pokemonId}.json`),
    );
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}
