import { escapeHtml } from '../utils/html.js';
const SORTERS = {
  rank: (a, b) => a.rank - b.rank,
  name: (a, b) => a.name.localeCompare(b.name),
  usage: (a, b) => a.usage - b.usage,
  rawCount: (a, b) => a.rawCount - b.rawCount,
  leadTendency: (a, b) => (a.leadTendency || 0) - (b.leadTendency || 0),
};

/**
 * Usage table, filtered by state.search and sorted by state.sortBy/sortDir.
 * @param {!Element} container
 * @param {!Array<!Object>} rows
 * @param {!Object} state
 * @param {{selectionLabel: (string|undefined),
 *     resolvedFormatLabel: (string|undefined)}=} options
 */
export function renderTable(container, rows, state, options = {}) {
  const filteredRows = filterRows(rows, state.search);
  const sortedRows = sortRows(filteredRows, state.sortBy, state.sortDir);
  container.innerHTML = `
    <section class="panel">
      <div class="panel-header"><div><h2>Usage Table</h2><p>${sortedRows.length} Pokémon shown for ${options.selectionLabel || state.month}</p>${options.resolvedFormatLabel ? `<p>Resolved format: ${options.resolvedFormatLabel}</p>` : ''}</div></div>
      <table class="usage-table"><thead><tr>${renderHeaderCell('rank', 'Rank', state)}${renderHeaderCell('name', 'Pokémon', state)}${renderHeaderCell('usage', 'Usage %', state)}${renderHeaderCell('leadTendency', 'Lead %', state)}${renderHeaderCell('rawCount', 'Raw Count', state)}</tr></thead><tbody>
        ${sortedRows.map((row) => `<tr data-pokemon-id="${row.pokemonId}" class="${row.pokemonId === state.selectedPokemon ? 'selected' : ''}"><td>${row.rank}</td><td>${escapeHtml(row.name)}</td><td>${row.usage.toFixed(2)}</td><td>${(row.leadTendency || 0).toFixed(1)}</td><td>${row.rawCount.toLocaleString()}</td></tr>`).join('')}
      </tbody></table>
    </section>`;
}
function filterRows(rows, search) {
  const query = search.trim().toLowerCase();
  if (!query) return rows;
  return rows.filter((row) => row.name.toLowerCase().includes(query));
}
function sortRows(rows, sortBy, sortDir) {
  const sorter = SORTERS[sortBy] || SORTERS.rank;
  const multiplier = sortDir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => sorter(a, b) * multiplier);
}
function renderHeaderCell(field, label, state) {
  const isActive = state.sortBy === field;
  const arrow = !isActive ? '' : state.sortDir === 'asc' ? ' ↑' : ' ↓';
  return `<th><button class="sort-button ${isActive ? 'active' : ''}" data-sort-by="${field}">${label}${arrow}</button></th>`;
}
