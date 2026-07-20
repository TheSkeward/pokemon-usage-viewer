// The canonical six-stat order (HP → Spe) every EV/spread array in the app
// is stored and displayed in.
export const STAT_LABELS = ["HP", "Atk", "Def", "SpA", "SpD", "Spe"];
// The matching lowercase keys used by {hp, atk, ...} stat objects.
export const STAT_KEYS = STAT_LABELS.map((label) => label.toLowerCase());
