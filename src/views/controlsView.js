import { escapeHtml } from "../utils/html.js";

/**
 * Format/month/search toolbar for the Usage Data page. Synthetic formats are
 * offered only for the singles family.
 * @param {!Element} container
 * @param {!Object} state
 * @param {{months: (!Array<string>|undefined)}} dataset
 * @param {!Array<!Object>} formatsIndex
 */
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
