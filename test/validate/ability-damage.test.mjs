// The ability damage layer (user report: "abilities aren't really factoring
// into the damage calculations. And some of them absolutely should!").
// Each rule is pinned at the profile level with synthetic moves that differ
// ONLY in the property the ability keys on, so any damage gap is the ability.
// The model prices a typical unconditioned turn: battle-state-conditional
// abilities (Guts, Blaze-family pinch boosts, weather boosts, Analytic,
// Tinted Lens) are deliberately NOT modeled and must change nothing.
import test from "node:test";
import assert from "node:assert/strict";
import "../helpers/harness.mjs"; // installs fetch shim

const { buildCandidateLegalityProfile, REBORN_ANALYSIS_TYPES } = await import(
  "../../src/reborn/teamAnalysis.js"
);
const { getAbilityDamageMultiplier, getAbilityEffectiveMoveType } =
  await import("../../src/reborn/damageModel.js");

// One synthetic damaging move through the profile pipeline; returns its
// recommended-move entry (estimatedDamage folds in stats/STAB/ability).
function moveDamage({ member, ability, move, attackerStats }) {
  const profile = buildCandidateLegalityProfile({
    member,
    moves: [
      {
        accuracy: 100,
        availableSources: [],
        priority: 0,
        ...move,
      },
    ],
    representativeName: member.name,
    ability,
    attackerStats,
    levelCap: attackerStats.level,
  });
  return profile.recommendedMoves[0];
}

test("Huge Power doubles physical damage and leaves special untouched", () => {
  const member = { id: "azumarill", name: "Azumarill", types: ["Water", "Fairy"] };
  const attackerStats = { level: 50, atk: 100, spa: 100 };
  const of = (ability, category) =>
    moveDamage({
      member,
      ability,
      attackerStats,
      move: {
        id: category === "Physical" ? "waterfall" : "surf",
        name: category === "Physical" ? "Waterfall" : "Surf",
        type: "Water",
        category,
        basePower: 90,
      },
    }).estimatedDamage;

  const physRatio = of("Huge Power", "Physical") / of(null, "Physical");
  assert.ok(
    physRatio > 1.9 && physRatio < 2.1,
    `Huge Power must ~double a physical hit, got ${physRatio}`,
  );
  assert.equal(
    of("Huge Power", "Special"),
    of(null, "Special"),
    "Huge Power must not touch special damage",
  );
});

test("Technician boosts ≤60 BP per-hit power only, including multi-hit per-hit BP", () => {
  const member = { id: "scizor", name: "Scizor", types: ["Bug", "Steel"] };
  const attackerStats = { level: 50, atk: 130, spa: 55 };
  const of = (ability, move) =>
    moveDamage({ member, ability, attackerStats, move }).estimatedDamage;

  const sixty = { id: "aerialace", name: "Aerial Ace", type: "Flying", category: "Physical", basePower: 60 };
  const boosted = of("Technician", sixty) / of(null, sixty);
  assert.ok(boosted > 1.4 && boosted < 1.6, `60 BP must gain ~1.5x, got ${boosted}`);

  const sixtyFive = { ...sixty, id: "strength", name: "Strength", basePower: 65 };
  assert.equal(of("Technician", sixtyFive), of(null, sixtyFive), "65 BP is over the gate");

  // Bullet Seed: 25 BP per hit — the Technician gate reads PER-HIT power,
  // not the 3.1-expected-hits effective figure (25 × 3.1 = 77.5 > 60).
  const bulletSeed = { id: "bulletseed", name: "Bullet Seed", type: "Grass", category: "Physical", basePower: 25, multihit: [2, 5] };
  const multi = of("Technician", bulletSeed) / of(null, bulletSeed);
  assert.ok(multi > 1.4 && multi < 1.6, `multi-hit per-hit BP must qualify, got ${multi}`);
});

test("Skill Link lands the maximum multi-hit count (5/3.1 over the expected roll)", () => {
  const member = { id: "cloyster", name: "Cloyster", types: ["Water", "Ice"] };
  const attackerStats = { level: 50, atk: 95, spa: 85 };
  const spear = { id: "iciclespear", name: "Icicle Spear", type: "Ice", category: "Physical", basePower: 25, multihit: [2, 5] };
  const of = (ability) =>
    moveDamage({ member, ability, attackerStats, move: spear }).estimatedDamage;
  const ratio = of("Skill Link") / of(null);
  assert.ok(
    ratio > 1.5 && ratio < 1.75, // 5 / 3.1 ≈ 1.61
    `Skill Link must land 5 hits vs the 3.1 expectation, got ${ratio}`,
  );
});

test("Sheer Force boosts secondary-carrying moves only", () => {
  const member = { id: "nidoking", name: "Nidoking", types: ["Poison", "Ground"] };
  const attackerStats = { level: 50, atk: 102, spa: 85 };
  const of = (ability, move) =>
    moveDamage({ member, ability, attackerStats, move }).estimatedDamage;

  const rockSlide = { id: "rockslide", name: "Rock Slide", type: "Rock", category: "Physical", basePower: 75, flags: { secondary: 1 } };
  const ratio = of("Sheer Force", rockSlide) / of(null, rockSlide);
  assert.ok(ratio > 1.2 && ratio < 1.4, `secondary-carrying move must gain ~1.3x, got ${ratio}`);

  const earthquake = { id: "earthquake", name: "Earthquake", type: "Ground", category: "Physical", basePower: 100, flags: {} };
  assert.equal(of("Sheer Force", earthquake), of(null, earthquake), "clean moves gain nothing");
});

test("Tough Claws boosts contact moves only", () => {
  const member = { id: "charizardmegax", name: "Charizard-Mega-X", types: ["Fire", "Dragon"] };
  const attackerStats = { level: 50, atk: 130, spa: 100 };
  const of = (ability, move) =>
    moveDamage({ member, ability, attackerStats, move }).estimatedDamage;

  const claw = { id: "dragonclaw", name: "Dragon Claw", type: "Dragon", category: "Physical", basePower: 80, flags: { contact: 1 } };
  const ratio = of("Tough Claws", claw) / of(null, claw);
  assert.ok(ratio > 1.2 && ratio < 1.4, `contact must gain ~1.3x, got ${ratio}`);

  const rockSlide = { id: "rockslide", name: "Rock Slide", type: "Rock", category: "Physical", basePower: 75, flags: { secondary: 1 } };
  assert.equal(of("Tough Claws", rockSlide), of(null, rockSlide), "non-contact gains nothing");
});

test("Aerilate converts Normal moves to Flying: STAB, 1.2x, and real Ghost coverage", () => {
  const member = { id: "salamencemega", name: "Salamence-Mega", types: ["Dragon", "Flying"] };
  const attackerStats = { level: 50, atk: 145, spa: 120 };
  const ret = { id: "return", name: "Return", type: "Normal", category: "Physical", basePower: 102, flags: { contact: 1 } };

  const plain = moveDamage({ member, ability: null, attackerStats, move: ret });
  const ate = moveDamage({ member, ability: "Aerilate", attackerStats, move: ret });

  // Type conversion is visible on the decorated move itself.
  assert.equal(ate.type, "Flying", "decorated move must carry the converted type");
  // 1.2 (-ate) × 1.5 (new STAB — Salamence is Flying; plain Return had none).
  const ratio = ate.estimatedDamage / plain.estimatedDamage;
  assert.ok(ratio > 1.7 && ratio < 1.9, `expected ~1.8x (1.2 × STAB), got ${ratio}`);

  // Coverage: Normal Return contributes NOTHING into Ghost; Flying Return does.
  const ghost = REBORN_ANALYSIS_TYPES.indexOf("Ghost");
  const profileOf = (ability) =>
    buildCandidateLegalityProfile({
      member,
      moves: [{ ...ret, accuracy: 100, availableSources: [], priority: 0 }],
      representativeName: member.name,
      ability,
      attackerStats,
      levelCap: 50,
    });
  assert.equal(profileOf(null).coverageVector[ghost], 0, "Normal Return can't touch Ghost");
  assert.ok(
    profileOf("Aerilate").coverageVector[ghost] > 0.3,
    "Aerilate Return must be real Ghost coverage",
  );
});

test("battle-state-conditional abilities change nothing (typical-turn pricing)", () => {
  const member = { id: "conkeldurr", name: "Conkeldurr", types: ["Fighting"] };
  const attackerStats = { level: 50, atk: 140, spa: 55 };
  const punch = { id: "drainpunch", name: "Drain Punch", type: "Fighting", category: "Physical", basePower: 75, flags: { contact: 1, punch: 1 } };
  const of = (ability) =>
    moveDamage({ member, ability, attackerStats, move: punch }).estimatedDamage;
  for (const ability of ["Guts", "Blaze", "Sand Force", "Analytic", "Tinted Lens"]) {
    assert.equal(of(ability), of(null), `${ability} must not enter the estimate`);
  }
  // ...while Iron Fist (move-property-keyed) does.
  assert.ok(of("Iron Fist") > of(null), "Iron Fist must boost a punch move");
});

test("multiplier/conversion helpers are idempotent over decorated moves", () => {
  // decorateMove stamps the converted type and preserves rawType; feeding the
  // decorated shape back through the helpers must not double-apply anything.
  const raw = { id: "return", type: "Normal", category: "Physical", basePower: 102, flags: { contact: 1 } };
  const decorated = { ...raw, type: "Fairy", rawType: "Normal" };
  assert.equal(getAbilityEffectiveMoveType("Pixilate", decorated), "Fairy");
  assert.equal(
    getAbilityDamageMultiplier("Pixilate", decorated),
    getAbilityDamageMultiplier("Pixilate", raw),
  );
  // And a genuinely-Fairy move under Pixilate gets no -ate boost.
  const moonblast = { id: "moonblast", type: "Fairy", category: "Special", basePower: 95 };
  assert.equal(getAbilityDamageMultiplier("Pixilate", moonblast), 1);
});
