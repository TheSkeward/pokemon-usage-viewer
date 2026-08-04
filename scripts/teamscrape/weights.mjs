/**
 * @fileoverview Source-quality ladder for every team-scrape consumer, with
 * dataset scale priced in: some of these streams are millions of games, so
 * the ratios are steep enough that mass alone can never outvote curation).
 * Note the deliberate inversion: an unrated replay is a MIXTURE over all
 * skill levels (tournament games and high-level friendlies never ladder), so
 * its expected value beats a KNOWN sub-1500 game.
 */

/** Record weight per source class. @type {!Object<string, number>} */
export const WEIGHTS = {
  unrated_replay: 0.005,
  rated_below_1500: 0.001,
  rated_1500_1629: 0.02,
  rated_1630_1759: 0.2,
  rated_1760_plus: 1.0,
  rmt: 5.0,
  // Community-shared forum teams: the ratified floor for any thread without
  // its own entry in FORUM_THREAD_WEIGHTS below.
  forum_team: 5.0,
  tournament_team: 60.0,
  sample_team: 1000.0,
};

/**
 * Ladder-rating band floors, descending. The corpus report derives its band
 * labels from these so its bands can't drift from the weighting.
 */
export const RATING_FLOORS = {
  elite: 1760, // rated_1760_plus
  strong: 1630, // rated_1630_1759
  mid: 1500, // rated_1500_1629
};

/**
 * Whether a replay record is organized-tournament play rather than ladder.
 * Beyond the tournament-thread scraper's explicit tag, the replay id's server
 * prefix identifies games played on smogtours — the server Smogon's
 * tournaments run on. Smogtours games never carry a ladder rating, so rating
 * bands would misfile them as unrated mixture. Other side-server prefixes
 * (rom, sports, ...) really are mixture and stay in the rating bands.
 * @param {{source: (string|undefined), id: (string|undefined)}} record
 * @return {boolean}
 */
export function isTournamentReplay(record) {
  return (
    record.source === 'tournament' ||
    String(record.id ?? '').startsWith('smogtours-')
  );
}

/**
 * Replay archive records: rating bands, except tournament replays, which are
 * elite prepared play regardless of their (absent) ladder rating.
 * @param {{source: (string|undefined), id: (string|undefined),
 *     rating: ?number}} record
 * @return {number}
 */
export function replayWeight(record) {
  if (isTournamentReplay(record)) return WEIGHTS.tournament_team;
  const rating = record.rating;
  if (rating == null) return WEIGHTS.unrated_replay;
  if (rating >= RATING_FLOORS.elite) return WEIGHTS.rated_1760_plus;
  if (rating >= RATING_FLOORS.strong) return WEIGHTS.rated_1630_1759;
  if (rating >= RATING_FLOORS.mid) return WEIGHTS.rated_1500_1629;
  return WEIGHTS.rated_below_1500;
}

/**
 * Forum threads weighted individually, keyed by the thread's numeric id.
 * Forum teams arrive slowly enough that a per-thread ruling beats pattern
 * rules; a thread absent here prices at the forum_team floor.
 * @type {!Object<string, number>}
 */
export const FORUM_THREAD_WEIGHTS = {
  // Snake Draft 2019 OU discussion: tour teams shared by the players,
  // mixed with rebuilds - below a player's own verified dump (60).
  '3653598': 40,
  // Your favorite teams of the generation: self-selected proven showcases.
  '3654503': 20,
  // USUM Metagame Discussion: teams shared as what's-working meta reports —
  // substantially above an unvetted RMT, below a self-selected showcase.
  '3646999': 15,
  // Simple Questions, Simple Answers: help-desk Q&A — mostly pre-help teams
  // posted because they are NOT working, plus answerer fixes. Priced at the
  // floor deliberately, not by default.
  '3587186': 5,
  // Ask the Mods: same help-desk provenance as SQSA.
  '3655050': 5,
};

/**
 * Paste-sourced team records (samples / tournament dumps / RMT / forum).
 * @param {{source: string, thread: (string|undefined)}} record
 * @return {number}
 */
export function teamWeight(record) {
  if (record.source === 'tournament') return WEIGHTS.tournament_team;
  if (record.source === 'rmt') return WEIGHTS.rmt;
  if (record.source === 'forum') {
    const threadId = /\.(\d+)\/?$/.exec(record.thread || '')?.[1];
    return FORUM_THREAD_WEIGHTS[threadId] ?? WEIGHTS.forum_team;
  }
  return WEIGHTS.sample_team;
}
