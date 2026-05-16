import { loadAvailability, loadFormatsIndex, loadPokemonIndex } from "./data";
import { renderTeamBuilderPage } from "./teamBuilder/teamBuilderView";
import { createTeamBuilderSetDetailsLoader } from "./teamBuilder/setDetailsLoader";
import { getPoolStats, normalizePoolText } from "./teamBuilder/poolParsing";
import { optimizeTeamFromPool } from "./teamBuilder/teamOptimizer";
import {
  clearSavedRebornProgression,
  loadSavedRebornProgression,
  saveRebornProgression,
  setRebornProgressionOptions,
  updateRebornProgressionField,
  updateRebornProgressionOption,
} from "./reborn/progression";
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
    progression: loadSavedRebornProgression(),
    teamSort: getParam("teamSort") || loadSavedTeamSort() || "lead",
    teamSortDir: getParam("teamSortDir") || loadSavedTeamSortDir() || "desc",
    result: null,
    loading: false,
    statusMessage: "",
  };

  const setDetails = createTeamBuilderSetDetailsLoader({
    getFamily: () => state.family,
    getSelection: () => state.selection,
    onUpdate: () => render(),
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
    renderTeamBuilderPage({
      app,
      baseUrl: baseUrl(),
      embedded,
      familyLabel: state.family === "doubles" ? "Doubles" : "Singles",
      formatsIndex,
      poolStats: getPoolStats(state.query, pokemonIndex),
      setDetails,
      state,
    });

    bindEvents();
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

    app.querySelectorAll("[data-progression-field]").forEach((control) => {
      const eventName = control.type === "checkbox" ? "change" : "input";

      control.addEventListener(eventName, () => {
        state.progression = updateRebornProgressionField(
          state.progression,
          control.dataset.progressionField,
          control.type === "checkbox" ? control.checked : control.value,
        );

        const saved = saveRebornProgression(state.progression);

        updateProgressionStatusMessage(
          saved
            ? "Progression saved locally"
            : "Progression could not be saved locally; browser storage is full.",
        );
      });
    });

    app.querySelectorAll("[data-progression-option-list]").forEach((control) => {
      control.addEventListener("change", () => {
        state.progression = updateRebornProgressionOption(
          state.progression,
          control.dataset.progressionOptionList,
          control.value,
          control.checked,
        );

        const saved = saveRebornProgression(state.progression);

        updateProgressionStatusMessage(
          saved
            ? "Progression saved locally"
            : "Progression could not be saved locally; browser storage is full.",
        );

        render();
      });
    });

    app.querySelectorAll("[data-progression-option-bulk]").forEach((button) => {
      button.addEventListener("click", () => {
        const field = button.dataset.progressionOptionBulk;
        const action = button.dataset.progressionOptionAction;
        const optionIds =
          action === "select"
            ? String(button.dataset.progressionOptionIds || "")
                .split(",")
                .filter(Boolean)
            : [];

        state.progression = setRebornProgressionOptions(
          state.progression,
          field,
          optionIds,
        );

        const saved = saveRebornProgression(state.progression);

        updateProgressionStatusMessage(
          saved
            ? "Progression saved locally"
            : "Progression could not be saved locally; browser storage is full.",
        );

        render();
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

    app
      .querySelector("#clear-progression-button")
      ?.addEventListener("click", () => {
        const confirmed = window.confirm(
          "Clear saved Reborn progression from this browser?",
        );
        if (!confirmed) return;

        clearSavedRebornProgression();
        state.progression = loadSavedRebornProgression();
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

  function updateProgressionStatusMessage(message) {
    const statusNode = app.querySelector("[data-progression-status]");
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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
