import {
  GEN7_BASE_STATS,
  GEN7_BASE_HP,
} from "../generated/gen7BaseStats.generated.js";
import { getTypeMultiplier } from "./typeChart.js";
import { toId } from "../utils/ids.js";
import { natureStatMultiplier } from "../natures.js";

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

function abilityId(ability) {
  return String(ability || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

// Same-type-attack bonus, ability-aware. Protean/Libero change the user's type to
// the move's before it hits, so EVERY attack gets STAB — the whole point of the
// ability and the reason a Protean Greninja's coverage is undervalued if ignored.
// Adaptability turns STAB into 2x. Everything else is the ordinary 1.5-if-matching.
function abilityStab(ability, attackerTypes, moveType) {
  const id = abilityId(ability);
  // Protean only — Libero is a Gen 8 ability and vanilla Reborn is Gen 7, so it
  // would never legally appear; left out rather than pretending to support it.
  if (id === "protean") return STAB_MULTIPLIER;
  const matches = attackerTypes.includes(moveType);
  if (id === "adaptability") return matches ? 2 : 1;
  return matches ? STAB_MULTIPLIER : 1;
}

// ————————————————— Ability damage layer —————————————————
// The set's assumed ability (the form's top competitive ability, same source
// as the STAB handling above) scales damage when its condition is a property
// of the MOVE — its type, flags, or base power — rather than of the battle
// state. Battle-state-conditional abilities are deliberately NOT modeled,
// because the estimate prices a typical unconditioned turn against a neutral
// wall: Guts/Toxic Boost/Flare Boost (needs a status), Blaze/Torrent/Overgrow/
// Swarm (needs <1/3 HP), Sand Force/Solar Power (needs weather), Analytic/
// Stakeout/Tinted Lens/Sniper/Rivalry (needs a specific target or turn order),
// Defeatist (assumed above half HP). Defender-side abilities never apply — the
// reference wall is ability-less by construction.

// The -ate abilities convert the user's NORMAL moves and boost them 1.2x
// (the Gen 7 value; it was 1.3x in Gen 6). Conversion changes everything
// downstream — STAB, effectiveness, coverage, type Gems — which is exactly
// why Mega Salamence runs Return and Sylveon runs Hyper Voice.
const ATE_CONVERSIONS = {
  aerilate: "Flying",
  galvanize: "Electric",
  pixilate: "Fairy",
  refrigerate: "Ice",
};

// A decorated move may already carry its converted type (stamped as `type`
// for coverage/bias/display), with the pre-conversion type preserved in
// `rawType`. Deriving from rawType-first makes both conversion and the
// multiplier idempotent — raw and decorated moves give identical answers.
function baseMoveType(move) {
  return move.rawType ?? move.type;
}

// The type a move actually deals damage as under the ability: -ate abilities
// convert Normal moves, Liquid Voice makes sound moves Water (Primarina's
// whole STAB plan), Normalize makes everything Normal. Unchanged otherwise.
export function getAbilityEffectiveMoveType(ability, move) {
  const id = abilityId(ability);
  const type = baseMoveType(move);
  if (ATE_CONVERSIONS[id] && type === "Normal") return ATE_CONVERSIONS[id];
  if (id === "liquidvoice" && move.flags?.sound) return "Water";
  if (id === "normalize") return "Normal";
  return type;
}

// Move-property-conditional damage multiplier for the assumed ability. Only
// one branch can fire per call in practice (a mon has one ability), but the
// composition is written multiplicatively so a single ability with several
// clauses (the -ate type gate + boost) stays readable. Fixed-damage moves
// never see this — estimateMoveDamage resolves them before multipliers,
// matching the games (Huge Power does not change Seismic Toss).
export function getAbilityDamageMultiplier(ability, move) {
  const id = abilityId(ability);
  if (!id) return 1;
  const type = baseMoveType(move);
  const flags = move.flags || {};
  const physical = move.category === "Physical";
  let multiplier = 1;

  // Attack-stat rewrites (our damage is linear in the attacking stat).
  if ((id === "hugepower" || id === "purepower") && physical) multiplier *= 2;
  // Hustle: +50% Atk at -20% physical accuracy. The accuracy factor applied
  // later reads move.accuracy and can't see the ability, so the expected-value
  // haircut is folded in here: 1.5 × 0.8 = 1.2.
  if (id === "hustle" && physical) multiplier *= 1.5 * 0.8;
  // Slow Start halves Atk for the first five turns — most of a real fight,
  // so it's priced as always-on rather than ignored (Regigigas is bad).
  if (id === "slowstart" && physical) multiplier *= 0.5;

  // Base-power boosts gated on move properties.
  if (id === "technician" && move.basePower > 0 && move.basePower <= 60) {
    multiplier *= 1.5; // per-hit BP gate — multi-hit moves qualify per hit
  }
  if (id === "toughclaws" && flags.contact) multiplier *= 1.3;
  if (id === "strongjaw" && flags.bite) multiplier *= 1.5;
  if (id === "megalauncher" && flags.pulse) multiplier *= 1.5;
  if (id === "ironfist" && flags.punch) multiplier *= 1.2;
  if (id === "reckless" && flags.recoil) multiplier *= 1.2;
  if (id === "sheerforce" && flags.secondary) multiplier *= 1.3;

  // Type-keyed boosts.
  if (id === "waterbubble" && type === "Water") multiplier *= 2;
  if (id === "steelworker" && type === "Steel") multiplier *= 1.5;
  if (id === "darkaura" && type === "Dark") multiplier *= 4 / 3;
  if (id === "fairyaura" && type === "Fairy") multiplier *= 4 / 3;
  if (ATE_CONVERSIONS[id] && type === "Normal") multiplier *= 1.2;
  if (id === "normalize") multiplier *= 1.2;

  // Parental Bond: the second hit lands at 25% (Gen 7) → 1.25x on single-hit
  // moves; genuinely multi-hit moves don't get a bonus hit in-game.
  if (id === "parentalbond" && !move.multihit) multiplier *= 1.25;

  return multiplier;
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

// Membership derives from fixedMoveDamage itself, so the two can never drift.
export function isFixedDamageMove(moveId) {
  return fixedMoveDamage(moveId, 1) != null;
}

// Damage a move actually lands into a defensive type, for coverage purposes.
// Fixed-damage moves ignore effectiveness multipliers but NOT immunities
// (Gen 7 rules): Seismic Toss deals its flat damage to anything Fighting can
// touch and zero to Ghosts — it is never "super effective" and never resisted.
export function coverageDamageIntoType(moveId, moveType, damage, defenseType) {
  const multiplier = getTypeMultiplier(moveType, [defenseType]);
  if (isFixedDamageMove(moveId)) return multiplier === 0 ? 0 : damage;
  return damage * multiplier;
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
      // Uniform 0.5x–1.5x the user's level — expected value 1.0x. The model
      // prices randomness at expected value everywhere (accuracy weighting,
      // multi-hit counts); the old 0.75x haircut contradicted its own comment.
      return lvl;
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

// The full six-stat line a nature + EV spread produces at a level (31 IVs
// assumed, matching Smogon spreads). Display-layer only — scoring never calls
// this. `evs` is the [HP,Atk,Def,SpA,SpD,Spe] array; nature by name or id.
// Returns null when the species has no base-stat row.
export function computeFinalStats({ pokemonId, level, nature, evs }) {
  const id = toId(pokemonId);
  const stats = GEN7_BASE_STATS[id];
  const baseHp = GEN7_BASE_HP[id];
  if (!stats || baseHp == null) return null;

  const at = normalizeLevel(level);
  const evOf = (index) => {
    const value = Array.isArray(evs) ? Number.parseInt(evs[index], 10) : 0;
    return Number.isFinite(value) ? Math.max(0, Math.min(252, value)) : 0;
  };
  const hp =
    baseHp === 1 // Shedinja
      ? 1
      : Math.floor(((2 * baseHp + 31 + Math.floor(evOf(EV_INDEX.hp) / 4)) * at) / 100) +
        at +
        10;
  const result = { level: at, hp };
  for (const key of ["atk", "def", "spa", "spd", "spe"]) {
    result[key] = statValue(
      stats[STAT_INDEX[key]],
      evOf(EV_INDEX[key]),
      at,
      natureStatMultiplier(nature, key),
    );
  }
  return result;
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
  // Move-property-conditional ability boost (getAbilityDamageMultiplier) —
  // computed by the caller from the RAW move so Technician's ≤60 BP gate sees
  // per-hit power, not the effective-hit-scaled figure passed as basePower.
  abilityMultiplier = 1,
  ability = null,
}) {
  const stab = abilityStab(ability, attackerTypes, type);
  const lvl = normalizeLevel(level ?? attackerStats?.level);

  const fixed = fixedMoveDamage(moveId, lvl);
  if (fixed != null) return fixed;

  // No base power and not a known fixed-damage move: nothing to estimate.
  if (!basePower) return 0;

  if (!attackerStats) {
    return Math.round(basePower * stab * itemMultiplier * abilityMultiplier);
  }

  const attack =
    category === "Physical" ? attackerStats.atk : attackerStats.spa;
  const defense = statValue(REFERENCE_DEFENSE_BASE, 0, lvl, 1);

  const baseDamage =
    Math.floor(
      (Math.floor(((2 * lvl) / 5 + 2) * basePower * attack) / defense) / 50,
    ) + 2;

  return Math.round(baseDamage * stab * itemMultiplier * abilityMultiplier);
}
