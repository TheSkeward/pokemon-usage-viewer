/**
 * @fileoverview Parses Reborn's compiled `mons.dat` into a learnset table
 * keyed by our pokemon-index ids, committed so the legal-move build is
 * reproducible without shipping the raw game file. Re-run when Reborn updates:
 *   node scripts/build-reborn-learnsets.mjs path/to/Data/mons.dat
 */
import fs from "node:fs";
import path from "node:path";
import { buildRebornLearnsets } from "./reborn/extractRebornLearnsets.mjs";

const projectRoot = process.cwd();
const monsDatPath = process.argv[2];
if (!monsDatPath) {
  console.error("Usage: node scripts/build-reborn-learnsets.mjs <mons.dat>");
  process.exit(1);
}

const pokemonIndex = JSON.parse(
  fs.readFileSync(
    path.join(projectRoot, "site-data", "data", "pokemon-index.json"),
    "utf8",
  ),
);

const { learnsets, unmapped } = buildRebornLearnsets(monsDatPath, pokemonIndex);
if (unmapped.length) {
  console.warn(`[reborn-learnsets] ${unmapped.length} unmapped: ${unmapped.join(", ")}`);
}

const outPath = path.join(
  projectRoot,
  "scripts",
  "reborn",
  "reborn-learnsets.generated.json",
);
fs.writeFileSync(
  outPath,
  JSON.stringify({ source: "Reborn mons.dat", learnsets }) + "\n",
);
console.log(
  `[reborn-learnsets] wrote ${Object.keys(learnsets).length} species to ${path.relative(projectRoot, outPath)}`,
);
