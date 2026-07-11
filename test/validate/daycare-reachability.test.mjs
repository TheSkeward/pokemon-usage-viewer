// Daycare reachability (user ruling): "as long as I have daycare unlocked,
// higher evolutions can reach lower evolutions... if I put in Beedrill but
// Kakuna was better, field Kakuna — I can hatch more Weedles. Or if my input
// was Mothim, I'm able to reach the various Wormadams (by breeding and
// evolving a Burmy)." And the flip side the old filter got wrong: WITHOUT
// the daycare, sibling branches are unreachable (an owned Mothim has no path
// to a female Burmy), and genderless lines can never hatch downward at all.
import test from "node:test";
import assert from "node:assert/strict";
import { runPool, progressionAt } from "../helpers/harness.mjs";

function candidateIds(result) {
  return new Set(
    (result.lines[0]?.candidates || []).map((c) => c.candidate?.id),
  );
}

test("daycare opens the whole hatchable family; without it only descendants", async () => {
  const daycare = {
    ...progressionAt({ badge: 8, levelCap: 45 }),
    daycareUnlocked: true,
  };

  // Input Beedrill + daycare: hatch Weedles, field anything in the line.
  const beedrill = candidateIds(
    await runPool({ pool: ["Beedrill"], progression: daycare }),
  );
  assert.ok(beedrill.has("weedle"), "Weedle fieldable via hatching");
  assert.ok(beedrill.has("kakuna"), "Kakuna fieldable via hatching");
  assert.ok(beedrill.has("beedrill") && beedrill.has("beedrillmega"));

  // Without the daycare, an owned Beedrill can never be a Kakuna again.
  const beedrillLocked = candidateIds(
    await runPool({ pool: ["Beedrill"], badge: 8, levelCap: 45 }),
  );
  assert.ok(!beedrillLocked.has("kakuna") && !beedrillLocked.has("weedle"));

  // Sibling branches: Mothim reaches the Wormadams ONLY through a hatched
  // female Burmy — the old filter wrongly offered them without the daycare.
  const mothimLocked = candidateIds(
    await runPool({ pool: ["Mothim"], badge: 8, levelCap: 45 }),
  );
  assert.ok(
    !mothimLocked.has("wormadam") && !mothimLocked.has("wormadamtrash"),
    "no path to a female Burmy without the daycare",
  );
  const mothim = candidateIds(
    await runPool({ pool: ["Mothim"], progression: daycare }),
  );
  assert.ok(
    mothim.has("wormadam") && mothim.has("wormadamtrash"),
    "Wormadams reachable by hatching a Burmy",
  );

  // Genderless lines have no mother: the daycare never reaches downward.
  const magnezone = candidateIds(
    await runPool({ pool: ["Magnezone"], progression: daycare }),
  );
  assert.ok(!magnezone.has("magnemite") && !magnezone.has("magneton"));
});
