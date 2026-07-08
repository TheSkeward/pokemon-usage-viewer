// Invariant 1 enforcement (usage informative, never sovereign): a line's
// representative is its highest-SCORING candidate — no boolean usage gate may
// override score. Discovered via Abra at badge 4 / cap 45: Kadabra outscored
// Alakazam (Link Stone friction exceeded the stage-compressed C gap) but the
// old meaningfulUsage-first comparator silently seated Alakazam anyway.
// And the friction side must be honest: OWNING the Link Stone zeroes the
// acquisition cost, at which point Alakazam's raw C advantage wins again.
import test from "node:test";
import assert from "node:assert/strict";
import { runPool, loadShared, progressionAt } from "../helpers/harness.mjs";

const { optimizeTeamFromPool } = await import(
  "../../src/teamBuilder/teamOptimizer.js"
);

const POOL = ["Machop", "Growlithe", "Poliwag", "Abra", "Tentacool", "Ponyta",
  "Magnemite", "Doduo", "Gastly", "Rhyhorn", "Horsea", "Scyther", "Eevee",
  "Dratini", "Mareep", "Hoppip"];

function lineFor(result, inputName) {
  return result.lines.find(
    (line) => (line.best || line.bestNonMega)?.inputName === inputName,
  );
}

test("line representative is the highest-scoring candidate (score is sovereign)", async () => {
  const result = await runPool({ pool: POOL, badge: 4, levelCap: 45 });
  for (const line of result.lines) {
    const best = line.best || line.bestNonMega;
    if (!best) continue;
    const maxScore = Math.max(
      ...line.candidates
        .map((candidate) => candidate.score)
        .filter(Number.isFinite),
    );
    assert.ok(
      best.score >= maxScore - 1e-9,
      `${best.inputName}: representative ${best.pokemonId} scores ${Math.round(best.score)} but a candidate scores ${Math.round(maxScore)} — a non-score gate overrode the model`,
    );
  }
});

test("owning the Link Stone zeroes trade friction and flips the Abra verdict", async () => {
  const { availability, pokemonIndex } = await loadShared();
  const base = progressionAt({ badge: 4, levelCap: 45 });

  const withStone = await optimizeTeamFromPool({
    availability,
    family: "singles",
    pokemonIndex,
    progression: { ...base, ownedItems: { linkstone: 1 } },
    query: POOL.join("\n"),
    selection: "all",
  });
  const abra = lineFor(withStone, "Abra");
  const alakazam = abra.candidates.find((c) => (c.candidate?.id ?? c.pokemonId) === "alakazam");
  assert.equal(
    Math.round(alakazam.friction),
    0,
    "owned Link Stone must zero the trade-evolution friction",
  );
  const fielded = (abra.best || abra.bestNonMega).legalityProfile?.currentId;
  assert.equal(
    fielded,
    "alakazam",
    "with the stone in hand, Alakazam's C advantage should win the line",
  );
});

test("low-usage rows do not duplicate the Source column as trace notes", async () => {
  const result = await runPool({
    pool: ["Bidoof", "Ekans", "Hoothoot", "Meowth", "Patrat", "Pidgey", "Rattata", "Spinarak"],
    badge: 1,
    levelCap: 20,
  });
  const notes = result.lines.flatMap((line) =>
    [line.best, line.bestNonMega, ...(line.choiceOptions || [])]
      .filter(Boolean)
      .map((choice) => choice.note || ""),
  );

  assert.ok(
    !notes.some((note) => /trace usage/i.test(note)),
    `trace note should not be emitted; notes were: ${notes.filter(Boolean).join(" | ")}`,
  );
});
