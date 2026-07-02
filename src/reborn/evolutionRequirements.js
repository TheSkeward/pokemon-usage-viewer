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

// The requirement for evolving INTO `species` from its direct pre-evolution.
// Returns { status: "legal" | "unknown", levelRequired, friction, method,
// reason } — `levelRequired` still needs checking against the level cap by the
// caller; `friction` is in score points (K).
export function getEvolutionRequirement(species) {
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
    const unknown = parts.find((part) => part.status === "unknown");
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
      .map((part) => `${part.item} (${part.status}: ${part.source})`)
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
export function evolutionChainProof(fieldedId) {
  const steps = [];
  let friction = 0;
  let id = fieldedId;
  const seen = new Set();
  while (id && !seen.has(id)) {
    seen.add(id);
    const species = GEN7_PROGRESSION_SPECIES[id];
    if (!species || !species.prevoId) break;
    const requirement = getEvolutionRequirement(species);
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
