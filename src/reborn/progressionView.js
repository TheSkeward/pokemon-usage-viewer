import { escapeHtml, escapeAttr } from '../utils/html.js';
import { detailsStateAttrs } from '../utils/detailsState.js';
import { getMoveMeta, describeMoveMeta } from '../moveMeta';
import {
  REBORN_MOVE_LEGALITY_BASE,
  REBORN_PROGRESSION_NOTES,
  REBORN_PROMOTED_TM_MOVES,
  REBORN_TMX_MOVES,
} from './rules';
import {
  REBORN_TUTOR_GROUPS,
  REBORN_TM_OPTIONS,
  REBORN_TMX_OPTIONS,
} from './progressionOptions';
import { EVOLUTION_ACCESS_FIELDS } from './evolutionRequirements.js';
import {
  REBORN_PROGRESSION_CHECKPOINTS,
  getRebornCheckpoint,
  getItemUnlockBadge,
  getUnlockBadge,
} from './badgeTimeline.js';
import {
  REBORN_EXTRA_INVENTORY_ITEMS,
  getPurchasableShopItems,
} from './itemAvailability.js';
import { MAX_TRACKED_ITEM_COUNT, MAX_OPPONENT_TYPE_BIAS } from './progression';
import { HIDDEN_INVENTORY_ITEM_IDS } from './rebornSeeds';
import { REBORN_ANALYSIS_TYPES } from './typeChart.js';
import { getTypeColor } from '../moveMeta';
import {
  GEN7_HELD_ITEMS,
  GEN7_HELD_ITEMS_BY_ID,
} from '../generated/gen7HeldItems.generated.js';

/**
 * `includeBias: false` lets the modern layout render the opponent-bias group
 * next to the Optimize button instead (it changes per-fight, unlike the
 * save-file settings here); classic keeps it in this panel.
 * @return {string} Panel HTML.
 */
export function renderRebornProgressionPanel(progression, { includeBias = true } = {}) {
  return `
    <section class="panel progression-panel">
      <div class="panel-header">
        <div>
          <h2>Reborn Progression</h2>
          <p>Saved locally. These unlocks drive legal-move checks, set readiness, and (under V1) how far each score has converged to its usage prior.</p>
        </div>
      </div>

      <div class="progression-grid">
        ${renderCheckpointControl(progression)}

        <label class="checkbox-label">
          <input
            data-progression-field="moveRelearnerUnlocked"
            type="checkbox"
            ${progression.moveRelearnerUnlocked ? 'checked' : ''}
          />
          <span>Move relearner unlocked</span>
        </label>

        <label class="checkbox-label">
          <input
            data-progression-field="daycareUnlocked"
            type="checkbox"
            ${progression.daycareUnlocked ? 'checked' : ''}
          />
          <span>Daycare unlocked</span>
        </label>

        <label class="checkbox-label">
          <input
            data-progression-field="hiddenPowerTypeChangerUnlocked"
            type="checkbox"
            ${progression.hiddenPowerTypeChangerUnlocked ? 'checked' : ''}
          />
          <span>Hidden Power Type Changer unlocked</span>
        </label>

        <details class="progression-option-group wide-control evo-access-group" ${detailsStateAttrs('evo-access', false)}>
          <summary>
            <span>Evolution access <span class="muted">(checked = you can use it)</span></span>
          </summary>
          <div class="progression-checklist evo-access-checklist">
            ${EVOLUTION_ACCESS_FIELDS.map((field) => {
              // Stones are timed by the item timeline (the community guide);
              // area/method gates by the walkthrough schedule.
              const badge = field.item
                ? getItemUnlockBadge(
                  field.item.toLowerCase().replace(/[^a-z0-9]+/g, ''),
                )
                : getUnlockBadge(field.key);
              return `
                <label class="checkbox-label">
                  <input
                    data-progression-field="${escapeAttr(field.key)}"
                    type="checkbox"
                    ${progression[field.key] === false ? '' : 'checked'}
                  />
                  <span>${escapeHtml(field.label)}${badge != null ? ` <small class="muted">(~${badge} badge${badge === 1 ? '' : 's'})</small>` : ''}</span>
                </label>`;
            }).join('')}
          </div>
        </details>

        ${renderOptionGroup({
          field: 'availableTmIds',
          options: REBORN_TM_OPTIONS,
          selectedIds: progression.availableTmIds,
          summary: 'Available TMs',
          detailsId: 'tms',
          badges: getRebornCheckpoint(progression.checkpoint)?.badges ?? null,
        })}

        ${renderOptionGroup({
          field: 'availableTmxIds',
          options: REBORN_TMX_OPTIONS,
          selectedIds: progression.availableTmxIds,
          summary: 'Available TMXs',
          detailsId: 'tmxs',
          badges: getRebornCheckpoint(progression.checkpoint)?.badges ?? null,
        })}

        ${renderOptionGroup({
          field: 'availableTutorMoveIds',
          groups: REBORN_TUTOR_GROUPS,
          selectedIds: progression.availableTutorMoveIds,
          summary: 'Available tutors',
          detailsId: 'tutors',
          badges: getRebornCheckpoint(progression.checkpoint)?.badges ?? null,
        })}

        ${renderItemInventory(
          progression.ownedItems || {},
          getRebornCheckpoint(progression.checkpoint)?.badges ?? null,
        )}

        ${includeBias ? renderOpponentTypeBias(progression.opponentTypeBias || {}) : ''}
      </div>

      <details class="progression-rules" ${detailsStateAttrs('rules', false)}>
        <summary>Reborn legality assumptions</summary>
        <ul>
          <li>Base: ${escapeHtml(REBORN_MOVE_LEGALITY_BASE.baseGames)} learnsets.</li>
          <li>Transfer moves available by default: ${REBORN_MOVE_LEGALITY_BASE.transferMovesAvailableByDefault ? 'yes' : 'no'}.</li>
          <li>TMX moves: ${REBORN_TMX_MOVES.map(escapeHtml).join(', ')}.</li>
          <li>Promoted TMs: ${REBORN_PROMOTED_TM_MOVES.map(escapeHtml).join(', ')}.</li>
          ${REBORN_PROGRESSION_NOTES.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}
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
      <option value="${escapeAttr(checkpoint.id)}" ${selected?.id === checkpoint.id ? 'selected' : ''}>
        ${escapeHtml(`${checkpoint.label} — cap ${checkpoint.levelCap}`)}
      </option>`,
  ).join('');

  const capNote = selected
    ? `Level cap ${selected.levelCap} (from badges)`
    : progression.levelCap
      ? `Level cap ${progression.levelCap} (saved before the badge picker; pick your badges to keep it in sync)`
      : 'Pick your badges to set the level cap.';

  const selectedIndex = selected
    ? REBORN_PROGRESSION_CHECKPOINTS.findIndex((c) => c.id === selected.id)
    : -1;
  const next =
    selectedIndex >= 0 ? REBORN_PROGRESSION_CHECKPOINTS[selectedIndex + 1] : null;
  const nextTip = selected
    ? next
      ? `Next: ${next.label} — cap ${next.levelCap}`
      : `Final checkpoint — cap ${selected.levelCap}`
    : '';

  return `
    <label class="progression-level-control wide-control"${nextTip ? ` title="${escapeAttr(nextTip)}"` : ''}>
      <span>Badges earned</span>
      <select data-progression-checkpoint>
        <option value="" ${selected ? '' : 'selected'}>— choose —</option>
        ${options}
      </select>
      <span class="muted" data-checkpoint-cap-note>${escapeHtml(capNote)}</span>
    </label>
  `;
}

/**
 * @param {!Object<string, number>} bias Per-type bias weights.
 * @return {string} The opponent-type-bias control group HTML.
 */
export function renderOpponentTypeBias(bias) {
  const activeCount = REBORN_ANALYSIS_TYPES.filter(
    (type) => (bias[type] || 0) > 0,
  ).length;

  return `
    <details class="progression-option-group wide-control opponent-bias-group" ${detailsStateAttrs('bias', false)}>
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
        ).join('')}
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

function renderItemInventory(ownedItems, badges) {
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
    .join('');

  const ownedRows = ownedIds.length
    ? ownedIds
      .map((item) => renderOwnedItemRow(item, ownedItems[item.id]))
      .join('')
    : '<p class="muted">No held items added yet. Search above to add what you own.</p>';

  return `
    <details class="progression-option-group wide-control" ${detailsStateAttrs('items', true)}>
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
        <label class="item-inventory-add-count">
          <span class="visually-hidden">Quantity to add as</span>
          <select
            data-item-add-count
            title="Quantity the item is added at. 6+ means effectively unlimited — the default, because most tracked items are renewable shop stock. Enter in the search box adds too."
          >
            ${Array.from({ length: MAX_TRACKED_ITEM_COUNT }, (_, index) => {
              const value = index + 1;
              const label =
                value === MAX_TRACKED_ITEM_COUNT ? `${value}+` : `${value}`;
              const selected =
                value === MAX_TRACKED_ITEM_COUNT ? ' selected' : '';
              return `<option value="${value}"${selected}>×${label}</option>`;
            }).join('')}
          </select>
        </label>
        <button type="button" data-item-add-button>Add</button>
      </div>

      ${renderPurchasableShopItems(ownedItems, badges)}

      <div class="item-inventory-list">${ownedRows}</div>
    </details>
  `;
}

// One-click shop sync: lists what the badge-timed shop schedule says is
// purchasable now but untracked, with a single "add all as 6+" (renewable
// stock: buy as many as you need).
function renderPurchasableShopItems(ownedItems, badges) {
  const purchasable = getPurchasableShopItems(badges, ownedItems);
  if (!purchasable.length) return '';

  const names = purchasable
    .map((item) => `<span class="item-shop-name">${escapeHtml(item.name)}</span>`)
    .join(', ');

  return `
    <details class="item-shop-sync" ${detailsStateAttrs('shop-sync', false)}>
      <summary>
        <span>Purchasable at your badge, not tracked yet</span>
        <span class="progression-option-count">${purchasable.length}</span>
      </summary>
      <p class="muted item-shop-hint">
        Shop stock timed by the community item guide. Renewable — adding at
        6+ means "I can buy as many as I need".
      </p>
      <button type="button" data-shop-sync-button>
        Add all ${purchasable.length} as 6+
      </button>
      <p class="item-shop-list">${names}</p>
    </details>
  `;
}

function renderOwnedItemRow(item, count) {
  const options = Array.from({ length: MAX_TRACKED_ITEM_COUNT }, (_, index) => {
    const value = index + 1;
    const label = value === MAX_TRACKED_ITEM_COUNT ? `${value}+` : `${value}`;
    return `<option value="${value}" ${value === count ? 'selected' : ''}>${label}</option>`;
  }).join('');

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
  const match = /Badge\s+(\d+)/i.exec(String(available || ''));
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
    <details class="progression-option-group wide-control" data-progression-group="${escapeAttr(field)}" ${detailsStateAttrs(detailsId || field, true)}>
      <summary>
        <span>${escapeHtml(summary)}</span>
        <span class="progression-option-count" data-progression-group-count data-option-total="${uniqueOptions.length}">${selectedCount}/${uniqueOptions.length} selected${missableCount ? ` · ${missableCount} obtainable now` : ''}</span>
      </summary>
      ${renderObtainableRail({ field, uniqueOptions, availabilityById, selected, badges })}
      <div class="progression-option-actions">
        <button
          type="button"
          data-progression-option-bulk="${escapeAttr(field)}"
          data-progression-option-action="select"
          data-progression-option-ids="${escapeAttr(uniqueOptions.map((option) => option.id).join(','))}"
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
          : `<div class="progression-checklist">${options.map((option) => renderOptionCheckbox({ field, option, selected, badges })).join('')}</div>`
      }
    </details>
  `;
}

// The "go pick these up" rail: everything the badge schedule says is
// obtainable but unchecked, pinned at the top of the group. The canonical
// full list below keeps its stable order — this is a second view of the same
// checkboxes, not a reordering, and the change handler syncs twins so
// ticking a row in either place updates both.
function renderObtainableRail({
  field,
  uniqueOptions,
  availabilityById,
  selected,
  badges,
}) {
  if (badges == null) return '';
  const obtainable = uniqueOptions.filter((option) => {
    const badge = parseAvailabilityBadge(availabilityById.get(option.id));
    return badge != null && badge <= badges && !selected.has(option.id);
  });
  if (!obtainable.length) return '';
  return `
    <div class="progression-obtainable-rail">
      <div class="progression-subgroup-title">
        <strong>Obtainable now, not checked</strong>
        <span>${obtainable.length}</span>
      </div>
      <div class="progression-checklist compact">
        ${obtainable
          .map((option) =>
            renderOptionCheckbox({
              field,
              option,
              selected,
              badges,
              fallbackAvailable: availabilityById.get(option.id) || '',
            }),
          )
          .join('')}
      </div>
    </div>
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
                <button
                  type="button"
                  class="progression-subgroup-all"
                  data-progression-subgroup-all="${escapeAttr(field)}"
                  data-progression-option-ids="${escapeAttr(group.options.map((option) => option.id).join(','))}"
                  title="Mark every move from this ${escapeHtml(group.label)} location as available"
                >
                  All
                </button>
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
                  .join('')}
              </div>
            </section>
          `,
        )
        .join('')}
    </div>
  `;
}

function renderOptionCheckbox({
  field,
  option,
  selected,
  badges = null,
  fallbackAvailable = '',
}) {
  const badge = parseAvailabilityBadge(option.available || fallbackAvailable);
  // "Reachable at the current badge" is stamped as data so the change handler
  // can retoggle the highlight (and recount the summary) IN PLACE — checkbox
  // clicks deliberately don't re-render (a re-render resets the viewport).
  const badgeOk = badges != null && badge != null && badge <= badges;
  const obtainable = badgeOk && !selected.has(option.id);
  const facts = describeMoveMeta(getMoveMeta(option.move));
  return `
    <label class="progression-option${obtainable ? ' option-obtainable' : ''}"${badgeOk ? ' data-option-badge-ok="1"' : ''}${facts ? ` title="${escapeAttr(facts)}"` : ''}>
      <input
        type="checkbox"
        data-progression-option-list="${escapeAttr(field)}"
        value="${escapeAttr(option.id)}"
        ${selected.has(option.id) ? 'checked' : ''}
      />
      <span>
        ${option.code ? `<strong>${escapeHtml(option.code)}</strong> ` : ''}
        ${escapeHtml(option.move)}
        ${
          option.available
            ? `<small>${escapeHtml(option.available)}${option.location ? ` - ${escapeHtml(option.location)}` : ''}</small>`
            : ''
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


