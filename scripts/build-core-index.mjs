// Builds site-data/data/core-index/<family>/<monId>.json from BOTH archives'
// team compositions: pairwise co-use lift over real teams, plus the most
// frequent trios. Same lift semantics as the teammate index — percentage
// points of P(B|A) − P(B), symmetrized — so any future scoring term can be
// calibrated the way SYNERGY_SCALE was. Not consumed by scoring yet (that is
// its own ratification); observed-set display and future team-fit work read it.
//
// Quality weighting: curated sample teams count SAMPLE_WEIGHT; replays count
// 1, or RATED_WEIGHT at/above the same 1500 bar the usage stats publish.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { REAL_FORMATS } from "./config.mjs";
import { writeJson } from "./set-index/io.mjs";
import { readArchive } from "./build-observed-sets.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE_DIR = path.join(scriptDir, "teamscrape", "archive");
const OUT_ROOT = path.join(scriptDir, "..", "site-data", "data", "core-index");

const SAMPLE_WEIGHT = 3;
const RATED_WEIGHT = 2;
const RATED_BAR = 1500;
const MIN_PAIR_WEIGHT = 2; // a once-seen pair is noise, not a core
const MAX_PARTNERS = 24; // teammate-index cap, kept for parity
const MAX_TRIOS = 12;
const familyOf = new Map(REAL_FORMATS.map((f) => [f.id, f.family]));

// → Map(family → [{ mons: [ids], weight }]) — one entry per team side.
export function collectCompositions({ replays, samples }) {
  const byFamily = new Map();
  const push = (formatId, mons, weight) => {
    const family = familyOf.get(formatId);
    if (!family || mons.length < 2) return;
    const list = byFamily.get(family) || [];
    list.push({ mons: [...new Set(mons)].sort(), weight });
    byFamily.set(family, list);
  };
  for (const replay of replays) {
    const weight =
      replay.rating != null && replay.rating >= RATED_BAR ? RATED_WEIGHT : 1;
    for (const side of replay.teams || []) push(replay.format, side, weight);
  }
  for (const team of samples) {
    push(
      team.format,
      (team.sets || []).map((set) => set.speciesId).filter(Boolean),
      SAMPLE_WEIGHT,
    );
  }
  return byFamily;
}

export function buildCoreIndex(compositions) {
  let total = 0;
  const monWeight = new Map();
  const pairWeight = new Map();
  const trioWeight = new Map();
  for (const { mons, weight } of compositions) {
    total += weight;
    for (let i = 0; i < mons.length; i += 1) {
      monWeight.set(mons[i], (monWeight.get(mons[i]) || 0) + weight);
      for (let j = i + 1; j < mons.length; j += 1) {
        const pair = `${mons[i]}|${mons[j]}`;
        pairWeight.set(pair, (pairWeight.get(pair) || 0) + weight);
        for (let k = j + 1; k < mons.length; k += 1) {
          const trio = `${mons[i]}|${mons[j]}|${mons[k]}`;
          trioWeight.set(trio, (trioWeight.get(trio) || 0) + weight);
        }
      }
    }
  }

  const partners = new Map(); // monId → [{id, lift, count}]
  for (const [pair, weight] of pairWeight) {
    if (weight < MIN_PAIR_WEIGHT) continue;
    const [a, b] = pair.split("|");
    // Symmetrized lift in percentage points: mean of P(B|A)−P(B) and
    // P(A|B)−P(A), matching build-teammate-index's pair-mean convention.
    const liftAB = weight / monWeight.get(a) - monWeight.get(b) / total;
    const liftBA = weight / monWeight.get(b) - monWeight.get(a) / total;
    const lift = Number((100 * ((liftAB + liftBA) / 2)).toFixed(3));
    for (const [self, other] of [[a, b], [b, a]]) {
      const list = partners.get(self) || [];
      list.push({ id: other, lift, count: weight });
      partners.set(self, list);
    }
  }

  const trios = new Map(); // monId → [{ids, count}]
  for (const [trio, weight] of trioWeight) {
    if (weight < MIN_PAIR_WEIGHT) continue;
    const ids = trio.split("|");
    for (const self of ids) {
      const list = trios.get(self) || [];
      list.push({ ids: ids.filter((id) => id !== self), count: weight });
      trios.set(self, list);
    }
  }

  const out = new Map();
  for (const [monId, list] of partners) {
    out.set(monId, {
      pokemonId: monId,
      teams: monWeight.get(monId),
      partners: Object.fromEntries(
        list
          .sort((x, y) => Math.abs(y.lift) - Math.abs(x.lift))
          .slice(0, MAX_PARTNERS)
          .map((p) => [p.id, { lift: p.lift, count: p.count }]),
      ),
      trios: (trios.get(monId) || [])
        .sort((x, y) => y.count - x.count)
        .slice(0, MAX_TRIOS),
    });
  }
  return out;
}

async function main() {
  const replays = readArchive(ARCHIVE_DIR, "replays-");
  const samples = readArchive(ARCHIVE_DIR, "samples-");
  const byFamily = collectCompositions({ replays, samples });
  for (const [family, compositions] of byFamily) {
    const index = buildCoreIndex(compositions);
    const dir = path.join(OUT_ROOT, family);
    for (const [monId, detail] of index) {
      await writeJson(path.join(dir, `${monId}.json`), detail);
    }
    await writeJson(path.join(dir, "index.json"), [...index.keys()].sort());
    console.log(
      `core-index/${family}: ${index.size} mons from ${compositions.length} team sides`,
    );
  }
  if (!byFamily.size) console.log("core-index: no archives yet — nothing to build");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
