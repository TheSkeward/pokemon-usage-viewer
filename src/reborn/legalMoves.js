import {
  REBORN_TM_OPTIONS,
  REBORN_TMX_OPTIONS,
  REBORN_TUTOR_OPTIONS,
} from "./progressionOptions.js";
import { GEN7_PROGRESSION_SPECIES } from "../generated/gen7ProgressionSpecies.generated.js";
import { dataUrl } from "../utils/dataUrl.js";
import { getActiveGame } from "../games/registry.js";
import { hydrateLegalMove } from "../moveMeta.js";
import { toId as normalizeId } from "../utils/ids.js";

const legalMoveCache = new Map();
const tmByMoveId = mapOptionsByMoveId(REBORN_TM_OPTIONS);
const tmxByMoveId = mapOptionsByMoveId(REBORN_TMX_OPTIONS);
const tutorByMoveId = mapOptionsByMoveId(REBORN_TUTOR_OPTIONS);

export async function loadRebornLegalMoveData(pokemonId) {
  const game = getActiveGame();
  const id = toId(pokemonId);
  if (!id) return null;
  // Keyed by game so switching games can't serve one game's learnset for
  // another (the ids overlap almost entirely).
  const cacheKey = `${game.id}|${id}`;
  if (legalMoveCache.has(cacheKey)) return legalMoveCache.get(cacheKey);

  const response = await fetch(
    dataUrl(`${game.data.legalMovesDir}/all/${id}.json`),
  );
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
  // Each ancestor's NATURAL departure level (evolve-as-soon-as-possible path):
  // the level at which it evolves toward this form. A pre-evo level-up move
  // above ITS OWN form's departure is only obtainable by deliberately keeping
  // that form unevolved — legal, but a real cost, so it's split out and
  // labelled (Slaking's Play Rough is Slakoth@38, keep Slakoth to 38).
  // Departure depends on the HOP's evolution type:
  //   - level:      the recorded evolution level (Slakoth departs at 18).
  //   - friendship / affection: Infinity — the grind builds gradually while
  //     training, so the pre-evo naturally spans levels; nothing is delayed.
  //   - item / trade / location / party (elective triggers): 0 — the default
  //     path takes them the moment they're available, so EVERY pre-evo
  //     level-up move requires deliberately keeping the form unevolved
  //     (Musharna via Moon Stone learns nothing itself; Munna's Moonlight@17
  //     / Calm Mind@35 / Psychic@37 are all classic stone-gated moves).
  //   - level-while-knowing-a-move: the move's own learn level.
  const hopDeparture = (child) => {
    const evoType = child?.evoType || "";
    if (evoType === "") {
      return Number.isFinite(child?.evoLevel) ? child.evoLevel : Infinity;
    }
    if (evoType === "levelFriendship") return Infinity;
    if (
      evoType === "levelExtra" &&
      /affection/i.test(child?.evoCondition || "")
    ) {
      return Infinity;
    }
    if (evoType === "levelMove") {
      return Number.isFinite(child?.evoMoveLevel)
        ? child.evoMoveLevel
        : Infinity;
    }
    // useItem / levelHold / trade / remaining levelExtra (locations, party
    // conditions): elective. The default path takes these ASAP — i.e. the
    // moment the form ARRIVES — so entries above arrival are delay-gated
    // (user ruling, the Musharna report: Munna's Calm Mind@35 means fielding
    // a Munna to 35, a real cost). But the departure is the ARRIVAL level,
    // not 0: an empty [arrival, 0] window priced even moves the form already
    // KNOWS at arrival as delayed — hatch moves (Munna's level-1 Psywave)
    // and moves learned in the same moment the pre-evo becomes eligible
    // (Kirlia's level-20 moves on Gallade) carry over at zero cost.
    const departing = GEN7_PROGRESSION_SPECIES[child?.prevoId];
    if (!departing?.prevoId) return 1;
    return (departing.evoType || "") === "" && Number.isFinite(departing.evoLevel)
      ? departing.evoLevel
      : 1;
  };
  const departureByAncestor = new Map();
  {
    let current = speciesRecord;
    const walked = new Set();
    while (current?.prevoId && !walked.has(current.id)) {
      walked.add(current.id);
      departureByAncestor.set(current.prevoId, hopDeparture(current));
      current = GEN7_PROGRESSION_SPECIES[current.prevoId];
    }
  }
  const directDeparture = hopDeparture(speciesRecord);
  const departureOf = (fromId) =>
    fromId ? (departureByAncestor.get(fromId) ?? directDeparture) : directDeparture;
  // A form's ARRIVAL: the level at which it starts existing. A pre-evo
  // level-up entry BELOW its form's arrival is unreachable by leveling —
  // Vigoroth "learns" Uproar at 1 and 9 but only exists from 18 (Slakoth's
  // departure), so those entries are move-relearner-only (user report:
  // Slaking was recommended as an Uproar breeding donor "@1"). Base forms
  // arrive at 1 (hatch/catch); non-level evolutions arrive whenever taken.
  const arrivalOf = (formId) => {
    const form = GEN7_PROGRESSION_SPECIES[formId];
    if (!form?.prevoId) return 1;
    return (form.evoType || "") === "" && Number.isFinite(form.evoLevel)
      ? form.evoLevel
      : 1;
  };
  const ancestorName = (fromId) =>
    GEN7_PROGRESSION_SPECIES[fromId]?.name || "its pre-evolution";
  const moves = [];

  for (const move of legalMoveData?.moves || []) {
    const sources = [];
    const allLevelUpLevels = move.sources?.levelUp || [];
    // Attributed { level, from } entries; tolerate the old plain-number shape
    // (judged against the direct pre-evolution bound) during any data skew.
    const preEvolutionEntries = (move.sources?.preEvolutionLevelUp || []).map(
      (entry) =>
        typeof entry === "number" ? { level: entry, from: null } : entry,
    );
    // Reachable-by-leveling window per entry: at or above the form's arrival
    // (it must EXIST at that level) and at or below its natural departure.
    // The fielded form's OWN entries obey the same arrival bound — a fielded
    // Drapion (arrives at 40) does not "learn Pin Missile at 9" by leveling;
    // its own below-arrival entries are candy-down routes exactly like a
    // pre-evo's (user report: Pineco's Pin Missile donor priced Drapion@9 as
    // if natural, beating the honest Skorupi@9 on an alphabetical tie).
    // Keep the learner form structured; breeding-chain provenance must say
    // "Skitty @1", not the currently fielded Delcatty that inherited the move.
    const ownArrival = arrivalOf(pokemonId);
    const naturalLevelUpSources = [
      ...allLevelUpLevels
        .filter(
          (level) =>
            !isEvolvedLevelOneMove(level, evolvedSpecies) &&
            level >= ownArrival,
        )
        .map((level) => ({
          level,
          learnerId: pokemonId,
          learnerName: speciesRecord?.name || legalMoveData?.name || pokemonId,
        })),
      ...preEvolutionEntries
        .filter(
          (entry) =>
            entry.level >= arrivalOf(entry.from) &&
            entry.level <= departureOf(entry.from),
        )
        .map((entry) => ({
          level: entry.level,
          learnerId: entry.from,
          learnerName: ancestorName(entry.from),
        })),
    ];
    const delayedEntries = preEvolutionEntries
      .filter(
        (entry) =>
          entry.level >= arrivalOf(entry.from) &&
          entry.level > departureOf(entry.from) &&
          entry.level <= levelCap,
      )
      .sort((a, b) => a.level - b.level);
    // Entries below their form's arrival at level 2+ ARE reachable in Reborn
    // (user-verified): Common Candy the form back below the level, then level
    // up through it — Vigoroth (exists from 18) candies down to 8 and learns
    // Uproar at 9. Requires the form to be reachable at the cap. Level-1
    // entries stay relearner-only: you never level UP to 1. The fielded
    // form's own below-arrival entries take the same route (Drapion candies
    // down for its own level-9 Pin Missile).
    const candyEntries = [
      ...allLevelUpLevels
        .filter(
          (level) => level >= 2 && level < ownArrival && ownArrival <= levelCap,
        )
        .map((level) => ({ level, from: pokemonId })),
      ...preEvolutionEntries.filter(
        (entry) =>
          entry.level >= 2 &&
          entry.level < arrivalOf(entry.from) &&
          arrivalOf(entry.from) <= levelCap,
      ),
    ].sort((a, b) => a.level - b.level);
    const hasLevelOnePreEvoOnly = preEvolutionEntries.some(
      (entry) => entry.level === 1 && arrivalOf(entry.from) > 1,
    );
    // Any own-learnset entry below arrival (candied or not) is also always
    // teachable by the move relearner on this form.
    const hasOwnBelowArrival = allLevelUpLevels.some(
      (level) => level < ownArrival,
    );
    const levelSources = naturalLevelUpSources
      .filter((source) => source.level <= levelCap)
      .sort(
        (a, b) =>
          a.level - b.level ||
          String(a.learnerName || "").localeCompare(String(b.learnerName || "")),
      );
    // A genuine evolution move (flagged by the generator: level-1 on this form,
    // and no pre-evolution learns it by level-up) is gained on evolving into this
    // form — e.g. Combusken's Double Kick — so it's directly available whenever
    // you're fielding that form, not gated behind the move relearner.
    const isEvolutionMove = Boolean(move.sources?.evolutionMove);
    // A level-1 move relisted on an evolved form that ISN'T a genuine evolution
    // move (e.g. Blaziken's Flare Blitz, Honchkrow's Sucker Punch) is
    // teachable on this form through the move relearner — REGARDLESS of what
    // its pre-evolutions do. Requiring "no pre-evolution entries" here erased
    // the move entirely whenever the pre-evo's own entries were out of reach
    // (audit: Honchkrow Sucker Punch — Murkrow@55 unreachable at cap 50, so
    // the signature move had NO source at all; 101 such cases at cap 50).
    const hasRelearnerOnlyLevelOne =
      !isEvolutionMove &&
      allLevelUpLevels.some((level) =>
        isEvolvedLevelOneMove(level, evolvedSpecies),
      );

    if (levelSources.length > 0) {
      const best = levelSources[0];
      sources.push({
        kind: "level-up",
        label: `Level ${best.level}`,
        learnerId: best.learnerId || null,
        learnerName: best.learnerName || null,
        sourceTitle: best.learnerName
          ? `${best.learnerName} learns ${move.name} at level ${best.level}.`
          : "",
      });

      if (moveRelearnerUnlocked) {
        sources.push({
          kind: "relearner",
          label: "Move relearner",
        });
      }
    } else if (candyEntries.length > 0) {
      const best = candyEntries[0];
      const learner = best.from ? ancestorName(best.from) : "pre-evolution";
      sources.push({
        kind: "level-up",
        label: `Level ${best.level} (${learner}, candy down)`,
        learnerId: best.from || null,
        learnerName: learner,
        sourceTitle: `${learner} learns ${move.name} at level ${best.level} after being candied down.`,
        // Structured flag for donor pricing: a candy-down at level N is more
        // work than a plain level-up at N, so it loses equal-level ties.
        candyDown: true,
      });
    } else if (delayedEntries.length > 0) {
      // Only reachable by delaying a SPECIFIC evolution past its natural level
      // (a cap-60 Greninja running Hydro Pump means keeping Frogadier to 56).
      // Legal, but flagged with the form being delayed: the default build
      // avoids it, and a build that uses it pays DELAYED_EVO_FRICTION.
      const best = delayedEntries[0];
      // Terse by request: "Level 38 (Slakoth)" = requires keeping Slakoth
      // unevolved to 38.
      const learner = best.from ? ancestorName(best.from) : "pre-evolution";
      sources.push({
        kind: "level-up",
        label: `Level ${best.level} (${learner})`,
        learnerId: best.from || null,
        learnerName: learner,
        sourceTitle: `${learner} learns ${move.name} at level ${best.level} before evolving.`,
        delayedEvolution: true,
      });
    } else if (isEvolutionMove) {
      sources.push({
        kind: "level-up",
        label: "On evolution",
      });
    }

    // A level-1 relist (or an unreachable level-1 pre-evo entry) makes the
    // move relearner-teachable on this form INDEPENDENTLY of the branches
    // above — a candy-down or delayed pre-evo route must not swallow it.
    // As the last else-if it did: Honchkrow's Sucker Punch (own [1],
    // Murkrow@55) was relearner-only at cap 50, but at cap 55 the delayed
    // branch won the chain and the zero-cost Heart Scale route VANISHED —
    // the move got strictly worse by raising the cap (delayed friction on
    // builds, donor pricing @55 instead of the relearner's last-resort 200).
    if (
      (hasRelearnerOnlyLevelOne || hasLevelOnePreEvoOnly || hasOwnBelowArrival) &&
      moveRelearnerUnlocked &&
      !sources.some((source) => source.kind === "relearner")
    ) {
      sources.push({
        kind: "relearner",
        label: "Move relearner",
      });
    }

    // Sketch: Smeargle copies any move ever used in battle, so the whole
    // move universe is legal at any level, no unlock required.
    if (
      move.sources?.sketch &&
      !sources.some((source) => source.kind === "level-up")
    ) {
      sources.push({ kind: "level-up", label: "Sketch" });
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
      const eggSource = eggMoveSourceById[move.id] || {};
      sources.push({
        kind: "egg",
        label: eggSource.label || "Egg",
        detail: eggSource.detail || "Breeding chain",
        sourceTitle: eggSource.sourceTitle || eggSource.detail || "",
        // The direct donor the chain fathers the move from, and the level it
        // must reach to learn the move itself (one-hop leveling routes only)
        // — the analysis page's interim-donor guide keys on these.
        donorName: eggSource.donorName || null,
        donorLevel: eggSource.donorLevel ?? null,
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
