/**
 * @fileoverview Core-completion inputs and term math: pairwise co-use
 * evidence from REAL full teams (site-data/data/core-index, built by
 * scripts/build-core-index.mjs from curated samples, tournament play, and
 * rated replays). Each partner record carries a symmetrized lift in
 * percentage points and a source-quality-weighted evidence count. A missing
 * file or absent pair means "no evidence" — callers must treat that as
 * exactly zero, never as a penalty. The term math lives here so the search
 * kernel and the ratification ablation (scripts/validate-core-term.mjs)
 * score one definition. The index also carries trio counts; the ratified
 * term consumes pairs only.
 */
import { dataUrl } from '../utils/data-url.js';
import { fetchJsonCached } from '../utils/fetch-json-cached.js';
import { lineChoices } from './teammate-synergy.js';

const availableIdsCache = new Map();

// index.json gates per-mon fetches so mons with no core entry (a normal
// state) never produce a 404 request — same convention as observed-sets.
function loadAvailableIds(family) {
  if (!availableIdsCache.has(family)) {
    availableIdsCache.set(
      family,
      fetchJsonCached(dataUrl(`core-index/${family}/index.json`))
        .then((ids) => new Set(Array.isArray(ids) ? ids : []))
        .catch(() => new Set()),
    );
  }
  return availableIdsCache.get(family);
}

/**
 * @param {{family: ?string, pokemonId: ?string}} key
 * @return {Promise<?Object>} Core-index entry; null when the mon has no
 *     entry or the fetch fails.
 */
export async function loadCoreEntry({ family, pokemonId }) {
  if (!family || !pokemonId) return null;
  const available = await loadAvailableIds(family);
  if (!available.has(pokemonId)) return null;
  try {
    return await fetchJsonCached(
      dataUrl(`core-index/${family}/${pokemonId}.json`),
    );
  } catch {
    return null;
  }
}

/**
 * Attaches `_corePartners` (id -> {lift, count}) to every choice of every
 * line, so the search kernel can score core completion without further IO.
 * Fetches are cached and deduped per representative id.
 * @param {Array<Object>} lines
 * @param {string} family
 * @return {Promise<void>}
 */
export async function attachCoreLift(lines, family) {
  const byId = new Map();
  for (const line of lines) {
    for (const choice of lineChoices(line)) {
      if (choice.pokemonId && !byId.has(choice.pokemonId)) {
        byId.set(choice.pokemonId, null);
      }
    }
  }
  await Promise.all(
    [...byId.keys()].map(async (pokemonId) => {
      byId.set(pokemonId, await loadCoreEntry({ family, pokemonId }));
    }),
  );
  for (const line of lines) {
    for (const choice of lineChoices(line)) {
      const entry = byId.get(choice.pokemonId);
      if (entry?.partners) choice._corePartners = entry.partners;
    }
  }
}

/**
 * Evidence-weighted credit for one pair with a core-index record: pair
 * readiness trust × evidence weight × positive lift. `count` is the
 * source-quality-weighted number of real-team sightings; `evidenceHalf` is
 * the count at half weight, so thin ladder co-occurrence stays near zero
 * while curated/tournament evidence counts almost fully. Negative lift earns
 * nothing — the term rewards completing real cores and never penalizes.
 * @param {number} lift Symmetrized co-use lift in percentage points.
 * @param {number} count Quality-weighted evidence count.
 * @param {number} trust Pair readiness trust, 0..1.
 * @param {number} evidenceHalf CORE_EVIDENCE_HALF.
 * @return {number}
 */
export function corePairCredit(lift, count, trust, evidenceHalf) {
  if (!(lift > 0) || !(count > 0)) return 0;
  return trust * (count / (count + evidenceHalf)) * lift;
}

/**
 * Bounded core-completion fit points: saturating in the summed pair credit,
 * asymptotic to — never reaching — `scale`, and exactly 0 at zero credit
 * (no evidence produces no term at all).
 * @param {number} credit Summed corePairCredit over the team's pairs.
 * @param {number} scale CORE_COMPLETION_SCALE.
 * @param {number} saturation CORE_COMPLETION_SATURATION.
 * @return {number}
 */
export function coreCompletionFit(credit, scale, saturation) {
  if (!(credit > 0)) return 0;
  return scale * (1 - Math.exp(-credit / saturation));
}
