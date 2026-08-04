// Rank calibration against community consensus: a lower bound requiring
// famous mons to score well in the real per-badge availability buckets
// (test/calibration/badge-buckets.json, community-sourced).
//
//   - AMAZING mons (community-consensus standouts in these games) are
//     injected into EVERY bucket as their evolved forms — inputting
//     "Excadrill" means the player OWNS an Excadrill; the app must trust
//     that, not quietly evaluate Drilbur — and must clear the rolling
//     bucket's top-quartile score. Injected probes receive scores but never
//     move that reference bar.
//   - GARBAGE mons (community-consensus duds) are logged as findings
//     wherever attainable but NOT gated: bottom-quartile membership in
//     small buckets proved knife-edge, and holding the floor is not worth
//     capping how far usage sovereignty can be dialed up. The log line
//     keeps junk inflation visible to eyeballs.
//   - Bucket 18 (the post-game unlock wave, cap 100) stays in the corpus but
//     is not run: post-game seating is outside the progression-optimization
//     contract, and its staple-heavy population was the binding constraint
//     on PRIOR_DRAG_CAP without describing play the app optimizes for.
//   - Pools are ROLLING deltas (user refinement): badge N's pool is the mons
//     newly available at badge N plus those new at badge N−1 — big enough
//     that the tiny buckets (6, 15, 17) still mean something, small enough
//     that 18 optimizer runs stay affordable.
//
// Assertions are on SCORE RANK (score is sovereign), never on seating —
// seating is coverage/team-context-dependent and three injected water types
// can't all take chairs. This badge-bucket corpus is the scoring calibration
// contract; failures are findings to understand against the user's anchors.
//
// Run separately from the fast mechanical/correctness suite (19 optimizer
// runs):
//   npm run validate:calibration
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPool, bestChoice } from '../helpers/harness.mjs';
import {
  activePoorAnchors,
  poorAnchor,
  poorAnchorInput,
  poorAnchorLabel,
} from '../helpers/calibration-anchors.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { buckets } = JSON.parse(
  readFileSync(path.join(HERE, 'badge-buckets.json'), 'utf8'),
);

const AMAZING = [
  'Excadrill', 'Scizor', 'Blaziken', 'Sharpedo', 'Aegislash', 'Primarina',
  'Meowstic',
];
const GARBAGE = [
  poorAnchor('Tropius'),
  poorAnchor('Dunsparce'),
  poorAnchor('Sunflora'),
  poorAnchor('Ledian'),
  poorAnchor('Luvdisc'),
  poorAnchor('Delibird'),
  poorAnchor('Unown'),
];

// Level cap per badge, from the checkpoint schedule (badge-timeline.js).
const CAP = {
  0: 20, 1: 25, 2: 35, 3: 40, 4: 45, 5: 50, 6: 55, 7: 60, 8: 65, 9: 70,
  10: 70, 11: 75, 12: 75, 13: 80, 14: 85, 15: 90, 16: 90, 17: 95, 18: 100,
};

// Value at the q-th fraction of the ascending-sorted scores (nearest rank).
function quantile(sorted, q) {
  return sorted[Math.max(
    0, Math.min(sorted.length - 1, Math.round(q * (sorted.length - 1))))];
}

const GATED_BUCKETS = Object.keys(buckets).filter((key) => key !== '18');

for (const badgeKey of GATED_BUCKETS) {
  const badge = Number(badgeKey);
  const bucket = [
    ...(buckets[String(badge - 1)] || []),
    ...buckets[badgeKey],
  ];
  test(`badge ${badge} bucket (cap ${CAP[badge]}): amazing top-quartile`, async () => {
    const injected = AMAZING.filter((name) => !bucket.includes(name));
    const pool = [...bucket, ...injected];
    // Calibration measures the entire reference population, including its
    // deliberately weak tail. The interactive app's 126-line performance cap
    // would otherwise turn the lowest-usage rows into donor-only entries and
    // make q25—and the poor-anchor assertions—undefined.
    const result = await runPool({
      pool,
      badge,
      levelCap: CAP[badge],
      scoreAllLines: true,
    });

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
    const activeGarbage = activePoorAnchors(GARBAGE, bucket);
    const describePoor = (anchor) => {
      const input = poorAnchorInput(anchor);
      return `${poorAnchorLabel(anchor)} score ${Math.round(scoreOf(input))} rank ${rankOf(input)}/${pool.length}`;
    };

    // Readable findings record, pass or fail.
    console.log(
      `badge ${badge} (cap ${CAP[badge]}, ${bucket.length} reference + ${injected.length} probes) q75=${Math.round(q75)} q25=${Math.round(q25)}\n` +
        `  amazing: ${AMAZING.map(describe).join('; ')}\n` +
        (activeGarbage.length
          ? `  garbage: ${activeGarbage.map(describePoor).join('; ')}\n`
          : ''),
    );

    // Collect EVERY violation (no fail-fast): each is an independent
    // constraint on the model, and a hidden failure is a lost finding.
    // Garbage anchors are findings only (see header) — never violations.
    const violations = [];
    for (const name of AMAZING) {
      if (!(scoreOf(name) >= q75)) {
        violations.push(`${describe(name)} — must be in the top score quartile (q75 ${Math.round(q75)})`);
      }
    }
    assert.deepEqual(
      violations,
      [],
      `badge ${badge}: ${violations.length} rank violations`,
    );
  });
}
