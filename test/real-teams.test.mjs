// Fieldable real team (realTeams.js): the pure buildability + ranking pieces.
// Synthetic fixtures throughout — nothing here depends on team-index data
// files existing.
import test from "node:test";
import assert from "node:assert/strict";

await import("./helpers/harness.mjs"); // fetch → filesystem shim
const {
  assignMembersToLines,
  compareRealTeams,
  findFieldableRealTeam,
  getLineFieldableIds,
  teamItemsCovered,
} = await import("../src/teamBuilder/realTeams.js");

function makeLine(inputPokemonId, pokemonId = inputPokemonId) {
  return {
    best: {
      inputPokemonId,
      inputName: inputPokemonId,
      pokemonId,
      name: pokemonId,
    },
    bestNonMega: null,
    choiceOptions: [],
  };
}

function makeMember(speciesId, { itemId = null, moveIds = [] } = {}) {
  return {
    species: speciesId,
    speciesId,
    item: itemId,
    itemId,
    ability: "",
    abilityId: "",
    nature: "Serious",
    level: 50,
    evs: {},
    ivs: {},
    moves: [],
    moveIds,
  };
}

function makeTeam(key, weight, count, speciesIds) {
  return {
    key,
    weight,
    count,
    sources: { sample: count },
    formatId: "gen7ou",
    members: speciesIds.map((id) => makeMember(id)),
  };
}

test("line can field input, current, and every delayed form between them", () => {
  const line = makeLine("starly", "staraptor");

  const atFullCap = getLineFieldableIds(line, { levelCap: "100" });
  assert.ok(atFullCap.has("starly"), "delaying evolution is always allowed");
  assert.ok(atFullCap.has("staravia"));
  assert.ok(atFullCap.has("staraptor"));

  const atLowCap = getLineFieldableIds(line, { levelCap: "20" });
  assert.ok(atLowCap.has("staravia"), "current best-reachable at cap 20");
  assert.ok(!atLowCap.has("staraptor"), "not reachable under the cap yet");
});

test("a devolved form is never fieldable", () => {
  const evolvedInput = makeLine("staravia", "staraptor");
  const ids = getLineFieldableIds(evolvedInput, { levelCap: "100" });
  assert.ok(ids.has("staravia"));
  assert.ok(ids.has("staraptor"));
  assert.ok(!ids.has("starly"), "devolving is not allowed");
});

test("assignment: one line covers at most one member, scarcest member seats first", () => {
  // Member 1 can only use line 0, so it must seat first even though member 0
  // (listed earlier) also wants line 0.
  assert.deepEqual(assignMembersToLines([[0, 1], [0]]), [1, 0]);

  // Two members both needing the same single line: no assignment exists.
  assert.equal(assignMembersToLines([[0], [0]]), null);
});

test("item gate aggregates counts across the whole team", () => {
  const members = [
    makeMember("a", { itemId: "leftovers" }),
    makeMember("b", { itemId: "leftovers" }),
    makeMember("c"), // no item always passes
  ];

  assert.equal(teamItemsCovered(members, { leftovers: 1 }), false);
  assert.equal(teamItemsCovered(members, { leftovers: 2 }), true);
  assert.equal(teamItemsCovered([makeMember("c")], {}), true);
});

test("ranking: weight beats count and similarity; ties fall through in order", () => {
  const recommended = new Set(["skarmory"]);
  const heavy = makeTeam("heavy", 10, 3, ["tauros"]);
  const light = makeTeam("light", 2, 9, ["skarmory"]);
  assert.ok(compareRealTeams(heavy, light, recommended) < 0);

  const sameWeight = makeTeam("aaa", 5, 4, ["tauros"]);
  const closer = makeTeam("bbb", 5, 4, ["skarmory"]);
  assert.ok(compareRealTeams(closer, sameWeight, recommended) < 0);

  const twinA = makeTeam("aaa", 5, 4, ["tauros"]);
  const twinB = makeTeam("bbb", 5, 4, ["tauros"]);
  assert.ok(compareRealTeams(twinA, twinB, recommended) < 0, "stable by key");
});

test("findFieldableRealTeam returns the best FIELDABLE team, or null", async () => {
  const lines = [
    makeLine("tauros"),
    makeLine("lapras"),
    makeLine("pinsir"),
    makeLine("heracross"),
    makeLine("skarmory"),
  ];
  const progression = { levelCap: "100" };

  const unfieldable = makeTeam("unfieldable", 99, 9, [
    "dragonite",
    "lapras",
    "pinsir",
    "heracross",
  ]);
  const heavy = makeTeam("heavy", 10, 3, [
    "tauros",
    "lapras",
    "pinsir",
    "heracross",
  ]);
  const light = makeTeam("light", 2, 9, [
    "tauros",
    "lapras",
    "pinsir",
    "skarmory",
  ]);

  const picked = await findFieldableRealTeam({
    teams: [light, unfieldable, heavy],
    lines,
    progression,
    recommendedIds: new Set(["skarmory"]),
  });
  assert.equal(picked.key, "heavy", "weight wins among fieldable teams");

  // Weight/count tie: similarity to the recommended team decides.
  const tieA = makeTeam("aaa", 5, 4, ["tauros", "lapras", "pinsir", "heracross"]);
  const tieB = makeTeam("bbb", 5, 4, ["tauros", "lapras", "pinsir", "skarmory"]);
  const pickedTie = await findFieldableRealTeam({
    teams: [tieA, tieB],
    lines,
    progression,
    recommendedIds: new Set(["skarmory"]),
  });
  assert.equal(pickedTie.key, "bbb");

  // An unmet item requirement blocks fielding outright.
  const needsItems = makeTeam("items", 50, 5, ["tauros", "lapras", "pinsir", "heracross"]);
  needsItems.members[0].itemId = "leftovers";
  needsItems.members[1].itemId = "leftovers";
  const pickedItems = await findFieldableRealTeam({
    teams: [needsItems],
    lines,
    progression: { ...progression, ownedItems: { leftovers: 1 } },
    recommendedIds: new Set(),
  });
  assert.equal(pickedItems, null, "1 owned Leftovers cannot cover 2 members");

  assert.equal(
    await findFieldableRealTeam({ teams: [], lines, progression }),
    null,
  );
});
