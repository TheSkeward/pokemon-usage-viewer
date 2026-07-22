import { buildInputGroups } from '../teamBuilder/input-groups.js';
import { toId } from '../utils/ids.js';
import {
  applyBreedingContextToProgression,
  buildRebornBreedingContext,
  canHatchLine,
  familyForms,
} from './breeding.js';
import { getReachableRebornSpecies } from './current-species.js';
import {
  getAvailableRebornMoves,
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
            .map((move) => partnerRoute(move, species))
            .filter(Boolean);
        }),
    )
  ).flat();

  const bestByMoveId = new Map();
  for (const route of routes) {
    const current = bestByMoveId.get(route.moveId);
    if (!current || comparePartnerRoutes(route, current) < 0) {
      bestByMoveId.set(route.moveId, route);
    }
  }

  const moveIds = [...bestByMoveId.keys()].sort();
  const sources = {};
  for (const moveId of moveIds) {
    const route = bestByMoveId.get(moveId);
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
      ]
        .filter(Boolean)
        .join('\n'),
      partnerId: route.partnerId,
      partnerName: route.partnerName,
      partnerSource: route.partnerSource,
    };
  }

  return {
    byPokemonId: {
      [SMEARGLE_ID]: { moveIds, sources },
    },
    ownedSpecies,
  };
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

function partnerRoute(move, species) {
  const partnerSource = [...(move.availableSources || [])]
    .filter((source) => source.kind !== 'sketch')
    .sort(comparePartnerSources)[0];
  if (!partnerSource) return null;
  return {
    // Hidden Power variants are expanded only after the base move passes its
    // availability gate. One partner variant therefore unlocks the base entry;
    // Smeargle's own type is selected by the same Type Changer progression.
    moveId: move.id.startsWith('hiddenpower') ? 'hiddenpower' : move.id,
    moveName: move.name,
    partnerId: species.id,
    partnerName: species.name,
    partnerSource,
  };
}

function comparePartnerRoutes(a, b) {
  return (
    comparePartnerSources(a.partnerSource, b.partnerSource) ||
    a.partnerName.localeCompare(b.partnerName) ||
    a.partnerId.localeCompare(b.partnerId)
  );
}

function comparePartnerSources(a, b) {
  const costA = sourceCost(a);
  const costB = sourceCost(b);
  return (
    costA.transferSteps - costB.transferSteps ||
    costA.level - costB.level ||
    costA.hassle - costB.hassle ||
    costA.kind - costB.kind ||
    String(a.label || '').localeCompare(String(b.label || '')) ||
    String(a.detail || '').localeCompare(String(b.detail || ''))
  );
}

function sourceCost(source) {
  const kindOrder = {
    'level-up': 0,
    tm: 1,
    tmx: 2,
    tutor: 3,
    relearner: 4,
    egg: 5,
  };
  return {
    // Any direct route beats first arranging another breeding transfer.
    transferSteps: source.kind === 'egg' ? 1 : 0,
    level:
      source.kind === 'relearner'
        ? 200
        : Number.isFinite(source.level)
          ? source.level
          : 0,
    hassle: source.candyDown || source.delayedEvolution ? 1 : 0,
    kind: kindOrder[source.kind] ?? 9,
  };
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
