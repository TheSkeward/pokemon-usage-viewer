import assert from "node:assert/strict";
import test from "node:test";

import {
  currentFormFeatures,
  currentFormValue,
  singleActionScreenSupport,
  utilityTagVector,
} from "../src/teamBuilder/currentFormValue.js";

const screen = (name, axes, requiresWeather) => ({
  id: name.toLowerCase().replace(/[^a-z0-9]+/g, ""),
  name,
  category: "Status",
  priority: 0,
  roles: ["screen"],
  screenAxes: axes,
  requiresWeather,
  accuracy: 100,
});

const auroraVeil = screen(
  "Aurora Veil",
  ["physical", "special"],
  "hail",
);
const reflect = screen("Reflect", ["physical"]);
const lightScreen = screen("Light Screen", ["special"]);
const hail = {
  id: "hail",
  name: "Hail",
  category: "Status",
  priority: 0,
  roles: ["setup"],
  accuracy: 100,
};

test("single-action protection distinguishes Aurora Veil from two screen turns", () => {
  assert.deepEqual(
    singleActionScreenSupport([auroraVeil], "Snow Cloak", 0.8),
    { protection_q: 0, delivery_q: 0, value_q: 0 },
  );
  assert.equal(
    singleActionScreenSupport([auroraVeil], "Snow Warning", 0.8)
      .protection_q,
    1,
  );
  assert.equal(
    singleActionScreenSupport([auroraVeil, hail], "Snow Cloak", 0.8)
      .protection_q,
    1,
  );
  assert.equal(
    singleActionScreenSupport([reflect, lightScreen], "Competitive", 0.8)
      .protection_q,
    0.5,
  );
});

test("priority completes screen delivery while ordinary screens use Speed", () => {
  const ordinary = singleActionScreenSupport([reflect], "Competitive", 0.36);
  const prankster = singleActionScreenSupport([reflect], "Prankster", 0.36);
  assert.equal(ordinary.delivery_q, 0.36);
  assert.equal(prankster.delivery_q, 1);
  assert.ok(prankster.value_q > ordinary.value_q);
});

test("build facts preserve single-action screen compression", () => {
  const dualTurn = utilityTagVector(
    [reflect, lightScreen],
    "Competitive",
  );
  const veil = utilityTagVector([auroraVeil], "Snow Warning");
  assert.equal(dualTurn.at(-2), 0.5);
  assert.equal(veil.at(-2), 1);
});

test("complete executable team protection is a distinct current-value role", () => {
  const attack = {
    id: "moonblast",
    name: "Moonblast",
    category: "Special",
    estimatedDamage: 120,
    roles: [],
    accuracy: 100,
  };
  const profile = {
    currentId: "ninetalesalola",
    currentTypes: ["Ice", "Fairy"],
    assumedAbility: "Snow Warning",
    bestDamagingMove: attack,
    bestStabMove: attack,
    recommendedDamagingMoveCount: 1,
    recommendedMoves: [attack, auroraVeil],
  };
  const features = currentFormFeatures(profile, 85);
  assert.equal(features.screen_protection_q, 1);
  assert.equal(features.screen_delivery_q, features.speed_q);
  assert.equal(currentFormValue(profile, 85).bestRole, "screen_support");
});
