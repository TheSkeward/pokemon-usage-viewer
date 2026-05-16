const CACHE_KEY_PREFIXES = ["resolverMovesets:"];

export function readLocalStorage(key, fallback = "") {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch (error) {
    console.warn("Failed to read localStorage", { key, error });
    return fallback;
  }
}

export function writeLocalStorage(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (firstError) {
    console.warn(
      "Failed to write localStorage; clearing large caches and retrying",
      {
        key,
        error: firstError,
      },
    );

    clearLargeLocalStorageCaches();

    try {
      localStorage.setItem(key, value);
      return true;
    } catch (secondError) {
      console.warn("Failed to write localStorage after cache cleanup", {
        key,
        error: secondError,
      });
      return false;
    }
  }
}

export function removeLocalStorage(key) {
  try {
    localStorage.removeItem(key);
    return true;
  } catch (error) {
    console.warn("Failed to remove localStorage item", { key, error });
    return false;
  }
}

export function clearLargeLocalStorageCaches() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (CACHE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        localStorage.removeItem(key);
      }
    }
  } catch (error) {
    console.warn("Failed to clear large localStorage caches", error);
  }
}
