/**
 * @fileoverview LEVEL-CAP investment projection: "best six right now" and
 * "worth training soon" are different products. Selection never spends future
 * value; THIS view is where the future lives. It re-runs the real optimizer
 * at the next level cap(s) — same pool, SAME unlocks, only the cap moved —
 * and compares each line's value, so "Magikarp is one badge from a real
 * payoff" falls out of the same model instead of a special rule.
 *
 * Scope honesty: this projects the level cap ONLY. Real Reborn progression
 * also unlocks TMs, tutors, items, shops, and locations at future badges —
 * none of that is modeled here (it would need per-badge unlock data), and the
 * UI says so. Good for cap-gated futures (evolutions, level-up moves); not a
 * full future-gamestate simulation.
 */

import { optimizeTeamFromPool } from './teamOptimizer.js';
import { REBORN_PROGRESSION_CHECKPOINTS } from '../reborn/badgeTimeline.js';

// score points at the next cap that make a mon worth tracking
const TRAIN_SOON_GAIN = 250;
// swap score within 1.5% of the team's own score
const CLOSE_BENCH_MARGIN = 0.985;

/**
 * The distinct upcoming caps, straight from the badge timeline — the single
 * source of progression truth; never hardcode a copy here.
 * @param {string|number} levelCap
 * @param {number} count
 * @return {Array<number>}
 */
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

/**
 * @return {Promise<?{caps: Array<number>, trainSoon: Array<Object>,
 *     holdOff: Array<Object>, closeBench: Array<Object>}>} Null when there
 *     are no upcoming caps, no current team, or the run was aborted.
 */
export async function computeInvestmentPlan({
  availability,
  family,
  pokemonIndex,
  progression,
  query,
  selection,
  result,
  // Checked before each future-cap optimize. A user optimize awaits the whole
  // post-analysis before it starts (the sweep's override handshake), so
  // without this hook a click landing mid-investment queued behind BOTH
  // remaining future runs.
  shouldAbort = () => false,
  // Progressive delivery: called with a `partial: true` plan the moment the
  // FIRST future cap lands, so the panel shows something useful in half the
  // cold time. The returned plan is always the complete one.
  onPartial = null,
}) {
  const caps = nextLevelCaps(progression.levelCap, 2);
  if (!caps.length || !result?.team?.length) return null;

  const nowByInput = new Map();
  for (const line of result.lines || []) {
    const choice = line.best || line.bestNonMega;
    if (choice) nowByInput.set(choice.inputPokemonId, choice);
  }
  const teamIds = new Set(result.team.map((choice) => choice.inputPokemonId));

  // The optimizer memoizes by (context, pool), so repeat projections at this
  // gamestate are free. searchMode "fast" because the plan barely uses the
  // searches: `gain` compares LINE scores, which are exact under any search
  // mode; only `seatsLater` reads the future team, and a shortlist-grade six
  // is the right price for a "worth training soon" hint. Fast runs also
  // resolve DEFAULT-ONLY builds (teamOptimizer's fastMode trim).
  const futureResults = [];
  for (const cap of caps) {
    if (shouldAbort()) return null;
    futureResults.push({
      cap,
      result: await optimizeTeamFromPool({
        availability,
        family,
        pokemonIndex,
        progression: { ...progression, levelCap: String(cap) },
        query,
        selection,
        searchMode: 'fast',
      }),
    });
    if (futureResults.length < caps.length && onPartial) {
      const partial =
        buildInvestmentPlan({ nowByInput, teamIds, result, futureResults });
      partial.partial = true;
      partial.pendingCaps = caps.slice(futureResults.length);
      onPartial(partial);
    }
  }

  return buildInvestmentPlan({ nowByInput, teamIds, result, futureResults });
}

// Assembles the plan from whichever future caps have landed so far — pure so
// the progressive partial and the final plan are the same computation.
function buildInvestmentPlan({ nowByInput, teamIds, result, futureResults }) {
  const caps = futureResults.map((entry) => entry.cap);
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
        best =
          { cap, gain: Math.round(gain), evolves, seatsLater, futureChoice };
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
  // team's OWN score. The reference must be the team score, not the best
  // bench swap score — that would call everything on a uniformly weak bench
  // "close". Without a real reference the section stays empty rather than
  // guessing.
  const closeBench = [];
  const teamReference = result.teamScore ?? result.bestEvaluated?.score;
  if (result.benchSwapScores && teamReference > 0) {
    const trainSoonIds =
      new Set(trainSoon.map((entry) => entry.inputPokemonId));
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
