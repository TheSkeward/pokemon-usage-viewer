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

const PROGRESSION_STORAGE_KEY = "pokemon-usage-viewer:reborn-progression:v1";

export const DEFAULT_REBORN_PROGRESSION = {
  levelCap: "",
  moveRelearnerUnlocked: false,
  daycareUnlocked: false,
  availableTmIds: [],
  availableTmxIds: [],
  availableTutorMoveIds: [],
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
  };
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

function normalizeSearch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}
