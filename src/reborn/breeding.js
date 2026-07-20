import { GEN7_PROGRESSION_SPECIES } from "../generated/gen7ProgressionSpecies.generated.js";
import { buildInputGroups } from "../teamBuilder/inputGroups";
import { getCurrentRebornSpecies } from "./currentSpecies.js";
import {
  arrivalLevelOf,
  evolutionDepartureLevel,
  getAvailableRebornMoves,
  loadRebornLegalMoveData,
} from "./legalMoves";
import { normalizeLevelCap } from "./progression.js";
import { toId } from "../utils/ids.js";

const BLOCKED_EGG_GROUPS = new Set(["Undiscovered", "Ditto"]);

export async function buildRebornBreedingContext({
  pokemonIndex = [],
  progression = {},
  query = "",
} = {}) {
  if (!progression.daycareUnlocked) return emptyContext();

  const ownedSpecies = getOwnedCurrentSpecies({ pokemonIndex, progression, query });
  if (!ownedSpecies.length) return emptyContext();

  const levelCap = normalizeLevelCap(progression.levelCap);

  const entries = (
    await Promise.all(
      ownedSpecies.map(async (species) => {
        const legalMoveData = await loadRebornLegalMoveData(species.id);
        if (!legalMoveData) return null;

        // Acquisition cost of each move the species can get WITHOUT breeding:
        // the lowest level any source demands (TM/tutor/etc. count as 0 — they
        // are teachable the moment they're unlocked, which availability has
        // already checked). `how` keeps the human-readable root acquisition
        // ("@35", "evo@32", "TM42") for the chain detail. Drives donor
        // ranking below.
        const costs = new Map();
        for (const move of getAvailableRebornMoves(legalMoveData, {
          ...progression,
          availableEggMoveIdsForPokemon: [],
        })) {
          costs.set(move.id, {
            ...acquisitionOf(move, species.id, {
              inputId: species.inputId,
              ownedItems: progression.ownedItems || {},
            }),
            hops: 0,
            path: [],
          });
        }

        return { legalMoveData, costs, species };
      }),
    )
  ).filter(Boolean);

  const byPokemonId = new Map(
    entries.map((entry) => [
      entry.species.id,
      {
        moveIds: new Set(),
        sources: {},
      },
    ]),
  );

  // Shortest-chain relaxation: the best donor route per move is re-picked
  // each pass under sortDonorRoutes' order (shortest chain, then least
  // forced-NFE burden, then acquisition level). Multi-hop
  // chains inherit the upstream donor's level, root acquisition, and path.
  // The pick never regresses under the cost order — every leveling route is
  // present from the hops-0 seed and later passes only add or shorten
  // chains — so the acceptance check below terminates.
  let changed = true;
  while (changed) {
    changed = false;

    for (const target of entries) {
      for (const move of target.legalMoveData.moves || []) {
        if (!move.sources?.egg) continue;
        const intrinsic = target.costs.get(move.id);
        if (intrinsic && intrinsic.hops === 0) continue;

        const best = sortDonorRoutes(
          collectDonorRoutes(target, entries, move.id),
          levelCap,
        )[0];
        if (!best) continue;

        const current = target.costs.get(move.id);
        if (current && compareBreedingCosts(best, current) >= 0) continue;

        target.costs.set(move.id, best);
        byPokemonId.get(target.species.id).moveIds.add(move.id);
        changed = true;
      }
    }
  }

  // Sources are built AFTER convergence, in one pass over the FINAL costs —
  // both so multi-hop chains display their settled upstream routes, and so
  // the tooltip can rank every viable donor and show the runner-ups.
  // Deterministic: donors sort under the same total order the winner was
  // chosen by.
  for (const target of entries) {
    const targetBreeding = byPokemonId.get(target.species.id);
    const movesById = new Map(
      (target.legalMoveData.moves || []).map((move) => [move.id, move]),
    );
    for (const moveId of [...targetBreeding.moveIds].sort()) {
      const move = movesById.get(moveId);
      const routes = sortDonorRoutes(
        collectDonorRoutes(target, entries, moveId),
        levelCap,
      );
      if (!routes.length) continue;

      // The path spells every step; the parenthetical is how the ROOT
      // learner gets the move: "Azumarill → Granbull breeding chain (@1)".
      const detailOf = (route) =>
        `${route.path.join(" → ")} breeding chain${route.how ? ` (${route.how})` : ""}`;
      const best = routes[0];
      const detail = detailOf(best);
      // Runner-ups must differ in root learner FAMILY from the winner and
      // from each other: a longer chain that still funnels through the same
      // root (Victreebel → Fomantis → …) is the same acquisition wearing a
      // detour, and so is the same family's next form up (Grovyle@58 vs
      // Sceptile@63). Capped at two — enough to see whether the
      // recommendation beats the field or squeaked past one rival.
      const rootFamilyOf = (route) => familyRootOf(toId(route.path[0]));
      const seenRoots = new Set([rootFamilyOf(best)]);
      const alternatives = [];
      for (const route of routes.slice(1)) {
        const rootFamily = rootFamilyOf(route);
        if (seenRoots.has(rootFamily)) continue;
        seenRoots.add(rootFamily);
        alternatives.push(detailOf(route));
        if (alternatives.length >= 2) break;
      }

      targetBreeding.sources[moveId] = {
        label: "Egg",
        detail,
        donorName: best.path[best.path.length - 1],
        // The level the DIRECT donor must reach before it can pass this move
        // on — present only for one-hop chains where the fielded donor is the
        // root learner via a leveling route. Multi-hop donors hatch already
        // holding the move, and TM routes have no leveling window, so neither
        // caps the donor's working life. Drives the interim-donor guide.
        donorLevel:
          best.hops === 1 &&
          best.leveled &&
          Number.isFinite(best.level) &&
          best.level > 1
            ? best.level
            : null,
        sourceTitle: formatBreedingSourceTitle({
          detail,
          moveName: move?.name || moveId,
          rootSourceTitle: best.sourceTitle,
          targetName: target.species.name,
          alternatives,
        }),
      };
    }
  }

  return {
    byPokemonId: Object.fromEntries(
      [...byPokemonId.entries()].map(([pokemonId, entry]) => [
        pokemonId,
        {
          moveIds: [...entry.moveIds].sort(),
          sources: entry.sources,
        },
      ]),
    ),
    ownedSpecies,
  };
}

// The cheapest way a species gets a move without breeding, judged from each
// source's structured fields (kind/level/learnerId — labels are display-
// only), as {level, how}: level-up sources cost their level ("@35");
// evolution moves cost the species' evolution level ("evo@32" — you must
// evolve to learn it); anything else (TM/tutor/Sketch) is teachable outright
// at level 0, labelled by its source ("TM42"). Delayed-evolution level-ups
// still cost their level. `leveled` marks the routes the player levels a
// specific form through (@N / evo@N) — the ones that can cap a donor's
// working life and join the least-delay preference.
//
// Scarce-resource pricing: when the form that learns the move can only be
// obtained by consuming evolution items the player doesn't renewably own —
// a stone, a Link Stone, a trade hold-item — the route is priced out of the
// normal level range entirely (STONE_ROUTE_OFFSET added to its level), so
// ANY plain level-up or candy-down beats it, at any level, and it still
// ranks above nothing-at-all. Items tracked at 6+ ("I can buy as many as I
// need") waive the penalty: renewable stock isn't scarce.
export function acquisitionOf(move, speciesId, { inputId, ownedItems } = {}) {
  let best = null;
  for (const source of move.availableSources || []) {
    const learner = source.learnerName || null;
    const sourceTitle = source.sourceTitle || source.detail || source.label || "";
    let candidate;
    if (source.kind === "level-up" && Number.isFinite(source.level)) {
      // The source's learner names the form that ACTUALLY learns the move
      // (Vigoroth, Slakoth) — the chain must credit it, not the fielded
      // species.
      candidate = {
        level: source.level,
        how: `@${source.level}`,
        learner,
        sourceTitle,
        leveled: true,
        // Candy-down and delayed-evolution routes cost real extra work over a
        // plain level-up at the SAME level (Drapion@9 means candying a
        // level-40 evo back down; Skorupi@9 is just leveling) — they lose
        // equal-level ties, never a level advantage.
        hassle: source.candyDown || source.delayedEvolution ? 1 : 0,
        forcedNfeLevels: source.candyDown
          ? 0
          : forcedNfeLevelsOf(
              source.learnerId || toId(learner) || speciesId,
              source.level,
            ),
      };
    } else if (source.kind === "relearner") {
      // Relearning costs a Heart Scale + a trip — a real hassle rated above
      // ANY level-up. Sorted after every natural level so it's a last
      // resort, never a tiebreak winner.
      candidate = {
        level: 200,
        how: "Relearner",
        learner,
        sourceTitle,
      };
    } else if (source.onEvolution) {
      const evoLevel = GEN7_PROGRESSION_SPECIES[speciesId]?.evoLevel ?? null;
      candidate = {
        level: evoLevel ?? 0,
        how: evoLevel ? `evo@${evoLevel}` : "on evolution",
        learner,
        sourceTitle,
        leveled: Boolean(evoLevel),
        forcedNfeLevels: Number.isFinite(evoLevel) ? 0 : null,
      };
    } else {
      // Taught outright (TM/tutor/Sketch): the label doubles as the short
      // acquisition tag ("TM42", "Sketch").
      candidate = {
        level: 0,
        how: String(source.label || "").trim() || "taught",
        learner,
        sourceTitle,
      };
    }
    // Charge unspent evolution items between the player's actual form and
    // the form that learns the move. Applied per SOURCE because different
    // sources name different learners: Drapion's "Level 9 (Skorupi)" hatches
    // a Skorupi (no items), while a Victreebel-only move needs the stone.
    const learnerId = toId(candidate.learner) || speciesId;
    const items = unspentEvolutionItems(learnerId, inputId, ownedItems);
    if (items.length) {
      candidate = {
        ...candidate,
        level: candidate.level + STONE_ROUTE_OFFSET * items.length,
        how: `${candidate.how} + ${items.join(" + ")}`,
        // Scarce-resource routes keep their established last-resort pricing;
        // NFE convenience must not make one leapfrog an ordinary route.
        forcedNfeLevels: null,
      };
    }

    if (
      !best ||
      candidate.level < best.level ||
      (candidate.level === best.level &&
        (candidate.hassle || 0) < (best.hassle || 0))
    ) {
      best = candidate;
    }
  }
  return best || { level: 0, how: "" };
}

// Above every real level (caps top out at 150) and the relearner's 200, so a
// stone route loses to grinding, candy-downs, AND a Heart Scale trip — it
// only ever wins over having no route at all. Stacks per item for multi-item
// paths.
const STONE_ROUTE_OFFSET = 300;

// Evolution items consumed to turn the player's ACTUAL form (the pool input)
// into `learnerId`, skipping items they renewably own (tracked at the 6+
// cap). Walking learner → root: hops at or below the input are already paid
// for (the fielded mon exists; a learner BELOW the input is hatched fresh,
// which costs nothing but the egg).
function unspentEvolutionItems(learnerId, inputId, ownedItems = {}) {
  const items = [];
  let id = learnerId;
  const seen = new Set();
  while (id && !seen.has(id) && id !== inputId) {
    seen.add(id);
    const record = GEN7_PROGRESSION_SPECIES[id];
    if (!record) break;
    const hopItems = [];
    if (record.evoType === "useItem" && record.evoItem) {
      hopItems.push(record.evoItem);
    } else if (record.evoType === "trade") {
      // Reborn replaces trades with the Link Stone; a trade hold-item
      // (Metal Coat, King's Rock) is consumed alongside it.
      hopItems.push("Link Stone");
      if (record.evoItem) hopItems.push(record.evoItem);
    }
    for (const item of hopItems) {
      if ((ownedItems[toId(item)] || 0) >= RENEWABLE_ITEM_COUNT) continue;
      items.push(item);
    }
    id = record.prevoId;
  }
  return items;
}

// Mirrors MAX_TRACKED_ITEM_COUNT ("6+" = renewable shop stock) without
// importing the progression module into this dependency-light one.
const RENEWABLE_ITEM_COUNT = 6;

// Extra levels for which a leveling donor must remain unevolved after its
// earliest normal evolution point. Fully evolved donors and moves learned
// before that point cost zero. Friendship/affection evolutions have no fixed
// departure level, matching legal-move treatment, so they add no forced
// delay. Branching lines use the earliest ordinary departure available.
function forcedNfeLevelsOf(learnerId, learnLevel) {
  if (!Number.isFinite(learnLevel)) return null;
  const learner = GEN7_PROGRESSION_SPECIES[toId(learnerId)];
  if (!learner?.evos?.length) return 0;

  const departures = learner.evos
    .map((evoId) =>
      evolutionDepartureLevel(GEN7_PROGRESSION_SPECIES[toId(evoId)]),
    )
    .filter((level) => Number.isFinite(level));
  if (!departures.length) return 0;
  return Math.max(0, learnLevel - Math.min(...departures));
}

function formatBreedingSourceTitle({
  detail,
  moveName,
  rootSourceTitle,
  targetName,
  alternatives = [],
}) {
  return [
    `${moveName}: egg move for ${targetName}.`,
    `Breeding route: ${detail}.`,
    rootSourceTitle ? `Root source: ${rootSourceTitle}` : null,
    // The pool's next-best routes, so "is this really the cheapest way?" is
    // answerable from the tooltip instead of on faith.
    alternatives.length
      ? `Other pool routes: ${alternatives.join("; ")}.`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

// Every donor's settled route for one move, ready for ranking. A direct
// donor is credited as the form that actually learns the move (Vigoroth,
// not the fielded Slaking) when the source names one; intermediate hops
// keep their species names.
function collectDonorRoutes(target, entries, moveId) {
  const routes = [];
  for (const donor of entries) {
    if (donor.species.id === target.species.id) continue;
    const donorCost = donor.costs.get(moveId);
    if (!donorCost || !canBreed(donor.species.id, target.species.id)) {
      continue;
    }
    if (!donorCanPassMove(donor, target, donorCost)) continue;
    routes.push({
      hops: donorCost.hops + 1,
      level: donorCost.level,
      how: donorCost.how,
      leveled: Boolean(donorCost.leveled),
      hassle: donorCost.hassle || 0,
      forcedNfeLevels: donorCost.forcedNfeLevels ?? null,
      sourceTitle: donorCost.sourceTitle || "",
      donorFamily: familyRootOf(donor.species.id),
      path:
        donorCost.hops === 0
          ? [donorCost.learner || donor.species.name]
          : [...donorCost.path, donor.species.name],
    });
  }
  return routes;
}

// Donor routes stay grouped by evolutionary family so runner-up display can
// skip duplicate forms. Within and across those families, ordinary leveling
// routes prefer less forced-NFE time; taught, relearner, and scarce-item
// routes retain their established acquisition pricing.
function sortDonorRoutes(routes, levelCap) {
  const groups = new Map();
  for (const route of routes) {
    const group = groups.get(route.donorFamily);
    if (group) group.push(route);
    else groups.set(route.donorFamily, [route]);
  }
  return [...groups.values()]
    .map((group) => rankLineRoutes(group, levelCap))
    .sort((a, b) => compareBreedingCosts(a[0], b[0]))
    .flat();
}

function rankLineRoutes(group, levelCap) {
  const leveled = [];
  const others = [];
  for (const route of group) {
    (leveledRouteOption(route, levelCap) ? leveled : others).push(route);
  }
  leveled.sort(compareBreedingCosts);
  others.sort(compareBreedingCosts);
  if (!leveled.length) return others;
  const merged = [];
  let placed = false;
  for (const route of others) {
    if (!placed && compareBreedingCosts(leveled[0], route) < 0) {
      merged.push(...leveled);
      placed = true;
    }
    merged.push(route);
  }
  if (!placed) merged.push(...leveled);
  return merged;
}

// A direct donation the player levels a specific form into, as the shared
// evolution-route shape — null otherwise. Multi-hop donors hatch already
// knowing the move, teach/relearner routes level nothing, priced-out stone
// routes (level pushed past any cap) must keep losing on raw level, and a
// candy-down (level below the form's arrival) fields the form without
// leveling through it — none of those join the least-delay preference.
function leveledRouteOption(route, levelCap) {
  if (route.hops !== 1 || !route.leveled) return null;
  if (route.level > levelCap) return null;
  const formArrivalLevel = arrivalLevelOf(toId(route.path[0]));
  if (route.level < formArrivalLevel) return null;
  return { formArrivalLevel, learnLevel: route.level };
}

// The shortest possible chain always wins. Among ordinary leveling routes
// of equal length, less time forced into an NFE donor wins before raw learn
// level (Staravia@43 beats Starly@37). Non-leveling and scarce-resource
// routes keep the established raw acquisition order. The final tiebreaks on
// path/how/sourceTitle exist purely to make the order TOTAL — the result
// must not depend on pool input order, which would leak into cache
// signatures and tooltip text.
export function compareBreedingCosts(a, b) {
  if (a.hops !== b.hops) return a.hops - b.hops;
  if (
    Number.isFinite(a.forcedNfeLevels) &&
    Number.isFinite(b.forcedNfeLevels) &&
    a.forcedNfeLevels !== b.forcedNfeLevels
  ) {
    return a.forcedNfeLevels - b.forcedNfeLevels;
  }
  if (a.level !== b.level) return a.level - b.level;
  return (
    (a.hassle || 0) - (b.hassle || 0) ||
    (a.path || []).join("→").localeCompare((b.path || []).join("→")) ||
    String(a.how || "").localeCompare(String(b.how || "")) ||
    String(a.sourceTitle || "").localeCompare(String(b.sourceTitle || ""))
  );
}

export function applyBreedingContextToProgression(
  progression,
  pokemonId,
  breedingContext,
) {
  const breeding = breedingContext?.byPokemonId?.[pokemonId];
  if (!breeding?.moveIds?.length) {
    return {
      ...progression,
      availableEggMoveIdsForPokemon: [],
      availableEggMoveSourcesForPokemon: {},
    };
  }

  return {
    ...progression,
    availableEggMoveIdsForPokemon: breeding.moveIds,
    availableEggMoveSourcesForPokemon: breeding.sources || {},
  };
}

function getOwnedCurrentSpecies({ pokemonIndex, progression, query }) {
  const seen = new Set();
  const species = [];

  for (const group of buildInputGroups(query, pokemonIndex)) {
    if (group.unresolved || !group.input?.id) continue;

    const current = getCurrentRebornSpecies(group.input.id, progression);
    for (const candidate of [current, group.input]) {
      const id = candidate?.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      species.push({
        id,
        name: GEN7_PROGRESSION_SPECIES[id]?.name || candidate.name || id,
        // The form the player ACTUALLY listed — evolution items on hops
        // between it and a move's learner are unspent, so scarce-resource
        // pricing charges them (a presumed Victreebel still owes its Leaf
        // Stone; an input Victreebel already paid it).
        inputId: group.input.id,
      });
    }

    // Hatchable lines contribute EVERY family form as a potential donor —
    // sibling branches included (an input Mothim can hatch a Burmy and raise
    // a Wormadam, so Wormadam-only moves are donatable). The daycare is
    // already a precondition of this whole context; the line must
    // additionally be able to produce its own hatchlings. inputId stays the
    // listed form: unspentEvolutionItems walks learner → root without ever
    // passing it, so a hatched branch correctly owes its whole path's items
    // (a hatched Vaporeon still costs a Water Stone).
    if (canHatchLine(group.input.id)) {
      for (const record of familyForms(group.input.id)) {
        if (seen.has(record.id)) continue;
        seen.add(record.id);
        species.push({
          id: record.id,
          name: record.name,
          inputId: group.input.id,
        });
      }
    }
  }

  return species;
}

// See hasMaleCapableKnower for the reasoning. Only a DIRECT donation
// (hops 0) keys on the specific learner form; received egg moves ride the
// whole family, which canBreed's family-level male check already covers.
function donorCanPassMove(donor, target, donorCost) {
  if (familyRootOf(donor.species.id) === familyRootOf(target.species.id)) {
    return true;
  }
  if (donorCost.hops > 0) return true;
  const knowerId = toId(donorCost.learner) || donor.species.id;
  return hasMaleCapableKnower(knowerId);
}

function canBreed(donorId, targetId) {
  const donorGroups = getBreedableEggGroups(donorId);
  const targetGroups = getBreedableEggGroups(targetId);

  if (!donorGroups.some((group) => targetGroups.includes(group))) return false;

  // Gender direction: the MOTHER fixes the hatched species, so the target
  // line supplies her and the donor must FATHER the egg. Ditto is no
  // exception for CROSS-LINE moves — a Ditto pair hatches the non-Ditto
  // parent's species (NidoranF + Ditto is a NidoranF egg, never a Blitzle)
  // and Ditto knows only Transform, so it can carry a parent's own moves
  // down a generation but never inject another line's. Hence, Ditto or not:
  // a line that can never be male — female-only (NidoranF's whole line) or
  // genderless (Magnemite) — can't donate across lines, and a line that
  // can never be female — male-only (Tauros) or genderless — has no
  // cross-line mother, so it can't receive (its Ditto eggs inherit only
  // what the parent itself already knew). Family granularity, like the egg
  // groups: any form's eligibility counts (Salandit can father for
  // female-only Salazzle; NidoranF's line has no such out).
  return familyHasGender(donorId, "M") && familyHasGender(targetId, "F");
}

// Whether the daycare can produce fresh members of this line at all: the
// family must have a breedable egg group AND a possible mother (the hatched
// species is the mother's). Consumed by line resolution — with the daycare
// unlocked, a hatchable line's EVERY form is fieldable from any input, while
// genderless/male-only/Undiscovered lines (Magnezone, Tauros) still can't
// reach downward.
export function canHatchLine(pokemonId) {
  return (
    getBreedableEggGroups(pokemonId).length > 0 &&
    familyHasGender(pokemonId, "F")
  );
}

// Whether any form in the evolutionary family can be the given sex: ""
// (mixed ratio) counts for either; "M"/"F" only for themselves; "N"
// (genderless) for neither.
function familyHasGender(pokemonId, sex) {
  return familyForms(pokemonId).some((record) => {
    const gender = record.gender ?? "";
    return gender === "" || gender === sex;
  });
}

// Egg-group compatibility is a property of the evolutionary FAMILY, not the
// fielded form: you daycare Mantine and hatch a Mantyke, so a fielded
// Mantyke's egg moves come through Mantine's Water 1 — but Mantyke's OWN
// groups are ["Undiscovered"], as are every baby form's and Nidorina/
// Nidoqueen's. Union the breedable groups across the whole line, walking
// down to the root and up through every branch.
function getBreedableEggGroups(pokemonId) {
  const groups = new Set();
  for (const record of familyForms(pokemonId)) {
    for (const group of record.eggGroups || []) {
      if (!BLOCKED_EGG_GROUPS.has(group)) groups.add(group);
    }
  }
  return [...groups];
}

export function familyForms(pokemonId) {
  const forms = [];
  const walked = new Set();
  const visit = (id) => {
    const record = GEN7_PROGRESSION_SPECIES[id];
    if (!record || walked.has(id)) return;
    walked.add(id);
    forms.push(record);
    for (const evoId of record.evos || []) visit(evoId);
  };
  visit(familyRootOf(pokemonId));
  return forms;
}

function familyRootOf(pokemonId) {
  let rootId = pokemonId;
  const seen = new Set();
  while (GEN7_PROGRESSION_SPECIES[rootId]?.prevoId && !seen.has(rootId)) {
    seen.add(rootId);
    rootId = GEN7_PROGRESSION_SPECIES[rootId].prevoId;
  }
  return rootId;
}

// CROSS-family donation needs a father who KNOWS the move: the learner form
// or any of its descendants (level-up carryover follows evolution). A move
// whose only knowers are female-only or genderless — Wormadam-exclusive,
// Vespiquen-exclusive — can never ride a cross-family egg, even though the
// family-level gender check passes (Combee drones exist but never learn
// Vespiquen's moves). WITHIN the family the mother carries it instead
// (Gen 6+ mothers pass egg moves; her hatchling IS the family), so no
// father is needed there.
function hasMaleCapableKnower(learnerId) {
  const visit = (id) => {
    const record = GEN7_PROGRESSION_SPECIES[id];
    if (!record) return false;
    const gender = record.gender ?? "";
    if (gender === "" || gender === "M") return true;
    return (record.evos || []).some(visit);
  };
  return visit(learnerId);
}

function emptyContext() {
  return {
    byPokemonId: {},
    ownedSpecies: [],
  };
}
