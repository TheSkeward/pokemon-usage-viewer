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
