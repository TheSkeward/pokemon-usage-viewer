// Shared environment for the e2e specs: resolves playwright wherever it
// lives, launches Chromium, and provides the page-setup steps every spec
// repeats. Specs are plain node scripts (assert + async main) run by
// scripts/run-e2e.mjs against a `vite preview` of the CURRENT build — they
// verify behaviors the unit suites cannot see (focus retention, scroll
// pinning, downloads, in-place DOM patching).

import assert from "node:assert/strict";
import { existsSync } from "node:fs";

export const BASE_URL =
  process.env.E2E_BASE_URL || "http://localhost:4199/pokemon-usage-viewer";

async function resolvePlaywright() {
  try {
    return await import("playwright");
  } catch {
    // Not installed locally — try the environment's global install (the
    // managed container ships one at this path).
    try {
      return await import(
        "file:///opt/node22/lib/node_modules/playwright/index.mjs"
      );
    } catch {
      throw new Error(
        "playwright not found. Install it once: npm i -D playwright && npx playwright install chromium",
      );
    }
  }
}

export async function launchBrowser() {
  const { chromium } = await resolvePlaywright();
  const knownChromium = "/opt/pw-browsers/chromium";
  return chromium.launch(
    existsSync(knownChromium) ? { executablePath: knownChromium } : {},
  );
}

export async function openPoolPage(browser) {
  const page = await browser.newPage();
  await page.goto(`${BASE_URL}/pool.html`, { waitUntil: "networkidle" });
  return page;
}

export async function openAllDetails(page) {
  await page.evaluate(() => {
    document.querySelectorAll("details").forEach((d) => (d.open = true));
  });
}

// Selects a badge checkpoint by scanning for the select whose options mention
// badges — resilient to markup ids changing. Returns the chosen label.
export async function setBadgeCheckpoint(page, index = 6) {
  const label = await page.evaluate((wanted) => {
    for (const sel of document.querySelectorAll("select")) {
      if ([...sel.options].some((o) => /badge/i.test(o.textContent))) {
        sel.selectedIndex = wanted;
        sel.dispatchEvent(new Event("change", { bubbles: false }));
        return sel.options[wanted].textContent.trim();
      }
    }
    return null;
  }, index);
  assert.ok(label, "no badge checkpoint select found");
  await page.waitForTimeout(400);
  return label;
}

// Fills the pool textarea and runs an optimize, waiting for the team table —
// the precondition for every behavior that only engages with a result on
// screen (in-place checkbox patching, bench rendering, ...).
export async function optimizeSmallPool(page, pool = ["Froakie", "Onix", "Spearow"]) {
  await page.fill("textarea", pool.join("\n"));
  await page.click("#optimize-button");
  await page.waitForSelector("table", { timeout: 180_000 });
  await page.waitForTimeout(800);
}

// Tiny check helper: logs each assertion so a failing spec's output shows
// how far it got.
export function check(name, condition, detail = "") {
  assert.ok(condition, `${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`  ok: ${name}`);
}
