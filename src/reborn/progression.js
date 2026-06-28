import {
  readLocalStorage,
  removeLocalStorage,
  writeLocalStorage,
} from "../storage/safeLocalStorage";
import {
  REBORN_TM_OPTIONS,
  REBORN_TMX_OPTIONS,
  REBORN_TUTOR_OPTIONS,
} from "./progressionOptions";
import { TERRAIN_SEED_MIGRATION } from "./rebornSeeds";
import { REBORN_ANALYSIS_TYPES } from "./typeChart.js";

const PROGRESSION_STORAGE_KEY = "pokemon-usage-viewer:reborn-progression:v1";

// Highest tracked held-item quantity; the picker treats this as "6 or more".
export const MAX_TRACKED_ITEM_COUNT = 6;

// Strongest opponent-type bias the team builder will weight toward (0 = off).
export const MAX_OPPONENT_TYPE_BIAS = 6;

export const DEFAULT_REBORN_PROGRESSION = {
  levelCap: "",
  moveRelearnerUnlocked: false,
  daycareUnlocked: false,
  availableTmIds: [],
  availableTmxIds: [],
  availableTutorMoveIds: [],
  ownedItems: {},
  opponentTypeBias: {},
};

export function loadSavedRebornProgression() {
  const raw = readLocalStorage(PROGRESSION_STORAGE_KEY, "");

  if (!raw) return { ...DEFAULT_REBORN_PROGRESSION };

  try {
    const parsed = JSON.parse(raw);
    return normalizeRebornProgression(parsed);
  } catch (error) {
    console.warn("Failed to parse saved Reborn progression", error);
    return { ...DEFAULT_REBORN_PROGRESSION };
  }
}

export function saveRebornProgression(progression) {
  return writeLocalStorage(
    PROGRESSION_STORAGE_KEY,
    JSON.stringify(normalizeRebornProgression(progression)),
  );
}

export function clearSavedRebornProgression() {
  return removeLocalStorage(PROGRESSION_STORAGE_KEY);
}

export function normalizeRebornProgression(progression = {}) {
  return {
    levelCap: normalizeLevelCap(progression.levelCap),
    moveRelearnerUnlocked: Boolean(progression.moveRelearnerUnlocked),
    daycareUnlocked: Boolean(progression.daycareUnlocked),
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
  };
}

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

export function setRebornOwnedItemCount(progression, itemId, count) {
  const id = String(itemId || "").trim();
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

export function updateRebornProgressionField(progression, field, value) {
  return normalizeRebornProgression({
    ...progression,
    [field]: value,
  });
}

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

export function setRebornProgressionOptions(progression, field, optionIds) {
  return normalizeRebornProgression({
    ...progression,
    [field]: Array.isArray(optionIds) ? optionIds : [],
  });
}

function normalizeLevelCap(value) {
  const text = String(value || "").trim();

  if (!text) return "";

  const parsed = Number.parseInt(text, 10);

  if (!Number.isFinite(parsed)) return "";
  if (parsed < 1) return "1";
  if (parsed > 100) return "100";

  return String(parsed);
}

function normalizeOptionIds(value, options, legacyText = "") {
  const allowed = new Set(options.map((option) => option.id));
  const ids = new Set();

  for (const raw of Array.isArray(value) ? value : []) {
    const id = String(raw || "").trim();
    if (allowed.has(id)) ids.add(id);
  }

  for (const rawToken of String(legacyText || "").split(/[,\n]+/)) {
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
  if (!value || typeof value !== "object") return {};

  const bias = {};

  for (const type of REBORN_ANALYSIS_TYPES) {
    const level = Number.parseInt(value[type], 10);
    if (!Number.isFinite(level) || level <= 0) continue;
    bias[type] = Math.min(MAX_OPPONENT_TYPE_BIAS, level);
  }

  return bias;
}

function normalizeOwnedItems(value) {
  if (!value || typeof value !== "object") return {};

  const owned = {};

  for (const [rawId, rawCount] of Object.entries(value)) {
    const trimmed = String(rawId || "").trim();
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

function normalizeSearch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}
