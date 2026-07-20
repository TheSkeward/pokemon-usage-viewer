/**
 * @fileoverview Extracts per-side team compositions from a Showdown replay's
 * battle log. Species come from team-preview `|poke|` lines unioned with
 * `|switch|`/`|drag|` appearances (formats without preview, Zoroark reveals,
 * forced switches). Only base composition is extracted — moves/items stay
 * unread because replay reveals are too partial to qualify as observed sets.
 */
import { toId } from '../../src/utils/ids.js';
import { GEN7_PROGRESSION_SPECIES } from '../../src/generated/gen7ProgressionSpecies.generated.js';

// "|switch|p1a: Nickname|Skuntank, L78, F|100/100" → details field holds the
// species before the first comma. `|poke|p1|Skuntank, F|item` likewise.
function speciesFromDetails(details) {
  return toId(String(details || '').split(',')[0]);
}

/**
 * @param {string} log Raw battle log text.
 * @return {!Array<!Array<string>>} [p1, p2] as sorted species-id arrays.
 */
export function parseReplayTeams(log) {
  const sides = { p1: new Set(), p2: new Set() };
  for (const line of String(log || '').split('\n')) {
    if (!line.startsWith('|')) continue;
    const parts = line.split('|');
    const kind = parts[1];
    if (kind === 'poke') {
      const side = parts[2];
      if (sides[side]) sides[side].add(speciesFromDetails(parts[3]));
    } else if (kind === 'switch' || kind === 'drag') {
      const side = parts[2]?.slice(0, 2);
      if (sides[side]) sides[side].add(speciesFromDetails(parts[3]));
    }
  }
  return [
    [...sides.p1].filter(Boolean).sort(),
    [...sides.p2].filter(Boolean).sort(),
  ];
}

// Mega/battle-only forms collapse to the caught form so compositions count
// the TEAM-SHEET species, matching the optimizer's representative ids.
// Battle-only forme words as they appear in the species table's hyphenated
// names — matched as name tokens, never as id suffixes, so a species whose
// real name merely ends in one (Yanmega) can't false-positive.
const BATTLE_FORME_TOKENS = new Set([
  'primal',
  'ultra',
  'totem',
  'busted',
  'school',
  'complete',
]);

// Form id → team-sheet id for every battle form the species table knows,
// built once at module load. Megas collapse to their base species; other
// battle forms drop only the forme tokens, so a totem of a regional form
// keeps its region (Raticate-Alola-Totem → raticatealola, not raticate).
const SHEET_ID_BY_FORM_ID = new Map();
for (const record of Object.values(GEN7_PROGRESSION_SPECIES)) {
  if (record.isMega) {
    SHEET_ID_BY_FORM_ID.set(record.id, record.baseSpeciesId);
    continue;
  }
  const parts = record.name.split('-');
  if (parts.some((part) => BATTLE_FORME_TOKENS.has(part.toLowerCase()))) {
    SHEET_ID_BY_FORM_ID.set(
      record.id,
      toId(
        parts
          .filter((part) => !BATTLE_FORME_TOKENS.has(part.toLowerCase()))
          .join(''),
      ),
    );
  }
}

// Battle-form ids the species table lacks — it stores neither Necrozma-Ultra
// nor the busted+totem compound Mimikyu-Busted-Totem — so only these two
// still need suffix stripping. Applied after a lookup miss, never to an
// in-table species.
const ABSENT_BATTLE_FORM_SUFFIXES = /(ultra|totem)$/;

/**
 * Collapses a battle-only form id to the team-sheet id of the caught form.
 * @param {string} speciesId
 * @return {string}
 */
export function toTeamSheetId(speciesId) {
  const id = toId(speciesId);
  const mapped = SHEET_ID_BY_FORM_ID.get(id);
  if (mapped) return mapped;
  const stripped = id.replace(ABSENT_BATTLE_FORM_SUFFIXES, '');
  return stripped || id;
}
