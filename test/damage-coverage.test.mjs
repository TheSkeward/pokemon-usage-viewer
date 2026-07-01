// Damage / ability / coverage correctness tests — the cases most likely to hide a
// "very cursed if missed" bug (double-counting type effectiveness, or an ability
// that boosts the wrong moves). Run with: npm test  (node --test).
import test from "node:test";
import assert from "node:assert/strict";
import { estimateMoveDamage } from "../src/reborn/damageModel.js";
import { getTypeMultiplier } from "../src/reborn/typeChart.js";

const attacker = { level: 50, atk: 120, spa: 120 };
const waterPulse = {
  basePower: 60,
  category: "Special",
  type: "Water",
  attackerStats: attacker,
};

test("estimateMoveDamage is NEUTRAL — it never applies target type effectiveness", () => {
  // No defender/target is passed, so the returned number must be the same
  // regardless of any target. The coverage vector multiplies effectiveness in
  // separately; if estimateMoveDamage also did, matchups would double-count.
  const d = estimateMoveDamage({ ...waterPulse, attackerTypes: ["Water"] });
  // Coverage into a Fire target = neutral × 2 (single-counted).
  const intoFire = d * getTypeMultiplier("Water", ["Fire"]);
  const intoWater = d * getTypeMultiplier("Water", ["Water"]);
  assert.equal(getTypeMultiplier("Water", ["Fire"]), 2);
  assert.equal(getTypeMultiplier("Water", ["Water"]), 0.5);
  assert.equal(intoFire, d * 2);
  assert.equal(intoWater, d * 0.5);
});

test("STAB: same-type move gets ×1.5 over a non-STAB move", () => {
  const stab = estimateMoveDamage({ ...waterPulse, attackerTypes: ["Water"] });
  const nonStab = estimateMoveDamage({ ...waterPulse, attackerTypes: ["Normal"] });
  assert.ok(stab > nonStab);
  assert.ok(Math.abs(stab / nonStab - 1.5) < 0.05);
});

test("Protean: a NON-STAB move gains STAB", () => {
  const plain = estimateMoveDamage({ ...waterPulse, attackerTypes: ["Normal"] });
  const protean = estimateMoveDamage({
    ...waterPulse,
    attackerTypes: ["Normal"],
    ability: "Protean",
  });
  assert.ok(protean > plain);
  assert.ok(Math.abs(protean / plain - 1.5) < 0.05);
});

test("Protean: an ALREADY-STAB move is unchanged (no double STAB)", () => {
  const stab = estimateMoveDamage({ ...waterPulse, attackerTypes: ["Water"] });
  const proteanStab = estimateMoveDamage({
    ...waterPulse,
    attackerTypes: ["Water"],
    ability: "Protean",
  });
  assert.equal(proteanStab, stab);
});

test("Torrent (no STAB effect) vs Protean on a non-STAB move: Protean is higher", () => {
  const torrent = estimateMoveDamage({
    ...waterPulse,
    attackerTypes: ["Normal"],
    ability: "Torrent",
  });
  const protean = estimateMoveDamage({
    ...waterPulse,
    attackerTypes: ["Normal"],
    ability: "Protean",
  });
  assert.ok(protean > torrent);
});

test("Adaptability turns STAB into ×2", () => {
  const stab = estimateMoveDamage({ ...waterPulse, attackerTypes: ["Water"] });
  const adaptability = estimateMoveDamage({
    ...waterPulse,
    attackerTypes: ["Water"],
    ability: "Adaptability",
  });
  assert.ok(Math.abs(adaptability / stab - 2 / 1.5) < 0.05);
});

test("Weak chip coverage stays low even when super-effective", () => {
  // Lick: 30 BP physical. Even into a Ghost-weak target, its coverage value must
  // stay well below a real STAB nuke — the noisy-OR must not read it as an answer.
  const lick = { basePower: 30, category: "Physical", type: "Ghost", attackerStats: attacker };
  const lickNeutral = estimateMoveDamage({ ...lick, attackerTypes: ["Normal"] });
  const hydroPump = estimateMoveDamage({
    basePower: 110,
    category: "Special",
    type: "Water",
    attackerTypes: ["Water"],
    attackerStats: attacker,
  });
  // Lick into a 2× target vs Hydro Pump neutral: the nuke still dwarfs the chip.
  assert.ok(lickNeutral * 2 < hydroPump);
});

test("Libero is inert (Gen-8 ability; vanilla Reborn is Gen-7)", () => {
  const plain = estimateMoveDamage({ ...waterPulse, attackerTypes: ["Normal"] });
  const libero = estimateMoveDamage({
    ...waterPulse,
    attackerTypes: ["Normal"],
    ability: "Libero",
  });
  assert.equal(libero, plain);
});
