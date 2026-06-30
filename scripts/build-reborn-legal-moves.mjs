import fs from "node:fs/promises";
import path from "node:path";
import { Dex } from "@pkmn/dex";
import {
  REBORN_LEVEL_ONE_MOVE_OVERRIDES,
  REBORN_PROMOTED_TM_MOVES,
  REBORN_TM_MOVE_OVERRIDES,
  REBORN_TMX_MOVE_OVERRIDES,
  REBORN_TUTOR_MOVE_OVERRIDES,
} from "../src/reborn/rules.js";
import {
  REBORN_TM_OPTIONS,
  REBORN_TMX_OPTIONS,
  REBORN_TUTOR_OPTIONS,
} from "../src/reborn/progressionOptions.js";

const projectRoot = process.cwd();
const pokemonIndexPath = path.join(projectRoot, "site-data", "data", "pokemon-index.json");
const outputDir = path.join(projectRoot, "site-data", "data", "reborn-legal-moves", "all");
const dex = Dex.forGen(7);

const promotedTmMoveIds = new Set(REBORN_PROMOTED_TM_MOVES.map(toId));
const rebornTmMoveIds = new Set(REBORN_TM_OPTIONS.map((option) => toId(option.move)));
const rebornTmxMoveIds = new Set(REBORN_TMX_OPTIONS.map((option) => toId(option.move)));
const rebornTutorMoveIds = new Set(REBORN_TUTOR_OPTIONS.map((option) => toId(option.move)));
const speciesSourcesCache = new Map();

await fs.rm(outputDir, { recursive: true, force: true });
await fs.mkdir(outputDir, { recursive: true });

const pokemonIndex = JSON.parse(await fs.readFile(pokemonIndexPath, "utf8"));
let written = 0;

for (const pokemon of pokemonIndex) {
  const species = dex.species.get(pokemon.id);
  const sourceContext = await getSpeciesSourceContext(species, pokemon.id);
  if (!sourceContext) continue;

  const moves = [];

  // Egg moves are bred onto the base form and kept through evolution, but a
  // species' own learnset only lists its own egg moves — so an evolved form
  // must inherit its pre-evolutions' egg moves explicitly.
  const inheritedEggMoveIds = await getPreEvolutionEggMoveIds(species);
  const moveIds = new Set([
    ...sourceContext.sourcesByMoveId.keys(),
    ...inheritedEggMoveIds,
  ]);

  for (const moveId of moveIds) {
    const move = dex.moves.get(moveId);
    if (!move?.exists) continue;

    const ownSources = sourceContext.sourcesByMoveId.get(moveId);
    const sources = ownSources
      ? { ...ownSources, levelUp: [...ownSources.levelUp] }
      : { levelUp: [], tm: false, tmx: false, tutor: false, egg: false };
    if (inheritedEggMoveIds.has(moveId)) sources.egg = true;
    if (!hasAnySource(sources)) continue;

    const preEvolutionLevelUp = await getPreEvolutionLevelUpLevels(
      species,
      move.id,
    );
    const evolutionMove = await isGenuineEvolutionMove(
      species,
      move.id,
      ownSources,
    );

    // Intrinsic move properties (name/type/category/basePower/priority) live in
    // the central gen7MoveMeta table, keyed by move id, so they aren't
    // duplicated into every file that lists the move. These per-mon entries
    // carry only the move id and where this species obtains it; the runtime
    // rejoins the two by id at load time.
    moves.push({
      id: move.id,
      sources: normalizeSources({
        ...sources,
        preEvolutionLevelUp,
        evolutionMove,
      }),
    });
  }

  // Sort by id for stable, readable output; the runtime re-sorts the hydrated
  // moves by type/name once it has joined in the central metadata.
  moves.sort((a, b) => a.id.localeCompare(b.id));

  await fs.writeFile(
    path.join(outputDir, `${pokemon.id}.json`),
    JSON.stringify({
      pokemonId: pokemon.id,
      pokemonName: pokemon.name,
      types: species.types,
      learnsetPokemonId: sourceContext.learnsetSpecies.id,
      learnsetPokemonName: sourceContext.learnsetSpecies.name,
      moves,
    }) + "\n",
  );

  written += 1;
}

console.log(`[reborn-legal-moves] wrote ${written} Pokémon files`);

async function getSpeciesSourceContext(species, overridePokemonId = species.id) {
  if (!species?.exists) return null;
  const cacheKey = `${species.id}:${overridePokemonId}`;
  if (speciesSourcesCache.has(cacheKey)) {
    return speciesSourcesCache.get(cacheKey);
  }

  const learnsetContext = await getLearnsetContext(species);
  if (!learnsetContext) {
    speciesSourcesCache.set(cacheKey, null);
    return null;
  }

  const sourcesByMoveId = new Map();

  for (const [moveId, rawSources] of Object.entries(learnsetContext.learnset.learnset || {})) {
    const move = dex.moves.get(moveId);
    if (!move?.exists) continue;

    const sources = summarizeSources(move.id, rawSources);
    if (!hasAnySource(sources)) continue;

    sourcesByMoveId.set(move.id, sources);
  }

  applyRebornOverrides(overridePokemonId, sourcesByMoveId);

  const context = {
    learnsetSpecies: learnsetContext.species,
    sourcesByMoveId,
  };
  speciesSourcesCache.set(cacheKey, context);
  return context;
}

async function getPreEvolutionLevelUpLevels(species, moveId) {
  const levels = [];
  let current = species;
  const seen = new Set();

  while (current?.prevo && !seen.has(current.id)) {
    seen.add(current.id);
    const prevo = dex.species.get(current.prevo);
    const prevoContext = await getSpeciesSourceContext(prevo);
    const prevoLevels =
      prevoContext?.sourcesByMoveId.get(moveId)?.levelUp || [];
    const evolutionLevel = Number.isFinite(current.evoLevel)
      ? current.evoLevel
      : Infinity;

    levels.push(...prevoLevels.filter((level) => level <= evolutionLevel));
    current = prevo;
  }

  return [...new Set(levels)].sort((a, b) => a - b);
}

// A move learned at level 1 by an evolved form, that NO pre-evolution learns by
// level-up at any level, is a genuine evolution move (gained on evolving into
// this form — e.g. Combusken's Double Kick, Blaziken's Blaze Kick). A level-1
// move a pre-evolution does learn is just relisted on the evolved form (Ember,
// or a high-level move like Flare Blitz) and must stay gated by its real level.
async function isGenuineEvolutionMove(species, moveId, ownSources) {
  if (!species?.prevo) return false;
  if (!ownSources?.levelUp?.includes(1)) return false;

  // @pkmn/dex's Gen 7 data encodes evolution moves as a plain "7L1" — the same
  // as a regular level-1 move — so "level 1 on an evolved form" alone over-counts
  // (it flagged both Bibarel's Aqua Jet AND Water Gun, but a form has at most one
  // evolution move). Two signals separate a genuine evolution move (gained on
  // evolving) from a pre-existing move merely relisted at level 1 in Gen 7:
  //   (a) an explicit Gen 8/9 "L0" evolution marker (e.g. Double Kick "8L0/9L0"),
  //       which is authoritative; or
  //   (b) the move is new to this form at level 1 — no earlier-generation
  //       level-up entry at all (Aqua Jet is "7L1" only), whereas a relocated
  //       move keeps its history (Water Gun is "7L1","6L15",… → not an evo move).
  // Lacking both, it's only obtainable through the move relearner.
  const rawEntry = await getRawLearnsetEntry(species, moveId);
  const hasEvolutionMarker = rawEntry.some((s) => /^[89]L0$/.test(s));
  const hasEarlierLevelUp = rawEntry.some((s) => /^[1-6]L\d+$/.test(s));
  if (!hasEvolutionMarker && hasEarlierLevelUp) return false;

  let current = species;
  const seen = new Set();

  while (current?.prevo && !seen.has(current.id)) {
    seen.add(current.id);
    const prevo = dex.species.get(current.prevo);
    const prevoContext = await getSpeciesSourceContext(prevo);
    if (prevoContext?.sourcesByMoveId.get(moveId)?.levelUp?.length) {
      return false;
    }
    current = prevo;
  }

  return true;
}

async function getPreEvolutionEggMoveIds(species) {
  const eggMoveIds = new Set();
  let current = species;
  const seen = new Set();

  while (current?.prevo && !seen.has(current.id)) {
    seen.add(current.id);
    const prevo = dex.species.get(current.prevo);
    const prevoContext = await getSpeciesSourceContext(prevo);

    if (prevoContext) {
      for (const [moveId, sources] of prevoContext.sourcesByMoveId.entries()) {
        if (sources.egg) eggMoveIds.add(moveId);
      }
    }

    current = prevo;
  }

  return eggMoveIds;
}

// The raw @pkmn/dex learnset entry for a move on this form (e.g. ["7L1","6L15"]),
// resolved through the same parent fallback as the rest of the build so forms
// without their own learnset read their base form's. Used to inspect generation
// tags (the "L0" evolution marker and earlier-gen level-up history).
async function getRawLearnsetEntry(species, moveId) {
  const context = await getLearnsetContext(species);
  return context?.learnset?.learnset?.[moveId] || [];
}

async function getLearnsetContext(species, seen = new Set()) {
  if (!species?.exists || seen.has(species.id)) return null;
  seen.add(species.id);

  const ownLearnset = await dex.learnsets.get(species.id);
  if (ownLearnset?.learnset && Object.keys(ownLearnset.learnset).length > 0) {
    return { species, learnset: ownLearnset };
  }

  const parentIds = [
    species.changesFrom,
    species.baseSpecies,
    species.baseForme,
  ]
    .map(toId)
    .filter(Boolean)
    .filter((id) => id !== species.id);

  for (const parentId of parentIds) {
    const context = await getLearnsetContext(dex.species.get(parentId), seen);
    if (context) return context;
  }

  return null;
}

function summarizeSources(moveId, rawSources = []) {
  const sources = {
    levelUp: [],
    tm: false,
    tmx: false,
    tutor: false,
    egg: false,
  };

  const parsed = rawSources.map(parseSourceCode).filter(Boolean);
  const currentGenSources = parsed.filter((source) => source.gen === 7);
  const hasCurrentGenSource = currentGenSources.length > 0;
  const hasCurrentMachine = currentGenSources.some((source) => source.kind === "machine");
  const hasLegacyMachine = parsed.some((source) => source.gen < 7 && source.kind === "machine");
  const hasGen6Machine = parsed.some((source) => source.gen === 6 && source.kind === "machine");

  for (const source of currentGenSources) {
    if (source.kind === "level") sources.levelUp.push(source.level);
    else if (source.kind === "tutor") sources.tutor = true;
    else if (source.kind === "egg") sources.egg = true;
  }

  sources.levelUp = [...new Set(sources.levelUp)].sort((a, b) => a - b);

  if (rebornTmMoveIds.has(moveId)) {
    sources.tm = promotedTmMoveIds.has(moveId)
      ? hasCurrentGenSource || hasGen6Machine
      : hasCurrentMachine;
  }

  if (rebornTmxMoveIds.has(moveId)) {
    sources.tmx = hasCurrentMachine || hasLegacyMachine;
  }

  if (rebornTutorMoveIds.has(moveId)) {
    sources.tutor = sources.tutor || false;
  }

  return sources;
}

function applyRebornOverrides(pokemonId, sourcesByMoveId) {
  for (const moveName of REBORN_LEVEL_ONE_MOVE_OVERRIDES[pokemonId] || []) {
    const moveId = toId(moveName);
    const sources = getOrCreateSources(sourcesByMoveId, moveId);
    // Reborn grants these through the move relearner, not by level-up or on
    // evolution — so flag them as relearner moves rather than faking an L1
    // level-up entry (which would also misread them as evolution moves).
    sources.rebornRelearner = true;
  }

  for (const moveName of REBORN_TUTOR_MOVE_OVERRIDES[pokemonId] || []) {
    const moveId = toId(moveName);
    const sources = getOrCreateSources(sourcesByMoveId, moveId);
    sources.tutor = true;
  }

  for (const moveName of REBORN_TM_MOVE_OVERRIDES[pokemonId] || []) {
    const moveId = toId(moveName);
    const sources = getOrCreateSources(sourcesByMoveId, moveId);
    sources.tm = true;
  }

  for (const moveName of REBORN_TMX_MOVE_OVERRIDES[pokemonId] || []) {
    const moveId = toId(moveName);
    const sources = getOrCreateSources(sourcesByMoveId, moveId);
    sources.tmx = true;
  }
}

function getOrCreateSources(sourcesByMoveId, moveId) {
  if (!sourcesByMoveId.has(moveId)) {
    sourcesByMoveId.set(moveId, {
      levelUp: [],
      tm: false,
      tmx: false,
      tutor: false,
      egg: false,
    });
  }

  return sourcesByMoveId.get(moveId);
}

function normalizeSources(sources) {
  const {
    preEvolutionLevelUp: rawPreEvolutionLevelUp,
    evolutionMove,
    rebornRelearner,
    ...baseSources
  } = sources;
  const normalized = {
    ...baseSources,
    levelUp: [...new Set(sources.levelUp)].sort((a, b) => a - b),
  };
  const preEvolutionLevelUp = [
    ...new Set(rawPreEvolutionLevelUp || []),
  ].sort((a, b) => a - b);

  if (preEvolutionLevelUp.length) {
    normalized.preEvolutionLevelUp = preEvolutionLevelUp;
  }

  if (evolutionMove) {
    normalized.evolutionMove = true;
  }

  if (rebornRelearner) {
    normalized.rebornRelearner = true;
  }

  return normalized;
}

function parseSourceCode(code) {
  const match = String(code || "").match(/^(\d)([A-Z])(\d*)/);
  if (!match) return null;

  const gen = Number.parseInt(match[1], 10);
  const sourceType = match[2];
  const detail = match[3];

  if (!Number.isFinite(gen) || gen > 7) return null;

  if (sourceType === "L") {
    const level = Number.parseInt(detail || "1", 10);
    return { gen, kind: "level", level: Number.isFinite(level) ? level : 1 };
  }

  if (sourceType === "M") return { gen, kind: "machine" };
  if (sourceType === "T") return { gen, kind: "tutor" };
  if (sourceType === "E") return { gen, kind: "egg" };

  return { gen, kind: "other" };
}

function hasAnySource(sources) {
  return (
    sources.levelUp.length > 0 ||
    sources.tm ||
    sources.tmx ||
    sources.tutor ||
    sources.egg ||
    sources.rebornRelearner
  );
}

function toId(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}
