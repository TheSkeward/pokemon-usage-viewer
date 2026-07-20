// Source-quality ladder for every team-scrape consumer (user-ratified, with
// dataset scale priced in: some of these streams are millions of games, so
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

// Replay archive records: rating bands, except tournament-thread replays,
// which are elite prepared play regardless of their (absent) ladder rating.
export function replayWeight(record) {
  if (record.source === "tournament") return WEIGHTS.tournament_team;
  const rating = record.rating;
  if (rating == null) return WEIGHTS.unrated_replay;
  if (rating >= 1760) return WEIGHTS.rated_1760_plus;
  if (rating >= 1630) return WEIGHTS.rated_1630_1759;
  if (rating >= 1500) return WEIGHTS.rated_1500_1629;
  return WEIGHTS.rated_below_1500;
}

// Paste-sourced team records (samples / tournament dumps / RMT).
export function teamWeight(record) {
  if (record.source === "tournament") return WEIGHTS.tournament_team;
  if (record.source === "rmt") return WEIGHTS.rmt;
  return WEIGHTS.sample_team;
}
