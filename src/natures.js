// Nature facts for display: which stat each nature raises and lowers, plus
// the per-stat multiplier used by stat tooltips. Pure data — nothing in the
// scoring pipeline reads this (the damage model bakes natures in via spread
// strings; this module exists so hovering "Adamant" answers what it does).

// plus/minus use the canonical stat keys; the five neutral natures omit both.
export const NATURE_EFFECTS = {
  hardy: {},
  lonely: { plus: "atk", minus: "def" },
  brave: { plus: "atk", minus: "spe" },
  adamant: { plus: "atk", minus: "spa" },
  naughty: { plus: "atk", minus: "spd" },
  bold: { plus: "def", minus: "atk" },
  docile: {},
  relaxed: { plus: "def", minus: "spe" },
  impish: { plus: "def", minus: "spa" },
  lax: { plus: "def", minus: "spd" },
  timid: { plus: "spe", minus: "atk" },
  hasty: { plus: "spe", minus: "def" },
  serious: {},
  jolly: { plus: "spe", minus: "spa" },
  naive: { plus: "spe", minus: "spd" },
  modest: { plus: "spa", minus: "atk" },
  mild: { plus: "spa", minus: "def" },
  quiet: { plus: "spa", minus: "spe" },
  bashful: {},
  rash: { plus: "spa", minus: "spd" },
  calm: { plus: "spd", minus: "atk" },
  gentle: { plus: "spd", minus: "def" },
  sassy: { plus: "spd", minus: "spe" },
  careful: { plus: "spd", minus: "spa" },
  quirky: {},
};

const STAT_LABELS = {
  hp: "HP",
  atk: "Atk",
  def: "Def",
  spa: "SpA",
  spd: "SpD",
  spe: "Spe",
};

// "Adamant: +Atk, −SpA" / "Serious: neutral". Empty string for unknown names
// so callers can skip the tooltip instead of showing a wrong one.
export function describeNature(name) {
  const effect = NATURE_EFFECTS[String(name || "").toLowerCase()];
  if (!effect) return "";
  if (!effect.plus) return `${name}: neutral (no stat changes)`;
  return `${name}: +${STAT_LABELS[effect.plus]}, −${STAT_LABELS[effect.minus]}`;
}

// 1.1 / 0.9 / 1 for a stat key under a nature.
export function natureStatMultiplier(name, statKey) {
  const effect = NATURE_EFFECTS[String(name || "").toLowerCase()];
  if (!effect) return 1;
  if (effect.plus === statKey) return 1.1;
  if (effect.minus === statKey) return 0.9;
  return 1;
}

export { STAT_LABELS };
