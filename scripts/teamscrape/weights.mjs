// Source-quality ladder for every team-scrape consumer, with dataset scale
// priced in: some of these streams are millions of games, so
// the ratios are steep enough that mass alone can never outvote curation).
// Note the deliberate inversion: an unrated replay is a MIXTURE over all
// skill levels (tournament games and high-level friendlies never ladder), so
// its expected value beats a KNOWN sub-1500 game.
export const WEIGHTS = {
  unrated_replay: 0.005,
  rated_below_1500: 0.001,
  rated_1500_1629: 0.02,
  rated_1630_1759: 0.2,
  rated_1760_plus: 1.0,
  rmt: 5.0,
  tournament_team: 60.0,
  sample_team: 1000.0,
};

// Ladder-rating band floors, descending. The corpus report derives its band
// labels from these so its bands can't drift from the weighting.
export const RATING_FLOORS = {
  elite: 1760, // rated_1760_plus
  strong: 1630, // rated_1630_1759
  mid: 1500, // rated_1500_1629
};

// Replay archive records: rating bands, except tournament-thread replays,
// which are elite prepared play regardless of their (absent) ladder rating.
export function replayWeight(record) {
  if (record.source === "tournament") return WEIGHTS.tournament_team;
  const rating = record.rating;
  if (rating == null) return WEIGHTS.unrated_replay;
  if (rating >= RATING_FLOORS.elite) return WEIGHTS.rated_1760_plus;
  if (rating >= RATING_FLOORS.strong) return WEIGHTS.rated_1630_1759;
  if (rating >= RATING_FLOORS.mid) return WEIGHTS.rated_1500_1629;
  return WEIGHTS.rated_below_1500;
}

// Paste-sourced team records (samples / tournament dumps / RMT).
export function teamWeight(record) {
  if (record.source === "tournament") return WEIGHTS.tournament_team;
  if (record.source === "rmt") return WEIGHTS.rmt;
  return WEIGHTS.sample_team;
}
