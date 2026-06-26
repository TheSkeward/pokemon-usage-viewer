# Pokémon Pool Team Builder

A Vite + vanilla-JavaScript static web app for planning **Pokémon Reborn**
playthrough teams. Competitive Gen 7 Smogon usage data is used as an empirical
prior for which Pokémon and forms are worth considering, but the product centre
is Reborn legality, progression, type coverage and defensive fit.

The site is fully static (precomputed JSON + a small JS bundle) and deploys to
GitHub Pages.

## Features

The app has three tabs:

- **Set Lookup** – search a Pokémon and inspect its observed Smogon set
  details: primary source, additional set options, related forms/evolutions,
  and per-move type/category badges.
- **Team Builder** – paste a pool of currently available Pokémon; the app
  normalizes/dedupes names, recommends one representative per family (max one
  Mega), scores the team for coverage and defensive fit, and produces a team
  analysis with current legal movesets.
- **Usage Data** – browse the raw Smogon usage tables the recommendations are
  built from.

## Development

```bash
npm install
npm run dev        # dev server on http://localhost:5173
npm run build      # production build into dist/
npm run preview    # preview the production build
```

In dev, JSON under `site-data/data/` is served at `/data/...` by a small Vite
middleware (see `vite.config.js`). `npm run build:site` runs the build and then
copies that data into `dist/` for deployment.

## Project layout

```
index.html / src/main.js      Main single-page app (the three tabs)
pool.html  / src/poolApp.js   Standalone mount of just the Team Builder widget
src/
  app/        App shell, page renderers, event wiring, focus handling
  views/      Stateless render functions for the Usage Data / Set Lookup UI
  teamBuilder/Pool parsing, candidate scoring, team selection/optimizer
  reborn/     Reborn legality, progression, breeding, type chart, team analysis
  resolver/   Maps pool input lines to representative Pokémon + movesets
  setDetails/ Loads precomputed Smogon set-detail JSON for Set Lookup
  utils/      Shared helpers (html escaping, /data URL building, id normalizing)
  generated/  Checked-in generated data modules (*.generated.js)
site-data/data/               Precomputed static JSON consumed at runtime
scripts/                      Reproducible data-generation pipeline
```

## Data pipeline

Generated data is checked in so the site needs no build-time network access.
To regenerate it:

```bash
npm run refresh:data
```

which runs, in order:

| Script | Output |
| --- | --- |
| `build:data` | Smogon usage tables + availability index |
| `build:resolver-index` | input-line → representative resolution data |
| `build:set-index` | per-Pokémon Smogon set detail JSON |
| `build:reborn-legal-moves` | per-Pokémon Reborn-legal move JSON |
| `build:progression-species` | Gen 7 progression/learnset species data |

Learnsets come from [`@pkmn/dex`](https://github.com/pkmn/ps) Gen 7 data. The
GitHub Actions workflow (`.github/workflows/deploy.yml`) can optionally refresh
this data on a schedule before deploying.

## Reborn legality model

Move legality is computed from USUM learnsets plus Reborn-specific rules
(implemented in `src/reborn/`):

- Base legality is USUM learnsets; transfer-only moves are generally excluded.
- Gen 7 TMs apply. Fly, Surf and Waterfall are TMXs in Reborn.
- Power-Up Punch, Struggle Bug and Secret Power are promoted to TMs.
- Evolved Pokémon's level-1 moves are move-relearner-only unless a
  pre-evolution learned them before evolving.
- Pre-evolution moves are legal if the Pokémon could have learned them earlier.
- Egg moves require daycare unlocked and a breeding chain through the pool.
- Fixed-damage moves (Seismic Toss, Night Shade, etc.) count as damaging for
  playthrough recommendations.

Progression state (level cap, available TMs/TMXs/tutors, relearner and daycare
flags) is persisted in local storage.

## Notes

- Hidden Power's elemental type is carried in the move name (e.g. "Hidden Power
  Ice"); the type/category is resolved from that name in `src/moveMeta.js`.
- There is no automated test suite yet; the smoke tests described in the
  project history (search Charmander, optimize an early-game pool, change the
  level cap to 20) are the quickest way to validate changes in the browser.
</content>
</invoke>
