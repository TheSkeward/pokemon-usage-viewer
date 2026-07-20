/**
 * @fileoverview Corpus report (npm run report:teams): what the team archives
 * actually contain, so ladder judgements can be checked against data instead
 * of priors — per-source volumes and weight shares (is RMT drowning things or
 * negligible?), replay rating distributions (is there any elite ladder
 * signal left in gen 7?), paste dedup rates (how much of RMT is unique?),
 * and the top cores by evidence weight per family.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { REAL_FORMATS } from "./config.mjs";
import { readArchive } from "./build-observed-sets.mjs";
import { collectCompositions, buildCoreIndex } from "./build-core-index.mjs";
import { buildTeamIndex } from "./build-team-index.mjs";
import { RATING_FLOORS, replayWeight, teamWeight } from "./teamscrape/weights.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE_DIR = path.join(scriptDir, "teamscrape", "archive");

// Band edges come from the weighting's own floors (weights.mjs), so the
// report's bands always describe the bands the weights actually use.
const { elite, strong, mid } = RATING_FLOORS;
const RATING_BANDS = [
  [`${elite}+`, (r) => r != null && r >= elite],
  [`${strong}-${elite - 1}`, (r) => r != null && r >= strong && r < elite],
  [`${mid}-${strong - 1}`, (r) => r != null && r >= mid && r < strong],
  [`<${mid}`, (r) => r != null && r < mid],
  ["unrated", (r) => r == null],
];

/**
 * @return {{formats: !Map<string, !Object>, pasteRecords: number,
 *     uniqueTeams: number, totalWeightBySource: !Map<string, number>}}
 *     Per-format source/rating tallies plus corpus-wide dedup and weight-share
 *     totals.
 */
export function summarizeCorpus({ replays, teams }) {
  const formats = new Map(); // formatId → per-source {records, weight} + rating bands
  const forFormat = (id) => {
    if (!formats.has(id)) {
      formats.set(id, {
        sources: new Map(),
        ratings: new Map(RATING_BANDS.map(([band]) => [band, 0])),
      });
    }
    return formats.get(id);
  };
  const bump = (entry, source, weight) => {
    const cell = entry.sources.get(source) || { records: 0, weight: 0 };
    cell.records += 1;
    cell.weight += weight;
    entry.sources.set(source, cell);
  };

  for (const replay of replays) {
    const entry = forFormat(replay.format);
    const source = replay.source === "tournament" ? "tournament-replay" : "ladder";
    bump(entry, source, replayWeight(replay));
    if (source === "ladder") {
      const band = RATING_BANDS.find(([, test]) => test(replay.rating));
      if (band) entry.ratings.set(band[0], entry.ratings.get(band[0]) + 1);
    }
  }
  // Teamless skip-markers (sets: []) are archive bookkeeping, not corpus.
  const realTeams = teams.filter((team) => (team.sets || []).length);
  for (const team of realTeams) {
    bump(forFormat(team.format), team.source || "sample", teamWeight(team));
  }

  // Dedup rate: unique team-index entries vs raw paste records.
  const index = buildTeamIndex(realTeams);
  let uniqueTeams = 0;
  for (const files of index.values()) {
    for (const detail of files.values()) uniqueTeams += detail.teams.length;
  }

  const totalWeightBySource = new Map();
  for (const entry of formats.values()) {
    for (const [source, cell] of entry.sources) {
      totalWeightBySource.set(
        source,
        (totalWeightBySource.get(source) || 0) + cell.weight,
      );
    }
  }

  return {
    formats,
    pasteRecords: realTeams.length,
    uniqueTeams,
    totalWeightBySource,
  };
}

/**
 * @return {!Map<string, !Array<{pair: string, lift: number, count: number}>>}
 *     family → heaviest partner pairs, `perFamily` of them.
 */
export function topCores({ replays, teams }, perFamily = 10) {
  const realTeams = teams.filter((team) => (team.sets || []).length);
  const byFamily = collectCompositions({ replays, samples: realTeams });
  const out = new Map();
  for (const [family, compositions] of byFamily) {
    const pairs = [];
    for (const [monId, detail] of buildCoreIndex(compositions)) {
      for (const [other, { lift, count }] of Object.entries(detail.partners)) {
        if (monId < other) pairs.push({ pair: `${monId}+${other}`, lift, count });
      }
    }
    out.set(
      family,
      pairs.sort((a, b) => b.count - a.count).slice(0, perFamily),
    );
  }
  return out;
}

const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(3));

function main() {
  const replays = readArchive(ARCHIVE_DIR, "replays-");
  const teams = [
    ...readArchive(ARCHIVE_DIR, "samples-"),
    ...readArchive(ARCHIVE_DIR, "rmt-"),
    ...readArchive(ARCHIVE_DIR, "tournament-"),
  ];
  if (!replays.length && !teams.length) {
    console.log("team corpus: archives are empty — nothing harvested yet");
    return;
  }
  const summary = summarizeCorpus({ replays, teams });

  console.log("== Team corpus ==");
  console.log(
    `paste teams: ${summary.pasteRecords} records, ${summary.uniqueTeams} unique after dedup`,
  );
  console.log("\nweight share by source (all formats):");
  const totalWeight = [...summary.totalWeightBySource.values()].reduce(
    (a, b) => a + b,
    0,
  );
  for (const [source, weight] of [...summary.totalWeightBySource].sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(
      `  ${source.padEnd(18)} ${fmt(weight).padStart(12)}  (${((100 * weight) / totalWeight).toFixed(1)}%)`,
    );
  }

  console.log("\nper format:");
  for (const { id } of REAL_FORMATS) {
    const entry = summary.formats.get(id);
    if (!entry) continue;
    const cells = [...entry.sources]
      .map(([source, cell]) => `${source} ${cell.records} (w ${fmt(cell.weight)})`)
      .join(" · ");
    const bands = [...entry.ratings]
      .filter(([, count]) => count)
      .map(([band, count]) => `${band}: ${count}`)
      .join(", ");
    console.log(`  ${id.padEnd(18)} ${cells}${bands ? `\n${" ".repeat(21)}ladder ratings — ${bands}` : ""}`);
  }

  console.log("\ntop cores by evidence weight:");
  for (const [family, pairs] of topCores({ replays, teams })) {
    console.log(`  [${family}]`);
    for (const { pair, lift, count } of pairs) {
      console.log(
        `    ${pair.padEnd(34)} weight ${fmt(count).padStart(9)}  lift ${lift > 0 ? "+" : ""}${fmt(lift)}pp`,
      );
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
