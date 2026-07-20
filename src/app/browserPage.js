import {
  getMovesetEntry,
  getMovesetLookupContext,
  getResolvedFormatLabel,
  getRowsForSelection,
  getSelectionLabel,
} from '../data';
import { renderControls } from '../views/controlsView';
import { renderMovesetPanel } from '../views/movesetView';
import { renderTable } from '../views/tableView';

/**
 * Renders the Usage Data page (controls, usage table, moveset panel) into
 * `pageRoot`, replacing its contents.
 * @param {!Element} pageRoot
 * @param {{browserMovesetData: ?Object, dataset: !Object,
 *     formatsIndex: !Array<!Object>, state: !Object}} context
 */
export function renderBrowserPage(pageRoot, context) {
  const { browserMovesetData, dataset, formatsIndex, state } = context;

  const rows = getRowsForSelection(dataset, state.month);
  const resolvedFormatLabel = getResolvedFormatLabel(
    dataset,
    formatsIndex,
    state.month,
  );
  const selectionLabel = getSelectionLabel(dataset, state.month);
  const browserSelectedRow =
    rows.find((row) => row.pokemonId === state.selectedPokemon) || null;
  const browserMovesetContext = getMovesetLookupContext(
    dataset,
    formatsIndex,
    state,
  );
  const browserMovesetEntry = getMovesetEntry(
    browserMovesetData,
    state.selectedPokemon,
  );

  pageRoot.innerHTML = `
    <section id="controls-root"></section>
    <main id="content-root"></main>
    <section id="details-root"></section>
  `;

  renderControls(
    document.querySelector('#controls-root'),
    state,
    dataset,
    formatsIndex,
  );

  renderTable(document.querySelector('#content-root'), rows, state, {
    isAggregate: state.month === 'all',
    resolvedFormatLabel,
    selectionLabel,
  });

  renderMovesetPanel(document.querySelector('#details-root'), {
    selectedPokemonName:
      browserSelectedRow?.name || browserMovesetEntry?.name || null,
    movesetEntry: browserMovesetEntry,
    lookupLabel: browserMovesetContext?.label || '',
    aggregate: Boolean(browserMovesetContext?.aggregate),
    stitched: false,
    status: null,
  });
}
