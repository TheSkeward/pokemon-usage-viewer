import fs from 'node:fs/promises';
import path from 'node:path';

import {
  CUTOFF_PRIORITY,
  DEFAULT_RATING,
  FAMILY_CONFIGS,
  FORMAT_POWER_ORDER,
  REAL_FORMATS,
  STATS_ROOT,
  SYNTHETIC_FORMATS,
} from './config.mjs';

const projectRoot = process.cwd();
const publicDataDir = path.join(projectRoot, 'public', 'data');
const byFormatDir = path.join(publicDataDir, 'by-format');
const browserMovesetsDir = path.join(publicDataDir, 'movesets');
const resolverSourcesDir = path.join(publicDataDir, 'sources');
const availabilityPath = path.join(publicDataDir, 'availability.json');
const pokemonIndexPath = path.join(publicDataDir, 'pokemon-index.json');
const cacheRootDir = path.join(projectRoot, 'cache', 'stats');

const CURRENT_MONTH_TTL_MS = 6 * 60 * 60 * 1000;

const REAL_FORMATS_BY_ID = new Map(REAL_FORMATS.map((format) => [format.id, format]));
const SYNTHETIC_FORMATS_BY_ID = new Map(SYNTHETIC_FORMATS.map((format) => [format.id, format]));
const ALL_FORMAT_IDS = new Set([
  ...REAL_FORMATS.map((format) => format.id),
  ...SYNTHETIC_FORMATS.map((format) => format.id),
]);
const REAL_FORMAT_ORDER = REAL_FORMATS.map((format) => format.id);
const REAL_FORMAT_ORDER_INDEX = new Map(REAL_FORMAT_ORDER.map((id, index) => [id, index]));

const counters = {
  cacheHits: 0,
  cache404Hits: 0,
  downloads: 0,
  downloaded404s: 0,
  browserBuilt: 0,
  browserLoadedFromGenerated: 0,
  sidecarsWritten: 0,
  sidecarsRemoved: 0,
};

async function main() {
  const cli = parseCliArgs(process.argv.slice(2));

  if (cli.help) {
    printHelp();
    return;
  }

  validateRequestedFormatIds(cli.requestedFormatIds);

  await fs.mkdir(byFormatDir, { recursive: true });
  await fs.mkdir(browserMovesetsDir, { recursive: true });
  await fs.mkdir(resolverSourcesDir, { recursive: true });
  await fs.mkdir(cacheRootDir, { recursive: true });

  const months = await fetchAvailableMonths();
  const latestAvailableMonth = months[months.length - 1];

  console.log(`Latest mutable month: ${latestAvailableMonth}`);

  const explicitRealIds = getExplicitRealIds(cli.requestedFormatIds);
  const syntheticIdsToBuild = getSyntheticIdsToBuild(cli.requestedFormatIds, explicitRealIds);
  const implicitDependencyIds = getImplicitDependencyIds(syntheticIdsToBuild, explicitRealIds);

  const realDatasets = {};

  for (const formatId of explicitRealIds) {
    const format = REAL_FORMATS_BY_ID.get(formatId);
    const generatedPath = path.join(byFormatDir, `${formatId}.json`);
    const hadGeneratedDataset = Boolean(await readJsonIfExists(generatedPath));

    const before = snapshotCounters();
    realDatasets[format.id] = await buildRealFormatBrowserDataset(format, months, latestAvailableMonth, cli);
    await writeJson(generatedPath, realDatasets[format.id]);
    counters.browserBuilt += 1;

    const delta = diffCounters(before, counters);
    console.log(describeBrowserBuild(format.id, {
      hadGeneratedDataset,
      refreshAll: cli.refreshAll,
      refreshCurrent: cli.refreshCurrent,
      delta,
    }));
    printPhaseDelta(`[browser] ${format.id}`, before);
  }

  for (const formatId of implicitDependencyIds) {
    const format = REAL_FORMATS_BY_ID.get(formatId);
    const generatedPath = path.join(byFormatDir, `${formatId}.json`);
    const existing = !cli.refreshAll && !cli.refreshCurrent
      ? await readJsonIfExists(generatedPath)
      : null;

    if (existing) {
      console.log(`[browser] reusing existing generated dataset for ${format.id}`);
      realDatasets[format.id] = existing;
      counters.browserLoadedFromGenerated += 1;
      continue;
    }

    const hadGeneratedDataset = Boolean(await readJsonIfExists(generatedPath));
    const before = snapshotCounters();
    realDatasets[format.id] = await buildRealFormatBrowserDataset(format, months, latestAvailableMonth, cli);
    await writeJson(generatedPath, realDatasets[format.id]);
    counters.browserBuilt += 1;

    const delta = diffCounters(before, counters);
    console.log(describeBrowserBuild(format.id, {
      hadGeneratedDataset,
      refreshAll: cli.refreshAll,
      refreshCurrent: cli.refreshCurrent,
      delta,
    }));
    printPhaseDelta(`[browser] ${format.id}`, before);
  }

  for (const syntheticId of syntheticIdsToBuild) {
    const format = SYNTHETIC_FORMATS_BY_ID.get(syntheticId);
    console.log(`[browser] building synthetic ${format.id}...`);
    const dataset = await buildSyntheticBrowserDataset(format, realDatasets, months, latestAvailableMonth, cli);
    await writeJson(path.join(byFormatDir, `${format.id}.json`), dataset);
  }

  const resolverTargetIds = await getResolverTargetIds({ cli, explicitRealIds, implicitDependencyIds });

  if (resolverTargetIds.length > 0) {
    console.log(`[resolver] updating availability + sidecars for: ${resolverTargetIds.join(', ')}`);
    const before = snapshotCounters();
    await buildAvailabilityAndResolverSources(resolverTargetIds, months, latestAvailableMonth, cli);
    printPhaseDelta('[resolver] sidecars', before);
  } else {
    console.log('[resolver] no sidecar update needed; reusing existing availability + sidecars');
  }

  const formatsIndex = [
    ...REAL_FORMATS.map(({ id, label, family }) => ({ id, label, family, synthetic: false })),
    ...SYNTHETIC_FORMATS.map(({ id, label, family }) => ({ id, label, family, synthetic: true })),
  ];
  await writeJson(path.join(publicDataDir, 'formats.json'), formatsIndex);

  console.log('');
  console.log('Build summary:');
  console.log(`  browser rebuilt: ${counters.browserBuilt}`);
  console.log(`  browser reused:  ${counters.browserLoadedFromGenerated}`);
  console.log(`  cache hits:      ${counters.cacheHits}`);
  console.log(`  cache 404 hits:  ${counters.cache404Hits}`);
  console.log(`  downloads:       ${counters.downloads}`);
  console.log(`  downloaded 404s: ${counters.downloaded404s}`);
  console.log(`  sidecars written:${counters.sidecarsWritten}`);
  console.log(`  sidecars removed:${counters.sidecarsRemoved}`);
  console.log('Done.');
}

function parseCliArgs(args) {
  const requestedFormatIds = [];
  let refreshAll = false;
  let refreshCurrent = false;
  let help = false;

  for (const arg of args) {
    if (arg === '--refresh') {
      refreshAll = true;
    } else if (arg === '--refresh-current') {
      refreshCurrent = true;
    } else if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown flag: ${arg}`);
    } else {
      requestedFormatIds.push(arg);
    }
  }

  return { requestedFormatIds, refreshAll, refreshCurrent, help };
}

function printHelp() {
  console.log(`
Usage:
  node scripts/build-data.mjs
  node scripts/build-data.mjs gen7anythinggoes
  node scripts/build-data.mjs gen7nfe gen7lc gen7best
  node scripts/build-data.mjs gen7doublesubers gen7doublesou gen7doublesuu
  node scripts/build-data.mjs gen7ou --refresh-current
  node scripts/build-data.mjs gen7anythinggoes --refresh
`.trim());
}

function validateRequestedFormatIds(requestedFormatIds) {
  for (const formatId of requestedFormatIds) {
    if (!ALL_FORMAT_IDS.has(formatId)) {
      throw new Error(`Unknown format ID: ${formatId}`);
    }
  }
}

function getExplicitRealIds(requestedFormatIds) {
  const ids = requestedFormatIds.filter((id) => REAL_FORMATS_BY_ID.has(id));
  if (requestedFormatIds.length === 0) {
    return [...REAL_FORMAT_ORDER];
  }
  return sortRealIds(ids);
}

function getSyntheticIdsToBuild(requestedFormatIds, explicitRealIds) {
  if (requestedFormatIds.length === 0) {
    return SYNTHETIC_FORMATS.map((format) => format.id);
  }

  const ids = new Set(requestedFormatIds.filter((id) => SYNTHETIC_FORMATS_BY_ID.has(id)));

  for (const syntheticFormat of SYNTHETIC_FORMATS) {
    if (syntheticFormat.fallbackOrder.some((realId) => explicitRealIds.includes(realId))) {
      ids.add(syntheticFormat.id);
    }
  }

  return [...ids];
}

function getImplicitDependencyIds(syntheticIdsToBuild, explicitRealIds) {
  const explicit = new Set(explicitRealIds);
  const ids = new Set();

  for (const syntheticId of syntheticIdsToBuild) {
    const synthetic = SYNTHETIC_FORMATS_BY_ID.get(syntheticId);
    for (const realId of synthetic.fallbackOrder) {
      if (!explicit.has(realId)) {
        ids.add(realId);
      }
    }
  }

  return sortRealIds([...ids]);
}

async function getResolverTargetIds({ cli, explicitRealIds, implicitDependencyIds }) {
  if (cli.requestedFormatIds.length === 0) {
    return [...REAL_FORMAT_ORDER];
  }

  if (explicitRealIds.length > 0) {
    return explicitRealIds;
  }

  const existingAvailability = (await readJsonIfExists(availabilityPath)) || { months: {} };
  const missingImplicitDeps = implicitDependencyIds.filter((formatId) =>
    !formatAppearsAnywhereInAvailability(existingAvailability, formatId)
  );

  return missingImplicitDeps;
}

function formatAppearsAnywhereInAvailability(availability, formatId) {
  for (const month of Object.keys(availability.months || {})) {
    if (availability.months?.[month]?.[formatId]) return true;
  }
  return false;
}

function sortRealIds(ids) {
  return [...new Set(ids)].sort(
    (a, b) => (REAL_FORMAT_ORDER_INDEX.get(a) ?? Infinity) - (REAL_FORMAT_ORDER_INDEX.get(b) ?? Infinity)
  );
}

function getCutoffPriorityForFormat(formatId) {
  const family = REAL_FORMATS_BY_ID.get(formatId)?.family || 'singles';
  return FAMILY_CONFIGS[family]?.cutoffPriority || CUTOFF_PRIORITY;
}

async function fetchAvailableMonths() {
  const response = await fetch(`${STATS_ROOT}/`);
  if (!response.ok) {
    throw new Error(`Failed to fetch stats index: ${response.status}`);
  }

  const html = await response.text();
  const months = [...html.matchAll(/href="(\d{4}-\d{2})\/?"/g)].map((match) => match[1]);
  const deduped = [...new Set(months)].sort();

  if (deduped.length === 0) {
    throw new Error('No monthly stats directories found.');
  }

  return deduped;
}

async function buildRealFormatBrowserDataset(format, months, latestAvailableMonth, cli) {
  const monthly = {};
  const history = {};
  const pokemonNames = new Map();
  const availableMonths = [];

  let builtMonthCount = 0;

  for (const month of months) {
    const usageRows = await fetchStatsTable(month, format.id, DEFAULT_RATING, '', latestAvailableMonth, cli);
    if (!usageRows || usageRows.length === 0) continue;

    const leadRows =
      (await fetchStatsTable(month, format.id, DEFAULT_RATING, 'leads', latestAvailableMonth, cli)) || [];
    const leadsById = new Map(leadRows.map((row) => [row.pokemonId, row]));

    const rows = usageRows.map((row) => ({
      ...row,
      leadRawCount: leadsById.get(row.pokemonId)?.rawCount || 0,
    }));

    monthly[month] = rows;
    availableMonths.push(month);
    builtMonthCount += 1;

    for (const row of rows) {
      pokemonNames.set(row.pokemonId, row.name);

      if (!history[row.pokemonId]) {
        history[row.pokemonId] = {
          name: row.name,
          months: {},
        };
      }

      history[row.pokemonId].months[month] = {
        rank: row.rank,
        usage: row.usage,
        rawCount: row.rawCount,
        leadRawCount: row.leadRawCount,
      };
    }

    const movesetText = await fetchRawText(
      month,
      format.id,
      DEFAULT_RATING,
      'moveset',
      latestAvailableMonth,
      cli
    );

    const browserMovesetPath = path.join(browserMovesetsDir, format.id, `${month}.json`);
    if (movesetText) {
      const movesetData = parseMovesetFile(movesetText, month, format.id, DEFAULT_RATING);
      if (Object.keys(movesetData.pokemon).length > 0) {
        await writeJson(browserMovesetPath, movesetData);
      } else {
        await safeRemoveFile(browserMovesetPath);
      }
    } else {
      await safeRemoveFile(browserMovesetPath);
    }
  }

  console.log(`    months built: ${builtMonthCount}`);

  return {
    format: format.id,
    label: format.label,
    family: format.family,
    months: availableMonths,
    pokemonIndex: [...pokemonNames.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    monthly,
    history,
  };
}

async function buildSyntheticBrowserDataset(format, realDatasets, months, latestAvailableMonth, cli) {
  for (const realFormatId of format.fallbackOrder) {
    await ensureBrowserRealDatasetLoaded(realFormatId, realDatasets, months, latestAvailableMonth, cli);
  }

  const monthSet = new Set();

  for (const realFormatId of format.fallbackOrder) {
    for (const month of realDatasets[realFormatId]?.months || []) {
      monthSet.add(month);
    }
  }

  const allMonths = [...monthSet].sort();
  const monthly = {};
  const history = {};
  const pokemonNames = new Map();
  const resolvedMonths = {};

  for (const month of allMonths) {
    const resolvedFormatId = format.fallbackOrder.find((realFormatId) => {
      return (realDatasets[realFormatId]?.monthly?.[month] || []).length > 0;
    });

    if (!resolvedFormatId) continue;

    const sourceRows = realDatasets[resolvedFormatId].monthly[month];
    resolvedMonths[month] = resolvedFormatId;
    monthly[month] = sourceRows;

    for (const row of sourceRows) {
      pokemonNames.set(row.pokemonId, row.name);

      if (!history[row.pokemonId]) {
        history[row.pokemonId] = {
          name: row.name,
          months: {},
        };
      }

      history[row.pokemonId].months[month] = {
        rank: row.rank,
        usage: row.usage,
        rawCount: row.rawCount,
        leadRawCount: row.leadRawCount || 0,
        resolvedFormatId,
      };
    }
  }

  return {
    format: format.id,
    label: format.label,
    family: format.family,
    synthetic: true,
    fallbackOrder: format.fallbackOrder,
    resolvedMonths,
    months: Object.keys(monthly).sort(),
    pokemonIndex: [...pokemonNames.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    monthly,
    history,
  };
}

async function ensureBrowserRealDatasetLoaded(formatId, realDatasets, months, latestAvailableMonth, cli) {
  if (realDatasets[formatId]) {
    return realDatasets[formatId];
  }

  const format = REAL_FORMATS_BY_ID.get(formatId);
  const generatedPath = path.join(byFormatDir, `${formatId}.json`);
  const existing = !cli.refreshAll && !cli.refreshCurrent
    ? await readJsonIfExists(generatedPath)
    : null;

  if (existing) {
    realDatasets[formatId] = existing;
    counters.browserLoadedFromGenerated += 1;
    return existing;
  }

  const before = snapshotCounters();
  const dataset = await buildRealFormatBrowserDataset(format, months, latestAvailableMonth, cli);
  realDatasets[formatId] = dataset;
  await writeJson(generatedPath, dataset);
  counters.browserBuilt += 1;
  const delta = diffCounters(before, counters);
  console.log(describeBrowserBuild(format.id, {
    hadGeneratedDataset: false,
    refreshAll: cli.refreshAll,
    refreshCurrent: cli.refreshCurrent,
    delta,
  }));
  printPhaseDelta(`[browser] ${format.id}`, before);
  return dataset;
}

async function buildAvailabilityAndResolverSources(targetRealIds, months, latestAvailableMonth, cli) {
  const fullBuild = cli.requestedFormatIds.length === 0 || cli.refreshAll;
  const availability = fullBuild
    ? createEmptyAvailability()
    : (await readJsonIfExists(availabilityPath)) || createEmptyAvailability();

  availability.latestMonth = latestAvailableMonth;
  availability.formatOrder = FORMAT_POWER_ORDER;
  availability.cutoffPriority = CUTOFF_PRIORITY;
  availability.familyConfigs = FAMILY_CONFIGS;
  availability.months ||= {};

  const existingPokemonIndex = fullBuild
    ? []
    : (await readJsonIfExists(pokemonIndexPath)) || [];
  const pokemonNameMap = new Map(existingPokemonIndex.map((entry) => [entry.id, entry.name]));

  for (const formatId of targetRealIds) {
    const cutoffPriority = getCutoffPriorityForFormat(formatId);
    console.log(`[resolver] scanning ${formatId} across ${months.length} months...`);
    const before = snapshotCounters();
    let scannedMonths = 0;

    for (const month of months) {
      availability.months[month] ||= {};
      scannedMonths += 1;

      const formatMonthEntry = {
        usage: [],
        leads: [],
        moveset: [],
      };

      for (const cutoff of cutoffPriority) {
        const usageRows = await fetchStatsTable(month, formatId, cutoff, '', latestAvailableMonth, cli);

        if (usageRows && usageRows.length > 0) {
          for (const row of usageRows) {
            pokemonNameMap.set(row.pokemonId, row.name);
          }

          const usageSidecar = {
            source: { month, formatId, cutoff, dataKind: 'usage' },
            pokemon: Object.fromEntries(
              usageRows.map((row) => [
                row.pokemonId,
                {
                  pokemonId: row.pokemonId,
                  name: row.name,
                  rank: row.rank,
                  usage: row.usage,
                  rawCount: row.rawCount,
                },
              ])
            ),
          };

          await writeJson(
            path.join(resolverSourcesDir, month, formatId, String(cutoff), 'usage.json'),
            usageSidecar
          );
          counters.sidecarsWritten += 1;
          formatMonthEntry.usage.push(cutoff);
        } else {
          await safeRemoveFile(path.join(resolverSourcesDir, month, formatId, String(cutoff), 'usage.json'));
        }

        const leadRows =
          (await fetchStatsTable(month, formatId, cutoff, 'leads', latestAvailableMonth, cli)) || [];

        if (usageRows && usageRows.length > 0 && leadRows.length > 0) {
          const leadsById = new Map(leadRows.map((row) => [row.pokemonId, row]));
          const totalUsageRaw = usageRows.reduce((sum, row) => sum + row.rawCount, 0);
          const totalLeadRaw = leadRows.reduce((sum, row) => sum + row.rawCount, 0);

          const leadsSidecar = {
            source: { month, formatId, cutoff, dataKind: 'leads' },
            summary: { totalUsageRaw, totalLeadRaw },
            pokemon: Object.fromEntries(
              usageRows
                .map((usageRow) => {
                  const leadRow = leadsById.get(usageRow.pokemonId);
                  if (!leadRow) return null;

                  return [
                    usageRow.pokemonId,
                    {
                      pokemonId: usageRow.pokemonId,
                      name: usageRow.name,
                      usageRawCount: usageRow.rawCount,
                      leadRawCount: leadRow.rawCount,
                    },
                  ];
                })
                .filter(Boolean)
            ),
          };

          if (Object.keys(leadsSidecar.pokemon).length > 0) {
            await writeJson(
              path.join(resolverSourcesDir, month, formatId, String(cutoff), 'leads.json'),
              leadsSidecar
            );
            counters.sidecarsWritten += 1;
            formatMonthEntry.leads.push(cutoff);
          } else {
            await safeRemoveFile(path.join(resolverSourcesDir, month, formatId, String(cutoff), 'leads.json'));
          }
        } else {
          await safeRemoveFile(path.join(resolverSourcesDir, month, formatId, String(cutoff), 'leads.json'));
        }

        const movesetText = await fetchRawText(
          month,
          formatId,
          cutoff,
          'moveset',
          latestAvailableMonth,
          cli
        );

        if (movesetText) {
          const movesetSidecar = parseMovesetFile(movesetText, month, formatId, cutoff);

          for (const entry of Object.values(movesetSidecar.pokemon)) {
            pokemonNameMap.set(entry.pokemonId, entry.name);
          }

          if (Object.keys(movesetSidecar.pokemon).length > 0) {
            await writeJson(
              path.join(resolverSourcesDir, month, formatId, String(cutoff), 'moveset.json'),
              movesetSidecar
            );
            counters.sidecarsWritten += 1;
            formatMonthEntry.moveset.push(cutoff);
          } else {
            await safeRemoveFile(path.join(resolverSourcesDir, month, formatId, String(cutoff), 'moveset.json'));
          }
        } else {
          await safeRemoveFile(path.join(resolverSourcesDir, month, formatId, String(cutoff), 'moveset.json'));
        }
      }

      if (
        formatMonthEntry.usage.length === 0 &&
        formatMonthEntry.leads.length === 0 &&
        formatMonthEntry.moveset.length === 0
      ) {
        delete availability.months[month][formatId];
      } else {
        availability.months[month][formatId] = formatMonthEntry;
      }

      if (scannedMonths % 12 === 0 || scannedMonths === months.length) {
        console.log(`    ${formatId}: ${scannedMonths}/${months.length} months scanned (through ${month})`);
      }
    }

    printPhaseDelta(`[resolver] ${formatId}`, before);
  }

  for (const [month, monthData] of Object.entries(availability.months)) {
    if (Object.keys(monthData || {}).length === 0) {
      delete availability.months[month];
    }
  }

  await writeJson(availabilityPath, availability);

  const pokemonIndex = [...pokemonNameMap.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  await writeJson(pokemonIndexPath, pokemonIndex);
}

async function fetchStatsTable(month, formatId, cutoff, subdir, latestAvailableMonth, cli) {
  const text = await fetchRawText(month, formatId, cutoff, subdir, latestAvailableMonth, cli);
  if (text == null) {
    return null;
  }
  return parseUsageStats(text);
}

async function fetchRawText(month, formatId, cutoff, subdir, latestAvailableMonth, cli) {
  const prefix = subdir ? `${subdir}/` : '';
  const relativePath = subdir
    ? path.join(month, subdir, `${formatId}-${cutoff}.txt`)
    : path.join(month, `${formatId}-${cutoff}.txt`);
  const cachePath = path.join(cacheRootDir, relativePath);
  const url = `${STATS_ROOT}/${month}/${prefix}${formatId}-${cutoff}.txt`;

  return getCachedRemoteText({
    url,
    cachePath,
    month,
    latestAvailableMonth,
    refreshAll: cli.refreshAll,
    refreshCurrent: cli.refreshCurrent,
  });
}

async function getCachedRemoteText({
  url,
  cachePath,
  month,
  latestAvailableMonth,
  refreshAll,
  refreshCurrent,
}) {
  const isLatestMutableMonth = month === latestAvailableMonth;
  const forceRefresh = refreshAll || (refreshCurrent && isLatestMutableMonth);
  const metaPath = `${cachePath}.meta.json`;

  const fileStat = await statIfExists(cachePath);
  const meta = await readJsonIfExists(metaPath);
  const textExists = Boolean(fileStat);

  if (!forceRefresh) {
    if (textExists) {
      const fetchedAt = meta?.fetchedAt || new Date(fileStat.mtimeMs).toISOString();

      if (!isLatestMutableMonth || isFreshEnough(fetchedAt, CURRENT_MONTH_TTL_MS)) {
        counters.cacheHits += 1;
        return fs.readFile(cachePath, 'utf8');
      }
    }

    if (!textExists && meta?.status === 404) {
      if (!isLatestMutableMonth || isFreshEnough(meta.fetchedAt, CURRENT_MONTH_TTL_MS)) {
        counters.cache404Hits += 1;
        return null;
      }
    }
  }

  const response = await fetch(url);
  const fetchedAt = new Date().toISOString();

  if (response.status === 404) {
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await safeRemoveFile(cachePath);
    await writeJson(metaPath, { url, fetchedAt, status: 404 });
    counters.downloaded404s += 1;
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  const text = await response.text();

  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, text, 'utf8');
  await writeJson(metaPath, { url, fetchedAt, status: 200 });
  counters.downloads += 1;

  return text;
}

function parseUsageStats(text) {
  const rows = [];
  const lines = text.split('\n');

  for (const line of lines) {
    if (!line.trim().startsWith('|')) continue;

    const cells = line
      .split('|')
      .map((cell) => cell.trim())
      .filter(Boolean);

    if (cells.length < 5) continue;
    if (!/^\d+$/.test(cells[0])) continue;

    const rank = Number(cells[0]);
    const name = cells[1];
    const usage = Number.parseFloat(cells[2].replace('%', ''));
    const rawCount = Number.parseInt(cells[3].replaceAll(',', ''), 10);

    if (!Number.isFinite(rank) || !Number.isFinite(usage) || !Number.isFinite(rawCount)) {
      continue;
    }

    rows.push({
      pokemonId: toPokemonId(name),
      name,
      rank,
      usage,
      rawCount,
    });
  }

  return rows;
}

function parseMovesetFile(text, month, formatId, cutoff) {
  const normalizedText = text.replace(/\r/g, '');
  const pokemon = {};

  const monBlockRegex =
    /\+\-+\+\s*\|\s*([^|\n]+?)\s*\|\s*\+\-+\+\s*\|\s*Raw count:\s*([\d,]+)\s*([\s\S]*?)(?=\+\-+\+\s*\|\s*[^|\n]+?\s*\|\s*\+\-+\+\s*\|\s*Raw count:|$)/g;

  let match;

  while ((match = monBlockRegex.exec(normalizedText)) !== null) {
    const name = match[1].trim();
    const pokemonId = toPokemonId(name);
    const rawCount = Number.parseInt(match[2].replaceAll(',', ''), 10);
    const body = match[3];

    pokemon[pokemonId] = {
      pokemonId,
      name,
      rawCount,
      abilities: extractSectionEntries(body, 'Abilities'),
      items: extractSectionEntries(body, 'Items'),
      spreads: extractSectionEntries(body, 'Spreads'),
      moves: extractSectionEntries(body, 'Moves'),
    };
  }

  return {
    source: { month, formatId, cutoff, dataKind: 'moveset' },
    pokemon,
  };
}

function extractSectionEntries(body, sectionName) {
  const escaped = escapeRegex(sectionName);
  const boundary = '(?:Abilities|Items|Spreads|Moves|Teammates|Checks and Counters)';

  const sectionRegex = new RegExp(
    `\\+[-+]+\\+\\s*\\|\\s*${escaped}\\s*\\|\\s*([\\s\\S]*?)(?=\\+[-+]+\\+\\s*\\|\\s*${boundary}\\s*\\||$)`,
    'i'
  );

  const sectionMatch = body.match(sectionRegex);
  if (!sectionMatch) return [];

  const sectionBody = sectionMatch[1];
  const entries = [];
  const entryRegex = /\|\s*([^|]+?)\s+([\d.]+)%\s*(?=\||$)/g;

  let entryMatch;
  while ((entryMatch = entryRegex.exec(sectionBody)) !== null) {
    const name = entryMatch[1].trim();
    const usage = Number.parseFloat(entryMatch[2]);
    if (!name || !Number.isFinite(usage)) continue;
    entries.push({ name, usage });
  }

  return entries;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toPokemonId(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function createEmptyAvailability() {
  return {
    latestMonth: '',
    formatOrder: FORMAT_POWER_ORDER,
    cutoffPriority: CUTOFF_PRIORITY,
    familyConfigs: FAMILY_CONFIGS,
    months: {},
  };
}

function isFreshEnough(fetchedAt, ttlMs) {
  if (!fetchedAt) return false;
  const ageMs = Date.now() - new Date(fetchedAt).getTime();
  return Number.isFinite(ageMs) && ageMs <= ttlMs;
}

async function statIfExists(filePath) {
  try {
    return await fs.stat(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function readJsonIfExists(filePath) {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return JSON.parse(text);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function safeRemoveFile(filePath) {
  const existed = await statIfExists(filePath);
  try {
    await fs.unlink(filePath);
    if (existed) counters.sidecarsRemoved += 1;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function snapshotCounters() {
  return { ...counters };
}

function diffCounters(before, after) {
  return {
    cacheHits: after.cacheHits - before.cacheHits,
    cache404Hits: after.cache404Hits - before.cache404Hits,
    downloads: after.downloads - before.downloads,
    downloaded404s: after.downloaded404s - before.downloaded404s,
    sidecarsWritten: after.sidecarsWritten - before.sidecarsWritten,
    sidecarsRemoved: after.sidecarsRemoved - before.sidecarsRemoved,
  };
}

function describeBrowserBuild(formatId, { hadGeneratedDataset, refreshAll, refreshCurrent, delta }) {
  const downloadedAnything = (delta.downloads + delta.downloaded404s) > 0;
  const usedCache = (delta.cacheHits + delta.cache404Hits) > 0;

  if (!hadGeneratedDataset) {
    if (downloadedAnything && usedCache) return `[browser] first build for ${formatId} (mixed raw inputs: cache hits + downloads)`;
    if (downloadedAnything) return `[browser] first build for ${formatId} (downloaded raw inputs)`;
    if (usedCache) return `[browser] first build for ${formatId} (built entirely from raw cache)`;
    return `[browser] first build for ${formatId}`;
  }

  if (refreshAll || refreshCurrent) {
    if (downloadedAnything && usedCache) return `[browser] rebuilding ${formatId} with forced refresh (cache hits + downloads)`;
    if (downloadedAnything) return `[browser] rebuilding ${formatId} with forced refresh (downloaded raw inputs)`;
    if (usedCache) return `[browser] rebuilding ${formatId} with forced refresh (built from raw cache)`;
    return `[browser] rebuilding ${formatId} with forced refresh`;
  }

  if (downloadedAnything && usedCache) return `[browser] rebuilding ${formatId} (partial raw cache; downloaded missing inputs)`;
  if (downloadedAnything) return `[browser] rebuilding ${formatId} (downloaded raw inputs; no usable cache hits)`;
  if (usedCache) return `[browser] rebuilding ${formatId} from raw cache`;
  return `[browser] rebuilding ${formatId}`;
}

function printPhaseDelta(label, before) {
  const delta = diffCounters(before, counters);

  console.log(
    `    ${label}: cache=${delta.cacheHits}, cache404=${delta.cache404Hits}, downloads=${delta.downloads}, download404=${delta.downloaded404s}, sidecars+${delta.sidecarsWritten}, removed=${delta.sidecarsRemoved}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
