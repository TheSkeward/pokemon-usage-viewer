import {
  readLocalStorage,
  removeLocalStorage,
  writeLocalStorage,
} from "../storage/safeLocalStorage";

const PROGRESSION_STORAGE_KEY = "pokemon-usage-viewer:reborn-progression:v1";

export const DEFAULT_REBORN_PROGRESSION = {
  levelCap: "",
  moveRelearnerUnlocked: false,
  daycareUnlocked: false,
  availableTmsText: "",
  availableTmxsText: "",
  availableTutorsText: "",
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
    availableTmsText: String(progression.availableTmsText || ""),
    availableTmxsText: String(progression.availableTmxsText || ""),
    availableTutorsText: String(progression.availableTutorsText || ""),
  };
}

export function updateRebornProgressionField(progression, field, value) {
  return normalizeRebornProgression({
    ...progression,
    [field]: value,
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
