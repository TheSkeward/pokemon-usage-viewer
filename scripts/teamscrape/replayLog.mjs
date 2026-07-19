// Extracts per-side team compositions from a Showdown replay's battle log.
// Species come from team-preview `|poke|` lines unioned with `|switch|`/
// `|drag|` appearances (formats without preview, Zoroark reveals, forced
// switches). Only base composition is extracted — moves/items stay unread
// because replay reveals are too partial to qualify as observed sets.
import { toId } from "../../src/utils/ids.js";

// "|switch|p1a: Nickname|Skuntank, L78, F|100/100" → details field holds the
// species before the first comma. `|poke|p1|Skuntank, F|item` likewise.
function speciesFromDetails(details) {
  return toId(String(details || "").split(",")[0]);
}

export function parseReplayTeams(log) {
  const sides = { p1: new Set(), p2: new Set() };
  for (const line of String(log || "").split("\n")) {
    if (!line.startsWith("|")) continue;
    const parts = line.split("|");
    const kind = parts[1];
    if (kind === "poke") {
      const side = parts[2];
      if (sides[side]) sides[side].add(speciesFromDetails(parts[3]));
    } else if (kind === "switch" || kind === "drag") {
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
// the TEAM-SHEET species, matching the optimizer's representative ids. Ids
// are already toId'd (hyphens gone), so the suffixes match bare.
const BATTLE_FORM_SUFFIXES = /(mega[xy]?|primal|ultra|totem|busted|school|complete)$/;
// Species whose REAL name ends in a battle-form suffix.
const SUFFIX_EXEMPT = new Set(["yanmega"]);
export function toTeamSheetId(speciesId) {
  const id = toId(speciesId);
  if (SUFFIX_EXEMPT.has(id)) return id;
  const stripped = id.replace(BATTLE_FORM_SUFFIXES, "");
  return stripped || id;
}
