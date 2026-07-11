// DISPLAY-ONLY relaxation of the meaningful-usage bar (user design: "when
// something has no usage data, iteratively add 5 to the number of games
// played in the '50% chance of having been seen in N games' calculation").
//
// The meaningful bar itself is that calculation at N = 25:
// MIN_MEANINGFUL_USAGE_PERCENT = 100·(1 − 0.5^(1/25)) ≈ 2.73% — a mon at the
// bar has even odds of appearing within 25 games. A mon below it everywhere
// still qualifies at some LARGER horizon: gamesToLikelySee inverts the
// formula and steps N up in 5s (30, 35, 40, …), giving the bench tail its
// label — "ZU 1500 (30)" reads "at its ZU-1500 usage, 50% odds of seeing one
// within 30 games". Nothing here feeds scoring; it decorates rows the engine
// has already classified as below the bar.
export const BASE_SEEN_GAMES = 25;
export const SEEN_GAMES_STEP = 5;

// Smallest N in {30, 35, 40, …} such that usage `valuePercent` gives a ≥50%
// chance of at least one appearance within N games: (1 − v/100)^N ≤ 0.5.
// Null for zero/absent usage — that stays honest "no usage data".
export function gamesToLikelySee(valuePercent) {
  if (!(valuePercent > 0) || valuePercent >= 100) return null;
  const exact = Math.log(0.5) / Math.log(1 - valuePercent / 100);
  return Math.max(
    BASE_SEEN_GAMES + SEEN_GAMES_STEP,
    Math.ceil(exact / SEEN_GAMES_STEP) * SEEN_GAMES_STEP,
  );
}
