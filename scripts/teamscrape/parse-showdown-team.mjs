/**
 * @fileoverview Parser for the Showdown/pokepaste team-export text format:
 * blank-line-separated set blocks of the shape
 *   Nickname (Species) (M) @ Item
 *   Ability: ...
 *   Level: 50            (optional; also Shiny/Happiness/Hidden Power/Dynamax)
 *   EVs: 252 HP / 4 Atk  (optional)
 *   Adamant Nature       (optional)
 *   IVs: 0 Spe           (optional)
 *   - Move
 * Inverse of formatShowdownSet (src/reborn/team-analysis.js). Tolerant by
 * design: scraped pastes carry smogon-dialect quirks (curly quotes, stray
 * whitespace, missing sections), and a malformed block yields null rather
 * than aborting the team.
 */

import { toId } from '../../src/utils/ids.js';

const STAT_KEYS = { hp: 'hp', atk: 'atk', def: 'def', spa: 'spa', spd: 'spd', spe: 'spe' };
const GENDER_TOKENS = new Set(['M', 'F', 'N']);

function parseStatLine(rest) {
  const out = {};
  for (const part of rest.split('/')) {
    const match = part.trim().match(/^(\d+)\s*(HP|Atk|Def|SpA|SpD|Spe)$/i);
    if (!match) return null;
    out[STAT_KEYS[match[2].toLowerCase()]] = Number(match[1]);
  }
  return out;
}

// "Garchomp-Mega (F) @ Garchompite" → species/gender/item. The species name
// itself may contain parentheses only in the nickname case — Showdown always
// puts the true species in the LAST parenthetical that isn't a gender tag.
function parseHeaderLine(line) {
  let rest = line;
  let item = null;
  const atIndex = rest.lastIndexOf(' @ ');
  if (atIndex !== -1) {
    item = rest.slice(atIndex + 3).trim() || null;
    rest = rest.slice(0, atIndex);
  }
  rest = rest.trim();

  let gender = null;
  const parens = [...rest.matchAll(/\(([^()]*)\)/g)];
  const trailing = [];
  while (parens.length) {
    const last = parens[parens.length - 1];
    if (last.index + last[0].length < rest.trimEnd().length) break;
    trailing.unshift(parens.pop());
    rest = rest.slice(0, last.index).trimEnd();
  }
  let species = null;
  for (const paren of trailing) {
    const inner = paren[1].trim();
    if (GENDER_TOKENS.has(inner)) gender = inner;
    else if (inner) species = inner;
  }
  if (!species) species = rest;
  if (!species.trim()) return null;
  return { species: species.trim(), gender, item };
}

/**
 * Parses one export block into a set record.
 * @param {string} block
 * @return {?Object} The set (names plus toId'd ids for species/item/ability/
 *     moves; null fields where the paste omits a section), or null for a
 *     malformed block.
 */
export function parseShowdownSet(block) {
  const lines = block
    .replace(/ /g, ' ')
    // Zero-width characters (forum formatting hacks) are invisible but
    // break every line-shape match below.
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return null;
  const header = parseHeaderLine(lines[0]);
  if (!header) return null;

  const set = {
    species: header.species,
    speciesId: toId(header.species),
    gender: header.gender,
    item: header.item,
    itemId: header.item ? toId(header.item) : null,
    ability: null,
    abilityId: null,
    level: null,
    nature: null,
    evs: null,
    ivs: null,
    moves: [],
    moveIds: [],
  };

  for (const line of lines.slice(1)) {
    if (line.startsWith('- ') || line.startsWith('– ')) {
      const move = line.slice(2).trim();
      if (move) {
        set.moves.push(move);
        set.moveIds.push(toId(move));
      }
      continue;
    }
    const labeled = line.match(/^([A-Za-z ]+):\s*(.+)$/);
    if (labeled) {
      const label = labeled[1].trim().toLowerCase();
      const rest = labeled[2].trim();
      if (label === 'ability') {
        set.ability = rest;
        set.abilityId = toId(rest);
      } else if (label === 'level') {
        const level = Number.parseInt(rest, 10);
        if (Number.isFinite(level)) set.level = level;
      } else if (label === 'evs') {
        set.evs = parseStatLine(rest) ?? set.evs;
      } else if (label === 'ivs') {
        set.ivs = parseStatLine(rest) ?? set.ivs;
      }
      // Shiny / Happiness / Dynamax Level / Tera Type / Hidden Power are
      // deliberately dropped: nothing downstream reads them.
      continue;
    }
    const nature = line.match(/^([A-Za-z]+)\s+Nature$/i);
    if (nature) set.nature = nature[1];
  }

  // No moves means the block wasn't a set at all — any prose first line
  // parses as a "species", so the move list is the real shape test.
  if (!set.speciesId || !set.moves.length) return null;
  return set;
}

/**
 * Returns { sets, dropped, format } — dropped counts malformed blocks so
 * harvest telemetry can distinguish "empty paste" from "paste we failed to
 * read"; format is the id from a "=== [gen7ou] My Team ===" header when the
 * paste carries one (the reliable per-paste attribution in mixed-tier
 * tournament dump threads), else null.
 * @param {string} text
 * @return {{sets: !Array<!Object>, dropped: number, format: ?string}}
 */
export function parseShowdownTeam(text) {
  const blocks = String(text || '')
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean);
  const sets = [];
  let dropped = 0;
  let format = null;
  for (const block of blocks) {
    const header = block.split('\n')[0].match(/^===\s*(?:\[(\w+)\])?.*===$/);
    if (header) {
      format = format || header[1] || null;
      continue;
    }
    const set = parseShowdownSet(block);
    if (set) sets.push(set);
    else dropped += 1;
  }
  return { sets, dropped, format };
}
