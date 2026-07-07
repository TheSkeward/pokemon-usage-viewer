// Display-layer contracts for the informative tooltips: the moveset panel's
// rendered HTML must carry the nature (+/− stats), the spread's real stat
// line, and per-move facts — computed from the same tables the app ships.
// Renders with a stub container; no optimizer, no fetches.
import test from "node:test";
import assert from "node:assert/strict";

globalThis.__ENV__ ??= { BASE_URL: "/" };
const { renderMovesetPanel } = await import("../src/views/movesetView.js");
const { describeNature, NATURE_EFFECTS } = await import("../src/natures.js");
const { computeFinalStats } = await import("../src/reborn/damageModel.js");

function renderToHtml(options) {
  const container = {
    innerHTML: "",
    querySelectorAll: () => [],
    querySelector: () => null,
  };
  renderMovesetPanel(container, options);
  return container.innerHTML;
}

test("moveset panel: nature, spread stats, and move facts render as titles", () => {
  const html = renderToHtml({
    selectedPokemonName: "Blissey",
    movesetEntry: {
      moves: [{ name: "Seismic Toss", usage: 92.1 }],
      items: [{ name: "Leftovers", usage: 70.2 }],
      abilities: [{ name: "Natural Cure", usage: 95.0 }],
      spreads: [{ name: "Bold:252/0/252/0/4/0", usage: 41.3 }],
    },
    lookupLabel: "gen7uu",
  });
  assert.match(html, /Bold: \+Def, −Atk/);
  // Blissey's canonical max-HP line — pins the stat formula end to end.
  assert.match(html, /At Lv 100 \(31 IVs\): HP 714 · Atk 50 · Def 130/);
  assert.match(html, /title="Seismic Toss — Fighting · Physical/);
});

test("nature table is complete and internally consistent", () => {
  const names = Object.keys(NATURE_EFFECTS);
  assert.equal(names.length, 25);
  const neutral = names.filter((name) => !NATURE_EFFECTS[name].plus);
  assert.equal(neutral.length, 5);
  const statKeys = new Set(["atk", "def", "spa", "spd", "spe"]);
  for (const name of names) {
    const { plus, minus } = NATURE_EFFECTS[name];
    if (!plus) {
      assert.equal(minus, undefined, `${name} half-neutral`);
      continue;
    }
    assert.ok(statKeys.has(plus) && statKeys.has(minus), name);
    assert.notEqual(plus, minus, name);
    assert.match(describeNature(name), /\+\w+, −\w+/);
  }
  // Unknown natures produce no tooltip rather than a wrong one.
  assert.equal(describeNature("Bold Adamant"), "");
});

test("computeFinalStats matches known reference stat lines", () => {
  // Lv-50 max-speed Jolly Garchomp — a number every builder site agrees on.
  const garchomp = computeFinalStats({
    pokemonId: "Garchomp",
    level: 50,
    nature: "Jolly",
    evs: [0, 252, 0, 0, 4, 252],
  });
  assert.equal(garchomp.spe, 169);
  assert.equal(garchomp.atk, 182);
  // Shedinja's HP is 1 regardless of investment.
  const shedinja = computeFinalStats({
    pokemonId: "Shedinja",
    level: 100,
    nature: "Adamant",
    evs: [252, 252, 0, 0, 0, 4],
  });
  assert.equal(shedinja.hp, 1);
  // Unknown species: null, not a throw. (Not "missingno" — @pkmn/dex ships
  // that one with real base stats, [136, 0, 6, 6, 29].)
  assert.equal(
    computeFinalStats({ pokemonId: "notarealmon", level: 50, nature: "Bold", evs: [] }),
    null,
  );
});
