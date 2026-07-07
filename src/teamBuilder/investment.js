// LEVEL-CAP investment projection (roadmap Phase 9): "best six right now" and
// "worth training soon" are different products. Selection never spends future
// value; THIS view is where the future lives. It re-runs the real optimizer at
// the next level cap(s) — same pool, SAME unlocks, only the cap moved — and
// compares each line's value, so "Magikarp is one badge from a real payoff"
// falls out of the same model instead of a special rule.
//
// Scope honesty: this projects the level cap ONLY. Real Reborn progression also
// unlocks TMs, tutors, items, shops, and locations at future badges — none of
// that is modeled here (it would need per-badge unlock data), and the UI says
// so. Good for cap-gated futures (evolutions, level-up moves); not a full
// future-gamestate simulation.

import { optimizeTeamFromPool } from "./teamOptimizer.js";
import { REBORN_PROGRESSION_CHECKPOINTS } from "../reborn/badgeTimeline.js";

const TRAIN_SOON_GAIN = 250; // score points at the next cap that make a mon worth tracking
const CLOSE_BENCH_MARGIN = 0.985; // swap score within 1.5% of the team's own score

// The distinct upcoming caps, straight from the badge timeline (the single
// source of progression truth) — a hardcoded copy here once drifted from it
// and stopped short of the postgame tiers (105–150).
export function nextLevelCaps(levelCap, count = 2) {
  const cap = Number.parseInt(levelCap, 10) || 0;
  const upcoming = [];
  for (const checkpoint of REBORN_PROGRESSION_CHECKPOINTS) {
    if (checkpoint.levelCap > cap && !upcoming.includes(checkpoint.levelCap)) {
      upcoming.push(checkpoint.levelCap);
    }
  }
  return upcoming.slice(0, count);
}

export async function computeInvestmentPlan({
  availability,
  family,
  pokemonIndex,
  progression,
  query,
  selection,
  result,
  // MUST match the model `result` was scored under: gain compares a future
  // score against result's now-score, and optimizeTeamFromPool resets the
  // session-global usage model to its argument on every call.
  scoringModel = null,
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
        scoringModel,
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

  // Close bench: benched mons whose best swap-in barely trails the chosen
  // team's OWN score. The old reference — the best swap score on the bench —
  // measured "close to the best bench mon", so a uniformly weak bench called
  // everything close (user report: "Azurill nearly seats"). Without a real
  // reference the section stays empty rather than guessing.
  const closeBench = [];
  const teamReference = result.teamScore ?? result.bestEvaluated?.score;
  if (result.benchSwapScores && teamReference > 0) {
    const trainSoonIds = new Set(trainSoon.map((entry) => entry.inputPokemonId));
    for (const [inputId, swapScore] of result.benchSwapScores) {
      if (teamIds.has(inputId)) continue;
      // Already called out with a concrete cap gain above — one list per mon.
      if (trainSoonIds.has(inputId)) continue;
      if (swapScore >= teamReference * CLOSE_BENCH_MARGIN) {
        closeBench.push({
          inputPokemonId: inputId,
          inputName: nowByInput.get(inputId)?.inputName || inputId,
        });
      }
    }
  }

  return { caps, trainSoon, holdOff, closeBench };
}
