/**
 * @fileoverview Curated sample-team harvester: visits the Smogon sample-team
 * threads listed in teamscrape/sources.json, follows every pokepast.es link,
 * and appends each new paste's parsed team to a committed JSONL archive
 * (samples-<format>.jsonl). Curated threads are the high-trust source for
 * whole observed sets; replays only contribute compositions.
 *
 * Same politeness contract as scrape-replay-teams.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseShowdownTeam } from './teamscrape/parse-showdown-team.mjs';
import { toTeamSheetId } from './teamscrape/replay-log.mjs';
import { readArchiveIds } from './scrape-replay-teams.mjs';
import { extractFirstPostText } from './teamscrape/forum-html.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE_DIR = path.join(scriptDir, 'teamscrape', 'archive');
const SOURCES_PATH = path.join(scriptDir, 'teamscrape', 'sources.json');

const USER_AGENT =
  'pokemon-usage-viewer team harvester (github.com/TheSkeward/pokemon-usage-viewer)';
const REQUEST_GAP_MS = 900;
const MAX_THREAD_PAGES = 12;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchText(url) {
  await sleep(REQUEST_GAP_MS);
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}

/** @return {!Array<string>} Unique pokepast.es paste ids found in the HTML. */
export function extractPasteIds(html) {
  return [
    ...new Set(
      [...String(html).matchAll(/pokepast\.es\/([0-9a-f]{8,16})/g)].map(
        (match) => match[1],
      ),
    ),
  ];
}

/**
 * @return {{id: string, format: string, thread: string, source: string,
 *     sets: !Array<!Object>}} The archive record; species ids are collapsed
 *     to team-sheet ids.
 */
export function normalizeSampleTeam({ pasteId, formatId, thread, sets }) {
  return {
    id: pasteId,
    format: formatId,
    thread,
    source: 'sample',
    sets: sets.map((set) => ({
      species: set.species,
      speciesId: toTeamSheetId(set.speciesId),
      item: set.item,
      itemId: set.itemId,
      ability: set.ability,
      abilityId: set.abilityId,
      nature: set.nature,
      level: set.level,
      evs: set.evs,
      ivs: set.ivs,
      moves: set.moves,
      moveIds: set.moveIds,
    })),
  };
}

const TEAM_SIZE = 6;
const MIN_TEAM_SETS = 4;

/**
 * Splits one post's flat run of parsed sets into whole teams. Sample-thread
 * opening posts paste several importables back to back with nothing
 * machine-readable between them, and official importables are six mons, so
 * consecutive six-set groups ARE the team boundaries; a short final group is
 * kept only when it still looks like a team rather than stray example sets.
 * @param {!Array<!Object>} sets
 * @return {!Array<!Array<!Object>>}
 */
export function groupInlineTeams(sets) {
  const teams = [];
  for (let i = 0; i < sets.length; i += TEAM_SIZE) {
    const group = sets.slice(i, i + TEAM_SIZE);
    if (group.length >= MIN_TEAM_SETS) teams.push(group);
  }
  return teams;
}

function harvestInlineTeams({ html, formatId, thread, seen, file }) {
  const threadId = /\.(\d+)\/?$/.exec(thread)?.[1] || 'unknown';
  const text = extractFirstPostText(html);
  const { sets } = parseShowdownTeam(text);
  let appended = 0;
  groupInlineTeams(sets).forEach((teamSets, index) => {
    const pasteId = `thread-${threadId}-op-${index}`;
    if (seen.has(pasteId)) return;
    const record =
      normalizeSampleTeam({ pasteId, formatId, thread, sets: teamSets });
    fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
    seen.add(pasteId);
    appended += 1;
  });
  return { appended, opChars: text.length, opSets: sets.length };
}

async function harvestThread(formatId, thread, seen, file) {
  let appended = 0;
  let inline = { appended: 0, opChars: 0, opSets: 0 };
  let title = null;
  const linked = new Set();
  for (let page = 1; page <= MAX_THREAD_PAGES; page += 1) {
    const url = page === 1 ? thread : `${thread}page-${page}`;
    let html;
    try {
      html = await fetchText(url);
    } catch (error) {
      if (page === 1) throw error; // page 1 failing = thread URL is wrong
      break; // past the last page
    }
    if (page === 1) {
      title = (/<title>([^<]*)<\/title>/.exec(html)?.[1] || '').trim() || null;
      inline = harvestInlineTeams({ html, formatId, thread, seen, file });
      console.log(
        `  op: ${inline.opChars} chars, ${inline.opSets} inline set(s)`);
    }
    for (const pasteId of extractPasteIds(html)) {
      linked.add(pasteId);
      if (seen.has(pasteId)) continue;
      let pasteText;
      try {
        pasteText = await fetchText(`https://pokepast.es/${pasteId}/raw`);
      } catch (error) {
        console.warn(`  skip paste ${pasteId}: ${error.message}`);
        continue;
      }
      const { sets, dropped } = parseShowdownTeam(pasteText);
      if (dropped) {
        // A snippet of a fully unreadable paste shows WHAT it was (another
        // game's export, prose, ...) — the difference between a parser gap
        // and a paste that was never a team.
        const head = pasteText.slice(0, 60).replace(/\s+/g, ' ').trim();
        console.warn(
          `  paste ${pasteId}: ${dropped} unreadable block(s)` +
            (sets.length ? '' : ` — starts ${JSON.stringify(head)}`),
        );
      }
      if (!sets.length) continue;
      const record = normalizeSampleTeam({ pasteId, formatId, thread, sets });
      fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
      seen.add(pasteId);
      appended += 1;
    }
  }
  return { appended, inline, linked: linked.size, title };
}

async function main() {
  const { threads } = JSON.parse(fs.readFileSync(SOURCES_PATH, 'utf8'));
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  let failures = 0;
  let attempts = 0;
  for (const [formatId, urls] of Object.entries(threads)) {
    const file = path.join(ARCHIVE_DIR, `samples-${formatId}.jsonl`);
    const seen = readArchiveIds(file);
    for (const thread of urls) {
      attempts += 1;
      try {
        const { appended, inline, linked, title } = await harvestThread(
          formatId, thread, seen, file);
        console.log(
          `${formatId} ${thread}: +${appended} of ${linked} paste link(s), ` +
            `+${inline.appended} inline — "${title ?? 'no <title>'}" ` +
            `(archive ${seen.size})`,
        );
      } catch (error) {
        failures += 1;
        console.warn(`${formatId} ${thread}: FAILED — ${error.message}`);
      }
    }
  }
  if (attempts && failures === attempts) {
    console.error('every thread failed — bad URLs or no network access to smogon.com');
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
