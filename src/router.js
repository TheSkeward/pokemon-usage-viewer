import { DEFAULT_STATE } from './state';

const VALID_SORT_FIELDS = new Set(['rank', 'name', 'usage', 'rawCount', 'leadTendency']);
const VALID_SORT_DIRS = new Set(['asc', 'desc']);
const VALID_VIEWS = new Set(['resolver', 'pool', 'browser']);
const VALID_FAMILIES = new Set(['singles', 'doubles']);

export function readStateFromUrl() {
  const params = new URLSearchParams(window.location.search);

  return {
    ...DEFAULT_STATE,
    view: VALID_VIEWS.has(params.get('view')) ? params.get('view') : DEFAULT_STATE.view,
    family: VALID_FAMILIES.has(params.get('family')) ? params.get('family') : DEFAULT_STATE.family,
    format: params.get('format') || DEFAULT_STATE.format,
    month: params.get('month') || DEFAULT_STATE.month,
    search: params.get('search') || DEFAULT_STATE.search,
    sortBy: VALID_SORT_FIELDS.has(params.get('sortBy')) ? params.get('sortBy') : DEFAULT_STATE.sortBy,
    sortDir: VALID_SORT_DIRS.has(params.get('sortDir')) ? params.get('sortDir') : DEFAULT_STATE.sortDir,
    selectedPokemon: params.get('pokemon') || DEFAULT_STATE.selectedPokemon,
    resolverMonth: params.get('resolverMonth') || DEFAULT_STATE.resolverMonth,
    resolverQuery: params.get('resolverQuery') || DEFAULT_STATE.resolverQuery,
    resolverSelectedPokemon: params.get('resolverPokemon') || DEFAULT_STATE.resolverSelectedPokemon,
  };
}

export function writeStateToUrl(state) {
  const params = new URLSearchParams();

  params.set('view', state.view);
  params.set('family', state.family);

  // Only the pool view's own params belong in a pool URL. format/month drive
  // the usage browser and resolverMonth/... the resolver — writing them from
  // the pool view would just fossilize whatever the other views last showed
  // into every shared link.
  if (state.view !== 'pool') {
    params.set('format', state.format);
    params.set('month', state.month);

    if (state.search) params.set('search', state.search);
    if (state.sortBy !== DEFAULT_STATE.sortBy) params.set('sortBy', state.sortBy);
    if (state.sortDir !== DEFAULT_STATE.sortDir) params.set('sortDir', state.sortDir);
    if (state.selectedPokemon) params.set('pokemon', state.selectedPokemon);
    if (state.resolverMonth) params.set('resolverMonth', state.resolverMonth);
    if (state.resolverQuery) params.set('resolverQuery', state.resolverQuery);
    if (state.resolverSelectedPokemon) params.set('resolverPokemon', state.resolverSelectedPokemon);
  }

  const nextUrl = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState(null, '', nextUrl);
}
