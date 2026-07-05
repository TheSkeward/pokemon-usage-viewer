import { escapeHtml, escapeAttr } from "../utils/html.js";
import { detailsStateAttrs } from "../utils/detailsState.js";
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
import { EVOLUTION_ACCESS_FIELDS } from "./evolutionRequirements.js";
import {
  REBORN_PROGRESSION_CHECKPOINTS,
  getRebornCheckpoint,
  getUnlockBadge,
} from "./badgeTimeline.js";
import { REBORN_EXTRA_INVENTORY_ITEMS } from "./itemAvailability.js";
import { MAX_TRACKED_ITEM_COUNT, MAX_OPPONENT_TYPE_BIAS } from "./progression";
import { HIDDEN_INVENTORY_ITEM_IDS } from "./rebornSeeds";
import { REBORN_ANALYSIS_TYPES } from "./typeChart.js";
import { getTypeColor } from "../moveMeta";
import {
  GEN7_HELD_ITEMS,
  GEN7_HELD_ITEMS_BY_ID,
} from "../generated/gen7HeldItems.generated.js";

// `includeBias: false` lets the modern layout render the opponent-bias group
// next to the Optimize button instead (it changes per-fight, unlike the
// save-file settings here); classic keeps it in this panel.
export function renderRebornProgressionPanel(progression, { includeBias = true } = {}) {
  return `
    <section class="panel progression-panel">
      <div class="panel-header">
        <div>
          <h2>Reborn Progression</h2>
          <p>Saved locally. These unlocks will drive legal-move checks; current team picks still use the usage-data prior.</p>
        </div>
      </div>

      <div class="progression-grid">
        ${renderCheckpointControl(progression)}

        <label class="checkbox-label">
          <input
            data-progression-field="moveRelearnerUnlocked"
            type="checkbox"
            ${progression.moveRelearnerUnlocked ? "checked" : ""}
          />
          <span>Move relearner unlocked</span>
        </label>

        <label class="checkbox-label" title="Egg moves need breeding-chain checks before they count as legal.">
          <input
            data-progression-field="daycareUnlocked"
            type="checkbox"
            ${progression.daycareUnlocked ? "checked" : ""}
          />
          <span>Daycare unlocked</span>
          <span class="info-tip" aria-hidden="true">ⓘ</span>
        </label>

        <label class="checkbox-label" title="Until the Type Changer, Hidden Power's type is random per caught mon, so it isn't recommended; once unlocked every type is evaluated and the best one is picked.">
          <input
            data-progression-field="hiddenPowerTypeChangerUnlocked"
            type="checkbox"
            ${progression.hiddenPowerTypeChangerUnlocked ? "checked" : ""}
          />
          <span>Hidden Power Type Changer unlocked</span>
          <span class="info-tip" aria-hidden="true">ⓘ</span>
        </label>

        <details class="progression-option-group wide-control evo-access-group" ${detailsStateAttrs("evo-access", false)}>
          <summary title="Checked means you can use that method now, so evolutions through it count as reachable. Uncheck what you can't use yet — those evolutions become blocked, and each pick lists the forms it lost.">
            <span>Evolution access <span class="muted">(checked = you can use it)</span></span>
            <span class="info-tip" aria-hidden="true">ⓘ</span>
          </summary>
          <div class="progression-checklist evo-access-checklist">
            ${EVOLUTION_ACCESS_FIELDS.map((field) => {
              const badge = getUnlockBadge(field.key);
              return `
                <label class="checkbox-label">
                  <input
                    data-progression-field="${escapeAttr(field.key)}"
                    type="checkbox"
                    ${progression[field.key] === false ? "" : "checked"}
                  />
                  <span>${escapeHtml(field.label)}${badge != null ? ` <small class="muted">(~${badge} badge${badge === 1 ? "" : "s"})</small>` : ""}</span>
                </label>`;
            }).join("")}
          </div>
        </details>

        ${renderOptionGroup({
          field: "availableTmIds",
          options: REBORN_TM_OPTIONS,
          selectedIds: progression.availableTmIds,
          summary: "Available TMs",
          detailsId: "tms",
          badges: getRebornCheckpoint(progression.checkpoint)?.badges ?? null,
        })}

        ${renderOptionGroup({
          field: "availableTmxIds",
          options: REBORN_TMX_OPTIONS,
          selectedIds: progression.availableTmxIds,
          summary: "Available TMXs",
          detailsId: "tmxs",
          badges: getRebornCheckpoint(progression.checkpoint)?.badges ?? null,
        })}

        ${renderOptionGroup({
          field: "availableTutorMoveIds",
          groups: REBORN_TUTOR_GROUPS,
          selectedIds: progression.availableTutorMoveIds,
          summary: "Available tutors",
          detailsId: "tutors",
          badges: getRebornCheckpoint(progression.checkpoint)?.badges ?? null,
        })}

        ${renderItemInventory(progression.ownedItems || {})}

        ${includeBias ? renderOpponentTypeBias(progression.opponentTypeBias || {}) : ""}
      </div>

      <details class="progression-rules" ${detailsStateAttrs("rules", false)}>
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

// The badge picker: the atomic unit of progression the player deals with.
// The level cap is derived from the walkthrough timeline, never typed.
function renderCheckpointControl(progression) {
  const selected = getRebornCheckpoint(progression.checkpoint);
  const options = REBORN_PROGRESSION_CHECKPOINTS.map(
    (checkpoint) => `
      <option value="${escapeAttr(checkpoint.id)}" ${selected?.id === checkpoint.id ? "selected" : ""}>
        ${escapeHtml(`${checkpoint.label} — cap ${checkpoint.levelCap}`)}
      </option>`,
  ).join("");

  const capNote = selected
    ? `Level cap ${selected.levelCap} (from badges)`
    : progression.levelCap
      ? `Level cap ${progression.levelCap} (saved before the badge picker; pick your badges to keep it in sync)`
      : "Pick your badges to set the level cap.";

  return `
    <label class="progression-level-control wide-control" title="Level caps, per BIGJRA's walkthrough. Post-game tiers keep raising the cap after the 18th badge.">
      <span>Badges earned</span>
      <select data-progression-checkpoint>
        <option value="" ${selected ? "" : "selected"}>— choose —</option>
        ${options}
      </select>
      <span class="muted" data-checkpoint-cap-note>${escapeHtml(capNote)}</span>
    </label>
  `;
}

export function renderOpponentTypeBias(bias) {
  const activeCount = REBORN_ANALYSIS_TYPES.filter(
    (type) => (bias[type] || 0) > 0,
  ).length;

  return `
    <details class="progression-option-group wide-control opponent-bias-group" ${detailsStateAttrs("bias", false)}>
      <summary>
        <span>Opponent type bias</span>
        <span class="progression-option-count">${activeCount} active</span>
      </summary>
      <p class="muted opponent-bias-hint">
        Crank a type up (1–${MAX_OPPONENT_TYPE_BIAS}) before a heavily-typed gym
        fight to prefer picks that resist it and hit it super-effectively.
      </p>
      <div class="opponent-bias-grid">
        ${REBORN_ANALYSIS_TYPES.map((type) =>
          renderBiasRow(type, bias[type] || 0),
        ).join("")}
      </div>
    </details>
  `;
}

function renderBiasRow(type, level) {
  return `
    <label class="opponent-bias-row">
      <span class="move-badge opponent-bias-type" style="background:${getTypeColor(type)}">${escapeHtml(type)}</span>
      <input
        type="range"
        min="0"
        max="${MAX_OPPONENT_TYPE_BIAS}"
        step="1"
        value="${escapeAttr(String(level))}"
        data-bias-type="${escapeAttr(type)}"
        aria-label="${escapeHtml(type)} opponent bias level"
      />
      <span class="opponent-bias-value" data-bias-value="${escapeAttr(type)}">${level}</span>
    </label>
  `;
}

function renderItemInventory(ownedItems) {
  const extrasById = Object.fromEntries(
    REBORN_EXTRA_INVENTORY_ITEMS.map((item) => [item.id, item]),
  );
  const ownedIds = Object.keys(ownedItems)
    .map((id) => GEN7_HELD_ITEMS_BY_ID[id] || extrasById[id])
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));

  const datalistOptions = [
    ...GEN7_HELD_ITEMS.filter(
      (item) => !HIDDEN_INVENTORY_ITEM_IDS.has(item.id),
    ),
    ...REBORN_EXTRA_INVENTORY_ITEMS,
  ]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((item) => `<option value="${escapeAttr(item.name)}"></option>`)
    .join("");

  const ownedRows = ownedIds.length
    ? ownedIds
        .map((item) => renderOwnedItemRow(item, ownedItems[item.id]))
        .join("")
    : '<p class="muted">No held items added yet. Search above to add what you own.</p>';

  return `
    <details class="progression-option-group wide-control" ${detailsStateAttrs("items", true)}>
      <summary>
        <span>Held items owned</span>
        <span class="progression-option-count">${ownedIds.length} tracked</span>
      </summary>

      <div class="item-inventory-add">
        <input
          type="text"
          list="reborn-item-options"
          data-item-add-input
          placeholder="Search an item, e.g. Leftovers"
          aria-label="Add a held item you own"
        />
        <datalist id="reborn-item-options">${datalistOptions}</datalist>
        <button type="button" data-item-add-button>Add</button>
      </div>

      <div class="item-inventory-list">${ownedRows}</div>
    </details>
  `;
}

function renderOwnedItemRow(item, count) {
  const options = Array.from({ length: MAX_TRACKED_ITEM_COUNT }, (_, index) => {
    const value = index + 1;
    const label = value === MAX_TRACKED_ITEM_COUNT ? `${value}+` : `${value}`;
    return `<option value="${value}" ${value === count ? "selected" : ""}>${label}</option>`;
  }).join("");

  return `
    <div class="item-inventory-row">
      <span class="item-inventory-name">${escapeHtml(item.name)}</span>
      <label class="item-inventory-count">
        <span class="visually-hidden">Quantity of ${escapeHtml(item.name)}</span>
        <select data-owned-item-count data-item-id="${escapeAttr(item.id)}">
          ${options}
        </select>
      </label>
      <button
        type="button"
        class="item-inventory-remove"
        data-owned-item-remove
        data-item-id="${escapeAttr(item.id)}"
        aria-label="Remove ${escapeHtml(item.name)}"
      >
        ✕
      </button>
    </div>
  `;
}

// "After Badge NN" (possibly with a sidequest rider) → NN, else null.
function parseAvailabilityBadge(available) {
  const match = /Badge\s+(\d+)/i.exec(String(available || ""));
  return match ? Number.parseInt(match[1], 10) : null;
}

function renderOptionGroup({
  field,
  groups = null,
  options = [],
  selectedIds = [],
  summary,
  detailsId,
  badges = null,
}) {
  const selected = new Set(selectedIds);
  const uniqueOptions = groups ? getUniqueGroupOptions(groups) : options;
  const selectedCount = uniqueOptions.reduce(
    (count, option) => count + (selected.has(option.id) ? 1 : 0),
    0,
  );
  // With a badge checkpoint chosen, count what the schedule says should be
  // obtainable but isn't checked yet — the "go pick these up" signal.
  // Tutor options inherit their group's availability.
  const availabilityById = new Map();
  if (groups) {
    for (const group of groups) {
      for (const option of group.options) {
        if (!availabilityById.has(option.id)) {
          availabilityById.set(option.id, option.available || group.available);
        }
      }
    }
  } else {
    for (const option of options) availabilityById.set(option.id, option.available);
  }
  const missableCount =
    badges == null
      ? 0
      : uniqueOptions.reduce((count, option) => {
          const badge = parseAvailabilityBadge(availabilityById.get(option.id));
          return (
            count +
            (badge != null && badge <= badges && !selected.has(option.id) ? 1 : 0)
          );
        }, 0);

  return `
    <details class="progression-option-group wide-control" ${detailsStateAttrs(detailsId || field, true)}>
      <summary>
        <span>${escapeHtml(summary)}</span>
        <span class="progression-option-count">${selectedCount}/${uniqueOptions.length} selected${missableCount ? ` · ${missableCount} obtainable now` : ""}</span>
      </summary>
      <div class="progression-option-actions">
        <button
          type="button"
          data-progression-option-bulk="${escapeAttr(field)}"
          data-progression-option-action="select"
          data-progression-option-ids="${escapeAttr(uniqueOptions.map((option) => option.id).join(","))}"
        >
          Select all
        </button>
        <button
          type="button"
          data-progression-option-bulk="${escapeAttr(field)}"
          data-progression-option-action="clear"
        >
          Clear
        </button>
      </div>
      ${
        groups
          ? renderOptionSubgroups({ field, groups, selected, badges })
          : `<div class="progression-checklist">${options.map((option) => renderOptionCheckbox({ field, option, selected, badges })).join("")}</div>`
      }
    </details>
  `;
}

function renderOptionSubgroups({ field, groups, selected, badges = null }) {
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
                    renderOptionCheckbox({
                      field,
                      option,
                      selected,
                      badges,
                      fallbackAvailable: group.available,
                    }),
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

function renderOptionCheckbox({
  field,
  option,
  selected,
  badges = null,
  fallbackAvailable = "",
}) {
  const badge = parseAvailabilityBadge(option.available || fallbackAvailable);
  const obtainable =
    badges != null && badge != null && badge <= badges && !selected.has(option.id);
  return `
    <label class="progression-option${obtainable ? " option-obtainable" : ""}"${obtainable ? ' title="The walkthrough says this is obtainable at your badge count."' : ""}>
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


