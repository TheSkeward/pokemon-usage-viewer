// User report: "friendship, then Thunder Stone" is insufficient for
// Raichu-Alola — Reborn's Alolan-region evolutions also require Apophyll
// (the Alola equivalent). The dex's evoRegion field now flows into the
// species table and gates on a dedicated access toggle. Exception
// (user-verified): Reborn removed Marowak-Alola's location requirement —
// Cubone picks the form by time of day (Kanto by day, Alolan at night).
import test from "node:test";
import assert from "node:assert/strict";
// Side effect: installs the fetch/env/localStorage shims the app modules need.
import "../helpers/harness.mjs";

const { getEvolutionRequirement, describeEvolutionPath } = await import(
  "../../src/reborn/evolutionRequirements.js"
);
const { GEN7_PROGRESSION_SPECIES } = await import(
  "../../src/generated/gen7ProgressionSpecies.generated.js"
);

test("Alolan-region evolutions gate on Apophyll access", () => {
  const noApophyll = { evoAccessApophyll: false };
  for (const id of ["raichualola", "exeggutoralola"]) {
    const requirement = getEvolutionRequirement(
      GEN7_PROGRESSION_SPECIES[id],
      noApophyll,
    );
    assert.equal(requirement.status, "blocked", `${id} should be blocked`);
    assert.match(requirement.reason, /Apophyll/);
  }
  // With access (or by default), legal — and the reason says where.
  const open = getEvolutionRequirement(GEN7_PROGRESSION_SPECIES.raichualola, {});
  assert.equal(open.status, "legal");
  assert.match(open.reason, /in Apophyll/);
  // Kanto Raichu never cares about Apophyll.
  const kanto = getEvolutionRequirement(
    GEN7_PROGRESSION_SPECIES.raichu,
    noApophyll,
  );
  assert.equal(kanto.status, "legal");
});

test("Marowak-Alola is exempt: Cubone picks the form by time of day", () => {
  const requirement = getEvolutionRequirement(
    GEN7_PROGRESSION_SPECIES.marowakalola,
    { evoAccessApophyll: false },
  );
  assert.equal(requirement.status, "legal");
  assert.match(requirement.reason, /at night/);
  assert.equal(describeEvolutionPath("cubone", "marowakalola"), "@28 (at night)");
  assert.equal(describeEvolutionPath("cubone", "marowak"), "@28 (during the day)");
});

test("evolution notes name Apophyll", () => {
  assert.equal(
    describeEvolutionPath("pichu", "raichualola"),
    " (friendship, then Thunder Stone, in Apophyll)",
  );
  assert.equal(
    describeEvolutionPath("exeggcute", "exeggutoralola"),
    " (Leaf Stone, in Apophyll)",
  );
});
