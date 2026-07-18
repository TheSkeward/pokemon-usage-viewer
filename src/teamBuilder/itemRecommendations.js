import { dataUrl } from "../utils/dataUrl.js";
import { fetchJsonCached } from "../utils/fetchJsonCached.js";
import { toId } from "../utils/ids.js";
import { TYPE_GEMS } from "../reborn/typeGems.js";
import {
  GEN7_HELD_ITEMS,
  GEN7_HELD_ITEMS_BY_ID,
} from "../generated/gen7HeldItems.generated.js";
import {
  REBORN_SEEDS,
  GEN7_TERRAIN_SEEDS,
  REBORN_SEED_STAT_VECTORS,
} from "../reborn/rebornSeeds.js";
import { GEN7_BASE_STATS } from "../generated/gen7BaseStats.generated.js";

const TERRAIN_SEED_IDS = GEN7_TERRAIN_SEEDS.map((name) => toId(name));
// seedId -> { name, vector } from the normalized stat profiles.
const REBORN_SEED_BY_ID = new Map(
  REBORN_SEEDS.map((name) => [
    toId(name),
    { name, vector: REBORN_SEED_STAT_VECTORS[name] },
  ]),
);

// Map each Z-Crystal id to the gem it stands in for, so a member's Z-Crystal
// usage can be reused as a proxy for the equivalent Reborn type Gem.
const GEM_BY_Z_CRYSTAL_ID = new Map(
  TYPE_GEMS.map((gem) => [
    toId(gem.zCrystalName),
    { id: toId(gem.gemName), name: gem.gemName },
  ]),
);

const GEM_IDS = new Set(TYPE_GEMS.map((gem) => toId(gem.gemName)));

// gemId -> the move type it boosts, so a gem is only handed to a member whose
// recommended moves actually include a move of that type.
const GEM_TYPE_BY_ID = new Map(
  TYPE_GEMS.map((gem) => [toId(gem.gemName), gem.type]),
);

// A type Gem only fires on a move of its own type — useless otherwise — so an
// item is eligible for a member if it isn't a gem, or it is a gem whose type is
// among that member's recommended damaging-move types. Members with no known
// move types (allowedTypes undefined) are not gated, preserving prior behavior.
// The field extender (Amplifield Rock) is likewise useless without a field-
// setting move in the member's recommended set.
function itemEligibleForMember(itemId, allowedTypes, fieldSetterShare = null) {
  if (itemId === FIELD_EXTENDER_ITEM_ID) {
    return fieldSetterShare == null || fieldSetterShare > 0;
  }
  const gemType = GEM_TYPE_BY_ID.get(itemId);
  if (!gemType) return true;
  if (!allowedTypes) return true;
  return allowedTypes.has(gemType);
}

export const FIELD_EXTENDER_ITEM_ID = "amplifieldrock";
// Measured conditional propensity of the nearest mainline analog (Light Clay
// held given screens usage, rawCount-weighted across gen7) — the fraction of
// setter sets that pay the item slot for the duration extender.
const FIELD_EXTENDER_PROPENSITY = 0.8;

// The Amplifield Rock never appears in Smogon item usage (fangame-original),
// so a member whose recommended set carries a field-setting move gets it
// injected as a candidate. Weight = propensity × the member's own setter-move
// usage share — the same estimator the propensity was measured with — so it
// competes honestly against observed items for the scarce owned copy.
export function withFieldExtenderCandidate(items, fieldSetterShare) {
  if (!fieldSetterShare || fieldSetterShare <= 0) return items;
  return [
    ...items,
    {
      id: FIELD_EXTENDER_ITEM_ID,
      name: "Amplifield Rock",
      usage: null,
      weight: FIELD_EXTENDER_PROPENSITY * fieldSetterShare,
      fieldExtender: true,
    },
  ];
}

// Unburden doubles Speed when a consumable item is used up. We only boost type
// Gems for Unburden species: gems are absent from the Gen 7 data (proxied from
// non-triggering Z-Crystals), so their Unburden synergy isn't captured anywhere
// else. Berries and field seeds are NOT boosted — if Unburden + berry/seed is a
// good strat it already shows up in the Gen 7 usage we blend in, and boosting it
// again would double-count.
const UNBURDEN_GEM_MULTIPLIER = 1.75;

// Generically-good-item ordering for the ultimate fallback: GEN7_HELD_ITEMS is
// sorted by how broadly each item is used, so a lower index = better default.
const ITEM_QUALITY_RANK = new Map(
  GEN7_HELD_ITEMS.map((item, index) => [item.id, index]),
);

// Smogon itemizes the most-used items and folds the rest into "Other"; the set
// index then stitches a tail from other elos/formats/pre-evolutions that has no
// usage %. We still want those as candidates, just ranked below any real %, so
// they get a small descending weight.
const TAIL_BASE_WEIGHT = 0.09;
const TAIL_STEP = 0.0005;

export function teamMemberKey(choice) {
  return `${choice.inputPokemonId}|${choice.pokemonId}`;
}

// Loads each team member's observed Smogon held-item usage (id + usage%), keyed
// by member. Cached by the caller so recommendations can recompute instantly
// when the owned-item inventory changes without re-fetching. The optional
// itemContext (memberKey -> { unburden }) decides the Unburden gem boost from
// the member's actual top-set ability rather than merely whether the species
// can have Unburden.
export async function loadTeamItemUsage({ team, family, selection, itemContext }) {
  const usageByMember = new Map();

  await Promise.all(
    (team || []).map(async (choice) => {
      const key = teamMemberKey(choice);
      const items = await fetchMemberItems({
        family,
        pokemonId: choice.pokemonId,
        selection,
        unburden: Boolean(itemContext?.get(key)?.unburden),
      });
      usageByMember.set(
        key,
        withFieldExtenderCandidate(
          items,
          itemContext?.get(key)?.fieldSetterShare || 0,
        ),
      );
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
export function assignTeamItems({ team, usageByMember, ownedItems, itemContext }) {
  const remaining = { ...(ownedItems || {}) };
  const assignments = {};
  const members = team || [];
  const allowedGemTypesFor = (key) => itemContext?.get(key)?.damageTypes;
  const fieldSetterShareFor = (key) => itemContext?.get(key)?.fieldSetterShare ?? null;

  const pairs = [];
  for (const choice of members) {
    const key = teamMemberKey(choice);
    const allowedGemTypes = allowedGemTypesFor(key);
    for (const item of usageByMember.get(key) || []) {
      if ((remaining[item.id] || 0) <= 0) continue;
      if (!itemEligibleForMember(item.id, allowedGemTypes, fieldSetterShareFor(key)))
        continue;
      pairs.push({ key, item });
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
    const itemId = bestRemainingItem(
      remaining,
      allowedGemTypesFor(teamMemberKey(choice)),
      fieldSetterShareFor(teamMemberKey(choice)),
    );
    if (!itemId) break;

    assignments[teamMemberKey(choice)] = {
      id: itemId,
      name:
        GEN7_HELD_ITEMS_BY_ID[itemId]?.name ||
        (itemId === FIELD_EXTENDER_ITEM_ID ? "Amplifield Rock" : itemId),
      usage: null,
      fallback: true,
    };
    remaining[itemId] -= 1;
  }

  return assignments;
}

function bestRemainingItem(remaining, allowedGemTypes, fieldSetterShare = null) {
  let best = null;
  let bestRank = Infinity;

  for (const [itemId, count] of Object.entries(remaining)) {
    if (count <= 0) continue;
    // Don't dump a leftover type Gem on a member that can't use it — a gem with
    // no matching move never triggers, so it's no better than no item.
    if (!itemEligibleForMember(itemId, allowedGemTypes, fieldSetterShare)) continue;
    const rank = ITEM_QUALITY_RANK.get(itemId) ?? Number.MAX_SAFE_INTEGER;
    if (rank < bestRank) {
      bestRank = rank;
      best = itemId;
    }
  }

  return best;
}

async function fetchMemberItems({ family, pokemonId, selection, unburden }) {
  const [data, gen5Items] = await Promise.all([
    fetchSetIndex({ family, pokemonId, selection }).then(
      (primary) =>
        primary ||
        (selection !== "all"
          ? fetchSetIndex({ family, pokemonId, selection: "all" })
          : null),
    ),
    fetchGen5Items(pokemonId),
  ]);

  if (!data?.items && !gen5Items.length) return [];

  // Keep the best (highest-weight) entry per item id across primary + tail.
  const byId = new Map();
  let tailRank = 0;

  for (const item of data?.items || []) {
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
    applyUnburden(entry, unburden);

    const existing = byId.get(id);
    if (!existing || entry.weight > existing.weight) byId.set(id, entry);
  }

  // Blend in real Gen 5 item usage. Gen 5 had the type Gems as legal, used
  // items, so for Pokémon that existed then this provides real gem data that
  // pre-empts the Z-Crystal proxy below (real-data-first). Merged by best
  // weight so it also enriches non-gem items.
  for (const item of gen5Items) {
    const id = toId(item.name);
    if (!id || typeof item.usage !== "number") continue;

    const entry = { id, name: item.name, usage: item.usage, weight: item.usage, gen5: true };
    applyUnburden(entry, unburden);

    const existing = byId.get(id);
    if (!existing || entry.weight > existing.weight) byId.set(id, entry);
  }

  // Type Gems have no USUM usage; proxy each from this member's matching
  // Z-Crystal (primary or tail) — both are one-use, type-keyed damage boosts.
  // Skipped for any gem already supplied with real Gen 5 usage above.
  for (const entry of [...byId.values()]) {
    const gem = GEM_BY_Z_CRYSTAL_ID.get(entry.id);
    if (gem && !byId.has(gem.id)) {
      const gemEntry = {
        id: gem.id,
        name: gem.name,
        usage: entry.usage,
        // Use the pre-Unburden weight so the gem isn't double-counted; reapply
        // the bonus to the gem itself (gems are consumables that trigger it).
        weight: entry.baseWeight ?? entry.weight,
        proxy: true,
      };
      applyUnburden(gemEntry, unburden);
      byId.set(gem.id, gemEntry);
    }
  }

  // Reborn Field Seeds: weight = D × stat-fit. D (the member's total Gen 7
  // terrain-seed usage) sets the magnitude — "does this Pokémon run field seeds
  // at all" — and is honestly low for most. The stat-fit share decides *which*
  // seed, steering each toward the archetype it amplifies.
  const D = TERRAIN_SEED_IDS.reduce(
    (sum, id) => sum + (byId.get(id)?.usage || 0),
    0,
  );
  if (D > 0) {
    for (const [seedId, seedWeight] of seedWeights(pokemonId, D)) {
      if (byId.has(seedId)) continue;
      const entry = {
        id: seedId,
        name: REBORN_SEED_BY_ID.get(seedId).name,
        usage: seedWeight,
        weight: seedWeight,
        proxy: true,
        seed: true,
      };
      applyUnburden(entry, unburden);
      byId.set(seedId, entry);
    }
  }

  return [...byId.values()];
}

// Distributes the seed magnitude D across the four Reborn seeds by amplify-
// strength stat-fit: each seed scores the Pokémon's *above-average* base stats
// weighted by what that seed boosts, normalized to shares that sum to 1.
function seedWeights(pokemonId, D) {
  const stats = GEN7_BASE_STATS[toId(pokemonId)];
  if (!stats) return [];

  const mean = stats.reduce((sum, value) => sum + value, 0) / stats.length;
  const above = stats.map((value) => Math.max(0, value - mean));

  const fits = [...REBORN_SEED_BY_ID].map(([seedId, { vector }]) => [
    seedId,
    vector.reduce((sum, weight, index) => sum + weight * above[index], 0),
  ]);

  const total = fits.reduce((sum, [, fit]) => sum + fit, 0);
  if (total <= 0) return [];

  return fits.map(([seedId, fit]) => [seedId, D * (fit / total)]);
}

function applyUnburden(entry, unburden) {
  if (!unburden || !GEM_IDS.has(entry.id)) return;
  entry.baseWeight = entry.weight;
  entry.weight *= UNBURDEN_GEM_MULTIPLIER;
  entry.unburden = true;
}

async function fetchGen5Items(pokemonId) {
  try {
    const data = await fetchJsonCached(
      dataUrl(`gen5-items/${toId(pokemonId)}.json`),
    );
    return data?.items || [];
  } catch {
    return [];
  }
}

async function fetchSetIndex({ family, pokemonId, selection }) {
  try {
    return await fetchJsonCached(
      dataUrl(`set-index/${family}/${selection}/${pokemonId}.json`),
    );
  } catch {
    return null;
  }
}
