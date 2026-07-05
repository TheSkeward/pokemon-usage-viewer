// Phase 1 readiness (display-only): each canonical-set element maps to when
// it becomes assemblable. Blissey at badge 5 / cap 50 is the motivating case:
// Soft-Boiled is a level-16 level-up (ready), the Toxic TM is badge 13, and
// Seismic Toss is egg-only in Reborn AND level-scaling — so the set is not
// fully online until cap 100, definitionally.
import test from "node:test";
import assert from "node:assert/strict";
import { progressionAt } from "../helpers/harness.mjs";

const { loadRebornLegalMoveData, getAvailableRebornMoves } = await import(
  "../../src/reborn/legalMoves.js"
);
const { computeSetReadiness } = await import(
  "../../src/reborn/setReadiness.js"
);

const legalMoveData = await loadRebornLegalMoveData("blissey");

test("Blissey at badge 5: level-up ready, TM scheduled, egg-only Seismic Toss forces cap 100", () => {
  const progression = progressionAt({ badge: 5, levelCap: 50 });
  const availableMoves = getAvailableRebornMoves(legalMoveData, progression);
  const readiness = computeSetReadiness({
    legalMoveData,
    availableMoves,
    topSet: {
      item: "Eviolite",
      ability: "Natural Cure",
      moveUsage: new Map([
        ["softboiled", 99],
        ["seismictoss", 95],
        ["toxic", 90],
        ["chargebeam", 85],
      ]),
    },
    progression,
  });

  const byId = Object.fromEntries(readiness.moves.map((m) => [m.id, m]));
  assert.equal(byId.softboiled.status, "ready");
  assert.equal(byId.chargebeam.status, "ready"); // TM57 is badge 1
  assert.equal(byId.toxic.status, "later");
  assert.match(byId.toxic.detail, /@13 badges/);
  assert.equal(byId.seismictoss.status, "later");
  assert.match(byId.seismictoss.detail, /daycare/);

  assert.equal(readiness.readyMoveCount, 2);
  assert.equal(readiness.scaling, true, "Seismic Toss is level-scaling");
  assert.equal(readiness.fullAtCap, 100, "scaling move pins L* to 100");

  assert.equal(readiness.item.status, "later");
  assert.match(readiness.item.detail, /@9 badges/); // Eviolite: Agate Circus
  assert.equal(readiness.ability.status, "ready"); // abilities are always free
});

test("a set that is complete now (no scaling, everything obtainable) reads complete", () => {
  const progression = progressionAt({ badge: 5, levelCap: 50 });
  const availableMoves = getAvailableRebornMoves(legalMoveData, progression);
  const readiness = computeSetReadiness({
    legalMoveData,
    availableMoves,
    topSet: {
      item: null,
      ability: "Natural Cure",
      moveUsage: new Map([
        ["softboiled", 99],
        ["chargebeam", 85],
      ]),
    },
    progression,
  });

  assert.equal(readiness.readyMoveCount, 2);
  assert.equal(readiness.fullAtCap, null, "complete now");
  assert.equal(readiness.scaling, false);
});
