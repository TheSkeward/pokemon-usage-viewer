export function parsePoolTokens(query, pokemonIndex) {
  return extractPoolNames(query, pokemonIndex);
}

export function getPoolStats(query, pokemonIndex) {
  const tokens = parsePoolTokens(query, pokemonIndex);
  const unique = new Set(tokens.map(normalizeName).filter(Boolean));

  return {
    totalCount: tokens.length,
    uniqueCount: unique.size,
    duplicateCount: Math.max(0, tokens.length - unique.size),
  };
}

export function normalizePoolText(query, pokemonIndex) {
  const byKey = new Map();

  for (const name of extractPoolNames(query, pokemonIndex)) {
    const canonical = findPokemonNameInText(name, pokemonIndex);
    if (!canonical) continue;

    const key = normalizeName(canonical);
    if (!key || byKey.has(key)) continue;

    byKey.set(key, canonical);
  }

  return [...byKey.values()].sort((a, b) => a.localeCompare(b)).join(", ");
}

function extractPoolNames(query, pokemonIndex) {
  const names = [];

  for (const rawLine of String(query || "").split(/\n+/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.includes(",")) {
      for (const part of line.split(",")) {
        const name = extractNameFromPoolToken(part, pokemonIndex);
        if (name) names.push(name);
      }
      continue;
    }

    const name = extractNameFromPoolToken(line, pokemonIndex);
    if (name) names.push(name);
  }

  return names;
}

function extractNameFromPoolToken(value, pokemonIndex) {
  const text = String(value || "").trim();
  if (!text) return "";

  const anywhere = findPokemonNameInText(text, pokemonIndex);
  if (anywhere) return anywhere;

  for (const cell of text.split("\t")) {
    const fromCell = findPokemonNameInText(cell, pokemonIndex);
    if (fromCell) return fromCell;
  }

  const beforeNumericColumns = text.split(/\s+(?=\d|--|#)/)[0]?.trim();
  if (beforeNumericColumns && beforeNumericColumns !== text) {
    const fromPrefix = findPokemonNameInText(
      beforeNumericColumns,
      pokemonIndex,
    );
    if (fromPrefix) return fromPrefix;
  }

  return "";
}

function findPokemonNameInText(value, pokemonIndex) {
  const text = String(value || "").trim();
  const key = normalizeName(text);
  if (!key) return null;

  const exact = pokemonIndex.find(
    (pokemon) => normalizeName(pokemon.name) === key,
  );
  if (exact) return exact.name;

  const matches = pokemonIndex
    .map((pokemon) => ({ pokemon, key: normalizeName(pokemon.name) }))
    .filter(({ key: pokemonKey }) => pokemonKey && key.includes(pokemonKey))
    .sort((a, b) => b.key.length - a.key.length);

  return matches[0]?.pokemon.name || null;
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}
