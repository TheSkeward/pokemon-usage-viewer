// Usage-convergence blend invariants (formerly SCORING_V1, the sole model
// since V0's retirement — these run at plain defaults).
//
// User-ratified design under test:
//   - U_rank = TIER_STEP·tierIndex + quantize(usage%) + ε·C: a shallower
//     first-meaningful tier ALWAYS dominates within-tier usage, and ε·C can
//     NEVER override a real (quantized) usage difference — provable from the
//     constants, asserted here.
//   - w = max(α·O, O_rep·min((cap/L*)², r_now)); w is monotone in cap at a
//     fixed unlock schedule.
//   - THE TWO-CLAUSE CONVERGENCE LAW (replaced the old "at w = 1 the score
//     IS the prior" pairwise-order law; the calibration corpus's Meowstic
//     trajectory — C 1543 dragged to its 587 prior — is the measured
//     counterexample that killed it):
//       ABSENCE law: a DEAD line (no meaningful usage in any tier)
//         converges fully — at w = 1 its score collapses to its ~zero prior
//         regardless of C.
//       BOUNDED-TRUST law: a line with a real prior anywhere retains at
//         least (1 − PRIOR_DRAG_CAP)·C at every w; upward convergence stays
//         full trust (a line whose prior exceeds C converges up to it).
//     Team COMPOSITION stays coverage-driven — deliberately not asserted.
//   - A fielded form that is not the line's usage representative never ramps.
import test from "node:test";
import assert from "node:assert/strict";
import { runPool, bestChoice } from "../helpers/harness.mjs";
import { progressionAt } from "../helpers/harness.mjs";
import {
  SCORING_DEFAULTS,
} from "../../src/teamBuilder/scoringConstants.js";
import { usageRankScore } from "../../src/teamBuilder/candidateScoring.js";

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

test("absence law: converged dead lines collapse to their ~zero prior", async () => {
  // Sunflora and Ledian: no form of either line has ever cleared the trace
  // bar in any tier. At cap 100 with everything unlocked their sets are
  // fully assembled (w = 1) — the score must collapse toward the empty
  // prior even though the mechanical C stays substantial. (This is the
  // behavior that keeps Unown/Raticate-class verdicts honest.)
  // Delibird would be the natural third pin but its trace-sourced canonical
  // set is unassemblable in Reborn (0/4 moves ready even at badge 18), so
  // its ramp never engages — a known follow-up finding.
  const result = await runPool({
    pool: ["Ledian", "Sunflora", "Arcanine"],
    progression: {
      ...progressionAt({ badge: 18, levelCap: 100 }),
      daycareUnlocked: true,
      moveRelearnerUnlocked: true,
    },
  });
  for (const name of ["Ledian", "Sunflora"]) {
    const choice = bestChoice(result, name);
    assert.ok(choice, `${name} must resolve`);
    assert.equal(choice.usageWeight, 1, `${name} must be fully converged`);
    assert.ok(
      choice.legalityScore > 500,
      `${name}'s mechanical C must be substantial (got ${Math.round(choice.legalityScore)}) — otherwise this test proves nothing`,
    );
    assert.ok(
      choice.score < 0.15 * choice.legalityScore,
      `${name} converged must collapse toward its empty prior: score ${Math.round(choice.score)} vs C ${Math.round(choice.legalityScore)}`,
    );
  }
});

test("bounded-trust law: a converged present-prior line retains (1 − cap)·C", async () => {
  // Meowstic — THE counterexample that killed the old law: real (deep) PvP
  // presence, consensus-cracked in PvE, C ≈ 1500 at high caps. However
  // converged, the prior may claim at most PRIOR_DRAG_CAP of the excess.
  const result = await runPool({
    pool: ["Meowstic", "Arcanine", "Delibird"],
    progression: {
      ...progressionAt({ badge: 18, levelCap: 100 }),
      daycareUnlocked: true,
      moveRelearnerUnlocked: true,
    },
  });
  const meowstic = bestChoice(result, "Meowstic");
  assert.ok(meowstic);
  assert.ok(
    meowstic.usageWeight > 0.5,
    `Meowstic should be well-converged at cap 100 (w ${meowstic.usageWeight})`,
  );
  const floor =
    (1 - SCORING_DEFAULTS.PRIOR_DRAG_CAP) * meowstic.legalityScore;
  assert.ok(
    meowstic.score >= floor - 1e-6,
    `bounded trust must hold: score ${Math.round(meowstic.score)} >= (1 − cap)·C = ${Math.round(floor)}`,
  );
});

test("upward convergence stays full trust: a prior above C converges up to it", async () => {
  // Aegislash at cap 100: top-tier prior far above its measured C
  // (C ≈ 1370, prior ≈ 1900). The bounded-trust cap applies DOWNWARD only —
  // the lift must still carry the converged score well above C.
  // (Arcanine is deliberately NOT the subject: its prior sits BELOW its C,
  // so it demonstrates the bounded drag instead — score ≈ C − cap·gap.)
  const result = await runPool({
    pool: ["Aegislash", "Sunflora"],
    progression: {
      ...progressionAt({ badge: 18, levelCap: 100 }),
      daycareUnlocked: true,
      moveRelearnerUnlocked: true,
    },
  });
  const aegislash = bestChoice(result, "Aegislash");
  assert.ok(aegislash);
  assert.equal(aegislash.usageWeight, 1, "Aegislash must be fully converged");
  assert.ok(
    aegislash.score > aegislash.legalityScore + 200,
    `a converged famous line must score well ABOVE its mechanical C: ${Math.round(aegislash.score)} vs C ${Math.round(aegislash.legalityScore)}`,
  );
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
  // representative, so it must keep the upside-only α·O treatment (usageWeight 0).
  const result = await runPool({
    pool: ["Dratini", "Rattata", "Pidgey"],
    badge: 1,
    levelCap: 20,
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

