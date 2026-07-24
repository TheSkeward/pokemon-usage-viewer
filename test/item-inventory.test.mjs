// Inventory bulk-merge + shop-sync semantics (progression panel UX):
// addRebornOwnedItems raises counts without ever lowering one, and
// renewable-item helpers list exactly the badge-reachable stock and mining
// rewards the player isn't tracking yet.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addRebornOwnedItems,
  DEFAULT_REBORN_PROGRESSION,
  MAX_TRACKED_ITEM_COUNT,
} from '../src/reborn/progression.js';
import { renderRebornProgressionPanel } from '../src/reborn/progression-view.js';
import {
  getPurchasableShopItems,
  getRenewablyObtainableItems,
} from '../src/reborn/item-availability.js';
import {
  REBORN_MINING_ITEM_BADGES,
  REBORN_SHOP_ITEM_BADGES,
} from '../src/generated/rebornItemTimeline.generated.js';

test('addRebornOwnedItems raises, clamps, and never lowers', () => {
  const base = { ownedItems: { leftovers: 2, choiceband: 6 } };
  const next = addRebornOwnedItems(base, {
    leftovers: 6,
    choiceband: 1, // must NOT lower an existing 6
    eviolite: 99, // clamps to the tracking cap
    '': 6, // ignored
    airballoon: 0, // non-positive ignored, not deleted-into-existence
  });

  assert.equal(next.ownedItems.leftovers, MAX_TRACKED_ITEM_COUNT);
  assert.equal(next.ownedItems.choiceband, MAX_TRACKED_ITEM_COUNT);
  assert.equal(next.ownedItems.eviolite, MAX_TRACKED_ITEM_COUNT);
  assert.ok(!('airballoon' in next.ownedItems));
  // Original untouched (progression updates are immutable).
  assert.equal(base.ownedItems.leftovers, 2);
});

test('getPurchasableShopItems: badge-gated, owned-filtered, stable order', () => {
  assert.ok(
    Object.keys(REBORN_SHOP_ITEM_BADGES).length >= 150,
    "the generated shop map should cover the guide's full shop stock",
  );

  const atFour = getPurchasableShopItems(4, {});
  assert.ok(atFour.length > 0, 'shops exist by badge 4');
  assert.ok(
    atFour.every((item) => item.badge <= 4),
    'nothing beyond the current badge',
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

test('mining items join the renewable 6+ list at badge 3', () => {
  assert.ok(
    Object.keys(REBORN_MINING_ITEM_BADGES).length >= 40,
    'expected the full tracked mining-item catalog',
  );

  const atTwo =
    new Set(getRenewablyObtainableItems(2, {}).map((item) => item.id));
  const atThree = getRenewablyObtainableItems(3, {});
  const atThreeIds = new Set(atThree.map((item) => item.id));

  for (const id of Object.keys(REBORN_MINING_ITEM_BADGES)) {
    if ((REBORN_SHOP_ITEM_BADGES[id] ?? Infinity) > 2) {
      assert.ok(!atTwo.has(id), `${id} must not be renewable before badge 3`);
    }
    assert.ok(atThreeIds.has(id), `${id} must be renewable at badge 3`);
  }
  assert.equal(
    atThreeIds.size,
    atThree.length,
    'items with both shop and mining sources must be deduplicated',
  );

  const ownedMining = Object.fromEntries(
    Object.keys(REBORN_MINING_ITEM_BADGES).map((id) => [id, 6]),
  );
  const afterSync =
    new Set(getRenewablyObtainableItems(3, ownedMining).map((item) => item.id));
  for (const id of Object.keys(REBORN_MINING_ITEM_BADGES)) {
    assert.ok(!afterSync.has(id), `${id} must disappear once tracked`);
  }
});

test('renewable 6+ sync retains partially stocked mining items and gems', () => {
  const partial = getRenewablyObtainableItems(
    6,
    { pixieplate: 1, firegem: 1 },
    MAX_TRACKED_ITEM_COUNT,
  );
  const partialIds = new Set(partial.map((item) => item.id));
  assert.ok(partialIds.has('pixieplate'));
  assert.ok(partialIds.has('firegem'));

  const full = getRenewablyObtainableItems(
    6,
    {
      pixieplate: MAX_TRACKED_ITEM_COUNT,
      firegem: MAX_TRACKED_ITEM_COUNT,
    },
    MAX_TRACKED_ITEM_COUNT,
  );
  const fullIds = new Set(full.map((item) => item.id));
  assert.ok(!fullIds.has('pixieplate'));
  assert.ok(!fullIds.has('firegem'));

  const raised = addRebornOwnedItems(
    { ownedItems: { pixieplate: 1, firegem: 1 } },
    Object.fromEntries(
      partial.map((item) => [item.id, MAX_TRACKED_ITEM_COUNT]),
    ),
  );
  assert.equal(raised.ownedItems.pixieplate, MAX_TRACKED_ITEM_COUNT);
  assert.equal(raised.ownedItems.firegem, MAX_TRACKED_ITEM_COUNT);
});

test('badge-6 inventory panel offers partial mining items and gems at 6+', () => {
  globalThis.localStorage = { getItem: () => null };
  let html;
  try {
    html = renderRebornProgressionPanel({
      ...DEFAULT_REBORN_PROGRESSION,
      checkpoint: 'badge-6',
      levelCap: '55',
      ownedItems: { pixieplate: 1, firegem: 1 },
    });
  } finally {
    delete globalThis.localStorage;
  }

  const renewablePanel =
    html.match(/<details class="item-shop-sync"[\s\S]*?<\/details>/)?.[0] || '';
  assert.match(html, /data-renewable-sync-button/);
  assert.match(html, /Renewably obtainable at your badge, below 6\+/);
  assert.match(renewablePanel, /Pixie Plate/);
  assert.match(renewablePanel, /Fire Gem/);
  assert.match(html, /Add all \d+ as 6\+/);
});

test('badge-1 shop stock includes the user-verified Obsidia berry floor', () => {
  // Verified against in-game screenshots: after Badge 1 the Department
  // Store berry shop sells the six heal/status berries alongside Persim +
  // the EV berries. The SHOP_STOCK overlay in build-item-timeline.mjs is
  // an agreement check on these user-verified rows.
  const VERIFIED_BADGE_1_BERRIES = [
    'oranberry', 'cheriberry', 'pechaberry', 'rawstberry', 'chestoberry',
    'aspearberry', 'persimberry', 'pomegberry', 'kelpsyberry', 'qualotberry',
    'hondewberry', 'grepaberry', 'tamatoberry',
  ];
  for (const id of VERIFIED_BADGE_1_BERRIES) {
    assert.equal(
      REBORN_SHOP_ITEM_BADGES[id],
      1,
      `${id} must be shop-purchasable at badge 1`,
    );
  }
  const offered =
    new Set(getPurchasableShopItems(1, {}).map((item) => item.id));
  for (const id of VERIFIED_BADGE_1_BERRIES) {
    assert.ok(offered.has(id), `${id} must appear in the badge-1 shop sync`);
  }
});

test('shop rows masked by earlier one-off pickups survive extraction', () => {
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
