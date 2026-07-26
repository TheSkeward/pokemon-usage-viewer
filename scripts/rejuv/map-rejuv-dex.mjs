/**
 * @fileoverview Maps Rejuvenation's species forms and moves onto Gen 9
 * (@pkmn/dex) identities — the bridge between the game-keyed extracts and
 * every mainline-keyed dataset (usage priors, move meta, breeding data).
 *
 * Species matching is data-driven, not name-driven: a form maps to the
 * dex candidate sharing its exact base stats and types, which resolves every
 * cosmetic and regional naming quirk automatically and refuses to map
 * anything Rejuvenation actually changed. Statuses, by prior availability:
 *   - 'mainline': NatDex-standard identity (isNonstandard null or 'Past' —
 *     NatDex formats legalize past-generation content, megas included), so
 *     usage priors can exist.
 *   - 'nonstandard': identity exists in the dex but outside NatDex play
 *     (isNonstandard 'Future'/'CAP', e.g. the Z-Megas) — keeps its pkmnId
 *     for naming, but no format can supply a prior.
 *   - 'restatted': same name and types, altered statline (Cresselia keeps
 *     her pre-Gen-9 stats; Dipplin is buffed). Keeps its pkmnId — the prior
 *     is still about the same mon, and stat math reads the game extract.
 *   - 'retyped': mainline statline, different type (several Aevian forms).
 *   - 'custom': no mainline identity (Aevian/Rift/Giga/Amalgamation/bosses).
 * The last three are the no-possible-prior census; 'retyped' and 'restatted'
 * are split out because they still support reasoning against mainline data.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Dex } = require('@pkmn/dex');

const d9 = Dex.forGen(9);
const toId = (value) => String(value).toLowerCase().replace(/[^a-z0-9]/g, '');

// Rejuv species symbol → @pkmn id where straight normalization differs.
const SPECIES_ALIASES = { nidoranfe: 'nidoranf', nidoranma: 'nidoranm' };

const statsOf = (species) => [
  species.baseStats.hp,
  species.baseStats.atk,
  species.baseStats.def,
  species.baseStats.spa,
  species.baseStats.spd,
  species.baseStats.spe,
];

const sameStats = (a, b) => a?.length === 6 && a.every((v, i) => v === b[i]);
const sameTypes = (a, b) =>
  toId([...a].sort().join('')) === toId([...b].sort().join(''));

// NatDex formats legalize past-generation content; everything else outside
// the standard dex (Future, CAP) can never appear in usage statistics.
const inNatDex = (candidate) =>
  candidate.isNonstandard == null || candidate.isNonstandard === 'Past';

// Reborn-style form-name → forme resolution for the identity fallback:
// "Aevian Form" → "Aevian", matched against "<Base>-<Token>".
const formeByName = (base, form) => {
  if (form === 'Normal Form') return base;
  const token = form.replace(/\b(form|forme)\b/gi, '').trim();
  if (!token) return base;
  const candidate = d9.species.get(`${base.name}-${token}`);
  return candidate.exists ? candidate : null;
};

/**
 * @param {!Object} rejuvDex Parsed rejuv-dex.generated.json data.
 * @return {{species: !Object, summary: !Object}} Per species symbol → form →
 *     {pkmnId, status} per the fileoverview taxonomy; pkmnId is null for
 *     'retyped' and 'custom'.
 */
export function mapSpecies(rejuvDex) {
  const species = {};
  const summary =
    { mainline: 0, nonstandard: 0, restatted: 0, retyped: 0, custom: 0 };
  const record = (mapped, form, pkmnId, status) => {
    mapped[form] = { pkmnId, status };
    summary[status]++;
  };
  for (const [sym, forms] of Object.entries(rejuvDex)) {
    const base = d9.species.get(SPECIES_ALIASES[toId(sym)] || toId(sym));
    const candidates = base.exists
      ? [
        base,
        ...(base.otherFormes || []).map((name) => d9.species.get(name)),
        ...(base.cosmeticFormes || []).map((name) => d9.species.get(name)),
      ].filter((candidate) => candidate.exists)
      : [];
    const mapped = {};
    for (const [form, data] of Object.entries(forms)) {
      if (!data.baseStats) continue;
      const exact = candidates.find(
        (c) => sameStats(data.baseStats, statsOf(c)) &&
          sameTypes(data.types, c.types),
      );
      if (exact) {
        record(
          mapped, form, exact.id, inNatDex(exact) ? 'mainline' : 'nonstandard',
        );
        continue;
      }
      if (candidates.some((c) => sameStats(data.baseStats, statsOf(c)))) {
        record(mapped, form, null, 'retyped');
        continue;
      }
      const named = base.exists ? formeByName(base, form) : null;
      if (named && sameTypes(data.types, named.types)) {
        record(mapped, form, named.id, 'restatted');
        continue;
      }
      record(mapped, form, null, 'custom');
    }
    species[sym] = mapped;
  }
  return { species, summary };
}

// Mainline sentinel base powers (0/1) mark variable-power moves; Rejuvenation
// stores 1 for them, which is not a rebalance.
const isSentinelPower = (bp) => bp === 0 || bp === 1;

/**
 * @param {!Object} rejuvMoves Parsed rejuv-moves.generated.json data.
 * @return {{moves: !Object, summary: !Object}} Per move symbol →
 *     {pkmnId, status, changes?}: 'mainline' (identical where comparable),
 *     'rebalanced' (mainline move, altered power/type/category), or
 *     'custom' (no mainline identity).
 */
export function mapMoves(rejuvMoves) {
  const moves = {};
  const summary = { mainline: 0, rebalanced: 0, custom: 0 };
  for (const [sym, data] of Object.entries(rejuvMoves)) {
    const move = d9.moves.get(toId(sym));
    if (!move.exists || !inNatDex(move)) {
      moves[sym] = { pkmnId: move.exists ? move.id : null, status: 'custom' };
      summary.custom++;
      continue;
    }
    const changes = {};
    if (
      data.basePower != null &&
      move.basePower !== data.basePower &&
      !(isSentinelPower(move.basePower) && isSentinelPower(data.basePower))
    ) {
      changes.basePower = [move.basePower, data.basePower];
    }
    if (data.type && toId(move.type) !== toId(data.type)) {
      changes.type = [move.type, data.type];
    }
    if (
      data.category &&
      toId(move.category) !== toId(data.category)
    ) {
      changes.category = [move.category, data.category];
    }
    const rebalanced = Object.keys(changes).length > 0;
    moves[sym] = {
      pkmnId: move.id,
      status: rebalanced ? 'rebalanced' : 'mainline',
      ...(rebalanced ? { changes } : {}),
    };
    summary[rebalanced ? 'rebalanced' : 'mainline']++;
  }
  return { moves, summary };
}

/**
 * Classifies HELD battle items only. Membership in the Showdown item dex is
 * the definition of "competitively modeled" (berries carry no hold flags in
 * the game data, but the dex knows them); items outside the dex count only
 * when the game's own hold-flag vocabulary marks them holdable — that
 * remainder (crests, game-only gear) is the custom census. Bag items fail
 * both tests and stay out entirely.
 * @param {!Object} rejuvItems Parsed rejuv-items.generated.json data.
 * @return {{items: !Object, summary: !Object}} Per held-item symbol →
 *     {pkmnId, status}: 'mainline' or 'custom'.
 */
export function mapItems(rejuvItems) {
  const items = {};
  const summary = { mainline: 0, custom: 0 };
  for (const [sym, data] of Object.entries(rejuvItems)) {
    const flags = data.flags || {};
    const item = d9.items.get(toId(sym));
    if (item.exists && inNatDex(item)) {
      items[sym] = { pkmnId: item.id, status: 'mainline' };
      summary.mainline++;
      continue;
    }
    const held = flags.battlehold || flags.crest || flags.typeboost ||
      flags.consumehold || flags.plate || flags.incense;
    if (!held) continue;
    items[sym] = { pkmnId: item.exists ? item.id : null, status: 'custom' };
    summary.custom++;
  }
  return { items, summary };
}
