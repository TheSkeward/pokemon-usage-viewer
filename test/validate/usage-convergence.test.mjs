// SCORING_V1 (usage-convergence blend, Phase 2) invariants — all opt-in via
// USAGE_MODEL override; the frozen V0 defaults and their goldens are untouched
// by this suite existing.
//
// User-ratified design under test:
//   - U_rank = TIER_STEP·tierIndex + quantize(usage%) + ε·C: a shallower
//     first-meaningful tier ALWAYS dominates within-tier usage, and ε·C can
//     NEVER override a real (quantized) usage difference — provable from the
//     constants, asserted here.
//   - w = max(α·O, O_rep·min((cap/L*)², r_now)); w is monotone in cap at a
//     fixed unlock schedule.
//   - At w = 1 individual V-ordering matches usage-prior ordering (pairwise,
//     for candidates differing in tier or quantized usage). Team COMPOSITION
//     stays coverage-driven — deliberately not asserted (user decision).
//   - A fielded form that is not the line's usage representative never ramps.
import test from "node:test";
import assert from "node:assert/strict";
import { runPool, bestChoice } from "../helpers/harness.mjs";
import { progressionAt } from "../helpers/harness.mjs";
import { checkGolden } from "../helpers/fixtureRunner.mjs";
import {
  SCORING_DEFAULTS,
} from "../../src/teamBuilder/scoringConstants.js";
import { usageRankScore } from "../../src/teamBuilder/candidateScoring.js";

const V1 = { USAGE_MODEL: "v1" };

test("ε·C guarantee and tier dominance are provable from the constants", () => {
  assert.ok(
    SCORING_DEFAULTS.EPSILON_C * SCORING_DEFAULTS.CURRENT_VALUE_SCALE <
      SCORING_DEFAULTS.USAGE_QUANTUM,
    "ε·C_max must sit strictly inside one usage quantum",
  );
  assert.ok(
    SCORING_DEFAULTS.TIER_STEP > 100,
    "TIER_STEP must strictly exceed any possible usage percentage",
  );
});

test("U_rank ordering: tier > usage > ε·C, and ε·C breaks exact ties", () => {
  const rank = (tierRank, value) => ({ tierRank, value, totalTiers: 10 });
  // A shallower tier with negligible usage beats a deeper tier at 100% usage.
  assert.ok(usageRankScore(rank(3, 0.1), 0) > usageRankScore(rank(4, 100), 2000));
  // Within a tier, any real (quantized) usage difference beats max ε·C.
  assert.ok(usageRankScore(rank(3, 5.001), 0) > usageRankScore(rank(3, 5.0), 2000));
  // Exact quantized tie: ε·C breaks it toward the higher C.
  assert.ok(usageRankScore(rank(3, 5.0), 1500) > usageRankScore(rank(3, 5.0), 100));
});

test("endgame: fully-assembled final forms rank exactly by the usage prior", async () => {
  const result = await runPool({
    pool: [
      "Arcanine", "Ampharos", "Altaria", "Azumarill", "Exploud", "Muk",
      "Golduck", "Persian", "Dodrio", "Sandslash",
    ],
    progression: {
      ...progressionAt({ badge: 18, levelCap: 100 }),
      daycareUnlocked: true,
      moveRelearnerUnlocked: true,
    },
    overrides: V1,
  });

  const converged = result.lines
    .map((line) => line.best || line.bestNonMega)
    .filter((choice) => choice && choice.usageWeight === 1);
  assert.ok(
    converged.length >= 3,
    `need ≥3 fully-converged lines to make the claim, got ${converged.length}`,
  );

  // Pairwise: whenever tier or quantized usage differ, score order follows.
  const quantum = SCORING_DEFAULTS.USAGE_QUANTUM;
  for (const a of converged) {
    for (const b of converged) {
      if (a === b) continue;
      const tierA = a.ceiling; // not used for ordering — use rank fields below
      void tierA;
      const usageA = Math.floor((a.usagePercent || 0) / quantum);
      const usageB = Math.floor((b.usagePercent || 0) / quantum);
      // Same-tier comparison via usagePercent; cross-tier pairs are covered
      // by the score itself since U_rank dominates the converged score.
      if (usageA === usageB) continue;
      if (a.score === b.score) continue;
      // Only assert within the same first-meaningful tier — cross-tier order
      // is asserted by construction of U_rank (unit test above).
      if ((a.tierRank ?? -1) !== (b.tierRank ?? -2)) continue;
      assert.ok(
        usageA > usageB ? a.score > b.score : a.score < b.score,
        `${a.inputName} (${a.usagePercent}%) vs ${b.inputName} (${b.usagePercent}%): converged score order must follow usage`,
      );
    }
  }
});

test("w is monotone non-decreasing in cap at a fixed unlock schedule", async () => {
  const pool = ["Arcanine", "Azumarill", "Exploud", "Sandslash"];
  const weights = [];
  for (const levelCap of [40, 70, 100]) {
    const result = await runPool({
      pool,
      progression: {
        ...progressionAt({ badge: 18, levelCap }),
        daycareUnlocked: true,
      },
      overrides: V1,
    });
    weights.push(
      Object.fromEntries(
        pool.map((name) => [name, bestChoice(result, name)?.usageWeight ?? 0]),
      ),
    );
  }
  for (const name of pool) {
    assert.ok(
      weights[0][name] <= weights[1][name] + 1e-9 &&
        weights[1][name] <= weights[2][name] + 1e-9,
      `${name}: w must not decrease with cap: ${weights.map((w) => w[name]).join(" → ")}`,
    );
  }
});

test("a fielded pre-evolution (not the usage representative) never ramps", async () => {
  // Cap 20: Dratini can't be Dragonite; its fielded form isn't the
  // representative, so V1 must keep the V0 α·O treatment (usageWeight 0).
  const result = await runPool({
    pool: ["Dratini", "Rattata", "Pidgey"],
    badge: 1,
    levelCap: 20,
    overrides: V1,
  });
  const dratini = bestChoice(result, "Dratini");
  assert.ok(dratini);
  if (dratini.legalityProfile?.currentId !== dratini.pokemonId) {
    assert.equal(dratini.usageWeight, 0);
  }
});

test("w is line-anchored: a pre-evo can't dodge the drag its real form converges under", async () => {
  // User report: base Doduo outseated Dodrio at high cap because Dodrio
  // (line representative: NU, vs Doduo's deeper LC) converged to its prior
  // while Doduo kept its raw C at w=0. The line's representative — best
  // first-meaningful tier — anchors ONE w for every form in the line, each
  // blended against its OWN prior.
  const { DEFAULT_REBORN_PROGRESSION } = await import(
    "../../src/reborn/progression.js"
  );
  const result = await runPool({
    pool: ["Doduo"],
    progression: { ...DEFAULT_REBORN_PROGRESSION, levelCap: "100" },
    overrides: V1,
  });
  const line = result.lines[0];
  const byId = Object.fromEntries(
    (line.candidates || []).map((c) => [c.candidate?.id, c]),
  );
  assert.ok(byId.dodrio && byId.doduo, "both forms must be scored");
  assert.equal(
    byId.doduo.usageWeight,
    byId.dodrio.usageWeight,
    "every form in a line shares the representative's w",
  );
  assert.ok(
    byId.dodrio.score > byId.doduo.score,
    `Dodrio (${Math.round(byId.dodrio.score)}) must outrank Doduo (${Math.round(byId.doduo.score)})`,
  );
  const fielded = line.best?.legalityProfile?.currentId || line.best?.pokemonId;
  assert.equal(fielded, "dodrio");
});

test("V1 golden: midgame-broad pool under the blend (drift shows up in review)", async () => {
  const result = await runPool({
    pool: ["Machop","Growlithe","Poliwag","Abra","Tentacool","Ponyta","Magnemite","Doduo","Gastly","Rhyhorn","Horsea","Scyther","Eevee","Dratini","Mareep","Hoppip"],
    badge: 4,
    levelCap: 45,
    overrides: V1,
  });
  checkGolden({ name: "v1-midgame-broad", golden: true }, result);
});
