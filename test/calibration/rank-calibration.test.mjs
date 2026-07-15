// Rank calibration against community consensus (user plan, 2026-07): the
// fixture corpus constrained the usage floor only from ABOVE — nothing
// required a famous mon to score well. This suite is the missing lower
// bound, and its pools are the real per-badge availability buckets
// (test/calibration/badge-buckets.json) instead of hand-picked scenarios.
//
//   - AMAZING mons ("universally agreed to be utterly cracked") are injected
//     into EVERY bucket as their evolved forms — inputting "Excadrill" means
//     the player OWNS an Excadrill; the app must trust that, not quietly
//     evaluate Drilbur — and must clear the rolling bucket's top-quartile
//     score. Injected probes receive scores but never move that reference bar.
//   - GARBAGE mons ("universally agreed to be hot garbage") wait until their
//     own unlock bucket and must rank in the bottom quartile there.
//   - Pools are ROLLING deltas (user refinement): badge N's pool is the mons
//     newly available at badge N plus those new at badge N−1 — big enough
//     that the tiny buckets (6, 15, 17) still mean something, small enough
//     that 19 optimizer runs stay affordable.
//
// Assertions are on SCORE RANK (score is sovereign), never on seating —
// seating is coverage/team-context-dependent and three injected water types
// can't all take chairs. This badge-bucket corpus is the scoring calibration
// contract. Failures are findings to understand against the user's anchors,
// not invitations to preserve an older scenario verdict.
//
// Run separately from the fast mechanical/correctness suite (19 optimizer runs):
//   npm run validate:calibration
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPool, bestChoice } from "../helpers/harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { buckets } = JSON.parse(
  readFileSync(path.join(HERE, "badge-buckets.json"), "utf8"),
);

const AMAZING = [
  "Excadrill", "Scizor", "Blaziken", "Sharpedo", "Aegislash", "Primarina",
  "Meowstic",
];
const GARBAGE = [
  "Tropius", "Dunsparce", "Sunflora", "Ledian", "Luvdisc", "Delibird",
  "Unown",
];

// Level cap per badge, from the checkpoint schedule (badgeTimeline.js).
const CAP = {
  0: 20, 1: 25, 2: 35, 3: 40, 4: 45, 5: 50, 6: 55, 7: 60, 8: 65, 9: 70,
  10: 70, 11: 75, 12: 75, 13: 80, 14: 85, 15: 90, 16: 90, 17: 95, 18: 100,
};

// Value at the q-th fraction of the ascending-sorted scores (nearest rank).
function quantile(sorted, q) {
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.round(q * (sorted.length - 1))))];
}

for (const badgeKey of Object.keys(buckets)) {
  const badge = Number(badgeKey);
  // Rolling delta: this badge's newcomers + the previous badge's.
  const bucket = [
    ...(buckets[String(badge - 1)] || []),
    ...buckets[badgeKey],
  ];
  test(`badge ${badge} bucket (cap ${CAP[badge]}): amazing top-quartile, garbage bottom-quartile`, async () => {
    const injected = AMAZING.filter((name) => !bucket.includes(name));
    const pool = [...bucket, ...injected];
    const result = await runPool({ pool, badge, levelCap: CAP[badge] });

    // Resolution completeness: a bucket name the app can't resolve is a
    // data/conversion bug that would silently shrink the pool.
    const unresolved = pool.filter((name) => !bestChoice(result, name));
    assert.deepEqual(
      unresolved,
      [],
      `badge ${badge}: unresolved pool names`,
    );

    const scoreOf = (name) => bestChoice(result, name).score;
    // The rolling bucket is the reference population. The amazing mons are
    // injected probes: including them in the quantile would let the test
    // subjects move their own bar and crowd one another out of a small
    // bucket's top quartile. They still share this optimizer run, so excluding
    // them from q75/q25 costs no extra resolution work. Poor anchors are never
    // injected; when attainable they remain part of the bucket and its q25.
    const referenceScores = bucket.map(scoreOf).sort((a, b) => a - b);
    const q75 = quantile(referenceScores, 0.75);
    const q25 = quantile(referenceScores, 0.25);

    const rankOf = (name) =>
      1 + pool.filter((other) => scoreOf(other) > scoreOf(name)).length;
    const describe = (name) =>
      `${name} score ${Math.round(scoreOf(name))} rank ${rankOf(name)}/${pool.length}`;

    // Readable findings record, pass or fail.
    console.log(
      `badge ${badge} (cap ${CAP[badge]}, ${bucket.length} reference + ${injected.length} probes) q75=${Math.round(q75)} q25=${Math.round(q25)}\n` +
        `  amazing: ${AMAZING.map(describe).join("; ")}\n` +
        (GARBAGE.some((g) => bucket.includes(g))
          ? `  garbage: ${GARBAGE.filter((g) => bucket.includes(g)).map(describe).join("; ")}\n`
          : ""),
    );

    // Collect EVERY violation (no fail-fast): each is an independent
    // constraint on the model, and a hidden failure is a lost finding.
    const violations = [];
    for (const name of AMAZING) {
      if (!(scoreOf(name) >= q75)) {
        violations.push(`${describe(name)} — must be in the top score quartile (q75 ${Math.round(q75)})`);
      }
    }
    for (const name of GARBAGE) {
      if (!bucket.includes(name)) continue; // waits until attainable
      if (!(scoreOf(name) <= q25)) {
        violations.push(`${describe(name)} — must be in the bottom score quartile (q25 ${Math.round(q25)})`);
      }
    }
    assert.deepEqual(
      violations,
      [],
      `badge ${badge}: ${violations.length} rank violations`,
    );
  });
}
