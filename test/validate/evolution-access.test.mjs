// Evolution-method access gates (user request): Reborn locks special
// evolution methods behind story unlocks — the magnetic field sits behind
// Shade's gym via the Yureyal key — so the optimizer must not assume them.
// An access field set to false BLOCKS the evolution (surfaced in
// blockedEvolutions); absent fields keep the old behavior exactly.
import test from "node:test";
import assert from "node:assert/strict";
import { runPool, loadShared, progressionAt } from "../helpers/harness.mjs";

const { normalizeRebornProgression } = await import(
  "../../src/reborn/progression.js"
);
const { getCurrentRebornSpeciesForChoice } = await import(
  "../../src/reborn/currentSpecies.js"
);
const { optimizeTeamFromPool } = await import(
  "../../src/teamBuilder/teamOptimizer.js"
);

test("magnetic-field access gate blocks Probopass, surfaces the block", async () => {
  // Default: magnetic field assumed available — Nosepass fields Probopass.
  const withAccess = getCurrentRebornSpeciesForChoice(
    { inputPokemonId: "nosepass", pokemonId: "probopass", name: "Probopass" },
    { levelCap: "50" },
  );
  assert.equal(withAccess.id, "probopass");

  // Access denied: fields Nosepass, and the lost form is SURFACED.
  const withoutAccess = getCurrentRebornSpeciesForChoice(
    { inputPokemonId: "nosepass", pokemonId: "probopass", name: "Probopass" },
    { levelCap: "50", evoAccessMagneticField: false },
  );
  assert.equal(withoutAccess.id, "nosepass");
  const blocked = withoutAccess.blockedEvolutions.find(
    (entry) => entry.to === "probopass",
  );
  assert.ok(blocked, "Probopass must appear in blockedEvolutions");
  assert.match(blocked.reason, /Magnetic field/i);
});

test("other access gates: friendship, link stone, stones", async () => {
  // Golbat → Crobat is friendship.
  const noFriendship = getCurrentRebornSpeciesForChoice(
    { inputPokemonId: "zubat", pokemonId: "crobat", name: "Crobat" },
    { levelCap: "50", evoAccessFriendship: false },
  );
  assert.equal(noFriendship.id, "golbat");

  // Haunter → Gengar is trade (Link Stone).
  const noLink = getCurrentRebornSpeciesForChoice(
    { inputPokemonId: "gastly", pokemonId: "gengar", name: "Gengar" },
    { levelCap: "50", evoAccessLinkStone: false },
  );
  assert.equal(noLink.id, "haunter");

  // Gloom → Vileplume is a Leaf Stone — its OWN gate (user request:
  // per-stone access), and blocking a DIFFERENT stone must not touch it.
  const noLeafStone = getCurrentRebornSpeciesForChoice(
    { inputPokemonId: "oddish", pokemonId: "vileplume", name: "Vileplume" },
    { levelCap: "50", evoAccessLeafStone: false },
  );
  assert.equal(noLeafStone.id, "gloom");
  const noFireStone = getCurrentRebornSpeciesForChoice(
    { inputPokemonId: "oddish", pokemonId: "vileplume", name: "Vileplume" },
    { levelCap: "50", evoAccessFireStone: false },
  );
  assert.equal(noFireStone.id, "vileplume");

  // Legacy saves: the old blanket flag still blocks every stone, both raw
  // and through normalization (which migrates it to the per-stone keys).
  const legacyRaw = getCurrentRebornSpeciesForChoice(
    { inputPokemonId: "oddish", pokemonId: "vileplume", name: "Vileplume" },
    { levelCap: "50", evoAccessStones: false },
  );
  assert.equal(legacyRaw.id, "gloom");
  const migrated = normalizeRebornProgression({
    levelCap: "50",
    evoAccessStones: false,
  });
  assert.equal(migrated.evoAccessLeafStone, false);
  assert.equal(migrated.evoAccessOtherEvoItems, false);
  assert.equal(migrated.evoAccessFriendship, undefined, "non-item gates untouched");
});

test("optimizer respects the gate end-to-end (fielded form + cache key)", async () => {
  const { availability, pokemonIndex } = await loadShared();
  const pool = ["Nosepass", "Froakie", "Pichu", "Mudkip", "Zubat", "Shuckle"];
  const base = progressionAt({ badge: 8, levelCap: 45 });

  const open = await optimizeTeamFromPool({
    availability,
    family: "singles",
    pokemonIndex,
    progression: base,
    query: pool.join("\n"),
    selection: "all",
  });
  const gated = await optimizeTeamFromPool({
    availability,
    family: "singles",
    pokemonIndex,
    progression: { ...base, evoAccessMagneticField: false },
    query: pool.join("\n"),
    selection: "all",
  });

  const fieldedForm = (result) => {
    const line = result.lines.find(
      (entry) => (entry.best || entry.bestNonMega)?.inputName === "Nosepass",
    );
    const choice = line.best || line.bestNonMega;
    return choice.legalityProfile?.currentId || choice.pokemonId;
  };
  assert.equal(fieldedForm(open), "probopass");
  assert.equal(
    fieldedForm(gated),
    "nosepass",
    "gated run must field Nosepass — and differing results prove the cache key separates the two progressions",
  );
});

test("party-condition gate: Mantyke needs a Remoraid to become Mantine", async () => {
  const withAccess = getCurrentRebornSpeciesForChoice(
    { inputPokemonId: "mantyke", pokemonId: "mantine", name: "Mantine" },
    { levelCap: "50" },
  );
  assert.equal(withAccess.id, "mantine");

  const withoutRemoraid = getCurrentRebornSpeciesForChoice(
    { inputPokemonId: "mantyke", pokemonId: "mantine", name: "Mantine" },
    { levelCap: "50", evoAccessPartyCondition: false },
  );
  assert.equal(withoutRemoraid.id, "mantyke");
  const blocked = withoutRemoraid.blockedEvolutions.find(
    (entry) => entry.to === "mantine",
  );
  assert.ok(blocked, "Mantine must appear in blockedEvolutions");
  assert.match(blocked.reason, /Party-condition/i);
});

test("an owned Mantine is never represented as its own pre-evolution", async () => {
  const { availability, pokemonIndex } = await loadShared();
  const result = await optimizeTeamFromPool({
    availability,
    family: "singles",
    pokemonIndex,
    progression: progressionAt({ badge: 4, levelCap: 45 }),
    query: ["Mantine", "Froakie", "Pichu", "Mudkip", "Zubat"].join("\n"),
    selection: "all",
  });
  const line = result.lines.find(
    (entry) => (entry.best || entry.bestNonMega)?.inputName === "Mantine",
  );
  const best = line.best || line.bestNonMega;
  assert.equal(best.pokemonId, "mantine", "representative must be Mantine, not Mantyke");
  assert.ok(
    line.candidates.every((candidate) => (candidate.candidate?.id ?? candidate.pokemonId) !== "mantyke"),
    "Mantyke must not be a candidate for an owned Mantine at all",
  );
});
