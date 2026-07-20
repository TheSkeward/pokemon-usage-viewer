import { dataUrl } from '../utils/data-url.js';
import { fetchJsonCached } from '../utils/fetch-json-cached.js';
import { getActiveGame } from '../games/registry.js';
import { getRebornMoveId } from '../reborn/legal-moves.js';
import { hydrateLegalMove } from '../move-meta.js';

/**
 * Stateful loader for the selected Pokémon's precomputed set detail.
 * select() on the already-selected Pokémon deselects; stale async responses
 * are dropped via a generation counter. When the requested selection has no
 * set file, the "all" selection file is used and flagged on the detail as
 * selectionFallback. Unused legal moves are appended as kind "legal-unused".
 * `onUpdate` fires after every state change.
 * @param {{getFamily: function(): string, getSelection: function(): string,
 *     onUpdate: function(): void}} deps
 * @return {{cancel: function(): void, getDetail: function(): ?Object,
 * getMessage: function(): string, getSelectedPokemonId: function(): ?string,
 *     getStatus: function(): ?Object, isSelected: function(string): boolean,
 *     select: function(string): void}}
 */
export function createPrecomputedSetDetailsLoader({
  getFamily,
  getSelection,
  onUpdate,
}) {
  let generation = 0;
  let selectedPokemonId = null;
  let detail = null;
  let status = null;
  let message = '';

  return {
    cancel,
    getDetail: () => detail,
    getMessage: () => message,
    getSelectedPokemonId: () => selectedPokemonId,
    getStatus: () => status,
    isSelected: (pokemonId) => selectedPokemonId === pokemonId,
    select,
  };

  function select(pokemonId) {
    if (!pokemonId) return;

    if (selectedPokemonId === pokemonId) {
      cancel();
      onUpdate();
      return;
    }

    const requestGeneration = ++generation;

    selectedPokemonId = pokemonId;
    detail = null;
    status = {
      phase: 'loading',
      checked: 0,
      total: 1,
      contributed: 0,
    };
    message = 'Loading set details...';

    onUpdate();
    void loadPrecomputedSetDetail(pokemonId, requestGeneration);
  }

  function cancel() {
    generation += 1;
    selectedPokemonId = null;
    detail = null;
    status = null;
    message = '';
  }

  async function loadPrecomputedSetDetail(pokemonId, requestGeneration) {
    try {
      const requestedSelection = getSelection();
      const [result, legalMoves] = await Promise.all([
        fetchSetDetailWithAllFallback({
          family: getFamily(),
          pokemonId,
          selection: requestedSelection,
        }),
        fetchLegalMoves(pokemonId),
      ]);

      if (requestGeneration !== generation) return;

      let merged = result.detail;

      if (merged && result.usedFallback) {
        merged = {
          ...merged,
          requestedSelection,
          selectionFallback: {
            requested: requestedSelection,
            used: result.usedSelection,
          },
        };
      }

      merged = appendUnusedLegalMoves(merged, legalMoves, pokemonId);

      if (!merged) {
        detail = null;
        status = {
          phase: 'empty',
          checked: 1,
          total: 1,
          contributed: 0,
        };
        message = 'No precomputed set details found for this Pokémon.';
        onUpdate();
        return;
      }

      detail = merged;

      status = {
        phase: 'ready',
        checked: 1,
        total: 1,
        contributed: detail?.sourcesUsed?.length || 1,
      };

      message = result.usedFallback
        ? `Showing all-period set details; ${requestedSelection} has no precomputed set file.`
        : '';

      onUpdate();
    } catch (error) {
      if (requestGeneration !== generation) return;

      console.error('Set detail load failed', error);

      detail = null;
      status = {
        phase: 'empty',
        checked: 0,
        total: 1,
        contributed: 0,
      };
      message = `Set details failed: ${error?.message || error}`;

      onUpdate();
    }
  }
}

/**
 * Source label for a set detail: "format @ cutoff", prefixed with "canonical
 * tier" when the detail names a primarySource, suffixed with the requested
 * period when all-period details were substituted for it.
 * @param {?Object} source Set detail as produced by the loader.
 * @return {string} Empty when the source carries no format info.
 */
export function describePrecomputedSetSource(source) {
  const fallback = source?.selectionFallback;

  const tier =
    source?.primarySource?.sourceText ||
    source?.sourceText ||
    (source?.selection === 'all'
      ? `${source.formatId} @ ${source.cutoff} (all available)`
      : source?.formatId
        ? `${source.formatId} @ ${source.cutoff}`
        : '');

  const base = source?.primarySource ? `canonical tier ${tier}` : tier;

  if (fallback) {
    return `${base} · all-period details shown for ${fallback.requested}`;
  }

  return base;
}

async function fetchSetDetailWithAllFallback({ family, pokemonId, selection }) {
  const primary = await fetchSetDetail({ family, pokemonId, selection });

  if (primary || selection === 'all') {
    return {
      detail: primary,
      usedFallback: false,
      usedSelection: selection,
    };
  }

  const fallback = await fetchSetDetail({
    family,
    pokemonId,
    selection: 'all',
  });

  return {
    detail: fallback,
    usedFallback: Boolean(fallback),
    usedSelection: 'all',
  };
}

async function fetchSetDetail({ family, pokemonId, selection }) {
  return fetchJsonCached(
    dataUrl(`set-index/${family}/${selection}/${pokemonId}.json`),
  );
}

async function fetchLegalMoves(pokemonId) {
  try {
    return await fetchJsonCached(
      dataUrl(`${getActiveGame().data.legalMovesDir}/all/${pokemonId}.json`),
    );
  } catch {
    return null;
  }
}

function appendUnusedLegalMoves(detail, legalMoves, pokemonId) {
  const legal = legalMoves?.moves;
  if (!legal?.length) return detail;

  const base =
    detail ||
    {
      pokemonId,
      name: legalMoves.pokemonName,
      sourceText: 'Reborn legal moves (no competitive usage data)',
      moves: [],
      items: [],
      abilities: [],
      spreads: [],
    };

  const usedMoveIds = new Set(
    (base.moves || []).map((move) => getRebornMoveId(move.name)),
  );

  const unusedMoves = legal
    .filter((move) => !usedMoveIds.has(move.id))
    .map(hydrateLegalMove)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((move) => ({
      name: move.name,
      kind: 'legal-unused',
      type: move.type,
      category: move.category,
      sourceText: describeLegalSources(move.sources),
    }));

  if (!unusedMoves.length) return base;

  return { ...base, moves: [...(base.moves || []), ...unusedMoves] };
}

function describeLegalSources(sources = {}) {
  const parts = [];
  if (sources.levelUp?.length) parts.push('Level-up');
  if (sources.preEvolutionLevelUp?.length) parts.push('Pre-evo level-up');
  if (sources.tm) parts.push('TM');
  if (sources.tmx) parts.push('TMX');
  if (sources.tutor) parts.push('Tutor');
  if (sources.egg) parts.push('Egg');

  return parts.length ? `Legal in Reborn · ${parts.join(' · ')}` : 'Legal in Reborn';
}
