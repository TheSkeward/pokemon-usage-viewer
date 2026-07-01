import { MOVE_META } from './generated/gen7MoveMeta.generated.js';
import { toId as moveId } from './utils/ids.js';

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

export function getMoveMeta(name) {
  const rawName = String(name || '').trim();
  const id = moveId(rawName);
  if (!id) return null;
  if (cache.has(id)) return cache.get(id);

  // Hidden Power's elemental type lives in the move name ("Hidden Power Ice"),
  // not in the base dex entry, so the generated table only has a single
  // "hiddenpower" key. Resolve the variant type from the name suffix; in Gen 7
  // Hidden Power is always Special regardless of type.
  const meta = resolveHiddenPower(rawName) || MOVE_META[id] || null;
  cache.set(id, meta);
  return meta;
}

function resolveHiddenPower(name) {
  const match = /^hidden\s*power\s+([a-z]+)$/i.exec(name);
  if (!match) return null;

  const type = match[1][0].toUpperCase() + match[1].slice(1).toLowerCase();
  if (!VALID_TYPES.has(type)) return null;

  return { name: `Hidden Power ${type}`, type, category: 'Special' };
}

// Looks up a move's intrinsic properties by id from the central table. This is
// the single source of truth for name/type/category/basePower/priority, so a
// change to a move propagates everywhere without per-file duplication.
export function getMoveMetaById(id) {
  return MOVE_META[id] || null;
}

// Rejoins a stripped legal-move entry ({ id, sources }) with its central
// metadata, reproducing the fully-populated move object the rest of the app
// consumes. Unknown ids fall back to inert defaults so a missing entry can't
// crash a render.
export function hydrateLegalMove(rawMove) {
  const meta = MOVE_META[rawMove.id] || null;
  return {
    id: rawMove.id,
    name: meta?.name ?? rawMove.id,
    type: meta?.type ?? "Normal",
    category: meta?.category ?? "Status",
    basePower: meta?.basePower ?? 0,
    priority: meta?.priority ?? 0,
    utility: meta?.utility ?? false,
    // Utility role kinds (recovery / setup / hazard_set / speed_control / ...),
    // so utility scoring can value real team infrastructure over chip status.
    roles: meta?.roles ?? [],
    // Hit rate (0–100) so the damage estimate can weight by expected accuracy.
    accuracy: meta?.accuracy ?? 100,
    // Multi-hit / recharge / charge flags feed the effective-power damage model.
    multihit: meta?.multihit,
    recharge: meta?.recharge ?? false,
    charge: meta?.charge ?? false,
    sources: rawMove.sources,
  };
}

export function getTypeColor(type) {
  return TYPE_COLORS[type] || '#AAB5C3';
}

export function getCategoryColor(category) {
  return CATEGORY_COLORS[category] || '#AAB5C3';
}
