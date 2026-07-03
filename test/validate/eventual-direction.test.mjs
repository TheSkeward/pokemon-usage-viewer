// The team table's "Eventual" column must only ever show a form that lies
// AHEAD of the current one. Regression for the inversion where a pick whose
// usage REPRESENTATIVE was a pre-evolution (a Noivern pick carrying Noibat's
// usage bundle) rendered "Eventual: Noibat" — its past, not its future.
import test from "node:test";
import assert from "node:assert/strict";

const { getCurrentRebornSpeciesForChoice } = await import(
  "../../src/reborn/currentSpecies.js"
);

test("representative ahead of current form reads as future", () => {
  // Froakie input, Greninja representative, cap 25: current is mid-line,
  // the representative is what it becomes.
  const species = getCurrentRebornSpeciesForChoice(
    { inputPokemonId: "froakie", pokemonId: "greninja", name: "Greninja" },
    { levelCap: "25" },
  );
  assert.ok(species.differsFromRepresentative);
  assert.equal(species.representativeIsFuture, true);
});

test("pre-evolution representative must NOT read as future", () => {
  // Noivern input, Noibat representative (its usage bundle), high cap:
  // current is Noivern — Noibat is its past.
  const species = getCurrentRebornSpeciesForChoice(
    { inputPokemonId: "noivern", pokemonId: "noibat", name: "Noibat" },
    { levelCap: "99" },
  );
  assert.equal(species.name, "Noivern");
  assert.ok(species.differsFromRepresentative);
  assert.equal(species.representativeIsFuture, false);
});

test("representative equal to current form is not a future", () => {
  const species = getCurrentRebornSpeciesForChoice(
    { inputPokemonId: "noivern", pokemonId: "noivern", name: "Noivern" },
    { levelCap: "99" },
  );
  assert.equal(species.differsFromRepresentative, false);
  assert.equal(species.representativeIsFuture, false);
});
