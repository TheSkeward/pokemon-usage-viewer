import { MOVE_META } from './generated/gen7MoveMeta.generated.js';
import { toId } from './utils/ids.js';

const TYPE_COLORS = {
  Normal: '#A8A77A',
  Fire: '#EE8130',
  Water: '#6390F0',
  Electric: '#F7D02C',
  Grass: '#7AC74C',
  Ice: '#96D9D6',
  Fighting: '#C22E28',
  Poison: '#A33EA1',
  Ground: '#E2BF65',
  Flying: '#A98FF3',
  Psychic: '#F95587',
  Bug: '#A6B91A',
  Rock: '#B6A136',
  Ghost: '#735797',
  Dragon: '#6F35FC',
  Dark: '#705746',
  Steel: '#B7B7CE',
  Fairy: '#D685AD',
};

const CATEGORY_COLORS = {
  Physical: '#E85D75',
  Special: '#5DA9E9',
  Status: '#9AA5B1',
};

const VALID_TYPES = new Set(Object.keys(TYPE_COLORS));

const cache = new Map();

/**
 * @param {string} name Move display name.
 * @return {?Object} Move metadata, or null when unknown.
 */
export function getMoveMeta(name) {
  const rawName = String(name || '').trim();
  const id = toId(rawName);
  if (!id) return null;
  if (cache.has(id)) return cache.get(id);

  // Hidden Power's elemental type lives in the move name, not in the base dex
  // entry. Accept every representation used across the app and scraped teams:
  // "Hidden Power Ice", "Hidden Power [Ice]", and "hiddenpowerice".
  const meta = resolveHiddenPower(rawName) || MOVE_META[id] || null;
  cache.set(id, meta);
  return meta;
}

function resolveHiddenPower(name) {
  const match = /^hiddenpower([a-z]+)$/.exec(toId(name));
  if (!match) return null;

  const type = match[1][0].toUpperCase() + match[1].slice(1).toLowerCase();
  if (!VALID_TYPES.has(type)) return null;

  // Gen 7: Hidden Power is always 60 BP / 100% acc regardless of type.
  return {
    name: `Hidden Power ${type}`,
    type,
    category: 'Special',
    basePower: 60,
    accuracy: 100,
  };
}

/**
 * @param {string} id
 * @return {?Object}
 */
export function getMoveMetaById(id) {
  return getMoveMeta(id);
}

/**
 * Rejoins a stripped legal-move entry ({ id, sources }) with its central
 * metadata, reproducing the fully-populated move object the rest of the app
 * consumes, including screen mechanics. Unknown ids fall back to inert
 * defaults so a missing entry can't crash a render.
 */
export function hydrateLegalMove(rawMove) {
  const meta = getMoveMetaById(rawMove.id);
  return {
    id: rawMove.id,
    name: meta?.name ?? rawMove.id,
    type: meta?.type ?? 'Normal',
    category: meta?.category ?? 'Status',
    basePower: meta?.basePower ?? 0,
    priority: meta?.priority ?? 0,
    utility: meta?.utility ?? false,
    // Utility role kinds (recovery / setup / hazard_set / speed_control / ...),
    // so utility scoring can value real team infrastructure over chip status.
    roles: meta?.roles ?? [],
    // Per-action screen coverage and any weather gate. This lets scoring
    // distinguish Aurora Veil from one-axis screens without naming a user.
    screenAxes: meta?.screenAxes ?? [],
    requiresWeather: meta?.requiresWeather,
    // Hit rate (0–100) so the damage estimate can weight by expected accuracy.
    accuracy: meta?.accuracy ?? 100,
    // Multi-hit / recharge / charge flags feed the effective-power damage
    // model.
    multihit: meta?.multihit,
    recharge: meta?.recharge ?? false,
    charge: meta?.charge ?? false,
    // Ability-interaction flags (contact/punch/bite/pulse/sound/recoil/
    // secondary) — which abilities boost or convert this move is decided by
    // these move properties (damageModel.getAbilityDamageMultiplier).
    flags: meta?.flags ?? {},
    sources: rawMove.sources,
  };
}

/**
 * One-line move facts for tooltips: "Rock · Physical · 100 BP · 80% acc",
 * with priority only when it isn't 0 ("+2 priority"). Status moves skip BP.
 * Empty string for unknown moves so callers can omit the tooltip.
 * @return {string}
 */
export function describeMoveMeta(meta) {
  if (!meta) return '';
  const parts = [meta.type, meta.category];
  if (meta.category !== 'Status' && meta.basePower > 0) {
    parts.push(`${meta.basePower} BP`);
  }
  parts.push(`${meta.accuracy ?? 100}% acc`);
  if (meta.priority) {
    parts.push(`${meta.priority > 0 ? '+' : ''}${meta.priority} priority`);
  }
  return parts.filter(Boolean).join(' · ');
}

/** @return {string} CSS color for the type; neutral gray when unknown. */
export function getTypeColor(type) {
  return TYPE_COLORS[type] || '#AAB5C3';
}

/** @return {string} CSS color for the category; neutral gray when unknown. */
export function getCategoryColor(category) {
  return CATEGORY_COLORS[category] || '#AAB5C3';
}
