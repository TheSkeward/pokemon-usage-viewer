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
      <div class="panel-header"><div><h2>Set Lookup Results</h2><p>${rows.length} Pokémon resolved for ${selectionLabel}</p><p>Usage % and Source show the canonical tier — the first tier the Pokémon is meaningfully played in (its best trace tier when it never clears the bar). Shallower fallback tiers are noted and their sets appear tagged in the details below. Sorted by Lead % descending. Click a row to load movesets.</p></div></div>
      ${loadingNotice}
      <table class="usage-table resolver-results-table"><thead><tr><th>Pokémon</th><th>Usage %</th><th>Lead %</th><th>Source</th></tr></thead><tbody>
        ${rows.map((row) => `<tr data-resolver-pokemon-id="${row.pokemonId}" class="${row.pokemonId === state.resolverSelectedPokemon ? "selected" : ""}"><td>${renderPokemonCell(row)}</td><td>${renderUsageCell(row.bundle)}</td><td>${row.bundle.leads ? row.bundle.leads.value.toFixed(1) : "—"}</td><td>${renderSourceCell(row.bundle, formatsIndex)}</td></tr>`).join("")}
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

// The shallowest tier of ANY appearance must stay a demoted fallback line,
// never the headline.
function canonicalTierOf(bundle) {
  return bundle.ranking || bundle.trace || null;
}

function renderUsageCell(bundle) {
  const canonical = canonicalTierOf(bundle);
  if (canonical) {
    const traceTag = bundle.ranking
      ? ""
      : `<div class="source-subline">trace</div>`;
    return `${canonical.value.toFixed(2)}${traceTag}`;
  }
  return bundle.usage ? bundle.usage.value.toFixed(2) : "—";
}

function renderSourceCell(bundle, formatsIndex) {
  const canonical = canonicalTierOf(bundle);
  const usageSource = bundle.usage,
    leadSource = bundle.leads;
  if (!canonical && !usageSource && !leadSource) return "—";

  const lines = [];
  if (canonical) {
    lines.push(
      `<div>${formatTier(canonical, formatsIndex)} — canonical${bundle.ranking ? "" : " (trace)"}</div>`,
    );
    if (usageSource && !sameTier(canonical, usageSource)) {
      lines.push(
        `<div class="source-subline">fallback: ${formatSource(usageSource, formatsIndex)}</div>`,
      );
    }
  } else if (usageSource) {
    lines.push(`<div>${formatSource(usageSource, formatsIndex)}</div>`);
  }
  if (leadSource && (!usageSource || !sameSource(usageSource, leadSource))) {
    lines.push(
      `<div class="source-subline"><strong>Lead:</strong> ${formatSource(leadSource, formatsIndex)}</div>`,
    );
  }
  return `<div class="source-lines">${lines.join("")}</div>`;
}

function formatTier(tier, formatsIndex) {
  const label =
    formatsIndex.find((format) => format.id === tier.formatId)?.label ||
    tier.formatId;
  return `${label} @ ${tier.cutoff}`;
}

function sameTier(a, b) {
  return Boolean(a && b && a.formatId === b.formatId && a.cutoff === b.cutoff);
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
