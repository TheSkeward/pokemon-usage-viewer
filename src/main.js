import "./styles/main.css";

import {
  formatBelongsToFamily,
  getDefaultBrowserFormat,
  getLatestAvailabilityMonth,
  getLatestMonth,
  getMovesetLookupContext,
  isSyntheticFormat,
  loadAvailability,
  loadFormatData,
  loadFormatsIndex,
  loadMovesetData,
  loadPokemonIndex,
} from "./data";
import { bindAppEvents } from "./app/appEvents";
import { renderBrowserPage } from "./app/browserPage";
import { captureFocusState, restoreFocusState } from "./app/focusState";
import { renderFatalAppError, renderAppShell } from "./app/appShellView";
import { renderResolverPage } from "./app/resolverPage";
import { readStateFromUrl, writeStateToUrl } from "./router";
import { getState, replaceState, setState } from "./state";
import { mountPoolOptimizer } from "./poolWidget";
import { computeResolverRepresentativeResults } from "./resolver/representatives";
import { createPrecomputedSetDetailsLoader } from "./setDetails/precomputedSetDetails";

const app = document.querySelector("#app");
const DESC_SORT_FIELDS = new Set(["usage", "rawCount", "leadTendency"]);
const LITERAL_RESOLVE_LIMIT = 25;
const RESOLVER_INPUT_DEBOUNCE_MS = 300;

let dataset = null;
let formatsIndex = [];
let availability = null;
let pokemonIndex = [];
let browserMovesetData = null;
let browserMovesetKey = null;
let resolverResults = [];
let resolverLoadingState = { loading: false, message: "" };
let syncGeneration = 0;
let resolverDebounceTimer = null;

const resolverSetDetails = createPrecomputedSetDetailsLoader({
  getFamily: () => getState().family,
  getSelection: () => getState().resolverMonth,
  onUpdate: () => rerenderPreservingFocus(),
});

async function init() {
  replaceState(readStateFromUrl());

  formatsIndex = await loadFormatsIndex();
  availability = await loadAvailability();
  pokemonIndex = await loadPokemonIndex();

  ensureValidFamilyAndFormat();

  dataset = await loadFormatData(getState().format);

  ensureValidMonth();
  ensureValidResolverMonth();

  await ensureBrowserMovesetData();

  resolverResults = await computeResolverResults();

  writeStateToUrl(getState());
  renderApp();
  syncResolverSetDetailsSelection();
}

function ensureValidFamilyAndFormat() {
  const state = getState();
  const fallbackFormat = getDefaultBrowserFormat(state.family);

  if (
    !formatBelongsToFamily(formatsIndex, state.format, state.family) ||
    !formatsIndex.find((format) => format.id === state.format)
  ) {
    setState({
      format: fallbackFormat,
      month: "all",
      selectedPokemon: null,
      resolverSelectedPokemon: null,
    });
  }
}

function ensureValidMonth() {
  const state = getState();
  const months = dataset.months || [];
  const synthetic = isSyntheticFormat(state.format, formatsIndex);

  if (synthetic) {
    if (state.month === "all" || !months.includes(state.month)) {
      setState({ month: getLatestMonth(dataset), selectedPokemon: null });
    }
    return;
  }

  if (state.month !== "all" && !months.includes(state.month)) {
    setState({ month: "all", selectedPokemon: null });
  }
}

function ensureValidResolverMonth() {
  const state = getState();
  const latest = getLatestAvailabilityMonth(availability);
  const months = Object.keys(availability?.months || {});

  if (
    state.resolverMonth !== "all" &&
    (!state.resolverMonth || !months.includes(state.resolverMonth))
  ) {
    setState({ resolverMonth: latest || "all" });
  }
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

  renderAppShell(app, state);

  const pageRoot = document.querySelector("#page-root");

  if (state.view === "resolver") {
    renderResolverPage(pageRoot, {
      availability,
      formatsIndex,
      resolverLoadingState,
      resolverResults,
      setDetails: resolverSetDetails,
      state,
    });
  } else if (state.view === "pool") {
    renderPoolPage(pageRoot);
  } else {
    renderBrowserPage(pageRoot, {
      browserMovesetData,
      dataset,
      formatsIndex,
      state,
    });
  }

  bindEvents();
}

function renderPoolPage(pageRoot) {
  pageRoot.innerHTML = `<section id="pool-root" class="page-stack"></section>`;

  mountPoolOptimizer(document.querySelector("#pool-root"), {
    embedded: true,
    family: getState().family,
  });
}

function bindEvents() {
  bindAppEvents({
    onBrowserPokemonClick: handleBrowserPokemonClick,
    onFamilyChange: handleFamilyChange,
    onFormatChange: handleFormatChange,
    onMonthChange: handleMonthChange,
    onResolverMonthChange: handleResolverMonthChange,
    onResolverPokemonClick: handleResolverPokemonClick,
    onResolverQueryInput: handleResolverQueryInput,
    onSearchInput: handleSearchInput,
    onSort: handleSort,
    onViewChange: handleViewChange,
  });
}

async function handleFamilyChange(nextFamily) {
  if (nextFamily === getState().family) return;

  clearPendingResolverDebounce();
  resolverSetDetails.cancel();

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
}

async function handleViewChange(nextView) {
  if (nextView === getState().view) return;

  setState({ view: nextView });

  await sync({ recomputeResolverResults: false });
}

async function handleFormatChange(format) {
  clearPendingResolverDebounce();

  const nextDataset = await loadFormatData(format);
  const synthetic = isSyntheticFormat(format, formatsIndex);
  const month = synthetic ? getLatestMonth(nextDataset) : "all";

  dataset = nextDataset;

  setState({ format, month, selectedPokemon: null });

  await sync();
}

async function handleMonthChange(month) {
  clearPendingResolverDebounce();

  setState({ month, selectedPokemon: null });

  await sync();
}

async function handleSearchInput(search) {
  clearPendingResolverDebounce();

  setState({ search });

  await sync();
}

async function handleResolverMonthChange(resolverMonth) {
  clearPendingResolverDebounce();
  resolverSetDetails.cancel();

  setState({
    resolverMonth,
    resolverSelectedPokemon: null,
  });

  await sync();
}

function handleResolverQueryInput(resolverQuery) {
  setState({
    resolverQuery,
    resolverSelectedPokemon: null,
  });

  resolverSetDetails.cancel();
  writeStateToUrl(getState());
  clearPendingResolverDebounce();

  resolverDebounceTimer = setTimeout(() => sync(), RESOLVER_INPUT_DEBOUNCE_MS);
}

async function handleSort(nextSortBy) {
  clearPendingResolverDebounce();

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
}

async function handleBrowserPokemonClick(pokemonId) {
  clearPendingResolverDebounce();
  resolverSetDetails.cancel();

  const state = getState();

  setState({
    selectedPokemon: state.selectedPokemon === pokemonId ? null : pokemonId,
    resolverSelectedPokemon: null,
    view: "browser",
  });

  await sync({ recomputeResolverResults: false });
}

async function handleResolverPokemonClick(pokemonId) {
  clearPendingResolverDebounce();

  const state = getState();
  const nextSelected =
    state.resolverSelectedPokemon === pokemonId ? null : pokemonId;

  setState({
    resolverSelectedPokemon: nextSelected,
    selectedPokemon: null,
    view: "resolver",
  });

  if (nextSelected) {
    resolverSetDetails.select(nextSelected);
  } else {
    resolverSetDetails.cancel();
  }

  await sync({ recomputeResolverResults: false });
}

function clearPendingResolverDebounce() {
  if (!resolverDebounceTimer) return;

  clearTimeout(resolverDebounceTimer);
  resolverDebounceTimer = null;
}

function getResolverLoadingMessage() {
  const tokens = (getState().resolverQuery || "")
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
    ensureResolverSelectionStillExists();
  }

  writeStateToUrl(getState());
  renderApp();

  if (generation !== syncGeneration) return;

  restoreFocusState(focusState);
  syncResolverSetDetailsSelection();
}

function ensureResolverSelectionStillExists() {
  const selectedPokemon = getState().resolverSelectedPokemon;
  if (!selectedPokemon) return;

  const validIds = new Set(resolverResults.map((row) => row.pokemonId));

  if (!validIds.has(selectedPokemon)) {
    setState({ resolverSelectedPokemon: null });
    resolverSetDetails.cancel();
  }
}

function syncResolverSetDetailsSelection() {
  const state = getState();

  if (state.view !== "resolver") return;

  if (!state.resolverSelectedPokemon) {
    resolverSetDetails.cancel();
    return;
  }

  if (
    resolverSetDetails.getSelectedPokemonId() !== state.resolverSelectedPokemon
  ) {
    resolverSetDetails.select(state.resolverSelectedPokemon);
  }
}

function rerenderPreservingFocus() {
  const focusState = captureFocusState();

  renderApp();
  restoreFocusState(focusState);
}

function waitForPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

init().catch((error) => {
  console.error(error);
  renderFatalAppError(app, error);
});
