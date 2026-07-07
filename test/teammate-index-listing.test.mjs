// The teammate-index listing contract: index.json in each family directory
// must name exactly the per-mon files that exist. The runtime loader skips
// fetches for unlisted mons (avoiding expected-404 console noise), so a
// listing that OVERSTATES availability causes 404s and one that UNDERSTATES
// silently disables synergy for those mons. build-teammate-index.mjs emits
// the listing with the files; this pins that they can't drift.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

for (const family of ["singles", "doubles"]) {
  test(`teammate-index listing matches files on disk (${family})`, () => {
    const dir = path.join(ROOT, "site-data", "data", "teammate-index", family, "all");
    if (!existsSync(dir)) {
      // No data for this family yet — nothing to contract.
      return;
    }
    const listed = JSON.parse(readFileSync(path.join(dir, "index.json")));
    const onDisk = readdirSync(dir)
      .filter((file) => file.endsWith(".json") && file !== "index.json")
      .map((file) => file.replace(/\.json$/, ""))
      .sort();
    assert.deepEqual([...listed].sort(), onDisk);
    assert.ok(onDisk.length > 0, "family directory exists but is empty");
  });
}
