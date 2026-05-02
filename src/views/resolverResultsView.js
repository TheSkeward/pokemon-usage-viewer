export function renderResolverResults(container, rows, state, formatsIndex, selectionLabel) {
  if (!state.resolverQuery.trim()) {
    container.innerHTML = `<section class="panel"><p class="muted">Enter one or more Pokémon to resolve best available usage, lead data, and movesets.</p></section>`;
    return;
  }
  if (rows.length === 0) {
    container.innerHTML = `<section class="panel"><p class="muted">No matching Pokémon found.</p></section>`;
    return;
  }
  container.innerHTML = `
    <section class="panel">
      <div class="panel-header"><div><h2>Resolver Results</h2><p>${rows.length} Pokémon resolved for ${selectionLabel}</p><p>Sorted by Lead % descending. Click a row to load movesets.</p></div></div>
      <table class="usage-table resolver-results-table"><thead><tr><th>Pokémon</th><th>Usage %</th><th>Lead %</th><th>Source</th></tr></thead><tbody>
        ${rows.map((row) => `<tr data-resolver-pokemon-id="${row.pokemonId}" class="${row.pokemonId === state.resolverSelectedPokemon ? 'selected' : ''}"><td>${renderPokemonCell(row)}</td><td>${row.bundle.usage ? row.bundle.usage.value.toFixed(2) : '—'}</td><td>${row.bundle.leads ? row.bundle.leads.value.toFixed(1) : '—'}</td><td>${renderSourceCell(row.bundle, formatsIndex)}</td></tr>`).join('')}
      </tbody></table>
    </section>`;
}
function renderPokemonCell(row) {
  if (row.inputName && row.inputName !== row.name) {
    return `
      <div class="representative-cell">
        <div><span class="input-mon">${escapeHtml(row.inputName)}</span> <span class="arrow">→</span> <strong>${escapeHtml(row.name)}</strong></div>
        <div class="representative-note">${row.representativeIsMega ? 'Best line representative · Mega candidate' : 'Best line representative'}</div>
      </div>
    `;
  }

  return escapeHtml(row.name);
}

function renderSourceCell(bundle, formatsIndex) {
  const usageSource = bundle.usage, leadSource = bundle.leads;
  if (!usageSource && !leadSource) return '—';
  if (sameSource(usageSource, leadSource)) return `<div class="source-lines"><div>${formatSource(usageSource, formatsIndex)}</div></div>`;
  const lines = [];
  if (usageSource) lines.push(`<div class="source-subline"><strong>Usage:</strong> ${formatSource(usageSource, formatsIndex)}</div>`);
  if (leadSource) lines.push(`<div class="source-subline"><strong>Lead:</strong> ${formatSource(leadSource, formatsIndex)}</div>`);
  return `<div class="source-lines">${lines.join('')}</div>`;
}
function sameSource(a, b) { return Boolean(a && b && a.selection === b.selection && a.formatId === b.formatId && a.cutoff === b.cutoff && a.month === b.month && a.monthsPresent === b.monthsPresent && a.monthsAvailable === b.monthsAvailable); }
function formatSource(source, formatsIndex) {
  if (!source) return '—';
  const label = formatsIndex.find((format) => format.id === source.formatId)?.label || source.formatId;
  if (source.selection === 'all') return `${label} @ ${source.cutoff} (all, ${source.monthsPresent}/${source.monthsAvailable} mo)`;
  return `${label} @ ${source.cutoff} (${source.month})`;
}
function escapeHtml(value) { return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'); }
