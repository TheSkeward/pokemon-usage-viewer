import { escapeHtml } from "./utils/html.js";
import { loadAvailability, loadFormatsIndex, loadPokemonIndex } from "./data";
import {
  getSortedTeam,
  renderGamestateStrip,
  renderTeamBuilderPage,
} from "./teamBuilder/teamBuilderView";
import { createTeamBuilderSetDetailsLoader } from "./teamBuilder/setDetailsLoader";
import { getPoolStats, normalizePoolText } from "./teamBuilder/poolParsing";
import { optimizeTeamFromPool } from "./teamBuilder/teamOptimizer";
import { computeTeamConfidence } from "./teamBuilder/confidence.js";
import { computeInvestmentPlan } from "./teamBuilder/investment.js";
import { setScoringOverrides } from "./teamBuilder/scoringConstants.js";
import {
  buildPerformanceReport,
  estimateRunBudget,
  recordOptimizerSample,
} from "./teamBuilder/telemetry.js";
import { loadManifest } from "./manifest.js";
import { renderRebornLegalMovesPanel } from "./reborn/legalMovesView";
import { renderRebornTeamAnalysisPanel } from "./reborn/teamAnalysisView";
import { getCurrentRebornSpeciesForChoice } from "./reborn/currentSpecies.js";
import {
  clearSavedRebornProgression,
  loadSavedRebornProgression,
  saveRebornProgression,
  setRebornOpponentTypeBias,
  setRebornOwnedItemCount,
  setRebornProgressionOptions,
  updateRebornProgressionField,
  updateRebornProgressionOption,
} from "./reborn/progression";
import { toId } from "./utils/ids.js";
import { bindPersistentDetails } from "./utils/detailsState.js";
import { setPoolLayout } from "./utils/layoutPreference.js";
import { GEN7_HELD_ITEMS_BY_ID } from "./generated/gen7HeldItems.generated.js";
import {
  REBORN_EXTRA_INVENTORY_ITEMS,
  getEvolutionItemIds,
} from "./reborn/itemAvailability.js";
import { HIDDEN_INVENTORY_ITEM_IDS } from "./reborn/rebornSeeds";
import { buildPoolAvailabilityText } from "./teamBuilder/availabilityExport";
import {
  assignTeamItems,
  loadTeamItemUsage,
} from "./teamBuilder/itemRecommendations";
import { getTeamItemContext } from "./reborn/teamAnalysis";
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
    resultProgressionKey: "",
    loading: false,
    statusMessage: "",
    availabilityText: "",
    teamItemUsage: null,
    teamItemContext: null,
    itemRecommendations: {},
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
    // Provenance for the debug footer (which data produced these verdicts).
    loadManifest().then((manifest) => {
      state.manifest = manifest;
    });

    if (initialQuery.trim()) {
      savePool(initialQuery);
      await computeAndRender();
    } else {
      render();
    }
  }

  async function computeAndRender({ exhaustive = true } = {}) {
    setDetails.cancel();

    state.loading = true;
    state.statusMessage = "Optimizing pool...";
    render();
    startOptimizeProgress(getPoolStats(state.query, pokemonIndex).uniqueCount);
    await waitForPaint();

    // User-perceived pipeline clock: everything between "click" and the team
    // being on screen counts, not just the optimizer core (a 44s wait once
    // reported itself as 2.9s because item loading and rendering were
    // unmeasured). Recorded into telemetry when post-analysis completes.
    const pipelineStart = Date.now();
    const phases = {};

    try {
      state.query = normalizePoolText(state.query, pokemonIndex);

      const saved = savePool(state.query);

      state.result = await optimizeTeamFromPool({
        availability,
        family: state.family,
        pokemonIndex,
        progression: state.progression,
        query: state.query,
        selection: state.selection,
        onProgress: updateOptimizeProgress,
        // The explicit Optimize button (and other direct triggers) run an exact
        // search; only background auto-reoptimize accepts the fast approximation
        // when the pool is too large to enumerate exactly.
        exhaustive,
      });
      state.resultProgressionKey = getProgressionKey(state.progression);
      const meta = state.result.telemetryMeta;
      if (meta) {
        phases.setup = meta.setupMs;
        phases.resolve = meta.resolveMs;
        phases.search = meta.searchMs;
      }

      // Resolve each member's recommended-move types + real top-set ability once,
      // so gem item recommendations can be gated (type must match a recommended
      // move; Unburden boost only when Unburden is actually the set's ability).
      updateOptimizeProgress({ phase: "items" });
      const itemsStart = Date.now();
      state.teamItemContext = await getTeamItemContext(
        state.result.team,
        state.progression,
        {
          family: state.family,
          selection: state.selection,
          pokemonIndex,
          query: state.query,
        },
      );
      state.teamItemUsage = await loadTeamItemUsage({
        team: state.result.team,
        family: state.family,
        selection: state.selection,
        itemContext: state.teamItemContext,
      });
      recomputeItemRecommendations();
      phases.items = Date.now() - itemsStart;

      setDetails.cancel();

      stopOptimizeProgress();
      state.loading = false;
      const approxNote = state.result.searchExact
        ? ""
        : " Pool too large for an exact search — used a fast approximate one.";
      state.statusMessage = saved
        ? `${getOptimizationSummary(state.result)}${approxNote}`
        : `${getOptimizationSummary(state.result)}${approxNote} Pool could not be saved locally; browser storage is full.`;

      writeUrl();
      const renderStart = Date.now();
      const handle = render();
      phases.render = Date.now() - renderStart;
      const totalMs = Date.now() - pipelineStart;

      // First-class confidence + investment analysis, computed AFTER the team
      // renders so "click optimize" stays snappy; each re-renders when it lands
      // (guarded against a newer optimize having replaced the result).
      void runPostAnalysis(state.result, {
        pipelineStart,
        phases,
        totalMs,
        // The Team Analysis (movesets) panel fills asynchronously — the sweep
        // must not start until it's on screen (it starves the main thread).
        analysisPanelReady: handle?.analysisPanelReady || null,
      });
    } catch (error) {
      console.error("Team Builder optimization failed", error);

      stopOptimizeProgress();
      state.loading = false;
      state.result = null;
      state.statusMessage = `Optimization failed: ${error?.message || error}`;

      setDetails.cancel();
      render();
    }
  }

  // Confidence sweep + investment plan, run after each optimize. The sweep sets
  // global scoring overrides around synchronous blocks only; still, a user
  // optimize started mid-sweep aborts the sweep (checked between settings via
  // the result-identity guard) and clears overrides defensively.
  async function runPostAnalysis(forResult, pipeline = null) {
    state.confidence = null;
    state.investment = null;
    state.analysisPending = true;
    const pendingHandle = render();
    let superseded = false;
    try {
      // Wait for the movesets (Team Analysis panel) to land before starting
      // the sweep: its settings run as long synchronous blocks that starve
      // every pending async continuation — measured on a 65-mon pool, the
      // panel the user is actually reading appeared ~40s late behind the
      // sweep. The panel build is memoized, so awaiting THIS render's handle
      // is the same build computeAndRender kicked off. Bounded so a wedged
      // panel can never block the analysis.
      const panelReady =
        pendingHandle?.analysisPanelReady ||
        pipeline?.analysisPanelReady ||
        null;
      if (panelReady) {
        await Promise.race([
          panelReady.catch(() => {}),
          new Promise((resolve) => setTimeout(resolve, 20_000)),
        ]);
        if (pipeline) {
          pipeline.movesetMs = Date.now() - pipeline.pipelineStart;
        }
        if (state.result !== forResult) {
          superseded = true;
          return;
        }
      }

      const confidenceStart = Date.now();
      const confidence = await computeTeamConfidence({
        result: forResult,
        availability,
        family: state.family,
        progression: state.progression,
      });
      if (state.result !== forResult) {
        superseded = true; // superseded by a newer optimize
        return;
      }
      if (pipeline) pipeline.phases.confidence = Date.now() - confidenceStart;
      state.confidence = confidence;
      render();

      const investmentStart = Date.now();
      const investment = await computeInvestmentPlan({
        availability,
        family: state.family,
        pokemonIndex,
        progression: state.progression,
        query: state.query,
        selection: state.selection,
        result: forResult,
      });
      if (state.result !== forResult) {
        superseded = true;
        return;
      }
      if (pipeline) pipeline.phases.investment = Date.now() - investmentStart;
      state.investment = investment;
    } catch (error) {
      console.warn("Post-analysis failed", error);
    } finally {
      setScoringOverrides(null);
      if (state.result === forResult) {
        state.analysisPending = false;
        // One telemetry sample per completed interactive pipeline: optimizer
        // phases from telemetryMeta, item/render/analysis phases measured
        // here. Superseded runs are dropped — partial timings would skew the
        // distributions. Recorded before the final render so the footer's
        // numbers include this run.
        if (pipeline && !superseded && forResult.telemetryMeta) {
          const meta = forResult.telemetryMeta;
          try {
            recordOptimizerSample({
              cache: meta.cache,
              resolveMs: meta.resolveMs,
              searchMs: meta.searchMs,
              poolSize: meta.poolSize,
              builds: meta.builds,
              dataSignature: meta.dataSignature,
              phases: pipeline.phases,
              totalMs: pipeline.totalMs,
              movesetMs: pipeline.movesetMs ?? null,
              fullMs: Date.now() - pipeline.pipelineStart,
            });
          } catch {
            // Telemetry must never break the pipeline.
          }
        }
        render();
      }
    }
  }

  // After a progression change that invalidates the optimized team, re-run the
  // optimizer automatically. Debounced so rapid edits — typing a level cap,
  // dragging a bias slider, toggling several TMs — settle into one re-optimize.
  const AUTO_REOPTIMIZE_DELAY_MS = 600;
  let autoReoptimizeTimer = null;

  function scheduleAutoReoptimize(stale) {
    if (!stale || !state.result || !state.query.trim()) return;

    if (autoReoptimizeTimer) clearTimeout(autoReoptimizeTimer);
    autoReoptimizeTimer = setTimeout(() => {
      autoReoptimizeTimer = null;
      if (state.loading) {
        scheduleAutoReoptimize(true);
        return;
      }
      void computeAndRender({ exhaustive: false });
    }, AUTO_REOPTIMIZE_DELAY_MS);
  }

  function render() {
    state.resultProgressionStale = markResultProgressionStale();

    const handle = renderTeamBuilderPage({
      app,
      baseUrl: baseUrl(),
      embedded,
      familyLabel: state.family === "doubles" ? "Doubles" : "Singles",
      formatsIndex,
      pokemonIndex,
      poolStats: getPoolStats(state.query, pokemonIndex),
      setDetails,
      state,
    });

    bindEvents();
    return handle;
  }

  function bindEvents() {
    // <details> groups (evolution access, TMs, items…) re-render on every
    // optimizer run; persist the user's open/closed toggles across renders.
    bindPersistentDetails(app);

    // A/B layout switch (persisted): re-render the same state in the other
    // composition.
    app.querySelector("#layout-select")?.addEventListener("change", (event) => {
      setPoolLayout(event.target.value);
      render();
    });

    // Gamestate-strip chips: open (and scroll to) the control that changes
    // the clicked assumption — the collapsed progression panel, one of its
    // groups, or the bias group wherever the layout put it. Delegated (bound
    // once per widget) because light progression edits replace the strip's
    // DOM in place without a full re-render.
    if (!app.__gamestateChipsDelegated) {
      app.__gamestateChipsDelegated = true;
      app.addEventListener("click", (event) => {
        const chipButton = event.target.closest("[data-open-progression]");
        if (!chipButton || !app.contains(chipButton)) return;
        const targetId = chipButton.dataset.openProgression;
        const wrapper = app.querySelector(
          'details[data-details-id="progression-panel"]',
        );
        const target = targetId
          ? app.querySelector(`details[data-details-id="${targetId}"]`)
          : null;
        if (wrapper && (!target || wrapper.contains(target))) {
          wrapper.open = true;
        }
        if (target) target.open = true;
        (target || wrapper)?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    }

    // "moves ↓" on a team row: jump to that pick's set card in Team Analysis
    // (the row's own click keeps opening the inline usage-set details).
    app.querySelectorAll("[data-jump-set-card]").forEach((jumpButton) => {
      jumpButton.addEventListener("click", (event) => {
        event.stopPropagation();
        const card =
          app.querySelector(
            `[data-set-card="${jumpButton.dataset.jumpSetCard}"]`,
          ) || app.querySelector("#reborn-team-analysis-root");
        card?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    });

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

        if (
          control.dataset.progressionField === "levelCap" &&
          control.value !== state.progression.levelCap
        ) {
          control.value = state.progression.levelCap;
        }

        const saved = saveRebornProgression(state.progression);
        const stale = markResultProgressionStale();

        updateProgressionStatusMessage(
          saved
            ? getProgressionSavedMessage(stale)
            : "Progression could not be saved locally; browser storage is full.",
        );

        refreshSelectedLegalMovesPanel();
        refreshTeamAnalysisPanel();
        refreshOptimizedTeamProgressionState(stale);
        refreshGamestateStrip();
        scheduleAutoReoptimize(stale);
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
        const stale = markResultProgressionStale();

        updateProgressionStatusMessage(
          saved
            ? getProgressionSavedMessage(stale)
            : "Progression could not be saved locally; browser storage is full.",
        );

        render();
        scheduleAutoReoptimize(stale);
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
        const stale = markResultProgressionStale();

        updateProgressionStatusMessage(
          saved
            ? getProgressionSavedMessage(stale)
            : "Progression could not be saved locally; browser storage is full.",
        );

        render();
        scheduleAutoReoptimize(stale);
      });
    });

    app.querySelector("[data-item-add-button]")?.addEventListener("click", () => {
      const input = app.querySelector("[data-item-add-input]");
      const itemId = toId(input?.value || "");
      const knownExtra = REBORN_EXTRA_INVENTORY_ITEMS.some(
        (item) => item.id === itemId,
      );

      if (!itemId || (!GEN7_HELD_ITEMS_BY_ID[itemId] && !knownExtra)) {
        updateProgressionStatusMessage(
          "Item not recognized; pick one from the suggestions.",
        );
        return;
      }

      if (HIDDEN_INVENTORY_ITEM_IDS.has(itemId)) {
        updateProgressionStatusMessage(
          "That terrain seed is replaced in Reborn — use the matching field seed instead.",
        );
        return;
      }

      const current = state.progression.ownedItems?.[itemId] || 0;
      applyOwnedItemChange(itemId, current + 1);
      if (input) input.value = "";
    });

    app.querySelectorAll("[data-owned-item-count]").forEach((control) => {
      control.addEventListener("change", () => {
        applyOwnedItemChange(control.dataset.itemId, control.value);
      });
    });

    app.querySelectorAll("[data-bias-type]").forEach((control) => {
      // Update the value readout live while dragging without re-rendering (which
      // would drop slider focus), then commit on release.
      control.addEventListener("input", () => {
        const valueEl = app.querySelector(
          `[data-bias-value="${control.dataset.biasType}"]`,
        );
        if (valueEl) valueEl.textContent = control.value;
      });
      control.addEventListener("change", () => {
        applyOpponentBiasChange(control.dataset.biasType, control.value);
      });
    });

    app.querySelectorAll("[data-owned-item-remove]").forEach((button) => {
      button.addEventListener("click", () => {
        applyOwnedItemChange(button.dataset.itemId, 0);
      });
    });

    app
      .querySelector("#generate-availability-button")
      ?.addEventListener("click", () => {
        void generateAvailabilityList();
      });

    app
      .querySelector("#copy-availability-button")
      ?.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(state.availabilityText || "");
          updatePoolStatusMessage("Availability list copied to clipboard");
        } catch {
          updatePoolStatusMessage("Clipboard copy failed");
        }
      });

    app
      .querySelector("#close-availability-button")
      ?.addEventListener("click", () => {
        state.availabilityText = "";
        render();
      });

    app
      .querySelector("#pool-query-input")
      ?.addEventListener("input", (event) => {
        state.query = event.target.value;

        const saved = savePool(state.query);

        state.result = null;
        state.resultProgressionKey = "";
        state.availabilityText = "";
        state.teamItemUsage = null;
        state.teamItemContext = null;
        state.itemRecommendations = {};
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

    app
      .querySelector("#copy-perf-report-button")
      ?.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(
            JSON.stringify(buildPerformanceReport(), null, 2),
          );
          updatePoolStatusMessage("Performance report copied to clipboard");
        } catch {
          updatePoolStatusMessage("Clipboard copy failed");
        }
      });

    app.querySelector("#clear-pool-button")?.addEventListener("click", () => {
      const confirmed = window.confirm(
        "Clear the saved owned Pokémon pool from this browser?",
      );
      if (!confirmed) return;

      state.query = "";
      state.result = null;
      state.resultProgressionKey = "";
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

  function applyOwnedItemChange(itemId, count) {
    state.progression = setRebornOwnedItemCount(
      state.progression,
      itemId,
      count,
    );

    const saved = saveRebornProgression(state.progression);
    state.statusMessage = saved
      ? "Saved locally"
      : "Held items could not be saved locally; browser storage is full.";

    recomputeItemRecommendations();
    render();
  }

  function applyOpponentBiasChange(type, level) {
    state.progression = setRebornOpponentTypeBias(
      state.progression,
      type,
      level,
    );

    const saved = saveRebornProgression(state.progression);
    const stale = markResultProgressionStale();

    updateProgressionStatusMessage(
      saved
        ? getProgressionSavedMessage(stale)
        : "Progression could not be saved locally; browser storage is full.",
    );

    // Bias only affects optimization, so flag the current team stale; no
    // re-render (keeps slider focus during a drag).
    refreshOptimizedTeamProgressionState(stale);
    refreshGamestateStrip();
    scheduleAutoReoptimize(stale);
  }

  // Light progression edits (level cap typing, bias drags) deliberately skip
  // the full re-render; keep the modern layout's gamestate strip honest by
  // rebuilding just its chips in place. Chip clicks stay live because their
  // handler is delegated to the widget root.
  function refreshGamestateStrip() {
    const strip = app.querySelector(".gamestate-strip");
    if (strip) strip.outerHTML = renderGamestateStrip(state.progression);
  }

  function recomputeItemRecommendations() {
    if (!state.teamItemUsage || !state.result?.team?.length) {
      state.itemRecommendations = {};
      return;
    }

    state.itemRecommendations = assignTeamItems({
      team: state.result.team,
      usageByMember: state.teamItemUsage,
      ownedItems: state.progression.ownedItems,
      itemContext: state.teamItemContext,
    });
  }

  async function generateAvailabilityList() {
    if (!state.result?.lines?.length) {
      state.statusMessage =
        "Optimize the team first so your pool is resolved, then generate the list.";
      render();
      return;
    }

    updatePoolStatusMessage("Generating availability list…");

    try {
      const text = await buildPoolAvailabilityText({
        lines: state.result.lines,
        progression: state.progression,
      });

      state.availabilityText = text;

      let copied = false;
      try {
        await navigator.clipboard.writeText(text);
        copied = true;
      } catch {
        copied = false;
      }

      state.statusMessage = copied
        ? "Availability list copied to clipboard"
        : "Availability list ready below";

      render();
    } catch (error) {
      updatePoolStatusMessage(
        `Could not generate list: ${error?.message || error}`,
      );
    }
  }

  // Adaptive optimize progress: the bar spans the WHOLE optimizer window using
  // per-phase time budgets estimated from this browser's telemetry history for
  // this pool size (static defaults on the very first run). Countable work
  // (line scoring) advances by real fraction; time-only phases (the search)
  // advance by elapsed-vs-budget with an asymptotic tail — so the bar keeps
  // moving through the slow part instead of parking at 100% and pulsing.
  // Width = elapsed / (elapsed + estimated remaining), capped at 97% until the
  // run actually finishes; monotone because the remaining estimate only
  // shrinks. A ticker repaints during phases that emit no progress events.
  let optimizeProgress = null;

  function startOptimizeProgress(poolSize) {
    stopOptimizeProgress();
    optimizeProgress = {
      start: Date.now(),
      phase: "resolve",
      phaseStart: Date.now(),
      completed: 0,
      total: poolSize || 0,
      budget: estimateRunBudget(poolSize),
      timer: setInterval(paintOptimizeProgress, 150),
    };
    paintOptimizeProgress();
  }

  function stopOptimizeProgress() {
    if (optimizeProgress?.timer) clearInterval(optimizeProgress.timer);
    optimizeProgress = null;
  }

  function paintOptimizeProgress() {
    const model = optimizeProgress;
    const bar = app.querySelector("[data-optimize-progress-bar]");
    if (!model || !bar) return;

    const now = Date.now();
    const elapsed = now - model.start;
    const phaseElapsed = now - model.phaseStart;
    const budget = model.budget;
    let remaining;
    if (model.phase === "resolve") {
      const fraction = model.total ? model.completed / model.total : 0;
      remaining =
        budget.resolveMs * (1 - fraction) + budget.searchMs + budget.tailMs;
    } else if (model.phase === "search") {
      // Past its budget the remaining floor keeps the bar creeping (asymptote)
      // rather than lying about being done.
      remaining =
        Math.max(budget.searchMs - phaseElapsed, budget.searchMs * 0.08) +
        budget.tailMs;
    } else {
      remaining = Math.max(budget.tailMs - phaseElapsed, 120);
    }
    const fraction = Math.min(
      0.97,
      elapsed / (elapsed + Math.max(remaining, 1)),
    );
    bar.style.width = `${(fraction * 100).toFixed(1)}%`;
    // Running far past the search budget: pulse to say "still working" —
    // the estimate was wrong, not the run dead.
    const late =
      model.phase === "search" && phaseElapsed > 2 * budget.searchMs;
    bar.style.animation = late
      ? "pool-progress-pulse 1.2s ease-in-out infinite"
      : "";
  }

  function updateOptimizeProgress({ phase = "resolve", completed, total }) {
    const label = app.querySelector("[data-optimize-progress-label]");
    if (label) {
      label.textContent =
        phase === "search"
          ? "Searching team combinations..."
          : phase === "items"
            ? "Loading item usage for the team..."
            : total
              ? `Scoring ${completed}/${total} Pokémon...`
              : "Optimizing pool...";
    }
    if (optimizeProgress) {
      if (phase !== optimizeProgress.phase) {
        optimizeProgress.phase = phase;
        optimizeProgress.phaseStart = Date.now();
      }
      if (phase === "resolve") {
        optimizeProgress.completed = completed || 0;
        if (total) optimizeProgress.total = total;
      }
      paintOptimizeProgress();
    }
  }

  function updatePoolStatusMessage(message) {
    const statusNode = app.querySelector("[data-pool-status]");
    if (statusNode) statusNode.textContent = message || "";
  }

  function updateProgressionStatusMessage(message) {
    const statusNode = app.querySelector("[data-progression-status]");
    if (statusNode) statusNode.textContent = message || "";
  }

  function refreshSelectedLegalMovesPanel() {
    const legalMovesRoot = app.querySelector("[data-reborn-legal-moves-root]");
    const selected = getSelectedTeamChoice();

    if (!legalMovesRoot || !selected) return;

    renderRebornLegalMovesPanel(legalMovesRoot, {
      currentSpecies: getCurrentSpeciesForSelected(selected),
      movesetEntry: setDetails.getDetail(),
      pokemonIndex,
      poolQuery: state.query,
      pokemonId: selected.pokemonId,
      pokemonName: selected.name,
      progression: state.progression,
    });
  }

  function refreshTeamAnalysisPanel() {
    renderRebornTeamAnalysisPanel(app.querySelector("#reborn-team-analysis-root"), {
      family: state.family,
      itemAssignments: state.itemRecommendations,
      pokemonIndex,
      poolQuery: state.query,
      progression: state.progression,
      selection: state.selection,
      team: getSortedTeam(
        state.result?.team || [],
        state.teamSort,
        state.teamSortDir,
        state.progression,
      ),
    });
  }

  function refreshOptimizedTeamProgressionState(stale) {
    state.resultProgressionStale = stale;

    const warning = app.querySelector("[data-progression-stale-warning]");
    if (warning) warning.hidden = !stale;

    app.querySelectorAll("[data-team-note]").forEach((noteNode) => {
      const row = getTeamChoiceForRow(noteNode.closest("[data-team-pokemon-id]"));
      noteNode.textContent = stale
        ? "Progression changed; re-optimize for current scores and legal move notes."
        : row?.note || "";
    });

    app.querySelectorAll("[data-team-pokemon-id]").forEach((rowNode) => {
      const row = getTeamChoiceForRow(rowNode);
      const noteNode = rowNode.querySelector("[data-current-species-note]");
      if (!row || !noteNode) return;

      const currentSpecies = getCurrentRebornSpeciesForChoice(row, state.progression);
      const showCurrent = Boolean(currentSpecies?.differsFromRepresentative);

      noteNode.hidden = !showCurrent;
      noteNode.textContent = showCurrent ? `Current: ${currentSpecies.name}` : "";
    });
  }

  function getSelectedTeamChoice() {
    const selectedPokemonId = setDetails.getSelectedPokemonId();

    if (!selectedPokemonId || !state.result?.team?.length) return null;

    return (
      state.result.team.find((row) => row.pokemonId === selectedPokemonId) ||
      null
    );
  }

  function getTeamChoiceForRow(rowNode) {
    if (!rowNode) return null;

    const inputId = rowNode.dataset.teamInputId;
    const pokemonId = rowNode.dataset.teamPokemonId;

    if (!inputId || !pokemonId || !state.result?.team?.length) return null;

    return (
      state.result.team.find(
        (row) => row.inputPokemonId === inputId && row.pokemonId === pokemonId,
      ) || null
    );
  }

  function getCurrentSpeciesForSelected(selected) {
    return selected
      ? getCurrentRebornSpeciesForChoice(selected, state.progression)
      : null;
  }

  function getOptimizationSummary(result) {
    if (!result) return "";

    return `Optimized ${result.team.length} picks from ${result.linesConsidered} resolved inputs.`;
  }

  function markResultProgressionStale() {
    return Boolean(
      state.result &&
        state.resultProgressionKey &&
        state.resultProgressionKey !== getProgressionKey(state.progression),
    );
  }

  function getProgressionSavedMessage(stale) {
    return stale
      ? "Progression saved locally. Re-optimize to update team picks."
      : "Progression saved locally";
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
  return new Promise((resolve) => {
    const fallback = setTimeout(resolve, 100);

    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        clearTimeout(fallback);
        resolve();
      }),
    );
  });
}

function getProgressionKey(progression) {
  // Ordinary owned items drive item recommendations (recomputed every render),
  // not the team optimization, so they must not flag an optimized team as
  // stale. Owned EVOLUTION items are the exception: they zero evolution
  // friction and override access gates, so adding/removing one must
  // re-optimize.
  const { ownedItems, ...rest } = progression || {};
  const evolutionItems = {};
  for (const id of getEvolutionItemIds()) {
    if (ownedItems?.[id] > 0) evolutionItems[id] = true;
  }
  return JSON.stringify({ ...rest, evolutionItems });
}

