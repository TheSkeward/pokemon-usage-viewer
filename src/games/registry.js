// The game registry: which fangames this app can build teams for, and which
// one is active. Everything per-game (data paths, saved-state keys, dex
// generation, progression schedule) hangs off the active game's descriptor so
// the scoring engine and UI never hardcode a game.
//
// The active game is process-global for the same reason scoring overrides
// are: the optimizer, its caches, and the UI must all agree on it within one
// run, and tests swap it around a run the same way they swap overrides.
// Optimizer cache keys fold the game id in, so switching games can never
// serve one game's cached results to another.
import { REBORN_GAME } from "./reborn.js";

const GAMES = Object.freeze({
  [REBORN_GAME.id]: REBORN_GAME,
});

let activeGameId = REBORN_GAME.id;

export function getActiveGame() {
  return GAMES[activeGameId];
}

export function getGame(id) {
  return GAMES[id] || null;
}

export function listGames() {
  return Object.values(GAMES);
}

export function setActiveGame(id) {
  if (!GAMES[id]) {
    throw new Error(`Unknown game "${id}" (known: ${Object.keys(GAMES).join(", ")})`);
  }
  activeGameId = id;
}
