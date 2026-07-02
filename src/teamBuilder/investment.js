// Investment recommendations (roadmap Phase 9): "best six right now" and
// "worth training soon" are different products. Selection never spends future
// value; THIS view is where the future lives. It re-runs the real optimizer at
// the next level cap(s) — same pool, same unlocks, only the cap moved — and
// compares each line's value, so "Magikarp is one badge from a real payoff"
// falls out of the same model instead of a special rule.

import { optimizeTeamFromPool } from "./teamOptimizer.js";

// Reborn's badge level caps (vanilla 19.x progression).
export const REBORN_LEVEL_CAPS = [
  20, 25, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100,
];

const TRAIN_SOON_GAIN = 250; // score points at the next cap that make a mon worth tracking
const CLOSE_BENCH_MARGIN = 0.985; // swap score within 1.5% of the team's own score

export function nextLevelCaps(levelCap, count = 2) {
  const cap = Number.parseInt(levelCap, 10) || 0;
  return REBORN_LEVEL_CAPS.filter((value) => value > cap).slice(0, count);
}

export async function computeInvestmentPlan({
  availability,
  family,
  pokemonIndex,
  progression,
  query,
  selection,
  result,
}) {
  const caps = nextLevelCaps(progression.levelCap, 2);
  if (!caps.length || !result?.team?.length) return null;

  const nowByInput = new Map();
  for (const line of result.lines || []) {
    const choice = line.best || line.bestNonMega;
    if (choice) nowByInput.set(choice.inputPokemonId, choice);
  }
  const teamIds = new Set(result.team.map((choice) => choice.inputPokemonId));

  // The optimizer memoizes by (context, pool), so these future runs are cached
  // like any other gamestate the user might dial in by hand.
  const futureResults = [];
  for (const cap of caps) {
    futureResults.push({
      cap,
      result: await optimizeTeamFromPool({
        availability,
        family,
        pokemonIndex,
        progression: { ...progression, levelCap: String(cap) },
        query,
        selection,
      }),
    });
  }

  const trainSoon = [];
  const holdOff = [];
  for (const [inputId, nowChoice] of nowByInput) {
    if (teamIds.has(inputId)) continue;
    let best = null;
    for (const { cap, result: future } of futureResults) {
      const futureLine = (future.lines || []).find(
        (line) =>
          (line.best || line.bestNonMega)?.inputPokemonId === inputId,
      );
      const futureChoice = futureLine?.best || futureLine?.bestNonMega;
      if (!futureChoice) continue;
      const gain = (futureChoice.score ?? 0) - (nowChoice.score ?? 0);
      const evolves =
        futureChoice.legalityProfile?.currentId !==
        nowChoice.legalityProfile?.currentId;
      const seatsLater = future.team.some(
        (choice) => choice.inputPokemonId === inputId,
      );
      if (!best || gain > best.gain) {
        best = { cap, gain: Math.round(gain), evolves, seatsLater, futureChoice };
      }
    }
    if (!best) continue;
    const entry = {
      inputPokemonId: inputId,
      inputName: nowChoice.inputName,
      cap: best.cap,
      gain: best.gain,
      evolves: best.evolves,
      evolvesInto: best.evolves
        ? best.futureChoice.legalityProfile?.currentName ||
          best.futureChoice.legalityProfile?.currentId
        : null,
      seatsLater: best.seatsLater,
    };
    if (best.seatsLater || best.gain >= TRAIN_SOON_GAIN) trainSoon.push(entry);
    else holdOff.push(entry);
  }
  trainSoon.sort(
    (a, b) => Number(b.seatsLater) - Number(a.seatsLater) || b.gain - a.gain,
  );
  holdOff.sort((a, b) => b.gain - a.gain);

  // Close bench: benched mons whose best swap-in barely trails the chosen team.
  const closeBench = [];
  if (result.benchSwapScores) {
    // The chosen team's own score = the best swap score any seated member has…
    // not stored directly; approximate with the max swap score seen, which the
    // optimal team's members trivially dominate.
    const reference = Math.max(...result.benchSwapScores.values());
    for (const [inputId, swapScore] of result.benchSwapScores) {
      if (teamIds.has(inputId)) continue;
      if (swapScore >= reference * CLOSE_BENCH_MARGIN) {
        closeBench.push({
          inputPokemonId: inputId,
          inputName: nowByInput.get(inputId)?.inputName || inputId,
        });
      }
    }
  }

  return { caps, trainSoon, holdOff, closeBench };
}
