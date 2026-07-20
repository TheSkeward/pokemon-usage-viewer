// The interim-donor guide (user story: a recommended set breeds a move from a
// donor, so the player fields the donor for a while and needs to know how to
// use it). End-to-end through the real analysis pipeline: a member whose
// recommended set leans on egg moves gets donorInterimGuides naming each
// donor with the donor's OWN recommended moves at the current progression.
import test from "node:test";
import assert from "node:assert/strict";

globalThis.__ENV__ ??= { BASE_URL: "/" };
const { buildRebornTeamAnalysis, collectEggDonorRequests } = await import(
  "../src/reborn/teamAnalysis.js"
);
const { progressionAt, loadShared } = await import("./helpers/harness.mjs");
const {
  buildRebornBreedingContext,
  compareBreedingCosts,
} = await import("../src/reborn/breeding.js");

test("breeding cost keeps hops primary, then minimizes acquisition level", () => {
  const highLevelDirect = {
    hops: 1,
    level: 99,
    path: ["Direct"],
  };
  const lowLevelDirect = {
    hops: 1,
    level: 37,
    path: ["Low-level direct"],
  };
  const lowLevelTwoHop = {
    hops: 2,
    level: 1,
    path: ["Root", "Relay"],
  };

  assert.ok(compareBreedingCosts(lowLevelDirect, highLevelDirect) < 0);
  assert.ok(compareBreedingCosts(highLevelDirect, lowLevelTwoHop) < 0);
});

test("collectEggDonorRequests keys on egg-best moves and dedupes by donor", () => {
  const eggSource = (donorName, detail, donorLevel = null) => ({
    kind: "egg",
    label: "Egg",
    detail,
    donorName,
    donorLevel,
  });
  const profile = {
    recommendedMoves: [
      { name: "Spikes", availableSources: [eggSource("Sneasel", "@ 1")] },
      { name: "Ice Shard", availableSources: [eggSource("Sneasel", "@ 8", 8)] },
      // TM beats egg in source priority — must NOT request a donor.
      {
        name: "Protect",
        availableSources: [{ kind: "tm", label: "TM" }, eggSource("Sneasel", "")],
      },
      // Egg source without a donor name (legacy shape) is skipped.
      { name: "Splash", availableSources: [{ kind: "egg", label: "Egg" }] },
    ],
  };
  const requests = collectEggDonorRequests(profile);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].donorId, "sneasel");
  assert.deepEqual(
    requests[0].moves.map((move) => [move.name, move.donorLevel]),
    [
      ["Spikes", null],
      ["Ice Shard", 8],
    ],
  );
});

test("analysis attaches donor guides with the donor's own interim moves", async () => {
  const { pokemonIndex } = await loadShared();
  const progression = {
    ...progressionAt({ badge: 18, levelCap: 100 }),
    daycareUnlocked: true,
  };
  const analysis = await buildRebornTeamAnalysis(
    [{ pokemonId: "delibird", name: "Delibird", inputName: "Delibird" }],
    progression,
    {
      family: "singles",
      selection: "all",
      pokemonIndex,
      // Beartic is a deliberate temptation: it donates Icicle Crash to
      // Sneasel by egg, and the guide must NOT recommend breeding a move
      // onto a temporary donor.
      query: "Delibird\nSneasel\nSquirtle\nBeartic",
    },
  );

  const delibird = (analysis.profiles || []).find(
    (p) => p.currentId === "delibird",
  );
  assert.ok(delibird, "analysis must include Delibird's profile");

  const guides = delibird.donorInterimGuides || [];
  assert.ok(
    guides.length >= 1,
    "an egg-heavy recommended set must attach at least one donor guide",
  );
  for (const guide of guides) {
    assert.ok(guide.donorName, "guide names its donor");
    assert.ok(
      Array.isArray(guide.forMoves) && guide.forMoves.length >= 1,
      "guide lists which recommended moves the donor supplies",
    );
    assert.ok(
      Array.isArray(guide.moves),
      "guide carries the donor's own recommended interim moves",
    );
  }

  // The donor's working life ends one level below the move it levels into
  // (user: "if the interim donor is a Beedrill at level 32, the guide should
  // assume that he's 31"). Sneasel learns Ice Shard at 47, so its guide is
  // pinned at 46 — and the donated move itself never appears as an interim
  // move, because the donor retires the moment it learns it.
  const sneasel = guides.find((guide) => guide.donorId === "sneasel");
  assert.ok(sneasel, "Sneasel donates Ice Shard in this pool");
  assert.equal(sneasel.interimLevelCap, 46);
  assert.equal(sneasel.interimCapped, true);
  assert.ok(
    !sneasel.moves.some((move) => move.name === "Ice Shard"),
    "the donated move is above the donor's working cap",
  );

  // A temporary donor never gets egg moves bred onto it: no
  // interim move may be egg-sourced unless it's a move the donor is itself
  // passing on (a chain link reaches it by hatching).
  assert.ok(
    !sneasel.moves.some((move) => move.name === "Icicle Crash"),
    "no breeding projects onto a temporary donor",
  );
  for (const guide of guides) {
    const donated = new Set(guide.forMoves.map((move) => move.name));
    for (const move of guide.moves) {
      if (donated.has(move.name)) continue;
      assert.ok(
        !String(move.sourceLabel || "").startsWith("Egg"),
        `${guide.donorName}'s interim ${move.name} must not be egg-sourced`,
      );
    }
  }
  // The guides are display data only: they hang off the profile and never
  // touch the member objects that feed coverage/scoring.
  for (const member of analysis.members) {
    assert.equal(member.donorInterimGuides, undefined);
  }
});

// Donor selection minimizes the learn level after breeding-hop count, even
// when the lower-level learner is a less-evolved form.
test("donor routes prefer Starly@37 over Staravia@43", async () => {
  const { pokemonIndex } = await loadShared();
  const braveBirdSourceAt = async (levelCap) => {
    const context = await buildRebornBreedingContext({
      pokemonIndex,
      progression: {
        ...progressionAt({ badge: 5, levelCap }),
        daycareUnlocked: true,
      },
      query: "Dodrio\nStaraptor",
    });
    return context.byPokemonId.dodrio.sources.bravebird;
  };

  const at45 = await braveBirdSourceAt(45);
  assert.equal(at45.donorName, "Starly");
  assert.equal(at45.donorLevel, 37);
  assert.equal(at45.detail, "Starly breeding chain (@37)");

  const at40 = await braveBirdSourceAt(40);
  assert.equal(at40.donorName, "Starly");
  assert.equal(at40.donorLevel, 37);
  assert.equal(at40.detail, "Starly breeding chain (@37)");
});

test("equal-hop donor families prefer the earlier learn level", async () => {
  const { pokemonIndex } = await loadShared();
  const context = await buildRebornBreedingContext({
    pokemonIndex,
    progression: {
      ...progressionAt({ badge: 5, levelCap: 45 }),
      daycareUnlocked: true,
    },
    query: "Abomasnow\nBreloom\nBulbasaur",
  });
  const at45 = context.byPokemonId.abomasnow.sources.seedbomb;
  assert.equal(at45.donorName, "Shroomish");
  assert.equal(at45.donorLevel, 36);
  assert.match(at45.sourceTitle, /Bulbasaur breeding chain \(@37\)/);
});
