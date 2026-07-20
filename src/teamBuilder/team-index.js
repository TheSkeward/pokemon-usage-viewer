/**
 * @fileoverview Loader for the real-team index (whole scraped teams per
 * format; scripts/build-team-index.mjs). Same fetch conventions as
 * observedSets: index.json gates the per-format fetches so families with no
 * scraped teams never 404, and any failure degrades to "no data".
 */
import { dataUrl } from '../utils/data-url.js';
import { fetchJsonCached } from '../utils/fetch-json-cached.js';

const teamsCache = new Map();

/**
 * @param {?string} family
 * @return {Promise<Array<Object>>} Scraped teams tagged with formatId; empty
 *     on any fetch failure.
 */
export async function loadTeamIndex(family) {
  if (!family) return [];
  if (!teamsCache.has(family)) {
    teamsCache.set(family, loadFamilyTeams(family).catch(() => []));
  }
  return teamsCache.get(family);
}

async function loadFamilyTeams(family) {
  const formatIds = await fetchJsonCached(
    dataUrl(`team-index/${family}/index.json`),
  ).catch(() => null);
  if (!Array.isArray(formatIds) || !formatIds.length) return [];

  const files = await Promise.all(
    formatIds.map((formatId) =>
      fetchJsonCached(dataUrl(`team-index/${family}/${formatId}.json`)).catch(
        () => null,
      ),
    ),
  );

  const teams = [];
  for (const file of files) {
    for (const team of file?.teams || []) {
      teams.push({ ...team, formatId: file.formatId });
    }
  }
  return teams;
}
