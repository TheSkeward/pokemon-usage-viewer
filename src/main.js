import "./styles/main.css";

import {
  formatBelongsToFamily,
  getAvailabilitySelectionLabel,
  getDefaultBrowserFormat,
  getLatestAvailabilityMonth,
  getLatestMonth,
  getMovesetEntry,
  getMovesetLookupContext,
  getResolvedFormatLabel,
  getRowsForSelection,
  getSelectionLabel,
  isSyntheticFormat,
  loadAvailability,
  loadFormatData,
  loadFormatsIndex,
  loadMovesetData,
  loadPokemonIndex,
  resolveBestAvailableLightBundle,
  resolveQueryEntries,
} from "./data";
import { readStateFromUrl, writeStateToUrl } from "./router";
import { getState, replaceState, setState } from "./state";
import { renderControls } from "./views/controlsView";
import { renderMovesetPanel } from "./views/movesetView";
import { renderResolverControls } from "./views/resolverControlsView";
import { renderResolverResults } from "./views/resolverResultsView";
import { renderTable } from "./views/tableView";
import { mountPoolOptimizer } from "./poolWidget";
import { computeResolverRepresentativeResults } from "./resolver/representatives";
import { createResolverMovesetController } from "./resolver/movesets";

const app = document.querySelector("#app");
const DESC_SORT_FIELDS = new Set(["usage", "rawCount", "leadTendency"]);
const LITERAL_RESOLVE_LIMIT = 25;
const RESOLVER_INPUT_DEBOUNCE_MS = 300;
const RESOLVER_MOVESET_CACHE_SCHEMA_VERSION = "v4";

let dataset = null,
  formatsIndex = [],
  availability = null,
  pokemonIndex = [],
  browserMovesetData = null,
  browserMovesetKey = null,
  resolverResults = [];
let resolverLoadingState = { loading: false, message: "" };
let syncGeneration = 0,
  resolverDebounceTimer = null;

const resolverMovesets = createResolverMovesetController({
  cacheSchemaVersion: RESOLVER_MOVESET_CACHE_SCHEMA_VERSION,
  getAvailability: () => availability,
  getFormatLabel,
  getState,
  onUpdate: () => rerenderPreservingFocus(),
});

async function init() {
  replaceState(readStateFromUrl());
  formatsIndex = await loadFormatsIndex();
  availability = await loadAvailability();
  pokemonIndex = await loadPokemonIndex();
  resolverMovesets.loadPersistentCache();
  ensureValidFamilyAndFormat();
  dataset = await loadFormatData(getState().format);
  ensureValidMonth();
  ensureValidResolverMonth();
  await ensureBrowserMovesetData();
  resolverResults = await computeResolverResults();
  resolverMovesets.prime();
  writeStateToUrl(getState());
  renderApp();
  resolverMovesets.kick();
}
function ensureValidFamilyAndFormat() {
  const state = getState();
  const fallbackFormat = getDefaultBrowserFormat(state.family);
  if (
    !formatBelongsToFamily(formatsIndex, state.format, state.family) ||
    !formatsIndex.find((format) => format.id === state.format)
  )
    setState({
      format: fallbackFormat,
      month: "all",
      selectedPokemon: null,
      resolverSelectedPokemon: null,
    });
}
function ensureValidMonth() {
  const state = getState();
  const months = dataset.months || [];
  const synthetic = isSyntheticFormat(state.format, formatsIndex);
  if (synthetic) {
    if (state.month === "all" || !months.includes(state.month))
      setState({ month: getLatestMonth(dataset), selectedPokemon: null });
    return;
  }
  if (state.month !== "all" && !months.includes(state.month))
    setState({ month: "all", selectedPokemon: null });
}
function ensureValidResolverMonth() {
  const state = getState();
  const latest = getLatestAvailabilityMonth(availability);
  const months = Object.keys(availability?.months || {});
  if (
    state.resolverMonth !== "all" &&
    (!state.resolverMonth || !months.includes(state.resolverMonth))
  )
    setState({ resolverMonth: latest || "all" });
}
async function ensureBrowserMovesetData() {
  const state = getState();
  const context = getMovesetLookupContext(dataset, formatsIndex, state);
  if (!context) {
    browserMovesetData = null;
    browserMovesetKey = null;
    return;
  }
  const key = `${context.formatId}:${context.month}`;
  if (browserMovesetKey === key) return;
  browserMovesetData = await loadMovesetData(context.formatId, context.month);
  browserMovesetKey = key;
}
async function computeResolverResults() {
  const state = getState();

  return computeResolverRepresentativeResults({
    availability,
    family: state.family,
    pokemonIndex,
    query: state.resolverQuery,
    selection: state.resolverMonth,
    literalResolveLimit: LITERAL_RESOLVE_LIMIT,
  });
}

function renderApp() {
  const state = getState();
  app.innerHTML = `<div class="app-shell"><header><h1>Pokémon Showdown Usage Viewer</h1></header><nav class="view-tabs"><button class="view-tab ${state.family === "singles" ? "active" : ""}" data-app-family="singles">Singles</button><button class="view-tab ${state.family === "doubles" ? "active" : ""}" data-app-family="doubles">Doubles</button></nav><nav class="view-tabs secondary-tabs"><button class="view-tab ${state.view === "resolver" ? "active" : ""}" data-app-view="resolver">Resolver</button><button class="view-tab ${state.view === "pool" ? "active" : ""}" data-app-view="pool">Pool Optimizer</button><button class="view-tab ${state.view === "browser" ? "active" : ""}" data-app-view="browser">Usage Browser</button></nav><section id="page-root" class="page-stack"></section></div>`;
  const pageRoot = document.querySelector("#page-root");
  if (state.view === "resolver") renderResolverPage(pageRoot);
  else if (state.view === "pool") renderPoolPage(pageRoot);
  else renderBrowserPage(pageRoot);
  bindEvents();
}
function renderResolverPage(pageRoot) {
  const state = getState();
  const resolverSelectionLabel = getAvailabilitySelectionLabel(
    availability,
    state.resolverMonth,
  );
  const resolverSelected =
    resolverResults.find(
      (row) => row.pokemonId === state.resolverSelectedPokemon,
    ) || null;
  const resolverMovesetDetail = resolverMovesets.getDetail();
  const resolverMovesetStatus = resolverMovesets.getStatus();

  pageRoot.innerHTML = `<section id="resolver-controls-root"></section><section id="resolver-results-root"></section><section id="details-root"></section>`;
  renderResolverControls(
    document.querySelector("#resolver-controls-root"),
    state,
    availability,
  );
  renderResolverResults(
    document.querySelector("#resolver-results-root"),
    resolverResults,
    state,
    formatsIndex,
    resolverSelectionLabel,
    resolverLoadingState,
  );
  renderMovesetPanel(document.querySelector("#details-root"), {
    selectedPokemonName: resolverSelected?.name || null,
    movesetEntry: resolverMovesetDetail,
    lookupLabel: resolverMovesetDetail
      ? describeResolverMovesetSource(resolverMovesetDetail)
      : "",
    aggregate: getState().resolverMonth === "all",
    stitched: Boolean(resolverMovesetDetail?.stitched),
    status: resolverMovesetStatus,
  });
}
function renderPoolPage(pageRoot) {
  const state = getState();
  pageRoot.innerHTML = `<section id="pool-root" class="page-stack"></section>`;
  mountPoolOptimizer(document.querySelector("#pool-root"), {
    embedded: true,
    family: state.family,
  });
}
function renderBrowserPage(pageRoot) {
  const state = getState();
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
  pageRoot.innerHTML = `<section id="controls-root"></section><main id="content-root"></main><section id="details-root"></section>`;
  renderControls(
    document.querySelector("#controls-root"),
    state,
    dataset,
    formatsIndex,
  );
  renderTable(document.querySelector("#content-root"), rows, state, {
    isAggregate: state.month === "all",
    resolvedFormatLabel,
    selectionLabel,
  });
  renderMovesetPanel(document.querySelector("#details-root"), {
    selectedPokemonName:
      browserSelectedRow?.name || browserMovesetEntry?.name || null,
    movesetEntry: browserMovesetEntry,
    lookupLabel: browserMovesetContext?.label || "",
    aggregate: Boolean(browserMovesetContext?.aggregate),
    stitched: false,
    status: null,
  });
}
function describeResolverMovesetSource(source) {
  const label = getFormatLabel(source.formatId);
  if (source.selection === "all")
    return source.stitched
      ? `${label} @ ${source.cutoff} (all available, ${source.monthsPresent}/${source.monthsAvailable} months with this mon; fallback tail)`
      : `${label} @ ${source.cutoff} (all available, ${source.monthsPresent}/${source.monthsAvailable} months with this mon)`;
  return source.stitched
    ? `${label} @ ${source.cutoff} (${source.month}; fallback tail)`
    : `${label} @ ${source.cutoff} (${source.month})`;
}
function getFormatLabel(formatId) {
  return (
    formatsIndex.find((format) => format.id === formatId)?.label || formatId
  );
}
function bindEvents() {
  const formatSelect = document.querySelector("#format-select"),
    monthSelect = document.querySelector("#month-select"),
    searchInput = document.querySelector("#search-input"),
    resolverMonthSelect = document.querySelector("#resolver-month-select"),
    resolverQueryInput = document.querySelector("#resolver-query-input");
  document.querySelectorAll("[data-app-family]").forEach((button) =>
    button.addEventListener("click", async (event) => {
      const nextFamily = event.currentTarget.dataset.appFamily;
      if (nextFamily === getState().family) return;
      clearPendingResolverDebounce();
      const nextFormat = getDefaultBrowserFormat(nextFamily);
      dataset = await loadFormatData(nextFormat);
      setState({
        family: nextFamily,
        format: nextFormat,
        month: "all",
        selectedPokemon: null,
        resolverSelectedPokemon: null,
      });
      await sync();
    }),
  );
  document.querySelectorAll("[data-app-view]").forEach((button) =>
    button.addEventListener("click", async (event) => {
      const nextView = event.currentTarget.dataset.appView;
      if (nextView === getState().view) return;
      setState({ view: nextView });
      await sync({ recomputeResolverResults: false });
    }),
  );
  formatSelect?.addEventListener("change", async (event) => {
    clearPendingResolverDebounce();
    const format = event.target.value;
    const nextDataset = await loadFormatData(format);
    const synthetic = isSyntheticFormat(format, formatsIndex);
    const month = synthetic ? getLatestMonth(nextDataset) : "all";
    dataset = nextDataset;
    setState({ format, month, selectedPokemon: null });
    await sync();
  });
  monthSelect?.addEventListener("change", async (event) => {
    clearPendingResolverDebounce();
    setState({ month: event.target.value, selectedPokemon: null });
    await sync();
  });
  searchInput?.addEventListener("input", async (event) => {
    clearPendingResolverDebounce();
    setState({ search: event.target.value });
    await sync();
  });
  resolverMonthSelect?.addEventListener("change", async (event) => {
    clearPendingResolverDebounce();
    setState({
      resolverMonth: event.target.value,
      resolverSelectedPokemon: null,
    });
    await sync();
  });
  resolverQueryInput?.addEventListener("input", (event) => {
    setState({
      resolverQuery: event.target.value,
      resolverSelectedPokemon: null,
    });
    writeStateToUrl(getState());
    clearPendingResolverDebounce();
    resolverDebounceTimer = setTimeout(
      () => sync(),
      RESOLVER_INPUT_DEBOUNCE_MS,
    );
  });
  document.querySelectorAll("[data-sort-by]").forEach((button) =>
    button.addEventListener("click", async (event) => {
      clearPendingResolverDebounce();
      const nextSortBy = event.currentTarget.dataset.sortBy;
      const state = getState();
      const nextSortDir =
        state.sortBy === nextSortBy
          ? state.sortDir === "asc"
            ? "desc"
            : "asc"
          : DESC_SORT_FIELDS.has(nextSortBy)
            ? "desc"
            : "asc";
      setState({ sortBy: nextSortBy, sortDir: nextSortDir });
      await sync();
    }),
  );
  document.querySelectorAll("[data-pokemon-id]").forEach((row) =>
    row.addEventListener("click", async (event) => {
      clearPendingResolverDebounce();
      const pokemonId = event.currentTarget.dataset.pokemonId;
      const state = getState();
      setState({
        selectedPokemon: state.selectedPokemon === pokemonId ? null : pokemonId,
        resolverSelectedPokemon: null,
        view: "browser",
      });
      await sync({ recomputeResolverResults: false });
    }),
  );
  document.querySelectorAll("[data-resolver-pokemon-id]").forEach((row) =>
    row.addEventListener("click", async (event) => {
      clearPendingResolverDebounce();
      const pokemonId = event.currentTarget.dataset.resolverPokemonId;
      const state = getState();
      setState({
        resolverSelectedPokemon:
          state.resolverSelectedPokemon === pokemonId ? null : pokemonId,
        selectedPokemon: null,
        view: "resolver",
      });
      await sync({ recomputeResolverResults: false });
    }),
  );
}
function clearPendingResolverDebounce() {
  if (resolverDebounceTimer) {
    clearTimeout(resolverDebounceTimer);
    resolverDebounceTimer = null;
  }
}
function getResolverLoadingMessage() {
  const query = getState().resolverQuery || "";
  const tokens = query
    .split(/[,\n]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length >= 8) {
    return `Resolving ${tokens.length} inputs across best available data...`;
  }

  if (tokens.length > 1) {
    return `Resolving ${tokens.length} inputs...`;
  }

  return "Resolving Pokémon...";
}

function waitForPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

function renderResolverLoadingNow() {
  const state = getState();
  if (state.view !== "resolver" || !state.resolverQuery.trim()) return;

  resolverLoadingState = {
    loading: true,
    message: getResolverLoadingMessage(),
  };

  const focusState = captureFocusState();
  writeStateToUrl(getState());
  renderApp();
  restoreFocusState(focusState);
}

async function sync(options = {}) {
  const { recomputeResolverResults = true } = options;
  const focusState = captureFocusState();
  const generation = ++syncGeneration;

  resolverMovesets.prime();
  await ensureBrowserMovesetData();

  let nextResolverResults = resolverResults;

  if (recomputeResolverResults) {
    renderResolverLoadingNow();
    await waitForPaint();
    nextResolverResults = await computeResolverResults();
  }

  if (generation !== syncGeneration) return;

  if (recomputeResolverResults) {
    resolverLoadingState = { loading: false, message: "" };
    resolverResults = nextResolverResults;

    const validIds = new Set(resolverResults.map((row) => row.pokemonId));
    if (
      getState().resolverSelectedPokemon &&
      !validIds.has(getState().resolverSelectedPokemon)
    ) {
      setState({ resolverSelectedPokemon: null });
      resolverMovesets.prime();
    }
  }

  writeStateToUrl(getState());
  renderApp();

  if (generation !== syncGeneration) return;

  restoreFocusState(focusState);
  resolverMovesets.kick();
}

function rerenderPreservingFocus() {
  const focusState = captureFocusState();
  renderApp();
  restoreFocusState(focusState);
}
function captureFocusState() {
  const active = document.activeElement;
  if (active?.id === "search-input" || active?.id === "resolver-query-input")
    return {
      id: active.id,
      selectionStart: active.selectionStart ?? null,
      selectionEnd: active.selectionEnd ?? null,
    };
  return null;
}
function restoreFocusState(focusState) {
  if (!focusState?.id) return;
  const input = document.querySelector(`#${focusState.id}`);
  if (!input) return;
  input.focus();
  if (
    typeof focusState.selectionStart === "number" &&
    typeof focusState.selectionEnd === "number"
  )
    input.setSelectionRange(focusState.selectionStart, focusState.selectionEnd);
}
init().catch((error) => {
  console.error(error);
  app.innerHTML = `<div class="app-shell"><h1>Pokémon Showdown Usage Viewer</h1><p>Something broke while loading the app.</p><pre>${error.message}</pre></div>`;
});
