import {
  REBORN_MOVE_LEGALITY_BASE,
  REBORN_PROGRESSION_NOTES,
  REBORN_PROMOTED_TM_MOVES,
  REBORN_TMX_MOVES,
} from "./rules";
import {
  REBORN_TUTOR_GROUPS,
  REBORN_TM_OPTIONS,
  REBORN_TMX_OPTIONS,
} from "./progressionOptions";

export function renderRebornProgressionPanel(progression) {
  return `
    <section class="panel progression-panel">
      <div class="panel-header">
        <div>
          <h2>Reborn Progression</h2>
          <p>Saved locally. These unlocks will drive legal-move checks; current team picks still use the usage-data prior.</p>
        </div>
      </div>

      <div class="progression-grid">
        <label>
          <span>Level cap</span>
          <input
            id="progression-level-cap"
            data-progression-field="levelCap"
            type="number"
            min="1"
            max="100"
            inputmode="numeric"
            value="${escapeAttr(progression.levelCap)}"
            placeholder="e.g. 45"
          />
        </label>

        <label class="checkbox-label">
          <input
            data-progression-field="moveRelearnerUnlocked"
            type="checkbox"
            ${progression.moveRelearnerUnlocked ? "checked" : ""}
          />
          <span>Move relearner unlocked</span>
        </label>

        <label class="checkbox-label">
          <input
            data-progression-field="daycareUnlocked"
            type="checkbox"
            ${progression.daycareUnlocked ? "checked" : ""}
          />
          <span>Daycare / breeding unlocked</span>
        </label>

        ${renderOptionGroup({
          field: "availableTmIds",
          options: REBORN_TM_OPTIONS,
          selectedIds: progression.availableTmIds,
          summary: "Available TMs",
        })}

        ${renderOptionGroup({
          field: "availableTmxIds",
          options: REBORN_TMX_OPTIONS,
          selectedIds: progression.availableTmxIds,
          summary: "Available TMXs",
        })}

        ${renderOptionGroup({
          field: "availableTutorMoveIds",
          groups: REBORN_TUTOR_GROUPS,
          selectedIds: progression.availableTutorMoveIds,
          summary: "Available tutors",
        })}
      </div>

      <details class="progression-rules">
        <summary>Reborn legality assumptions</summary>
        <ul>
          <li>Base: ${escapeHtml(REBORN_MOVE_LEGALITY_BASE.baseGames)} learnsets.</li>
          <li>Transfer moves available by default: ${REBORN_MOVE_LEGALITY_BASE.transferMovesAvailableByDefault ? "yes" : "no"}.</li>
          <li>TMX moves: ${REBORN_TMX_MOVES.map(escapeHtml).join(", ")}.</li>
          <li>Promoted TMs: ${REBORN_PROMOTED_TM_MOVES.map(escapeHtml).join(", ")}.</li>
          ${REBORN_PROGRESSION_NOTES.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}
        </ul>
      </details>

      <div class="toolbar">
        <button class="view-tab danger-button" id="clear-progression-button">Clear progression</button>
        <span class="muted" data-progression-status></span>
      </div>
    </section>
  `;
}

function renderOptionGroup({
  field,
  groups = null,
  options = [],
  selectedIds = [],
  summary,
}) {
  const selected = new Set(selectedIds);
  const uniqueOptions = groups ? getUniqueGroupOptions(groups) : options;
  const selectedCount = uniqueOptions.reduce(
    (count, option) => count + (selected.has(option.id) ? 1 : 0),
    0,
  );

  return `
    <details class="progression-option-group wide-control" open>
      <summary>
        <span>${escapeHtml(summary)}</span>
        <span class="progression-option-count">${selectedCount}/${uniqueOptions.length} selected</span>
      </summary>
      ${
        groups
          ? renderOptionSubgroups({ field, groups, selected })
          : `<div class="progression-checklist">${options.map((option) => renderOptionCheckbox({ field, option, selected })).join("")}</div>`
      }
    </details>
  `;
}

function renderOptionSubgroups({ field, groups, selected }) {
  return `
    <div class="progression-subgroups">
      ${groups
        .map(
          (group) => `
            <section class="progression-subgroup">
              <div class="progression-subgroup-title">
                <strong>${escapeHtml(group.label)}</strong>
                <span>${escapeHtml(group.available)}</span>
              </div>
              <div class="progression-checklist compact">
                ${group.options
                  .map((option) =>
                    renderOptionCheckbox({ field, option, selected }),
                  )
                  .join("")}
              </div>
            </section>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderOptionCheckbox({ field, option, selected }) {
  return `
    <label class="progression-option">
      <input
        type="checkbox"
        data-progression-option-list="${escapeAttr(field)}"
        value="${escapeAttr(option.id)}"
        ${selected.has(option.id) ? "checked" : ""}
      />
      <span>
        ${option.code ? `<strong>${escapeHtml(option.code)}</strong> ` : ""}
        ${escapeHtml(option.move)}
        ${
          option.available
            ? `<small>${escapeHtml(option.available)}${option.location ? ` - ${escapeHtml(option.location)}` : ""}</small>`
            : ""
        }
      </span>
    </label>
  `;
}

function getUniqueGroupOptions(groups) {
  const seen = new Set();
  const options = [];

  for (const group of groups) {
    for (const option of group.options) {
      if (seen.has(option.id)) continue;
      seen.add(option.id);
      options.push(option);
    }
  }

  return options;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
