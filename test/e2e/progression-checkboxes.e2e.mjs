// Progression checkbox mechanics: the obtainable rail, in-place ticking (no
// page rebuild, twins synced, live counter), viewport pinning, and the tutor
// subgroup "All" union. Needs a real optimized result on screen — the
// in-place path deliberately falls back to a full render without one.
import {
  launchBrowser,
  openPoolPage,
  openAllDetails,
  setBadgeCheckpoint,
  optimizeSmallPool,
  check,
} from './helpers/env.mjs';

const browser = await launchBrowser();
try {
  const page = await openPoolPage(browser);
  await setBadgeCheckpoint(page);
  await optimizeSmallPool(page);
  await openAllDetails(page);

  check(
    'obtainable rail renders',
    await page.evaluate(() => Boolean(document.querySelector('.progression-obtainable-rail'))),
  );

  await page.evaluate(() => {
    document.querySelector('[data-progression-group="availableTmIds"]').dataset.smokeMarker = 'alive';
    window.scrollTo(0, 500);
  });
  const clicked = await page.evaluate(() => {
    const box =
      document.querySelector('.progression-obtainable-rail [data-progression-option-list="availableTmIds"]') ||
      document.querySelector('[data-progression-option-list="availableTmIds"]:not(:checked)');
    box.click();
    return box.value;
  });
  await page.waitForTimeout(300);

  const state = await page.evaluate((value) => {
    const group = document.querySelector('[data-progression-group="availableTmIds"]');
    const twins = [...document.querySelectorAll('[data-progression-option-list="availableTmIds"]')].filter(
      (b) => b.value === value,
    );
    return {
      markerAlive: group?.dataset.smokeMarker === 'alive',
      twinCount: twins.length,
      allChecked: twins.every((b) => b.checked),
      counter: group?.querySelector('[data-progression-group-count]')?.textContent || '',
      scrollY: window.scrollY,
    };
  }, clicked);

  check('tick does NOT rebuild the page DOM', state.markerAlive);
  check('both twin renderings sync', state.twinCount === 2 && state.allChecked, JSON.stringify(state));
  check('counter live-updates in place', /1\/\d+ selected/.test(state.counter), state.counter);
  check('viewport stays pinned', state.scrollY === 500, String(state.scrollY));

  const tutor = await page.evaluate(() => {
    const btn = document.querySelector('[data-progression-subgroup-all]');
    if (!btn) return null;
    btn.click();
    return btn.dataset.progressionOptionIds.split(',').filter(Boolean).length;
  });
  await page.waitForTimeout(400);
  check('tutor subgroup All exists and marks its moves', tutor > 0, String(tutor));
  check(
    'subgroup All UNIONS (the TM tick survives)',
    await page.evaluate(
      (value) =>
        [...document.querySelectorAll('[data-progression-option-list="availableTmIds"]')]
          .filter((b) => b.value === value)
          .every((b) => b.checked),
      clicked,
    ),
  );
  check(
    'scroll survives the full render bulk actions trigger',
    Math.abs((await page.evaluate(() => window.scrollY)) - 500) < 50,
  );
} finally {
  await browser.close();
}
console.log('progression-checkboxes: PASS');
