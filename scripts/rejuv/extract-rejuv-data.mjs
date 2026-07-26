/**
 * @fileoverview Extracts Rejuvenation's compiled Data/*.dat files (Ruby
 * Marshal, same engine family as Reborn) into plain JSON. Everything is keyed
 * by the game's own species symbols and form names — mapping onto our
 * pokemon-index ids is deliberately left to the dex-integration layer, so the
 * extraction stays faithful to the game files and reruns cleanly on game
 * updates.
 *
 * Battle-scripting payloads (trainer effect scripts, boss break effects) are
 * dropped: the consumers of these extracts build and rank teams, they never
 * simulate fights.
 */
import { RubyObject, RubySymbol } from '../reborn/parse-marshal.mjs';

/**
 * Encounter-table slot order and per-slot rates, from Scripts/Encounters.rb
 * (module EncounterTypes). encounters.dat stores tables as bare arrays in
 * this index order; the rates are engine constants, embedded here so the
 * encounters extract is self-contained.
 */
export const ENCOUNTER_TYPES = [
  'Land',
  'Cave',
  'Water',
  'RockSmash',
  'OldRod',
  'GoodRod',
  'SuperRod',
  'Headbutt',
  'LandMorning',
  'LandDay',
  'LandNight',
  'BugContest',
  'Lava',
];

/** Per-slot encounter chances by type, index-aligned with ENCOUNTER_TYPES. */
export const ENCOUNTER_SLOT_CHANCES = [
  [20, 15, 12, 10, 10, 10, 5, 5, 5, 4, 2, 2],
  [20, 15, 12, 10, 10, 10, 5, 5, 5, 4, 2, 2],
  [50, 25, 15, 7, 3],
  [50, 25, 15, 7, 3],
  [70, 30],
  [60, 20, 20],
  [40, 35, 15, 7, 3],
  [30, 25, 20, 10, 5, 5, 4, 1],
  [20, 15, 12, 10, 10, 10, 5, 5, 5, 4, 2, 2],
  [20, 15, 12, 10, 10, 10, 5, 5, 5, 4, 2, 2],
  [20, 15, 12, 10, 10, 10, 5, 5, 5, 4, 2, 2],
  [20, 15, 12, 10, 10, 10, 5, 5, 5, 4, 2, 2],
  [50, 25, 15, 7, 3],
];

// The Marshal reader decodes byte strings as latin1; the game files are
// UTF-8, so re-decode ("PokÃ©mon" → "Pokémon").
const decode = (value) =>
  value == null ? null : Buffer.from(value.rubyString, 'latin1').toString('utf8');

const sym = (value) => (value instanceof RubySymbol ? value.name : null);

const plainKey = (key) => {
  if (key instanceof RubySymbol) return key.name;
  if (key != null && typeof key === 'object' && 'rubyString' in key) {
    return decode(key);
  }
  return String(key);
};

/**
 * Converts a parsed Marshal value of plain data (symbols, strings, numbers,
 * arrays, hashes) to JSON-ready values. Ruby objects flatten to null — the
 * curated extractors below read the ivars they need directly.
 * @param {*} value
 * @return {*}
 */
export function toPlain(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof RubySymbol) return value.name;
  if (value instanceof RubyObject) return null;
  if (value instanceof Map) {
    const out = {};
    for (const [key, entry] of value) out[plainKey(key)] = toPlain(entry);
    return out;
  }
  if (Array.isArray(value)) return value.map(toPlain);
  if (typeof value === 'object') {
    if ('rubyString' in value) return decode(value);
    if ('rubyFloat' in value) return value.rubyFloat;
    if ('rubyUserdef' in value) return null;
  }
  return value;
}

function* monDataForms(mons) {
  for (const [key, wrapper] of mons) {
    if (!(key instanceof RubySymbol)) continue;
    const pokemonData = wrapper.ivars.get('@pokemonData');
    if (!pokemonData) continue;
    for (const [formKey, monData] of pokemonData) {
      yield { species: key.name, form: plainKey(formKey), monData };
    }
  }
}

/**
 * Dex facts per species and form: identity, stats, abilities, breeding
 * fields, and the evolution graph (forward @evolutions with method +
 * parameter, plus the @preevo back-pointer and mega stones).
 * @param {!Map} mons Parsed mons.dat.
 * @return {!Object<string, !Object<string, !Object>>} species → form → data.
 */
export function extractDex(mons) {
  const out = {};
  for (const { species, form, monData } of monDataForms(mons)) {
    const iv = (name) => monData.ivars.get(name);
    const types = [sym(iv('@Type1')), sym(iv('@Type2'))];
    (out[species] ??= {})[form] = {
      name: decode(iv('@name')),
      dexnum: iv('@dexnum'),
      types: [...new Set(types.filter(Boolean))],
      baseStats: iv('@BaseStats'),
      abilities: (iv('@Abilities') ?? []).map(sym),
      hiddenAbility: sym(iv('@HiddenAbility')),
      eggGroups: (iv('@EggGroups') ?? []).map(sym),
      genderRatio: sym(iv('@GenderRatio')),
      evolutions: toPlain(iv('@evolutions') ?? []),
      preevo: toPlain(iv('@preevo')),
      megaEvolutions: toPlain(iv('@MegaEvolutions') ?? {}),
    };
  }
  return out;
}

/**
 * Learnsets per species and form, in the same field vocabulary as the Reborn
 * extract: level-0 moveset entries are evolution moves.
 * @param {!Map} mons Parsed mons.dat.
 * @return {!Object<string, !Object<string, !Object>>} species → form → moves.
 */
export function extractLearnsets(mons) {
  const out = {};
  for (const { species, form, monData } of monDataForms(mons)) {
    const iv = (name) => monData.ivars.get(name);
    const levelUp = [];
    const evolutionMoves = [];
    for (const [level, move] of iv('@Moveset') ?? []) {
      if (level === 0) evolutionMoves.push(sym(move));
      else levelUp.push([level, sym(move)]);
    }
    (out[species] ??= {})[form] = {
      levelUp,
      evolutionMoves,
      eggMoves: (iv('@EggMoves') ?? []).map(sym),
      compatibleMoves: (iv('@compatiblemoves') ?? []).map(sym),
      relearnerMoves: (iv('@RelearnerMoves') ?? []).map(sym),
      moveExceptions: (iv('@moveexceptions') ?? []).map(sym),
    };
  }
  return out;
}

/**
 * Move metadata — the source of truth for Rejuvenation's custom moves and
 * rebalances that no mainline dex carries.
 * @param {!Map} moves Parsed moves.dat.
 * @return {!Object<string, !Object>}
 */
export function extractMoves(moves) {
  const out = {};
  for (const [key, move] of moves) {
    const iv = (name) => move.ivars.get(name);
    out[key.name] = {
      name: decode(iv('@name')),
      type: sym(iv('@type')),
      category: sym(iv('@category')),
      basePower: iv('@basedamage'),
      accuracy: iv('@accuracy'),
      pp: iv('@maxpp'),
      target: sym(iv('@target')),
      function: iv('@function'),
      flags: toPlain(iv('@flags') ?? {}),
    };
  }
  return out;
}

/**
 * Item names, prices, and behavior flags (hold/fling/usability).
 * Descriptions are display prose and stay out.
 * @param {!Map} items Parsed items.dat.
 * @return {!Object<string, !Object>}
 */
export function extractItems(items) {
  const out = {};
  for (const [key, item] of items) {
    out[key.name] = {
      name: decode(item.ivars.get('@name')),
      price: item.ivars.get('@price') ?? null,
      flags: toPlain(item.ivars.get('@flags') ?? {}),
    };
  }
  return out;
}

/**
 * @param {!Map} mons Parsed mons.dat.
 * @return {!Map<number, string>} dexnum → species symbol (base forms).
 */
export function dexnumToSpecies(mons) {
  const out = new Map();
  for (const { species, monData } of monDataForms(mons)) {
    const dexnum = monData.ivars.get('@dexnum');
    if (dexnum != null && !out.has(dexnum)) out.set(dexnum, species);
  }
  return out;
}

/**
 * Wild encounter tables per map. encounters.dat stores species as dex
 * numbers; they resolve to species symbols here so the extract stands alone.
 * @param {!Map} encounters Parsed encounters.dat (map id → [density, tables]).
 * @param {!Map} mapInfos Parsed MapInfos.rxdata (map id → RPG::MapInfo).
 * @param {!Map<number, string>} bySpeciesNum From dexnumToSpecies().
 * @return {!Array<!Object>} Sorted by map id.
 */
export function extractEncounters(encounters, mapInfos, bySpeciesNum) {
  const maps = [];
  for (const [mapId, entry] of encounters) {
    const [density, tables] = Array.isArray(entry) ? entry : [null, null];
    const types = {};
    (tables ?? []).forEach((slots, index) => {
      if (!Array.isArray(slots) || !slots.length) return;
      types[ENCOUNTER_TYPES[index] ?? `type${index}`] = slots.map(
        ([dexnum, min, max]) => ({
          species: bySpeciesNum.get(dexnum) ?? dexnum,
          min,
          max,
        }),
      );
    });
    const info = mapInfos.get(mapId);
    maps.push({
      mapId,
      mapName: info ? decode(info.ivars.get('@name')) : null,
      density,
      types,
    });
  }
  return maps.sort((a, b) => a.mapId - b.mapId);
}

/**
 * Structured shop inventories (marts.dat covers scripted shops; event-embedded
 * shops live in map data and are out of scope here). A category holds either
 * a stock list or {ref} naming another mart whose inventory it embeds
 * (CairoShop's sub-shops).
 * @param {!Map} marts Parsed marts.dat.
 * @return {!Object<string, !Object>}
 */
export function extractMarts(marts) {
  const out = {};
  for (const [key, mart] of marts) {
    const categories = {};
    for (const [category, stocks] of mart.ivars.get('@Inventory') ?? []) {
      if (stocks instanceof RubySymbol) {
        categories[plainKey(category)] = { ref: stocks.name };
        continue;
      }
      categories[plainKey(category)] = (stocks ?? []).map((stock) => {
        if (!(stock instanceof RubyObject)) return { item: sym(stock) };
        const iv = (name) => stock.ivars.get(name);
        return {
          item: sym(iv('@item')),
          price: iv('@price') ?? null,
          currency: sym(iv('@currency')),
          quantity: iv('@quantity') ?? null,
          conditions: toPlain(iv('@conditions') ?? []),
        };
      });
    }
    out[key.name] = {
      categories,
      allowSell: mart.ivars.get('@allowSell') ?? false,
    };
  }
  return out;
}

/**
 * Trainer rosters flattened to one record per registered party.
 * @param {!Map} trainers Parsed trainers.dat or trainers_story.dat
 *     (trainer type → display name → party id → TeamData).
 * @return {!Array<!Object>}
 */
export function extractTrainers(trainers) {
  const out = [];
  for (const [type, byName] of trainers) {
    for (const [name, byParty] of byName) {
      for (const [partyId, team] of byParty) {
        out.push({
          trainerType: sym(type) ?? plainKey(type),
          name: plainKey(name),
          partyId,
          items: toPlain(team.ivars.get('@items') ?? []),
          party: toPlain(team.ivars.get('@party') ?? []),
        });
      }
    }
  }
  return out;
}

/**
 * Boss encounters: the lead mon plus SOS reinforcements.
 * @param {!Map} bosses Parsed bossdata.dat or bossdata_story.dat.
 * @return {!Array<!Object>}
 */
export function extractBosses(bosses) {
  const out = [];
  for (const [key, boss] of bosses) {
    const iv = (name) => boss.ivars.get(name);
    out.push({
      id: key.name,
      name: decode(iv('@name')),
      shieldCount: iv('@shieldCount') ?? null,
      mon: toPlain(iv('@moninfo')),
      sos: toPlain(iv('@sosDetails')),
    });
  }
  return out;
}
