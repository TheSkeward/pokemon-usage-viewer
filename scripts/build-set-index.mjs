import fs from "node:fs/promises";
import path from "node:path";
import {
  DATA_ROOT,
  FALLBACK_FAMILY_ORDER,
  FAMILIES,
  OUT_ROOT,
} from "./set-index/constants.mjs";
import { aggregateCandidateSource } from "./set-index/aggregateMovesets.mjs";
import { getMovesetCandidates } from "./set-index/candidates.mjs";
import { readJson, readJsonIfExists, writeJson } from "./set-index/io.mjs";
import { buildSpeciesContext } from "./set-index/speciesContext.mjs";
import {
  appendRelatedSetOptions,
  stitchPokemonSetDetail,
} from "./set-index/stitchSetDetails.mjs";

async function main() {
  const [availability, formatsIndex, pokemonIndex] = await Promise.all([
    readJson(path.join(DATA_ROOT, "availability.json")),
    readJson(path.join(DATA_ROOT, "formats.json")),
    readJson(path.join(DATA_ROOT, "pokemon-index.json")),
  ]);

  const speciesContext = buildSpeciesContext(pokemonIndex);

  await fs.rm(OUT_ROOT, { recursive: true, force: true });

  for (const family of FAMILIES) {
    await buildFamilySetIndex({
      availability,
      family,
      formatsIndex,
      pokemonIndex,
      selection: "all",
      speciesContext,
    });
  }
}

async function buildFamilySetIndex({
  availability,
  family,
  formatsIndex,
  pokemonIndex,
  selection,
  speciesContext,
}) {
  const sourceFamilies = FALLBACK_FAMILY_ORDER[family] || [family];

  console.log(
    `[set-index] building ${family}/${selection} from ${sourceFamilies.join(" → ")}`,
  );

  const sourceAggregates = await buildSourceAggregates({
    availability,
    selection,
    sourceFamilies,
  });

  // The first tier (descending the format×cutoff ladder) whose usage clears
  // 0.1% — the same signal the resolver index ranks low-usage mons by. A mon's
  // primary set should be sourced from this tier, not the highest tier it
  // merely appears in (which for a sub-0.1% mon is a noisy handful of teams).
  // For mons below the bar everywhere, the resolver index's `trace` (their
  // best sub-bar tier — where they actually see play) supplies the primary
  // instead (user ruling); see choosePrimaryIndex.
  const { rankingByPokemon, traceByPokemon } = await loadFamilyRankings(family);

  const samePokemonDetails = buildSamePokemonDetails({
    family,
    formatsIndex,
    pokemonIndex,
    rankingByPokemon,
    traceByPokemon,
    selection,
    sourceAggregates,
  });

  appendRelatedDetails({
    pokemonIndex,
    samePokemonDetails,
    speciesContext,
  });

  const written = await writeFamilyDetails({
    family,
    pokemonIndex,
    samePokemonDetails,
    selection,
  });

  console.log(`[set-index] ${family}/${selection}: ${written} Pokémon`);
}

async function buildSourceAggregates({
  availability,
  selection,
  sourceFamilies,
}) {
  const sourceAggregates = [];

  for (const sourceFamily of sourceFamilies) {
    const candidates = getMovesetCandidates(
      availability,
      sourceFamily,
      selection,
    );

    for (const candidate of candidates) {
      const aggregateByPokemon = await aggregateCandidateSource(candidate);
      sourceAggregates.push({ candidate, aggregateByPokemon });
    }
  }

  return sourceAggregates;
}

async function loadFamilyRankings(family) {
  const index = await readJsonIfExists(
    path.join(DATA_ROOT, "resolver-index", family, "all.json"),
  );

  const rankingByPokemon = new Map();
  const traceByPokemon = new Map();
  for (const [pokemonId, bundle] of Object.entries(index?.pokemon || {})) {
    if (bundle?.ranking) rankingByPokemon.set(pokemonId, bundle.ranking);
    // The display's best-sub-bar row (mutually exclusive with ranking) — the
    // trace-mon canonical-set tier per the user ruling.
    else if (bundle?.trace) traceByPokemon.set(pokemonId, bundle.trace);
  }

  return { rankingByPokemon, traceByPokemon };
}

function buildSamePokemonDetails({
  family,
  formatsIndex,
  pokemonIndex,
  rankingByPokemon,
  traceByPokemon,
  selection,
  sourceAggregates,
}) {
  const samePokemonDetails = new Map();

  for (const pokemon of pokemonIndex) {
    const detail = stitchPokemonSetDetail({
      family,
      formatsIndex,
      pokemon,
      ranking: rankingByPokemon.get(pokemon.id) || null,
      trace: traceByPokemon.get(pokemon.id) || null,
      selection,
      sourceAggregates,
    });

    if (detail) samePokemonDetails.set(pokemon.id, detail);
  }

  return samePokemonDetails;
}

function appendRelatedDetails({
  pokemonIndex,
  samePokemonDetails,
  speciesContext,
}) {
  for (const pokemon of pokemonIndex) {
    const detail = samePokemonDetails.get(pokemon.id);
    if (!detail) continue;

    appendRelatedSetOptions({
      detail,
      pokemon,
      samePokemonDetails,
      speciesContext,
    });
  }
}

async function writeFamilyDetails({
  family,
  pokemonIndex,
  samePokemonDetails,
  selection,
}) {
  let written = 0;
  const outDir = path.join(OUT_ROOT, family, selection);
  await fs.mkdir(outDir, { recursive: true });

  for (const pokemon of pokemonIndex) {
    const detail = samePokemonDetails.get(pokemon.id);
    if (!detail) continue;

    await writeJson(path.join(outDir, `${pokemon.id}.json`), detail);
    written += 1;
  }

  return written;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
