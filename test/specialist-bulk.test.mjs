import assert from "node:assert/strict";
import test from "node:test";

import {
  currentFormFeatures,
  currentFormValue,
  defensiveTypeBalance,
} from "../src/teamBuilder/currentFormValue.js";

const damagingSet = (damage = 260) => [
  {
    name: "Primary STAB",
    category: "Special",
    estimatedDamage: damage,
    roles: [],
    accuracy: 100,
  },
  {
    name: "Secondary STAB",
    category: "Special",
    estimatedDamage: damage * 0.85,
    roles: [],
    accuracy: 100,
  },
  {
    name: "Coverage",
    category: "Special",
    estimatedDamage: damage * 0.65,
    roles: [],
    accuracy: 100,
  },
];

function profile({ currentId, currentTypes, damage = 260 }) {
  const recommendedMoves = damagingSet(damage);
  return {
    currentId,
    currentTypes,
    bestDamagingMove: recommendedMoves[0],
    bestStabMove: recommendedMoves[0],
    recommendedDamagingMoveCount: recommendedMoves.length,
    recommendedMoves,
  };
}

test("defensive type balance prices resists, immunities, and severe weaknesses", () => {
  assert.equal(defensiveTypeBalance(["Water", "Fairy"]), 1);
  assert.equal(defensiveTypeBalance(["Grass"]), -3);
  assert.equal(defensiveTypeBalance(["Normal"]), 0);
});

test("side-specific bulk remains observable without replacing balanced bulk", () => {
  const features = currentFormFeatures(
    profile({ currentId: "primarina", currentTypes: ["Water", "Fairy"] }),
    100,
  );

  assert.ok(features.special_bulk_q > features.physical_bulk_q);
  assert.ok(features.bulk_q < features.special_bulk_q);
  assert.equal(features.type_resilience_q, 0.625);
  assert.ok(features.effective_bulk_q > features.bulk_q);
});

test("neutral typing fixes effective bulk while favorable and vulnerable typing move it", () => {
  const neutral = currentFormFeatures(
    profile({ currentId: "tropius", currentTypes: ["Normal"] }),
    100,
  );
  const favorable = currentFormFeatures(
    profile({ currentId: "tropius", currentTypes: ["Water", "Fairy"] }),
    100,
  );
  const vulnerable = currentFormFeatures(
    profile({ currentId: "tropius", currentTypes: ["Grass", "Flying"] }),
    100,
  );

  assert.equal(neutral.type_resilience_q, 0.5);
  assert.equal(neutral.effective_bulk_q, neutral.bulk_q);
  assert.ok(favorable.effective_bulk_q > favorable.bulk_q);
  assert.ok(vulnerable.effective_bulk_q < vulnerable.bulk_q);
});

test("ordinary bulky roles consume effective rather than raw bulk", () => {
  const neutralProfile = profile({
    currentId: "tropius",
    currentTypes: ["Normal"],
  });
  const vulnerableProfile = {
    ...neutralProfile,
    currentTypes: ["Grass", "Flying"],
    recommendedMoves: [
      ...neutralProfile.recommendedMoves,
      {
        name: "Recover",
        category: "Status",
        estimatedDamage: 0,
        roles: ["recovery"],
        accuracy: 100,
      },
    ],
  };
  const neutral = currentFormValue(neutralProfile, 100);
  const vulnerable = currentFormValue(vulnerableProfile, 100);

  assert.ok(vulnerable.roles.bulky_attacker < neutral.roles.bulky_attacker);
  assert.ok(vulnerable.roles.bulky_utility > 0);
  assert.ok(
    vulnerable.roles.bulky_utility <
      currentFormValue(
        { ...vulnerableProfile, currentTypes: ["Normal"] },
        100,
      ).roles.bulky_utility,
  );
});

test("favorable typing can complete a genuinely strong one-sided bulky attacker", () => {
  const value = currentFormValue(
    profile({ currentId: "primarina", currentTypes: ["Water", "Fairy"] }),
    100,
  );

  assert.equal(value.bestRole, "specialist_bulky_attacker");
  assert.ok(value.value <= 2000);
});

test("the specialist route cannot exceed the common attacker ceiling", () => {
  const value = currentFormValue(
    profile({
      currentId: "aegislash",
      currentTypes: ["Steel", "Ghost"],
      damage: 400,
    }),
    100,
  );

  assert.equal(value.bestRole, "specialist_bulky_attacker");
  assert.equal(value.value, 2000);
});

test("one strong defensive side cannot overcome broadly vulnerable typing", () => {
  const value = currentFormValue(
    profile({ currentId: "sunflora", currentTypes: ["Grass"] }),
    100,
  );

  assert.notEqual(value.bestRole, "specialist_bulky_attacker");
});
