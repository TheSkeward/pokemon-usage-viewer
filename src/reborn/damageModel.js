import { GEN7_BASE_STATS } from "../generated/gen7BaseStats.generated.js";
import { toId } from "../utils/ids.js";

// A naive, defender-agnostic damage model. We can't know the real opponent's
// stats, so every move is scored as "unresisted output" against a fixed neutral
// wall (base-70 defense, no investment, same level). The result is a relative
// damage number that's comparable across moves, members, and — crucially — the
// physical/special split, since it scales by the attacker's actual Atk vs SpA.
//
// This feeds two things: the surfaced "X dmg" estimate, and the move
// recommender's ranking, so a physical attacker prefers its physical moves
// (and a fixed-damage move like Seismic Toss keeps its value on a weak
// attacker, where it is genuinely the best option).

// GEN7_BASE_STATS rows are [Atk, Def, SpA, SpD, Spe].
const STAT_INDEX = { atk: 0, def: 1, spa: 2, spd: 3, spe: 4 };
// Spread EV strings are HP/Atk/Def/SpA/SpD/Spe.
const EV_INDEX = { hp: 0, atk: 1, def: 2, spa: 3, spd: 4, spe: 5 };

const DEFAULT_LEVEL = 100;
// The median base Def and SpD across the dex are both 70, so a base-70 neutral
// wall makes the figures read close to real damage dealt against an average mon.
const REFERENCE_DEFENSE_BASE = 70;
const STAB_MULTIPLIER = 1.5;

// Same-type-attack bonus, ability-aware. Protean/Libero change the user's type to
// the move's before it hits, so EVERY attack gets STAB — the whole point of the
// ability and the reason a Protean Greninja's coverage is undervalued if ignored.
// Adaptability turns STAB into 2x. Everything else is the ordinary 1.5-if-matching.
function abilityStab(ability, attackerTypes, moveType) {
  const id = String(ability || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  // Protean only — Libero is a Gen 8 ability and vanilla Reborn is Gen 7, so it
  // would never legally appear; left out rather than pretending to support it.
  if (id === "protean") return STAB_MULTIPLIER;
  const matches = attackerTypes.includes(moveType);
  if (id === "adaptability") return matches ? 2 : 1;
  return matches ? STAB_MULTIPLIER : 1;
}

// Nature -> attacking-stat multipliers (only Atk/SpA matter here). Natures that
// touch neither Atk nor SpA (e.g. Jolly hits Spe/SpA, Sassy hits SpD/Spe) are
// simply absent and treated as neutral (1.0 / 1.0).
const NATURE_ATTACK_MULTIPLIERS = {
  // +Atk
  lonely: { atk: 1.1 }, // -Def
  brave: { atk: 1.1 }, // -Spe
  adamant: { atk: 1.1, spa: 0.9 }, // -SpA
  naughty: { atk: 1.1 }, // -SpD
  // -Atk
  bold: { atk: 0.9 }, // +Def
  timid: { atk: 0.9 }, // +Spe
  calm: { atk: 0.9 }, // +SpD
  modest: { atk: 0.9, spa: 1.1 }, // +SpA -Atk
  // +SpA
  mild: { spa: 1.1 }, // -Def
  quiet: { spa: 1.1 }, // -Spe
  rash: { spa: 1.1 }, // -SpD
  // -SpA
  impish: { spa: 0.9 }, // +Def
  jolly: { spa: 0.9 }, // +Spe
  careful: { spa: 0.9 }, // +SpD
};

// Typical uninvested HP at a level (median base HP ≈ 70 across the dex, IV 31)
// — the defender that fraction-of-HP moves (Super Fang) are scored against,
// matching the base-70 neutral-wall convention used for defenses.
const REFERENCE_HP_BASE = 70;
export function referenceHp(level) {
  const lvl = normalizeLevel(level);
  return Math.floor(((2 * REFERENCE_HP_BASE + 31) * lvl) / 100) + lvl + 10;
}

// True damage of fixed/fractional moves at a level. These ignore the user's
// stats, STAB, and items in-game, so faking them as base-power equivalents
// (the old FIXED_DAMAGE_EFFECTIVE_POWER table) overrated them wildly at low
// caps — a lvl-25 Seismic Toss deals exactly 25, not "60 BP with STAB" (=90).
// Returns null when the move isn't one of these.
export function fixedMoveDamage(moveId, level) {
  const lvl = normalizeLevel(level);
  switch (moveId) {
    case "seismictoss":
    case "nightshade":
      return lvl;
    case "psywave":
      return Math.round(lvl * 0.75); // uniform 0.5x–1.5x the user's level
    case "sonicboom":
      return 20;
    case "dragonrage":
      return 40;
    case "superfang":
    case "naturemadness":
      return Math.round(referenceHp(lvl) / 2); // half a typical body's HP
    case "guardianofalola":
      return Math.round(referenceHp(lvl) * 0.75);
    case "finalgambit":
      return referenceHp(lvl); // ≈ the user's own full HP
    default:
      return null;
  }
}

export function normalizeLevel(levelCap) {
  const parsed = Number.parseInt(levelCap, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LEVEL;
  if (parsed < 1) return 1;
  if (parsed > 100) return 100;
  return parsed;
}

// Parses a Smogon spread string "Nature:HP/Atk/Def/SpA/SpD/Spe" into a nature id
// and the six EVs. Returns null when it can't be read.
export function parseSpread(spreadName) {
  if (typeof spreadName !== "string") return null;
  const [naturePart, evPart] = spreadName.split(":");
  if (!naturePart || !evPart) return null;

  const evs = evPart.split("/").map((value) => Number.parseInt(value, 10));
  if (evs.length < 6 || evs.some((value) => !Number.isFinite(value))) return null;

  return { nature: toId(naturePart), evs };
}

function statValue(base, ev, level, natureMultiplier) {
  const inner = Math.floor(((2 * base + 31 + Math.floor(ev / 4)) * level) / 100);
  return Math.floor((inner + 5) * natureMultiplier);
}

// Computes a member's effective Atk and SpA at the given level. With a real top
// spread we honour its EVs + nature; without one we assume the Pokémon invests
// in its naturally stronger attacking side (252 EVs + a boosting nature), which
// is how it would actually be built and is enough to settle the physical vs
// special question for the recommender.
export function getAttackingStats({ pokemonId, levelCap, spread }) {
  const stats = GEN7_BASE_STATS[toId(pokemonId)];
  if (!stats) return null;

  const level = normalizeLevel(levelCap);
  const baseAtk = stats[STAT_INDEX.atk];
  const baseSpa = stats[STAT_INDEX.spa];

  const parsed = spread ? parseSpread(spread) : null;

  if (parsed) {
    const nature = NATURE_ATTACK_MULTIPLIERS[parsed.nature] || {};
    return {
      level,
      atk: statValue(baseAtk, parsed.evs[EV_INDEX.atk], level, nature.atk ?? 1),
      spa: statValue(baseSpa, parsed.evs[EV_INDEX.spa], level, nature.spa ?? 1),
    };
  }

  // Fallback: invest in the stronger attacking side, leave the other bare.
  const physicalIsStronger = baseAtk >= baseSpa;
  return {
    level,
    atk: statValue(baseAtk, physicalIsStronger ? 252 : 0, level, physicalIsStronger ? 1.1 : 1),
    spa: statValue(baseSpa, physicalIsStronger ? 0 : 252, level, physicalIsStronger ? 1 : 1.1),
  };
}

// Estimated unresisted damage for one move. Fixed-damage moves (Seismic Toss,
// Night Shade, ...) use their REAL in-game damage at the attacker's level —
// no stats, no STAB, no item boosts, exactly as the games compute them.
export function estimateMoveDamage({
  moveId = null,
  basePower,
  category,
  type,
  attackerTypes = [],
  attackerStats,
  level,
  itemMultiplier = 1,
  ability = null,
}) {
  const stab = abilityStab(ability, attackerTypes, type);
  const lvl = normalizeLevel(level ?? attackerStats?.level);

  const fixed = fixedMoveDamage(moveId, lvl);
  if (fixed != null) return fixed;

  // No base power and not a known fixed-damage move: nothing to estimate.
  if (!basePower) return 0;

  if (!attackerStats) return Math.round(basePower * stab * itemMultiplier);

  const attack =
    category === "Physical" ? attackerStats.atk : attackerStats.spa;
  const defense = statValue(REFERENCE_DEFENSE_BASE, 0, lvl, 1);

  const baseDamage =
    Math.floor(
      (Math.floor(((2 * lvl) / 5 + 2) * basePower * attack) / defense) / 50,
    ) + 2;

  return Math.round(baseDamage * stab * itemMultiplier);
}
