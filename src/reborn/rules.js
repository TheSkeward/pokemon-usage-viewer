export const REBORN_MOVE_LEGALITY_BASE = {
  generation: 7,
  baseGames: "USUM",
  transferMovesAvailableByDefault: false,
};

export const REBORN_TMX_MOVES = ["Fly", "Surf", "Waterfall"];

export const REBORN_PROMOTED_TM_MOVES = [
  "Power-Up Punch",
  "Struggle Bug",
  "Secret Power",
];

// NOTE for future maintainers: this module once carried ~150 lines of
// hand-encoded per-mon overrides (extra level-1/relearner moves, Silvally
// pledge tutors, Pikachu's TMX quirks) transcribed from the Reborn wiki.
// They became dead data when scripts/build-reborn-legal-moves.mjs started
// generating legal moves from the game's own mons.dat, which already
// contains all of it. If a legality bug points here, fix the generator or
// its mons.dat source — do not resurrect hand-curated move lists (git
// history has them if you need to compare).

export const REBORN_PROGRESSION_NOTES = [
  "Move legality is based on USUM learnsets, with Reborn-specific exceptions.",
  "Generic transfer moves are unavailable.",
  "Fly, Surf, and Waterfall are TMX moves in Reborn, not ordinary TMs.",
  "Power-Up Punch, Struggle Bug, and Secret Power are promoted to TMs.",
  "Promoted TMs are legal for Pokémon that learn the move elsewhere or had it as a Gen 6 transfer move.",
  "Reborn's extra relearner/level-up moves come from the game's own data (mons.dat).",
];
