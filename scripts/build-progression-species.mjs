import fs from "node:fs/promises";
import path from "node:path";
import { Dex } from "@pkmn/dex";

const projectRoot = process.cwd();
const pokemonIndexPath = path.join(projectRoot, "site-data", "data", "pokemon-index.json");
const outputPath = path.join(
  projectRoot,
  "src",
  "generated",
  "gen7ProgressionSpecies.generated.js",
);
const dex = Dex.forGen(7);

const pokemonIndex = JSON.parse(await fs.readFile(pokemonIndexPath, "utf8"));
const pokemonIds = new Set(pokemonIndex.map((pokemon) => pokemon.id));
const speciesById = {};

// Reborn level-up learnsets, used to resolve levelMove evolutions (evolve by
// knowing a move — e.g. Tangela needs Ancient Power for Tangrowth) to the level
// at which the pre-evo actually learns that move, so reachability can be gated
// by the level cap instead of guessed.
const rebornLearnsets = JSON.parse(
  await fs.readFile(
    path.join(projectRoot, "scripts", "reborn", "reborn-learnsets.generated.json"),
    "utf8",
  ),
).learnsets;

function levelMoveLearnLevel(prevoId, moveName) {
  const moveId = toId(moveName);
  const levelUp = rebornLearnsets[prevoId]?.levelUp || [];
  const levels = levelUp
    .filter(([, id]) => toId(id) === moveId)
    .map(([level]) => level);
  return levels.length ? Math.min(...levels) : null;
}

for (const pokemon of pokemonIndex) {
  const species = dex.species.get(pokemon.id);
  if (!species?.exists) continue;

  speciesById[pokemon.id] = {
    id: pokemon.id,
    name: pokemon.name,
    prevoId: toId(species.prevo),
    evos: (species.evos || []).map(toId).filter((id) => pokemonIds.has(id)),
    evoLevel: Number.isFinite(species.evoLevel) ? species.evoLevel : null,
    evoType: species.evoType || "",
    // What the evolution actually requires, so legality can be checked and
    // priced instead of blanket-blocking whole evoTypes: the item (useItem /
    // levelHold / trade-with-item), the known move (levelMove), and any extra
    // condition text (day/night, gender, location, ...).
    evoItem: species.evoItem || "",
    evoMove: species.evoMove || "",
    evoMoveLevel:
      species.evoType === "levelMove" && species.evoMove
        ? levelMoveLearnLevel(toId(species.prevo), species.evoMove)
        : null,
    evoCondition: species.evoCondition || "",
    baseSpeciesId: toId(species.baseSpecies),
    eggGroups: species.eggGroups || [],
    isMega: Boolean(species.isMega),
  };
}

const body = `// Generated from @pkmn/dex Gen 7 species progression data.
export const GEN7_PROGRESSION_SPECIES = ${JSON.stringify(speciesById, null, 2)};
`;

await fs.writeFile(outputPath, body);
console.log(`[progression-species] wrote ${Object.keys(speciesById).length} species`);

function toId(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}
