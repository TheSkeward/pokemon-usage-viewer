// Canonical sets are sourced from the ULTIMATE EVENTUAL FORM — the line's
// chosen representative (user decision): Venusaur's sets for a Bulbasaur
// input, Lopunny-Mega's AG 1760 sets for a Lopunny whose representative is
// the mega — and the base form's own sets only when the base IS the
// representative (FEAR Rattata's meaningful AG usage makes Rattata its own
// eventual form). This is also the id the optimizer scores with
// (teamOptimizer sources by candidate.id), so what the analysis pane shows
// is built from the same usage data as the score. Before this fix the pane
// re-sourced by the FIELDED form: a Lopunny-Mega pick displayed base
// Lopunny's ZU-primary sets (where fringe Z-Splash usage lives), showing a
// set the score never saw.
import test from "node:test";
import assert from "node:assert/strict";
// Side effect: installs the fetch/env/localStorage shims the app modules need.
import "../helpers/harness.mjs";

const { buildRebornTeamAnalysis } = await import(
  "../../src/reborn/teamAnalysis.js"
);

const PROGRESSION = { levelCap: "75", moveRelearnerUnlocked: true };

async function profileFor(row) {
  const analysis = await buildRebornTeamAnalysis([row], PROGRESSION, {
    family: "singles",
    selection: "all",
  });
  return analysis.profiles[0];
}

test("mega representative sources the mega's tier, not the fielded base form", async () => {
  const profile = await profileFor({
    pokemonId: "lopunnymega",
    name: "Lopunny-Mega",
    inputName: "Lopunny",
  });
  const ids = (profile.recommendedMoves || []).map((move) => move.id);
  // AG 1760 canonical moves that are progression-legal here.
  assert.ok(ids.includes("highjumpkick"), `expected AG set, got: ${ids.join(", ")}`);
  assert.ok(ids.includes("return"), `expected AG set, got: ${ids.join(", ")}`);
  // Base Lopunny's ZU stitch carries fringe Splash usage; the mega's AG data
  // does not — a mega-representative pick must not show ZU's set.
  assert.ok(!ids.includes("splash"), `ZU leakage into a mega pick: ${ids.join(", ")}`);
  assert.equal(profile.recommendedSet?.ability, "Scrappy");
  assert.equal(profile.recommendedSet?.item, "Lopunnite");
});

test("base-form representative keeps its own tier's sets", async () => {
  const profile = await profileFor({
    pokemonId: "lopunny",
    name: "Lopunny",
    inputName: "Lopunny",
  });
  // ZU-sourced set: Klutz is base Lopunny's signature competitive ability.
  assert.equal(profile.recommendedSet?.ability, "Klutz");
  const ids = (profile.recommendedMoves || []).map((move) => move.id);
  assert.ok(ids.includes("return"), `expected ZU set, got: ${ids.join(", ")}`);
});

test("trace mons source their canonical set from their trace tier (user ruling)", async () => {
  // User ruling: a mon below the meaningful bar everywhere still has a best
  // "usage tier" — the tier where it actually sees competitive play (the
  // resolver index's display `trace`). Its canonical set comes from THAT
  // tier, not the deepest tier it merely appears in; its sort stays tailed
  // and the trace value still never enters scoring.
  const { readFile } = await import("node:fs/promises");
  const read = async (p) => JSON.parse(await readFile(p, "utf8"));
  const resolver = await read("site-data/data/resolver-index/singles/all.json");

  for (const pokemonId of ["raticate", "pachirisu"]) {
    const bundle = resolver.pokemon[pokemonId];
    assert.equal(bundle.ranking, null, `${pokemonId} must be a trace mon`);
    assert.ok(bundle.trace, `${pokemonId} must carry a trace tier`);
    const detail = await read(
      `site-data/data/set-index/singles/all/${pokemonId}.json`,
    );
    assert.equal(
      `${detail.formatId}/${detail.cutoff}`,
      `${bundle.trace.formatId}/${bundle.trace.cutoff}`,
      `${pokemonId}'s primary set must come from its trace tier`,
    );
  }

  // Concrete anchors so a silent resolver change can't hollow the test out:
  // Raticate's play is at ZU 1500 (its old primary was the deepest-tier
  // fallback, ZU 0), Pachirisu's at PU 0 (old: ZU 0).
  const raticate = await read("site-data/data/set-index/singles/all/raticate.json");
  assert.equal(`${raticate.formatId}/${raticate.cutoff}`, "gen7zu/1500");
  const pachirisu = await read("site-data/data/set-index/singles/all/pachirisu.json");
  assert.equal(`${pachirisu.formatId}/${pachirisu.cutoff}`, "gen7pu/0");
});
