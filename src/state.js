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

export function getState() {
  return currentState;
}

export function replaceState(nextState) {
  currentState = { ...nextState };
}

export function setState(patch) {
  currentState = { ...currentState, ...patch };
}
