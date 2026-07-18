// Canonical-set readiness (display only): how much of a mon's competitive
// set — its top-4 usage moves plus canonical item — is assemblable right
// now, and the cap at which it completes ("L*").
//
// Definitional rules:
//   - A level-scaling move in the canonical set (Seismic Toss class: damage =
//     user level) means the set is not fully online until cap 100, period.
//   - L* is min(100, earliest cap at which every element is obtainable under
//     the walkthrough schedule): level-up moves at their level, TM/tutor moves
//     at their unlock badge's cap, items at their timeline badge's cap.
//   - Abilities are ALWAYS ready: Reborn distributes hidden abilities evenly
//     at catch and Ability Capsules switch between all of a mon's abilities
//     at will, from the start of the game.
//
// This annotates the analysis display; it feeds no scoring input.

import {
  getRebornCheckpoint,
  getItemUnlockBadge,
} from "./badgeTimeline.js";
import {
  REBORN_TM_OPTIONS,
  REBORN_TMX_OPTIONS,
  REBORN_TUTOR_GROUPS,
} from "./progressionOptions.js";
import { fixedMoveDamage } from "./damageModel.js";
import { getMoveMetaById } from "../moveMeta.js";
import { toId } from "../utils/ids.js";
import { GEN7_PROGRESSION_SPECIES } from "../generated/gen7ProgressionSpecies.generated.js";

export const CANONICAL_SET_SIZE = 4;

// Damage scales with user level (Seismic Toss / Night Shade / Psywave class):
// derived from the damage model itself so the two can never drift.
function isLevelScalingMove(moveId) {
  const low = fixedMoveDamage(moveId, 1);
  return low != null && low !== fixedMoveDamage(moveId, 100);
}

// moveId -> earliest badge any TM/TMX/tutor teaches it ("After Badge NN").
const MACHINE_BADGE_BY_MOVE = (() => {
  const map = new Map();
  const note = (moveId, badge) => {
    if (badge == null) return;
    if (!map.has(moveId) || badge < map.get(moveId)) map.set(moveId, badge);
  };
  const badgeOf = (text) => {
    const match = /Badge\s+(\d+)/i.exec(String(text || ""));
    return match ? Number.parseInt(match[1], 10) : null;
  };
  for (const option of [...REBORN_TM_OPTIONS, ...REBORN_TMX_OPTIONS]) {
    note(toId(option.move), badgeOf(option.available));
  }
  for (const group of REBORN_TUTOR_GROUPS) {
    for (const option of group.options || []) {
      note(option.id, badgeOf(option.available || group.available));
    }
  }
  return map;
})();

// Badge 0's checkpoint id is "start" (cap 20), not "badge-0".
const capOfBadge = (badge) =>
  getRebornCheckpoint(badge === 0 ? "start" : `badge-${badge}`)?.levelCap ??
  null;

const badgePhrase = (badge) =>
  badge === 0 ? "from the start" : `@${badge} badge${badge === 1 ? "" : "s"}`;

// The canonical competitive set: the top-N usage moves of the represented form.
export function canonicalMoveIds(moveUsage, size = CANONICAL_SET_SIZE) {
  if (!moveUsage?.size) return [];
  return [...moveUsage.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, size)
    .map(([id]) => id);
}

export function computeSetReadiness({
  legalMoveData,
  availableMoves = [],
  topSet,
  progression = {},
}) {
  const canonical = canonicalMoveIds(topSet?.moveUsage);
  if (!canonical.length) return null;

  const availableIds = new Set(availableMoves.map((move) => move.id));
  // Usage data collapses every Hidden Power variant to the single id
  // "hiddenpower", but the legal pool carries only expanded per-type ids
  // (hiddenpowerice, ...) once the Type Changer unlocks — so any expanded
  // variant must satisfy the canonical id.
  const isMoveAvailable = (id) =>
    availableIds.has(id) ||
    (id === "hiddenpower" &&
      [...availableIds].some((moveId) => moveId.startsWith("hiddenpower")));
  const rawById = new Map(
    (legalMoveData?.moves || []).map((move) => [move.id, move]),
  );
  const speciesIsEvolved = Boolean(
    GEN7_PROGRESSION_SPECIES[legalMoveData?.pokemonId]?.prevoId,
  );
  const capNeeds = []; // cap-equivalents of everything not ready yet
  let scaling = false;

  const moves = canonical.map((id) => {
    const label =
      availableMoves.find((move) => move.id === id)?.name ||
      getMoveMetaById(id)?.name ||
      id;
    if (isLevelScalingMove(id)) scaling = true;

    if (isMoveAvailable(id)) {
      return isLevelScalingMove(id)
        ? { id, label, status: "scaling", detail: "level-scaling — full power at 100" }
        : { id, label, status: "ready", detail: "" };
    }

    const raw = rawById.get(id);
    if (!raw) {
      return { id, label, status: "blocked", detail: "not learnable in Reborn" };
    }

    // Earliest way to get it, as a cap-equivalent. Level-1 entries on an
    // evolved form are NOT a leveling route (they're relearner-gated — you
    // never level up to 1), so they can't set the cap-equivalent.
    const candidates = [];
    const levels = [
      ...(raw.sources?.levelUp || []),
      ...(raw.sources?.preEvolutionLevelUp || []).map((entry) =>
        typeof entry === "number" ? entry : entry.level,
      ),
    ].filter((level) => !(speciesIsEvolved && level === 1));
    if (levels.length) {
      const level = Math.min(...levels);
      candidates.push({ cap: level, detail: `level-up @${level}` });
    }
    const hasLevelOneRelist =
      (speciesIsEvolved && (raw.sources?.levelUp || []).includes(1)) ||
      // Head-of-block level-1 relists (flagged at build time) are
      // relearner-only on ANY form — a level-1 mon knows just the last four
      // moves of its ≤1 learnset, never the relist catalog above them.
      Boolean(raw.sources?.levelOneRelist);
    if (raw.sources?.tm || raw.sources?.tmx || raw.sources?.tutor) {
      const badge = MACHINE_BADGE_BY_MOVE.get(id);
      if (badge != null) {
        candidates.push({
          cap: capOfBadge(badge) ?? 100,
          detail: `TM/tutor ${badgePhrase(badge)}`,
        });
      }
    }
    if (!candidates.length && raw.sources?.egg) {
      return {
        id,
        label,
        status: "later",
        detail: progression.daycareUnlocked
          ? "egg move — needs a chain parent in your pool"
          : "egg move — needs the daycare",
      };
    }
    if (!candidates.length && hasLevelOneRelist) {
      // Its only route is the relearner (a level-1 relist on an evolved
      // form); no cap-equivalent — the gate is the unlock, not a level.
      return { id, label, status: "later", detail: "needs the move relearner" };
    }
    if (!candidates.length) {
      return { id, label, status: "blocked", detail: "no reachable source yet" };
    }

    candidates.sort((a, b) => a.cap - b.cap);
    capNeeds.push(candidates[0].cap);
    return { id, label, status: "later", detail: candidates[0].detail };
  });

  // Item: owned now, scheduled at a timeline badge, or timing-unknown.
  const itemName = topSet?.item || null;
  const itemId = itemName ? toId(itemName) : "";
  let item = { name: itemName, status: "none", detail: "" };
  if (itemName) {
    if ((progression.ownedItems || {})[itemId] > 0) {
      item = { name: itemName, status: "ready", detail: "owned" };
    } else {
      const badge = getItemUnlockBadge(itemId);
      if (badge != null) {
        capNeeds.push(capOfBadge(badge) ?? 100);
        item = {
          name: itemName,
          status: "later",
          detail: badgePhrase(badge),
        };
      } else {
        item = { name: itemName, status: "unknown", detail: "timing untracked" };
      }
    }
  }

  if (scaling) capNeeds.push(100);
  let fullAtCap = capNeeds.length ? Math.min(100, Math.max(...capNeeds)) : null;

  // fullAtCap at or below the current cap means everything missing is already
  // reachable — the gate is pickups (unchecked TMs, unclaimed items), not
  // future progression. "Pending" requires something actually pending; the
  // scaling sentinel alone (a fully-ready set at cap 100) is not a pickup.
  const currentCap = Number.parseInt(progression.levelCap, 10) || 0;
  const hasPending =
    moves.some((move) => move.status === "later") ||
    (item.name != null && item.status === "later");
  let pendingPickups = false;
  if (fullAtCap != null && fullAtCap <= currentCap) {
    fullAtCap = null;
    pendingPickups = hasPending;
  }

  return {
    pendingPickups,
    moves,
    readyMoveCount: moves.filter(
      (move) => move.status === "ready" || move.status === "scaling",
    ).length,
    item,
    ability: { name: topSet?.ability || null, status: "ready" },
    scaling,
    // null = the set is complete right now (and nothing scales with level).
    fullAtCap,
  };
}
