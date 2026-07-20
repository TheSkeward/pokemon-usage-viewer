/**
 * Attaches listeners to the currently rendered DOM; must be rebound after
 * any innerHTML replacement, since listeners die with the replaced nodes.
 * @param {!Object<string, function(string)>} handlers Keyed by hook name
 *     (onFamilyChange, onSort, ...); each receives the relevant dataset or
 *     input value as a string.
 */
export function bindAppEvents(handlers) {
  document.querySelectorAll('[data-app-family]').forEach((button) => {
    button.addEventListener('click', () => {
      handlers.onFamilyChange(button.dataset.appFamily);
    });
  });

  document.querySelectorAll('[data-app-view]').forEach((button) => {
    button.addEventListener('click', () => {
      handlers.onViewChange(button.dataset.appView);
    });
  });

  document
    .querySelector('#format-select')
    ?.addEventListener('change', (event) => {
      handlers.onFormatChange(event.target.value);
    });

  document
    .querySelector('#month-select')
    ?.addEventListener('change', (event) => {
      handlers.onMonthChange(event.target.value);
    });

  document
    .querySelector('#search-input')
    ?.addEventListener('input', (event) => {
      handlers.onSearchInput(event.target.value);
    });

  document
    .querySelector('#resolver-month-select')
    ?.addEventListener('change', (event) => {
      handlers.onResolverMonthChange(event.target.value);
    });

  document
    .querySelector('#resolver-query-input')
    ?.addEventListener('input', (event) => {
      handlers.onResolverQueryInput(event.target.value);
    });

  document.querySelectorAll('[data-sort-by]').forEach((button) => {
    button.addEventListener('click', () => {
      handlers.onSort(button.dataset.sortBy);
    });
  });

  document.querySelectorAll('[data-pokemon-id]').forEach((row) => {
    row.addEventListener('click', () => {
      handlers.onBrowserPokemonClick(row.dataset.pokemonId);
    });
  });

  document.querySelectorAll('[data-resolver-pokemon-id]').forEach((row) => {
    row.addEventListener('click', () => {
      handlers.onResolverPokemonClick(row.dataset.resolverPokemonId);
    });
  });
}
