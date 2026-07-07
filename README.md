# Pokémon Pool Team Builder

A Vite + vanilla-JavaScript static web app for planning **Pokémon Reborn**
playthrough teams. Competitive Gen 7 Smogon usage data is the empirical prior
for which Pokémon, forms, sets, and teammates are worth considering; the
product centre is Reborn legality, badge-keyed progression, type coverage and
defensive fit. Fully static (precomputed JSON + a JS bundle), deployed to
GitHub Pages.

## The three tabs

- **Set Lookup** – search a Pokémon and inspect its observed Smogon set
  details: primary source tier, additional set options, related forms.
- **Team Builder** – paste the pool of Pokémon you actually own; the app
  resolves each input to its evolutionary line, scores every line at your
  current progression, and picks the best six with damage-aware coverage,
  shared-weakness fit, and competitive teammate synergy (max one Mega). Below
  the team: full Team Analysis (recommended sets, breeding chains, defense and
  coverage tables), a confidence/robustness sweep, and a level-cap investment
  projection.
- **Usage Data** – browse the raw Smogon usage tables everything is built from.

## Development

```bash
npm install
npm run dev            # dev server on http://localhost:5173
npm run build          # production bundle into dist/
npm run preview        # preview the production build
npm test               # unit tests (fast)
npm run validate       # full validation suite — REAL optimizer over committed
                       # data, ~3–4 minutes on 4 cores; run before every commit
npm run update-goldens # validate with UPDATE_GOLDENS=1: rewrites drifted
                       # golden snapshots in place (see Scoring policy below)
```

In dev, JSON under `site-data/data/` is served at `/data/...` by a small Vite
middleware (`vite.config.js`). Do not edit `src/` while `npm run validate` is
running — the suite imports modules lazily mid-run.

## Project layout

```
index.html / src/main.js      Main single-page app (the three tabs)
pool.html  / src/poolApp.js   Standalone mount of just the Team Builder widget
src/
  app/          App shell, page renderers, event wiring
  views/        Stateless render functions (Usage Data / Set Lookup / movesets)
  teamBuilder/  Candidate scoring, search kernel, team selection, confidence
                sweep, investment projection, explanations, telemetry
  reborn/       Reborn legality, badge timeline, breeding, evolution gates,
                damage model, team analysis (+ its view)
  resolver/     Maps pool input lines to representative Pokémon
  setDetails/   Loads precomputed Smogon set-detail JSON for Set Lookup
  utils/        Shared helpers (html escaping, /data URLs, id normalizing)
  generated/    CHECKED-IN generated modules (*.generated.js) — never edit by
                hand; regenerate via the script named in each file's header
site-data/data/ Precomputed static JSON consumed at runtime (also committed)
scripts/        The reproducible data-generation pipeline
test/           unit tests, test/validate/ suite, test/golden/ snapshots
SCORING_V0.md   The scoring model spec + its full audited change history
```

## Scoring in one paragraph (and where the details live)

Each candidate is scored `V = C + usage-blend + bias − friction`: a hand-built
current-form value `C` (legal moves, stats, role) blended toward a competitive
usage prior as the mon's canonical set becomes buildable at your progression.
Two models ship: **V0** (frozen baseline: usage influence capped, upside-only)
and **V1** (default: usage trust `w` ramps with set readiness and level cap;
at full convergence the score IS the usage prior, hand-built team-fit
judgements fade out, and competitive teammate co-use lift fades in — bias
never fades). Team selection maximizes `Σ member scores + 0.5 × team fit`
where fit = damage-aware coverage (noisy-OR), shared-weakness penalties, and
the synergy term. **`SCORING_V0.md` is the authoritative spec and changelog**;
all constants live in `src/teamBuilder/scoringConstants.js`.

**Change policy (imposed by the validate suite):** the 8 V0 golden snapshots
must stay byte-stable unless a change is deliberately output-changing — in
which case run `npm run update-goldens`, audit the diff, and record what
changed and why in `SCORING_V0.md`'s changelog **in the same commit**. The V1
golden follows the same rule. Some tests (teammate-synergy, usage-convergence)
pin relationships in the shipped Smogon data; a monthly data refresh can
legitimately drift them — re-verify, don't just re-pin.

## Data pipeline

All generated data is checked in, so the site builds with no network access.
Full regeneration (needs network access to smogon.com — works in CI, may be
blocked in sandboxed dev containers):

```bash
npm run refresh:data && npm run build:manifest
```

| Script | Output | Source |
| --- | --- | --- |
| `build:data` | usage tables + availability index (`site-data/data`) | smogon.com stats |
| `build:resolver-index` | input → representative resolution | usage tables |
| `build:set-index` | per-mon set details | smogon.com moveset text |
| `build:move-meta` | `gen7MoveMeta.generated.js` (BP/acc/priority/roles) | @pkmn/dex |
| `build:item-damage` | item damage modifiers | @pkmn/dex |
| `build:reborn-legal-moves` | per-mon Reborn-legal moves | Reborn `mons.dat` |
| `build:progression-species` | evolution/learnset species data | @pkmn/dex |
| `build:held-items` | wild held-item table | @pkmn/dex |
| `build:unburden-species` | Unburden species list | @pkmn/dex |
| `build:base-stats` | base stats + HP + totals | @pkmn/dex |
| `build:gen5-items` | Gen 5 item usage (immutable history) | smogon.com |
| `build:teammate-index` | per-mon teammate co-use lift (synergy term) | smogon.com moveset text |
| `build:item-timeline` | `rebornItemTimeline.generated.js` | curated sheet extract — **manual only**, not in `refresh:data` |
| `build:manifest` | `site-data/data/manifest.json` | hashes of everything above |

**The manifest is the consistency keystone.** It hashes `site-data/data` and
`src/generated` into a `dataSignature`; the optimizer folds that signature
into every cache key (so stale caches die on refresh) and the update notifier
polls the deployed manifest to show the "new data available" banner. **Any
commit that changes data or generated modules must regenerate the manifest in
the same commit** (`npm run build:manifest` — the scheduled CI refresh does
this automatically; humans must remember).

`RESULT_CACHE_VERSION` (`src/teamBuilder/teamOptimizer.js`) versions the
persisted result cache — bump it whenever optimizer OUTPUT changes shape or
meaning without a data-signature change (the comment above it is the log).

## CI / deploy

One workflow, `.github/workflows/deploy.yml`:

- **push to main** (source/data paths only) → build + deploy to Pages.
- **daily schedule** (10:17 UTC) → `refresh:data` + `build:manifest`, commit
  `site-data/data` + `src/generated` back to main as the actions bot, then
  build + deploy. Bot pushes don't retrigger the workflow (GITHUB_TOKEN).
- **Pages flakiness**: the artifact is large and the Pages sync phase
  intermittently fails with "Deployment failed, try again later" — a
  GitHub-side flake ([community thread](https://github.com/orgs/community/discussions/200823)).
  The deploy job retries once after a 5-minute wait; a multi-hour Pages
  incident still fails the run, and the next push or scheduled run heals it.

## Reborn legality model

Implemented in `src/reborn/`, generated from the game's own `mons.dat`:

- Base legality is USUM learnsets; transfer-only moves excluded. Gen 7 TMs
  apply; Fly/Surf/Waterfall are TMXs; Power-Up Punch, Struggle Bug and Secret
  Power are promoted to TMs.
- Level-up moves respect the level cap, the form's ARRIVAL level (you can't
  level a Vigoroth below 18... but Common Candy makes below-arrival levels ≥2
  reachable again), and relearner gating for level-1-only moves.
- Egg moves need the daycare unlocked and a real breeding chain through your
  pool; chains prefer the fewest hops, then the earliest acquisition, and
  credit the form that actually learns the move.
- Evolutions are gated per-method (stones, friendship, trade/Link Stone,
  magnetic field, ...) via the progression panel's evolution-access toggles.
- Progression is badge-keyed: the walkthrough timeline
  (`src/reborn/badgeTimeline.js`, from BIGJRA's community walkthrough) drives
  the level cap, item availability, and TM/tutor unlock hints.

## Known limitations (deliberate)

- **Mega/Z availability is not gated** by progression — Megas can be
  recommended before the Mega Ring exists in-game (owner's call: left as-is).
- Pools above the exact-search combination budget use a coverage-preserving
  shortlist ("fast approximate" in the UI) — exact on the shortlist, not the
  whole pool.
- The investment projection moves ONLY the level cap forward; future badges'
  TMs/tutors/items/locations are not modeled (the UI says so).
- Ability/item effect text and synergy "why seated" lift lines are designed
  but unbuilt (see SCORING_V0.md changelog for the accepted design).
- `test/helpers/harness.mjs` runs the real optimizer against committed data
  with fetch shimmed to the filesystem — there are no browser/DOM tests
  beyond targeted render smokes.
