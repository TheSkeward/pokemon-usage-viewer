/**
 * @fileoverview Curated sample teams from the pkmn project's data API
 * (data.pkmn.cc/teams/<format>.json, mirrored in the pkmn/smogon repo):
 * Smogon's official sample teams, pre-extracted and served as JSON built
 * for machine consumption — whole six-mon teams with full sets. Covers
 * formats whose sample threads resist scraping and needs no smogon.com
 * access at all. Records join the samples-<format>.jsonl archives (they
 * ARE sample teams; the team index dedups overlap with thread-harvested
 * copies) under content-hash ids, so re-runs append only new or changed
 * teams. A format with no teams file (404) is a gap in the upstream data,
 * not a failure.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { REAL_FORMATS } from './config.mjs';
import { normalizeSampleTeam } from './scrape-sample-teams.mjs';
import { readArchiveIds } from './scrape-replay-teams.mjs';
import { toId } from '../src/utils/ids.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE_DIR = path.join(scriptDir, 'teamscrape', 'archive');

const USER_AGENT =
  'pokemon-usage-viewer team harvester (github.com/TheSkeward/pokemon-usage-viewer)';
const REQUEST_GAP_MS = 300;

// The canonical API first; the repo mirror serves identical files when the
// canonical host is unreachable from the runner.
const HOSTS = [
  'https://data.pkmn.cc/teams',
  'https://raw.githubusercontent.com/pkmn/smogon/main/data/teams',
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchTeams(formatId) {
  let lastError = null;
  for (const host of HOSTS) {
    const url = `${host}/${formatId}.json`;
    await sleep(REQUEST_GAP_MS);
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
      });
      if (response.status === 404) return { teams: null, url };
      if (!response.ok) throw new Error(`${response.status} ${url}`);
      return { teams: await response.json(), url };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/**
 * @param {!Object} team A pkmn Team ({name?, author?, data: PokemonSet[]}).
 * @return {!Array<!Object>} Sets shaped like parseShowdownSet output.
 */
export function pkmnTeamSets(team) {
  return (team.data || []).map((mon) => ({
    species: mon.species,
    speciesId: toId(mon.species),
    item: mon.item ?? null,
    itemId: mon.item ? toId(mon.item) : null,
    ability: mon.ability ?? null,
    abilityId: mon.ability ? toId(mon.ability) : null,
    nature: mon.nature ?? null,
    level: mon.level ?? null,
    evs: mon.evs ?? null,
    ivs: mon.ivs ?? null,
    moves: mon.moves || [],
    moveIds: (mon.moves || []).map(toId),
  }));
}

async function main() {
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  let failures = 0;
  let missing = 0;
  for (const { id: formatId } of REAL_FORMATS) {
    const file = path.join(ARCHIVE_DIR, `samples-${formatId}.jsonl`);
    const seen = readArchiveIds(file);
    let teams;
    let url;
    try {
      ({ teams, url } = await fetchTeams(formatId));
    } catch (error) {
      failures += 1;
      console.warn(`${formatId}: FAILED — ${error.message}`);
      continue;
    }
    if (!teams) {
      missing += 1;
      console.log(`${formatId}: no teams file upstream`);
      continue;
    }
    let appended = 0;
    for (const team of teams) {
      const pasteId = `pkmn-${crypto
        .createHash('sha1')
        .update(JSON.stringify(team))
        .digest('hex')
        .slice(0, 12)}`;
      if (seen.has(pasteId)) continue;
      const record = normalizeSampleTeam({
        pasteId,
        formatId,
        thread: url,
        sets: pkmnTeamSets(team),
      });
      fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
      seen.add(pasteId);
      appended += 1;
    }
    console.log(
      `${formatId}: +${appended} of ${teams.length} (archive ${seen.size})`,
    );
  }
  if (failures === REAL_FORMATS.length - missing) {
    console.error('every format failed — no network route to either host?');
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
