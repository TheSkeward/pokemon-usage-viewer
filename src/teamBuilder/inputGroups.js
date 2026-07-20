import { resolveQueryEntries } from '../data';
import { parsePoolTokens } from './poolParsing';
import { normalizeName } from './nameUtils';

/**
 * @param {string} query
 * @param {Object} pokemonIndex
 * @return {Array<{token: string, input: Object, entries: Array<Object>,
 *     unresolved: boolean}>} One group per pool token; unresolved tokens
 *     carry a synthetic input and empty entries.
 */
export function buildInputGroups(query, pokemonIndex) {
  const tokens = parsePoolTokens(query, pokemonIndex);
  const groups = [];

  for (const token of tokens) {
    const entries = resolveQueryEntries(token, pokemonIndex);

    if (!entries.length) {
      groups.push({
        token,
        input: { id: normalizeName(token), name: token, token },
        entries: [],
        unresolved: true,
      });
      continue;
    }

    const exact = entries.find(
      (entry) => normalizeName(entry.name) === normalizeName(token),
    );
    const chosen = exact || entries[0];

    groups.push({
      token,
      input: chosen,
      entries: [chosen],
      ambiguousCount: entries.length,
      unresolved: false,
    });
  }

  return groups;
}
