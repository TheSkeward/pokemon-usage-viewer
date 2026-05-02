const LEAD_SMOOTHING_K = 200;
const HIDDEN_MOVESET_ENTRY_KEYS = new Set(['other', 'nothing']);

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
const aggregatedMovesetCandidateCache = new Map();

export async function loadFormatsIndex() { return loadJson('/data/formats.json'); }
export async function loadAvailability() { return loadJson('/data/availability.json'); }
export async function loadPokemonIndex() { return loadJson('/data/pokemon-index.json'); }
export async function loadFormatData(formatId) { return loadJson(`/data/by-format/${formatId}.json`); }

export async function loadMovesetData(formatId, month) {
  const key = `${formatId}:${month}`;
  if (browserMovesetCache.has(key)) return browserMovesetCache.get(key);
  const response = await fetch(`/data/movesets/${formatId}/${month}.json`);
  if (response.status === 404) { browserMovesetCache.set(key, null); return null; }
  if (!response.ok) throw new Error(`Failed to load movesets for ${formatId} ${month}`);
  const data = await response.json();
  browserMovesetCache.set(key, data);
  return data;
}

export async function loadSourceData(month, formatId, cutoff, dataKind) {
  const key = `${month}:${formatId}:${cutoff}:${dataKind}`;
  if (sourceCache.has(key)) return sourceCache.get(key);
  const response = await fetch(`/data/sources/${month}/${formatId}/${cutoff}/${dataKind}.json`);
  if (response.status === 404) { sourceCache.set(key, null); return null; }
  if (!response.ok) throw new Error(`Failed to load source data for ${month} ${formatId} ${cutoff} ${dataKind}`);
  const data = await response.json();
  sourceCache.set(key, data);
  return data;
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
    const latestMonth = getLatestMonth(dataset);
    if (!latestMonth) return null;
    return { formatId: state.format, month: latestMonth, label: `latest available month (${latestMonth})`, aggregate: true };
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

export function resolveQueryEntries(query, pokemonIndex) {
  const raw = query.trim();
  if (!raw) return [];
  const tokens = raw.split(/[,\n]+/).map((token) => token.trim()).filter(Boolean);
  const indexed = pokemonIndex.map((entry) => ({ ...entry, normalizedName: normalizeSearch(entry.name) }));
  const seen = new Set();
  const results = [];
  for (const token of tokens) {
    const normalizedToken = normalizeSearch(token);
    if (!normalizedToken) continue;
    const exactMatches = indexed.filter((entry) => entry.normalizedName === normalizedToken);
    const prefixMatches = exactMatches.length > 0 ? exactMatches : indexed.filter((entry) => entry.normalizedName.startsWith(normalizedToken));
    const fallbackMatches = prefixMatches.length > 0 ? prefixMatches : indexed.filter((entry) => entry.normalizedName.includes(normalizedToken));
    for (const match of [...fallbackMatches].sort((a, b) => a.name.localeCompare(b.name))) {
      if (seen.has(match.id)) continue;
      seen.add(match.id);
      results.push({ id: match.id, name: match.name, token });
    }
  }
  return results;
}

export async function resolveBestAvailableLightBundle({ availability, family, selection, pokemonId }) {
  const cacheKey = `${family}:${selection}:${pokemonId}`;
  if (resolverSummaryCache.has(cacheKey)) return resolverSummaryCache.get(cacheKey);
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
    let totalUsage = 0, totalRawCount = 0, monthsPresent = 0, name = null;
    for (const month of candidate.months) {
      const source = await loadSourceData(month, candidate.formatId, candidate.cutoff, 'usage');
      const entry = source?.pokemon?.[pokemonId];
      if (!entry) continue;
      name = entry.name; totalUsage += entry.usage; totalRawCount += entry.rawCount; monthsPresent += 1;
    }
    if (monthsPresent === 0) continue;
    return { selection, family, month: selection === 'all' ? null : candidate.months[0], formatId: candidate.formatId, cutoff: candidate.cutoff, monthsAvailable: candidate.months.length, monthsPresent, entry: { pokemonId, name, usage: totalUsage / candidate.months.length, rawCount: totalRawCount }, value: totalUsage / candidate.months.length };
  }
  return null;
}

async function resolveBestAvailableLeads({ availability, family, selection, pokemonId }) {
  for (const candidate of iterateCandidateSources(availability, family, selection, 'leads')) {
    let totalUsageRawForPrior = 0, totalLeadRawForPrior = 0, usageRawCount = 0, leadRawCount = 0, monthsPresent = 0, name = null;
    for (const month of candidate.months) {
      const usageSource = await loadSourceData(month, candidate.formatId, candidate.cutoff, 'usage');
      const leadsSource = await loadSourceData(month, candidate.formatId, candidate.cutoff, 'leads');
      if (!usageSource || !leadsSource) continue;
      totalUsageRawForPrior += leadsSource.summary?.totalUsageRaw || 0;
      totalLeadRawForPrior += leadsSource.summary?.totalLeadRaw || 0;
      const usageEntry = usageSource.pokemon?.[pokemonId];
      const leadEntry = leadsSource.pokemon?.[pokemonId];
      if (usageEntry) { name = usageEntry.name; usageRawCount += usageEntry.rawCount; monthsPresent += 1; }
      if (leadEntry) leadRawCount += leadEntry.leadRawCount || 0;
    }
    if (usageRawCount === 0 || monthsPresent === 0) continue;
    const prior = totalUsageRawForPrior > 0 ? totalLeadRawForPrior / totalUsageRawForPrior : 0;
    const value = ((leadRawCount + LEAD_SMOOTHING_K * prior) / (usageRawCount + LEAD_SMOOTHING_K)) * 100;
    return { selection, family, month: selection === 'all' ? null : candidate.months[0], formatId: candidate.formatId, cutoff: candidate.cutoff, monthsAvailable: candidate.months.length, monthsPresent, entry: { pokemonId, name, usageRawCount, leadRawCount }, value };
  }
  return null;
}

async function aggregateMovesetCandidate(candidate, pokemonId) {
  const aggregate = { moves: new Map(), items: new Map(), abilities: new Map(), spreads: new Map() };
  let totalRawCount = 0, monthsPresent = 0, name = null;
  for (const month of candidate.months) {
    const source = await loadSourceData(month, candidate.formatId, candidate.cutoff, 'moveset');
    const entry = source?.pokemon?.[pokemonId];
    if (!entry) continue;
    name = entry.name; totalRawCount += entry.rawCount || 0; monthsPresent += 1;
    accumulateSection(aggregate.moves, filterVisibleMovesetEntries(entry.moves), entry.rawCount);
    accumulateSection(aggregate.items, filterVisibleMovesetEntries(entry.items), entry.rawCount);
    accumulateSection(aggregate.abilities, filterVisibleMovesetEntries(entry.abilities), entry.rawCount);
    accumulateSection(aggregate.spreads, filterVisibleMovesetEntries(entry.spreads), entry.rawCount);
  }
  if (totalRawCount === 0 || monthsPresent === 0) return null;
  return { selection: candidate.selection, family: candidate.family, month: candidate.selection === 'all' ? null : candidate.months[0], formatId: candidate.formatId, cutoff: candidate.cutoff, monthsAvailable: candidate.months.length, monthsPresent, entry: { pokemonId, name, rawCount: totalRawCount, moves: finalizeSection(aggregate.moves, totalRawCount), items: finalizeSection(aggregate.items, totalRawCount), abilities: finalizeSection(aggregate.abilities, totalRawCount), spreads: finalizeSection(aggregate.spreads, totalRawCount) } };
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
