// Generates the central move-metadata table from @pkmn/dex Gen 7 data. This is
// the single source of truth for a move's intrinsic properties — name, type,
// damage category, base power, priority, and whether it carries utility beyond
// raw damage — so that per-Pokémon legal-move files only need to reference a
// move by id and any change to a move's stats propagates everywhere at once
// (rather than being duplicated into every file that happens to list the move).

import fs from "node:fs";
import path from "node:path";
import { Dex } from "@pkmn/dex";

const OUT_PATH = path.resolve("src", "generated", "gen7MoveMeta.generated.js");

// Happiness-scaled moves report base power 0 in the dex, which would drop them
// from the damage model entirely. Assume max happiness (the sensible playthrough
// default): Return is then 102 BP, and Frustration is 0 (so it stays out).
const ASSUMED_BASE_POWER = { return: 102 };

// Coded-effect moves whose utility value isn't expressed by any dex field (a
// Knock Off looks identical to a Tackle in the data), so they have to be listed
// by hand. Reviewed move-by-move; see scripts notes. Status moves are always
// utility; this set only promotes *damaging* moves to also count as utility.
const CODED_UTILITY_MOVES = new Set([
  "knockoff", "thief", "covet", "rapidspin", "pursuit", "anchorshot",
  "spiritshackle", "thousandwaves", "thousandarrows", "bugbite", "pluck",
  "incinerate", "feint", "brickbreak", "psychicfangs", "clearsmog",
  "beakblast", "coreenforcer", "skydrop", "spectralthief", "fellstinger",
  "rage", "skullbash", "plasmafists", "pollenpuff", "hyperspacehole",
  "hyperspacefury", "phantomforce", "shadowforce", "uproar", "burnup",
  "fling", "present", "smellingsalts", "wakeupslap", "firepledge",
  "grasspledge", "waterpledge", "round",
]);

// A move carries utility beyond raw damage if it's a status move, or a damaging
// move with a *beneficial* rider: self-heal (drain), a secondary that inflicts
// status / flinch / confusion / lowers a foe's stat / raises the user's stat, a
// guaranteed positive self-boost, a target effect (bind / trap / grounds /
// phaze / pivot), or a curated coded effect. Pure downside riders (recoil,
// crash, recharge, lock-in, self-stat-drops) do NOT count.
function isUtilityMove(move) {
  if (move.category === "Status") return true;
  if (CODED_UTILITY_MOVES.has(move.id)) return true;
  if (move.drain || move.heal) return true;
  if (move.forceSwitch || move.selfSwitch) return true;
  if (move.volatileStatus) return true; // bind / trap / grounds / confuse on target
  if (move.status) return true; // guaranteed status on a damaging move
  const secondaries = move.secondaries || (move.secondary ? [move.secondary] : []);
  for (const s of secondaries) {
    if (!s) continue;
    if (s.status || s.volatileStatus || s.boosts) return true; // foe status/debuff
    if (s.self?.boosts) return true; // user setup
  }
  if (move.self?.boosts) {
    // A guaranteed self-boost counts only if some stat goes up (Close Combat's
    // pure -Def/-SpD is a downside, not utility).
    if (Object.values(move.self.boosts).some((v) => v > 0)) return true;
  }
  return false;
}

function main() {
  const dex = Dex.forGen(7);
  const meta = {};

  for (const listed of dex.moves.all()) {
    if (!listed.exists) continue;
    // Read each move back through get() so its properties are normalized the
    // same way the per-Pokémon learnset builder reads them — notably Hidden
    // Power, whose listed entry carries a variant type/name but resolves to the
    // generic Normal/60 form under get() (per-mon files key every HP variant
    // under the single "hiddenpower" id).
    const move = dex.moves.get(listed.id);
    if (!move?.exists) continue;
    const entry = {
      name: move.name,
      type: move.type,
      category: move.category,
      basePower: ASSUMED_BASE_POWER[move.id] ?? (move.basePower || 0),
      priority: move.priority || 0,
      utility: isUtilityMove(move),
      // Accuracy as a 0–100 percentage so the damage estimate can weight a move
      // by its expected hit rate. The dex marks never-miss moves (Swift, Aura
      // Sphere, ...) as `true`; normalize those to 100. Status/odd entries with no
      // numeric accuracy also default to 100 (no penalty).
      accuracy: move.accuracy === true ? 100 : move.accuracy || 100,
    };
    // Multi-hit (a number like Double Kick's 2, or a [min,max] like Fury Swipes'
    // [2,5]) and recharge (Hyper Beam) feed the effective-power model in the
    // damage estimate, so a move's per-commitment output is ranked, not one hit.
    if (move.multihit !== undefined && move.multihit !== null) {
      entry.multihit = move.multihit;
    }
    if (move.flags?.recharge) entry.recharge = true;
    // Two-turn charge moves (Solar Beam, Fly, ...). The damage model amortizes
    // the wasted turn — except for the semi-invulnerable ones, handled by id.
    if (move.flags?.charge) entry.charge = true;
    meta[move.id] = entry;
  }

  const body = `// Generated by scripts/build-move-meta.mjs from @pkmn/dex Gen 7 data.
// Do not edit by hand. This is the central reference for every move's intrinsic
// properties; per-Pokémon legal-move files reference moves by id and rely on
// this table for name/type/category/basePower/priority/utility/accuracy.

export const MOVE_META = ${JSON.stringify(meta, null, 2)};
`;

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, body);
  console.log(`Wrote move meta for ${Object.keys(meta).length} moves.`);
}

main();
