import {
  readLocalStorage,
  writeLocalStorage,
} from "../storage/safeLocalStorage";

// Persistent open/closed state for <details> groups. Every optimizer run (and
// most progression edits) re-renders the whole page from HTML strings, which
// used to reset every group to its hardcoded default — closing the panel the
// user was working in. The user's last toggle now wins across re-renders and
// reloads; a group's default only applies before they ever touch it.
const DETAILS_STATE_KEY = "pokemon-usage-viewer:details-open:v1";

function readMap() {
  try {
    const parsed = JSON.parse(readLocalStorage(DETAILS_STATE_KEY, "") || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

// Attribute chunk for a persistent <details> tag. `id` is a code-controlled
// literal (no user content).
export function detailsStateAttrs(id, defaultOpen) {
  const saved = readMap()[id];
  const open = typeof saved === "boolean" ? saved : defaultOpen;
  return `data-details-id="${id}"${open ? " open" : ""}`;
}

export function saveDetailsOpen(id, open) {
  if (!id) return;
  const map = readMap();
  if (map[id] === Boolean(open)) return;
  map[id] = Boolean(open);
  writeLocalStorage(DETAILS_STATE_KEY, JSON.stringify(map));
}

// Call after each render to record the user's toggles.
export function bindPersistentDetails(root) {
  root.querySelectorAll("details[data-details-id]").forEach((element) => {
    element.addEventListener("toggle", () =>
      saveDetailsOpen(element.dataset.detailsId, element.open),
    );
  });
}
