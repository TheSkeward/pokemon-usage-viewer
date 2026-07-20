/**
 * @fileoverview Runs every team harvester in sequence so that one source's
 * failure cannot skip the others, and writes each scraper's exit code and
 * output tail to last-harvest.json in the committed archive. The harvest only
 * runs in CI, whose step log is impractical to retrieve after the fact, so
 * the archive itself carries the evidence of what each scraper did.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ARCHIVE_DIR } from './scrape-replay-teams.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

/** Harvesters in run order. @type {!Array<string>} */
export const SCRAPERS = [
  path.join(scriptDir, 'scrape-replay-teams.mjs'),
  path.join(scriptDir, 'scrape-sample-teams.mjs'),
  path.join(scriptDir, 'scrape-rmt-teams.mjs'),
  path.join(scriptDir, 'scrape-tournament-teams.mjs'),
];

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
  const { failures } = await runHarvest(
    SCRAPERS,
    path.join(ARCHIVE_DIR, 'last-harvest.json'),
  );
  if (failures) process.exitCode = 1;
}
