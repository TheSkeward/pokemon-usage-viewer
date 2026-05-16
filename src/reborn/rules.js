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

export const REBORN_TM_REPLACEMENTS = {
  Fly: "Power-Up Punch",
  Surf: "Struggle Bug",
  Waterfall: "Secret Power",
};

export const REBORN_PROGRESSION_NOTES = [
  "Move legality is based on USUM learnsets, with Reborn-specific exceptions.",
  "Generic transfer moves are unavailable.",
  "Fly, Surf, and Waterfall are TMX moves in Reborn, not ordinary TMs.",
  "Power-Up Punch, Struggle Bug, and Secret Power are promoted to TMs.",
  "Promoted TMs are legal for Pokémon that learn the move elsewhere or had it as a Gen 6 transfer move.",
  "Reborn adds extra move-relearner moves; those will be encoded from the wiki later.",
];
