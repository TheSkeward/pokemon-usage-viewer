// The badge-keyed progression timeline (curated from BIGJRA's walkthrough,
// the project's canonical progression source) is the schedule the badge
// picker and readiness phases lean on, so its shape is pinned here:
// contiguous checkpoints, a non-decreasing cap ladder ending at 150, and
// every unlock key resolving to a real progression field / item id.
import test from "node:test";
import assert from "node:assert/strict";

const {
  REBORN_PROGRESSION_CHECKPOINTS,
  getRebornCheckpoint,
  getExpectedUnlocks,
  getUnlockBadge,
  getRebornCheckpointShortLabel,
} = await import("../src/reborn/badgeTimeline.js");
const { EVOLUTION_ACCESS_FIELDS } = await import(
  "../src/reborn/evolutionRequirements.js"
);
const {
  DEFAULT_REBORN_PROGRESSION,
  applyRebornCheckpoint,
  normalizeRebornProgression,
} = await import("../src/reborn/progression.js");
const {
  REBORN_TM_OPTIONS,
  REBORN_TMX_OPTIONS,
  REBORN_TUTOR_GROUPS,
} = await import("../src/reborn/progressionOptions.js");
const { GEN7_HELD_ITEMS_BY_ID } = await import(
  "../src/generated/gen7HeldItems.generated.js"
);

test("timeline shape: 19 badge checkpoints + 10 post-game tiers, caps non-decreasing 20→150", () => {
  assert.equal(REBORN_PROGRESSION_CHECKPOINTS.length, 29);

  const badgeCheckpoints = REBORN_PROGRESSION_CHECKPOINTS.filter(
    (checkpoint) => !checkpoint.postgame,
  );
  assert.equal(badgeCheckpoints.length, 19); // 0 through 18 badges
  assert.deepEqual(
    badgeCheckpoints.map((checkpoint) => checkpoint.badges),
    Array.from({ length: 19 }, (_, index) => index),
  );

  let previousCap = 0;
  for (const checkpoint of REBORN_PROGRESSION_CHECKPOINTS) {
    assert.ok(
      checkpoint.levelCap >= previousCap,
      `${checkpoint.id}: cap ${checkpoint.levelCap} regressed below ${previousCap}`,
    );
    previousCap = checkpoint.levelCap;
  }
  assert.equal(REBORN_PROGRESSION_CHECKPOINTS[0].levelCap, 20);
  assert.equal(REBORN_PROGRESSION_CHECKPOINTS.at(-1).levelCap, 150);
});

test("walkthrough pins: known cap checkpoints, including the flat badges", () => {
  const cap = (id) => getRebornCheckpoint(id).levelCap;
  assert.equal(cap("badge-1"), 25); // Volt
  assert.equal(cap("badge-2"), 35); // Canopy skips 30
  assert.equal(cap("badge-5"), 50); // Blight, "finally"
  assert.equal(cap("badge-9"), 70); // Eclipse
  assert.equal(cap("badge-10"), 70); // Strike raises nothing
  assert.equal(cap("badge-12"), 75); // Gravity raises nothing
  assert.equal(cap("badge-16"), 90); // Torrent raises nothing
  assert.equal(cap("badge-18"), 100); // Treasure
  assert.equal(cap("post-10"), 150);
});

test("every unlock key resolves to a real field or item id", () => {
  const accessKeys = new Set(EVOLUTION_ACCESS_FIELDS.map((field) => field.key));
  const flagKeys = new Set([
    "moveRelearnerUnlocked",
    "daycareUnlocked",
    "hiddenPowerTypeChangerUnlocked",
  ]);

  for (const checkpoint of REBORN_PROGRESSION_CHECKPOINTS) {
    for (const key of checkpoint.unlocks.access || []) {
      assert.ok(accessKeys.has(key), `${checkpoint.id}: unknown access ${key}`);
    }
    for (const key of checkpoint.unlocks.flags || []) {
      assert.ok(flagKeys.has(key), `${checkpoint.id}: unknown flag ${key}`);
    }
    for (const item of checkpoint.unlocks.items || []) {
      assert.ok(
        GEN7_HELD_ITEMS_BY_ID[item],
        `${checkpoint.id}: unknown item ${item}`,
      );
    }
  }
});

test("schedule pins: area/flag unlocks land at their walkthrough badges", () => {
  assert.equal(getUnlockBadge("evoAccessApophyll"), 4);
  assert.equal(getUnlockBadge("evoAccessMossyRock"), 5);
  assert.equal(getUnlockBadge("evoAccessIcyRock"), 7);
  assert.equal(getUnlockBadge("evoAccessLinkStone"), 3);
  assert.equal(getUnlockBadge("daycareUnlocked"), 1);
  assert.equal(getUnlockBadge("moveRelearnerUnlocked"), 5);
  assert.equal(getUnlockBadge("hiddenPowerTypeChangerUnlocked"), 9);
  // Mechanics are never scheduled — available from the start.
  assert.equal(getUnlockBadge("evoAccessFriendship"), null);
  assert.equal(getUnlockBadge("evoAccessPartyCondition"), null);

  const atNine = getExpectedUnlocks("badge-9");
  assert.ok(atNine.accessKeys.has("evoAccessApophyll"));
  assert.ok(atNine.flags.has("hiddenPowerTypeChangerUnlocked"));
  assert.ok(atNine.itemIds.has("eviolite"));
  assert.ok(!getExpectedUnlocks("badge-8").itemIds.has("eviolite"));
});

test("panel ↔ timeline consistency: every TM/TMX/tutor availability names a badge 1–18", () => {
  const badgeOf = (available) => {
    const match = /Badge\s+(\d+)/i.exec(String(available || ""));
    return match ? Number.parseInt(match[1], 10) : null;
  };

  for (const option of [...REBORN_TM_OPTIONS, ...REBORN_TMX_OPTIONS]) {
    const badge = badgeOf(option.available);
    assert.ok(
      badge != null && badge >= 1 && badge <= 18,
      `${option.id}: unparseable availability "${option.available}"`,
    );
  }
  for (const group of REBORN_TUTOR_GROUPS) {
    const badge = badgeOf(group.available);
    assert.ok(
      badge != null && badge >= 1 && badge <= 18,
      `tutor group ${group.label}: unparseable availability "${group.available}"`,
    );
  }
});

test("applyRebornCheckpoint derives the cap; normalization keeps the field honest", () => {
  const nine = applyRebornCheckpoint(DEFAULT_REBORN_PROGRESSION, "badge-9");
  assert.equal(nine.checkpoint, "badge-9");
  assert.equal(nine.levelCap, "70"); // levelCap stays a STRING for consumers

  const post = applyRebornCheckpoint(nine, "post-3");
  assert.equal(post.levelCap, "115"); // post-game caps clear the old 100 clamp

  const cleared = applyRebornCheckpoint(post, "");
  assert.equal(cleared.checkpoint, "");
  assert.equal(cleared.levelCap, "115", "clearing the picker keeps the cap");

  // Unknown ids are dropped, legacy saves stay untouched otherwise.
  const junk = normalizeRebornProgression({ checkpoint: "badge-99", levelCap: "45" });
  assert.equal(junk.checkpoint, "");
  assert.equal(junk.levelCap, "45");

  assert.equal(
    getRebornCheckpointShortLabel(getRebornCheckpoint("badge-9")),
    "9 badges",
  );
  assert.equal(
    getRebornCheckpointShortLabel(getRebornCheckpoint("post-3")),
    "Post 3",
  );
});
