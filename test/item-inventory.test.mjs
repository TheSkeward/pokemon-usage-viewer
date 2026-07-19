// Inventory bulk-merge + shop-sync semantics (progression panel UX):
// addRebornOwnedItems raises counts without ever lowering one, and
// getPurchasableShopItems lists exactly the badge-reachable shop stock the
// player isn't tracking yet.
import test from "node:test";
import assert from "node:assert/strict";
import {
  addRebornOwnedItems,
  MAX_TRACKED_ITEM_COUNT,
} from "../src/reborn/progression.js";
import { getPurchasableShopItems } from "../src/reborn/itemAvailability.js";
import { REBORN_SHOP_ITEM_BADGES } from "../src/generated/rebornItemTimeline.generated.js";

test("addRebornOwnedItems raises, clamps, and never lowers", () => {
  const base = { ownedItems: { leftovers: 2, choiceband: 6 } };
  const next = addRebornOwnedItems(base, {
    leftovers: 6,
    choiceband: 1, // must NOT lower an existing 6
    eviolite: 99, // clamps to the tracking cap
    "": 6, // ignored
    airballoon: 0, // non-positive ignored, not deleted-into-existence
  });

  assert.equal(next.ownedItems.leftovers, MAX_TRACKED_ITEM_COUNT);
  assert.equal(next.ownedItems.choiceband, MAX_TRACKED_ITEM_COUNT);
  assert.equal(next.ownedItems.eviolite, MAX_TRACKED_ITEM_COUNT);
  assert.ok(!("airballoon" in next.ownedItems));
  // Original untouched (progression updates are immutable).
  assert.equal(base.ownedItems.leftovers, 2);
});

test("getPurchasableShopItems: badge-gated, owned-filtered, stable order", () => {
  assert.ok(
    Object.keys(REBORN_SHOP_ITEM_BADGES).length >= 150,
    "the generated shop map should cover the guide's full shop stock",
  );

  const atFour = getPurchasableShopItems(4, {});
  assert.ok(atFour.length > 0, "shops exist by badge 4");
  assert.ok(
    atFour.every((item) => item.badge <= 4),
    "nothing beyond the current badge",
  );
  const names = atFour.map((item) => item.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));

  // Tracking an item removes it from the sync list; a later badge offers more.
  const owned = Object.fromEntries(atFour.map((item) => [item.id, 6]));
  assert.equal(getPurchasableShopItems(4, owned).length, 0);
  assert.ok(getPurchasableShopItems(18, owned).length > 0);

  // No badge selected -> nothing offered (never guess the gamestate).
  assert.equal(getPurchasableShopItems(null, {}).length, 0);
});

test("badge-1 shop stock includes the user-verified Obsidia berry floor", () => {
  // User report with in-game screenshots: after Badge 1 the Department
  // Store berry shop sells the six heal/status berries alongside Persim +
  // the EV berries. The SHOP_STOCK overlay in build-item-timeline.mjs is
  // an agreement check on these user-verified rows.
  const VERIFIED_BADGE_1_BERRIES = [
    "oranberry", "cheriberry", "pechaberry", "rawstberry", "chestoberry",
    "aspearberry", "persimberry", "pomegberry", "kelpsyberry", "qualotberry",
    "hondewberry", "grepaberry", "tamatoberry",
  ];
  for (const id of VERIFIED_BADGE_1_BERRIES) {
    assert.equal(
      REBORN_SHOP_ITEM_BADGES[id],
      1,
      `${id} must be shop-purchasable at badge 1`,
    );
  }
  const offered = new Set(getPurchasableShopItems(1, {}).map((item) => item.id));
  for (const id of VERIFIED_BADGE_1_BERRIES) {
    assert.ok(offered.has(id), `${id} must appear in the badge-1 shop sync`);
  }
});

test("shop rows masked by earlier one-off pickups survive extraction", () => {
  // An item with ANY earlier non-shop pickup (a hidden find, a story gift)
  // must still get its renewable shop timing from the guide's Shops tab.
  // Pins are spot-audited sheet rows.
  const MASKED_SHOP_ROWS = {
    leftovers: 17,
    lifeorb: 17,
    choiceband: 18,
    firegem: 6, // the badge-6 type-gem vendor stocks all gems
    darkgem: 6,
    firestone: 13, // post-restoration Department Store stone floor
    duskstone: 13,
    metalcoat: 13,
    kingsrock: 16,
  };
  for (const [id, badge] of Object.entries(MASKED_SHOP_ROWS)) {
    assert.equal(
      REBORN_SHOP_ITEM_BADGES[id],
      badge,
      `${id} must be shop-purchasable at badge ${badge}`,
    );
  }
});
