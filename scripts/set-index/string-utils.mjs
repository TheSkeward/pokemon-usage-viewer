/**
 * @return {string} Showdown-style id: lowercased, non-alphanumerics stripped.
 */
export function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}
