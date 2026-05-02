import {
  getLineRepresentativeCandidates,
  loadAvailability,
  loadFormatsIndex,
  loadPokemonIndex,
  resolveBestAvailableLightBundle,
  resolveQueryEntries,
} from './data';

const POOL_STORAGE_KEY = 'pokemon-usage-viewer:owned-pool:v1';
const TEAM_SORT_STORAGE_KEY = 'pokemon-usage-viewer:pool-team-sort:v1';
const TEAM_SORT_DIR_STORAGE_KEY = 'pokemon-usage-viewer:pool-team-sort-dir:v1';

export function mountPoolOptimizer(container, options = {}) {
  const app = container;
  const embedded = Boolean(options.embedded);
  const initialFamily = options.family || getParam('family') || 'singles';

  let availability = null;
  let formatsIndex = [];
  let pokemonIndex = [];

  const initialQuery = getParam('poolQuery') || loadSavedPool();

  const state = {
    family: initialFamily,
    selection: getParam('selection') || 'all',
    query: initialQuery,
    teamSort: getParam('teamSort') || loadSavedTeamSort() || 'lead',
    teamSortDir: getParam('teamSortDir') || loadSavedTeamSortDir() || 'desc',
    result: null,
    loading: false,
    statusMessage: '',
  };

  init().catch((error) => {
    console.error(error);
    app.innerHTML = `
      <section class="panel">
        <h2>Pool Optimizer</h2>
        <p>Something broke while loading the optimizer.</p>
        <pre>${escapeHtml(error.message)}</pre>
      </section>
    `;
  });

  async function init() {
    [formatsIndex, availability, pokemonIndex] = await Promise.all([
      loadFormatsIndex(),
      loadAvailability(),
      loadPokemonIndex(),
    ]);

    if (initialQuery.trim()) {
      savePool(initialQuery);
      await computeAndRender();
    } else {
      render();
    }
  }

  async function computeAndRender() {
    state.loading = true;
    state.statusMessage = 'Optimizing pool...';
    render();
    await waitForPaint();

    state.result = await computePoolResult();
    state.loading = false;
    state.statusMessage = '';
    writeUrl();
    render();
  }

  async function computePoolResult() {
    const groups = buildInputGroups(state.query);
    const lines = (
      await Promise.all(groups.map((group) => resolvePoolLine(group)))
    ).filter(Boolean);

    return choosePoolTeam(lines);
  }

  function buildInputGroups(query) {
    const tokens = parsePoolTokens(query);
    const groups = [];

    for (const token of tokens) {
      const entries = resolveQueryEntries(token, pokemonIndex);
      if (!entries.length) {
        groups.push({
          token,
          input: { id: normalizeName(token), name: token, token },
          entries: [],
          unresolved: true,
        });
        continue;
      }

      const exact = entries.find((entry) => normalizeName(entry.name) === normalizeName(token));
      const chosen = exact || entries[0];

      groups.push({
        token,
        input: chosen,
        entries: [chosen],
        ambiguousCount: entries.length,
        unresolved: false,
      });
    }

    return groups;
  }

  async function resolvePoolLine(group) {
    if (group.unresolved || !group.entries.length) {
      return {
        unresolved: true,
        inputName: group.token,
        lineKey: `unresolved:${group.token}`,
        best: null,
        bestNonMega: null,
        candidates: [],
      };
    }

    const input = group.input;
    const candidates = getLineRepresentativeCandidates(input.id, pokemonIndex);

    const scored = await Promise.all(
      candidates.map(async (candidate) => {
        const bundle = await resolveBestAvailableLightBundle({
          availability,
          family: state.family,
          selection: state.selection,
          pokemonId: candidate.id,
        });

        return {
          input,
          candidate,
          bundle,
          score: scoreCandidate(candidate, bundle),
        };
      })
    );

    const ranked = scored
      .filter((candidate) => Number.isFinite(candidate.score))
      .sort((a, b) => b.score - a.score);

    if (!ranked.length) {
      return {
        unresolved: false,
        inputName: input.name,
        lineKey: getLineKey(candidates, input.id),
        best: null,
        bestNonMega: null,
        candidates: [],
      };
    }

    const best = ranked[0];
    const bestNonMega = ranked.find((entry) => !entry.candidate.isMega) || null;

    return {
      unresolved: false,
      inputName: input.name,
      lineKey: getLineKey(candidates, input.id),
      best: makeChoice(input, best, best.candidate.isMega ? 'Best overall; uses Mega slot' : 'Best overall'),
      bestNonMega: bestNonMega
        ? makeChoice(input, bestNonMega, best.candidate.isMega ? 'Best non-Mega fallback' : 'Best non-Mega')
        : null,
      candidates: ranked,
    };
  }

  function choosePoolTeam(lines) {
    const resolvedLines = lines.filter((line) => line.best || line.bestNonMega);
    const unresolved = lines.filter((line) => line.unresolved);

    const nonMegaPool = resolvedLines
      .filter((line) => line.bestNonMega)
      .map((line) => line.bestNonMega)
      .sort((a, b) => b.score - a.score);

    const candidateTeams = [
      {
        team: nonMegaPool.slice(0, 6),
        megaUsed: null,
      },
    ];

    for (const line of resolvedLines) {
      if (!line.best?.isMega) continue;

      const others = resolvedLines
        .filter((other) => other.lineKey !== line.lineKey && other.bestNonMega)
        .map((other) => other.bestNonMega)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

      candidateTeams.push({
        team: [line.best, ...others],
        megaUsed: line.best,
      });
    }

    const bestTeam =
      candidateTeams
        .filter((candidate) => candidate.team.length > 0)
        .sort((a, b) => sumTeamScore(b.team) - sumTeamScore(a.team))[0] ||
      { team: [], megaUsed: null };

    bestTeam.team = bestTeam.team.slice(0, 6);

    return {
      team: bestTeam.team,
      megaUsed: bestTeam.megaUsed,
      lines,
      unresolved,
      linesConsidered: resolvedLines.length,
    };
  }

  function scoreCandidate(candidate, bundle) {
    const usage = bundle?.usage;
    if (!usage) return -Infinity;

    const familyConfig = availability?.familyConfigs?.[state.family] || {};
    const formatOrder = familyConfig.formatOrder || [];
    const cutoffPriority = familyConfig.cutoffPriority || [];

    const formatIndex = formatOrder.indexOf(usage.formatId);
    const cutoffIndex = cutoffPriority.indexOf(usage.cutoff);

    const usagePercent = Math.max(0, usage.value || 0);
    const rawCount = Math.max(0, usage.entry?.rawCount || 0);
    const leadPercent = Math.max(0, bundle.leads?.value || 0);

    const usageScore = Math.log1p(usagePercent) * 2000 + usagePercent * 250;
    const rawScore = Math.log1p(rawCount) * 35;
    const leadScore = leadPercent * 2;
    const formatQuality = formatIndex >= 0 ? (formatOrder.length - formatIndex) * 20 : 0;
    const cutoffQuality = cutoffIndex >= 0 ? (cutoffPriority.length - cutoffIndex) * 6 : 0;
    const megaBonus = candidate.isMega ? 300 : 0;

    return usageScore + rawScore + leadScore + formatQuality + cutoffQuality + megaBonus;
  }

  function makeChoice(input, result, note) {
    return {
      inputPokemonId: input.id,
      inputName: input.name,
      pokemonId: result.candidate.id,
      name: result.candidate.name,
      isMega: Boolean(result.candidate.isMega),
      score: result.score,
      bundle: result.bundle,
      note,
    };
  }

  function getLineKey(candidates, fallbackId) {
    if (!candidates.length) return fallbackId;
    return candidates.map((candidate) => candidate.id).sort().join('|');
  }

  function sumTeamScore(team) {
    return team.reduce((sum, row) => sum + (row.score || 0), 0);
  }

  function render() {
    const familyLabel = state.family === 'doubles' ? 'Doubles' : 'Singles';
    const result = state.result;
    const poolStats = getPoolStats(state.query);

    app.innerHTML = `
      ${embedded ? '' : renderStandaloneHeader()}

      <section class="panel">
        <div class="panel-header">
          <div>
            <h2>Owned Pokémon Pool</h2>
            <p>${poolStats.uniqueCount} unique entries${poolStats.duplicateCount ? ` · ${poolStats.duplicateCount} duplicates ignored` : ''}. Autosaved in this browser.</p>
          </div>
        </div>

        <div class="toolbar pool-toolbar">
          <label>
            <span>Period</span>
            <select id="selection-input">
              <option value="all" ${state.selection === 'all' ? 'selected' : ''}>All available</option>
            </select>
          </label>

          ${
            embedded
              ? ''
              : `<label>
                  <span>Family</span>
                  <select id="family-input">
                    <option value="singles" ${state.family === 'singles' ? 'selected' : ''}>Singles</option>
                    <option value="doubles" ${state.family === 'doubles' ? 'selected' : ''}>Doubles</option>
                  </select>
                </label>`
          }

          <label class="wide-control">
            <span>Available Pokémon pool</span>
            <textarea id="pool-query-input" rows="8" placeholder="Bulbasaur, Charmander, Squirtle...">${escapeHtml(state.query)}</textarea>
          </label>
        </div>

        <div class="toolbar">
          <button class="view-tab primary-action" id="optimize-button">${state.loading ? 'Optimizing...' : 'Normalize + optimize team'}</button>
          <button class="view-tab" id="copy-pool-button">Copy pool</button>
          <button class="view-tab danger-button" id="clear-pool-button">Clear saved pool</button>
          <span class="muted" data-pool-status>${escapeHtml(state.statusMessage)}</span>
        </div>
      </section>

      ${state.loading ? renderLoading() : ''}

      ${
        result?.team?.length
          ? renderResult(result, familyLabel)
          : renderEmpty()
      }
    `;

    bindEvents();
  }

  function renderStandaloneHeader() {
    return `
      <header>
        <h1>Pokémon Pool Optimizer</h1>
      </header>

      <nav class="view-tabs">
        <a class="view-tab" href="${baseUrl()}">Main Viewer</a>
      </nav>
    `;
  }

  function renderLoading() {
    return `
      <section class="panel">
        <div class="resolver-loading-banner">
          <span class="spinner-dot"></span>
          <span>Optimizing pool against precomputed ${escapeHtml(state.family)} resolver data...</span>
        </div>
      </section>
    `;
  }

  function renderEmpty() {
    if (!state.query.trim()) {
      return `
        <section class="panel">
          <p class="muted">Enter your available Pokémon pool, then optimize. Your list is stored locally in this browser.</p>
        </section>
      `;
    }

    return `
      <section class="panel">
        <p class="muted">No recommendation yet. Click Optimize team.</p>
      </section>
    `;
  }

  function renderResult(result, familyLabel) {
    const megaText = result.megaUsed ? `Mega used: ${escapeHtml(result.megaUsed.name)}` : 'No Mega selected';
    const sortedTeam = getSortedTeam(result.team, state.teamSort, state.teamSortDir);

    return `
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2>Recommended ${escapeHtml(familyLabel)} Team</h2>
            <p>${result.team.length} picks from ${result.linesConsidered} resolved input lines. ${megaText}.</p>
            <p>v0 rules: at most one Mega, one representative per input line, selected by optimizer score; displayed by ${escapeHtml(getSortLabel(state.teamSort, state.teamSortDir))}.</p>
          </div>
        </div>

        <div class="table-wrap">
          <table class="usage-table">
            <thead>
              <tr>
                <th>#</th>
                ${renderSortHeader('input', 'Input')}
                ${renderSortHeader('name', 'Pick')}
                ${renderSortHeader('usage', 'Usage %')}
                ${renderSortHeader('lead', 'Lead %')}
                ${renderSortHeader('score', 'Score')}
                <th>Source</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              ${sortedTeam.map(renderTeamRow).join('')}
            </tbody>
          </table>
        </div>
      </section>

      ${renderUnresolved(result.unresolved)}
    `;
  }

  function renderSortHeader(sortBy, label) {
    const active = state.teamSort === sortBy;
    const arrow = active ? (state.teamSortDir === 'asc' ? ' ▲' : ' ▼') : '';

    return `
      <th>
        <button class="sort-header-button ${active ? 'active' : ''}" data-team-sort="${escapeHtml(sortBy)}">
          ${escapeHtml(label)}${arrow}
        </button>
      </th>
    `;
  }

  function renderTeamRow(row, index) {
    return `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(row.inputName)}</td>
        <td>
          <strong>${escapeHtml(row.name)}</strong>
          ${row.isMega ? `<div class="representative-note">Mega slot</div>` : ''}
        </td>
        <td>${formatPercent(row.bundle?.usage?.value)}</td>
        <td>${formatPercent(row.bundle?.leads?.value)}</td>
        <td>${Number.isFinite(row.score) ? Math.round(row.score).toLocaleString() : ''}</td>
        <td>${renderSource(row.bundle?.usage)}</td>
        <td>${escapeHtml(row.note || '')}</td>
      </tr>
    `;
  }

  function getSortedTeam(team, sortBy, sortDir = 'desc') {
    const rows = [...team];
    const direction = sortDir === 'asc' ? 1 : -1;

    rows.sort((a, b) => {
      let primary = 0;

      if (sortBy === 'lead') {
        primary = compareNumber(a.bundle?.leads?.value, b.bundle?.leads?.value);
      } else if (sortBy === 'usage') {
        primary = compareNumber(a.bundle?.usage?.value, b.bundle?.usage?.value);
      } else if (sortBy === 'score') {
        primary = compareNumber(a.score, b.score);
      } else if (sortBy === 'input') {
        primary = a.inputName.localeCompare(b.inputName);
      } else {
        primary = a.name.localeCompare(b.name);
      }

      if (primary !== 0) return primary * direction;

      return (
        compareNumber(b.score, a.score) ||
        compareNumber(b.bundle?.usage?.value, a.bundle?.usage?.value) ||
        a.name.localeCompare(b.name)
      );
    });

    return rows;
  }

  function compareNumber(a, b) {
    const safeA = typeof a === 'number' ? a : -Infinity;
    const safeB = typeof b === 'number' ? b : -Infinity;
    return safeA === safeB ? 0 : safeA - safeB;
  }

  function getSortLabel(sortBy, sortDir = 'desc') {
    const direction = sortDir === 'asc' ? 'ascending' : 'descending';

    if (sortBy === 'lead') return `Lead % ${direction}`;
    if (sortBy === 'usage') return `Usage % ${direction}`;
    if (sortBy === 'score') return `optimizer score ${direction}`;
    if (sortBy === 'input') return `input name ${direction}`;
    return `Pokémon name ${direction}`;
  }

  function renderUnresolved(unresolved = []) {
    if (!unresolved.length) return '';

    return `
      <section class="panel">
        <h2>Unresolved inputs</h2>
        <p class="muted">${unresolved.map((line) => escapeHtml(line.inputName)).join(', ')}</p>
      </section>
    `;
  }

  function renderSource(source) {
    if (!source) return '';
    const label = formatsIndex.find((format) => format.id === source.formatId)?.label || source.formatId;
    return source.selection === 'all'
      ? `${escapeHtml(label)} @ ${source.cutoff} (${source.monthsPresent}/${source.monthsAvailable} mo)`
      : `${escapeHtml(label)} @ ${source.cutoff}`;
  }

  function bindEvents() {
    document.querySelector('#family-input')?.addEventListener('change', async (event) => {
      state.family = event.target.value;
      await computeAndRender();
    });

    document.querySelector('#selection-input')?.addEventListener('change', async (event) => {
      state.selection = event.target.value;
      await computeAndRender();
    });

    document.querySelectorAll('[data-team-sort]').forEach((button) => {
      button.addEventListener('click', () => {
        const nextSort = button.dataset.teamSort;

        if (state.teamSort === nextSort) {
          state.teamSortDir = state.teamSortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.teamSort = nextSort;
          state.teamSortDir = nextSort === 'name' || nextSort === 'input' ? 'asc' : 'desc';
        }

        saveTeamSort(state.teamSort);
        saveTeamSortDir(state.teamSortDir);
        writeUrl();
        render();
      });
    });

    document.querySelector('#pool-query-input')?.addEventListener('input', (event) => {
      state.query = event.target.value;
      savePool(state.query);
      state.result = null;
      state.statusMessage = 'Saved locally';
      writeUrl();
      updatePoolStatusMessage('Saved locally');
    });

    document.querySelector('#optimize-button')?.addEventListener('click', async () => {
      state.query = normalizePoolText(state.query);
      savePool(state.query);
      state.statusMessage = 'Normalized and saved';
      await computeAndRender();
    });

    document.querySelector('#copy-pool-button')?.addEventListener('click', async () => {
      await copyPool();
    });

    document.querySelector('#clear-pool-button')?.addEventListener('click', () => {
      const confirmed = window.confirm('Clear the saved owned Pokémon pool from this browser?');
      if (!confirmed) return;

      state.query = '';
      state.result = null;
      state.statusMessage = 'Saved pool cleared';
      localStorage.removeItem(POOL_STORAGE_KEY);
      writeUrl();
      render();
    });
  }

  async function copyPool() {
    const text = state.query.trim();
    if (!text) {
      state.statusMessage = 'Nothing to copy';
      render();
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      state.statusMessage = 'Copied pool to clipboard';
    } catch {
      state.statusMessage = 'Clipboard copy failed';
    }

    render();
  }

  function parsePoolTokens(query) {
    return extractPoolNames(query);
  }

  function getPoolStats(query) {
    const tokens = parsePoolTokens(query);
    const unique = new Set(tokens.map(normalizeName).filter(Boolean));

    return {
      totalCount: tokens.length,
      uniqueCount: unique.size,
      duplicateCount: Math.max(0, tokens.length - unique.size),
    };
  }

  function normalizePoolText(query) {
    const byKey = new Map();

    for (const name of extractPoolNames(query)) {
      const canonical = canonicalizePoolName(name);
      const key = normalizeName(canonical);
      if (!key || byKey.has(key)) continue;
      byKey.set(key, canonical);
    }

    return [...byKey.values()].sort((a, b) => a.localeCompare(b)).join(', ');
  }

  function extractPoolNames(query) {
    const names = [];

    for (const rawLine of String(query || '').split(/\n+/)) {
      const line = rawLine.trim();
      if (!line) continue;

      // If this is a comma-separated hand-written list, split it.
      // If this is a pasted table row, it usually has no commas and should
      // be handled as one row.
      if (line.includes(',')) {
        for (const part of line.split(',')) {
          const name = extractNameFromPoolToken(part);
          if (name) names.push(name);
        }
      } else {
        const name = extractNameFromPoolToken(line);
        if (name) names.push(name);
      }
    }

    return names;
  }

  function extractNameFromPoolToken(value) {
    const text = String(value || '').trim();
    if (!text) return '';

    // TSV / copied table rows: "Trubbish\t3-9\t57%".
    const firstTabCell = text.split('\t')[0].trim();
    if (firstTabCell && firstTabCell !== text) {
      return canonicalizePoolName(firstTabCell);
    }

    // Space-separated table rows: "Trubbish 3-9 57%".
    const beforeNumericColumns = text.split(/\s+(?=\d|--)/)[0]?.trim();
    if (beforeNumericColumns && beforeNumericColumns !== text) {
      return canonicalizePoolName(beforeNumericColumns);
    }

    return canonicalizePoolName(text);
  }

  function canonicalizePoolName(value) {
    const text = String(value || '').trim();
    if (!text) return '';

    return (
      findExactPokemonName(text) ||
      findLeadingPokemonName(text) ||
      titleCaseLoose(text)
    );
  }

  function findExactPokemonName(value) {
    const key = normalizeName(value);
    if (!key) return null;

    return pokemonIndex.find((pokemon) => normalizeName(pokemon.name) === key)?.name || null;
  }

  function findLeadingPokemonName(value) {
    const key = normalizeName(value);
    if (!key) return null;

    const matches = pokemonIndex
      .filter((pokemon) => key.startsWith(normalizeName(pokemon.name)))
      .sort((a, b) => normalizeName(b.name).length - normalizeName(a.name).length);

    return matches[0]?.name || null;
  }

  function titleCaseLoose(value) {
    return String(value || '')
      .trim()
      .split(/\s+/)
      .map((word) => word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word)
      .join(' ');
  }

  function updatePoolStatusMessage(message) {
    const statusNode = app.querySelector('[data-pool-status]');
    if (statusNode) statusNode.textContent = message || '';
  }

  function writeUrl() {
    if (embedded) return;

    const params = new URLSearchParams();
    params.set('family', state.family);
    params.set('selection', state.selection);
    params.set('teamSort', state.teamSort);
    params.set('teamSortDir', state.teamSortDir);

    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
  }
}

export function savePool(value) {
  localStorage.setItem(POOL_STORAGE_KEY, value);
}

export function loadSavedPool() {
  return localStorage.getItem(POOL_STORAGE_KEY) || '';
}

function saveTeamSort(value) {
  localStorage.setItem(TEAM_SORT_STORAGE_KEY, value);
}

function loadSavedTeamSort() {
  return localStorage.getItem(TEAM_SORT_STORAGE_KEY) || '';
}

function saveTeamSortDir(value) {
  localStorage.setItem(TEAM_SORT_DIR_STORAGE_KEY, value);
}

function loadSavedTeamSortDir() {
  return localStorage.getItem(TEAM_SORT_DIR_STORAGE_KEY) || '';
}

function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function baseUrl() {
  return import.meta.env.BASE_URL || '/';
}

function waitForPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function formatPercent(value) {
  return typeof value === 'number' ? value.toFixed(2) : '';
}

function normalizeName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
