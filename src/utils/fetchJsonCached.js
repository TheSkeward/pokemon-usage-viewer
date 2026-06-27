// Session-lifetime cache of JSON fetches keyed by URL. Storing the in-flight
// promise (not just the result) also dedupes concurrent requests for the same
// file. A 404 resolves to null and is cached; network/parse errors are NOT
// cached, so a transient failure can be retried.

const cache = new Map();

export function fetchJsonCached(url) {
  const existing = cache.get(url);
  if (existing) return existing;

  const promise = (async () => {
    const response = await fetch(url);
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`Failed to load ${url} (${response.status})`);
    }
    return response.json();
  })().catch((error) => {
    cache.delete(url);
    throw error;
  });

  cache.set(url, promise);
  return promise;
}
