// Normalises a display name into a lowercase alphanumeric id, matching the
// convention used by the generated data files (e.g. "Hidden Power" -> "hiddenpower").

export function toId(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}
