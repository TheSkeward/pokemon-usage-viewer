import {
  readLocalStorage,
  writeLocalStorage,
} from '../storage/safeLocalStorage';

// Persistent open/closed state for <details> groups. Full-page re-renders
// rebuild every group from HTML strings; the user's last toggle wins across
// re-renders and reloads, and a group's default only applies before they
// ever touch it.
const DETAILS_STATE_KEY = 'pokemon-usage-viewer:details-open:v1';

function readMap() {
  try {
    const parsed = JSON.parse(readLocalStorage(DETAILS_STATE_KEY, '') || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Attribute chunk for a persistent <details> tag. `id` is a code-controlled
 * literal (no user content).
 * @return {string}
 */
export function detailsStateAttrs(id, defaultOpen) {
  const saved = readMap()[id];
  const open = typeof saved === 'boolean' ? saved : defaultOpen;
  return `data-details-id="${id}"${open ? ' open' : ''}`;
}

/**
 * @param {string} id
 * @param {boolean} open
 */
export function saveDetailsOpen(id, open) {
  if (!id) return;
  const map = readMap();
  if (map[id] === Boolean(open)) return;
  map[id] = Boolean(open);
  writeLocalStorage(DETAILS_STATE_KEY, JSON.stringify(map));
}

/** @param {!Element} root */
export function bindPersistentDetails(root) {
  root.querySelectorAll('details[data-details-id]').forEach((element) => {
    element.addEventListener('toggle', () =>
      saveDetailsOpen(element.dataset.detailsId, element.open),
    );
  });
}
