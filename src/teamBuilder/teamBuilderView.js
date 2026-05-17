import { renderMovesetPanel } from "../views/movesetView";
import { renderRebornLegalMovesPanel } from "../reborn/legalMovesView";
import { renderRebornProgressionPanel } from "../reborn/progressionView";
import { renderRebornTeamAnalysisPanel } from "../reborn/teamAnalysisView";
import { getCurrentRebornSpeciesForChoice } from "../reborn/currentSpecies.js";

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
    pokemonIndex,
    poolQuery: state.query,
    progression: state.progression,
    team: state.result?.team || [],
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
        <button class="view-tab danger-button" id="clear-pool-button">Clear saved pool</button>
        <span class="muted" data-pool-status>${escapeHtml(state.statusMessage)}</span>
      </div>
    </section>
  `;
}

function renderLoading(state) {
  return `
    <section class="panel">
      <div class="resolver-loading-banner">
        <span class="spinner-dot"></span>
        <span>Optimizing pool against precomputed ${escapeHtml(state.family)} set data...</span>
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
  );

  return `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2>Recommended ${escapeHtml(familyLabel)} Team</h2>
          <p>${result.team.length} picks from ${result.linesConsidered} resolved input lines. ${megaText}.</p>
          <p>v0 rules: at most one Mega, one long-term representative per input line, selected by usage prior plus current legal STAB, coverage, and defensive fit. Displayed by ${escapeHtml(getSortLabel(state.teamSort, state.teamSortDir))}. Click a row to inspect its set.</p>
        </div>
      </div>

      <div class="table-wrap">
        <table class="usage-table">
          <thead>
            <tr>
              <th>#</th>
              ${renderSortHeader("input", "Input", state)}
              ${renderSortHeader("name", "Pick", state)}
              ${renderSortHeader("usage", "Usage %", state)}
              ${renderSortHeader("lead", "Lead %", state)}
              ${renderSortHeader("score", "Score", state)}
              <th>Source</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            ${sortedTeam.map((row, index) => renderTeamRow({ formatsIndex, index, progression: state.progression, row, setDetails })).join("")}
          </tbody>
        </table>
      </div>
    </section>

    <div id="reborn-team-analysis-root"></div>

    ${renderUnresolved(result.unresolved)}
  `;
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

function renderTeamRow({ formatsIndex, index, progression, row, setDetails }) {
  const selected = setDetails.isSelected(row.pokemonId);
  const currentSpecies = getCurrentRebornSpeciesForChoice(row, progression);

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
        ${
          currentSpecies?.differsFromRepresentative
            ? `<div class="representative-note">Current: ${escapeHtml(currentSpecies.name)}</div>`
            : ""
        }
      </td>
      <td>${formatPercent(row.bundle?.usage?.value)}</td>
      <td>${formatPercent(row.bundle?.leads?.value)}</td>
      <td>${Number.isFinite(row.score) ? Math.round(row.score).toLocaleString() : ""}</td>
      <td>${renderSource(row.bundle?.usage, formatsIndex)}</td>
      <td>${escapeHtml(row.note || "")}</td>
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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
