import { escapeHtml } from "../utils/html.js";
export function renderResolverControls(container, state, availability) {
  const months = Object.keys(availability?.months || {})
    .sort()
    .reverse();
  container.innerHTML = `
    <section class="panel">
      <div class="toolbar resolver-toolbar">
        <label><span>Period</span><select id="resolver-month-select">
          <option value="all" ${state.resolverMonth === "all" ? "selected" : ""}>All available</option>
          ${months.map((month) => `<option value="${month}" ${month === state.resolverMonth ? "selected" : ""}>${month}</option>`).join("")}
        </select></label>
        <label class="wide-control"><span>Pokémon</span><input id="resolver-query-input" type="search" value="${escapeHtml(state.resolverQuery)}" placeholder="Charizard, Butterfree, Purrloin" /></label>
      </div>
    </section>`;
}
