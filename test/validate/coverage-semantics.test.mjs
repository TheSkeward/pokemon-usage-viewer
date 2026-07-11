// Fake-coverage semantics (roadmap Phase 2 category: "pool with one low-damage
// fake coverage mon"), pinned at the profile level where it is deterministic:
// a 30-BP Lick must not read as a meaningful Ghost answer, while a real
// super-effective STAB hit reads as a strong answer.
import test from "node:test";
import assert from "node:assert/strict";
import "../helpers/harness.mjs"; // installs fetch shim

const { loadRebornLegalMoveData, getAvailableRebornMoves } = await import(
  "../../src/reborn/legalMoves.js"
);
const { buildCandidateLegalityProfile, REBORN_ANALYSIS_TYPES } = await import(
  "../../src/reborn/teamAnalysis.js"
);
const { progressionAt } = await import("../helpers/harness.mjs");

function typeIndex(type) {
  return REBORN_ANALYSIS_TYPES.indexOf(type);
}

test("Frogadier at cap 25: Lick is not meaningful Ghost coverage; Water is a real answer", async () => {
  const legal = await loadRebornLegalMoveData("frogadier");
  const progression = progressionAt({ badge: 1, levelCap: 25 });
  const moves = getAvailableRebornMoves(legal, progression);
  const profile = buildCandidateLegalityProfile({
    member: {
      id: "frogadier",
      name: "Frogadier",
      inputName: "Froakie",
      representativeId: "greninja",
      types: legal.types,
    },
    moves,
    representativeName: "Greninja",
    levelCap: 25,
  });

  const vector = profile.coverageVector;
  assert.ok(vector, "profile must carry a coverage vector");

  const intoFire = vector[typeIndex("Fire")]; // Water Pulse hits 2x
  const intoGhost = vector[typeIndex("Ghost")]; // best is ~neutral Water or 30-BP Lick 2x

  assert.ok(intoFire > 0.55, `expected a strong Fire answer, got ${intoFire}`);
  assert.ok(
    intoGhost < intoFire * 0.75,
    `Ghost coverage (${intoGhost}) should be clearly below the real Fire answer (${intoFire}) — Lick must not read as an answer`,
  );
});

test("Focus Punch amortizes to 1/3 effective power (fail-if-disrupted, user report)", () => {
  // Focus Punch telegraphs at the start of the turn and FAILS if the user
  // takes damage before it resolves (priority -3) — but the dex encodes that
  // as a custom condition, not flags.charge, so it was priced as a clean
  // 150 BP hit, the strongest Fighting move in the model. It now takes the
  // exposed-charge 1/3 rule (Shell Trap likewise). Pinned via two otherwise
  // IDENTICAL 150 BP moves: only the id differs, so any damage gap is the
  // amortization. The base damage formula has a small additive constant, so
  // the ratio is near-3, not exactly 3.
  const member = { id: "breloom", name: "Breloom", types: ["Grass", "Fighting"] };
  const attackerStats = { level: 50, atk: 130, spa: 60 };
  const asProfile = (id, name) =>
    buildCandidateLegalityProfile({
      member,
      moves: [
        {
          id,
          name,
          type: "Fighting",
          category: "Physical",
          basePower: 150,
          accuracy: 100,
          priority: id === "focuspunch" ? -3 : 0,
          availableSources: [],
        },
      ],
      representativeName: "Breloom",
      attackerStats,
      levelCap: 50,
    });

  const punch = asProfile("focuspunch", "Focus Punch").recommendedMoves[0];
  const clean = asProfile("brickbreak", "Brick Break").recommendedMoves[0];
  assert.ok(punch && clean, "both moves must be recommended (sole attack)");
  const ratio = clean.estimatedDamage / punch.estimatedDamage;
  assert.ok(
    ratio > 2.6 && ratio < 3.4,
    `Focus Punch must deal ~1/3 of an equivalent clean 150 BP hit, got ratio ${ratio}`,
  );
});

test("leaky-dodge charges amortize to 2/3; no-punch-through charges keep full power", () => {
  // User ruling: Fly/Bounce/Dig/Dive dodge SOME attacks during their charge
  // turn but are punched through at 2x (Gust into Bounce, Earthquake into
  // Dig...) and telegraph a free turn — dodge turn worth half a turn, so
  // (2·½ + 1)/3 = 2/3. Phantom Force/Shadow Force vanish outright and Sky
  // Drop steals the target's turn — no punch-through, full power. Pinned via
  // otherwise-identical synthetic 100 BP charge moves.
  const member = { id: "golurk", name: "Golurk", types: ["Ground", "Ghost"] };
  const attackerStats = { level: 50, atk: 120, spa: 60 };
  const damageOf = (id, name) =>
    buildCandidateLegalityProfile({
      member,
      moves: [
        {
          id,
          name,
          type: "Ground",
          category: "Physical",
          basePower: 100,
          accuracy: 100,
          priority: 0,
          charge: true,
          availableSources: [],
        },
      ],
      representativeName: "Golurk",
      attackerStats,
      levelCap: 50,
    }).recommendedMoves[0].estimatedDamage;

  const dig = damageOf("dig", "Dig");
  const phantom = damageOf("phantomforce", "Phantom Force");
  const exposed = damageOf("boltbeam", "Hypothetical Exposed Charge");

  const digRatio = phantom / dig;
  assert.ok(
    digRatio > 1.4 && digRatio < 1.6,
    `Dig must deal ~2/3 of a no-punch-through charge move, got ratio ${digRatio}`,
  );
  const exposedRatio = phantom / exposed;
  assert.ok(
    exposedRatio > 2.6 && exposedRatio < 3.4,
    `an exposed charge must still amortize to 1/3, got ratio ${exposedRatio}`,
  );
});
