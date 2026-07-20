import { MIN_MEANINGFUL_SET_ENTRY_USAGE_PERCENT } from './constants.mjs';
import { formatSource } from './candidates.mjs';
import { buildRelatedPokemonChain } from './speciesContext.mjs';
import { normalizeName } from './stringUtils.mjs';

/**
 * One mon's set-index detail: the primary tier's entries plus usage-less
 * "additional" entries from every other tier it appears in, deduped (a real
 * entry replaces a trace one, never the reverse).
 *
 * @return {?Object} The detail record written to
 *     set-index/<family>/<selection>/<id>.json, or null when the mon appears
 *     in no aggregate.
 */
export function stitchPokemonSetDetail({
  family,
  formatsIndex,
  pokemon,
  ranking,
  trace,
  selection,
  sourceAggregates,
}) {
  const present = [];
  for (const { aggregateByPokemon } of sourceAggregates) {
    const aggregate = aggregateByPokemon.get(pokemon.id);
    if (aggregate) present.push(aggregate);
  }

  if (!present.length) return null;

  const primaryIndex = choosePrimaryIndex({ present, ranking, trace, family });
  const primaryAggregate = present[primaryIndex];
  const primarySourceText = formatSource(primaryAggregate, formatsIndex);

  const detail = createPrimaryDetail({
    aggregate: primaryAggregate,
    family,
    pokemon,
    selection,
    sourceText: primarySourceText,
  });
  const seen = createSeenState(detail);

  for (const [index, aggregate] of present.entries()) {
    if (index === primaryIndex) continue;

    const sourceText = formatSource(aggregate, formatsIndex);

    const contributed = appendAdditionalEntries({
      detail,
      aggregate,
      seen,
      sourceText,
    });

    if (contributed) {
      detail.stitched = true;
      detail.sourcesUsed.push({
        family: aggregate.family,
        formatId: aggregate.formatId,
        cutoff: aggregate.cutoff,
        monthsAvailable: aggregate.monthsAvailable,
        monthsPresent: aggregate.monthsPresent,
        sourceText,
        kind: 'additional',
      });
    }
  }

  return detail;
}

// Which appearing tier supplies the primary (headline) set. Prefer the first
// tier whose usage clears the meaningful-usage bar (the resolver-index
// `ranking`): a sub-bar mon's highest-tier appearance is a noisy handful of
// teams, so drop down the ladder to where it's genuinely played. For mons
// below the bar EVERYWHERE, prefer the resolver-index `trace` tier — their
// best sub-bar signal (the trace value itself still never enters scoring).
// Only a mon with no usage signal at all falls back to the deepest appearing
// tier in the build's own family.
function choosePrimaryIndex({ present, ranking, trace, family }) {
  // A ranking/trace tier may lack moveset data even when it has usage data;
  // fall through to the next rule in that case.
  const matchIndex = (tier) =>
    tier?.formatId != null
      ? present.findIndex(
        (aggregate) =>
          aggregate.formatId === tier.formatId &&
            aggregate.cutoff === tier.cutoff,
      )
      : -1;

  if (ranking?.formatId != null) {
    const matched = matchIndex(ranking);
    return matched >= 0 ? matched : 0;
  }

  const tracedMatch = matchIndex(trace);
  if (tracedMatch >= 0) return tracedMatch;

  let deepestOwnFamily = -1;
  for (const [index, aggregate] of present.entries()) {
    if (aggregate.family === family) deepestOwnFamily = index;
  }

  return deepestOwnFamily >= 0 ? deepestOwnFamily : present.length - 1;
}

/**
 * Appends related-form/pre-evolution entries (from the already-stitched
 * details in `samePokemonDetails`) to a detail in place, recording each
 * contributor in relatedPokemonUsed/sourcesUsed.
 */
export function appendRelatedSetOptions({
  detail,
  pokemon,
  samePokemonDetails,
  speciesContext,
}) {
  const relatedChain = buildRelatedPokemonChain(pokemon, speciesContext);
  if (!relatedChain.length) return;

  const seen = createSeenState(detail);

  for (const related of relatedChain) {
    const relatedDetail = samePokemonDetails.get(related.id);
    if (!relatedDetail) continue;

    const contributed = appendRelatedPokemonEntries({
      detail,
      related,
      relatedDetail,
      seen,
    });

    if (!contributed) continue;

    detail.stitched = true;
    detail.relatedPokemonUsed.push({
      pokemonId: related.id,
      name: related.name,
      reason: related.reason,
    });

    detail.sourcesUsed.push({
      kind: 'related',
      pokemonId: related.id,
      name: related.name,
      reason: related.reason,
      sourceText: `Related: ${related.name} (${related.reason})`,
    });
  }
}

function createPrimaryDetail({
  aggregate,
  family,
  pokemon,
  selection,
  sourceText,
}) {
  const primarySource = {
    family: aggregate.family,
    formatId: aggregate.formatId,
    cutoff: aggregate.cutoff,
    monthsAvailable: aggregate.monthsAvailable,
    monthsPresent: aggregate.monthsPresent,
    sourceText,
    kind: 'primary',
  };

  return {
    pokemonId: pokemon.id,
    name: aggregate.entry.name || pokemon.name,
    family,
    selection,
    sourceFamily: aggregate.family,
    month: aggregate.month,
    formatId: aggregate.formatId,
    cutoff: aggregate.cutoff,
    monthsAvailable: aggregate.monthsAvailable,
    monthsPresent: aggregate.monthsPresent,
    stitched: false,
    primarySource,
    sourcesUsed: [primarySource],
    relatedPokemonUsed: [],
    entry: aggregate.entry,
    moves: markPrimaryEntries(aggregate.entry.moves, sourceText),
    items: markPrimaryEntries(aggregate.entry.items, sourceText),
    abilities: markPrimaryEntries(aggregate.entry.abilities, sourceText),
    spreads: markPrimaryEntries(aggregate.entry.spreads, sourceText),
  };
}

function markPrimaryEntries(entries, sourceText) {
  return entries
    .map((entry) => makePrimaryEntry(entry, sourceText))
    .sort(compareTraceLast);
}

function makePrimaryEntry(entry, sourceText) {
  if (isTraceEntry(entry)) {
    return makeTraceEntry({
      name: entry.name,
      sourceText,
    });
  }

  return {
    ...entry,
    kind: 'primary',
    trace: false,
  };
}

function appendAdditionalEntries({ detail, aggregate, seen, sourceText }) {
  const moveContribution = appendSection({
    target: detail.moves,
    entries: aggregate.entry.moves,
    seenMap: seen.moves,
    sourceText,
  });

  const itemContribution = appendSection({
    target: detail.items,
    entries: aggregate.entry.items,
    seenMap: seen.items,
    sourceText,
  });

  const abilityContribution = appendSection({
    target: detail.abilities,
    entries: aggregate.entry.abilities,
    seenMap: seen.abilities,
    sourceText,
  });

  const spreadContribution = appendSection({
    target: detail.spreads,
    entries: aggregate.entry.spreads,
    seenMap: seen.spreads,
    sourceText,
  });

  return (
    moveContribution ||
    itemContribution ||
    abilityContribution ||
    spreadContribution
  );
}

function appendSection({ target, entries, seenMap, sourceText }) {
  let contributed = false;

  for (const entry of entries) {
    const output = isTraceEntry(entry)
      ? makeTraceEntry({ name: entry.name, sourceText })
      : makeAdditionalEntry({ name: entry.name, sourceText });

    if (appendOutputEntry({ target, output, seenMap })) {
      contributed = true;
    }
  }

  return contributed;
}

function appendRelatedPokemonEntries({ detail, related, relatedDetail, seen }) {
  const moveContribution = appendRelatedSection({
    target: detail.moves,
    entries: relatedDetail.moves,
    seenMap: seen.moves,
    related,
  });

  const itemContribution = appendRelatedSection({
    target: detail.items,
    entries: relatedDetail.items,
    seenMap: seen.items,
    related,
  });

  const abilityContribution = appendRelatedSection({
    target: detail.abilities,
    entries: relatedDetail.abilities,
    seenMap: seen.abilities,
    related,
  });

  const spreadContribution = appendRelatedSection({
    target: detail.spreads,
    entries: relatedDetail.spreads,
    seenMap: seen.spreads,
    related,
  });

  return (
    moveContribution ||
    itemContribution ||
    abilityContribution ||
    spreadContribution
  );
}

function appendRelatedSection({ target, entries, seenMap, related }) {
  let contributed = false;

  for (const entry of entries) {
    const relatedSourceText = `Related: ${related.name} (${related.reason})${
      entry.sourceText ? ` — ${entry.sourceText}` : ''
    }`;

    const output = isTraceEntry(entry)
      ? makeTraceEntry({
        name: entry.name,
        sourceText: relatedSourceText,
      })
      : makeAdditionalEntry({
        name: entry.name,
        sourceText: relatedSourceText,
      });

    if (appendOutputEntry({ target, output, seenMap })) {
      contributed = true;
    }
  }

  return contributed;
}

function appendOutputEntry({ target, output, seenMap }) {
  const key = normalizeName(output.name);
  if (!key) return false;

  const existing = seenMap.get(key);

  if (!existing) {
    target.push(output);
    sortAndReindex(target, seenMap);
    return true;
  }

  if (!existing.trace) return false;
  if (output.trace) return false;

  target[existing.index] = output;
  sortAndReindex(target, seenMap);
  return true;
}

function createSeenState(detail) {
  return {
    moves: createSeenMap(detail.moves),
    items: createSeenMap(detail.items),
    abilities: createSeenMap(detail.abilities),
    spreads: createSeenMap(detail.spreads),
  };
}

function createSeenMap(entries) {
  const map = new Map();
  for (const [index, entry] of entries.entries()) {
    const key = normalizeName(entry.name);
    if (!key) continue;
    map.set(key, { index, trace: Boolean(entry.trace) });
  }
  return map;
}

function sortAndReindex(target, seenMap) {
  target.sort(compareTraceLast);
  seenMap.clear();

  for (const [index, entry] of target.entries()) {
    const key = normalizeName(entry.name);
    if (!key) continue;
    seenMap.set(key, { index, trace: Boolean(entry.trace) });
  }
}

function compareTraceLast(a, b) {
  return Number(Boolean(a.trace)) - Number(Boolean(b.trace));
}

function makeAdditionalEntry({ name, sourceText }) {
  return {
    name,
    usage: null,
    kind: 'additional',
    sourceText,
    trace: false,
  };
}

function makeTraceEntry({ name, sourceText }) {
  return {
    name,
    usage: null,
    kind: 'additional',
    sourceText: makeTraceSourceText(sourceText),
    trace: true,
  };
}

function isTraceEntry(entry) {
  if (entry?.trace) return true;
  if (typeof entry?.usage !== 'number') return false;
  return entry.usage < MIN_MEANINGFUL_SET_ENTRY_USAGE_PERCENT;
}

function makeTraceSourceText(sourceText) {
  const base = String(sourceText || '')
    .replace(/^Trace:\s*/, '')
    .replace(/\s*\(<0\.1%\)\s*$/, '');

  return `Trace: ${base} (<0.1%)`;
}
