import { escapeHtml, escapeAttr } from "../utils/html.js";
import { gamesToLikelySee } from "./traceUsage.js";
import { renderMovesetPanel } from "../views/movesetView";
import { renderRebornLegalMovesPanel } from "../reborn/legalMovesView";
import {
  renderRebornProgressionPanel,
  renderOpponentTypeBias,
} from "../reborn/progressionView";
import { detailsStateAttrs } from "../utils/detailsState.js";
import { EVOLUTION_ACCESS_FIELDS } from "../reborn/evolutionRequirements.js";
import {
  getRebornCheckpoint,
  getRebornCheckpointShortLabel,
} from "../reborn/badgeTimeline.js";
import { renderRebornTeamAnalysisPanel } from "../reborn/teamAnalysisView";
import { getCurrentRebornSpeciesForChoice } from "../reborn/currentSpecies.js";
import { describeEvolutionPath } from "../reborn/evolutionRequirements.js";
import { teamMemberKey } from "./itemRecommendations";
import {
  explainSeatedChoice,
  explainExcludedChoice,
} from "./explanations.js";
import { getTelemetrySummary, loadTelemetrySamples } from "./telemetry.js";

export function renderTeamBuilderPage({
  app,
  baseUrl,
  embedded,
  familyLabel,
  formatsIndex,
  pokemonIndex,
  poolStats,
  setDetails,
  state,
}) {
  // Ordered for playthrough cadence: results and set cards first, the
  // episodic progression panel collapsed at the bottom, the gamestate strip
  // making every result self-describing, the per-fight opponent bias next to
  // Optimize, and the provenance/performance footer dead last — the average
  // player never needs it.
  app.innerHTML = `
    ${embedded ? "" : renderStandaloneHeader({ baseUrl })}

    ${renderPoolControls({ embedded, poolStats, state })}

    ${renderGamestateStrip(state.progression)}

    ${state.loading ? renderLoading(state) : ""}

    ${state.result ? renderResult({ familyLabel, formatsIndex, setDetails, state }) : renderEmpty(state)}

    <details class="progression-collapse" ${detailsStateAttrs("progression-panel", false)}>
      <summary>Reborn Progression <span class="muted">(level cap, TMs, evolution access, items — the save-file settings)</span></summary>
      ${renderRebornProgressionPanel(state.progression, { includeBias: false })}
    </details>

    ${state.result?.team?.length ? renderProvenanceFooter(state.manifest, state.result) : ""}
  `;

  renderSelectedSetDetails({ app, pokemonIndex, setDetails, state });
  const analysisPanelReady = renderRebornTeamAnalysisPanel(
    app.querySelector("#reborn-team-analysis-root"),
    {
      family: state.family,
      itemAssignments: state.itemRecommendations,
      lines: state.result?.lines || [],
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
    },
  );
  // The Team Analysis (movesets) panel fills asynchronously; callers that
  // schedule heavy post-analysis work wait for this so the sweep never starves
  // the panel the user is actually watching.
  return { analysisPanelReady };
}

function renderStandaloneHeader({ baseUrl }) {
  return `
    <header>
      <h1>Pokémon Pool Team Builder</h1>
    </header>

    <nav class="view-tabs">
      <a class="view-tab" href="${baseUrl}">Main App</a>
    </nav>
  `;
}

// Live numbers instead of a model essay: hovering the Optimize button
// reports how converged THIS run's pool is — the spread of usage trust (w,
// the share of each line's score taken by the usage prior) and how many
// lines are fully there. Before a run there's nothing to report, no tooltip.
function usageTrustTooltip(state) {
  const weights = (state.result?.lines || [])
    .map((line) => (line.best || line.bestNonMega)?.usageWeight)
    .filter((weight) => typeof weight === "number")
    .sort((a, b) => a - b);
  if (!weights.length) return "";
  const fmt = (value) => value.toFixed(2);
  const median = weights[Math.floor(weights.length / 2)];
  const converged = weights.filter((weight) => weight >= 0.99).length;
  return (
    `Usage trust (w) this run: median ${fmt(median)}, ` +
    `range ${fmt(weights[0])}–${fmt(weights[weights.length - 1])} · ` +
    `${converged}/${weights.length} lines fully converged`
  );
}

// One-line, read-only summary of the gamestate a recommendation assumes.
// Every chip opens (and scrolls to) the control that changes it, so "where do
// I change X" is one click, and a stale assumption is visible at a glance.
// Exported so light progression edits (level cap typing, bias drags — which
// deliberately don't re-render the page) can refresh the strip in place.
export function renderGamestateStrip(progression = {}) {
  const chips = [];
  const chip = (label, targetId) =>
    chips.push(
      `<button type="button" class="gamestate-chip" data-open-progression="${escapeAttr(targetId || "")}">${escapeHtml(label)}</button>`,
    );

  const checkpoint = getRebornCheckpoint(progression.checkpoint);
  chip(
    checkpoint
      ? `${getRebornCheckpointShortLabel(checkpoint)} · cap ${progression.levelCap || checkpoint.levelCap}`
      : progression.levelCap
        ? `Cap ${progression.levelCap}`
        : "No badges set",
    "",
  );
  chip(`TMs ${(progression.availableTmIds || []).length}`, "tms");
  chip(`TMXs ${(progression.availableTmxIds || []).length}`, "tmxs");
  chip(`Tutors ${(progression.availableTutorMoveIds || []).length}`, "tutors");

  const blocked = EVOLUTION_ACCESS_FIELDS.filter(
    (field) => progression[field.key] === false,
  );
  chip(
    blocked.length
      ? `Evo access: ${blocked.length} blocked`
      : "Evo access: all",
    "evo-access",
  );

  chip(`Items ${Object.keys(progression.ownedItems || {}).length}`, "items");

  const bias = Object.entries(progression.opponentTypeBias || {}).filter(
    ([, level]) => level > 0,
  );
  chip(
    bias.length
      ? `Bias: ${bias.map(([type, level]) => `${type} ${level}`).join(", ")}`
      : "Bias: —",
    "bias",
  );

  if (progression.moveRelearnerUnlocked) chip("Relearner ✓", "");
  if (progression.daycareUnlocked) chip("Daycare ✓", "");
  if (progression.hiddenPowerTypeChangerUnlocked) chip("HP Changer ✓", "");

  return `
    <div class="gamestate-strip" title="The gamestate this page's scores and legality assume. Click a chip to edit it.">
      ${chips.join("")}
    </div>
  `;
}

function renderPoolControls({ embedded, poolStats, state }) {
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
        <button class="view-tab primary-action" id="optimize-button"${usageTrustTooltip(state) ? ` title="${escapeAttr(usageTrustTooltip(state))}"` : ""}>${state.loading ? "Optimizing..." : "Normalize + optimize team"}</button>
        <button class="view-tab" id="copy-pool-button">Copy pool</button>
        <button class="view-tab" id="export-gamestate-button" title="Download pool + progression + inventory as a JSON backup file. Everything lives in this browser's local storage — one data clear loses it all without a backup.">Export gamestate</button>
        <button class="view-tab" id="import-gamestate-button" title="Restore a downloaded gamestate backup (replaces the current pool and progression).">Import gamestate</button>
        <input type="file" id="import-gamestate-input" accept="application/json,.json" style="display: none" />
        <button class="view-tab" id="generate-availability-button" ${state.result?.lines?.length ? "" : "disabled"} title="${state.result?.lines?.length ? "Generate a pasteable list of every available Pokémon, its current move pool, and your held items" : "Optimize the team first to resolve your pool"}">Generate availability list</button>
        <button class="view-tab danger-button" id="clear-pool-button">Clear saved pool</button>
        <span class="muted" data-pool-status>${escapeHtml(state.statusMessage)}</span>
      </div>

      ${
        // Per-fight lever, so it lives with the per-fight button: set a
        // bias, optimize, fight, clear it.
        renderOpponentTypeBias(state.progression?.opponentTypeBias || {})
      }

      ${renderAvailabilityOutput(state.availabilityText)}
    </section>
  `;
}

function renderAvailabilityOutput(availabilityText) {
  if (!availabilityText) return "";

  return `
    <div class="availability-output">
      <div class="availability-output-header">
        <strong>Availability list</strong>
        <span class="availability-output-actions">
          <button type="button" class="view-tab" id="copy-availability-button">Copy</button>
          <button type="button" class="view-tab" id="close-availability-button">Close</button>
        </span>
      </div>
      <textarea id="availability-output-text" rows="12" readonly>${escapeHtml(availabilityText)}</textarea>
    </div>
  `;
}

function renderLoading(state) {
  return `
    <section class="panel">
      <div class="resolver-loading-banner">
        <span class="spinner-dot"></span>
        <span data-optimize-progress-label>Optimizing pool against precomputed ${escapeHtml(state.family)} set data...</span>
      </div>
      <div class="optimize-progress">
        <div class="optimize-progress-bar" data-optimize-progress-bar style="width:0%"></div>
      </div>
    </section>
  `;
}

function renderEmpty(state) {
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

function renderResult({ familyLabel, formatsIndex, setDetails, state }) {
  const result = state.result;

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
    state.progression,
  );
  const progressionStale = Boolean(state.resultProgressionStale);

  const teamPanel = `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2>Recommended ${escapeHtml(familyLabel)} Team</h2>
          <p>${result.team.length} picks from ${result.linesConsidered} resolved input lines. ${megaText}.</p>
          <p>Scored at level cap ${escapeHtml(String(state.progression?.levelCap || "?"))}: each pick's current-form value plus a readiness-gated competitive ceiling, minus build friction (evolution requirements are shown as information, never priced); the team is chosen with damage-aware coverage and shared-weakness fit, at most one Mega, one build realized per line. Displayed by ${escapeHtml(getSortLabel(state.teamSort, state.teamSortDir))}. Click a row to inspect its set.</p>
          <p class="muted" data-progression-stale-warning ${progressionStale ? "" : "hidden"}>Progression changed after this team was optimized. Re-optimize before trusting row scores or legal move notes.</p>
        </div>
        <button type="button" class="view-tab" data-copy-pokepaste title="Copies once the Team Analysis below has finished loading">Copy team as poképaste</button>
      </div>

      <div class="table-wrap">
        <table class="usage-table">
          <thead>
            <tr>
              <th>#</th>
              ${renderSortHeader("current", "Current", state)}
              ${renderSortHeader("name", "Eventual", state)}
              ${renderSortHeader("tier", "Usage", state)}
              ${renderSortHeader("lead", "Lead %", state)}
              ${renderSortHeader("score", "Score", state)}
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            ${sortedTeam.map((row, index) => renderTeamRow({ formatsIndex, index, itemRecommendations: state.itemRecommendations, progression: state.progression, progressionStale, row, setDetails })).join("")}
          </tbody>
        </table>
      </div>

      ${renderBenchLine(result)}
    </section>
  `;

  // The constantly-read outputs first (team, then the set cards you act on at
  // the PC), planning views after, diagnostics last. The provenance/perf
  // footer renders at page level, below the progression panel.
  return `
    ${teamPanel}

    <div id="reborn-team-analysis-root"></div>

    ${renderPostAnalysisSkippedSection(state)}
    ${renderInvestmentSection(state)}
    ${renderConfidenceSection(state)}
    ${renderExplanationsSection(state)}

    ${renderUnresolved(result.unresolved)}
  `;
}

function renderPostAnalysisSkippedSection(state) {
  if (state.analysisPending || state.confidence || state.investment) return "";

  // Deferred (background-triggered optimize with no persisted copy): the
  // stability sweep + investment projection are two more full optimizer runs
  // — minutes of every-core work — so they only start on request here or on
  // an explicit Optimize click, never from a page load or auto-reoptimize.
  if (state.postAnalysisDeferred) {
    return `
      <section class="panel">
        <h2>Stability and investment</h2>
        <p class="muted">Recommendation stability and the level-cap investment projection weren't recomputed for this background refresh (they cost a couple of extra optimizer runs). They restore automatically when a saved copy exists.</p>
        <p><button id="compute-post-analysis-button" type="button">Compute stability &amp; investment now</button></p>
      </section>
    `;
  }

  const skipped = state.postAnalysisSkipped;
  if (!skipped) return "";

  const poolSize = skipped.poolSize || 0;
  const builds = skipped.builds || 0;
  return `
    <section class="panel">
      <h2>Stability and investment</h2>
      <p class="muted">Skipped optional recommendation stability and level-cap investment projections for this large pool (${poolSize} Pokemon, ${builds} candidate builds) to keep the tab responsive. These diagnostics resume automatically at ${skipped.poolLimit} Pokemon / ${skipped.buildLimit} builds or less.</p>
    </section>
  `;
}

// --- Confidence --------------------------------------------------------------
// The recommendation is not "these six, full stop": it is core / likely / flex
// with inclusion frequencies from the robustness sweep, plus the bench mons
// that seat under plausible alternative settings.
function renderConfidenceSection(state) {
  if (state.analysisPending && !state.confidence) {
    return `
      <section class="panel">
        <h2>Recommendation stability</h2>
        <p class="muted">Sweeping alternative model settings…</p>
      </section>
    `;
  }
  const confidence = state.confidence;
  if (!confidence) return "";

  const byTier = { core: [], likely: [], flex: [], fragile: [] };
  for (const member of confidence.members) {
    byTier[member.tier]?.push(member);
  }
  const chip = (member) =>
    `<strong>${escapeHtml(member.inputName)}</strong> ${Math.round(member.frequency * 100)}%`;
  const rows = [];
  if (byTier.core.length)
    rows.push(`<p>Core: ${byTier.core.map(chip).join(" · ")}</p>`);
  if (byTier.likely.length)
    rows.push(`<p>Likely: ${byTier.likely.map(chip).join(" · ")}</p>`);
  if (byTier.flex.length || byTier.fragile.length)
    rows.push(
      `<p>Flex slots (genuine close calls): ${[...byTier.flex, ...byTier.fragile].map(chip).join(" · ")}</p>`,
    );
  if (confidence.alternatives.length) {
    rows.push(
      `<p class="muted">Also seat under some settings: ${confidence.alternatives
        .slice(0, 5)
        .map(
          (alt) =>
            `${escapeHtml(alt.inputName)} ${Math.round(alt.frequency * 100)}%`,
        )
        .join(" · ")}</p>`,
    );
  }
  return `
    <section class="panel">
      <h2>Recommendation stability</h2>
      <p class="muted">Inclusion frequency across ${confidence.settings} settings of every model judgement (usage weight, coverage, utility strictness, readiness gates, friction, ability assumption, shortlist size).</p>
      ${rows.join("\n")}
    </section>
  `;
}

// --- Explanations -------------------------------------------------------------
function renderExplanationsSection(state) {
  const result = state.result;
  if (!result?.team?.length) return "";
  const confidenceByInput = new Map(
    (state.confidence?.members || []).map((member) => [
      member.inputPokemonId,
      member,
    ]),
  );
  const alternativesByInput = new Map(
    (state.confidence?.alternatives || []).map((alt) => [
      alt.inputPokemonId,
      alt,
    ]),
  );

  // Summary lines carry the headline facts (role, seat robustness) so the
  // collapsed list already says something; the details hold the full audit.
  const seated = result.team
    .map((choice) => {
      const confidenceEntry = confidenceByInput.get(choice.inputPokemonId);
      const lines = explainSeatedChoice(choice, result.team, confidenceEntry);
      const headline = [
        choice.currentRole ? String(choice.currentRole).replace(/_/g, " ") : null,
        confidenceEntry
          ? `seats in ${Math.round(confidenceEntry.frequency * 100)}% of settings`
          : null,
      ]
        .filter(Boolean)
        .join(" · ");
      return `
        <details>
          <summary><strong>${escapeHtml(choice.inputName)}</strong> — ${escapeHtml(choice.legalityProfile?.currentName || choice.name)}${headline ? ` · ${escapeHtml(headline)}` : ""}</summary>
          <ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>
        </details>
      `;
    })
    .join("\n");

  const teamIds = new Set(result.team.map((choice) => choice.inputPokemonId));
  const weakestSeat = [...result.team].sort(
    (a, b) => (a.teamScore ?? 0) - (b.teamScore ?? 0),
  )[0];
  const notableBench = (result.lines || [])
    .map((line) => line.best || line.bestNonMega)
    .filter((choice) => choice && !teamIds.has(choice.inputPokemonId))
    .sort((a, b) => (b.teamScore ?? 0) - (a.teamScore ?? 0))
    .slice(0, 5);
  const excluded = notableBench
    .map((choice) => {
      const lines = explainExcludedChoice(
        choice,
        result,
        alternativesByInput.get(choice.inputPokemonId),
      );
      const margin = weakestSeat
        ? Math.round((weakestSeat.teamScore ?? 0) - (choice.teamScore ?? 0))
        : 0;
      const marginNote =
        margin > 0
          ? `−${margin} vs the weakest seat`
          : "lost on team fit, not raw score";
      return `
        <details>
          <summary>${escapeHtml(choice.inputName)} — benched (${escapeHtml(marginNote)})</summary>
          <ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>
        </details>
      `;
    })
    .join("\n");

  return `
    <section class="panel">
      <h2>Why these picks</h2>
      ${seated}
      ${notableBench.length ? `<h3>Notable exclusions</h3>${excluded}` : ""}
    </section>
  `;
}

// --- Investment ----------------------------------------------------------------
// "Best six right now" vs "worth training soon" are different products; future
// value lives HERE, never in selection.
function renderInvestmentSection(state) {
  if (state.analysisPending && !state.investment) {
    return state.confidence
      ? `<section class="panel"><h2>Investment picks</h2><p class="muted">Evaluating the pool at the next level caps…</p></section>`
      : "";
  }
  const plan = state.investment;
  if (!plan) return "";

  // Progressive delivery: the first future cap renders as soon as it lands;
  // this note says the deeper cap is still cooking (hint-grade projections
  // are default-build shortlist runs — see SCORING.md).
  const partialNote = plan.partial
    ? `<p class="muted">Cap ${escapeHtml((plan.pendingCaps || []).join(" / "))} still computing — this list may grow.</p>`
    : "";

  const trainRows = plan.trainSoon
    .slice(0, 8)
    .map((entry) => {
      const bits = [];
      if (entry.evolves) bits.push(`evolves into ${escapeHtml(entry.evolvesInto || "?")}`);
      bits.push(`+${entry.gain} value at cap ${entry.cap}`);
      if (entry.seatsLater) bits.push("projected to SEAT");
      return `<li><strong>${escapeHtml(entry.inputName)}</strong> — ${bits.join(", ")}</li>`;
    })
    .join("");
  const closeRows = plan.closeBench
    .slice(0, 6)
    .map((entry) => `<li>${escapeHtml(entry.inputName)}</li>`)
    .join("");
  const holdRows = plan.holdOff
    .slice(0, 6)
    .map(
      (entry) =>
        `<li>${escapeHtml(entry.inputName)} — +${entry.gain} at cap ${entry.cap}</li>`,
    )
    .join("");

  return `
    <section class="panel">
      <h2>Level-cap investment projection (caps ${plan.caps.join(" / ")})</h2>
      ${partialNote}
      <p class="muted">Projects only the level cap forward — evolutions and level-up moves that unlock by training. New TMs, tutors, items, and locations from future badges are NOT modeled here.</p>
      ${trainRows ? `<h3>Train for the next caps</h3><ul>${trainRows}</ul>` : ""}
      ${closeRows ? `<h3>Close bench (nearly seat today)</h3><ul>${closeRows}</ul>` : ""}
      ${holdRows ? `<h3>Do not invest yet</h3><ul>${holdRows}</ul>` : `<p class="muted">Nothing else in the pool gains meaningfully at the next caps.</p>`}
    </section>
  `;
}

// --- Provenance ----------------------------------------------------------------
function renderProvenanceFooter(manifest, result) {
  const timings = result?.timings;
  if (!manifest && !timings) return "";
  const timingText = timings
    ? ` · resolved in ${(timings.resolveMs / 1000).toFixed(1)}s, searched in ${(timings.searchMs / 1000).toFixed(1)}s`
    : "";
  return `
    <section class="panel">
      <p class="muted" style="font-size: 0.85em">
        Data: Reborn ${escapeHtml(manifest?.rebornVersion || "?")} ·
        scoring ${escapeHtml(manifest?.scoringVersion || "?")} ·
        signature ${escapeHtml(manifest?.dataSignature || "?")} ·
        built ${escapeHtml((manifest?.generatedAt || "").slice(0, 10))}${timingText}${renderSwapAuditText(result?.searchPolish)}
      </p>
      ${renderTelemetryDetails()}
    </section>
  `;
}

// The swap audit's verdict, including the healthy case: "shortlist held" is
// only reassuring if the reader can see the audit RAN (silence would be
// indistinguishable from "didn't look"). A repair names who came in and why
// the shortlist missed them — the difference between the known blind spot
// (modest individual rank, matched no gate: team-context value the
// individual score can't see) and a heuristic bug (high rank, still missed).
function renderSwapAuditText(searchPolish) {
  if (!searchPolish) return "";
  if (!searchPolish.swaps.length) {
    return ` · swap audit: shortlist held (${searchPolish.audited} lines audited)`;
  }
  const parts = searchPolish.swaps.map((swap) => {
    const attribution = swap.attribution || {};
    const matched = attribution.matched?.length
      ? `matched ${attribution.matched.slice(0, 3).join(", ")}${
          attribution.matched.length > 3
            ? ` +${attribution.matched.length - 3} more`
            : ""
        } but outranked`
      : "matched no shortlist gate";
    return `${swap.in.name} in for ${swap.out.name}, +${swap.gain} (ranked ${attribution.rank}/${attribution.of}; ${matched})`;
  });
  return ` · swap audit: ${searchPolish.swaps.length} repair${
    searchPolish.swaps.length === 1 ? "" : "s"
  } — ${escapeHtml(parts.join("; "))}`;
}

// Accumulated in-browser performance percentiles:
// p50/p90/p95 resolve and search time segmented by cache temperature AND
// pool-size bucket, for this build/scoring/data only (stale samples from
// before a deploy are excluded, not averaged in), plus this machine's core
// count. "Copy performance report" yields redacted JSON for bug filings; raw
// samples are exportable from the console via __TEAM_TELEMETRY__.
function renderTelemetryDetails() {
  let summary;
  try {
    summary = getTelemetrySummary();
  } catch {
    return "";
  }
  if (!summary || !summary.total) return "";
  const ms = (value) =>
    value == null ? "–" : value >= 10_000 ? `${(value / 1000).toFixed(1)}s` : `${value}ms`;
  const dist = (d) => `${ms(d.p50)} / ${ms(d.p90)} / ${ms(d.p95)}`;
  const range = (r) => (r.min === r.max ? `${r.min}` : `${r.min}–${r.max}`);
  const labels = { cold: "cold", warm: "warm cache", result: "result-cache hit" };
  const rows = summary.segments
    .map(
      (segment) => `
        <tr>
          <td>${escapeHtml(labels[segment.cache] || segment.cache)}</td>
          <td>${escapeHtml(segment.poolBucket)}</td>
          <td>${segment.n}</td>
          <td>${dist(segment.resolveMs)}</td>
          <td>${dist(segment.searchMs)}</td>
          <td>${segment.totalMs ? dist(segment.totalMs) : "–"}</td>
          <td>${range(segment.builds)} (${escapeHtml(segment.buildBucket)})</td>
        </tr>`,
    )
    .join("");
  const staleNote = summary.stale
    ? ` · ${summary.stale} run${summary.stale === 1 ? "" : "s"} from previous builds excluded`
    : "";
  // Phase attribution of the most recent completed run: the "where did my
  // wait actually go" line.
  let lastRunLine = "";
  try {
    const samples = loadTelemetrySamples();
    const last = samples[samples.length - 1];
    if (last?.phases) {
      const parts = Object.entries(last.phases)
        .map(([key, value]) => `${key} ${ms(value)}`)
        .join(" · ");
      const totals = [
        last.totalMs != null ? `team on screen ${ms(last.totalMs)}` : "",
        last.movesetMs != null ? `movesets ${ms(last.movesetMs)}` : "",
        last.fullMs != null ? `everything ${ms(last.fullMs)}` : "",
      ]
        .filter(Boolean)
        .join(", ");
      lastRunLine = `<p>Last run: ${escapeHtml(parts)}${totals ? ` — ${escapeHtml(totals)}` : ""}</p>`;
    }
  } catch {
    lastRunLine = "";
  }
  return `
    <details class="muted" style="font-size: 0.85em" ${detailsStateAttrs("telemetry", false)}>
      <summary>Performance (${summary.total} run${summary.total === 1 ? "" : "s"} on this build${summary.cores ? `, ${summary.cores} cores` : ""})</summary>
      <table>
        <thead>
          <tr><th>cache</th><th>pool</th><th>n</th><th>resolve p50/p90/p95</th><th>search p50/p90/p95</th><th>total p50/p90/p95</th><th>builds</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      ${lastRunLine}
      <p>
        <button id="copy-perf-report-button" type="button">Copy performance report</button>
        — redacted JSON (timings, workload sizes, versions; no pool or team content)${staleNote}.
        Raw samples: <code>__TEAM_TELEMETRY__.samples()</code> in the console; <code>.clear()</code> resets.
      </p>
    </details>
  `;
}

const SHORT_FORMAT = {
  gen7anythinggoes: "AG",
  gen7ubers: "Ubers",
  gen7ou: "OU",
  gen7uu: "UU",
  gen7ru: "RU",
  gen7nu: "NU",
  gen7pu: "PU",
  gen7zu: "ZU",
  gen7nfe: "NFE",
  gen7lc: "LC",
  gen7doublesubers: "D-Ubers",
  gen7doublesou: "DOU",
  gen7doublesuu: "DUU",
};

// One compact line under the team table listing the resolved input lines that
// did NOT make the team, grouped by the tier where each line's best form first
// reaches real usage. So a wall of identical 0.0% headline scores becomes a
// readable "AG 1500 — Ekans 0.1%, … · AG 0 — Patrat 0.1%", and the weakest
// (deepest-tier, or no-signal-anywhere) lines are flagged.
function renderBenchLine(result) {
  const selectedInputIds = new Set(
    result.team.map((choice) => choice.inputPokemonId),
  );
  const seenInputIds = new Set();
  const bench = [];

  for (const line of result.lines || []) {
    const representative = line.best || line.bestNonMega;
    if (!representative) continue;
    if (selectedInputIds.has(representative.inputPokemonId)) continue;
    if (seenInputIds.has(representative.inputPokemonId)) continue;

    seenInputIds.add(representative.inputPokemonId);
    const ceiling = lineCeilingRanking(line);
    bench.push({
      representative,
      ceiling,
      // Only lines with no meaningful tier anywhere get a trace label — the
      // ceiling keeps sole authority over everything above the bar.
      trace: ceiling ? null : lineTraceTier(line),
    });
  }

  if (!bench.length) return "";

  // Worst = worst fit RIGHT NOW: the bottom 10% (rounded up) by best
  // swap-onto-the-team score at the current cap/gamestate. Deliberately NOT a
  // "cut from pool" verdict — a gamestate-blocked future monster (Happiny at
  // cap 25 with Chansey behind the stones gate: worst swap-in, highest
  // ceiling) ranks at the bottom here and that's correct for THIS signal, so
  // the label must claim nothing about eventual value. Prefers the
  // coverage-aware swap signal (a unique-coverage mon — your only Water
  // answer — isn't flagged just for low usage); falls back to the usage-tier
  // ranking when there's no optimal team to swap against.
  const worstInputIds = pickWorstBench(bench, result.benchSwapScores);

  // The chip names the form that EARNED the group's tier and usage — the
  // line's best-ranked form — not the representative you'd field (a Rattata
  // line fields Raticate, but its meaningful tier is Rattata's own FEAR
  // usage). The fielded representative moves to the tooltip.
  const chipFormName = (entry) =>
    entry.ceiling?.name || entry.trace?.name || entry.representative.name;

  // Two different input lines can share a chip form — disambiguate with the
  // input name instead of rendering two identical chips.
  const nameCounts = new Map();
  for (const entry of bench) {
    const name = chipFormName(entry);
    nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
  }

  // Group by tier (best form's first-meaningful tier), ordered shallow → deep.
  // Below-the-bar lines form a TAIL after every meaningful group: labelled
  // with their best trace row at the relaxed seen-within-N-games horizon
  // ("ZU 1500 (30)"), and only lines with no usage anywhere keep the honest
  // "no usage data" bucket at the very end.
  const groups = new Map();
  for (const entry of bench) {
    const c = entry.ceiling;
    const t = entry.trace;
    const key = c
      ? `${c.formatId}/${c.cutoff}`
      : t
        ? `trace:${t.formatId}/${t.cutoff}/${t.games}`
        : "none";
    if (!groups.has(key)) {
      groups.set(key, {
        tierRank: c ? c.tierRank : Infinity,
        formatId: (c || t)?.formatId,
        cutoff: (c || t)?.cutoff,
        hasSignal: Boolean(c),
        games: t?.games ?? null,
        // The trace row's position on the format×cutoff ladder — the SAME
        // tier ordering the meaningful groups sort by.
        traceTierRank: t?.tierRank ?? Infinity,
        maxTraceValue: 0,
        entries: [],
      });
    }
    const group = groups.get(key);
    if (t && t.value > group.maxTraceValue) group.maxTraceValue = t.value;
    group.entries.push(entry);
  }

  // Box-position numbering: bench chips in display order are numbered 1–120,
  // four PC boxes' worth (30 slots each), each box in its own colour — so
  // sorting a box by descending usage tier is reading numbers off rather than
  // re-deriving the order, and the box a chip lands in is visible at a glance.
  const BOX_SIZE = 30;
  const MAX_BENCH_INDEX = BOX_SIZE * 4;
  let benchPosition = 0;

  // Ordering: meaningful tiers shallow → deep first; then the trace tail by
  // games ascending (fewer games to 50%-see one = stronger signal), and
  // WITHIN a horizon by the same ladder order as everything else — shallower
  // tier first (UU 0 (65) before ZU 1630 (65)); "no usage data" dead last.
  const groupOrder = (a, b) => {
    if (a.hasSignal !== b.hasSignal) return a.hasSignal ? -1 : 1;
    if (a.hasSignal) return a.tierRank - b.tierRank;
    const aTrace = a.games != null;
    const bTrace = b.games != null;
    if (aTrace !== bTrace) return aTrace ? -1 : 1;
    if (!aTrace) return 0;
    return a.games - b.games || a.traceTierRank - b.traceTierRank;
  };

  const segments = [...groups.values()]
    .sort(groupOrder)
    .map((group) => {
      group.entries.sort(
        (a, b) =>
          ((b.ceiling || b.trace)?.value || 0) -
            ((a.ceiling || a.trace)?.value || 0) ||
          chipFormName(a).localeCompare(chipFormName(b)),
      );

      const label = group.hasSignal
        ? `${SHORT_FORMAT[group.formatId] || group.formatId} ${group.cutoff}`
        : group.games != null
          ? `${SHORT_FORMAT[group.formatId] || group.formatId} ${group.cutoff} (${group.games})`
          : "no usage data";

      const chips = group.entries
        .map((entry) => {
          const { representative, ceiling } = entry;
          benchPosition += 1;
          const boxIndex =
            benchPosition <= MAX_BENCH_INDEX
              ? `<span class="bench-index bench-index--box${Math.floor((benchPosition - 1) / BOX_SIZE)}">${benchPosition}.</span> `
              : "";
          const isWorst = worstInputIds.has(representative.inputPokemonId);
          const formName = chipFormName(entry);
          const fieldsAs =
            representative.name !== formName
              ? ` · fields as ${representative.name}`
              : "";
          const usage = ceiling
            ? ` <em>${truncatePercent(ceiling.value)}</em>`
            : "";
          const classes = `bench-chip${isWorst ? " worst" : ""}`;
          const collides =
            (nameCounts.get(formName) || 0) > 1 &&
            representative.inputName &&
            representative.inputName !== formName;
          const chipName = collides
            ? `${formName} (${representative.inputName})`
            : formName;
          const worstNote = isWorst
            ? " · flagged: worst fit for the current team right now (bottom 10% by best swap-in score at this level cap — not a judgement of eventual value)"
            : "";
          return `<span class="${classes}" title="from input ${escapeHtml(representative.inputName)}${escapeHtml(fieldsAs)}${escapeHtml(worstNote)}">${boxIndex}${escapeHtml(chipName)}${usage}</span>`;
        })
        .join("");

      // Trace tiers explain their parenthetical: it's a visibility horizon,
      // not a usage percent, and the reader shouldn't have to know the
      // formula to read it.
      const tierTitle =
        group.games != null
          ? ` title="Below the meaningful-usage bar (50% chance of being seen within 25 games ≈ 2.7%) in every tier. Best trace signal: ~${truncatePercent(group.maxTraceValue)} here — 50% chance of being seen within ${group.games} games."`
          : "";
      return `<span class="bench-group"><span class="bench-tier"${tierTitle}>${escapeHtml(label)}</span>${chips}</span>`;
    })
    .join('<span class="bench-sep">·</span>');

  return `
    <div class="bench-line">
      <span class="bench-label">Not selected · by best meaningful tier:</span>
      <span class="bench-items">${segments}</span>
    </div>
  `;
}

// Usage is truncated, not rounded, so the displayed figure never overstates
// the underlying usage.
function truncatePercent(value) {
  return `${(Math.floor((value || 0) * 10) / 10).toFixed(1)}%`;
}

// The line's best TRACE row for the bench tail (only consulted when no form
// is meaningful anywhere): across the line's forms, the resolver index's
// display-only `trace` row with the highest usage — the row that qualifies
// first as the seen-within-N-games bar relaxes — stamped with that N. Null
// when no form has any usage at all (stays "no usage data").
function lineTraceTier(line) {
  let best = null;
  for (const candidate of line.candidates || []) {
    const trace = candidate.bundle?.trace;
    if (!trace || !(trace.value > 0)) continue;
    if (
      !best ||
      trace.value > best.value ||
      (trace.value === best.value && trace.tierRank < best.tierRank)
    ) {
      best = {
        tierRank: trace.tierRank,
        value: trace.value,
        formatId: trace.formatId,
        cutoff: trace.cutoff,
        name: trace.name || candidate.candidate?.name,
      };
    }
  }
  if (!best) return null;
  const games = gamesToLikelySee(best.value);
  return games == null ? null : { ...best, games };
}

// The line's best form by ranking: the shallowest meaningful tier, then highest
// usage there — ignoring the level-cap form-readiness discount, so a stuck pre-
// evolution is judged by what it becomes. null if no form is meaningful anywhere.
function lineCeilingRanking(line) {
  let best = null;
  for (const candidate of line.candidates || []) {
    const ranking = candidate.bundle?.ranking;
    if (!ranking) continue;
    const next = {
      tierRank: ranking.tierRank,
      value: ranking.value,
      formatId: ranking.formatId,
      cutoff: ranking.cutoff,
      name: candidate.candidate?.name,
    };
    if (
      !best ||
      next.tierRank < best.tierRank ||
      (next.tierRank === best.tierRank && next.value > best.value)
    ) {
      best = next;
    }
  }
  return best;
}

// The set of bench inputPokemonIds to flag as "worst FIT RIGHT NOW": the
// BOTTOM 10% of the bench (rounded up, always at least one) by present-tense
// swap-in value — a snapshot the player exercises judgement over, not a
// pool-culling verdict (a blocked future monster legitimately bottoms this
// ranking while carrying the pool's highest ceiling). Prefers the swap-score
// signal: recomputed on every optimize from the current team and scoring, the
// lowest best-swap-onto-the-team score is the weakest swap-in today (coverage
// and tier already folded in by the team scorer). Falls back to the
// usage-tier ranking when no swap scores exist (no optimal team to swap onto).
function pickWorstBench(bench, swapScores) {
  const flagCount = Math.max(1, Math.ceil(bench.length * 0.1));
  const scored = swapScores
    ? bench.filter(
        (entry) =>
          typeof swapScores.get(entry.representative.inputPokemonId) === "number",
      )
    : [];

  if (scored.length) {
    const ordered = [...scored].sort(
      (a, b) =>
        swapScores.get(a.representative.inputPokemonId) -
          swapScores.get(b.representative.inputPokemonId) ||
        a.representative.name.localeCompare(b.representative.name),
    );
    return new Set(
      ordered
        .slice(0, Math.min(flagCount, ordered.length))
        .map((entry) => entry.representative.inputPokemonId),
    );
  }

  const ordered = [...bench].sort(
    (a, b) =>
      compareRankWorseFirst(a.ceiling, b.ceiling) ||
      a.representative.name.localeCompare(b.representative.name),
  );
  return new Set(
    ordered
      .slice(0, flagCount)
      .map((entry) => entry.representative.inputPokemonId),
  );
}

// Worse-first ordering on usage-tier ceilings: deeper tier first, then lower
// usage within the tier; no signal at all is the worst of all.
function compareRankWorseFirst(a, b) {
  const ta = a ? a.tierRank : Infinity;
  const tb = b ? b.tierRank : Infinity;
  if (ta !== tb) return tb - ta;
  return (a?.value ?? -Infinity) - (b?.value ?? -Infinity);
}

function renderItemRec(item) {
  if (!item) return "";

  let qualifier = "";
  let title = "";

  if (item.fallback) {
    qualifier = "fallback";
    title = "No commonly-run item owned; filled from your spare inventory.";
  } else if (item.proxy) {
    qualifier =
      typeof item.usage === "number"
        ? `~${formatItemPercent(item.usage)} proxy`
        : "proxy";
    title = item.seed
      ? "Reborn Field Seed; demand proxied from this Pokémon's terrain-seed usage."
      : "Reborn type Gem; competitive demand proxied from the matching Z-Crystal.";
  } else if (typeof item.usage === "number") {
    qualifier = formatItemPercent(item.usage);
    title =
      "Share of this Pokémon's observed competitive sets holding this item.";
  } else {
    qualifier = "situational";
    title =
      "Seen on this Pokémon's sets but without a headline usage share — a real option, just not a statistically ranked one.";
  }

  if (item.unburden) {
    qualifier = qualifier ? `${qualifier}, Unburden` : "Unburden";
    title =
      "Consumable item weighted up because this Pokémon can have Unburden.";
  }

  return `<div class="representative-note item-rec-note"${title ? ` title="${escapeAttr(title)}"` : ""}>Item: ${escapeHtml(item.name)}${qualifier ? ` (${escapeHtml(qualifier)})` : ""}</div>`;
}

// Sub-2% item usage keeps a decimal so a genuine 0.4% never rounds to a
// misleading "(0%)".
function formatItemPercent(value) {
  return value >= 2 ? `${Math.round(value)}%` : `${value.toFixed(1)}%`;
}

function renderSortHeader(sortBy, label, state) {
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

function renderTeamRow({
  formatsIndex,
  index,
  itemRecommendations,
  progression,
  progressionStale,
  row,
  setDetails,
}) {
  const selected = setDetails.isSelected(row.pokemonId);
  const currentSpecies = getCurrentRebornSpeciesForChoice(row, progression);
  const currentName = currentSpecies?.name || row.name;
  // "from Burmy@20 (Female, in buildings)" — what it takes for the input mon
  // to become the current form. Empty when the input isn't its pre-evolution.
  const evolutionNote = describeEvolutionPath(
    row.inputPokemonId,
    currentSpecies?.id,
  );
  // "Eventual" only when the representative genuinely lies AHEAD of the
  // current form. A representative that is a PRE-evolution (a Noivern pick
  // whose usage bundle is Noibat's) is the pick's past, not its future.
  const eventualDiffers = Boolean(currentSpecies?.representativeIsFuture);
  const note = progressionStale
    ? "Progression changed; re-optimize for current scores and legal move notes."
    : row.note || "";
  const recommendedItem = itemRecommendations?.[teamMemberKey(row)];

  return `
    <tr
      class="team-pick-row ${selected ? "selected-row" : ""}"
      data-pool-set-id="${escapeHtml(row.pokemonId)}"
      data-team-input-id="${escapeHtml(row.inputPokemonId)}"
      data-team-pokemon-id="${escapeHtml(row.pokemonId)}"
      title="Inspect ${escapeHtml(row.name)} set"
    >
      <td>${index + 1}</td>
      <td>
        <strong>${escapeHtml(currentName)}</strong>
        <button type="button" class="set-card-jump" data-jump-set-card="${escapeAttr(currentSpecies?.id || row.pokemonId)}" title="Jump to this pick's recommended set below">moves ↓</button>
        ${
          row.inputName && row.inputName !== currentName
            ? `<div class="representative-note">from ${escapeHtml(row.inputName)}${escapeHtml(evolutionNote)}</div>`
            : ""
        }
        ${renderItemRec(recommendedItem)}
      </td>
      <td data-current-species-note>
        ${
          eventualDiffers
            ? `<strong>${escapeHtml(row.name)}</strong>${row.isMega ? `<div class="representative-note">Mega slot</div>` : ""}`
            : `<span class="muted">—</span>`
        }
      </td>
      <td>${renderMeaningfulUsage(row, formatsIndex)}</td>
      <td>${formatPercent(row.bundle?.leads?.value)}</td>
      <td>${Number.isFinite(row.score) ? Math.round(row.score).toLocaleString() : ""}</td>
      <td data-team-note>${escapeHtml(note)}</td>
    </tr>

    ${
      selected
        ? `<tr class="team-builder-set-row"><td colspan="7"><div id="team-builder-set-details-root"></div></td></tr>`
        : ""
    }
  `;
}

// The pick's FIRST MEANINGFUL usage tier ("AG 1760 · 1.1%"), not its usage at
// the top tier — "0.00 at AG 1760" says nothing about a mon that owns PU. The
// headline top-tier source (with months of data) moves to the tooltip.
function renderMeaningfulUsage(row, formatsIndex) {
  const ranking = row.bundle?.ranking;
  const headline = renderSource(row.bundle?.usage, formatsIndex);
  if (!ranking || typeof ranking.value !== "number") {
    // Below the meaningful bar everywhere: same relaxed seen-within-N-games
    // treatment as the bench tail — "ZU 1500 (65)" reads "at its ZU-1500
    // usage, even odds of seeing one within 65 games" — from the resolver
    // index's display-only trace row. Honest "no usage data" only when the
    // form has no recorded usage at all.
    const trace = row.bundle?.trace;
    const games = trace ? gamesToLikelySee(trace.value) : null;
    if (trace && games != null) {
      const label = `${SHORT_FORMAT[trace.formatId] || trace.formatId} ${trace.cutoff} (${games})`;
      return `<span class="muted" title="${escapeAttr(`Below the meaningful-usage bar (50% chance of being seen within 25 games ≈ 2.7%) in every tier. Best trace signal: ~${truncatePercent(trace.value)} here — 50% chance of being seen within ${games} games. Best available: ${headline || "none"}`)}">${escapeHtml(label)}</span>`;
    }
    return `<span class="muted" title="${escapeAttr(`No recorded usage in any tier. Best available: ${headline || "none"}`)}">no usage data</span>`;
  }
  const label = `${SHORT_FORMAT[ranking.formatId] || ranking.formatId} ${ranking.cutoff}`;
  return `<span title="${escapeAttr(`First meaningful tier. Best available: ${headline || "none"}`)}">${escapeHtml(label)} · ${escapeHtml(truncatePercent(ranking.value))}</span>`;
}

function renderSelectedSetDetails({ app, pokemonIndex, setDetails, state }) {
  const detailsRoot = app.querySelector("#team-builder-set-details-root");
  if (!detailsRoot) return;

  const selected = getSelectedTeamChoice({ setDetails, state });

  if (!selected) {
    detailsRoot.innerHTML = "";
    return;
  }

  const detail = setDetails.getDetail();
  const currentSpecies = getCurrentRebornSpeciesForChoice(
    selected,
    state.progression,
  );

  renderMovesetPanel(detailsRoot, {
    selectedPokemonName: selected.name,
    movesetEntry: detail,
    lookupLabel: detail ? setDetails.describeSource(detail) : "",
    // The set is sourced from the mon's first meaningful usage tier, which is
    // why this evolution stage was chosen over (or instead of) another.
    // Surface that tier's usage so the pick is legible — but only when the shown
    // set actually came from the ranking tier (guard against the deepest-tier
    // fallback and cross-family sourcing, where the number wouldn't match).
    sourceUsageLabel: describeSourceUsage(selected.bundle?.ranking, detail),
    aggregate: state.selection === "all",
    stitched: Boolean(detail?.stitched),
    status: setDetails.getStatus(),
  });

  const legalMovesRoot = document.createElement("div");
  legalMovesRoot.dataset.rebornLegalMovesRoot = "true";
  detailsRoot.appendChild(legalMovesRoot);
  renderRebornLegalMovesPanel(legalMovesRoot, {
    currentSpecies,
    movesetEntry: detail,
    pokemonIndex,
    poolQuery: state.query,
    pokemonId: selected.pokemonId,
    pokemonName: selected.name,
    progression: state.progression,
  });

  if (setDetails.getMessage()) {
    detailsRoot.insertAdjacentHTML(
      "afterbegin",
      `<section class="panel"><p class="muted">${escapeHtml(setDetails.getMessage())}</p></section>`,
    );
  }
}

function getSelectedTeamChoice({ setDetails, state }) {
  const selectedPokemonId = setDetails.getSelectedPokemonId();

  if (!selectedPokemonId || !state.result?.team?.length) return null;

  return (
    state.result.team.find((row) => row.pokemonId === selectedPokemonId) || null
  );
}

export function getSortedTeam(team, sortBy, sortDir = "desc", progression = {}) {
  const rows = [...team];
  const direction = sortDir === "asc" ? 1 : -1;
  const currentName = (row) =>
    getCurrentRebornSpeciesForChoice(row, progression)?.name || row.name;

  rows.sort((a, b) => {
    let primary = 0;

    if (sortBy === "lead") {
      primary = compareNumber(a.bundle?.leads?.value, b.bundle?.leads?.value);
    } else if (sortBy === "usage") {
      primary = compareNumber(a.bundle?.usage?.value, b.bundle?.usage?.value);
    } else if (sortBy === "tier") {
      // "Descending" = best tier first (lowest tierRank), then highest usage
      // within the tier — AG 1760 1.14%, AG 1760 1.12%, PU 1500 1.58%, ...
      // Unranked rows form a trace TAIL after every ranked one, ordered the
      // same way as the bench display: seen-within-N games ascending, then
      // the tier ladder, then trace usage; no-trace rows dead last.
      const rankOf = (row) => row.bundle?.ranking?.tierRank ?? Infinity;
      const valueOf = (row) =>
        typeof row.bundle?.ranking?.value === "number"
          ? row.bundle.ranking.value
          : -Infinity;
      const traceGamesOf = (row) => {
        const games = row.bundle?.trace
          ? gamesToLikelySee(row.bundle.trace.value)
          : null;
        return games == null ? Infinity : games;
      };
      const traceRankOf = (row) => row.bundle?.trace?.tierRank ?? Infinity;
      const traceValueOf = (row) =>
        typeof row.bundle?.trace?.value === "number"
          ? row.bundle.trace.value
          : -Infinity;
      primary =
        compareNumber(rankOf(b), rankOf(a)) ||
        compareNumber(valueOf(a), valueOf(b)) ||
        compareNumber(traceGamesOf(b), traceGamesOf(a)) ||
        compareNumber(traceRankOf(b), traceRankOf(a)) ||
        compareNumber(traceValueOf(a), traceValueOf(b));
    } else if (sortBy === "score") {
      primary = compareNumber(a.score, b.score);
    } else if (sortBy === "current" || sortBy === "input") {
      primary = currentName(a).localeCompare(currentName(b));
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
  if (sortBy === "tier") return `meaningful usage tier (best tier first when ${direction})`;
  if (sortBy === "score") return `optimizer score ${direction}`;
  if (sortBy === "current" || sortBy === "input") {
    return `current form ${direction}`;
  }

  return `eventual form ${direction}`;
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

function renderSource(source, formatsIndex) {
  if (!source) return "";

  const label =
    formatsIndex.find((format) => format.id === source.formatId)?.label ||
    source.formatId;

  return source.selection === "all"
    ? `${escapeHtml(label)} @ ${source.cutoff} (${source.monthsPresent}/${source.monthsAvailable} mo)`
    : `${escapeHtml(label)} @ ${source.cutoff}`;
}

function formatPercent(value) {
  return typeof value === "number" ? value.toFixed(2) : "";
}

// The mon's usage at the tier its set was sourced from, for the detail pane —
// only when that tier matches the meaningful-tier ranking (so the percentage
// genuinely describes the "Movesets from …" source shown beside it).
function describeSourceUsage(ranking, detail) {
  if (!ranking || !detail || typeof ranking.value !== "number") return "";
  if (ranking.formatId !== detail.formatId || ranking.cutoff !== detail.cutoff) {
    return "";
  }
  return `${formatPercent(ranking.value)}% usage at this tier`;
}

