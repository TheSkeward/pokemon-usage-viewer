import {
  loadAvailability,
  loadFormatsIndex,
  loadPokemonIndex,
} from "./data";
import { renderMovesetPanel } from "./views/movesetView";
import { getPoolStats, normalizePoolText } from "./teamBuilder/poolParsing";
import { optimizeTeamFromPool } from "./teamBuilder/teamOptimizer";
import { createTeamBuilderSetDetailsLoader } from "./teamBuilder/setDetailsLoader";
import {
  readLocalStorage,
  removeLocalStorage,
  writeLocalStorage,
} from "./storage/safeLocalStorage";

const POOL_STORAGE_KEY = "pokemon-usage-viewer:owned-pool:v1";
const TEAM_SORT_STORAGE_KEY = "pokemon-usage-viewer:pool-team-sort:v1";
const TEAM_SORT_DIR_STORAGE_KEY = "pokemon-usage-viewer:pool-team-sort-dir:v1";

export function mountPoolOptimizer(container, options = {}) {
  const app = container;
  const embedded = Boolean(options.embedded);
  const initialFamily = options.family || getParam("family") || "singles";

  let availability = null;
  let formatsIndex = [];
  let pokemonIndex = [];

  const initialQuery = getParam("poolQuery") || loadSavedPool();

  const state = {
    family: initialFamily,
    selection: getParam("selection") || "all",
    query: initialQuery,
    teamSort: getParam("teamSort") || loadSavedTeamSort() || "lead",
    teamSortDir: getParam("teamSortDir") || loadSavedTeamSortDir() || "desc",
    result: null,
    loading: false,
    statusMessage: "",
  };

  const setDetails = createTeamBuilderSetDetailsLoader({
    getAvailability: () => availability,
    getFamily: () => state.family,
    getFormatLabel,
    getSelection: () => state.selection,
    onUpdate: () => render(),
    waitForPaint,
  });

  init().catch((error) => {
    console.error(error);
    app.innerHTML = `
      <section class="panel">
        <h2>Team Builder</h2>
        <p>Something broke while loading the team builder.</p>
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
    setDetails.cancel();

    state.loading = true;
    state.statusMessage = "Optimizing pool...";
    render();
    await waitForPaint();

    try {
      state.query = normalizePoolText(state.query, pokemonIndex);

      const saved = savePool(state.query);

      state.result = await optimizeTeamFromPool({
        availability,
        family: state.family,
        pokemonIndex,
        query: state.query,
        selection: state.selection,
      });

      setDetails.cancel();

      state.loading = false;
      state.statusMessage = saved
        ? getOptimizationSummary(state.result)
        : `${getOptimizationSummary(state.result)} Pool could not be saved locally; browser storage is full.`;

      writeUrl();
      render();
    } catch (error) {
      console.error("Team Builder optimization failed", error);

      state.loading = false;
      state.result = null;
      state.statusMessage = `Optimization failed: ${error?.message || error}`;

      setDetails.cancel();
      render();
    }
  }

  function render() {
    const familyLabel = state.family === "doubles" ? "Doubles" : "Singles";
    const poolStats = getPoolStats(state.query, pokemonIndex);

    app.innerHTML = `
      ${embedded ? "" : renderStandaloneHeader()}

      ${renderPoolControls(poolStats)}

      ${state.loading ? renderLoading() : ""}

      ${state.result ? renderResult(state.result, familyLabel) : renderEmpty()}
    `;

    bindEvents();
    renderSelectedSetDetails();
  }

  function renderPoolControls(poolStats) {
    return `
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2>Owned Pokémon Pool</h2>
            <p>${poolStats.uniqueCount} unique entries${poolStats.duplicateCount ? ` · ${poolStats.duplicateCount} duplicates ignored` : ""}. Autosaved in this browser.</p>
          </div>
        </div>

        <div class="toolbar pool-toolbar">
          <label>
            <span>Period</span>
            <select id="selection-input">
              <option value="all" ${state.selection === "all" ? "selected" : ""}>All available</option>
            </select>
          </label>

          ${
            embedded
              ? ""
              : `<label>
                  <span>Family</span>
                  <select id="family-input">
                    <option value="singles" ${state.family === "singles" ? "selected" : ""}>Singles</option>
                    <option value="doubles" ${state.family === "doubles" ? "selected" : ""}>Doubles</option>
                  </select>
                </label>`
          }

          <label class="wide-control">
            <span>Available Pokémon pool</span>
            <textarea id="pool-query-input" rows="8" placeholder="Bulbasaur, Charmander, Squirtle...">${escapeHtml(state.query)}</textarea>
          </label>
        </div>

        <div class="toolbar">
          <button class="view-tab primary-action" id="optimize-button">${state.loading ? "Optimizing..." : "Normalize + optimize team"}</button>
          <button class="view-tab" id="copy-pool-button">Copy pool</button>
          <button class="view-tab danger-button" id="clear-pool-button">Clear saved pool</button>
          <span class="muted" data-pool-status>${escapeHtml(state.statusMessage)}</span>
        </div>
      </section>
    `;
  }

  function renderStandaloneHeader() {
    return `
      <header>
        <h1>Pokémon Pool Team Builder</h1>
      </header>

      <nav class="view-tabs">
        <a class="view-tab" href="${baseUrl()}">Main App</a>
      </nav>
    `;
  }

  function renderLoading() {
    return `
      <section class="panel">
        <div class="resolver-loading-banner">
          <span class="spinner-dot"></span>
          <span>Optimizing pool against precomputed ${escapeHtml(state.family)} set data...</span>
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
        <p class="muted">No recommendation yet. Click Normalize + optimize team.</p>
      </section>
    `;
  }

  function renderResult(result, familyLabel) {
    if (!result.team.length) {
      return `
        <section class="panel">
          <h2>Recommended ${escapeHtml(familyLabel)} Team</h2>
          <p class="muted">No viable team picks found from ${result.linesConsidered} resolved input lines.</p>
        </section>

        ${renderUnresolved(result.unresolved)}
      `;
    }

    const megaText = result.megaUsed
      ? `Mega used: ${escapeHtml(result.megaUsed.name)}`
      : "No Mega selected";

    const sortedTeam = getSortedTeam(
      result.team,
      state.teamSort,
      state.teamSortDir,
    );

    return `
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2>Recommended ${escapeHtml(familyLabel)} Team</h2>
            <p>${result.team.length} picks from ${result.linesConsidered} resolved input lines. ${megaText}.</p>
            <p>v0 rules: at most one Mega, one representative per input line, selected by optimizer score; displayed by ${escapeHtml(getSortLabel(state.teamSort, state.teamSortDir))}. Click a row to inspect its primary set.</p>
          </div>
        </div>

        <div class="table-wrap">
          <table class="usage-table">
            <thead>
              <tr>
                <th>#</th>
                ${renderSortHeader("input", "Input")}
                ${renderSortHeader("name", "Pick")}
                ${renderSortHeader("usage", "Usage %")}
                ${renderSortHeader("lead", "Lead %")}
                ${renderSortHeader("score", "Score")}
                <th>Source</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              ${sortedTeam.map(renderTeamRow).join("")}
            </tbody>
          </table>
        </div>
      </section>

      ${renderUnresolved(result.unresolved)}
    `;
  }

  function renderSortHeader(sortBy, label) {
    const active = state.teamSort === sortBy;
    const arrow = active ? (state.teamSortDir === "asc" ? " ▲" : " ▼") : "";

    return `
      <th>
        <button class="sort-header-button ${active ? "active" : ""}" data-team-sort="${escapeHtml(sortBy)}">
          ${escapeHtml(label)}${arrow}
        </button>
      </th>
    `;
  }

  function renderTeamRow(row, index) {
    const selected = setDetails.isSelected(row.pokemonId);

    return `
      <tr
        class="team-pick-row ${selected ? "selected-row" : ""}"
        data-pool-set-id="${escapeHtml(row.pokemonId)}"
        title="Inspect ${escapeHtml(row.name)} set"
      >
        <td>${index + 1}</td>
        <td>${escapeHtml(row.inputName)}</td>
        <td>
          <strong>${escapeHtml(row.name)}</strong>
          ${row.isMega ? `<div class="representative-note">Mega slot</div>` : ""}
        </td>
        <td>${formatPercent(row.bundle?.usage?.value)}</td>
        <td>${formatPercent(row.bundle?.leads?.value)}</td>
        <td>${Number.isFinite(row.score) ? Math.round(row.score).toLocaleString() : ""}</td>
        <td>${renderSource(row.bundle?.usage)}</td>
        <td>${escapeHtml(row.note || "")}</td>
      </tr>

      ${
        selected
          ? `<tr class="team-builder-set-row"><td colspan="8"><div id="team-builder-set-details-root"></div></td></tr>`
          : ""
      }
    `;
  }

  function renderSelectedSetDetails() {
    const detailsRoot = app.querySelector("#team-builder-set-details-root");
    if (!detailsRoot) return;

    const selected = getSelectedTeamChoice();

    if (!selected) {
      detailsRoot.innerHTML = "";
      return;
    }

    renderMovesetPanel(detailsRoot, {
      selectedPokemonName: selected.name,
      movesetEntry: setDetails.getDetail(),
      lookupLabel: setDetails.getDetail()
        ? setDetails.describeSource(setDetails.getDetail())
        : "",
      aggregate: state.selection === "all",
      stitched: Boolean(setDetails.getDetail()?.stitched),
      status: setDetails.getStatus(),
    });

    if (setDetails.getMessage()) {
      detailsRoot.insertAdjacentHTML(
        "afterbegin",
        `<section class="panel"><p class="muted">${escapeHtml(setDetails.getMessage())}</p></section>`,
      );
    }
  }

  function getSelectedTeamChoice() {
    const selectedPokemonId = setDetails.getSelectedPokemonId();

    if (!selectedPokemonId || !state.result?.team?.length) return null;

    return (
      state.result.team.find((row) => row.pokemonId === selectedPokemonId) ||
      null
    );
  }

  function getFormatLabel(formatId) {
    return (
      formatsIndex.find((format) => format.id === formatId)?.label || formatId
    );
  }

  function getSortedTeam(team, sortBy, sortDir = "desc") {
    const rows = [...team];
    const direction = sortDir === "asc" ? 1 : -1;

    rows.sort((a, b) => {
      let primary = 0;

      if (sortBy === "lead") {
        primary = compareNumber(a.bundle?.leads?.value, b.bundle?.leads?.value);
      } else if (sortBy === "usage") {
        primary = compareNumber(a.bundle?.usage?.value, b.bundle?.usage?.value);
      } else if (sortBy === "score") {
        primary = compareNumber(a.score, b.score);
      } else if (sortBy === "input") {
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
    const safeA = typeof a === "number" ? a : -Infinity;
    const safeB = typeof b === "number" ? b : -Infinity;

    return safeA === safeB ? 0 : safeA - safeB;
  }

  function getSortLabel(sortBy, sortDir = "desc") {
    const direction = sortDir === "asc" ? "ascending" : "descending";

    if (sortBy === "lead") return `Lead % ${direction}`;
    if (sortBy === "usage") return `Usage % ${direction}`;
    if (sortBy === "score") return `optimizer score ${direction}`;
    if (sortBy === "input") return `input name ${direction}`;

    return `Pokémon name ${direction}`;
  }

  function renderUnresolved(unresolved = []) {
    if (!unresolved.length) return "";

    return `
      <section class="panel">
        <h2>Unresolved inputs</h2>
        <p class="muted">${unresolved.map((line) => escapeHtml(line.inputName)).join(", ")}</p>
      </section>
    `;
  }

  function renderSource(source) {
    if (!source) return "";

    const label =
      formatsIndex.find((format) => format.id === source.formatId)?.label ||
      source.formatId;

    return source.selection === "all"
      ? `${escapeHtml(label)} @ ${source.cutoff} (${source.monthsPresent}/${source.monthsAvailable} mo)`
      : `${escapeHtml(label)} @ ${source.cutoff}`;
  }

  function bindEvents() {
    app
      .querySelector("#family-input")
      ?.addEventListener("change", async (event) => {
        state.family = event.target.value;
        setDetails.cancel();
        await computeAndRender();
      });

    app
      .querySelector("#selection-input")
      ?.addEventListener("change", async (event) => {
        state.selection = event.target.value;
        setDetails.cancel();
        await computeAndRender();
      });

    app.querySelectorAll("[data-team-sort]").forEach((button) => {
      button.addEventListener("click", () => {
        const nextSort = button.dataset.teamSort;

        if (state.teamSort === nextSort) {
          state.teamSortDir = state.teamSortDir === "asc" ? "desc" : "asc";
        } else {
          state.teamSort = nextSort;
          state.teamSortDir =
            nextSort === "name" || nextSort === "input" ? "asc" : "desc";
        }

        saveTeamSort(state.teamSort);
        saveTeamSortDir(state.teamSortDir);
        writeUrl();
        render();
      });
    });

    app.querySelectorAll("[data-pool-set-id]").forEach((row) => {
      row.addEventListener("click", () => {
        setDetails.select(row.dataset.poolSetId);
      });
    });

    app
      .querySelector("#pool-query-input")
      ?.addEventListener("input", (event) => {
        state.query = event.target.value;

        const saved = savePool(state.query);

        state.result = null;
        setDetails.cancel();

        state.statusMessage = saved
          ? "Saved locally"
          : "Not saved locally; browser storage is full.";

        writeUrl();
        updatePoolStatusMessage(state.statusMessage);
      });

    app
      .querySelector("#optimize-button")
      ?.addEventListener("click", async () => {
        await computeAndRender();
      });

    app
      .querySelector("#copy-pool-button")
      ?.addEventListener("click", async () => {
        await copyPool();
      });

    app.querySelector("#clear-pool-button")?.addEventListener("click", () => {
      const confirmed = window.confirm(
        "Clear the saved owned Pokémon pool from this browser?",
      );
      if (!confirmed) return;

      state.query = "";
      state.result = null;
      state.statusMessage = "Saved pool cleared";

      setDetails.cancel();
      removeLocalStorage(POOL_STORAGE_KEY);
      writeUrl();
      render();
    });
  }

  async function copyPool() {
    const text = state.query.trim();

    if (!text) {
      state.statusMessage = "Nothing to copy";
      render();
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      state.statusMessage = "Copied pool to clipboard";
    } catch {
      state.statusMessage = "Clipboard copy failed";
    }

    render();
  }

  function updatePoolStatusMessage(message) {
    const statusNode = app.querySelector("[data-pool-status]");
    if (statusNode) statusNode.textContent = message || "";
  }

  function getOptimizationSummary(result) {
    if (!result) return "";

    return `Optimized ${result.team.length} picks from ${result.linesConsidered} resolved inputs.`;
  }

  function writeUrl() {
    if (embedded) return;

    const params = new URLSearchParams();
    params.set("family", state.family);
    params.set("selection", state.selection);
    params.set("teamSort", state.teamSort);
    params.set("teamSortDir", state.teamSortDir);

    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}?${params.toString()}`,
    );
  }
}

export function savePool(value) {
  return writeLocalStorage(POOL_STORAGE_KEY, value);
}

export function loadSavedPool() {
  return readLocalStorage(POOL_STORAGE_KEY, "");
}

function saveTeamSort(value) {
  writeLocalStorage(TEAM_SORT_STORAGE_KEY, value);
}

function loadSavedTeamSort() {
  return readLocalStorage(TEAM_SORT_STORAGE_KEY, "");
}

function saveTeamSortDir(value) {
  writeLocalStorage(TEAM_SORT_DIR_STORAGE_KEY, value);
}

function loadSavedTeamSortDir() {
  return readLocalStorage(TEAM_SORT_DIR_STORAGE_KEY, "");
}

function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function baseUrl() {
  return import.meta.env.BASE_URL || "/";
}

function waitForPaint() {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );
}

function formatPercent(value) {
  return typeof value === "number" ? value.toFixed(2) : "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
