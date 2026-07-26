/**
 * @fileoverview Ratification ablation for the bounded core-completion term
 * (SCORING.md, "Core completion"): scores whole real six-mon rosters from
 * site-data/data/team-index/singles against seeded pseudo-random six-mon
 * recombinations drawn from each format's own team-member population, using
 * the core-completion term ALONE at full pair trust. Reports per-format and
 * pooled AUC — the probability a random real team outscores a random
 * shuffle — plus the fraction of rosters with any core-index coverage.
 *
 * Preregistered decision rule: pooled AUC >= 0.60 AND coverage >= 50% wires
 * the term at its bounded weight; anything less kills it.
 *
 * Deliberately NOT part of npm test — run: node scripts/validate-core-term.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  coreCompletionFit,
  corePairCredit,
} from '../src/teamBuilder/core-completion.js';
import { tunable } from '../src/teamBuilder/scoring-constants.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(scriptDir, '..', 'site-data', 'data');
const CORE_DIR = path.join(DATA, 'core-index', 'singles');
const TEAM_DIR = path.join(DATA, 'team-index', 'singles');

const SHUFFLES_PER_FORMAT = 200;
const SEED = 0x5eedc04e;
const AUC_BAR = 0.6;
const COVERAGE_BAR = 0.5;

// Deterministic PRNG (mulberry32) so every run scores the same shuffles.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function formatSeed(formatId) {
  let hash = 0;
  for (const ch of formatId) {
    hash = (Math.imul(hash, 31) + ch.codePointAt(0)) >>> 0;
  }
  return (hash ^ SEED) >>> 0;
}

function loadCorePartners() {
  const partnersById = new Map();
  for (const file of fs.readdirSync(CORE_DIR)) {
    if (!file.endsWith('.json') || file === 'index.json') continue;
    const entry = JSON.parse(fs.readFileSync(path.join(CORE_DIR, file)));
    if (entry?.pokemonId && entry.partners) {
      partnersById.set(entry.pokemonId, entry.partners);
    }
  }
  return partnersById;
}

// Whole six-mon rosters only: parser-spill sides (over six) and partial
// sides are not real full teams, and duplicate species void the pair space.
function loadRosters(formatFile) {
  const detail = JSON.parse(fs.readFileSync(path.join(TEAM_DIR, formatFile)));
  const rosters = [];
  for (const team of detail.teams || []) {
    const members = team.members || [];
    const ids = [...new Set(members.map((m) => m.speciesId).filter(Boolean))];
    if (members.length === 6 && ids.length === 6) rosters.push(ids.sort());
  }
  return { formatId: detail.formatId, rosters };
}

// The term's value on a roster at full pair trust. The saturation is
// strictly monotone in the summed credit, so it cannot change the AUC — the
// ablation scores the exact shipped shape regardless.
function scoreRoster(ids, partnersById) {
  const evidenceHalf = tunable('CORE_EVIDENCE_HALF');
  let credit = 0;
  let covered = false;
  for (let a = 0; a < ids.length; a += 1) {
    for (let b = a + 1; b < ids.length; b += 1) {
      const record =
        partnersById.get(ids[a])?.[ids[b]] ??
        partnersById.get(ids[b])?.[ids[a]];
      if (record === undefined) continue;
      covered = true;
      credit += corePairCredit(record.lift, record.count, 1, evidenceHalf);
    }
  }
  const value = coreCompletionFit(
    credit,
    tunable('CORE_COMPLETION_SCALE'),
    tunable('CORE_COMPLETION_SATURATION'),
  );
  return { value, credit, covered };
}

// Frequency-weighted recombination: members are drawn from the multiset of
// the format's own real-team members, so a shuffle is a plausible same-tier
// six with the real rosters' species frequencies but random pairings.
function drawShuffles(rosters, random) {
  const population = rosters.flat();
  const shuffles = [];
  while (shuffles.length < SHUFFLES_PER_FORMAT) {
    const picked = new Set();
    let guard = 0;
    while (picked.size < 6 && guard < 1000) {
      picked.add(population[Math.floor(random() * population.length)]);
      guard += 1;
    }
    if (picked.size === 6) shuffles.push([...picked].sort());
  }
  return shuffles;
}

// Probability a random real roster outscores a random shuffle; ties half.
function auc(realValues, shuffleValues) {
  let wins = 0;
  for (const real of realValues) {
    for (const shuffle of shuffleValues) {
      if (real > shuffle) wins += 1;
      else if (real === shuffle) wins += 0.5;
    }
  }
  return wins / (realValues.length * shuffleValues.length);
}

function median(values) {
  const sorted = [...values].sort((x, y) => x - y);
  const mid = sorted.length >> 1;
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function coveredShare(scored) {
  return scored.filter((s) => s.covered).length / scored.length;
}

function main() {
  const partnersById = loadCorePartners();
  const formatFiles = fs
    .readdirSync(TEAM_DIR)
    .filter((file) => file.endsWith('.json') && file !== 'index.json')
    .sort();

  const pooledReal = [];
  const pooledShuffle = [];
  let coveredCount = 0;
  let rosterCount = 0;

  console.log(
    'format             nReal  nShuf    AUC   covReal  covShuf' +
    '  medCreditR  medCreditS',
  );
  for (const file of formatFiles) {
    const { formatId, rosters } = loadRosters(file);
    if (!rosters.length) {
      console.log(`${formatId.padEnd(18)} 0 rosters — skipped`);
      continue;
    }
    const random = mulberry32(formatSeed(formatId));
    const shuffles = drawShuffles(rosters, random);
    const real = rosters.map((ids) => scoreRoster(ids, partnersById));
    const shuffle = shuffles.map((ids) => scoreRoster(ids, partnersById));
    pooledReal.push(...real);
    pooledShuffle.push(...shuffle);
    coveredCount += [...real, ...shuffle].filter((s) => s.covered).length;
    rosterCount += real.length + shuffle.length;
    console.log(
      formatId.padEnd(18) +
      String(real.length).padStart(6) +
      String(shuffle.length).padStart(7) +
      auc(real.map((s) => s.value), shuffle.map((s) => s.value))
        .toFixed(3).padStart(7) +
      coveredShare(real).toFixed(3).padStart(9) +
      coveredShare(shuffle).toFixed(3).padStart(9) +
      median(real.map((s) => s.credit)).toFixed(1).padStart(12) +
      median(shuffle.map((s) => s.credit)).toFixed(1).padStart(12),
    );
  }

  const pooledAuc = auc(
    pooledReal.map((s) => s.value),
    pooledShuffle.map((s) => s.value),
  );
  const coverage = coveredCount / rosterCount;
  console.log(
    `\npooled: AUC ${pooledAuc.toFixed(4)} over ${pooledReal.length} real` +
    ` × ${pooledShuffle.length} shuffled rosters;` +
    ` coverage ${(100 * coverage).toFixed(1)}%` +
    ` (real ${(100 * coveredShare(pooledReal)).toFixed(1)}%,` +
    ` shuffles ${(100 * coveredShare(pooledShuffle)).toFixed(1)}%)`,
  );
  console.log(
    `median credit: real ${median(pooledReal.map((s) => s.credit)).toFixed(1)}pp,` +
    ` shuffles ${median(pooledShuffle.map((s) => s.credit)).toFixed(1)}pp`,
  );

  const pass = pooledAuc >= AUC_BAR && coverage >= COVERAGE_BAR;
  console.log(
    pass
      ? `\nDECISION: PASS — pooled AUC >= ${AUC_BAR} with coverage >= ` +
        `${100 * COVERAGE_BAR}%; the term detects real structure.`
      : `\nDECISION: KILL — below the preregistered ${AUC_BAR} AUC / ` +
        `${100 * COVERAGE_BAR}% coverage bar; do not wire the term.`,
  );
  process.exitCode = pass ? 0 : 1;
}

main();
