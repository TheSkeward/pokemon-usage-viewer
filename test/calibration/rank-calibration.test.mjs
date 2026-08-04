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
//   - PRODUCTION semantics throughout: no scoreAllLines bypass. Pools above
//     the 126-line working set relegate their lowest-usage lines to
//     donor-only, exactly as the app does — and an anchor that fails to hold
//     a scored seat FAILS the suite. What the suite certifies is what a user
//     with this box would actually see.
//   - The window is 4 buckets: the widest at which every anchor holds a
//     working-set seat in every bucket (at 5, the big early waves push the
//     lowest-usage anchor out of the 126). The intended reference is
//     everything-available-so-far; the width is bounded by the working-set
//     contract, not by runtime.
//   - GARBAGE mons (community-consensus duds) are logged as findings
//     wherever attainable but NOT gated: bottom-quartile membership in
//     small buckets proved knife-edge, and holding the floor is not worth
//     capping how far usage sovereignty can be dialed up. The log line
//     keeps junk inflation visible to eyeballs.
//   - Bucket 18 (the post-game unlock wave, cap 100) stays in the corpus but
//     is not run: post-game seating is outside the progression-optimization
//     contract, and its staple-heavy population was the binding constraint
//     on PRIOR_DRAG_CAP without describing play the app optimizes for.
//
// Assertions are on SCORE RANK (score is sovereign), never on seating —
// seating is coverage/team-context-dependent and three injected water types
// can't all take chairs. This badge-bucket corpus is the scoring calibration
// contract; failures are findings to understand against the user's anchors.
//
// Run separately from the fast mechanical/correctness suite (18 optimizer
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

const WINDOW_BUCKETS = 4;

// Level cap per badge, from the checkpoint schedule (badge-timeline.js).
const CAP = {
  0: 20, 1: 25, 2: 35, 3: 40, 4: 45, 5: 50, 6: 55, 7: 60, 8: 65, 9: 70,
  10: 70, 11: 75, 12: 75, 13: 80, 14: 85, 15: 90, 16: 90, 17: 95,
};

// Value at the q-th fraction of the ascending-sorted scores (nearest rank).
function quantile(sorted, q) {
  return sorted[Math.max(
    0, Math.min(sorted.length - 1, Math.round(q * (sorted.length - 1))))];
}

const GATED_BUCKETS = Object.keys(buckets).filter((key) => key !== '18');

for (const badgeKey of GATED_BUCKETS) {
  const badge = Number(badgeKey);
  const bucket = [];
  for (let b = Math.max(0, badge - WINDOW_BUCKETS + 1); b <= badge; b++) {
    bucket.push(...(buckets[String(b)] || []));
  }
  test(`badge ${badge} bucket (cap ${CAP[badge]}): amazing top-quartile`, async () => {
    const injected = AMAZING.filter((name) => !bucket.includes(name));
    const pool = [...bucket, ...injected];
    const result = await runPool({ pool, badge, levelCap: CAP[badge] });

    const scoreOf = (name) => bestChoice(result, name)?.score;

    // Resolution completeness: a bucket name the app can't RECOGNIZE is a
    // data/conversion bug that would silently shrink the pool. The
    // recognized-input count covers every path; unscored names are only
    // individually diagnosable when nothing was merged (same-line inputs
    // share one scored slot) or relegated to donor-only by the 126 cap.
    const selection = result.poolSelection || {};
    assert.equal(
      selection.inputLines,
      pool.length,
      `badge ${badge}: ${pool.length - selection.inputLines} unrecognized pool name(s)`,
    );
    if (
      !(selection.donorOnlyLines > 0) &&
      !(selection.duplicateLines > 0)
    ) {
      assert.deepEqual(
        pool.filter((name) => scoreOf(name) == null),
        [],
        `badge ${badge}: recognized names missing scores`,
      );
    }
    // The rolling bucket is the reference population — its SCORED members
    // only, because donor-only lines have no score to rank and the app never
    // shows them one. The amazing mons are injected probes: including them
    // in the quantile would let the test subjects move their own bar and
    // crowd one another out of a small bucket's top quartile. Poor anchors
    // are never injected; when attainable and scored they remain part of
    // the bucket and its q25.
    const scoredReference = bucket.filter((name) => scoreOf(name) != null);
    const referenceScores =
      scoredReference.map(scoreOf).sort((a, b) => a - b);
    const q75 = quantile(referenceScores, 0.75);
    const q25 = quantile(referenceScores, 0.25);

    const rankOf = (name) =>
      1 + pool.filter((other) => (scoreOf(other) ?? -Infinity) > scoreOf(name))
        .length;
    const describe = (name) =>
      scoreOf(name) == null
        ? `${name} UNSCORED (outside the working set)`
        : `${name} score ${Math.round(scoreOf(name))} rank ${rankOf(name)}/${pool.length}`;
    const activeGarbage = activePoorAnchors(GARBAGE, bucket);
    const describePoor = (anchor) => {
      const input = poorAnchorInput(anchor);
      return scoreOf(input) == null
        ? `${poorAnchorLabel(anchor)} unscored`
        : `${poorAnchorLabel(anchor)} score ${Math.round(scoreOf(input))} rank ${rankOf(input)}/${pool.length}`;
    };

    // Readable findings record, pass or fail.
    console.log(
      `badge ${badge} (cap ${CAP[badge]}, ${bucket.length} reference [${scoredReference.length} scored, ${selection.donorOnlyLines ?? 0} donor-only] + ${injected.length} probes) q75=${Math.round(q75)} q25=${Math.round(q25)}\n` +
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
      if (scoreOf(name) == null) {
        violations.push(
          `${name} — not in the scored working set (usage rank below the 126-line cut)`,
        );
        continue;
      }
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
