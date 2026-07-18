// Evolution legality-with-friction. One uniform rule set — nothing
// mon-specific, no verdict fitting:
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
// Each elemental stone gets its own gate; the rest of the item-shaped
// methods (Metal Coat, Razor Claw, ...) share one gate. Legacy saves with the
// old blanket `evoAccessStones: false` still block all of these (see the
// denied check below and the migration in progression.js).
export const EVOLUTION_STONE_FIELDS = Object.freeze([
  { key: "evoAccessFireStone", label: "Fire Stone", item: "Fire Stone" },
  { key: "evoAccessWaterStone", label: "Water Stone", item: "Water Stone" },
  { key: "evoAccessThunderStone", label: "Thunder Stone", item: "Thunder Stone" },
  { key: "evoAccessLeafStone", label: "Leaf Stone", item: "Leaf Stone" },
  { key: "evoAccessMoonStone", label: "Moon Stone", item: "Moon Stone" },
  { key: "evoAccessSunStone", label: "Sun Stone", item: "Sun Stone" },
  { key: "evoAccessShinyStone", label: "Shiny Stone", item: "Shiny Stone" },
  { key: "evoAccessDuskStone", label: "Dusk Stone", item: "Dusk Stone" },
  { key: "evoAccessDawnStone", label: "Dawn Stone", item: "Dawn Stone" },
  { key: "evoAccessIceStone", label: "Ice Stone", item: "Ice Stone" },
]);

export const EVOLUTION_ACCESS_FIELDS = Object.freeze([
  { key: "evoAccessFriendship", label: "Friendship / affection evolutions" },
  ...EVOLUTION_STONE_FIELDS,
  { key: "evoAccessOtherEvoItems", label: "Other evolution items (Metal Coat, Razor Claw, …)" },
  { key: "evoAccessLinkStone", label: "Link Stone (trade evolutions)" },
  { key: "evoAccessPartyCondition", label: "Party-condition evolutions (Mantyke needs a Remoraid)" },
  { key: "evoAccessMagneticField", label: "Magnetic field area (Probopass, Magnezone, Vikavolt)" },
  { key: "evoAccessMossyRock", label: "Moss Rock (Leafeon)" },
  { key: "evoAccessIcyRock", label: "Ice Rock (Glaceon)" },
  { key: "evoAccessOtherLocations", label: "Other special locations (Crabominable)" },
  { key: "evoAccessApophyll", label: "Apophyll area (Alolan evolutions: Raichu-A, Exeggutor-A)" },
]);

// Region-locked evolutions (dex evoRegion "Alola") need Reborn's Alola
// equivalent, Apophyll — the stone alone isn't enough.
// Exception: Reborn removed Marowak-Alola's location requirement — Cubone
// picks the form by time of day (Kanto by day, Alolan by night).
function needsApophyll(species) {
  return species?.evoRegion === "Alola" && species?.id !== "marowakalola";
}

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

const STONE_KEY_BY_ITEM_ID = new Map(
  EVOLUTION_STONE_FIELDS.map((field) => [
    field.item.toLowerCase().replace(/[^a-z0-9]+/g, ""),
    field.key,
  ]),
);
const ITEM_GATE_KEYS = new Set([
  ...STONE_KEY_BY_ITEM_ID.values(),
  "evoAccessOtherEvoItems",
]);

// The gate for an evolution's required item: its own stone key when it's an
// elemental stone, else the shared other-items gate.
function evoItemAccessKey(evoItem) {
  const id = String(evoItem || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  return STONE_KEY_BY_ITEM_ID.get(id) || "evoAccessOtherEvoItems";
}

// The access gate a requirement depends on, or null when none applies.
function requiredAccessKeys(evoType, condition, species) {
  const regionKeys = needsApophyll(species) ? ["evoAccessApophyll"] : [];
  if (evoType === "levelFriendship") return ["evoAccessFriendship", ...regionKeys];
  if (evoType === "trade") {
    // Trade-with-item (Metal Coat Scizor) needs the item too.
    return species.evoItem
      ? ["evoAccessLinkStone", evoItemAccessKey(species.evoItem), ...regionKeys]
      : ["evoAccessLinkStone", ...regionKeys];
  }
  if (evoType === "useItem" || evoType === "levelHold") {
    return [evoItemAccessKey(species.evoItem), ...regionKeys];
  }
  if (evoType === "") return regionKeys;
  if (evoType === "levelExtra") {
    if (/affection/i.test(condition)) return ["evoAccessFriendship", ...regionKeys];
    if (/magnetic field/i.test(condition)) return ["evoAccessMagneticField"];
    if (/moss rock/i.test(condition)) return ["evoAccessMossyRock"];
    if (/ice rock/i.test(condition)) return ["evoAccessIcyRock"];
    // "with a Remoraid in party" is NOT trivial — it needs a specific mon the
    // player may not own; gate it like the other special methods.
    if (/party/i.test(condition)) return ["evoAccessPartyCondition"];
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
        const itemGate = ITEM_GATE_KEYS.has(key);
        // Legacy saves: the old blanket `evoAccessStones: false` blocks every
        // item gate whose per-item key hasn't been set explicitly.
        const blocked =
          access[key] === false ||
          (itemGate && access[key] === undefined && access.evoAccessStones === false);
        if (!blocked) return false;
        if (itemGate && ownedItemCount(access, species.evoItem)) {
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
    const riders = [condition, needsApophyll(species) ? "in Apophyll" : ""]
      .filter(Boolean)
      .join(", ");
    return {
      status: "legal",
      levelRequired: null,
      friction,
      method: evoType === "trade" ? "trade" : "item",
      reason: riders ? `${how}, ${riders}` : how,
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

// Form-split requirements the dex has no structured fields for (gender locks
// and Burmy's cloak-by-location). Reviewed by hand; display-only.
const FORM_EVOLUTION_NOTES = Object.freeze({
  // Reborn-specific: Cubone picks Marowak's form by time of day.
  marowak: "during the day",
  wormadam: "Female, in grass",
  wormadamsandy: "Female, in caves",
  wormadamtrash: "Female, in buildings",
  mothim: "Male",
  vespiquen: "Female",
  gallade: "Male",
  froslass: "Female",
  salazzle: "Female",
  shedinja: "spare party slot and a Poké Ball",
});

// One evolution step INTO `species`, compressed for display: `level` when it's
// a plain level-up (rendered as "@20" against the pre-evo's name), and `text`
// for everything else the player must do ("hold Oval Stone, during the day",
// "Link Stone + Metal Coat", "near a Moss Rock", "Female, in buildings").
function shortStepRequirement(species) {
  const note = FORM_EVOLUTION_NOTES[species.id];
  const condition = species.evoCondition || "";
  const evoType = species.evoType || "";
  const region = needsApophyll(species) ? "in Apophyll" : "";
  const extras = (base) =>
    [base, note || condition || "", region].filter(Boolean).join(", ");

  if (evoType === "") {
    return {
      level: Number.isFinite(species.evoLevel) ? species.evoLevel : null,
      text: extras("") || null,
    };
  }
  if (evoType === "levelFriendship") return { level: null, text: extras("friendship") };
  if (evoType === "levelMove") {
    return { level: null, text: extras(`knowing ${species.evoMove || "a move"}`) };
  }
  if (evoType === "useItem") {
    return { level: null, text: extras(species.evoItem || "an item") };
  }
  if (evoType === "levelHold") {
    return { level: null, text: extras(`hold ${species.evoItem || "an item"}`) };
  }
  if (evoType === "trade") {
    // Reborn replaces trades with the Link Stone.
    return {
      level: null,
      text: extras(`Link Stone${species.evoItem ? ` + ${species.evoItem}` : ""}`),
    };
  }
  // levelExtra and anything else: the recorded condition IS the requirement.
  return { level: null, text: extras("") || "special condition" };
}

// Human note for "what it takes" to evolve `fromId` into `toId`, appended to
// the input mon's name: Burmy -> Wormadam-Trash reads "@20 (Female, in
// buildings)"; Happiny -> Blissey reads " (hold Oval Stone, during the day,
// then friendship)". Empty string when `fromId` isn't a strict ancestor of
// `toId` (nothing to explain). Static game mechanics only — gamestate (owned
// items, access gates) is deliberately not consulted, so the note is stable.
export function describeEvolutionPath(fromId, toId) {
  if (!fromId || !toId || fromId === toId) return "";
  const chain = [];
  let id = toId;
  const seen = new Set();
  while (id && id !== fromId && !seen.has(id)) {
    seen.add(id);
    const species = GEN7_PROGRESSION_SPECIES[id];
    if (!species?.prevoId) return "";
    chain.unshift(species);
    id = species.prevoId;
  }
  if (id !== fromId || !chain.length) return "";

  let steps = chain.map(shortStepRequirement);
  // A leading run of unconditioned level-ups collapses to its last level:
  // Weedle -> Beedrill is "@10", not "@7 (then @10)" — reaching the final
  // level implies the intermediate one.
  while (
    steps.length > 1 &&
    steps[0].level != null &&
    !steps[0].text &&
    steps[1].level != null &&
    !steps[1].text
  ) {
    steps = steps.slice(1);
  }
  let attachedLevel = "";
  const tokens = [];
  steps.forEach((step, index) => {
    if (index === 0 && step.level != null) {
      attachedLevel = `@${step.level}`;
      if (step.text) tokens.push(step.text);
      return;
    }
    const text =
      step.level != null
        ? [`@${step.level}`, step.text].filter(Boolean).join(", ")
        : step.text;
    if (!text) return;
    // A token from a LATER step reads as a sequence: "@21 (then Leaf Stone)".
    tokens.push(index > 0 && (attachedLevel || tokens.length) ? `then ${text}` : text);
  });

  return `${attachedLevel}${tokens.length ? ` (${tokens.join(", ")})` : ""}`;
}

// Walks the chain from the family's base form up to `fieldedId`, summing
// friction and collecting a human-auditable proof of each evolution step.
// Assumes the fielded form was already validated as reachable.
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
