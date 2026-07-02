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
