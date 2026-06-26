import { escapeHtml } from "../utils/html.js";
export function renderResolverResults(
  container,
  rows,
  state,
  formatsIndex,
  selectionLabel,
  status = {},
) {
  if (!state.resolverQuery.trim()) {
    container.innerHTML = `<section class="panel"><p class="muted">Enter one or more Pokémon to resolve best available usage, lead data, and movesets.</p></section>`;
    return;
  }

  const loadingNotice = status.loading
    ? `<div class="resolver-loading-banner">
        <span class="spinner-dot"></span>
        <span>${escapeHtml(status.message || "Resolving Pokémon...")}</span>
      </div>`
    : "";
  if (rows.length === 0) {
    container.innerHTML = `<section class="panel">${loadingNotice}<p class="muted">No matching Pokémon found.</p></section>`;
    return;
  }
  container.innerHTML = `
    <section class="panel">
      <div class="panel-header"><div><h2>Set Lookup Results</h2><p>${rows.length} Pokémon resolved for ${selectionLabel}</p><p>Sorted by Lead % descending. Click a row to load movesets.</p></div></div>
      ${loadingNotice}
      <table class="usage-table resolver-results-table"><thead><tr><th>Pokémon</th><th>Usage %</th><th>Lead %</th><th>Source</th></tr></thead><tbody>
        ${rows.map((row) => `<tr data-resolver-pokemon-id="${row.pokemonId}" class="${row.pokemonId === state.resolverSelectedPokemon ? "selected" : ""}"><td>${renderPokemonCell(row)}</td><td>${row.bundle.usage ? row.bundle.usage.value.toFixed(2) : "—"}</td><td>${row.bundle.leads ? row.bundle.leads.value.toFixed(1) : "—"}</td><td>${renderSourceCell(row.bundle, formatsIndex)}</td></tr>`).join("")}
      </tbody></table>
    </section>`;
}
function renderPokemonCell(row) {
  if (row.inputName && row.inputName !== row.name) {
    return `
      <div class="representative-cell">
        <div><span class="input-mon">${escapeHtml(row.inputName)}</span> <span class="arrow">→</span> <strong>${escapeHtml(row.name)}</strong></div>
        <div class="representative-note">${escapeHtml(getRepresentativeNote(row))}</div>
      </div>
    `;
  }

  return escapeHtml(row.name);
}

function getRepresentativeNote(row) {
  const parts = [
    row.representativeIsMega
      ? "Best line representative · Mega candidate"
      : "Best line representative",
  ];

  if (
    row.representativeIsMega &&
    row.bestNonMegaName &&
    row.bestNonMegaName !== row.name
  ) {
    const usageText =
      typeof row.bestNonMegaUsage === "number"
        ? ` (${row.bestNonMegaUsage.toFixed(2)}%)`
        : "";

    parts.push(`best non-mega: ${row.bestNonMegaName}${usageText}`);
  }

  return parts.join(" · ");
}

function renderSourceCell(bundle, formatsIndex) {
  const usageSource = bundle.usage,
    leadSource = bundle.leads;
  if (!usageSource && !leadSource) return "—";
  if (sameSource(usageSource, leadSource))
    return `<div class="source-lines"><div>${formatSource(usageSource, formatsIndex)}</div></div>`;
  const lines = [];
  if (usageSource)
    lines.push(
      `<div class="source-subline"><strong>Usage:</strong> ${formatSource(usageSource, formatsIndex)}</div>`,
    );
  if (leadSource)
    lines.push(
      `<div class="source-subline"><strong>Lead:</strong> ${formatSource(leadSource, formatsIndex)}</div>`,
    );
  return `<div class="source-lines">${lines.join("")}</div>`;
}
function sameSource(a, b) {
  return Boolean(
    a &&
      b &&
      a.selection === b.selection &&
      a.formatId === b.formatId &&
      a.cutoff === b.cutoff &&
      a.month === b.month &&
      a.monthsPresent === b.monthsPresent &&
      a.monthsAvailable === b.monthsAvailable,
  );
}
function formatSource(source, formatsIndex) {
  if (!source) return "—";
  const label =
    formatsIndex.find((format) => format.id === source.formatId)?.label ||
    source.formatId;
  if (source.selection === "all")
    return `${label} @ ${source.cutoff} (all, ${source.monthsPresent}/${source.monthsAvailable} mo)`;
  return `${label} @ ${source.cutoff} (${source.month})`;
}
