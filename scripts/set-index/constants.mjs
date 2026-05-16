import path from "node:path";

export const DATA_ROOT = path.resolve("site-data", "data");
export const OUT_ROOT = path.join(DATA_ROOT, "set-index");

export const FAMILIES = ["singles", "doubles"];

export const FALLBACK_FAMILY_ORDER = {
  singles: ["singles", "doubles"],
  doubles: ["doubles", "singles"],
};

export const HIDDEN_ENTRY_KEYS = new Set(["other", "nothing"]);

export const MIN_MEANINGFUL_SET_ENTRY_USAGE_PERCENT = 0.1;
