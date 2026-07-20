/** The learnset basis move legality is evaluated against. */
export const REBORN_MOVE_LEGALITY_BASE = {
  generation: 7,
  baseGames: "USUM",
  transferMovesAvailableByDefault: false,
};

/** Moves that are TMX (HM-like) machines in Reborn, not ordinary TMs. Display names. */
export const REBORN_TMX_MOVES = ["Fly", "Surf", "Waterfall"];

/** Moves Reborn promotes to TMs beyond the USUM TM list. Display names. */
export const REBORN_PROMOTED_TM_MOVES = [
  "Power-Up Punch",
  "Struggle Bug",
  "Secret Power",
];

// Per-mon move legality is generated from the game's own mons.dat by
// scripts/build-reborn-legal-moves.mjs. If a legality bug points here, fix
// the generator or its mons.dat source — do not add hand-curated per-mon
// move lists to this module.

/** User-facing summary of the legality rules above, rendered verbatim in the progression view. */
export const REBORN_PROGRESSION_NOTES = [
  "Move legality is based on USUM learnsets, with Reborn-specific exceptions.",
  "Generic transfer moves are unavailable.",
  "Fly, Surf, and Waterfall are TMX moves in Reborn, not ordinary TMs.",
  "Power-Up Punch, Struggle Bug, and Secret Power are promoted to TMs.",
  "Promoted TMs are legal for Pokémon that learn the move elsewhere or had it as a Gen 6 transfer move.",
  "Reborn's extra relearner/level-up moves come from the game's own data (mons.dat).",
];
