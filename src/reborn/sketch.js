import { buildInputGroups } from '../teamBuilder/input-groups.js';
import { GEN7_PROGRESSION_SPECIES } from '../generated/gen7ProgressionSpecies.generated.js';
import { toId } from '../utils/ids.js';
import {
  acquisitionOf,
  applyBreedingContextToProgression,
  buildRebornBreedingContext,
  canHatchLine,
  familyForms,
} from './breeding.js';
import { getReachableRebornSpecies } from './current-species.js';
import {
  getAvailableRebornMoves,
  getRebornMoveSourcePriority,
  loadRebornLegalMoveData,
} from './legal-moves.js';

const SMEARGLE_ID = 'smeargle';

/**
 * Resolve the two move-transfer systems in dependency order. Breeding first
 * establishes every partner's real move pool; Sketch then copies from those
 * partners. A final breeding pass lets a partner-backed Smeargle serve as an
 * egg donor without ever allowing Sketch to bootstrap itself.
 */
export async function buildRebornMoveTransferContexts(options = {}) {
  let breedingContext = await buildRebornBreedingContext(options);
  const sketchContext = await buildRebornSketchContext({
    ...options,
    breedingContext,
  });
  if (
    options.progression?.daycareUnlocked &&
    sketchContext.byPokemonId?.[SMEARGLE_ID]?.moveIds?.length
  ) {
    breedingContext = await buildRebornBreedingContext({
      ...options,
      sketchContext,
    });
  }
  return { breedingContext, sketchContext };
}

/**
 * Builds Smeargle's practical Sketch pool. A move is available only when a
 * different, currently fieldable Pokemon from the user's pool can already use
 * it under the same progression. The partner's own egg moves may participate
 * when breeding really is available, but Sketch itself has no daycare or
 * egg-group gate.
 * @return {!Promise<{byPokemonId: !Object, ownedSpecies: !Array<!Object>}>}
 */
export async function buildRebornSketchContext({
  pokemonIndex = [],
  progression = {},
  query = '',
  breedingContext = null,
  preferredPartnerIds = new Set(),
  preferredMoveIdsByPartnerId = new Map(),
  retainRoutes = false,
} = {}) {
  const ownedSpecies = getOwnedFieldableSpecies({
    pokemonIndex,
    progression,
    query,
  });
  if (!ownedSpecies.some((species) => species.id === SMEARGLE_ID)) {
    return emptyContext();
  }

  const routes = (
    await Promise.all(
      ownedSpecies
        .filter((species) => species.id !== SMEARGLE_ID)
        .map(async (species) => {
          const legalMoveData = await loadRebornLegalMoveData(species.id);
          if (!legalMoveData) return [];
          const partnerProgression = applyBreedingContextToProgression(
            progression,
            species.id,
            breedingContext,
          );
          return getAvailableRebornMoves(legalMoveData, partnerProgression)
            .map((move) => partnerRoute(move, species, progression))
            .filter(Boolean);
        }),
    )
  ).flat();

  const routesByMoveId = new Map();
  for (const route of routes) {
    if (!routesByMoveId.has(route.moveId)) {
      routesByMoveId.set(route.moveId, []);
    }
    routesByMoveId.get(route.moveId).push(route);
  }

  return buildContextFromRoutes({
    routesByMoveId,
    ownedSpecies,
    preferredPartnerIds,
    preferredMoveIdsByPartnerId,
    retainRoutes,
  });
}

/**
 * Re-rank an already-built context for display without loading the full pool a
 * second time. Team analysis requests retained routes; optimizer contexts stay
 * compact and omit them.
 */
export function rerankRebornSketchContext(sketchContext, {
  preferredPartnerIds = new Set(),
  preferredMoveIdsByPartnerId = new Map(),
  retainRoutes = false,
} = {}) {
  if (!sketchContext?.routesByMoveId) return sketchContext;
  return buildContextFromRoutes({
    routesByMoveId: sketchContext.routesByMoveId,
    ownedSpecies: sketchContext.ownedSpecies || [],
    preferredPartnerIds,
    preferredMoveIdsByPartnerId,
    retainRoutes,
  });
}

function buildContextFromRoutes({
  routesByMoveId,
  ownedSpecies,
  preferredPartnerIds,
  preferredMoveIdsByPartnerId,
  retainRoutes,
}) {
  const moveIds = [...routesByMoveId.keys()].sort();
  const sources = {};
  for (const moveId of moveIds) {
    const rankedRoutes = routesByMoveId.get(moveId).sort((a, b) =>
      comparePartnerRoutes(a, b, {
        preferredPartnerIds,
        preferredMoveIdsByPartnerId,
      }),
    );
    const route = rankedRoutes[0];
    const alternatives = collectAlternativeRoutes(rankedRoutes);
    const partnerSourceText = formatPartnerSource(route.partnerSource);
    sources[moveId] = {
      kind: 'sketch',
      label: `Sketch via ${route.partnerName}`,
      detail: partnerSourceText,
      sourceTitle: [
        `${route.moveName}: have ${route.partnerName} use it beside Smeargle in a Double Battle, then have Smeargle use Sketch on that partner.`,
        partnerSourceText
          ? `${route.partnerName}'s source: ${partnerSourceText}.`
          : null,
        route.partnerSource.sourceTitle || null,
        alternatives.length
          ? `Other pool routes: ${alternatives.map(formatPartnerRoute).join('; ')}.`
          : null,
      ]
        .filter(Boolean)
        .join('\n'),
      partnerId: route.partnerId,
      partnerName: route.partnerName,
      partnerInputId: route.partnerInputId,
      partnerSource: route.partnerSource,
      partnerLevel: route.cost.levelingLevel,
    };
  }

  const context = {
    byPokemonId: {
      [SMEARGLE_ID]: { moveIds, sources },
    },
    ownedSpecies,
  };
  if (retainRoutes) context.routesByMoveId = routesByMoveId;
  return context;
}

/** Stamp one Pokemon's pool-backed Sketch moves into its progression. */
export function applySketchContextToProgression(
  progression,
  pokemonId,
  sketchContext,
) {
  const sketch = sketchContext?.byPokemonId?.[toId(pokemonId)];
  return {
    ...progression,
    availableSketchMoveIdsForPokemon: sketch?.moveIds || [],
    availableSketchMoveSourcesForPokemon: sketch?.sources || {},
  };
}

/**
 * Compact cache signature that changes with both move availability and the
 * displayed partner receipt, without putting hundreds of tooltip strings in
 * every optimizer cache key.
 */
export function sketchContextSignature(sketchContext) {
  const sketch = sketchContext?.byPokemonId?.[SMEARGLE_ID];
  if (!sketch?.moveIds?.length) return 'none';
  const text = sketch.moveIds
    .map((moveId) => {
      const source = sketch.sources?.[moveId] || {};
      const partnerSource = source.partnerSource || {};
      return [
        moveId,
        source.partnerId || '',
        source.partnerInputId || '',
        source.partnerLevel ?? '',
        partnerSource.kind || '',
        partnerSource.label || '',
        partnerSource.detail || '',
      ].join(':');
    })
    .join('|');
  return `${sketch.moveIds.length}:${hashSignature(text)}`;
}

function getOwnedFieldableSpecies({ pokemonIndex, progression, query }) {
  const byId = new Map();
  for (const group of buildInputGroups(query, pokemonIndex)) {
    if (group.unresolved || !group.input?.id) continue;
    const inputId = group.input.id;
    let forms;
    if (progression.daycareUnlocked && canHatchLine(inputId)) {
      const rootId = familyForms(inputId)[0]?.id || inputId;
      forms = getReachableRebornSpecies(rootId, progression);
    } else {
      forms = getReachableRebornSpecies(inputId, progression);
    }
    if (!forms.length) forms = [group.input];
    for (const form of forms) {
      if (!form?.id || byId.has(form.id)) continue;
      byId.set(form.id, {
        id: form.id,
        name: form.name || form.id,
        inputId,
      });
    }
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function partnerRoute(move, species, progression) {
  const partnerSources = [...(move.availableSources || [])]
    .filter((source) => source.kind !== 'sketch')
    .map((source) => ({
      source,
      cost: sourceCost(source, species, progression),
    }))
    .sort((a, b) => compareRouteCosts(a.cost, b.cost, a.source, b.source));
  if (!partnerSources.length) return null;
  const { source: partnerSource, cost } = partnerSources[0];
  return {
    // Hidden Power variants are expanded only after the base move passes its
    // availability gate. One partner variant therefore unlocks the base entry;
    // Smeargle's own type is selected by the same Type Changer progression.
    moveId: move.id.startsWith('hiddenpower') ? 'hiddenpower' : move.id,
    moveName: move.name,
    partnerId: species.id,
    partnerName: species.name,
    partnerInputId: species.inputId,
    partnerSource,
    cost,
  };
}

function comparePartnerRoutes(a, b, preferences) {
  return (
    preferenceRank(a, preferences) - preferenceRank(b, preferences) ||
    compareRouteCosts(a.cost, b.cost, a.partnerSource, b.partnerSource) ||
    a.partnerName.localeCompare(b.partnerName) ||
    a.partnerId.localeCompare(b.partnerId)
  );
}

function preferenceRank(route, {
  preferredPartnerIds,
  preferredMoveIdsByPartnerId,
}) {
  if (!preferredPartnerIds.has(route.partnerId)) return 2;
  const moveIds = preferredMoveIdsByPartnerId.get(route.partnerId);
  return moveIds?.has(route.moveId) ? 0 : 1;
}

function compareRouteCosts(costA, costB, sourceA, sourceB) {
  return (
    costA.transferSteps - costB.transferSteps ||
    costA.level - costB.level ||
    costA.hassle - costB.hassle ||
    costA.kind - costB.kind ||
    String(sourceA.label || '').localeCompare(String(sourceB.label || '')) ||
    String(sourceA.detail || '').localeCompare(String(sourceB.detail || ''))
  );
}

function sourceCost(source, species, progression) {
  const acquisition = acquisitionOf(
    { availableSources: [source] },
    species.id,
    {
      inputId: species.inputId,
      ownedItems: progression.ownedItems || {},
    },
  );
  return {
    // Any direct route beats first arranging another breeding transfer.
    transferSteps: source.kind === 'egg' ? 1 : 0,
    // acquisitionOf prices evolution moves at the real evolution level and
    // also retains scarce-item costs, rather than treating level:null as free.
    level: acquisition.level,
    // The ranking level may include scarce-item offsets. Interim-donor
    // guidance needs the literal level where this partner learns the move.
    levelingLevel:
      source.kind === 'level-up' && Number.isFinite(source.level)
        ? source.level
        : source.onEvolution
          ? GEN7_PROGRESSION_SPECIES[species.id]?.evoLevel ?? null
          : null,
    hassle: acquisition.hassle || 0,
    kind: getRebornMoveSourcePriority(source),
  };
}

function collectAlternativeRoutes(rankedRoutes) {
  const alternatives = [];
  const seenFamilies = new Set([familyRootId(rankedRoutes[0]?.partnerId)]);
  for (const route of rankedRoutes.slice(1)) {
    const family = familyRootId(route.partnerId);
    if (seenFamilies.has(family)) continue;
    seenFamilies.add(family);
    alternatives.push(route);
    if (alternatives.length >= 2) break;
  }
  return alternatives;
}

function familyRootId(pokemonId) {
  let id = pokemonId;
  const seen = new Set();
  while (GEN7_PROGRESSION_SPECIES[id]?.prevoId && !seen.has(id)) {
    seen.add(id);
    id = GEN7_PROGRESSION_SPECIES[id].prevoId;
  }
  return id;
}

function formatPartnerRoute(route) {
  const source = formatPartnerSource(route.partnerSource);
  return source ? `${route.partnerName} — ${source}` : route.partnerName;
}

function formatPartnerSource(source) {
  if (!source) return '';
  return source.detail
    ? `${source.label}: ${source.detail}`
    : String(source.label || 'currently available');
}

function hashSignature(text) {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
}

function emptyContext() {
  return { byPokemonId: {}, ownedSpecies: [] };
}
