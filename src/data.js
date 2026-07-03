import { LINE_REPRESENTATIVE_CANDIDATES } from './generated/gen7LineRepresentativeCandidates.generated.js';
import { dataUrl } from './utils/dataUrl.js';

const LEAD_SMOOTHING_K = 200;

const HIDDEN_MOVESET_ENTRY_KEYS = new Set(['other', 'nothing']);
const SOURCE_FETCH_CONCURRENCY = 16;

const FAMILY_CONFIGS = {
  singles: {
    formatOrder: ['gen7anythinggoes','gen7ubers','gen7ou','gen7uu','gen7ru','gen7nu','gen7pu','gen7zu','gen7nfe','gen7lc'],
    cutoffPriority: [1760, 1630, 1500, 0],
    defaultBrowserFormat: 'gen7anythinggoes',
  },
  doubles: {
    formatOrder: ['gen7doublesubers', 'gen7doublesou', 'gen7doublesuu'],
    cutoffPriority: [1825, 1760, 1695, 1630, 1500, 0],
    defaultBrowserFormat: 'gen7doublesou',
  },
};

const jsonCache = new Map();
const sourceCache = new Map();
const browserMovesetCache = new Map();
const resolverSummaryCache = new Map();
const resolverIndexCache = new Map();
const aggregatedMovesetCandidateCache = new Map();

export async function loadFormatsIndex() { return loadJson(dataUrl('formats.json')); }
export async function loadAvailability() { return loadJson(dataUrl('availability.json')); }
export async function loadPokemonIndex() { return loadJson(dataUrl('pokemon-index.json')); }
export async function loadFormatData(formatId) { return loadJson(dataUrl(`by-format/${formatId}.json`)); }

export async function loadMovesetData(formatId, month) {
  const key = `${formatId}:${month}`;
  if (browserMovesetCache.has(key)) return browserMovesetCache.get(key);
  const response = await fetch(dataUrl(`movesets/${formatId}/${month}.json`));
  if (response.status === 404) { browserMovesetCache.set(key, null); return null; }
  if (!response.ok) throw new Error(`Failed to load movesets for ${formatId} ${month}`);
  const data = await response.json();
  browserMovesetCache.set(key, data);
  return data;
}

export async function loadSourceData(month, formatId, cutoff, dataKind) {
  const key = `${month}:${formatId}:${cutoff}:${dataKind}`;
  // Cache the in-flight promise (not just the resolved data) so the many
  // concurrent optimizer lines that scan the same source files share one fetch
  // instead of each firing its own and saturating the connection pool.
  if (sourceCache.has(key)) return sourceCache.get(key);

  const promise = (async () => {
    const response = await fetch(
      dataUrl(`sources/${month}/${formatId}/${cutoff}/${dataKind}.json`),
    );
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(
        `Failed to load source data for ${month} ${formatId} ${cutoff} ${dataKind}`,
      );
    }
    return response.json();
  })();

  sourceCache.set(key, promise);
  try {
    return await promise;
  } catch (error) {
    sourceCache.delete(key);
    throw error;
  }
}

async function loadJson(url) {
  if (jsonCache.has(url)) return jsonCache.get(url);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load ${url}`);
  const data = await response.json();
  jsonCache.set(url, data);
  return data;
}

export function getFamilyConfig(family) { return FAMILY_CONFIGS[family] || FAMILY_CONFIGS.singles; }
export function getDefaultBrowserFormat(family) { return getFamilyConfig(family).defaultBrowserFormat; }
export function formatBelongsToFamily(formatsIndex, formatId, family) {
  const format = formatsIndex.find((entry) => entry.id === formatId);
  return format ? format.family === family : false;
}

export function getRowsForSelection(dataset, selection) {
  const rows = selection === 'all' ? buildAggregateRows(dataset) : dataset.monthly?.[selection] || [];
  return addLeadMetrics(rows);
}

export function getSelectionLabel(dataset, selection) {
  if (selection === 'all') {
    const months = dataset.months || [];
    if (!months.length) return 'All available';
    return `All available (${months[0]} → ${months[months.length - 1]})`;
  }
  return selection;
}

export function getResolvedFormatLabel(dataset, formatsIndex, selection) {
  if (selection === 'all') return null;
  const resolvedFormatId = dataset.resolvedMonths?.[selection];
  if (!resolvedFormatId) return null;
  return formatsIndex.find((format) => format.id === resolvedFormatId)?.label || resolvedFormatId;
}

export function isSyntheticFormat(formatId, formatsIndex) {
  return Boolean(formatsIndex.find((format) => format.id === formatId)?.synthetic);
}

export function getLatestMonth(dataset) {
  const months = dataset.months || [];
  return months[months.length - 1] || '';
}

export function getMovesetLookupContext(dataset, formatsIndex, state) {
  if (!state.selectedPokemon) return null;
  if (state.month === 'all') {
    // Real aggregate built by scripts/build-aggregate-movesets.mjs — the pane
    // used to silently fall back to the latest month here, which for thin
    // formats meant one player's single set shown at 100%.
    const months = dataset.months || [];
    const label = months.length
      ? `all available months (${months[0]} → ${months[months.length - 1]})`
      : 'all available months';
    return { formatId: state.format, month: 'all', label, aggregate: true };
  }
  if (isSyntheticFormat(state.format, formatsIndex)) {
    const resolvedFormatId = dataset.resolvedMonths?.[state.month];
    const resolvedFormatLabel = formatsIndex.find((format) => format.id === resolvedFormatId)?.label || resolvedFormatId;
    if (!resolvedFormatId) return null;
    return { formatId: resolvedFormatId, month: state.month, label: `${state.month} — ${resolvedFormatLabel}`, aggregate: false };
  }
  return { formatId: state.format, month: state.month, label: state.month, aggregate: false };
}

export function getMovesetEntry(movesetData, pokemonId) { return movesetData?.pokemon?.[pokemonId] || null; }
export function getAvailabilityMonths(availability) { return Object.keys(availability?.months || {}).sort(); }
export function getLatestAvailabilityMonth(availability) { return availability?.latestMonth || getAvailabilityMonths(availability).at(-1) || ''; }
export function getAvailabilitySelectionLabel(availability, selection) {
  if (selection !== 'all') return selection;
  const months = getAvailabilityMonths(availability);
  if (!months.length) return 'All available';
  return `All available (${months[0]} → ${months[months.length - 1]})`;
}

export function getLineRepresentativeCandidates(pokemonId, pokemonIndex) {
  const nameById = new Map(pokemonIndex.map((entry) => [entry.id, entry.name]));
  const rawCandidates = LINE_REPRESENTATIVE_CANDIDATES[pokemonId] || [
    { id: pokemonId, name: nameById.get(pokemonId) || pokemonId, isMega: false },
  ];

  const seen = new Set();
  return rawCandidates
    .filter((candidate) => {
      if (!candidate?.id || seen.has(candidate.id)) return false;
      seen.add(candidate.id);
      return true;
    })
    .map((candidate) => ({
      id: candidate.id,
      name: nameById.get(candidate.id) || candidate.name || candidate.id,
      isMega: Boolean(candidate.isMega),
      isExact: candidate.id === pokemonId,
    }));
}

export function resolveQueryEntries(query, pokemonIndex) {
  const raw = query.trim();
  if (!raw) return [];

  const tokens = raw
    .split(/[,\n]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const indexed = pokemonIndex.map((entry) => ({
    ...entry,
    normalizedName: normalizeSearch(entry.name),
  }));

  const seen = new Set();
  const results = [];

  for (const token of tokens) {
    const normalizedToken = normalizeSearch(token);
    if (!normalizedToken) continue;

    const exactMatches = indexed.filter((entry) => entry.normalizedName === normalizedToken);
    const prefixMatches = indexed.filter((entry) => entry.normalizedName.startsWith(normalizedToken));
    const substringMatches = indexed.filter((entry) => entry.normalizedName.includes(normalizedToken));

    let matches = [];
    let matchMode = 'substring';

    if (exactMatches.length > 0) {
      matches = exactMatches;
      matchMode = 'exact';
    } else if (prefixMatches.length > 0) {
      matches = prefixMatches;
      matchMode = 'prefix';
    } else {
      matches = substringMatches;
      matchMode = 'substring';
    }

    const limit = normalizedToken.length <= 2 ? 250 : 200;

    const orderedMatches = [...matches]
      .sort((a, b) => {
        const aPrefix = a.normalizedName.startsWith(normalizedToken) ? 0 : 1;
        const bPrefix = b.normalizedName.startsWith(normalizedToken) ? 0 : 1;
        if (aPrefix !== bPrefix) return aPrefix - bPrefix;
        return a.name.localeCompare(b.name);
      })
      .slice(0, limit);

    for (const match of orderedMatches) {
      const seenKey = `${normalizedToken}:${match.id}`;
      if (seen.has(seenKey)) continue;
      seen.add(seenKey);

      results.push({
        id: match.id,
        name: match.name,
        token,
        matchMode,
        broadMatch: normalizedToken.length <= 2 || matchMode === 'substring',
      });
    }
  }

  return results;
}

async function loadResolverIndex(family, selection) {
  if (selection !== 'all') return null;

  const key = `${family}:${selection}`;
  if (resolverIndexCache.has(key)) return resolverIndexCache.get(key);

  const response = await fetch(dataUrl(`resolver-index/${family}/${selection}.json`));
  if (response.status === 404) {
    resolverIndexCache.set(key, null);
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to load resolver index for ${family}/${selection}`);
  }

  const index = await response.json();
  resolverIndexCache.set(key, index);
  return index;
}

export async function resolveBestAvailableLightBundle({ availability, family, selection, pokemonId }) {
  const cacheKey = `${family}:${selection}:${pokemonId}`;
  if (resolverSummaryCache.has(cacheKey)) return resolverSummaryCache.get(cacheKey);

  const resolverIndex = await loadResolverIndex(family, selection);

  // The resolver index is precomputed from the exact same source files the live
  // scan would read, aggregating every Pokémon present in any of them — so for
  // "all" it's authoritative and already cached as a single static file. A hit
  // returns the precomputed bundle (including trace-usage obscure NFEs); a miss
  // means the Pokémon is absent everywhere, so there's nothing to rescan. This
  // keeps every Pokémon's data while avoiding the slow per-mon source scan.
  if (resolverIndex) {
    const bundle = resolverIndex.pokemon?.[pokemonId] || {
      usage: null,
      leads: null,
    };
    resolverSummaryCache.set(cacheKey, bundle);
    return bundle;
  }

  const usage = await resolveBestAvailableUsage({ availability, family, selection, pokemonId });
  const leads = await resolveBestAvailableLeads({ availability, family, selection, pokemonId });

  const bundle = { usage, leads };
  resolverSummaryCache.set(cacheKey, bundle);
  return bundle;
}



export function getMovesetResolverCandidates(availability, family, selection) {
  const families = family === 'doubles' ? ['doubles', 'singles'] : ['singles', 'doubles'];
  return families.flatMap((familyId) => [...iterateCandidateSources(availability, familyId, selection, 'moveset')]);
}

export async function loadAggregatedMovesetCandidate(candidate, pokemonId) {
  const cacheKey = `${candidate.family}:${candidate.selection}:${candidate.formatId}:${candidate.cutoff}:${pokemonId}`;
  if (aggregatedMovesetCandidateCache.has(cacheKey)) return aggregatedMovesetCandidateCache.get(cacheKey);
  const aggregated = await aggregateMovesetCandidate(candidate, pokemonId);
  aggregatedMovesetCandidateCache.set(cacheKey, aggregated);
  return aggregated;
}

async function resolveBestAvailableUsage({ availability, family, selection, pokemonId }) {
  for (const candidate of iterateCandidateSources(availability, family, selection, 'usage')) {
    let totalUsage = 0;
    let totalRawCount = 0;
    let monthsPresent = 0;
    let name = null;

    const monthEntries = await mapLimit(candidate.months, SOURCE_FETCH_CONCURRENCY, async (month) => {
      const source = await loadSourceData(month, candidate.formatId, candidate.cutoff, 'usage');
      return source?.pokemon?.[pokemonId] || null;
    });

    for (const entry of monthEntries) {
      if (!entry) continue;
      name = entry.name;
      totalUsage += entry.usage;
      totalRawCount += entry.rawCount;
      monthsPresent += 1;
    }

    if (monthsPresent === 0) continue;

    return {
      selection,
      family,
      month: selection === 'all' ? null : candidate.months[0],
      formatId: candidate.formatId,
      cutoff: candidate.cutoff,
      monthsAvailable: candidate.months.length,
      monthsPresent,
      entry: {
        pokemonId,
        name,
        usage: totalUsage / candidate.months.length,
        rawCount: totalRawCount,
      },
      value: totalUsage / candidate.months.length,
    };
  }

  return null;
}

async function resolveBestAvailableLeads({ availability, family, selection, pokemonId }) {
  for (const candidate of iterateCandidateSources(availability, family, selection, 'leads')) {
    let totalUsageRawForPrior = 0;
    let totalLeadRawForPrior = 0;
    let usageRawCount = 0;
    let leadRawCount = 0;
    let monthsPresent = 0;
    let name = null;

    const monthEntries = await mapLimit(candidate.months, SOURCE_FETCH_CONCURRENCY, async (month) => {
      const [usageSource, leadsSource] = await Promise.all([
        loadSourceData(month, candidate.formatId, candidate.cutoff, 'usage'),
        loadSourceData(month, candidate.formatId, candidate.cutoff, 'leads'),
      ]);

      if (!usageSource || !leadsSource) return null;

      return {
        usageEntry: usageSource.pokemon?.[pokemonId] || null,
        leadEntry: leadsSource.pokemon?.[pokemonId] || null,
        totalUsageRaw: leadsSource.summary?.totalUsageRaw || 0,
        totalLeadRaw: leadsSource.summary?.totalLeadRaw || 0,
      };
    });

    for (const monthEntry of monthEntries) {
      if (!monthEntry) continue;

      totalUsageRawForPrior += monthEntry.totalUsageRaw;
      totalLeadRawForPrior += monthEntry.totalLeadRaw;

      if (monthEntry.usageEntry) {
        name = monthEntry.usageEntry.name;
        usageRawCount += monthEntry.usageEntry.rawCount;
        monthsPresent += 1;
      }

      if (monthEntry.leadEntry) {
        leadRawCount += monthEntry.leadEntry.leadRawCount || 0;
      }
    }

    if (usageRawCount === 0 || monthsPresent === 0) continue;

    const prior = totalUsageRawForPrior > 0 ? totalLeadRawForPrior / totalUsageRawForPrior : 0;
    const value = ((leadRawCount + LEAD_SMOOTHING_K * prior) / (usageRawCount + LEAD_SMOOTHING_K)) * 100;

    return {
      selection,
      family,
      month: selection === 'all' ? null : candidate.months[0],
      formatId: candidate.formatId,
      cutoff: candidate.cutoff,
      monthsAvailable: candidate.months.length,
      monthsPresent,
      entry: { pokemonId, name, usageRawCount, leadRawCount },
      value,
    };
  }

  return null;
}

async function aggregateMovesetCandidate(candidate, pokemonId) {
  const aggregate = {
    moves: new Map(),
    items: new Map(),
    abilities: new Map(),
    spreads: new Map(),
  };

  let totalRawCount = 0;
  let monthsPresent = 0;
  let name = null;

  const monthEntries = await mapLimit(candidate.months, SOURCE_FETCH_CONCURRENCY, async (month) => {
    const source = await loadSourceData(month, candidate.formatId, candidate.cutoff, 'moveset');
    return source?.pokemon?.[pokemonId] || null;
  });

  for (const entry of monthEntries) {
    if (!entry) continue;

    name = entry.name;
    totalRawCount += entry.rawCount || 0;
    monthsPresent += 1;

    accumulateSection(aggregate.moves, filterVisibleMovesetEntries(entry.moves), entry.rawCount);
    accumulateSection(aggregate.items, filterVisibleMovesetEntries(entry.items), entry.rawCount);
    accumulateSection(aggregate.abilities, filterVisibleMovesetEntries(entry.abilities), entry.rawCount);
    accumulateSection(aggregate.spreads, filterVisibleMovesetEntries(entry.spreads), entry.rawCount);
  }

  if (totalRawCount === 0 || monthsPresent === 0) return null;

  return {
    selection: candidate.selection,
    family: candidate.family,
    month: candidate.selection === 'all' ? null : candidate.months[0],
    formatId: candidate.formatId,
    cutoff: candidate.cutoff,
    monthsAvailable: candidate.months.length,
    monthsPresent,
    entry: {
      pokemonId,
      name,
      rawCount: totalRawCount,
      moves: finalizeSection(aggregate.moves, totalRawCount),
      items: finalizeSection(aggregate.items, totalRawCount),
      abilities: finalizeSection(aggregate.abilities, totalRawCount),
      spreads: finalizeSection(aggregate.spreads, totalRawCount),
    },
  };
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(limit, items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index], index);
      }
    })
  );

  return results;
}

function* iterateCandidateSources(availability, family, selection, dataKind) {
  const familyConfig = availability?.familyConfigs?.[family] || getFamilyConfig(family);
  const formatOrder = familyConfig.formatOrder || [];
  const cutoffPriority = familyConfig.cutoffPriority || [];
  for (const formatId of formatOrder) {
    for (const cutoff of cutoffPriority) {
      const months = getCandidateMonths(availability, selection, formatId, dataKind, cutoff);
      if (months.length === 0) continue;
      yield { formatId, cutoff, months, selection, family };
    }
  }
}

function getCandidateMonths(availability, selection, formatId, dataKind, cutoff) {
  if (selection === 'all') {
    return getAvailabilityMonths(availability).filter((month) => availability?.months?.[month]?.[formatId]?.[dataKind]?.includes(cutoff));
  }
  return availability?.months?.[selection]?.[formatId]?.[dataKind]?.includes(cutoff) ? [selection] : [];
}
function filterVisibleMovesetEntries(entries = []) { return entries.filter((entry) => !HIDDEN_MOVESET_ENTRY_KEYS.has(normalizeSearch(entry.name))); }
function accumulateSection(targetMap, entries = [], rawCount = 0) { for (const entry of entries) { const weight = (entry.usage / 100) * rawCount; targetMap.set(entry.name, (targetMap.get(entry.name) || 0) + weight); } }
function finalizeSection(sourceMap, totalRawCount) { return [...sourceMap.entries()].map(([name, weight]) => ({ name, usage: totalRawCount > 0 ? (weight / totalRawCount) * 100 : 0 })).sort((a, b) => b.usage - a.usage || a.name.localeCompare(b.name)); }

function buildAggregateRows(dataset) {
  const months = dataset.months || [];
  const monthCount = months.length;
  if (!monthCount) return [];
  return Object.entries(dataset.history || {}).map(([pokemonId, entry]) => {
    let usageSum = 0, rawCountSum = 0, leadRawCountSum = 0;
    for (const month of months) {
      const monthData = entry.months[month];
      if (!monthData) continue;
      usageSum += monthData.usage; rawCountSum += monthData.rawCount; leadRawCountSum += monthData.leadRawCount || 0;
    }
    return { pokemonId, name: entry.name, usage: usageSum / monthCount, rawCount: rawCountSum, leadRawCount: leadRawCountSum };
  }).filter((row) => row.rawCount > 0).sort((a, b) => b.usage - a.usage || b.rawCount - a.rawCount || a.name.localeCompare(b.name)).map((row, index) => ({ ...row, rank: index + 1 }));
}

function addLeadMetrics(rows) {
  const totalUsageRaw = rows.reduce((sum, row) => sum + (row.rawCount || 0), 0);
  const totalLeadRaw = rows.reduce((sum, row) => sum + (row.leadRawCount || 0), 0);
  const prior = totalUsageRaw > 0 ? totalLeadRaw / totalUsageRaw : 0;
  return rows.map((row) => {
    const rawCount = row.rawCount || 0;
    const leadRawCount = row.leadRawCount || 0;
    const leadTendency = rawCount > 0 ? ((leadRawCount + LEAD_SMOOTHING_K * prior) / (rawCount + LEAD_SMOOTHING_K)) * 100 : prior * 100;
    return { ...row, leadRawCount, leadTendency };
  });
}
function normalizeSearch(value) { return value.toLowerCase().replace(/[^a-z0-9]+/g, ''); }
