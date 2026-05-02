export function renderControls(container, state, dataset, formatsIndex) {
  const familyFormats = formatsIndex.filter((format) => format.family === state.family && (!format.synthetic || state.family === 'singles'));
  container.innerHTML = `
    <section class="panel">
      <div class="toolbar">
        <label><span>Format</span><select id="format-select">
          ${familyFormats.map((format) => `<option value="${format.id}" ${format.id === state.format ? 'selected' : ''}>${format.label}</option>`).join('')}
        </select></label>
        <label><span>Month</span><select id="month-select">
          <option value="all" ${state.month === 'all' ? 'selected' : ''}>All available</option>
          ${(dataset.months || []).slice().reverse().map((month) => `<option value="${month}" ${month === state.month ? 'selected' : ''}>${month}</option>`).join('')}
        </select></label>
        <label><span>Search</span><input id="search-input" type="search" value="${escapeHtml(state.search)}" placeholder="Charizard, Butterfree" /></label>
      </div>
    </section>`;
}
function escapeHtml(value) { return value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'); }
