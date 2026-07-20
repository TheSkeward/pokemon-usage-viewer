import { Dex } from '@pkmn/dex';
import { normalizeName } from './string-utils.mjs';

const DEX = getGen7Dex();

/**
 * @param {!Array<{id: string, name: string}>} pokemonIndex
 * @return {{infoByPokemonId: !Map<string, !Object>,
 *     formsByBaseId: !Map<string, !Array<!Object>>}} Species info plus the
 *     sibling forms grouped under each base species id.
 */
export function buildSpeciesContext(pokemonIndex) {
  const infoByPokemonId = new Map();
  const formsByBaseId = new Map();

  for (const pokemon of pokemonIndex) {
    const info = getSpeciesInfo(pokemon);
    infoByPokemonId.set(info.id, info);
  }

  for (const info of infoByPokemonId.values()) {
    if (!info.baseId) continue;

    const forms = formsByBaseId.get(info.baseId) || [];
    forms.push(info);
    formsByBaseId.set(info.baseId, forms);
  }

  for (const forms of formsByBaseId.values()) {
    forms.sort((a, b) => a.name.localeCompare(b.name));
  }

  return { infoByPokemonId, formsByBaseId };
}

/**
 * Related mons whose sets may be borrowed: sibling/base forms first (Mega ↔
 * base, Totem/Primal/battle-only → base), then the pre-evolution chain.
 *
 * @return {!Array<{id: string, name: string, reason: string}>} Deduped, in
 *     borrow-priority order; `reason` is display text.
 */
export function buildRelatedPokemonChain(pokemon, speciesContext) {
  const info = speciesContext.infoByPokemonId.get(pokemon.id);
  if (!info) return [];

  const chain = [];
  const seen = new Set([pokemon.id]);

  function add(id, reason) {
    const relatedInfo = speciesContext.infoByPokemonId.get(id);
    if (!relatedInfo || seen.has(id)) return;

    seen.add(id);
    chain.push({
      id,
      name: relatedInfo.name,
      reason,
    });
  }

  const baseId =
    info.baseId && speciesContext.infoByPokemonId.has(info.baseId)
      ? info.baseId
      : info.id;

  const siblingForms = speciesContext.formsByBaseId.get(baseId) || [];

  if (info.isMega) {
    for (const sibling of siblingForms.filter(
      (candidate) => candidate.isMega && candidate.id !== info.id,
    )) {
      add(sibling.id, 'alternate Mega form');
    }

    add(baseId, 'base form');
  } else if (info.id === baseId) {
    for (const sibling of siblingForms.filter(
      (candidate) => candidate.isMega,
    )) {
      add(sibling.id, 'Mega form');
    }
  } else {
    add(baseId, getFormReason(info));
  }

  appendPreEvolutionChain({ add, baseId, speciesContext });

  return chain;
}

function appendPreEvolutionChain({ add, baseId, speciesContext }) {
  let current = speciesContext.infoByPokemonId.get(baseId);
  const seen = new Set();

  while (current?.prevoId && !seen.has(current.id)) {
    seen.add(current.id);

    const prevo = speciesContext.infoByPokemonId.get(current.prevoId);
    if (!prevo) return;

    add(prevo.id, 'pre-evolution');
    current = prevo;
  }
}

function getSpeciesInfo(pokemon) {
  const species = DEX.species.get(pokemon.name);
  const name = species?.exists ? species.name : pokemon.name;
  const id = pokemon.id;
  const baseId = species?.baseSpecies ? normalizeName(species.baseSpecies) : id;
  const prevoId = species?.prevo ? normalizeName(species.prevo) : '';

  return {
    id,
    name,
    dexId: species?.id || id,
    baseId,
    prevoId,
    forme: species?.forme || '',
    isMega: Boolean(species?.isMega) || /mega/.test(id),
    isPrimal: /primal/.test(id),
    isTotem: /totem/.test(id),
    isBattleOnly: Boolean(species?.battleOnly),
    isPikachuCosplay:
      id.startsWith('pikachu') &&
      !['pikachu', 'pichu', 'raichu', 'raichualola'].includes(id),
  };
}

function getFormReason(info) {
  if (info.isTotem) return 'normal Totem-relative form';
  if (info.isPrimal) return 'base Primal-relative form';
  if (info.isPikachuCosplay) return 'base Pikachu form';
  if (info.isBattleOnly) return 'base form';
  if (info.forme) return 'base form';

  return 'related form';
}

function getGen7Dex() {
  if (typeof Dex.forGen === 'function') return Dex.forGen(7);
  if (typeof Dex.mod === 'function') return Dex.mod('gen7');
  return Dex;
}
