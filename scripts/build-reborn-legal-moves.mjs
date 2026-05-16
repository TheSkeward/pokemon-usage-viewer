import fs from "node:fs/promises";
import path from "node:path";
import { Dex } from "@pkmn/dex";
import {
  REBORN_PROMOTED_TM_MOVES,
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

await fs.rm(outputDir, { recursive: true, force: true });
await fs.mkdir(outputDir, { recursive: true });

const pokemonIndex = JSON.parse(await fs.readFile(pokemonIndexPath, "utf8"));
let written = 0;

for (const pokemon of pokemonIndex) {
  const species = dex.species.get(pokemon.id);
  const learnsetContext = await getLearnsetContext(species);

  if (!learnsetContext) continue;

  const moves = [];

  for (const [moveId, rawSources] of Object.entries(learnsetContext.learnset.learnset || {})) {
    const move = dex.moves.get(moveId);
    if (!move?.exists) continue;

    const sources = summarizeSources(move.id, rawSources);
    if (!hasAnySource(sources)) continue;

    moves.push({
      id: move.id,
      name: move.name,
      type: move.type,
      category: move.category,
      sources,
    });
  }

  moves.sort((a, b) => a.name.localeCompare(b.name));

  await fs.writeFile(
    path.join(outputDir, `${pokemon.id}.json`),
    JSON.stringify({
      pokemonId: pokemon.id,
      pokemonName: pokemon.name,
      types: species.types,
      learnsetPokemonId: learnsetContext.species.id,
      learnsetPokemonName: learnsetContext.species.name,
      moves,
    }) + "\n",
  );

  written += 1;
}

console.log(`[reborn-legal-moves] wrote ${written} Pokémon files`);

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
    sources.egg
  );
}

function toId(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}
