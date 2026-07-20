/** @const {!Object} */
export const DEFAULT_STATE = {
  view: 'pool',
  family: 'singles',
  format: 'gen7anythinggoes',
  month: 'all',
  search: '',
  sortBy: 'rank',
  sortDir: 'asc',
  selectedPokemon: null,
  resolverMonth: 'all',
  resolverQuery: '',
  resolverSelectedPokemon: null,
};

let currentState = { ...DEFAULT_STATE };

/** @return {!Object} */
export function getState() {
  return currentState;
}

/** @param {!Object} nextState */
export function replaceState(nextState) {
  currentState = { ...nextState };
}

/**
 * Shallow-merges patch into the current state.
 * @param {!Object} patch
 */
export function setState(patch) {
  currentState = { ...currentState, ...patch };
}
