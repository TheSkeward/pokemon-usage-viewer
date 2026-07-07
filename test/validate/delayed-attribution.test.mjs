// User report: Slaking's set said "requires delayed evolution" on both Focus
// Punch and Play Rough — hiding that they delay DIFFERENT evolutions (Focus
// Punch is Vigoroth@37: delay Vigoroth→Slaking past 36; Play Rough is
// Slakoth@38: delay Slakoth→Vigoroth past 18). Pre-evo level-up entries now
// carry their ancestor, each level is judged against THAT form's own natural
// departure, and the label names the form being kept unevolved.
import test from "node:test";
import assert from "node:assert/strict";
// Side effect: installs the fetch/env/localStorage shims the app modules need.
import "../helpers/harness.mjs";

const { getAvailableRebornMoves, loadRebornLegalMoveData } = await import(
  "../../src/reborn/legalMoves.js"
);

test("delayed moves name the form being kept unevolved (Slaking chain)", async () => {
  const data = await loadRebornLegalMoveData("slaking");
  const moves = getAvailableRebornMoves(data, { levelCap: "40" });
  const label = (id) =>
    moves.find((m) => m.id === id)?.availableSources?.[0]?.label || "";

  assert.equal(label("focuspunch"), "Level 37 (Vigoroth)");
  assert.equal(label("playrough"), "Level 38 (Slakoth)");
  assert.ok(moves.find((m) => m.id === "focuspunch")?.delayedEvolution);
  assert.ok(moves.find((m) => m.id === "playrough")?.delayedEvolution);
});

test("a level is judged against ITS ancestor's departure, not the direct pre-evo's", async () => {
  // Chip Away: Slakoth@25 (needs delaying Slakoth past 18) and Vigoroth/
  // Slaking@27 (natural). The old merged list judged 25 against Vigoroth's
  // departure (36) and displayed a false natural "Level 25".
  const data = await loadRebornLegalMoveData("slaking");
  const moves = getAvailableRebornMoves(data, { levelCap: "40" });
  const chipAway = moves.find((m) => m.id === "chipaway");
  assert.equal(chipAway?.availableSources?.[0]?.label, "Level 27");
  assert.ok(!chipAway?.delayedEvolution);
});

test("elective hops (stones/trades) gate EVERY pre-evo move (Musharna report)", async () => {
  // Musharna (Munna + Moon Stone) learns almost nothing itself; Munna's
  // Moonlight@17 / Calm Mind@35 / Psychic@37 are classic stone-gated moves —
  // the default evolve-ASAP path never has them.
  const data = await loadRebornLegalMoveData("musharna");
  const moves = getAvailableRebornMoves(data, { levelCap: "40" });
  for (const id of ["moonlight", "calmmind", "psychic"]) {
    const move = moves.find((m) => m.id === id);
    assert.ok(move?.delayedEvolution, `${id} should be delayed-gated`);
    assert.match(move.availableSources[0].label, /^Level \d+ \(Munna\)$/);
  }
});

test("elective hops don't gate moves the form knows at ARRIVAL", async () => {
  // Munna hatches knowing Psywave/Defense Curl; stoning it immediately keeps
  // them — zero delay, so no delayed-evolution flag (the old empty [1, 0]
  // window priced every stone-line hatch move as delayed friction).
  const data = await loadRebornLegalMoveData("musharna");
  const moves = getAvailableRebornMoves(data, { levelCap: "40" });
  for (const id of ["psywave", "defensecurl"]) {
    const move = moves.find((m) => m.id === id);
    assert.equal(move?.availableSources?.[0]?.label, "Level 1", id);
    assert.ok(!move?.delayedEvolution, `${id} needs no delay`);
  }
});

test("an evolved form's own level-1 relist is relearner-teachable regardless of pre-evo entries", async () => {
  // Honchkrow's signature Sucker Punch: own learnset [1], Murkrow@55. At cap
  // 50 the Murkrow route is out of reach — the level-1 relist must still be
  // teachable via the relearner (it used to vanish entirely: the relearner
  // rule required NO pre-evolution entries).
  const data = await loadRebornLegalMoveData("honchkrow");
  const withRelearner = getAvailableRebornMoves(data, {
    levelCap: "50",
    moveRelearnerUnlocked: true,
  });
  const suckerPunch = withRelearner.find((m) => m.id === "suckerpunch");
  assert.ok(
    suckerPunch?.availableSources?.some((s) => s.kind === "relearner"),
    "Sucker Punch must have a relearner source at cap 50",
  );
  const withoutRelearner = getAvailableRebornMoves(data, {
    levelCap: "50",
    moveRelearnerUnlocked: false,
  });
  assert.ok(
    !withoutRelearner.some((m) => m.id === "suckerpunch"),
    "and no source at all without the relearner",
  );
});

test("friendship hops stay natural (the grind spans levels)", async () => {
  // Azumarill: Azurill evolves by friendship, so Azurill's level-up moves
  // are reachable on the natural path; Marill departs at a LEVEL (18), so
  // its later moves gate normally.
  const data = await loadRebornLegalMoveData("azumarill");
  const moves = getAvailableRebornMoves(data, { levelCap: "40" });
  const anyDelayedFromAzurill = moves.some(
    (m) =>
      m.delayedEvolution && /Azurill/.test(m.availableSources[0]?.label || ""),
  );
  assert.ok(!anyDelayedFromAzurill, "no Azurill move should be delay-gated");
});
