// Item inventory UX (the shop-haul flow): sticky 6+ picker, Enter-to-add
// with focus retention, row flash, never-lower re-adds, and the one-click
// "purchasable at your badge" sync.
import {
  launchBrowser,
  openPoolPage,
  openAllDetails,
  setBadgeCheckpoint,
  check,
} from "./helpers/env.mjs";

const browser = await launchBrowser();
try {
  const page = await openPoolPage(browser);
  await openAllDetails(page);

  check(
    "count picker defaults to 6+",
    (await page.inputValue("[data-item-add-count]")) === "6",
  );

  await page.fill("[data-item-add-input]", "Leftovers");
  await page.press("[data-item-add-input]", "Enter");
  await page.waitForTimeout(300);
  check(
    "Enter-add lands at 6",
    (await page.inputValue('[data-owned-item-count][data-item-id="leftovers"]')) === "6",
  );
  check(
    "focus returns to the search box",
    await page.evaluate(() => document.activeElement?.matches("[data-item-add-input]")),
  );
  check(
    "added row flashes",
    await page.evaluate(() => Boolean(document.querySelector(".item-inventory-row.item-row-flash"))),
  );

  await page.selectOption("[data-item-add-count]", "1");
  await page.fill("[data-item-add-input]", "Leftovers");
  await page.press("[data-item-add-input]", "Enter");
  await page.waitForTimeout(300);
  check(
    "re-add at x1 never lowers a 6",
    (await page.inputValue('[data-owned-item-count][data-item-id="leftovers"]')) === "6",
  );

  await setBadgeCheckpoint(page);
  await openAllDetails(page);
  const syncButton = await page.$("[data-shop-sync-button]");
  check("shop sync block appears with a badge set", Boolean(syncButton));
  const beforeRows = await page.$$eval(".item-inventory-row", (rows) => rows.length);
  await syncButton.click();
  await page.waitForTimeout(400);
  const afterRows = await page.$$eval(".item-inventory-row", (rows) => rows.length);
  check(
    "sync adds the purchasable stock in one click",
    afterRows > beforeRows + 5,
    `${beforeRows} -> ${afterRows}`,
  );
} finally {
  await browser.close();
}
console.log("item-inventory: PASS");
