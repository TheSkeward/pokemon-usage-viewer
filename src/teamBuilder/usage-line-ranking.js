import { gamesToLikelySee } from './trace-usage.js';

// Six team slots plus four numbered 30-slot bench boxes. Pool entries beyond
// this limit still participate in move-transfer contexts; they simply skip the
// expensive build-resolution and team-search path.
export const SCORED_POOL_LIMIT = 126;

/**
 * The line's best form by usage ranking: shallowest meaningful tier, then
 * highest usage there. This deliberately ignores current-cap set readiness,
 * matching the numbered bench's eventual-value ordering.
 *
 * @param {!Array<!Object>} candidates Rows carrying { candidate, bundle }.
 * @return {?Object}
 */
export function getLineCeilingRanking(candidates = []) {
  let best = null;
  for (const row of candidates) {
    const ranking = row.bundle?.ranking;
    if (!ranking) continue;
    const next = {
      tierRank: ranking.tierRank,
      value: ranking.value,
      formatId: ranking.formatId,
      cutoff: ranking.cutoff,
      name: row.candidate?.name,
    };
    if (
      !best ||
      next.tierRank < best.tierRank ||
      (next.tierRank === best.tierRank && next.value > best.value)
    ) {
      best = next;
    }
  }
  return best;
}

/**
 * Best display-only trace row for a line with no meaningful usage anywhere.
 *
 * @param {!Array<!Object>} candidates Rows carrying { candidate, bundle }.
 * @return {?Object}
 */
export function getLineTraceRanking(candidates = []) {
  let best = null;
  for (const row of candidates) {
    const trace = row.bundle?.trace;
    if (!trace || !(trace.value > 0)) continue;
    if (
      !best ||
      trace.value > best.value ||
      (trace.value === best.value && trace.tierRank < best.tierRank)
    ) {
      best = {
        tierRank: trace.tierRank,
        value: trace.value,
        formatId: trace.formatId,
        cutoff: trace.cutoff,
        name: trace.name || row.candidate?.name,
      };
    }
  }
  if (!best) return null;
  const games = gamesToLikelySee(best.value);
  return games == null ? null : { ...best, games };
}

/**
 * Produces the shared numbered-bench ordering key for one evolutionary line.
 *
 * @param {!Array<!Object>} candidates Rows carrying { candidate, bundle }.
 * @param {string} fallbackName Input name used for deterministic final ties.
 * @return {!Object}
 */
export function getLineUsageOrder(candidates, fallbackName = '') {
  const ceiling = getLineCeilingRanking(candidates);
  return {
    ceiling,
    trace: ceiling ? null : getLineTraceRanking(candidates),
    fallbackName,
  };
}

/**
 * Best-first comparison used both by the scoring-pool cutoff and by the
 * numbered bench's documented order: meaningful tiers first (shallowest tier,
 * then highest usage), followed by trace rows (shortest visibility horizon,
 * tier ladder, usage), with absent lines last.
 *
 * @param {!Object} a
 * @param {!Object} b
 * @return {number}
 */
export function compareLineUsageBestFirst(a, b) {
  if (Boolean(a.ceiling) !== Boolean(b.ceiling)) return a.ceiling ? -1 : 1;
  if (a.ceiling && b.ceiling) {
    return (
      a.ceiling.tierRank - b.ceiling.tierRank ||
      b.ceiling.value - a.ceiling.value ||
      signalName(a).localeCompare(signalName(b)) ||
      a.fallbackName.localeCompare(b.fallbackName)
    );
  }

  if (Boolean(a.trace) !== Boolean(b.trace)) return a.trace ? -1 : 1;
  if (a.trace && b.trace) {
    return (
      a.trace.games - b.trace.games ||
      a.trace.tierRank - b.trace.tierRank ||
      b.trace.value - a.trace.value ||
      signalName(a).localeCompare(signalName(b)) ||
      a.fallbackName.localeCompare(b.fallbackName)
    );
  }

  return a.fallbackName.localeCompare(b.fallbackName);
}

/**
 * Stable top-N cut over entries carrying a precomputed `usageOrder`.
 *
 * @param {!Array<!Object>} entries
 * @param {number=} limit
 * @return {!Array<!Object>}
 */
export function takeTopUsageEntries(entries, limit = SCORED_POOL_LIMIT) {
  return [...entries]
    .sort((a, b) =>
      compareLineUsageBestFirst(a.usageOrder, b.usageOrder),
    )
    .slice(0, Math.max(0, limit));
}

function signalName(order) {
  return order.ceiling?.name || order.trace?.name || order.fallbackName || '';
}
