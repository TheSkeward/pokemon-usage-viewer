/**
 * @fileoverview Runs team harvesters in sequence so that one source's
 * failure cannot skip the others, and writes each scraper's exit code and
 * output tail to last-harvest.json in the committed archive.
 * --only=<names> (comma-separated: pkmn, replays, samples, rmt,
 * tournament, forums) runs a subset. The harvest only
 * runs in CI, whose step log is impractical to retrieve after the fact, so
 * the archive itself carries the evidence of what each scraper did.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ARCHIVE_DIR } from './scrape-replay-teams.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Harvesters in run order. Names are the selection vocabulary for --only and
 * match the archive filename prefixes. Smogon's tolerance is spent
 * cumulatively within a run — late walkers hit 403s the early ones did not —
 * so the smogon.com walkers run in source-weight order: the sources worth
 * 1000 draw on the freshest allowance and RMT (weight 5) drinks last. The
 * non-Smogon fetchers (pkmn, replays) cost no forum goodwill; replays runs
 * last only because it is the slowest.
 * @type {!Array<{name: string, script: string}>}
 */
export const SCRAPERS = [
  { name: 'pkmn', script: path.join(scriptDir, 'scrape-pkmn-teams.mjs') },
  { name: 'samples', script: path.join(scriptDir, 'scrape-sample-teams.mjs') },
  {
    name: 'tournament',
    script: path.join(scriptDir, 'scrape-tournament-teams.mjs'),
  },
  { name: 'forums', script: path.join(scriptDir, 'scrape-forum-teams.mjs') },
  { name: 'rmt', script: path.join(scriptDir, 'scrape-rmt-teams.mjs') },
  { name: 'replays', script: path.join(scriptDir, 'scrape-replay-teams.mjs') },
];

/**
 * Resolves an --only= selection to script paths. The replay backfill takes
 * ~40 minutes per run, so any single-source question (are the forum seed
 * URLs right?) must be runnable without it.
 *
 * @param {string} only Comma-separated scraper names; empty selects all.
 * @return {!Array<string>} Script paths in run order.
 */
export function selectScrapers(only) {
  const names = String(only || '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  if (!names.length) return SCRAPERS.map(({ script }) => script);
  const byName = new Map(SCRAPERS.map(({ name, script }) => [name, script]));
  const unknown = names.filter((name) => !byName.has(name));
  if (unknown.length) {
    throw new Error(
      `unknown scraper name(s) ${unknown.join(', ')} — ` +
        `valid: ${[...byName.keys()].join(', ')}`,
    );
  }
  return SCRAPERS.filter(({ name }) => names.includes(name)).map(
    ({ script }) => script,
  );
}

const OUTPUT_TAIL_LINES = 30;

function runScript(script) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const tee = (stream, sink) => {
      stream.on('data', (chunk) => {
        sink.write(chunk);
        output += chunk;
      });
    };
    tee(child.stdout, process.stdout);
    tee(child.stderr, process.stderr);
    child.on('close', (code) => resolve({ code: code ?? 1, output }));
    child.on('error', (error) => {
      resolve({ code: 1, output: `${output}${error.message}\n` });
    });
  });
}

/**
 * Runs each scraper to completion regardless of the others' outcomes and
 * records the results.
 *
 * @param {!Array<string>} scripts Scraper script paths.
 * @param {string} recordPath Where to write the run record.
 * @return {!Promise<{failures: number, results: !Array<!Object>}>}
 */
export async function runHarvest(scripts, recordPath) {
  const results = [];
  for (const script of scripts) {
    console.log(`== ${path.basename(script)} ==`);
    const { code, output } = await runScript(script);
    results.push({
      script: path.basename(script),
      exitCode: code,
      outputTail: output.split('\n').filter(Boolean).slice(-OUTPUT_TAIL_LINES),
    });
  }
  fs.mkdirSync(path.dirname(recordPath), { recursive: true });
  fs.writeFileSync(
    recordPath,
    `${JSON.stringify({ finishedAt: new Date().toISOString(), results }, null, 2)}\n`,
  );
  return { failures: results.filter((r) => r.exitCode !== 0).length, results };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const only =
    process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length) ??
    '';
  const { failures } = await runHarvest(
    selectScrapers(only),
    path.join(ARCHIVE_DIR, 'last-harvest.json'),
  );
  if (failures) process.exitCode = 1;
}
