// User-verified ground truth: the famous no-TM species (Caterpie/Magikarp/
// Ditto/Wobbuffet-class) cannot learn the code-granted universal TMs — in
// USUM and in Reborn, Wobbuffet's only machine move is its explicitly-listed
// Safeguard. The old movepool-size guard was nearly a no-op (even Caterpie
// cleared it), handing all of them ~15 bogus TMs (Toxic Magikarp, Facade
// Caterpie). Explicit per-species machine listings are still honored.
import test from "node:test";
import assert from "node:assert/strict";
// Side effect: installs the fetch/env/localStorage shims the app modules need.
import "../helpers/harness.mjs";

const { loadRebornLegalMoveData } = await import(
  "../../src/reborn/legalMoves.js"
);

async function tmMoves(pokemonId) {
  const data = await loadRebornLegalMoveData(pokemonId);
  return (data?.moves || [])
    .filter((move) => move.sources?.tm)
    .map((move) => move.id)
    .sort();
}

test("no-TM species carry no universal TMs; explicit listings survive", async () => {
  assert.deepEqual(await tmMoves("wobbuffet"), ["safeguard"]);
  assert.deepEqual(await tmMoves("magikarp"), []);
  assert.deepEqual(await tmMoves("caterpie"), []);
  assert.deepEqual(await tmMoves("ditto"), []);
  assert.deepEqual(await tmMoves("beldum"), []);
  // Reborn's own data explicitly grants Tynamo these two — respected.
  assert.deepEqual(await tmMoves("tynamo"), ["chargebeam", "thunderwave"]);
});

test("ordinary mons keep their universal TMs (positive control)", async () => {
  const pikachu = await tmMoves("pikachu");
  for (const id of ["facade", "substitute", "attract"]) {
    assert.ok(pikachu.includes(id), `pikachu should learn ${id}`);
  }
});
