/**
 * @param {string} query
 * @param {Array<Object>} pokemonIndex
 * @return {Array<string>} Canonical Pokémon names, one per recognized pool
 *     token, duplicates preserved.
 */
export function parsePoolTokens(query, pokemonIndex) {
  return extractPoolNames(query, pokemonIndex);
}

/**
 * Ability annotations: a pool line like "Froakie (Torrent)" or
 * "Froakie [Torrent]" declares the CAUGHT mon's actual ability, replacing the
 * competitive-primary assumption for that line. The optimizer validates the
 * text against the line's real ability options and silently ignores anything
 * that doesn't match, so ordinary parenthetical noise in pasted lists can't
 * corrupt scoring.
 * @param {string} query
 * @param {Array<Object>} pokemonIndex
 * @return {Map<string, string>} Normalized pokemon name -> annotation text.
 */
export function parseAbilityAnnotations(query, pokemonIndex) {
  const annotations = new Map();
  for (const rawLine of String(query || '').split(/\n+/)) {
    for (const part of rawLine.split(',')) {
      const match =
        /^(.*?)\s*[([]\s*([A-Za-z][A-Za-z' -]{1,28})\s*[)\]]\s*$/.exec(
          part.trim(),
        );
      if (!match) continue;
      const name = findPokemonNameInText(match[1], pokemonIndex);
      if (!name) continue;
      annotations.set(normalizeName(name), match[2].trim());
    }
  }
  return annotations;
}

/**
 * @param {string} query
 * @param {Array<Object>} pokemonIndex
 * @return {{totalCount: number, uniqueCount: number, duplicateCount: number}}
 */
export function getPoolStats(query, pokemonIndex) {
  const tokens = parsePoolTokens(query, pokemonIndex);
  const unique = new Set(tokens.map(normalizeName).filter(Boolean));

  return {
    totalCount: tokens.length,
    uniqueCount: unique.size,
    duplicateCount: Math.max(0, tokens.length - unique.size),
  };
}

/**
 * @param {string} query
 * @param {Array<Object>} pokemonIndex
 * @return {string} Deduplicated canonical names, alphabetized and
 *     comma-joined.
 */
export function normalizePoolText(query, pokemonIndex) {
  const byKey = new Map();

  for (const name of extractPoolNames(query, pokemonIndex)) {
    const canonical = findPokemonNameInText(name, pokemonIndex);
    if (!canonical) continue;

    const key = normalizeName(canonical);
    if (!key || byKey.has(key)) continue;

    byKey.set(key, canonical);
  }

  return [...byKey.values()].sort((a, b) => a.localeCompare(b)).join(', ');
}

function extractPoolNames(query, pokemonIndex) {
  const names = [];

  for (const rawLine of String(query || '').split(/\n+/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.includes(',')) {
      for (const part of line.split(',')) {
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
  const text = String(value || '').trim();
  if (!text) return '';

  const anywhere = findPokemonNameInText(text, pokemonIndex);
  if (anywhere) return anywhere;

  for (const cell of text.split('\t')) {
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

  return '';
}

function findPokemonNameInText(value, pokemonIndex) {
  const text = String(value || '').trim();
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
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}
