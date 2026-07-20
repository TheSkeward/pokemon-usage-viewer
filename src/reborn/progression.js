import {
  readLocalStorage,
  removeLocalStorage,
  writeLocalStorage,
} from '../storage/safeLocalStorage';
import {
  REBORN_TM_OPTIONS,
  REBORN_TMX_OPTIONS,
  REBORN_TUTOR_OPTIONS,
} from './progressionOptions';
import { TERRAIN_SEED_MIGRATION } from './rebornSeeds';
import { REBORN_ANALYSIS_TYPES } from './typeChart.js';
import { EVOLUTION_ACCESS_FIELDS } from './evolutionRequirements.js';
import { getRebornCheckpoint } from './badgeTimeline.js';
import { getActiveGame } from '../games/registry.js';
import { toId as normalizeSearch } from '../utils/ids.js';

// Per-game: each game's playthrough progression is its own saved state (the
// descriptor pins Reborn's pre-registry literal so existing saves survive).
const progressionStorageKey = () => getActiveGame().storage.progression;

/** Highest tracked held-item quantity; the picker treats this as "6 or more". */
export const MAX_TRACKED_ITEM_COUNT = 6;

/** Strongest opponent-type bias the team builder will weight toward (0 = off). */
export const MAX_OPPONENT_TYPE_BIAS = 6;

/** A fresh playthrough: nothing unlocked, no cap set, empty inventory. */
export const DEFAULT_REBORN_PROGRESSION = {
  checkpoint: '',
  levelCap: '',
  moveRelearnerUnlocked: false,
  daycareUnlocked: false,
  hiddenPowerTypeChangerUnlocked: false,
  availableTmIds: [],
  availableTmxIds: [],
  availableTutorMoveIds: [],
  ownedItems: {},
  opponentTypeBias: {},
};

/**
 * Reads the active game's saved progression from localStorage, normalized;
 * missing or unparseable state yields the default progression.
 * @return {Object}
 */
export function loadSavedRebornProgression() {
  const raw = readLocalStorage(progressionStorageKey(), '');

  if (!raw) return { ...DEFAULT_REBORN_PROGRESSION };

  try {
    const parsed = JSON.parse(raw);
    return normalizeRebornProgression(parsed);
  } catch (error) {
    console.warn('Failed to parse saved Reborn progression', error);
    return { ...DEFAULT_REBORN_PROGRESSION };
  }
}

/**
 * Persists the progression (normalized first) under the active game's key.
 * @return {boolean} Whether the write succeeded.
 */
export function saveRebornProgression(progression) {
  return writeLocalStorage(
    progressionStorageKey(),
    JSON.stringify(normalizeRebornProgression(progression)),
  );
}

/**
 * Deletes the active game's saved progression.
 * @return {boolean} Whether the removal succeeded.
 */
export function clearSavedRebornProgression() {
  return removeLocalStorage(progressionStorageKey());
}

/**
 * Canonicalizes any progression-shaped input (saved state, legacy saves,
 * mid-edit objects) into the schema of DEFAULT_REBORN_PROGRESSION: unknown
 * checkpoints/options drop out, counts and biases clamp to their caps, and
 * legacy fields (free-text option lists, the blanket stone gate) migrate.
 * Every mutator below funnels its result through this, so persisted state
 * is normalized by construction.
 * @param {Object=} progression
 * @return {Object}
 */
export function normalizeRebornProgression(progression = {}) {
  return {
    // The badge/post-game checkpoint the player selected (badgeTimeline.js).
    // The level cap it derives is written into levelCap, which stays the
    // single field every consumer reads.
    checkpoint: getRebornCheckpoint(progression.checkpoint)
      ? String(progression.checkpoint)
      : '',
    levelCap: normalizeStoredLevelCap(progression.levelCap),
    moveRelearnerUnlocked: Boolean(progression.moveRelearnerUnlocked),
    daycareUnlocked: Boolean(progression.daycareUnlocked),
    hiddenPowerTypeChangerUnlocked: Boolean(
      progression.hiddenPowerTypeChangerUnlocked,
    ),
    availableTmIds: normalizeOptionIds(
      progression.availableTmIds,
      REBORN_TM_OPTIONS,
      progression.availableTmsText,
    ),
    availableTmxIds: normalizeOptionIds(
      progression.availableTmxIds,
      REBORN_TMX_OPTIONS,
      progression.availableTmxsText,
    ),
    availableTutorMoveIds: normalizeOptionIds(
      progression.availableTutorMoveIds,
      REBORN_TUTOR_OPTIONS,
      progression.availableTutorsText,
    ),
    ownedItems: normalizeOwnedItems(progression.ownedItems),
    opponentTypeBias: normalizeOpponentTypeBias(progression.opponentTypeBias),
    // Evolution-method access: only explicit `false` (not yet accessible) is
    // stored — absent means accessible, so old saved progressions keep their
    // exact behavior and cache signatures.
    ...normalizeEvolutionAccess(progression),
  };
}

function normalizeEvolutionAccess(progression) {
  const access = {};
  // Legacy migration: the old blanket "evoAccessStones" gate split into
  // per-stone keys + evoAccessOtherEvoItems. A saved `false` blocks all of
  // them unless the new key was set explicitly.
  const legacyStonesBlocked = progression.evoAccessStones === false;
  for (const field of EVOLUTION_ACCESS_FIELDS) {
    const isItemGate =
      field.item !== undefined || field.key === 'evoAccessOtherEvoItems';
    const value =
      progression[field.key] !== undefined
        ? progression[field.key]
        : isItemGate && legacyStonesBlocked
          ? false
          : undefined;
    if (value === false) access[field.key] = false;
  }
  return access;
}

/**
 * Sets one type's opponent bias, clamped to MAX_OPPONENT_TYPE_BIAS; a level
 * of 0 (or unparseable) clears the entry. Unknown types are a no-op.
 * @return {Object} The normalized progression.
 */
export function setRebornOpponentTypeBias(progression, type, level) {
  const bias = { ...(progression.opponentTypeBias || {}) };
  const parsed = Number.parseInt(level, 10);

  if (!REBORN_ANALYSIS_TYPES.includes(type)) {
    return normalizeRebornProgression(progression);
  }

  if (!Number.isFinite(parsed) || parsed <= 0) {
    delete bias[type];
  } else {
    bias[type] = Math.min(MAX_OPPONENT_TYPE_BIAS, parsed);
  }

  return normalizeRebornProgression({ ...progression, opponentTypeBias: bias });
}

/**
 * Sets one owned item's count, clamped to MAX_TRACKED_ITEM_COUNT; a count of
 * 0 (or unparseable) clears the entry.
 * @return {Object} The normalized progression.
 */
export function setRebornOwnedItemCount(progression, itemId, count) {
  const id = String(itemId || '').trim();
  if (!id) return normalizeRebornProgression(progression);

  const owned = { ...(progression.ownedItems || {}) };
  const parsed = Number.parseInt(count, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    delete owned[id];
  } else {
    owned[id] = Math.min(MAX_TRACKED_ITEM_COUNT, parsed);
  }

  return normalizeRebornProgression({ ...progression, ownedItems: owned });
}

/**
 * Bulk inventory merge (shop sync / batch adds): raises each item to the
 * given count, never LOWERING one — re-running a sync can't shrink a stack
 * the player recorded by hand. Counts clamp to the tracking cap.
 * @param {Object} progression
 * @param {Object<string, number>=} counts Item id -> target count.
 * @return {Object} The normalized progression.
 */
export function addRebornOwnedItems(progression, counts = {}) {
  const owned = { ...(progression.ownedItems || {}) };
  for (const [itemId, count] of Object.entries(counts)) {
    const id = String(itemId || '').trim();
    const parsed = Number.parseInt(count, 10);
    if (!id || !Number.isFinite(parsed) || parsed <= 0) continue;
    owned[id] = Math.min(
      MAX_TRACKED_ITEM_COUNT,
      Math.max(owned[id] || 0, parsed),
    );
  }
  return normalizeRebornProgression({ ...progression, ownedItems: owned });
}

/**
 * Selecting a badge/post-game checkpoint derives the level cap from the
 * timeline — the player deals in badges; the cap is a consequence. An unknown
 * checkpoint id clears the selection (the cap keeps its last value).
 * @return {Object} The normalized progression.
 */
export function applyRebornCheckpoint(progression, checkpointId) {
  const checkpoint = getRebornCheckpoint(checkpointId);
  if (!checkpoint) {
    return normalizeRebornProgression({ ...progression, checkpoint: '' });
  }
  return normalizeRebornProgression({
    ...progression,
    checkpoint: checkpoint.id,
    levelCap: String(checkpoint.levelCap),
  });
}

/**
 * Sets one progression field and renormalizes.
 * @return {Object} The normalized progression.
 */
export function updateRebornProgressionField(progression, field, value) {
  return normalizeRebornProgression({
    ...progression,
    [field]: value,
  });
}

/**
 * Adds or removes a single id in one of the option-list fields
 * (availableTmIds / availableTmxIds / availableTutorMoveIds).
 * @return {Object} The normalized progression.
 */
export function updateRebornProgressionOption(
  progression,
  field,
  optionId,
  checked,
) {
  const current = new Set(
    Array.isArray(progression[field]) ? progression[field] : [],
  );

  if (checked) current.add(optionId);
  else current.delete(optionId);

  return normalizeRebornProgression({
    ...progression,
    [field]: [...current],
  });
}

/**
 * Replaces one option-list field wholesale (select-all / clear-all).
 * @param {Object} progression
 * @param {string} field
 * @param {?Array<string>} optionIds Non-arrays clear the field.
 * @return {Object} The normalized progression.
 */
export function setRebornProgressionOptions(progression, field, optionIds) {
  return normalizeRebornProgression({
    ...progression,
    [field]: Array.isArray(optionIds) ? optionIds : [],
  });
}

/**
 * Reborn's post-game raises the cap past 100 (to 150). Damage/stat math
 * still clamps levels to 100 internally (damageModel's normalizeLevel); the
 * cap only widens legality and reachability. An unset cap reads as 100, the
 * main-game maximum.
 * @param {*} value Number-ish; clamped to [1, 150].
 * @return {number}
 */
export function normalizeLevelCap(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 100;
  if (parsed < 1) return 1;
  if (parsed > 150) return 150;
  return parsed;
}

// Storage keeps the cap as text with "" meaning unset — an empty field must
// round-trip as empty, not harden into a number.
function normalizeStoredLevelCap(value) {
  const text = String(value || '').trim();
  if (!text || !Number.isFinite(Number.parseInt(text, 10))) return '';
  return String(normalizeLevelCap(text));
}

function normalizeOptionIds(value, options, legacyText = '') {
  const allowed = new Set(options.map((option) => option.id));
  const ids = new Set();

  for (const raw of Array.isArray(value) ? value : []) {
    const id = String(raw || '').trim();
    if (allowed.has(id)) ids.add(id);
  }

  for (const rawToken of String(legacyText || '').split(/[,\n]+/)) {
    const token = normalizeSearch(rawToken);
    if (!token) continue;

    const match = options.find(
      (option) =>
        normalizeSearch(option.id) === token ||
        normalizeSearch(option.code) === token ||
        normalizeSearch(option.move) === token,
    );

    if (match) ids.add(match.id);
  }

  return [...ids].sort(
    (a, b) =>
      options.findIndex((option) => option.id === a) -
      options.findIndex((option) => option.id === b),
  );
}

function normalizeOpponentTypeBias(value) {
  if (!value || typeof value !== 'object') return {};

  const bias = {};

  for (const type of REBORN_ANALYSIS_TYPES) {
    const level = Number.parseInt(value[type], 10);
    if (!Number.isFinite(level) || level <= 0) continue;
    bias[type] = Math.min(MAX_OPPONENT_TYPE_BIAS, level);
  }

  return bias;
}

function normalizeOwnedItems(value) {
  if (!value || typeof value !== 'object') return {};

  const owned = {};

  for (const [rawId, rawCount] of Object.entries(value)) {
    const trimmed = String(rawId || '').trim();
    if (!trimmed) continue;

    const count = Number.parseInt(rawCount, 10);
    if (!Number.isFinite(count) || count <= 0) continue;

    // Replaced terrain seeds migrate to their Reborn equivalent (summing counts,
    // since several terrains map to the same field seed).
    const id = TERRAIN_SEED_MIGRATION[trimmed] || trimmed;
    owned[id] = Math.min(MAX_TRACKED_ITEM_COUNT, (owned[id] || 0) + count);
  }

  return owned;
}

