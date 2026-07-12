// Display-only seen-within-N-games relaxation (bench tail labels). The
// meaningful bar is 50%-seen-within-25-games (≈2.73%); below it, the label's
// N is the smallest 5-step ≥ the exact horizon for that usage.
import test from "node:test";
import assert from "node:assert/strict";
import {
  BASE_SEEN_GAMES,
  SEEN_GAMES_STEP,
  gamesToLikelySee,
} from "../src/teamBuilder/traceUsage.js";

globalThis.__ENV__ ??= { BASE_URL: "/" };
const { getSortedTeam } = await import(
  "../src/teamBuilder/teamBuilderView.js"
);

test("gamesToLikelySee inverts the 50%-seen bar and steps by 5", () => {
  // Exact horizons: ln(0.5)/ln(1−v). 2.5% → 27.4 → 30; 2.0% → 34.3 → 35;
  // 1.0% → 69.0 → 70; 0.5% → 138.3 → 140.
  assert.equal(gamesToLikelySee(2.5), 30);
  assert.equal(gamesToLikelySee(2.0), 35);
  assert.equal(gamesToLikelySee(1.0), 70);
  assert.equal(gamesToLikelySee(0.5), 140);

  // Band edges are exclusive on the fast side: exactly the N=30 bar
  // (≈2.284%) qualifies at 30, a hair above it still needs 30, a hair below
  // the 25-bar can never label better than the first relaxation step.
  const bar = (n) => 100 * (1 - 0.5 ** (1 / n));
  assert.equal(gamesToLikelySee(bar(30)), 30);
  assert.equal(gamesToLikelySee(bar(25) - 1e-9), 30);

  // Defensive floor: values at/above the meaningful bar (which should never
  // reach this code — they carry a ranking) still clamp to the first step.
  assert.equal(gamesToLikelySee(5), BASE_SEEN_GAMES + SEEN_GAMES_STEP);

  // No usage stays honest "no usage data".
  assert.equal(gamesToLikelySee(0), null);
  assert.equal(gamesToLikelySee(null), null);
  assert.equal(gamesToLikelySee(undefined), null);
});

test("team-table tier sort puts the trace tail in bench order", () => {
  // The user's repro pool: ranked mons first by tier ladder, then the
  // unranked TAIL ordered games ascending → tier ladder → trace usage,
  // no-usage dead last. Scores are deliberately arranged so the old
  // fall-through (score desc across the whole unranked tie) would produce
  // Pachirisu (235) → Noctowl (50) → Raticate (35) — the reported bug.
  const row = (name, score, bundle) => ({ name, score, bundle });
  const team = [
    row("Pachirisu", 1324, { trace: { tierRank: 5, value: 0.3 } }), // PU, 235 games
    row("Noctowl", 1053, { trace: { tierRank: 6, value: 1.5 } }), // ZU, 50 games
    row("Raticate", 1020, { trace: { tierRank: 6, value: 2.0 } }), // ZU, 35 games
    row("Greninja", 1442, { ranking: { tierRank: 0, value: 2.8 } }),
    row("Arbok", 845, { ranking: { tierRank: 6, value: 5.4 } }),
    // Same 50-game horizon as Noctowl but a shallower tier — the ruling's
    // "UU 0 (65) before ZU 1630 (65)" case.
    row("Watchog", 900, { trace: { tierRank: 2, value: 1.5 } }),
    // Highest score but no usage anywhere: must not float, must sink.
    row("Mothim", 2000, {}),
  ];

  const sorted = getSortedTeam(team, "tier", "desc");
  assert.deepEqual(
    sorted.map((entry) => entry.name),
    ["Greninja", "Arbok", "Raticate", "Watchog", "Noctowl", "Pachirisu", "Mothim"],
  );
});
