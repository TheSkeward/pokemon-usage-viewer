// Gamestate backup: export downloads a parseable file, import restores it
// (modulo the app's own pool normalization), corrupt files are rejected
// with a readable status.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  launchBrowser,
  openPoolPage,
  check,
} from './helpers/env.mjs';

const browser = await launchBrowser();
const workDir = mkdtempSync(path.join(tmpdir(), 'gamestate-e2e-'));
try {
  const page = await openPoolPage(browser);
  await page.fill('textarea', 'Froakie\nOnix');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#export-gamestate-button'),
  ]);
  const file = path.join(workDir, download.suggestedFilename());
  await download.saveAs(file);
  const exported = JSON.parse(readFileSync(file, 'utf8'));
  check(
    'download is a versioned gamestate',
    exported.format === 'pokemon-usage-viewer-gamestate' && exported.version === 1,
  );
  check('pool captured', exported.pool.includes('Froakie'), exported.pool);
  check(
    'file name is date-stamped',
    /^reborn-gamestate-\d{4}-\d{2}-\d{2}\.json$/.test(download.suggestedFilename()),
    download.suggestedFilename(),
  );

  await page.fill('textarea', '');
  page.on('dialog', (dialog) => dialog.accept());
  await page.click('#import-gamestate-button');
  await page.setInputFiles('#import-gamestate-input', file);
  await page.waitForTimeout(1500);
  const restored = await page.evaluate(() => document.querySelector('textarea')?.value || '');
  check(
    'import restores the pool (same mons; the app may re-delimit)',
    restored.includes('Froakie') && restored.includes('Onix'),
    restored,
  );

  const bad = path.join(workDir, 'bad.json');
  writeFileSync(bad, '{"nope":true}');
  await page.click('#import-gamestate-button');
  await page.setInputFiles('#import-gamestate-input', bad);
  await page.waitForTimeout(400);
  const status = await page.evaluate(() => document.querySelector('[data-pool-status]')?.textContent || '');
  check('corrupt file rejected with readable status', /Import failed/.test(status), status);
} finally {
  await browser.close();
}
console.log('gamestate-backup: PASS');
