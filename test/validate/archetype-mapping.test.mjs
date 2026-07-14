// Form/archetype prior mapping (mathy-friend work order #1). The separation:
//   - PRESENCE is a LINE property ("something in this line has competitive
//     merit") — drives the dead/present convergence-law selector.
//   - MAGNITUDE (U_rank / the ceiling) is a FORM/archetype property — each
//     fielded form scores against ITS OWN prior.
// Invariant under test: a fielded form receives readiness for the archetype
// it actually matches; it neither loses its own prior because another form of
// the line ranks higher, nor inherits another form's prior merely by sharing
// a line. Plus the mega-readiness consistency fix (a base form that megas in
// battle IS the competitive object → online, not merely near-final).
import test from "node:test";
import assert from "node:assert/strict";
import { runPool, bestChoice, progressionAt } from "../helpers/harness.mjs";

const ENDGAME = {
  progression: {
    ...progressionAt({ badge: 18, levelCap: 100 }),
    daycareUnlocked: true,
    moveRelearnerUnlocked: true,
  },
};

function candidatesOf(result, input) {
  const line = result.lines.find(
    (l) => (l.best || l.bestNonMega)?.inputName === input,
  );
  return Object.fromEntries(
    (line.candidates || []).map((c) => [c.candidate?.id, c]),
  );
}

test("magnitude is per-form: line-mates do NOT share a prior", async () => {
  // Scyther line: three fieldable archetypes (scyther / scizor / scizor-mega),
  // each with a distinct competitive record. Every candidate must carry its
  // OWN ceiling — no inheritance from the line's shallowest-tier form.
  const result = await runPool({ pool: ["Scyther", "Delibird"], ...ENDGAME });
  const c = candidatesOf(result, "Scyther");
  assert.ok(c.scyther && c.scizor, "both forms must be scored");
  assert.notEqual(
    Math.round(c.scyther.ceiling),
    Math.round(c.scizor.ceiling),
    "distinct forms must not share a U",
  );
  // The shallower-tier form has the higher (or equal) prior, per form.
  assert.ok(
    c.scizor.tierRank < c.scyther.tierRank && c.scizor.ceiling > c.scyther.ceiling,
    `scizor (tier ${c.scizor.tierRank}, U ${Math.round(c.scizor.ceiling)}) must out-prior scyther (tier ${c.scyther.tierRank}, U ${Math.round(c.scyther.ceiling)})`,
  );
});

test("competitive pre-evo stronger than final: pre-evo is fielded on its own prior", async () => {
  // Chansey/Blissey — the canonical case. The Eviolite pre-evo carries a
  // shallower record than its evolution; the line must be allowed to FIELD
  // the pre-evo (not force-evolve), scoring it on its own prior.
  const result = await runPool({ pool: ["Chansey", "Delibird"], ...ENDGAME });
  const c = candidatesOf(result, "Chansey");
  assert.ok(c.chansey && c.blissey, "both forms must be scored");
  assert.ok(
    c.chansey.tierRank <= c.blissey.tierRank,
    `Chansey's record (tier ${c.chansey.tierRank}) must be at least as shallow as Blissey's (tier ${c.blissey.tierRank})`,
  );
  const fielded =
    bestChoice(result, "Chansey").legalityProfile?.currentId;
  assert.equal(
    fielded,
    "chansey",
    "the stronger pre-evo archetype must be the fielded form",
  );
});

test("only one form present: the absent form does not inherit the prior", async () => {
  // Excadrill line: the final form has a real record; the pre-evo does not.
  // The pre-evo must keep its OWN (deep/empty) prior, not borrow Excadrill's.
  const result = await runPool({ pool: ["Excadrill", "Delibird"], ...ENDGAME });
  const c = candidatesOf(result, "Excadrill");
  assert.ok(c.excadrill && c.drilbur, "both forms must be scored");
  assert.ok(
    c.drilbur.tierRank > c.excadrill.tierRank &&
      c.drilbur.ceiling < c.excadrill.ceiling,
    `drilbur must keep its own weaker prior (tier ${c.drilbur.tierRank} U ${Math.round(c.drilbur.ceiling)}) vs excadrill (tier ${c.excadrill.tierRank} U ${Math.round(c.excadrill.ceiling)})`,
  );
});

test("mega readiness: a base form that megas in battle is online, not near-final", async () => {
  // The competitive object is the mega; you field its base and it transforms.
  // getReadinessGate must map mega → base (like computeUsageRamp), or the
  // fielded base reads as perpetually near-final.
  const result = await runPool({ pool: ["Scizor", "Delibird"], ...ENDGAME });
  const c = candidatesOf(result, "Scizor");
  const mega = c.scizormega;
  assert.ok(mega, "the mega archetype must be a scored candidate");
  assert.equal(
    mega.legalityProfile?.currentId,
    "scizor",
    "the mega archetype is fielded as its base form",
  );
  assert.equal(
    mega.online,
    1,
    "a base form that megas is online (fieldable), not near-final",
  );
});
