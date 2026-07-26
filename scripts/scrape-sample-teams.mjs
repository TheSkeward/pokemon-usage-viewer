/**
 * @fileoverview Curated sample-team harvester: visits the Smogon sample-team
 * threads listed in teamscrape/sources.json and appends each team found in
 * the THREAD AUTHOR's posts — pokepaste links and inline importables both —
 * to a committed JSONL archive (samples-<format>.jsonl). Author scoping is
 * the curation boundary: the collection lives in the opening post and the
 * author's reserved posts, while other users' replies are submissions of
 * unknown standing. Curated threads are the high-trust source for whole
 * observed sets; replays only contribute compositions.
 *
 * Same politeness contract as scrape-replay-teams.mjs.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  MIN_SETS_PER_TEAM,
  parseShowdownTeam,
} from './teamscrape/parse-showdown-team.mjs';
import { toTeamSheetId } from './teamscrape/replay-log.mjs';
import { readArchiveIds } from './scrape-replay-teams.mjs';
import { extractPosts, hasNextPage } from './teamscrape/forum-html.mjs';
import {
  closeTeamSourceFetcher,
  fetchTeamSourceText as fetchText,
} from './teamscrape/forum-fetch.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE_DIR = path.join(scriptDir, 'teamscrape', 'archive');
const SOURCES_PATH = path.join(scriptDir, 'teamscrape', 'sources.json');

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
    if (group.length >= MIN_SETS_PER_TEAM) teams.push(group);
  }
  return teams;
}

const EARLY_POSTS = 5;

// Sample threads grow by their hosts EDITING posts, which never bumps
// XenForo's last-post ordering — so change detection hashes page 1's
// CONTENT (the curated collection lives there). A weekly full walk is
// the backstop for edits buried on later pages of these closed archives.
const FULL_WALK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

function pageOneHash(html, posts) {
  return crypto
    .createHash('sha1')
    .update(JSON.stringify([extractPasteIds(html), posts.map((p) => p.text)]))
    .digest('hex');
}

async function harvestThread(formatId, thread, seen, file, threadState) {
  const threadId = /\.(\d+)\/?$/.exec(thread)?.[1] || 'unknown';
  let walkAll = true;
  let pagesFetched = 0;
  let appended = 0;
  let inline = 0;
  let inlineSets = 0;
  let authorPosts = 0;
  let scannedChars = 0;
  let longest = { chars: 0, text: '' };
  let opAuthor = null;
  let title = null;
  let postIndex = 0;
  const linked = new Set();
  for (let page = 1; ; page += 1) {
    const url = page === 1 ? thread : `${thread}page-${page}`;
    const html = await fetchText(url);
    if (page === 1) {
      title = (/<title>([^<]*)<\/title>/.exec(html)?.[1] || '').trim() || null;
    }
    const posts = extractPosts(html);
    pagesFetched = page;
    if (page === 1) {
      opAuthor = posts[0]?.author ?? null;
      const hash = pageOneHash(html, posts);
      const fresh =
        Date.now() - (threadState.fullWalkAt || 0) < FULL_WALK_INTERVAL_MS;
      walkAll = hash !== threadState.pageOneHash || !fresh;
      threadState.pageOneHash = hash;
      if (walkAll) threadState.fullWalkAt = Date.now();
    }
    // The curated collection lives at the TOP of the thread — the opening
    // post plus reserved posts, which are not always by the same account
    // (NU keeps its teams in the first reply) — and in the thread author's
    // later posts. Deeper replies by others are submissions, approved or
    // not, and must not enter at sample trust. Markup without recognizable
    // posts falls back to a whole-page link sweep.
    const scoped = posts.length
      ? posts.filter((post, index) =>
        (page === 1 && index < EARLY_POSTS) ||
          (opAuthor && post.author === opAuthor))
      : null;
    for (const post of scoped ?? [{ html, text: '' }]) {
      postIndex += 1;
      if (scoped) {
        authorPosts += 1;
        scannedChars += post.text.length;
        if (post.text.length > longest.chars) {
          longest = { chars: post.text.length, text: post.text };
        }
        const { sets } = parseShowdownTeam(post.text);
        inlineSets += sets.length;
        groupInlineTeams(sets).forEach((teamSets, group) => {
          const pasteId = `thread-${threadId}-op-${postIndex}-${group}`;
          if (seen.has(pasteId)) return;
          const record =
            normalizeSampleTeam({ pasteId, formatId, thread, sets: teamSets });
          fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
          seen.add(pasteId);
          inline += 1;
        });
      }
      for (const pasteId of extractPasteIds(post.html)) {
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
    if (!walkAll) break;
    if (!hasNextPage(html, page)) break;
  }
  // With sets landing everywhere via pokepaste links but never inline, the
  // open question is whether inline text reaches the parser at all — the
  // longest scanned post's head answers it: readable set lines mean a
  // parser gap, prose or emptiness means the teams live elsewhere.
  if (!inlineSets && scannedChars) {
    // A set header is "Species @ Item" — the exact characters around the
    // first " @ " (entities, invisibles, line breaks) name whatever still
    // defeats the parser.
    const at = longest.text.indexOf(' @ ');
    const probe =
      at === -1
        ? `no " @ " anywhere; starts ${JSON.stringify(longest.text.slice(0, 120))}`
        : `around first " @ ": ${JSON.stringify(longest.text.slice(Math.max(0, at - 60), at + 140))}`;
    console.log(
      `  scanned ${authorPosts} post(s), ${scannedChars} chars, 0 sets — ${probe}`,
    );
  }
  return {
    appended, inline, inlineSets, authorPosts, linked: linked.size, title,
    pagesFetched, walkAll,
  };
}

async function main() {
  const { threads } = JSON.parse(fs.readFileSync(SOURCES_PATH, 'utf8'));
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  const statePath = path.join(ARCHIVE_DIR, 'samples-crawl-state.json');
  let state = { threads: {} };
  try {
    state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (!state.threads) state = { threads: {} };
  } catch {
    // A torn state file only costs one full re-walk; appends dedupe it.
  }
  let failures = 0;
  let attempts = 0;
  for (const [formatId, urls] of Object.entries(threads)) {
    const file = path.join(ARCHIVE_DIR, `samples-${formatId}.jsonl`);
    const seen = readArchiveIds(file);
    for (const thread of urls) {
      attempts += 1;
      try {
        if (!state.threads[thread]) state.threads[thread] = {};
        const {
          appended, inline, inlineSets, authorPosts, linked, title,
          pagesFetched, walkAll,
        } = await harvestThread(formatId, thread, seen, file,
          state.threads[thread]);
        fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
        console.log(
          `${formatId} ${thread}: +${appended} of ${linked} paste link(s), ` +
            `+${inline} inline (${authorPosts} author post(s), ` +
            `${inlineSets} sets, ${pagesFetched} page(s)` +
            `${walkAll ? '' : ', unchanged'}) — "${title ?? 'no <title>'}" ` +
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
  const run = async () => {
    try {
      await main();
    } finally {
      await closeTeamSourceFetcher();
    }
  };
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
