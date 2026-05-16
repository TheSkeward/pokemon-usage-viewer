import fs from "node:fs/promises";
import path from "node:path";
import { Dex } from "@pkmn/dex";

const DATA_ROOT = path.resolve("site-data", "data");
const OUT_ROOT = path.join(DATA_ROOT, "set-index");
const FAMILIES = ["singles", "doubles"];
const FALLBACK_FAMILY_ORDER = {
  singles: ["singles", "doubles"],
  doubles: ["doubles", "singles"],
};
const HIDDEN_ENTRY_KEYS = new Set(["other", "nothing"]);
const DEX = getGen7Dex();

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

  const samePokemonDetails = new Map();

  for (const pokemon of pokemonIndex) {
    const detail = stitchPokemonSetDetail({
      family,
      formatsIndex,
      pokemon,
      selection,
      sourceAggregates,
    });

    if (detail) samePokemonDetails.set(pokemon.id, detail);
  }

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

  let written = 0;
  const outDir = path.join(OUT_ROOT, family, selection);
  await fs.mkdir(outDir, { recursive: true });

  for (const pokemon of pokemonIndex) {
    const detail = samePokemonDetails.get(pokemon.id);
    if (!detail) continue;

    await writeJson(path.join(outDir, `${pokemon.id}.json`), detail);
    written += 1;
  }

  console.log(`[set-index] ${family}/${selection}: ${written} Pokémon`);
}

function getMovesetCandidates(availability, family, selection) {
  const familyConfig = availability?.familyConfigs?.[family];

  if (!familyConfig) {
    throw new Error(`Missing family config for ${family}`);
  }

  const candidates = [];
  const formatOrder = familyConfig.formatOrder || [];
  const cutoffPriority = familyConfig.cutoffPriority || [];

  for (const formatId of formatOrder) {
    for (const cutoff of cutoffPriority) {
      const months = getCandidateMonths(
        availability,
        selection,
        formatId,
        "moveset",
        cutoff,
      );

      if (!months.length) continue;

      candidates.push({
        family,
        selection,
        formatId,
        cutoff,
        months,
      });
    }
  }

  return candidates;
}

function getCandidateMonths(
  availability,
  selection,
  formatId,
  dataKind,
  cutoff,
) {
  if (selection === "all") {
    return Object.keys(availability?.months || {})
      .sort()
      .filter((month) =>
        availability?.months?.[month]?.[formatId]?.[dataKind]?.includes(cutoff),
      );
  }

  return availability?.months?.[selection]?.[formatId]?.[dataKind]?.includes(
    cutoff,
  )
    ? [selection]
    : [];
}

async function aggregateCandidateSource(candidate) {
  const byPokemon = new Map();

  for (const month of candidate.months) {
    const sourcePath = path.join(
      DATA_ROOT,
      "sources",
      month,
      candidate.formatId,
      String(candidate.cutoff),
      "moveset.json",
    );

    const source = await readJsonIfExists(sourcePath);
    if (!source?.pokemon) continue;

    for (const [pokemonId, entry] of Object.entries(source.pokemon)) {
      let aggregate = byPokemon.get(pokemonId);

      if (!aggregate) {
        aggregate = {
          selection: candidate.selection,
          family: candidate.family,
          month: candidate.selection === "all" ? null : candidate.months[0],
          formatId: candidate.formatId,
          cutoff: candidate.cutoff,
          monthsAvailable: candidate.months.length,
          monthsPresent: 0,
          pokemonId,
          name: entry.name,
          rawCount: 0,
          sections: {
            moves: new Map(),
            items: new Map(),
            abilities: new Map(),
            spreads: new Map(),
          },
        };

        byPokemon.set(pokemonId, aggregate);
      }

      aggregate.monthsPresent += 1;
      aggregate.rawCount += entry.rawCount || 0;
      aggregate.name = entry.name || aggregate.name;

      accumulateSection(
        aggregate.sections.moves,
        filterVisibleEntries(entry.moves),
        entry.rawCount,
      );
      accumulateSection(
        aggregate.sections.items,
        filterVisibleEntries(entry.items),
        entry.rawCount,
      );
      accumulateSection(
        aggregate.sections.abilities,
        filterVisibleEntries(entry.abilities),
        entry.rawCount,
      );
      accumulateSection(
        aggregate.sections.spreads,
        filterVisibleEntries(entry.spreads),
        entry.rawCount,
      );
    }
  }

  const finalized = new Map();

  for (const [pokemonId, aggregate] of byPokemon.entries()) {
    if (!aggregate.rawCount || !aggregate.monthsPresent) continue;

    finalized.set(pokemonId, {
      selection: aggregate.selection,
      family: aggregate.family,
      month: aggregate.month,
      formatId: aggregate.formatId,
      cutoff: aggregate.cutoff,
      monthsAvailable: aggregate.monthsAvailable,
      monthsPresent: aggregate.monthsPresent,
      entry: {
        pokemonId,
        name: aggregate.name,
        rawCount: aggregate.rawCount,
        moves: finalizeSection(aggregate.sections.moves, aggregate.rawCount),
        items: finalizeSection(aggregate.sections.items, aggregate.rawCount),
        abilities: finalizeSection(
          aggregate.sections.abilities,
          aggregate.rawCount,
        ),
        spreads: finalizeSection(
          aggregate.sections.spreads,
          aggregate.rawCount,
        ),
      },
    });
  }

  return finalized;
}

function stitchPokemonSetDetail({
  family,
  formatsIndex,
  pokemon,
  selection,
  sourceAggregates,
}) {
  let detail = null;

  const seen = {
    moves: new Set(),
    items: new Set(),
    abilities: new Set(),
    spreads: new Set(),
  };

  for (const { aggregateByPokemon } of sourceAggregates) {
    const aggregate = aggregateByPokemon.get(pokemon.id);
    if (!aggregate) continue;

    const sourceText = formatSource(aggregate, formatsIndex);

    if (!detail) {
      detail = createPrimaryDetail({
        aggregate,
        family,
        pokemon,
        selection,
        sourceText,
      });

      seedSeenSets(seen, detail);
      continue;
    }

    const contributed = appendAdditionalEntries({
      detail,
      aggregate,
      seen,
      sourceText,
    });

    if (contributed) {
      detail.stitched = true;
      detail.sourcesUsed.push({
        family: aggregate.family,
        formatId: aggregate.formatId,
        cutoff: aggregate.cutoff,
        monthsAvailable: aggregate.monthsAvailable,
        monthsPresent: aggregate.monthsPresent,
        sourceText,
        kind: "additional",
      });
    }
  }

  return detail;
}

function createPrimaryDetail({
  aggregate,
  family,
  pokemon,
  selection,
  sourceText,
}) {
  const primarySource = {
    family: aggregate.family,
    formatId: aggregate.formatId,
    cutoff: aggregate.cutoff,
    monthsAvailable: aggregate.monthsAvailable,
    monthsPresent: aggregate.monthsPresent,
    sourceText,
    kind: "primary",
  };

  return {
    pokemonId: pokemon.id,
    name: aggregate.entry.name || pokemon.name,
    family,
    selection,
    sourceFamily: aggregate.family,
    month: aggregate.month,
    formatId: aggregate.formatId,
    cutoff: aggregate.cutoff,
    monthsAvailable: aggregate.monthsAvailable,
    monthsPresent: aggregate.monthsPresent,
    stitched: false,
    primarySource,
    sourcesUsed: [primarySource],
    relatedPokemonUsed: [],
    entry: aggregate.entry,
    moves: markPrimaryEntries(aggregate.entry.moves),
    items: markPrimaryEntries(aggregate.entry.items),
    abilities: markPrimaryEntries(aggregate.entry.abilities),
    spreads: markPrimaryEntries(aggregate.entry.spreads),
  };
}

function markPrimaryEntries(entries) {
  return entries.map((entry) => ({
    ...entry,
    kind: "primary",
  }));
}

function seedSeenSets(seen, detail) {
  for (const entry of detail.moves) seen.moves.add(normalizeName(entry.name));
  for (const entry of detail.items) seen.items.add(normalizeName(entry.name));
  for (const entry of detail.abilities)
    seen.abilities.add(normalizeName(entry.name));
  for (const entry of detail.spreads)
    seen.spreads.add(normalizeName(entry.name));
}

function appendAdditionalEntries({ detail, aggregate, seen, sourceText }) {
  const moveContribution = appendSection({
    target: detail.moves,
    entries: aggregate.entry.moves,
    seenSet: seen.moves,
    sourceText,
  });

  const itemContribution = appendSection({
    target: detail.items,
    entries: aggregate.entry.items,
    seenSet: seen.items,
    sourceText,
  });

  const abilityContribution = appendSection({
    target: detail.abilities,
    entries: aggregate.entry.abilities,
    seenSet: seen.abilities,
    sourceText,
  });

  const spreadContribution = appendSection({
    target: detail.spreads,
    entries: aggregate.entry.spreads,
    seenSet: seen.spreads,
    sourceText,
  });

  return (
    moveContribution ||
    itemContribution ||
    abilityContribution ||
    spreadContribution
  );
}

function appendSection({ target, entries, seenSet, sourceText }) {
  let contributed = false;

  for (const entry of entries) {
    const key = normalizeName(entry.name);
    if (!key || seenSet.has(key)) continue;

    seenSet.add(key);
    target.push({
      name: entry.name,
      usage: null,
      kind: "additional",
      sourceText,
    });
    contributed = true;
  }

  return contributed;
}

function appendRelatedSetOptions({
  detail,
  pokemon,
  samePokemonDetails,
  speciesContext,
}) {
  const relatedChain = buildRelatedPokemonChain(pokemon, speciesContext);
  if (!relatedChain.length) return;

  const seen = {
    moves: new Set(detail.moves.map((entry) => normalizeName(entry.name))),
    items: new Set(detail.items.map((entry) => normalizeName(entry.name))),
    abilities: new Set(
      detail.abilities.map((entry) => normalizeName(entry.name)),
    ),
    spreads: new Set(detail.spreads.map((entry) => normalizeName(entry.name))),
  };

  for (const related of relatedChain) {
    const relatedDetail = samePokemonDetails.get(related.id);
    if (!relatedDetail) continue;

    const contributed = appendRelatedPokemonEntries({
      detail,
      related,
      relatedDetail,
      seen,
    });

    if (!contributed) continue;

    detail.stitched = true;
    detail.relatedPokemonUsed.push({
      pokemonId: related.id,
      name: related.name,
      reason: related.reason,
    });

    detail.sourcesUsed.push({
      kind: "related",
      pokemonId: related.id,
      name: related.name,
      reason: related.reason,
      sourceText: `Related: ${related.name} (${related.reason})`,
    });
  }
}

function appendRelatedPokemonEntries({ detail, related, relatedDetail, seen }) {
  const moveContribution = appendRelatedSection({
    target: detail.moves,
    entries: relatedDetail.moves,
    seenSet: seen.moves,
    related,
  });

  const itemContribution = appendRelatedSection({
    target: detail.items,
    entries: relatedDetail.items,
    seenSet: seen.items,
    related,
  });

  const abilityContribution = appendRelatedSection({
    target: detail.abilities,
    entries: relatedDetail.abilities,
    seenSet: seen.abilities,
    related,
  });

  const spreadContribution = appendRelatedSection({
    target: detail.spreads,
    entries: relatedDetail.spreads,
    seenSet: seen.spreads,
    related,
  });

  return (
    moveContribution ||
    itemContribution ||
    abilityContribution ||
    spreadContribution
  );
}

function appendRelatedSection({ target, entries, seenSet, related }) {
  let contributed = false;

  for (const entry of entries) {
    const key = normalizeName(entry.name);
    if (!key || seenSet.has(key)) continue;

    seenSet.add(key);
    target.push({
      name: entry.name,
      usage: null,
      kind: "additional",
      sourceText: `Related: ${related.name} (${related.reason})${
        entry.sourceText ? ` — ${entry.sourceText}` : ""
      }`,
    });
    contributed = true;
  }

  return contributed;
}

function buildRelatedPokemonChain(pokemon, speciesContext) {
  const info = speciesContext.infoByPokemonId.get(pokemon.id);
  if (!info) return [];

  const chain = [];
  const seen = new Set([pokemon.id]);

  function add(id, reason) {
    const relatedInfo = speciesContext.infoByPokemonId.get(id);
    if (!relatedInfo || seen.has(id)) return;

    seen.add(id);
    chain.push({
      id,
      name: relatedInfo.name,
      reason,
    });
  }

  const baseId =
    info.baseId && speciesContext.infoByPokemonId.has(info.baseId)
      ? info.baseId
      : info.id;

  const siblingForms = speciesContext.formsByBaseId.get(baseId) || [];

  if (info.isMega) {
    for (const sibling of siblingForms.filter(
      (candidate) => candidate.isMega && candidate.id !== info.id,
    )) {
      add(sibling.id, "alternate Mega form");
    }

    add(baseId, "base form");
  } else if (info.id === baseId) {
    for (const sibling of siblingForms.filter(
      (candidate) => candidate.isMega,
    )) {
      add(sibling.id, "Mega form");
    }
  } else {
    add(baseId, getFormReason(info));
  }

  appendPreEvolutionChain({ add, baseId, speciesContext });

  return chain;
}

function appendPreEvolutionChain({ add, baseId, speciesContext }) {
  let current = speciesContext.infoByPokemonId.get(baseId);
  const seen = new Set();

  while (current?.prevoId && !seen.has(current.id)) {
    seen.add(current.id);

    const prevo = speciesContext.infoByPokemonId.get(current.prevoId);
    if (!prevo) return;

    add(prevo.id, "pre-evolution");
    current = prevo;
  }
}

function getFormReason(info) {
  if (info.isTotem) return "normal Totem-relative form";
  if (info.isPrimal) return "base Primal-relative form";
  if (info.isPikachuCosplay) return "base Pikachu form";
  if (info.isBattleOnly) return "base form";
  if (info.forme) return "base form";

  return "related form";
}

function buildSpeciesContext(pokemonIndex) {
  const infoByPokemonId = new Map();
  const formsByBaseId = new Map();

  for (const pokemon of pokemonIndex) {
    const info = getSpeciesInfo(pokemon);
    infoByPokemonId.set(info.id, info);
  }

  for (const info of infoByPokemonId.values()) {
    if (!info.baseId) continue;

    const forms = formsByBaseId.get(info.baseId) || [];
    forms.push(info);
    formsByBaseId.set(info.baseId, forms);
  }

  for (const forms of formsByBaseId.values()) {
    forms.sort((a, b) => a.name.localeCompare(b.name));
  }

  return { infoByPokemonId, formsByBaseId };
}

function getSpeciesInfo(pokemon) {
  const species = DEX.species.get(pokemon.name);
  const name = species?.exists ? species.name : pokemon.name;
  const id = pokemon.id;
  const baseId = species?.baseSpecies ? normalizeName(species.baseSpecies) : id;
  const prevoId = species?.prevo ? normalizeName(species.prevo) : "";

  return {
    id,
    name,
    dexId: species?.id || id,
    baseId,
    prevoId,
    forme: species?.forme || "",
    isMega: Boolean(species?.isMega) || /mega/.test(id),
    isPrimal: /primal/.test(id),
    isTotem: /totem/.test(id),
    isBattleOnly: Boolean(species?.battleOnly),
    isPikachuCosplay:
      id.startsWith("pikachu") &&
      !["pikachu", "pichu", "raichu", "raichualola"].includes(id),
  };
}

function getGen7Dex() {
  if (typeof Dex.forGen === "function") return Dex.forGen(7);
  if (typeof Dex.mod === "function") return Dex.mod("gen7");
  return Dex;
}

function accumulateSection(targetMap, entries = [], rawCount = 0) {
  for (const entry of entries) {
    const weight = ((entry.usage || 0) / 100) * (rawCount || 0);
    targetMap.set(entry.name, (targetMap.get(entry.name) || 0) + weight);
  }
}

function finalizeSection(sourceMap, totalRawCount) {
  return [...sourceMap.entries()]
    .map(([name, weight]) => ({
      name,
      usage: totalRawCount > 0 ? (weight / totalRawCount) * 100 : 0,
    }))
    .sort((a, b) => b.usage - a.usage || a.name.localeCompare(b.name));
}

function filterVisibleEntries(entries = []) {
  return entries.filter(
    (entry) => !HIDDEN_ENTRY_KEYS.has(normalizeName(entry.name)),
  );
}

function formatSource(source, formatsIndex) {
  const label =
    formatsIndex.find((format) => format.id === source.formatId)?.label ||
    source.formatId;

  if (source.selection === "all") {
    return `${label} @ ${source.cutoff} (${source.monthsPresent}/${source.monthsAvailable} mo)`;
  }

  return `${label} @ ${source.cutoff}`;
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function readJsonIfExists(filePath) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(`${filePath}.tmp`, `${JSON.stringify(data)}\n`);
  await fs.rename(`${filePath}.tmp`, filePath);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
