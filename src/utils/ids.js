// Normalises a display name into a lowercase alphanumeric id, matching the
// convention used by the generated data files (e.g. "Hidden Power" -> "hiddenpower").

export function toId(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

// Move-name variant of toId: the legal-move data stores every Hidden Power
// type under the single "hiddenpower" id, so typed variants collapse to it.
export function moveId(value) {
  const id = toId(value);
  return id.startsWith("hiddenpower") ? "hiddenpower" : id;
}
