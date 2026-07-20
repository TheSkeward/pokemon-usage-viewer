/**
 * @param {*} value
 * @return {string} Lowercased, alphanumeric-only form ("" for null/undefined).
 */
export function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}
