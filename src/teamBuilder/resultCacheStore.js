// Persists the team-optimizer's Layer-3 result memo across page loads, so a
// reload (to pick up a deploy, restore a tab, or recover from a crash) restores
// a previously-computed pool instantly instead of paying the line-resolution and
// search cost again.
//
// IndexedDB (not localStorage) because a result holds the full resolved-lines
// graph and bench-swap Map — that's structured-clone-friendly and can exceed
// localStorage's ~5MB cap on exactly the big pools this is meant to help. Every
// operation degrades silently to a no-op if IndexedDB is unavailable, the data
// isn't cloneable, or the quota is exceeded: persistence is a cache, never a
// source of truth, so a failure just falls back to recomputing.

const DB_NAME = "pokemon-usage-viewer";
const STORE = "team-results";
const DB_VERSION = 1;
// Cap stored pools so the database can't grow without bound; oldest-written are
// evicted first.
const MAX_ENTRIES = 40;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") {
        resolve(null);
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "poolKey" });
          store.createIndex("ts", "ts");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

// Returns a Map(poolKey -> result) of entries matching the current version, and
// asynchronously prunes any entry from a different version (a deploy that changed
// optimizer output bumps the version, retiring the old results).
export async function loadPersistedResults(version) {
  const db = await openDb();
  const entries = new Map();
  if (!db) return entries;

  return new Promise((resolve) => {
    const stale = [];
    try {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          if (stale.length) deleteKeys(stale);
          resolve(entries);
          return;
        }
        const value = cursor.value;
        if (value?.version === version && value.result) {
          entries.set(value.poolKey, value.result);
        } else {
          stale.push(cursor.key);
        }
        cursor.continue();
      };
      request.onerror = () => resolve(entries);
    } catch {
      resolve(entries);
    }
  });
}

// Write-through a single result. Fire-and-forget: callers don't await it.
export async function persistResult(version, poolKey, result) {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    // put() structured-clones synchronously and throws DataCloneError here if
    // the result isn't cloneable, so the catch keeps a bad entry from breaking
    // writes. Quota errors are different: IndexedDB delivers those via the
    // request/transaction ERROR EVENTS after this block exits, so without
    // handlers they surface as unhandled error events in the console. Swallow
    // them — persistence is best-effort by design.
    const putRequest = store.put({ poolKey, version, result, ts: Date.now() });
    putRequest.onerror = (event) => event.preventDefault();
    tx.onabort = () => {};
    tx.onerror = (event) => event.preventDefault();
    const countRequest = store.count();
    countRequest.onsuccess = () => {
      const overflow = countRequest.result - MAX_ENTRIES;
      if (overflow > 0) evictOldest(store, overflow);
    };
  } catch {
    // Non-cloneable result or synchronous transaction failure — skip.
  }
}

function evictOldest(store, count) {
  try {
    const request = store.index("ts").openCursor();
    let removed = 0;
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || removed >= count) return;
      cursor.delete();
      removed += 1;
      cursor.continue();
    };
  } catch {
    // best-effort eviction
  }
}

async function deleteKeys(keys) {
  const db = await openDb();
  if (!db) return;
  try {
    const store = db.transaction(STORE, "readwrite").objectStore(STORE);
    for (const key of keys) store.delete(key);
  } catch {
    // best-effort cleanup
  }
}
