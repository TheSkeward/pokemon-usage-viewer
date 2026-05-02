import './styles/main.css';

import { formatBelongsToFamily, getAvailabilitySelectionLabel, getDefaultBrowserFormat, getLatestAvailabilityMonth, getLatestMonth, getMovesetEntry, getMovesetLookupContext, getResolvedFormatLabel, getRowsForSelection, getSelectionLabel,
  getLineRepresentativeCandidates, getMovesetResolverCandidates, isSyntheticFormat, loadAggregatedMovesetCandidate, loadAvailability, loadFormatData, loadFormatsIndex, loadMovesetData, loadPokemonIndex, resolveBestAvailableLightBundle, resolveQueryEntries } from './data';
import { readStateFromUrl, writeStateToUrl } from './router';
import { getState, replaceState, setState } from './state';
import { renderControls } from './views/controlsView';
import { renderMovesetPanel } from './views/movesetView';
import { renderResolverControls } from './views/resolverControlsView';
import { renderResolverResults } from './views/resolverResultsView';
import { renderTable } from './views/tableView'; import { mountPoolOptimizer } from './poolWidget';

const app = document.querySelector('#app');
const DESC_SORT_FIELDS = new Set(['usage', 'rawCount', 'leadTendency']);
const LITERAL_RESOLVE_LIMIT = 25;
const RESOLVER_INPUT_DEBOUNCE_MS = 300;
const RESOLVER_MOVESET_CACHE_SCHEMA_VERSION = 'v4';

let dataset = null, formatsIndex = [], availability = null, pokemonIndex = [], browserMovesetData = null, browserMovesetKey = null, resolverResults = [];
let resolverLoadingState = { loading: false, message: '' };
let resolverMovesetDetail = null, resolverMovesetStatus = { phase: 'idle', checked: 0, total: 0, contributed: 0 }, resolverMovesetSelectionKey = null, resolverMovesetRequestToken = 0, resolverMovesetInFlightKey = null;
const resolverMovesetDetailCache = new Map();
let syncGeneration = 0, resolverDebounceTimer = null;

async function init() {
  replaceState(readStateFromUrl());
  formatsIndex = await loadFormatsIndex(); availability = await loadAvailability(); pokemonIndex = await loadPokemonIndex(); loadResolverMovesetPersistentCache();
  ensureValidFamilyAndFormat(); dataset = await loadFormatData(getState().format); ensureValidMonth(); ensureValidResolverMonth();
  await ensureBrowserMovesetData(); resolverResults = await computeResolverResults(); primeResolverMovesetState(); writeStateToUrl(getState()); renderApp(); kickResolverMovesetLoad();
}
function ensureValidFamilyAndFormat() { const state = getState(); const fallbackFormat = getDefaultBrowserFormat(state.family); if (!formatBelongsToFamily(formatsIndex, state.format, state.family) || !formatsIndex.find((format) => format.id === state.format)) setState({ format: fallbackFormat, month: 'all', selectedPokemon: null, resolverSelectedPokemon: null }); }
function ensureValidMonth() { const state = getState(); const months = dataset.months || []; const synthetic = isSyntheticFormat(state.format, formatsIndex); if (synthetic) { if (state.month === 'all' || !months.includes(state.month)) setState({ month: getLatestMonth(dataset), selectedPokemon: null }); return; } if (state.month !== 'all' && !months.includes(state.month)) setState({ month: 'all', selectedPokemon: null }); }
function ensureValidResolverMonth() { const state = getState(); const latest = getLatestAvailabilityMonth(availability); const months = Object.keys(availability?.months || {}); if (state.resolverMonth !== 'all' && (!state.resolverMonth || !months.includes(state.resolverMonth))) setState({ resolverMonth: latest || 'all' }); }
async function ensureBrowserMovesetData() { const state = getState(); const context = getMovesetLookupContext(dataset, formatsIndex, state); if (!context) { browserMovesetData = null; browserMovesetKey = null; return; } const key = `${context.formatId}:${context.month}`; if (browserMovesetKey === key) return; browserMovesetData = await loadMovesetData(context.formatId, context.month); browserMovesetKey = key; }
async function computeResolverResults() {
  const state = getState();
  const entries = resolveQueryEntries(state.resolverQuery, pokemonIndex);
  const groups = groupResolverEntries(entries);

  const rawResults = await Promise.all(
    groups.map(async (group) => {
      if (group.mode === 'literal') {
        return resolveLiteralSearchGroup(group, state);
      }

      const representativeCandidates = buildRepresentativeCandidatePool(group.entries);
      const forcedExact = getForcedExactRepresentative(group.entries, representativeCandidates);
      const candidatesToScore = forcedExact ? [forcedExact] : representativeCandidates;

      const candidateResults = await Promise.all(
        candidatesToScore.map(async (candidate) => {
          const bundle = await resolveBestAvailableLightBundle({
            availability,
            family: state.family,
            selection: state.resolverMonth,
            pokemonId: candidate.id,
          });

          return {
            candidate,
            bundle,
            score: scoreRepresentativeCandidate(candidate, bundle, state.family),
          };
        })
      );

      const best =
        candidateResults
          .filter((result) => Number.isFinite(result.score))
          .sort((a, b) => b.score - a.score)[0] ||
        candidateResults.find((result) => result.candidate.isExactInput) ||
        candidateResults[0];

      const bestNonMega =
        candidateResults
          .filter((result) => Number.isFinite(result.score) && !result.candidate.isMega)
          .sort((a, b) => b.score - a.score)[0] || null;

      const displayInput = getDisplayInputForGroup(group.entries);

      if (!best) {
        return {
          pokemonId: displayInput.id,
          name: displayInput.name,
          inputPokemonId: displayInput.id,
          inputName: displayInput.name,
          token: displayInput.token,
          representativeIsMega: false,
          representativeScore: -Infinity,
          bundle: { usage: null, leads: null },
        };
      }

      return {
        pokemonId: best.candidate.id,
        name: best.candidate.name,
        inputPokemonId: displayInput.id,
        inputName: displayInput.name,
        token: displayInput.token,
        representativeIsMega: Boolean(best.candidate.isMega),
        representativeScore: best.score,
        bestNonMegaPokemonId: bestNonMega?.candidate.id || null,
        bestNonMegaName: bestNonMega?.candidate.name || null,
        bestNonMegaScore: bestNonMega?.score ?? null,
        bestNonMegaUsage: bestNonMega?.bundle?.usage?.value ?? null,
        candidateCount: representativeCandidates.length,
        bundle: best.bundle,
      };
    })
  );

  const results = dedupeRepresentativeRows(rawResults.flat());

  results.sort((a, b) => {
    if (a.broadMatch || b.broadMatch) {
      if (a.broadMatch !== b.broadMatch) return a.broadMatch ? 1 : -1;

      const usageA = a.bundle.usage?.value ?? -Infinity;
      const usageB = b.bundle.usage?.value ?? -Infinity;
      if (usageB !== usageA) return usageB - usageA;

      return a.name.localeCompare(b.name);
    }

    const leadA = a.bundle.leads?.value ?? -Infinity;
    const leadB = b.bundle.leads?.value ?? -Infinity;
    if (leadB !== leadA) return leadB - leadA;

    const scoreA = a.representativeScore ?? -Infinity;
    const scoreB = b.representativeScore ?? -Infinity;
    if (scoreB !== scoreA) return scoreB - scoreA;

    const usageA = a.bundle.usage?.value ?? -Infinity;
    const usageB = b.bundle.usage?.value ?? -Infinity;
    if (usageB !== usageA) return usageB - usageA;

    return a.name.localeCompare(b.name);
  });

  return results;
}

async function resolveLiteralSearchGroup(group, state) {
  const shouldResolveData = group.entries.length <= LITERAL_RESOLVE_LIMIT;

  return Promise.all(
    group.entries.map(async (entry) => ({
      pokemonId: entry.id,
      name: entry.name,
      inputPokemonId: entry.id,
      inputName: entry.name,
      token: entry.token,
      representativeIsMega: false,
      representativeScore: -Infinity,
      broadMatch: true,
      literalSearchOnly: !shouldResolveData,
      bundle: shouldResolveData
        ? await resolveBestAvailableLightBundle({
            availability,
            family: state.family,
            selection: state.resolverMonth,
            pokemonId: entry.id,
          })
        : { usage: null, leads: null },
    }))
  );
}

function groupResolverEntries(entries) {
  const tokenGroups = new Map();

  for (const entry of entries) {
    const tokenKey = normalizeName(entry.token || entry.name);
    if (!tokenGroups.has(tokenKey)) tokenGroups.set(tokenKey, []);
    tokenGroups.get(tokenKey).push(entry);
  }

  const groups = [];

  for (const tokenEntries of tokenGroups.values()) {
    const entriesByLine = new Map();

    for (const entry of tokenEntries) {
      const lineKey = getRepresentativeLineKey(entry.id);
      if (!entriesByLine.has(lineKey)) entriesByLine.set(lineKey, []);
      entriesByLine.get(lineKey).push(entry);
    }

    const hasBroadMatch = tokenEntries.some((entry) => entry.broadMatch);
    const token = normalizeName(tokenEntries[0]?.token || '');
    const formSpecificPrefix =
      tokenEntries.length > 1 &&
      tokenLooksLikeSpecificFormPrefix(token) &&
      tokenEntries.every((entry) => isSpecificFormId(entry.id));

    // If one typed token fans out into unrelated evo/reachability lines, this is search,
    // not competitive inference. Do not let Machamp and Medicham share a candidate pool.
    //
    // Also, if the token is form-specific-but-incomplete, e.g. "mewtwo-m",
    // show the matching forms literally instead of turning Mega-X into Mega-Y.
    if (hasBroadMatch || entriesByLine.size > 1 || formSpecificPrefix) {
      groups.push({ mode: 'literal', entries: tokenEntries });
      continue;
    }

    groups.push({ mode: 'representative', entries: tokenEntries });
  }

  return groups;
}

function tokenLooksLikeSpecificFormPrefix(token) {
  return (
    token.includes('mega') ||
    token.endsWith('m') ||
    token.includes('alola') ||
    token.includes('galar') ||
    token.includes('hisui')
  );
}

function getRepresentativeLineKey(pokemonId) {
  const candidates = getLineRepresentativeCandidates(pokemonId, pokemonIndex);
  if (!candidates.length) return pokemonId;
  return candidates
    .map((candidate) => candidate.id)
    .sort()
    .join('|');
}

function buildRepresentativeCandidatePool(group) {
  const candidateMap = new Map();

  for (const entry of group) {
    for (const candidate of getLineRepresentativeCandidates(entry.id, pokemonIndex)) {
      const existing = candidateMap.get(candidate.id);

      if (existing) {
        existing.isExactInput ||= candidate.id === entry.id;
        existing.sourceInputs.push(entry);
      } else {
        candidateMap.set(candidate.id, {
          ...candidate,
          isExactInput: candidate.id === entry.id,
          sourceInputs: [entry],
        });
      }
    }
  }

  return [...candidateMap.values()];
}

function getForcedExactRepresentative(group, candidates) {
  for (const entry of group) {
    const tokenId = normalizeName(entry.token || '');
    const exactId = normalizeName(entry.name || '');

    if (tokenId === exactId && isSpecificFormId(entry.id)) {
      return candidates.find((candidate) => candidate.id === entry.id) || null;
    }
  }

  return null;
}

function isSpecificFormId(pokemonId) {
  return (
    pokemonId.includes('mega') ||
    pokemonId.includes('alola') ||
    pokemonId.includes('galar') ||
    pokemonId.includes('hisui')
  );
}

function getDisplayInputForGroup(group) {
  const exactNonForm = group.find(
    (entry) => normalizeName(entry.token || '') === normalizeName(entry.name || '') && !isSpecificFormId(entry.id)
  );
  if (exactNonForm) return exactNonForm;

  const nonForm = group.find((entry) => !isSpecificFormId(entry.id));
  if (nonForm) return nonForm;

  return group[0];
}

function dedupeRepresentativeRows(rows) {
  const byRepresentative = new Map();

  for (const row of rows) {
    if (!row?.pokemonId) continue;

    const existing = byRepresentative.get(row.pokemonId);
    if (!existing) {
      byRepresentative.set(row.pokemonId, row);
      continue;
    }

    const existingScore = existing.representativeScore ?? -Infinity;
    const rowScore = row.representativeScore ?? -Infinity;

    if (rowScore > existingScore) {
      byRepresentative.set(row.pokemonId, row);
    }
  }

  return [...byRepresentative.values()];
}

function scoreRepresentativeCandidate(candidate, bundle, family) {
  const usage = bundle?.usage;
  if (!usage) return -Infinity;

  const familyConfig = availability?.familyConfigs?.[family] || {};
  const formatOrder = familyConfig.formatOrder || [];
  const cutoffPriority = familyConfig.cutoffPriority || [];

  const formatIndex = formatOrder.indexOf(usage.formatId);
  const cutoffIndex = cutoffPriority.indexOf(usage.cutoff);

  // For line-representative choice, competitive signal should dominate.
  // Source tier/cutoff quality matters, but should not let a near-zero baby
  // appearance in AG beat a real evolved/mega usage signal lower down.
  const usagePercent = Math.max(0, usage.value || 0);
  const rawCount = Math.max(0, usage.entry?.rawCount || 0);
  const leadPercent = Math.max(0, bundle.leads?.value || 0);

  const usageScore = Math.log1p(usagePercent) * 2000 + usagePercent * 250;
  const rawScore = Math.log1p(rawCount) * 35;
  const leadScore = leadPercent * 2;

  const formatQuality = formatIndex >= 0 ? (formatOrder.length - formatIndex) * 20 : 0;
  const cutoffQuality = cutoffIndex >= 0 ? (cutoffPriority.length - cutoffIndex) * 6 : 0;

  // Small preference for mega representatives when competitive signal is close.
  // Future Pool mode will enforce at most one mega across the team.
  const megaBonus = candidate.isMega ? 300 : 0;

  // If the user explicitly typed a specific form, respect it absolutely.
  const exactFormBonus = candidate.isExactInput && isSpecificFormId(candidate.id) ? 100000 : 0;

  // Tiny stable tie-breaker only. Do not let exact baby input beat evolution.
  const exactBonus = candidate.isExactInput ? 1 : 0;

  return (
    usageScore +
    rawScore +
    leadScore +
    formatQuality +
    cutoffQuality +
    megaBonus +
    exactFormBonus +
    exactBonus
  );
}


function renderApp() { const state = getState(); app.innerHTML = `<div class="app-shell"><header><h1>Pokémon Showdown Usage Viewer</h1></header><nav class="view-tabs"><button class="view-tab ${state.family === 'singles' ? 'active' : ''}" data-app-family="singles">Singles</button><button class="view-tab ${state.family === 'doubles' ? 'active' : ''}" data-app-family="doubles">Doubles</button></nav><nav class="view-tabs secondary-tabs"><button class="view-tab ${state.view === 'resolver' ? 'active' : ''}" data-app-view="resolver">Resolver</button><button class="view-tab ${state.view === 'pool' ? 'active' : ''}" data-app-view="pool">Pool Optimizer</button><button class="view-tab ${state.view === 'browser' ? 'active' : ''}" data-app-view="browser">Usage Browser</button></nav><section id="page-root" class="page-stack"></section></div>`; const pageRoot = document.querySelector('#page-root'); if (state.view === 'resolver') renderResolverPage(pageRoot); else if (state.view === 'pool') renderPoolPage(pageRoot); else renderBrowserPage(pageRoot); bindEvents(); }
function renderResolverPage(pageRoot) { const state = getState(); const resolverSelectionLabel = getAvailabilitySelectionLabel(availability, state.resolverMonth); const resolverSelected = resolverResults.find((row) => row.pokemonId === state.resolverSelectedPokemon) || null; pageRoot.innerHTML = `<section id="resolver-controls-root"></section><section id="resolver-results-root"></section><section id="details-root"></section>`; renderResolverControls(document.querySelector('#resolver-controls-root'), state, availability); renderResolverResults(document.querySelector('#resolver-results-root'), resolverResults, state, formatsIndex, resolverSelectionLabel, resolverLoadingState); renderMovesetPanel(document.querySelector('#details-root'), { selectedPokemonName: resolverSelected?.name || null, movesetEntry: resolverMovesetDetail, lookupLabel: resolverMovesetDetail ? describeResolverMovesetSource(resolverMovesetDetail) : '', aggregate: getState().resolverMonth === 'all', stitched: Boolean(resolverMovesetDetail?.stitched), status: resolverMovesetStatus }); }
function renderPoolPage(pageRoot) { const state = getState(); pageRoot.innerHTML = `<section id="pool-root" class="page-stack"></section>`; mountPoolOptimizer(document.querySelector('#pool-root'), { embedded: true, family: state.family }); } function renderBrowserPage(pageRoot) { const state = getState(); const rows = getRowsForSelection(dataset, state.month); const resolvedFormatLabel = getResolvedFormatLabel(dataset, formatsIndex, state.month); const selectionLabel = getSelectionLabel(dataset, state.month); const browserSelectedRow = rows.find((row) => row.pokemonId === state.selectedPokemon) || null; const browserMovesetContext = getMovesetLookupContext(dataset, formatsIndex, state); const browserMovesetEntry = getMovesetEntry(browserMovesetData, state.selectedPokemon); pageRoot.innerHTML = `<section id="controls-root"></section><main id="content-root"></main><section id="details-root"></section>`; renderControls(document.querySelector('#controls-root'), state, dataset, formatsIndex); renderTable(document.querySelector('#content-root'), rows, state, { isAggregate: state.month === 'all', resolvedFormatLabel, selectionLabel }); renderMovesetPanel(document.querySelector('#details-root'), { selectedPokemonName: browserSelectedRow?.name || browserMovesetEntry?.name || null, movesetEntry: browserMovesetEntry, lookupLabel: browserMovesetContext?.label || '', aggregate: Boolean(browserMovesetContext?.aggregate), stitched: false, status: null }); }
function describeResolverMovesetSource(source) { const label = getFormatLabel(source.formatId); if (source.selection === 'all') return source.stitched ? `${label} @ ${source.cutoff} (all available, ${source.monthsPresent}/${source.monthsAvailable} months with this mon; fallback tail)` : `${label} @ ${source.cutoff} (all available, ${source.monthsPresent}/${source.monthsAvailable} months with this mon)`; return source.stitched ? `${label} @ ${source.cutoff} (${source.month}; fallback tail)` : `${label} @ ${source.cutoff} (${source.month})`; }
function getFormatLabel(formatId) { return formatsIndex.find((format) => format.id === formatId)?.label || formatId; }
function bindEvents() { const formatSelect = document.querySelector('#format-select'), monthSelect = document.querySelector('#month-select'), searchInput = document.querySelector('#search-input'), resolverMonthSelect = document.querySelector('#resolver-month-select'), resolverQueryInput = document.querySelector('#resolver-query-input');
  document.querySelectorAll('[data-app-family]').forEach((button) => button.addEventListener('click', async (event) => { const nextFamily = event.currentTarget.dataset.appFamily; if (nextFamily === getState().family) return; clearPendingResolverDebounce(); const nextFormat = getDefaultBrowserFormat(nextFamily); dataset = await loadFormatData(nextFormat); setState({ family: nextFamily, format: nextFormat, month: 'all', selectedPokemon: null, resolverSelectedPokemon: null }); await sync(); }));
  document.querySelectorAll('[data-app-view]').forEach((button) => button.addEventListener('click', async (event) => { const nextView = event.currentTarget.dataset.appView; if (nextView === getState().view) return; setState({ view: nextView }); await sync({ recomputeResolverResults: false }); }));
  formatSelect?.addEventListener('change', async (event) => { clearPendingResolverDebounce(); const format = event.target.value; const nextDataset = await loadFormatData(format); const synthetic = isSyntheticFormat(format, formatsIndex); const month = synthetic ? getLatestMonth(nextDataset) : 'all'; dataset = nextDataset; setState({ format, month, selectedPokemon: null }); await sync(); });
  monthSelect?.addEventListener('change', async (event) => { clearPendingResolverDebounce(); setState({ month: event.target.value, selectedPokemon: null }); await sync(); });
  searchInput?.addEventListener('input', async (event) => { clearPendingResolverDebounce(); setState({ search: event.target.value }); await sync(); });
  resolverMonthSelect?.addEventListener('change', async (event) => { clearPendingResolverDebounce(); setState({ resolverMonth: event.target.value, resolverSelectedPokemon: null }); await sync(); });
  resolverQueryInput?.addEventListener('input', (event) => { setState({ resolverQuery: event.target.value, resolverSelectedPokemon: null });
    writeStateToUrl(getState()); clearPendingResolverDebounce(); resolverDebounceTimer = setTimeout(() => sync(), RESOLVER_INPUT_DEBOUNCE_MS); });
  document.querySelectorAll('[data-sort-by]').forEach((button) => button.addEventListener('click', async (event) => { clearPendingResolverDebounce(); const nextSortBy = event.currentTarget.dataset.sortBy; const state = getState(); const nextSortDir = state.sortBy === nextSortBy ? state.sortDir === 'asc' ? 'desc' : 'asc' : DESC_SORT_FIELDS.has(nextSortBy) ? 'desc' : 'asc'; setState({ sortBy: nextSortBy, sortDir: nextSortDir }); await sync(); }));
  document.querySelectorAll('[data-pokemon-id]').forEach((row) => row.addEventListener('click', async (event) => { clearPendingResolverDebounce(); const pokemonId = event.currentTarget.dataset.pokemonId; const state = getState(); setState({ selectedPokemon: state.selectedPokemon === pokemonId ? null : pokemonId, resolverSelectedPokemon: null, view: 'browser' }); await sync({ recomputeResolverResults: false }); }));
  document.querySelectorAll('[data-resolver-pokemon-id]').forEach((row) => row.addEventListener('click', async (event) => { clearPendingResolverDebounce(); const pokemonId = event.currentTarget.dataset.resolverPokemonId; const state = getState(); setState({ resolverSelectedPokemon: state.resolverSelectedPokemon === pokemonId ? null : pokemonId, selectedPokemon: null, view: 'resolver' }); await sync({ recomputeResolverResults: false }); })); }
function clearPendingResolverDebounce() { if (resolverDebounceTimer) { clearTimeout(resolverDebounceTimer); resolverDebounceTimer = null; } }
function primeResolverMovesetState() { const state = getState(); const key = state.resolverSelectedPokemon ? `${state.family}:${state.resolverMonth}:${state.resolverSelectedPokemon}` : null; if (!key) { resolverMovesetSelectionKey = null; resolverMovesetDetail = null; resolverMovesetStatus = { phase: 'idle', checked: 0, total: 0, contributed: 0 }; resolverMovesetRequestToken += 1; resolverMovesetInFlightKey = null; return; } const cached = resolverMovesetDetailCache.get(key); resolverMovesetSelectionKey = key; resolverMovesetRequestToken += 1; resolverMovesetInFlightKey = null; if (cached) { resolverMovesetDetail = cloneValue(cached.detail); resolverMovesetStatus = cloneValue(cached.status); return; } resolverMovesetDetail = null; resolverMovesetStatus = { phase: 'loading', checked: 0, total: 0, contributed: 0 }; }
async function kickResolverMovesetLoad() { const state = getState(); if (state.view !== 'resolver') return; const pokemonId = state.resolverSelectedPokemon, selection = state.resolverMonth, family = state.family; if (!pokemonId) return; const key = `${family}:${selection}:${pokemonId}`; if (resolverMovesetDetailCache.has(key) || resolverMovesetInFlightKey === key) return; const candidates = getMovesetResolverCandidates(availability, family, selection); const total = candidates.length; const token = resolverMovesetRequestToken; resolverMovesetInFlightKey = key; let detail = null, contributed = 0; const seen = { moves: new Set(), items: new Set(), abilities: new Set(), spreads: new Set() }; for (let index = 0; index < candidates.length; index += 1) { const candidate = candidates[index]; const aggregated = await loadAggregatedMovesetCandidate(candidate, pokemonId); if (resolverMovesetSelectionKey !== key || token !== resolverMovesetRequestToken) { if (resolverMovesetInFlightKey === key) resolverMovesetInFlightKey = null; return; } if (aggregated) { if (!detail) { detail = createResolverMovesetDetail(aggregated); resolverMovesetDetail = detail; seedSeenSetsFromDetail(seen, detail); contributed = 1; } else if (appendResolverFallback(detail, aggregated, seen)) { detail.stitched = true; detail.sourcesUsed.push({ formatId: aggregated.formatId, cutoff: aggregated.cutoff, monthsAvailable: aggregated.monthsAvailable, monthsPresent: aggregated.monthsPresent, sourceText: formatFallbackSource(aggregated) }); contributed += 1; resolverMovesetDetail = detail; } } const checked = index + 1; let phase = 'loading'; if (checked >= total) phase = detail ? 'ready' : 'empty'; else if (detail) phase = 'loading-tail'; resolverMovesetStatus = { phase, checked, total, contributed }; rerenderPreservingFocus(); } if (resolverMovesetSelectionKey === key && token === resolverMovesetRequestToken) { resolverMovesetInFlightKey = null; const persisted = { detail: resolverMovesetDetail, status: resolverMovesetStatus }; resolverMovesetDetailCache.set(key, cloneValue(persisted)); saveResolverMovesetPersistentCache(); } }
function createResolverMovesetDetail(aggregated) { return { ...aggregated, stitched: false, sourcesUsed: [{ formatId: aggregated.formatId, cutoff: aggregated.cutoff, monthsAvailable: aggregated.monthsAvailable, monthsPresent: aggregated.monthsPresent, sourceText: formatFallbackSource(aggregated) }], moves: aggregated.entry.moves.map((entry) => ({ ...entry, kind: 'primary' })), items: aggregated.entry.items.map((entry) => ({ ...entry, kind: 'primary' })), abilities: aggregated.entry.abilities.map((entry) => ({ ...entry, kind: 'primary' })), spreads: aggregated.entry.spreads.map((entry) => ({ ...entry, kind: 'primary' })) }; }
function seedSeenSetsFromDetail(seen, detail) { for (const entry of detail.moves) seen.moves.add(normalizeName(entry.name)); for (const entry of detail.items) seen.items.add(normalizeName(entry.name)); for (const entry of detail.abilities) seen.abilities.add(normalizeName(entry.name)); for (const entry of detail.spreads) seen.spreads.add(normalizeName(entry.name)); }
function appendResolverFallback(detail, aggregated, seen) { const sourceText = formatFallbackSource(aggregated); return appendFallbackEntries(detail.moves, aggregated.entry.moves, seen.moves, sourceText) || appendFallbackEntries(detail.items, aggregated.entry.items, seen.items, sourceText) || appendFallbackEntries(detail.abilities, aggregated.entry.abilities, seen.abilities, sourceText) || appendFallbackEntries(detail.spreads, aggregated.entry.spreads, seen.spreads, sourceText); }
function appendFallbackEntries(target, entries, seenSet, sourceText) { let contributed = false; for (const entry of entries) { const key = normalizeName(entry.name); if (!key || seenSet.has(key)) continue; seenSet.add(key); target.push({ name: entry.name, usage: null, kind: 'fallback', sourceText }); contributed = true; } return contributed; }
function formatFallbackSource(source) { const label = getFormatLabel(source.formatId); return source.selection === 'all' ? `${label} @ ${source.cutoff} (${source.monthsPresent}/${source.monthsAvailable} mo)` : `${label} @ ${source.cutoff}`; }
function normalizeName(value) { return value.toLowerCase().replace(/[^a-z0-9]+/g, ''); }
function getResolverMovesetCacheStorageKey() { return `resolverMovesets:${RESOLVER_MOVESET_CACHE_SCHEMA_VERSION}:${availability?.latestMonth || 'none'}`; }
function loadResolverMovesetPersistentCache() { resolverMovesetDetailCache.clear(); try { const raw = localStorage.getItem(getResolverMovesetCacheStorageKey()); if (!raw) return; const parsed = JSON.parse(raw); if (!parsed || typeof parsed !== 'object') return; for (const [key, value] of Object.entries(parsed)) resolverMovesetDetailCache.set(key, value); } catch (error) { console.warn('Failed to load resolver moveset cache', error); } }
function saveResolverMovesetPersistentCache() { try { const payload = Object.fromEntries(resolverMovesetDetailCache); localStorage.setItem(getResolverMovesetCacheStorageKey(), JSON.stringify(payload)); } catch (error) { console.warn('Failed to save resolver moveset cache', error); } }
function cloneValue(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function getResolverLoadingMessage() {
  const query = getState().resolverQuery || '';
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

  return 'Resolving Pokémon...';
}

function waitForPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

function renderResolverLoadingNow() {
  const state = getState();
  if (state.view !== 'resolver' || !state.resolverQuery.trim()) return;

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

  primeResolverMovesetState();
  await ensureBrowserMovesetData();

  let nextResolverResults = resolverResults;

  if (recomputeResolverResults) {
    renderResolverLoadingNow();
    await waitForPaint();
    nextResolverResults = await computeResolverResults();
  }

  if (generation !== syncGeneration) return;

  if (recomputeResolverResults) {
    resolverLoadingState = { loading: false, message: '' };
    resolverResults = nextResolverResults;

    const validIds = new Set(resolverResults.map((row) => row.pokemonId));
    if (getState().resolverSelectedPokemon && !validIds.has(getState().resolverSelectedPokemon)) {
      setState({ resolverSelectedPokemon: null });
      primeResolverMovesetState();
    }
  }

  writeStateToUrl(getState());
  renderApp();

  if (generation !== syncGeneration) return;

  restoreFocusState(focusState);
  kickResolverMovesetLoad();
}

function rerenderPreservingFocus() { const focusState = captureFocusState(); renderApp(); restoreFocusState(focusState); }
function captureFocusState() { const active = document.activeElement; if (active?.id === 'search-input' || active?.id === 'resolver-query-input') return { id: active.id, selectionStart: active.selectionStart ?? null, selectionEnd: active.selectionEnd ?? null }; return null; }
function restoreFocusState(focusState) { if (!focusState?.id) return; const input = document.querySelector(`#${focusState.id}`); if (!input) return; input.focus(); if (typeof focusState.selectionStart === 'number' && typeof focusState.selectionEnd === 'number') input.setSelectionRange(focusState.selectionStart, focusState.selectionEnd); }
init().catch((error) => { console.error(error); app.innerHTML = `<div class="app-shell"><h1>Pokémon Showdown Usage Viewer</h1><p>Something broke while loading the app.</p><pre>${error.message}</pre></div>`; });
