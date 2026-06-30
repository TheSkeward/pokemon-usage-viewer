import { escapeHtml, escapeAttr } from "../utils/html.js";
import { renderMovesetPanel } from "../views/movesetView";
import { renderRebornLegalMovesPanel } from "../reborn/legalMovesView";
import { renderRebornProgressionPanel } from "../reborn/progressionView";
import { renderRebornTeamAnalysisPanel } from "../reborn/teamAnalysisView";
import { getCurrentRebornSpeciesForChoice } from "../reborn/currentSpecies.js";
import { teamMemberKey } from "./itemRecommendations";

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
  app.innerHTML = `
    ${embedded ? "" : renderStandaloneHeader({ baseUrl })}

    ${renderPoolControls({ embedded, poolStats, state })}

    ${renderRebornProgressionPanel(state.progression)}

    ${state.loading ? renderLoading(state) : ""}

    ${state.result ? renderResult({ familyLabel, formatsIndex, setDetails, state }) : renderEmpty(state)}
  `;

  renderSelectedSetDetails({ app, pokemonIndex, setDetails, state });
  renderRebornTeamAnalysisPanel(app.querySelector("#reborn-team-analysis-root"), {
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
  });
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
        <button class="view-tab primary-action" id="optimize-button">${state.loading ? "Optimizing..." : "Normalize + optimize team"}</button>
        <button class="view-tab" id="copy-pool-button">Copy pool</button>
        <button class="view-tab" id="generate-availability-button" ${state.result?.lines?.length ? "" : "disabled"} title="${state.result?.lines?.length ? "Generate a pasteable list of every available Pokémon, its current move pool, and your held items" : "Optimize the team first to resolve your pool"}">Generate availability list</button>
        <button class="view-tab danger-button" id="clear-pool-button">Clear saved pool</button>
        <span class="muted" data-pool-status>${escapeHtml(state.statusMessage)}</span>
      </div>

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

  return `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2>Recommended ${escapeHtml(familyLabel)} Team</h2>
          <p>${result.team.length} picks from ${result.linesConsidered} resolved input lines. ${megaText}.</p>
          <p>v0 rules: at most one Mega, one long-term representative per input line, selected by usage prior plus current legal STAB, coverage, and defensive fit. Displayed by ${escapeHtml(getSortLabel(state.teamSort, state.teamSortDir))}. Click a row to inspect its set.</p>
          <p class="muted" data-progression-stale-warning ${progressionStale ? "" : "hidden"}>Progression changed after this team was optimized. Re-optimize before trusting row scores or legal move notes.</p>
        </div>
      </div>

      <div class="table-wrap">
        <table class="usage-table">
          <thead>
            <tr>
              <th>#</th>
              ${renderSortHeader("current", "Current", state)}
              ${renderSortHeader("name", "Eventual", state)}
              ${renderSortHeader("usage", "Usage %", state)}
              ${renderSortHeader("lead", "Lead %", state)}
              ${renderSortHeader("score", "Score", state)}
              <th>Source</th>
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

    <div id="reborn-team-analysis-root"></div>

    ${renderUnresolved(result.unresolved)}
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
    bench.push({ representative, ceiling: lineCeilingRanking(line) });
  }

  if (!bench.length) return "";

  // Worst = the most droppable line. Prefer the coverage-aware signal: the line
  // whose best swap onto the optimal team scores lowest, so a unique-coverage
  // mon (your only Water answer) isn't flagged just for low usage, while a
  // low-tier mon whose coverage is redundant is. Fall back to the usage-tier
  // ranking (deepest tier, then lowest usage; meaningful nowhere = floor) when
  // there's no optimal team to swap against. Ties are all flagged.
  const worstInputIds = pickWorstBench(bench, result.benchSwapScores);

  // Group by tier (best form's first-meaningful tier), ordered shallow → deep.
  const groups = new Map();
  for (const entry of bench) {
    const c = entry.ceiling;
    const key = c ? `${c.formatId}/${c.cutoff}` : "none";
    if (!groups.has(key)) {
      groups.set(key, {
        tierRank: c ? c.tierRank : Infinity,
        formatId: c?.formatId,
        cutoff: c?.cutoff,
        hasSignal: Boolean(c),
        entries: [],
      });
    }
    groups.get(key).entries.push(entry);
  }

  const segments = [...groups.values()]
    .sort((a, b) => a.tierRank - b.tierRank)
    .map((group) => {
      group.entries.sort(
        (a, b) =>
          (b.ceiling?.value || 0) - (a.ceiling?.value || 0) ||
          a.representative.name.localeCompare(b.representative.name),
      );

      const label = group.hasSignal
        ? `${SHORT_FORMAT[group.formatId] || group.formatId} ${group.cutoff}`
        : "no usage data";

      const chips = group.entries
        .map(({ representative, ceiling }) => {
          const isWorst = worstInputIds.has(representative.inputPokemonId);
          const bestForm =
            ceiling?.name && ceiling.name !== representative.name
              ? ` · best form ${ceiling.name}`
              : "";
          const usage = ceiling
            ? ` <em>${truncatePercent(ceiling.value)}</em>`
            : "";
          const classes = `bench-chip${isWorst ? " worst" : ""}`;
          return `<span class="${classes}" title="from input ${escapeHtml(representative.inputName)}${escapeHtml(bestForm)}">${escapeHtml(representative.name)}${usage}</span>`;
        })
        .join("");

      return `<span class="bench-group"><span class="bench-tier">${escapeHtml(label)}</span>${chips}</span>`;
    })
    .join('<span class="bench-sep">·</span>');

  return `
    <div class="bench-line">
      <span class="bench-label">Not selected · by best meaningful tier:</span>
      <span class="bench-items">${segments}</span>
    </div>
  `;
}

// Usage is truncated, not rounded — 0.16% reads as 0.1%, matching the >=0.1%
// hard cutoff used to find the meaningful tier.
function truncatePercent(value) {
  return `${(Math.floor((value || 0) * 10) / 10).toFixed(1)}%`;
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

// The set of bench inputPokemonIds to flag as "worst". Prefers the swap-score
// signal: the lowest best-swap-onto-the-team score is the most droppable mon
// (coverage and tier already folded in by the team scorer). Falls back to the
// usage-tier ranking when no swap scores exist (no optimal team to swap onto).
function pickWorstBench(bench, swapScores) {
  const scored = swapScores
    ? bench.filter(
        (entry) =>
          typeof swapScores.get(entry.representative.inputPokemonId) === "number",
      )
    : [];

  if (scored.length) {
    const min = Math.min(
      ...scored.map((entry) =>
        swapScores.get(entry.representative.inputPokemonId),
      ),
    );
    return new Set(
      scored
        .filter(
          (entry) =>
            swapScores.get(entry.representative.inputPokemonId) === min,
        )
        .map((entry) => entry.representative.inputPokemonId),
    );
  }

  const worstKey = bench.reduce(
    (acc, entry) => (isWorseRank(entry.ceiling, acc) ? entry.ceiling : acc),
    bench[0].ceiling,
  );
  return new Set(
    bench
      .filter((entry) => sameRank(entry.ceiling, worstKey))
      .map((entry) => entry.representative.inputPokemonId),
  );
}

function isWorseRank(a, b) {
  const ta = a ? a.tierRank : Infinity;
  const tb = b ? b.tierRank : Infinity;
  if (ta !== tb) return ta > tb;
  return (a?.value ?? -Infinity) < (b?.value ?? -Infinity);
}

function sameRank(a, b) {
  const ta = a ? a.tierRank : Infinity;
  const tb = b ? b.tierRank : Infinity;
  return ta === tb && (a?.value ?? -Infinity) === (b?.value ?? -Infinity);
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
        ? `~${Math.round(item.usage)}% proxy`
        : "proxy";
    title = item.seed
      ? "Reborn Field Seed; demand proxied from this Pokémon's terrain-seed usage."
      : "Reborn type Gem; competitive demand proxied from the matching Z-Crystal.";
  } else if (typeof item.usage === "number") {
    qualifier = `${Math.round(item.usage)}%`;
  } else {
    qualifier = "situational";
    title = "Observed on lower-usage or related sets, not headline usage.";
  }

  if (item.unburden) {
    qualifier = qualifier ? `${qualifier}, Unburden` : "Unburden";
    title =
      "Consumable item weighted up because this Pokémon can have Unburden.";
  }

  return `<div class="representative-note item-rec-note"${title ? ` title="${escapeAttr(title)}"` : ""}>Item: ${escapeHtml(item.name)}${qualifier ? ` (${escapeHtml(qualifier)})` : ""}</div>`;
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
  const eventualDiffers = Boolean(currentSpecies?.differsFromRepresentative);
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
        ${
          row.inputName && row.inputName !== currentName
            ? `<div class="representative-note">from ${escapeHtml(row.inputName)}</div>`
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
      <td>${formatPercent(row.bundle?.usage?.value)}</td>
      <td>${formatPercent(row.bundle?.leads?.value)}</td>
      <td>${Number.isFinite(row.score) ? Math.round(row.score).toLocaleString() : ""}</td>
      <td>${renderSource(row.bundle?.usage, formatsIndex)}</td>
      <td data-team-note>${escapeHtml(note)}</td>
    </tr>

    ${
      selected
        ? `<tr class="team-builder-set-row"><td colspan="8"><div id="team-builder-set-details-root"></div></td></tr>`
        : ""
    }
  `;
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
    // The set is sourced from the mon's first meaningful (>=0.1%) usage tier,
    // which is why this evolution stage was chosen over (or instead of) another.
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

