import { dataUrl } from "../utils/dataUrl.js";
import { toId } from "../utils/ids.js";

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

// Assigns at most one owned held item to each team member, maximizing total
// observed usage while respecting how many of each item the player owns (a
// single Life Orb can't be handed to two Pokémon).
export function assignTeamItems({ team, usageByMember, ownedItems }) {
  const remaining = { ...(ownedItems || {}) };
  const pairs = [];

  for (const choice of team || []) {
    const key = teamMemberKey(choice);
    for (const item of usageByMember.get(key) || []) {
      if ((remaining[item.id] || 0) > 0) {
        pairs.push({ key, item });
      }
    }
  }

  pairs.sort((a, b) => b.item.usage - a.item.usage);

  const assignments = {};

  for (const pair of pairs) {
    if (assignments[pair.key]) continue;
    if ((remaining[pair.item.id] || 0) <= 0) continue;

    assignments[pair.key] = pair.item;
    remaining[pair.item.id] -= 1;
  }

  return assignments;
}

async function fetchMemberItems({ family, pokemonId, selection }) {
  const data =
    (await fetchSetIndex({ family, pokemonId, selection })) ||
    (selection !== "all"
      ? await fetchSetIndex({ family, pokemonId, selection: "all" })
      : null);

  if (!data?.items) return [];

  return data.items
    .filter((item) => typeof item.usage === "number")
    .map((item) => ({
      id: toId(item.name),
      name: item.name,
      usage: item.usage,
    }));
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
