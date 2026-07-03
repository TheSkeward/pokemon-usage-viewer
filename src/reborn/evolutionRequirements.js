// Evolution legality-with-friction (roadmap Phase 4B). One uniform rule set —
// nothing mon-specific, no verdict fitting:
//
//   level evolution:      legal if the cap permits, K = 0
//   friendship:           legal, K = friendship grind
//   move-based:           legal once the pre-evo can have learned the move
//                         (gated by the move's learn level vs the cap)
//   item / hold / trade:  legal if the item is farmable (curated, sourced
//                         table), K = item friction (higher when tedious);
//                         UNKNOWN item availability is surfaced, not silently
//                         blocked or allowed
//   special condition:    affection ⇒ friendship-like; trivial party/time
//                         conditions ⇒ minor friction; known Reborn location
//                         evolutions (moss/ice rock, magnetic field, Lanakila
//                         equivalent) ⇒ legal with item-level friction — the
//                         locations exist in Reborn and open up mid-game
//
// If a correct requirement model makes some line good, it competes; if that
// looks wrong, the fix is C/K/utility — never a special legality rule.

import { GEN7_PROGRESSION_SPECIES } from "../generated/gen7ProgressionSpecies.generated.js";
import { getItemAvailability } from "./itemAvailability.js";
import { tunable } from "../teamBuilder/scoringConstants.js";

const TEDIOUS_MULTIPLIER = 1.5;

// Player-facing access gates: which SPECIAL evolution methods the player can
// currently use (Reborn locks them behind story/area unlocks — the magnetic
// field lives behind Shade's gym via the Yureyal key, stones drip in over
// badges, the Link Stone is a mid-game purchase). Each maps a requirement to
// a flat boolean progression field; an ABSENT field means accessible (so old
// saved progressions and tests behave exactly as before), an explicit `false`
// blocks the evolution — surfaced in blockedEvolutions, never silent.
export const EVOLUTION_ACCESS_FIELDS = Object.freeze([
  { key: "evoAccessFriendship", label: "Friendship / affection evolutions" },
  { key: "evoAccessStones", label: "Evolution stones & held items" },
  { key: "evoAccessLinkStone", label: "Link Stone (trade evolutions)" },
  { key: "evoAccessMagneticField", label: "Magnetic field area (Probopass, Magnezone, Vikavolt)" },
  { key: "evoAccessMossyRock", label: "Moss Rock (Leafeon)" },
  { key: "evoAccessIcyRock", label: "Ice Rock (Glaceon)" },
  { key: "evoAccessOtherLocations", label: "Other special locations (Crabominable)" },
]);

// How many of `itemName` the player tracked as owned (progression.ownedItems,
// keyed by normalized id). An owned evolution item removes BOTH the access
// gate and the acquisition friction for its step — it's in the bag.
function ownedItemCount(access, itemName) {
  if (!access?.ownedItems) return 0;
  const id = String(itemName || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  return id ? access.ownedItems[id] || 0 : 0;
}

// The access gate a requirement depends on, or null when none applies.
function requiredAccessKeys(evoType, condition, species) {
  if (evoType === "levelFriendship") return ["evoAccessFriendship"];
  if (evoType === "trade") {
    // Trade-with-item (Metal Coat Scizor) needs the item too.
    return species.evoItem
      ? ["evoAccessLinkStone", "evoAccessStones"]
      : ["evoAccessLinkStone"];
  }
  if (evoType === "useItem" || evoType === "levelHold") {
    return ["evoAccessStones"];
  }
  if (evoType === "levelExtra") {
    if (/affection/i.test(condition)) return ["evoAccessFriendship"];
    if (/magnetic field/i.test(condition)) return ["evoAccessMagneticField"];
    if (/moss rock/i.test(condition)) return ["evoAccessMossyRock"];
    if (/ice rock/i.test(condition)) return ["evoAccessIcyRock"];
    if (/party/i.test(condition)) return []; // trivial, no unlock involved
    return ["evoAccessOtherLocations"];
  }
  return [];
}

// The requirement for evolving INTO `species` from its direct pre-evolution.
// Returns { status: "legal" | "unknown" | "blocked", levelRequired, friction,
// method, reason } — `levelRequired` still needs checking against the level
// cap by the caller; `friction` is in score points (K). `access` is the
// progression object (flat evoAccess* booleans); omitted = everything
// accessible.
export function getEvolutionRequirement(species, access = null) {
  if (!species) return null;
  if (!species.prevoId) {
    return { status: "legal", levelRequired: null, friction: 0, method: "base", reason: "base form" };
  }
  if (species.isMega) {
    return {
      status: "unknown",
      levelRequired: null,
      friction: 0,
      method: "mega",
      reason: "mega forms are handled by the mega slot, not evolution",
    };
  }

  const evoType = species.evoType || "";
  const condition = species.evoCondition || "";

  // Access gate first: a method the player can't use yet is BLOCKED — a
  // concrete, user-stated fact that outranks the friction model. Surfaced,
  // never silent. Owning the required item overrides its gate (a Thunder
  // Stone in the bag works even if stones "aren't accessible yet").
  if (access) {
    const denied = requiredAccessKeys(evoType, condition, species).find(
      (key) => {
        if (access[key] !== false) return false;
        if (key === "evoAccessStones" && ownedItemCount(access, species.evoItem)) {
          return false;
        }
        if (key === "evoAccessLinkStone" && ownedItemCount(access, "Link Stone")) {
          return false;
        }
        return true;
      },
    );
    if (denied) {
      const label =
        EVOLUTION_ACCESS_FIELDS.find((field) => field.key === denied)?.label ||
        denied;
      return {
        status: "blocked",
        levelRequired: null,
        friction: 0,
        method: evoType || "level",
        reason: `${label} not yet accessible (Reborn Progression setting)`,
      };
    }
  }

  if (evoType === "") {
    // Plain level evolution; a trivial rider (day/night, gender) adds minor
    // friction but doesn't gate legality.
    return {
      status: "legal",
      levelRequired: Number.isFinite(species.evoLevel) ? species.evoLevel : null,
      friction: condition ? tunable("TIME_FRICTION") : 0,
      method: "level",
      reason: condition
        ? `level ${species.evoLevel} (${condition})`
        : `level ${species.evoLevel}`,
    };
  }

  if (evoType === "levelFriendship") {
    return {
      status: "legal",
      levelRequired: null,
      friction: tunable("FRIENDSHIP_FRICTION"),
      method: "friendship",
      reason: condition ? `friendship (${condition})` : "friendship grind",
    };
  }

  if (evoType === "levelMove") {
    // Legal once the pre-evo can have LEARNED the required move on the natural
    // path — gated by the recorded learn level. No recorded level ⇒ unknown.
    if (!Number.isFinite(species.evoMoveLevel)) {
      return {
        status: "unknown",
        levelRequired: null,
        friction: 0,
        method: "move",
        reason: `requires knowing ${species.evoMove || "a move"} — learn level unknown`,
      };
    }
    return {
      status: "legal",
      levelRequired: species.evoMoveLevel,
      friction: tunable("TIME_FRICTION"),
      method: "move",
      reason: `level-up knowing ${species.evoMove} (learned at ${species.evoMoveLevel})`,
    };
  }

  if (evoType === "levelHold" || evoType === "useItem" || evoType === "trade") {
    const parts = [];
    let friction = 0;
    // Reborn replaces trades with the Link Stone — itself a farmable item.
    if (evoType === "trade") {
      const link = getItemAvailability("Link Stone");
      parts.push({ item: "Link Stone", ...link });
    }
    if (species.evoItem) {
      parts.push({ item: species.evoItem, ...getItemAvailability(species.evoItem) });
    }
    if (evoType === "useItem" && !species.evoItem) {
      return {
        status: "unknown",
        levelRequired: null,
        friction: 0,
        method: "item",
        reason: "item evolution with no recorded item",
      };
    }
    // Owned items are settled facts — mark them before the availability check
    // so "availability unknown" can't block an item that's already in the bag.
    for (const part of parts) {
      if (ownedItemCount(access, part.item)) part.owned = true;
    }
    const unknown = parts.find(
      (part) => part.status === "unknown" && !part.owned,
    );
    if (unknown) {
      return {
        status: "unknown",
        levelRequired: null,
        friction: 0,
        method: evoType === "trade" ? "trade" : "item",
        reason: `${unknown.item} availability unknown (${unknown.source})`,
      };
    }
    for (const part of parts) {
      // An owned item costs nothing to "acquire" — friction models the grind
      // of getting it, and it's already in the bag.
      if (part.owned) continue;
      const base =
        evoType === "trade" && part.item === "Link Stone"
          ? tunable("TRADE_FRICTION")
          : tunable("ITEM_FRICTION");
      friction +=
        part.status === "farmable-tedious"
          ? Math.round(base * TEDIOUS_MULTIPLIER)
          : base;
    }
    const how = parts
      .map((part) =>
        part.owned
          ? `${part.item} (owned)`
          : `${part.item} (${part.status}: ${part.source})`,
      )
      .join(" + ");
    return {
      status: "legal",
      levelRequired: null,
      friction,
      method: evoType === "trade" ? "trade" : "item",
      reason: condition ? `${how}, ${condition}` : how,
    };
  }

  if (evoType === "levelExtra") {
    if (/affection/i.test(condition)) {
      return {
        status: "legal",
        levelRequired: null,
        friction: tunable("FRIENDSHIP_FRICTION"),
        method: "affection",
        reason: condition,
      };
    }
    if (/party/i.test(condition)) {
      return {
        status: "legal",
        levelRequired: null,
        friction: tunable("TIME_FRICTION"),
        method: "condition",
        reason: condition,
      };
    }
    // Location evolutions (moss/ice rock, magnetic field, Lanakila-equivalent):
    // Reborn has all of these locations; they open up over the midgame. Legal
    // with item-level friction; the condition is surfaced in the proof.
    return {
      status: "legal",
      levelRequired: null,
      friction: tunable("ITEM_FRICTION"),
      method: "location",
      reason: `${condition || "special location"} (Reborn location, midgame)`,
    };
  }

  return {
    status: "unknown",
    levelRequired: null,
    friction: 0,
    method: evoType,
    reason: `unhandled evolution type ${evoType}`,
  };
}

// Walks the chain from the line's input form to `fieldedId`, summing friction
// and collecting a human-auditable proof of each evolution step. Assumes the
// fielded form was already validated as reachable.
export function evolutionChainProof(fieldedId, access = null) {
  const steps = [];
  let friction = 0;
  let id = fieldedId;
  const seen = new Set();
  while (id && !seen.has(id)) {
    seen.add(id);
    const species = GEN7_PROGRESSION_SPECIES[id];
    if (!species || !species.prevoId) break;
    const requirement = getEvolutionRequirement(species, access);
    steps.unshift({
      from: species.prevoId,
      to: species.id,
      method: requirement.method,
      friction: requirement.friction,
      reason: requirement.reason,
    });
    friction += requirement.friction;
    id = species.prevoId;
  }
  return { friction, steps };
}
