# Pokemon Pool Team Builder

A static web app for planning Pokemon Reborn playthrough teams from the
Pokemon you currently have available.

The app uses Gen 7 Smogon usage data as a prior for which forms, sets, and
teammates are worth considering, then checks those ideas against Reborn
progression: level caps, TMs/TMXs, tutors, move relearner, daycare, evolution
access, held items, legal moves, coverage, and defensive fit.

Live site:

https://theskeward.github.io/pokemon-usage-viewer/

## Features

- Paste an owned Pokemon pool and get a recommended team.
- Track Reborn progression locally in your browser.
- Inspect legal current moves, recommended sets, breeding chains, item picks,
  coverage, defensive profile, confidence, and level-cap investment.
- Look up observed Gen 7 set details for a Pokemon or evolutionary line.
- Browse the underlying usage data.

## Running Locally

```bash
npm install
npm run dev
```

The dev server runs at:

```text
http://localhost:5173/
```

Production build:

```bash
npm run build
npm run preview
```

## Useful Commands

```bash
npm test                       # fast mechanical/correctness tests
npm run validate:calibration   # badge-bucket scorer calibration
npm run e2e                    # browser-level smoke tests
npm run build:site             # manifest + Vite build + copied static data
npm run refresh:data           # regenerate checked-in Smogon/Reborn-derived data
```

The app is fully static. Runtime data is checked in under `site-data/data/`,
and generated JS modules are checked in under `src/generated/`, so ordinary
builds do not need network access.

## Project Layout

```text
index.html / src/main.js      Main app
pool.html  / src/poolApp.js   Team Builder-only page
src/app/                       App shell and page wiring
src/views/                     Shared render views
src/teamBuilder/               Pool parsing, scoring, search, confidence, UI
src/reborn/                    Reborn progression, legality, analysis, damage
src/resolver/                  Input-name and representative resolution
src/setDetails/                Precomputed set-detail loading
src/generated/                 Checked-in generated modules
site-data/data/                Checked-in runtime JSON
scripts/                       Data generation scripts
test/                          Fast correctness, E2E, and badge-anchor calibration
```

The scoring model and its change policy are documented in `SCORING.md`.
Read that before changing optimizer behavior or scoring constants.

## Data And Cache Notes

- If generated data changes, run `npm run build:manifest` before committing.
  The manifest hashes runtime data and generated modules so browser caches can
  invalidate correctly.
- If optimizer output changes without a data-signature change, bump
  `RESULT_CACHE_VERSION` in `src/teamBuilder/teamOptimizer.js`.
- `npm run refresh:data` may need network access because it downloads Smogon
  stats.

## Deploy

GitHub Actions builds and deploys the app to GitHub Pages from `main`.
Scheduled refreshes can update generated data and commit those results back to
the repository.

## Known Limits

- Mega and Z availability are not currently progression-gated.
- Very large pools use a coverage-preserving shortlist when full exact search
  would be too expensive.
- The level-cap investment view advances the level cap only; it does not model
  future TM, tutor, item, or location unlocks.
