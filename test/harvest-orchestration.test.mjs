// Harvest orchestration regression: the first CI harvest chained the four
// scrapers with &&, so the sample scraper's exit 1 silently skipped the RMT
// and tournament scrapers. Every scraper must run regardless of the others'
// outcomes, and the run record must still report the failure.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { runHarvest } = await import('../scripts/harvest-teams.mjs');

test('a failing scraper does not skip the ones after it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harvest-'));
  try {
    const failing = path.join(dir, 'failing.mjs');
    const marker = path.join(dir, 'ran.marker');
    const succeeding = path.join(dir, 'succeeding.mjs');
    fs.writeFileSync(
      failing,
      'console.error("every thread failed"); process.exitCode = 1;\n',
    );
    fs.writeFileSync(
      succeeding,
      `import fs from 'node:fs';\n` +
        `fs.writeFileSync(${JSON.stringify(marker)}, 'ran');\n`,
    );
    const recordPath = path.join(dir, 'last-harvest.json');
    const { failures, results } = await runHarvest(
      [failing, succeeding],
      recordPath,
    );

    assert.ok(fs.existsSync(marker), 'later scraper must still run');
    assert.equal(failures, 1);
    const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
    assert.equal(record.results.length, 2);
    assert.equal(record.results[0].exitCode, 1);
    assert.deepEqual(record.results[0].outputTail, ['every thread failed']);
    assert.equal(record.results[1].exitCode, 0);
    assert.equal(results[1].exitCode, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
