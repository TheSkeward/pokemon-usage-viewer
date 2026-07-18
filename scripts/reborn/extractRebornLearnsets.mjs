// Extracts level-up (incl. level-0 evolution moves), egg, and TM/tutor-compatible
// move lists from Reborn's compiled mons.dat, keyed by our pokemon-index ids.
// Reborn is the authoritative learnset source for the game this tool targets;
// mainline @pkmn/dex diverges (e.g. Bibarel's evolution move is Water Gun in
// Reborn, Aqua Jet in USUM).

import { readFileSync } from "node:fs";
import { Dex } from "@pkmn/dex";
import { parseMarshal, RubySymbol } from "./parseMarshal.mjs";

const dex = Dex.forGen(7);
const toId = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");

// Reborn move-name → our move id where they differ.
const MOVE_ALIASES = { vicegrip: "visegrip", hijumpkick: "highjumpkick" };
// Our species id → Reborn species id where they differ (Reborn keeps the gender
// suffix on the Nidoran symbols).
const SPECIES_ALIASES = { nidoranf: "nidoranfe", nidoranm: "nidoranma" };
const moveId = (sym) => {
  const id = toId(sym.name);
  return MOVE_ALIASES[id] || id;
};

export function loadRebornMons(monsDatPath) {
  const top = parseMarshal(readFileSync(monsDatPath));
  // base species id → { species symbol, forms: Map(formName → MonData) }
  const bySpecies = new Map();
  for (const [key, wrapper] of top) {
    if (!(key instanceof RubySymbol)) continue;
    const pokemonData = wrapper.ivars.get("@pokemonData");
    if (!pokemonData) continue;
    const forms = new Map();
    for (const [formKey, monData] of pokemonData) {
      forms.set(formKey.rubyString ?? String(formKey), monData);
    }
    bySpecies.set(toId(key.name), forms);
  }
  return bySpecies;
}

// Normalised form token for matching Reborn form names against @pkmn/dex formes.
const normForm = (name) =>
  toId(String(name).replace(/\b(form|forme)\b/gi, ""));

const hasMoveset = (monData) =>
  monData && (monData.ivars.get("@Moveset") || []).length > 0;

// Prefer the requested form, but Mega/Primal/Arceus-plate/etc. forms carry an
// empty moveset in Reborn (they share the base learnset, stored only on the
// canonical form), so fall back to Normal Form, then to any form that actually
// holds a moveset.
function pickMonData(forms, preferred) {
  if (hasMoveset(preferred)) return preferred;
  const normal = forms.get("Normal Form");
  if (hasMoveset(normal)) return normal;
  for (const monData of forms.values()) if (hasMoveset(monData)) return monData;
  return preferred || normal || [...forms.values()][0];
}

// Resolves the form to read for this id, plus the canonical (base-learnset) form
// to back-fill from. Alolan Raichu et al. carry their own learnset; Mega/Primal/
// Arceus-plate forms share the base's, and Kyurem's fusion forms carry their own
// moveset but an empty compatible-moves list — so each field falls back to the
// base form independently.
function resolveMonData(ourId, bySpecies) {
  const species = dex.species.get(ourId);
  const baseId = species?.exists
    ? toId(species.baseSpecies || species.name)
    : ourId;
  const lookup = (id) => bySpecies.get(SPECIES_ALIASES[id] || id);
  const forms = lookup(baseId) || lookup(ourId);
  if (!forms) return null;

  const base = pickMonData(forms, forms.get("Normal Form"));
  if (!species?.forme) return { primary: base, base };

  const target = normForm(species.forme);
  let matched = null;
  for (const [formName, monData] of forms) {
    const token = normForm(formName);
    if (
      token &&
      (token === target || token.startsWith(target) || target.startsWith(token))
    ) {
      matched = monData;
      break;
    }
  }
  return { primary: pickMonData(forms, matched), base };
}

const moveList = (monData, field) =>
  (monData.ivars.get(field) || []).map(moveId);

// Reads a list field from the form, falling back to the base form when the form
// leaves it empty (fusion forms carry their own moveset but no compatible list).
const listWithBase = (primary, base, field) => {
  const own = moveList(primary, field);
  return own.length || primary === base ? own : moveList(base, field);
};

function extractMoves(primary, base) {
  const moveset = (primary.ivars.get("@Moveset") || []).length
    ? primary.ivars.get("@Moveset")
    : base.ivars.get("@Moveset") || [];
  const levelUp = []; // [level, moveId] for level >= 1
  const evolutionMoves = []; // moves at level 0
  for (const [level, sym] of moveset) {
    const id = moveId(sym);
    if (level === 0) evolutionMoves.push(id);
    else levelUp.push([level, id]);
  }
  return {
    levelUp,
    evolutionMoves,
    eggMoves: listWithBase(primary, base, "@EggMoves"),
    compatibleMoves: listWithBase(primary, base, "@compatiblemoves"),
    relearnerMoves: listWithBase(primary, base, "@RelearnerMoves"),
  };
}

export function buildRebornLearnsets(monsDatPath, pokemonIndex) {
  const bySpecies = loadRebornMons(monsDatPath);
  const learnsets = {};
  const unmapped = [];
  for (const pokemon of pokemonIndex) {
    const resolved = resolveMonData(pokemon.id, bySpecies);
    if (!resolved) {
      unmapped.push(pokemon.id);
      continue;
    }
    learnsets[pokemon.id] = extractMoves(resolved.primary, resolved.base);
  }
  return { learnsets, unmapped };
}
