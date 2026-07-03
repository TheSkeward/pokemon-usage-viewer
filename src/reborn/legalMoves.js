import {
  REBORN_TM_OPTIONS,
  REBORN_TMX_OPTIONS,
  REBORN_TUTOR_OPTIONS,
} from "./progressionOptions.js";
import { GEN7_PROGRESSION_SPECIES } from "../generated/gen7ProgressionSpecies.generated.js";
import { dataUrl } from "../utils/dataUrl.js";
import { hydrateLegalMove } from "../moveMeta.js";
import { toId as normalizeId } from "../utils/ids.js";

const legalMoveCache = new Map();
const tmByMoveId = mapOptionsByMoveId(REBORN_TM_OPTIONS);
const tmxByMoveId = mapOptionsByMoveId(REBORN_TMX_OPTIONS);
const tutorByMoveId = mapOptionsByMoveId(REBORN_TUTOR_OPTIONS);

export async function loadRebornLegalMoveData(pokemonId) {
  const id = toId(pokemonId);
  if (!id) return null;
  if (legalMoveCache.has(id)) return legalMoveCache.get(id);

  const response = await fetch(dataUrl(`reborn-legal-moves/all/${id}.json`));
  if (response.status === 404) {
    legalMoveCache.set(id, null);
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to load Reborn legal moves for ${id}`);
  }

  const data = await response.json();
  // Per-mon files store moves as { id, sources }; rejoin each with its intrinsic
  // metadata from the central table so downstream consumers get the full move
  // object (name/type/category/basePower/priority) they expect.
  const hydrated = {
    ...data,
    moves: (data.moves || []).map(hydrateLegalMove),
  };
  legalMoveCache.set(id, hydrated);
  return hydrated;
}

export function getAvailableRebornMoves(legalMoveData, progression = {}) {
  const levelCap = normalizeLevelCap(progression.levelCap);
  const selectedTmIds = new Set(progression.availableTmIds || []);
  const selectedTmxIds = new Set(progression.availableTmxIds || []);
  const selectedTutorMoveIds = new Set(progression.availableTutorMoveIds || []);
  const selectedEggMoveIds = new Set(
    progression.availableEggMoveIdsForPokemon ||
      progression.availableEggMoveIdsByPokemon?.[legalMoveData?.pokemonId] ||
      progression.availableEggMoveIds ||
      [],
  );
  const eggMoveSourceById =
    progression.availableEggMoveSourcesForPokemon ||
    progression.availableEggMoveSourcesByPokemon?.[legalMoveData?.pokemonId] ||
    {};
  const moveRelearnerUnlocked = Boolean(progression.moveRelearnerUnlocked);
  const daycareUnlocked = Boolean(progression.daycareUnlocked);
  const pokemonId = legalMoveData?.pokemonId;
  const speciesRecord = GEN7_PROGRESSION_SPECIES[pokemonId];
  const evolvedSpecies = Boolean(speciesRecord?.prevoId);
  // The level at which this form's direct pre-evolution NATURALLY evolves into
  // it (evolve-as-soon-as-possible path). A pre-evo level-up move above this is
  // only obtainable by deliberately delaying the evolution — legal, but a real
  // cost, so it's split out and labelled instead of silently assumed. Null/
  // non-level evolutions (friendship, item) can be taken at any level, so
  // nothing is "delayed" for them. For deep chains the merged pre-evo level
  // list can't attribute a level to a specific ancestor; the direct pre-evo's
  // departure level is the right bound for the overwhelmingly common case.
  const naturalDeparture = Number.isFinite(speciesRecord?.evoLevel)
    ? speciesRecord.evoLevel
    : Infinity;
  const moves = [];

  for (const move of legalMoveData?.moves || []) {
    const sources = [];
    const allLevelUpLevels = move.sources?.levelUp || [];
    const preEvolutionLevels = move.sources?.preEvolutionLevelUp || [];
    const naturalLevelUpLevels = [
      ...allLevelUpLevels.filter(
        (level) =>
          !isEvolvedLevelOneMove(level, evolvedSpecies),
      ),
      ...preEvolutionLevels.filter((level) => level <= naturalDeparture),
    ];
    const delayedLevels = preEvolutionLevels.filter(
      (level) => level > naturalDeparture && level <= levelCap,
    );
    const levels = naturalLevelUpLevels.filter(
      (level) => level <= levelCap,
    );
    // A genuine evolution move (flagged by the generator: level-1 on this form,
    // and no pre-evolution learns it by level-up) is gained on evolving into this
    // form — e.g. Combusken's Double Kick — so it's directly available whenever
    // you're fielding that form, not gated behind the move relearner.
    const isEvolutionMove = Boolean(move.sources?.evolutionMove);
    // A level-1 move relisted on an evolved form that ISN'T a genuine evolution
    // move (a pre-evolution learns it, but only above the level reachable before
    // evolving — e.g. Blaziken's Flare Blitz, which Combusken learns at 58) is
    // only obtainable here through the move relearner.
    const hasRelearnerOnlyLevelOne =
      !isEvolutionMove &&
      preEvolutionLevels.length === 0 &&
      allLevelUpLevels.some((level) =>
        isEvolvedLevelOneMove(level, evolvedSpecies),
      );

    if (levels.length > 0) {
      sources.push({
        kind: "level-up",
        label: `Level ${Math.min(...levels)}`,
      });

      if (moveRelearnerUnlocked) {
        sources.push({
          kind: "relearner",
          label: "Move relearner",
        });
      }
    } else if (delayedLevels.length > 0) {
      // Only reachable by delaying evolution past the natural level (e.g. a
      // cap-60 Greninja running Hydro Pump means staying Frogadier to 56).
      // Legal, but flagged: the default build avoids it, and a build that uses
      // it pays DELAYED_EVO_FRICTION and says so.
      sources.push({
        kind: "level-up",
        label: `Level ${Math.min(...delayedLevels)} (requires delayed evolution)`,
        delayedEvolution: true,
      });
    } else if (isEvolutionMove) {
      sources.push({
        kind: "level-up",
        label: "On evolution",
      });
    } else if (hasRelearnerOnlyLevelOne && moveRelearnerUnlocked) {
      sources.push({
        kind: "relearner",
        label: "Move relearner",
      });
    }

    // Reborn-only relearner moves (its expanded move-relearner pool) are
    // available solely through the relearner.
    if (
      move.sources?.rebornRelearner &&
      moveRelearnerUnlocked &&
      !sources.some((source) => source.kind === "relearner")
    ) {
      sources.push({
        kind: "relearner",
        label: "Move relearner",
      });
    }

    const tmOption = tmByMoveId.get(move.id);
    if (move.sources?.tm && tmOption && selectedTmIds.has(tmOption.id)) {
      sources.push({
        kind: "tm",
        label: tmOption.code,
        detail: tmOption.available,
      });
    }

    const tmxOption = tmxByMoveId.get(move.id);
    if (move.sources?.tmx && tmxOption && selectedTmxIds.has(tmxOption.id)) {
      sources.push({
        kind: "tmx",
        label: tmxOption.code,
        detail: tmxOption.available,
      });
    }

    const tutorOption = tutorByMoveId.get(move.id);
    if (
      move.sources?.tutor &&
      tutorOption &&
      selectedTutorMoveIds.has(tutorOption.id)
    ) {
      sources.push({
        kind: "tutor",
        label: "Tutor",
        detail: tutorOption.available,
      });
    }

    if (
      move.sources?.egg &&
      daycareUnlocked &&
      selectedEggMoveIds.has(move.id)
    ) {
      sources.push({
        kind: "egg",
        label: eggMoveSourceById[move.id]?.label || "Egg",
        detail: eggMoveSourceById[move.id]?.detail || "Breeding chain",
      });
    }

    if (sources.length > 0) {
      moves.push({
        ...move,
        availableSources: sources,
        // True when the move is ONLY reachable by delaying an evolution — the
        // build generator treats these as a separate, friction-costed variant.
        delayedEvolution: sources.every((source) => source.delayedEvolution),
      });
    }
  }

  return expandHiddenPower(moves, progression).sort(compareAvailableMoves);
}

// Hidden Power's real Gen 7 types — every type except Normal (impossible) and
// Fairy (not generated by the IV formula).
const HIDDEN_POWER_TYPES = [
  "Fighting", "Flying", "Poison", "Ground", "Rock", "Bug", "Ghost", "Steel",
  "Fire", "Water", "Grass", "Electric", "Psychic", "Ice", "Dragon", "Dark",
];

// Hidden Power is a lottery until the Type Changer is unlocked — its type is
// fixed per caught mon and almost never the one you'd want — so before the
// unlock it is NOT a plannable move and is excluded from legality entirely.
// With the changer, the player chooses the type: expand it into every real
// variant (distinct ids, so damage estimates/memoization treat each type as
// its own move) and let the recommender pick the best; the recommender caps a
// set at ONE Hidden Power, since a mon can only have one.
function expandHiddenPower(moves, progression) {
  const hiddenPower = moves.find((move) => move.id === "hiddenpower");
  if (!hiddenPower) return moves;
  const rest = moves.filter((move) => move.id !== "hiddenpower");
  if (!progression.hiddenPowerTypeChangerUnlocked) return rest;
  for (const type of HIDDEN_POWER_TYPES) {
    rest.push({
      ...hiddenPower,
      id: `hiddenpower${type.toLowerCase()}`,
      name: `Hidden Power ${type}`,
      type,
    });
  }
  return rest;
}

function isEvolvedLevelOneMove(level, evolvedSpecies) {
  return evolvedSpecies && level === 1;
}

export function getAvailableMoveMap(legalMoveData, progression) {
  return new Map(
    getAvailableRebornMoves(legalMoveData, progression).map((move) => [
      move.id,
      move,
    ]),
  );
}

export function getRebornMoveId(moveName) {
  return toId(moveName);
}

function compareAvailableMoves(a, b) {
  return (
    compareSourcePriority(a, b) ||
    a.type.localeCompare(b.type) ||
    a.name.localeCompare(b.name)
  );
}

function compareSourcePriority(a, b) {
  return getBestSourcePriority(a) - getBestSourcePriority(b);
}

function getBestSourcePriority(move) {
  const priorities = {
    "level-up": 0,
    relearner: 1,
    tm: 2,
    tmx: 3,
    tutor: 4,
    egg: 5,
  };

  return Math.min(
    ...move.availableSources.map((source) => priorities[source.kind] ?? 9),
  );
}

export function normalizeLevelCap(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 100;
  if (parsed < 1) return 1;
  if (parsed > 100) return 100;
  return parsed;
}

function mapOptionsByMoveId(options) {
  return new Map(options.map((option) => [toId(option.move), option]));
}

// Reborn legal-move data stores every Hidden Power variant under the single
// "hiddenpower" id, so collapse them here when resolving move ids.
function toId(value) {
  const id = normalizeId(value);
  return id.startsWith("hiddenpower") ? "hiddenpower" : id;
}
