// Variable-power moves priced against the reference defender (user ask:
// "for the damage calculation of Electro Ball and similar moves, I want to
// make sure that the reference defender has the median speed for the level
// ... make sure that we're doing that for other moves that care about the
// target's stats"). The dex reports base power 0 for the whole family, which
// priced them at zero and excluded them from attack lists entirely; Foul
// Play used the USER's Attack where the game uses the target's.
import test from "node:test";
import assert from "node:assert/strict";
import "../helpers/harness.mjs"; // installs fetch shim

const { estimateMoveDamage, variableMovePower, isVariablePowerMove } =
  await import("../../src/reborn/damageModel.js");
const { buildCandidateLegalityProfile } = await import(
  "../../src/reborn/teamAnalysis.js"
);

test("speed-scaled: Electro Ball rewards fast users, Gyro Ball slow ones", () => {
  // Against the MEDIAN-speed reference defender (base 70, uninvested: 90 at
  // L50), even invested base-150 Electrode is only a 2.2x ratio — 80 BP is
  // the honest bucket, not the 150 the move shows against slow targets.
  assert.equal(variableMovePower("electroball", 50, "electrode"), 80);
  assert.equal(variableMovePower("electroball", 50, "pikachu"), 60); // 1.6x
  assert.equal(variableMovePower("electroball", 50, "snorlax"), 40); // 0.9x

  // Gyro Ball inverts: uninvested Ferroseed (base 10 → 30 at L50) vs the
  // 90-speed reference is 25×90/30+1 = 76 BP; Electrode bottoms out.
  assert.equal(variableMovePower("gyroball", 50, "ferroseed"), 76);
  assert.equal(variableMovePower("gyroball", 50, "electrode"), 14);
});

test("weight-scaled: buckets against the median-weight reference defender", () => {
  // Median dex weight is ~30 kg → the 25–50 kg bucket (60 BP) for Grass
  // Knot / Low Kick, identical for every attacker (target-only formula).
  assert.equal(variableMovePower("grassknot", 50, "pikachu"), 60);
  assert.equal(
    variableMovePower("lowkick", 50, "machamp"),
    variableMovePower("grassknot", 50, "pikachu"),
  );
  // Heavy Slam reads the RATIO: Snorlax (460 kg) maxes it; Pikachu (6 kg)
  // bottoms out.
  assert.equal(variableMovePower("heavyslam", 50, "snorlax"), 120);
  assert.equal(variableMovePower("heavyslam", 50, "pikachu"), 40);
});

test("state-scaled moves take the typical-turn assumptions", () => {
  assert.equal(variableMovePower("crushgrip", 50, "regigigas"), 120); // full-HP target
  assert.equal(variableMovePower("flail", 50, "magikarp"), 20); // full-HP user
  assert.equal(variableMovePower("punishment", 50, "liepard"), 60); // unboosted target
  assert.equal(variableMovePower("magnitude", 50, "dugtrio"), 71); // expected value
  assert.equal(variableMovePower("tackle", 50, "rattata"), null); // family only
  assert.ok(isVariablePowerMove("electroball"));
  assert.ok(!isVariablePowerMove("tackle"));
});

test("Foul Play prices off the reference defender's Attack, not the user's", () => {
  const of = (atk) =>
    estimateMoveDamage({
      moveId: "foulplay",
      basePower: 95,
      category: "Physical",
      type: "Dark",
      attackerTypes: ["Dark"],
      attackerStats: { level: 50, atk, spa: 60 },
    });
  // Identical estimates regardless of the user's own Attack stat.
  assert.equal(of(40), of(180));
  assert.ok(of(40) > 0);
});

test("Electro Ball is a real recommended attack end-to-end", () => {
  // A fast Electric mon whose ONLY damaging option is Electro Ball must
  // recommend it with a non-zero estimate (it was previously priced at zero
  // and excluded from the attack list entirely).
  const profile = buildCandidateLegalityProfile({
    member: { id: "electrode", name: "Electrode", types: ["Electric"] },
    moves: [
      {
        id: "electroball",
        name: "Electro Ball",
        type: "Electric",
        category: "Special",
        basePower: 0,
        accuracy: 100,
        priority: 0,
        availableSources: [],
      },
    ],
    representativeName: "Electrode",
    attackerStats: { level: 50, atk: 60, spa: 90 },
    levelCap: 50,
  });
  const ball = profile.recommendedMoves.find((m) => m.id === "electroball");
  assert.ok(ball, "Electro Ball must be recommended");
  assert.ok(
    ball.estimatedDamage > 50,
    `resolved 150 BP STAB must estimate real damage, got ${ball.estimatedDamage}`,
  );
});
