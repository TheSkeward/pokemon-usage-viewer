import './styles/main.css';

import {
  getLineRepresentativeCandidates,
  loadAvailability,
  loadFormatsIndex,
  loadPokemonIndex,
  resolveBestAvailableLightBundle,
  resolveQueryEntries,
} from './data';

const app = document.querySelector('#pool-app');

let availability = null;
let formatsIndex = [];
let pokemonIndex = [];

const state = {
  family: getParam('family') || 'singles',
  selection: getParam('selection') || 'all',
  query: getParam('poolQuery') || '',
  result: null,
  loading: false,
};

init().catch((error) => {
  console.error(error);
  app.innerHTML = `
    <div class="app-shell">
      <h1>Pokémon Pool Optimizer</h1>
      <p>Something broke while loading the optimizer.</p>
      <pre>${escapeHtml(error.message)}</pre>
    </div>
  `;
});

async function init() {
  [formatsIndex, availability, pokemonIndex] = await Promise.all([
    loadFormatsIndex(),
    loadAvailability(),
    loadPokemonIndex(),
  ]);

  if (state.query.trim()) {
    await computeAndRender();
  } else {
    render();
  }
}

async function computeAndRender() {
  state.loading = true;
  render();
  await waitForPaint();

  state.result = await computePoolResult();
  state.loading = false;
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
  const tokens = query
    .split(/[,\n]+/)
    .map((token) => token.trim())
    .filter(Boolean);

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

  bestTeam.team = bestTeam.team
    .slice(0, 6)
    .sort((a, b) => b.score - a.score);

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

  app.innerHTML = `
    <div class="app-shell">
      <header>
        <h1>Pokémon Pool Optimizer</h1>
      </header>

      <nav class="view-tabs">
        <a class="view-tab" href="${baseUrl()}">Main Viewer</a>
        <button class="view-tab ${state.family === 'singles' ? 'active' : ''}" data-family="singles">Singles</button>
        <button class="view-tab ${state.family === 'doubles' ? 'active' : ''}" data-family="doubles">Doubles</button>
      </nav>

      <section class="panel">
        <div class="toolbar pool-toolbar">
          <label>
            <span>Period</span>
            <select id="selection-input">
              <option value="all" ${state.selection === 'all' ? 'selected' : ''}>All available</option>
            </select>
          </label>

          <label class="wide-control">
            <span>Available Pokémon pool</span>
            <textarea id="pool-query-input" rows="5" placeholder="Bulbasaur, Charmander, Squirtle...">${escapeHtml(state.query)}</textarea>
          </label>
        </div>

        <button class="view-tab" id="optimize-button">${state.loading ? 'Optimizing...' : 'Optimize team'}</button>
      </section>

      ${state.loading ? renderLoading() : ''}

      ${
        result?.team?.length
          ? renderResult(result, familyLabel)
          : renderEmpty()
      }
    </div>
  `;

  bindEvents();
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
        <p class="muted">Enter your available Pokémon pool, then optimize. v0 chooses the strongest six by competitive signal, with at most one Mega.</p>
      </section>
    `;
  }

  return `
    <section class="panel">
      <p class="muted">No recommendation yet.</p>
    </section>
  `;
}

function renderResult(result, familyLabel) {
  const megaText = result.megaUsed ? `Mega used: ${escapeHtml(result.megaUsed.name)}` : 'No Mega selected';

  return `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2>Recommended ${escapeHtml(familyLabel)} Team</h2>
          <p>${result.team.length} picks from ${result.linesConsidered} resolved input lines. ${megaText}.</p>
          <p>v0 rules: at most one Mega, one representative per input line, ranked by usage/raw/lead signal.</p>
        </div>
      </div>

      <div class="table-wrap">
        <table class="usage-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Input</th>
              <th>Pick</th>
              <th>Usage %</th>
              <th>Lead %</th>
              <th>Source</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            ${result.team.map(renderTeamRow).join('')}
          </tbody>
        </table>
      </div>
    </section>

    ${renderUnresolved(result.unresolved)}
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
      <td>${renderSource(row.bundle?.usage)}</td>
      <td>${escapeHtml(row.note || '')}</td>
    </tr>
  `;
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
  document.querySelectorAll('[data-family]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      state.family = event.currentTarget.dataset.family;
      await computeAndRender();
    });
  });

  document.querySelector('#pool-query-input')?.addEventListener('input', (event) => {
    state.query = event.target.value;
    writeUrl();
  });

  document.querySelector('#optimize-button')?.addEventListener('click', async () => {
    await computeAndRender();
  });
}

function writeUrl() {
  const params = new URLSearchParams();
  params.set('family', state.family);
  params.set('selection', state.selection);
  if (state.query) params.set('poolQuery', state.query);
  window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
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
