import { GEN7_PROGRESSION_SPECIES } from "../generated/gen7ProgressionSpecies.generated.js";
import { buildInputGroups } from "../teamBuilder/inputGroups";
import { getCurrentRebornSpecies } from "./currentSpecies.js";
import {
  getAvailableRebornMoves,
  loadRebornLegalMoveData,
} from "./legalMoves";

const BLOCKED_EGG_GROUPS = new Set(["Undiscovered", "Ditto"]);

export async function buildRebornBreedingContext({
  pokemonIndex = [],
  progression = {},
  query = "",
} = {}) {
  if (!progression.daycareUnlocked) return emptyContext();

  const ownedSpecies = getOwnedCurrentSpecies({ pokemonIndex, progression, query });
  if (!ownedSpecies.length) return emptyContext();

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

  // Shortest-chain relaxation: among every legal donor, prefer the SHORTEST
  // chain first (user rule: fewest breeding hops is primary), and only then
  // the donor that gets the move earliest (lowest acquisition level) as the
  // tiebreak — instead of the old "first in pool order" pick. Multi-hop
  // chains inherit the upstream donor's level, root acquisition, and path.
  // Costs only ever improve, so this terminates.
  let changed = true;
  while (changed) {
    changed = false;

    for (const target of entries) {
      for (const move of target.legalMoveData.moves || []) {
        if (!move.sources?.egg) continue;
        const intrinsic = target.costs.get(move.id);
        if (intrinsic && intrinsic.hops === 0) continue; // has it without breeding

        let best = null;
        for (const donor of entries) {
          if (donor.species.id === target.species.id) continue;
          const donorCost = donor.costs.get(move.id);
          if (!donorCost || !canBreed(donor.species.id, target.species.id)) {
            continue;
          }
          const candidate = {
            hops: donorCost.hops + 1,
            level: donorCost.level,
            how: donorCost.how,
            hassle: donorCost.hassle || 0,
            sourceTitle: donorCost.sourceTitle || "",
            // A direct donor is credited as the form that actually learns
            // the move (Vigoroth, not the fielded Slaking) when the source
            // names one; intermediate hops keep their species names.
            path:
              donorCost.hops === 0
                ? [donorCost.learner || donor.species.name]
                : [...donorCost.path, donor.species.name],
          };
          if (!best || compareBreedingCosts(candidate, best) < 0) best = candidate;
        }
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
  // the tooltip can rank every viable donor and show the runner-ups (user
  // ask: "add other ways to get the move out of my available pool, so I can
  // compare it with the second-best way"). Deterministic: donors sort under
  // the same total order the winner was chosen by.
  for (const target of entries) {
    const targetBreeding = byPokemonId.get(target.species.id);
    const movesById = new Map(
      (target.legalMoveData.moves || []).map((move) => [move.id, move]),
    );
    for (const moveId of [...targetBreeding.moveIds].sort()) {
      const move = movesById.get(moveId);
      const routes = [];
      for (const donor of entries) {
        if (donor.species.id === target.species.id) continue;
        const donorCost = donor.costs.get(moveId);
        if (!donorCost || !canBreed(donor.species.id, target.species.id)) {
          continue;
        }
        routes.push({
          hops: donorCost.hops + 1,
          level: donorCost.level,
          how: donorCost.how,
          hassle: donorCost.hassle || 0,
          sourceTitle: donorCost.sourceTitle || "",
          path:
            donorCost.hops === 0
              ? [donorCost.learner || donor.species.name]
              : [...donorCost.path, donor.species.name],
        });
      }
      routes.sort(compareBreedingCosts);
      if (!routes.length) continue;

      // The path spells every step; the parenthetical is how the ROOT
      // learner gets the move: "Azumarill → Granbull breeding chain (@1)".
      const detailOf = (route) =>
        `${route.path.join(" → ")} breeding chain${route.how ? ` (${route.how})` : ""}`;
      const best = routes[0];
      const detail = detailOf(best);
      // Runner-ups must differ in ROOT LEARNER (path[0]) from the winner and
      // from each other: a longer chain that still funnels through the same
      // root (Victreebel → Fomantis → …) is the same acquisition wearing a
      // detour, not a second opinion. Capped at two — enough to see whether
      // the recommendation beats the field or squeaked past one rival.
      const seenRoots = new Set([best.path[0]]);
      const alternatives = [];
      for (const route of routes.slice(1)) {
        if (seenRoots.has(route.path[0])) continue;
        seenRoots.add(route.path[0]);
        alternatives.push(detailOf(route));
        if (alternatives.length >= 2) break;
      }

      targetBreeding.sources[moveId] = {
        label: "Egg",
        detail,
        donorName: best.path[best.path.length - 1],
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

// The cheapest way a species gets a move without breeding, as
// {level, how}: level-up sources cost their level ("@35"); evolution moves
// cost the species' evolution level ("evo@32" — you must evolve to learn
// it); anything else (TM/tutor/Sketch) is teachable outright at level 0,
// labelled by its source ("TM42"). Delayed-evolution level-ups
// ("Level 38 (Slakoth)") still parse to their level.
//
// Scarce-resource pricing (user ruling: "a Leaf Stone is basically worth
// any levels of grinding. Stone routes lose ties with either grinding or
// candy-downs"): when the form that learns the move can only be obtained by
// consuming evolution items the player doesn't renewably own — a stone, a
// Link Stone, a trade hold-item — the route is priced out of the normal
// level range entirely (STONE_ROUTE_OFFSET added to its level), so ANY
// plain level-up or candy-down beats it, at any level, and it still ranks
// above nothing-at-all. Items tracked at 6+ ("I can buy as many as I
// need") waive the penalty: renewable stock isn't scarce.
export function acquisitionOf(move, speciesId, { inputId, ownedItems } = {}) {
  let best = null;
  for (const source of move.availableSources || []) {
    const label = source.label || "";
    let candidate;
    // "Level 9 (Vigoroth, candy down)" / "Level 38 (Slakoth)": the
    // parenthetical names the form that ACTUALLY learns the move — the chain
    // must credit it, not the fielded species (user report: "Slaking
    // breeding chain (@9)" for a move only Vigoroth learns).
    const levelMatch = /^Level (\d+)(?:\s*\(([^,)]+)[,)])?/.exec(label);
    if (levelMatch) {
      const level = Number.parseInt(levelMatch[1], 10);
      candidate = {
        level,
        how: `@${level}`,
        learner: source.learnerName || levelMatch[2] || null,
        sourceTitle: source.sourceTitle || source.detail || source.label || "",
        // Candy-down and delayed-evolution routes cost real extra work over a
        // plain level-up at the SAME level (Drapion@9 means candying a
        // level-40 evo back down; Skorupi@9 is just leveling) — they lose
        // equal-level ties, never a level advantage (Vigoroth@9 candy still
        // beats Exploud@27, per the ratified hops→level order).
        hassle:
          source.candyDown || source.delayedEvolution || /candy down/i.test(label)
            ? 1
            : 0,
      };
    } else if (/relearner/i.test(label)) {
      // Relearning costs a Heart Scale + a trip — a real hassle the user
      // rates above ANY level-up (and it was masquerading as the cheapest
      // donor at level 0: "Slaking breeding chain (@1)"). Sorted after every
      // natural level so it's a last resort, never a tiebreak winner.
      candidate = {
        level: 200,
        how: "Relearner",
        learner: source.learnerName || null,
        sourceTitle: source.sourceTitle || source.detail || source.label || "",
      };
    } else if (/evolution/i.test(label)) {
      const evoLevel = GEN7_PROGRESSION_SPECIES[speciesId]?.evoLevel ?? null;
      candidate = {
        level: evoLevel ?? 0,
        how: evoLevel ? `evo@${evoLevel}` : "on evolution",
        learner: source.learnerName || null,
        sourceTitle: source.sourceTitle || source.detail || source.label || "",
      };
    } else {
      // "TM42: After Badge 01" → "TM42"; "Sketch" → "Sketch"; etc.
      candidate = {
        level: 0,
        how: label.split(":")[0].trim() || "taught",
        learner: source.learnerName || null,
        sourceTitle: source.sourceTitle || source.detail || source.label || "",
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

function toId(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
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
    // answerable from the tooltip instead of on faith — the ranking prices
    // hops, levels, and candy/relearner hassle, but NOT evolution items a
    // donor's form consumes (a Victreebel route never charges for its Leaf
    // Stone), so the runner-ups are the user's cross-check.
    alternatives.length
      ? `Other pool routes: ${alternatives.join("; ")}.`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

// User rule: the shortest possible chain wins; earliest acquisition is only
// the tiebreak, then path names for determinism. The final tiebreaks on how/
// sourceTitle never reorder anything the user-ratified keys distinguish —
// they only make the order TOTAL: two donors can tie on (hops, level, path)
// while differing in provenance text (a fielded Vigoroth's "Level 9" vs a
// fielded Slaking's "Level 9 (Vigoroth, candy down)" both cost @9 via
// Vigoroth), and with a partial order the winner was whichever came first in
// pool TEXT order — which leaked input ordering into breedingContext, hence
// into stableStringify'd cache signatures (a pool reorder recomputed
// everything cold) and flipped the Egg tooltip between orderings.
export function compareBreedingCosts(a, b) {
  if (a.hops !== b.hops) return a.hops - b.hops;
  if (a.level !== b.level) return a.level - b.level;
  return (
    // Equal-level routes differ in real work: a candy-down/delayed @9 loses
    // to a plain level-up @9 (user report: Drapion@9-candy beat Skorupi@9
    // on the path tiebreak). Never overrides a level advantage.
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
  }

  return species;
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
  // genderless (Magnemite) — can't donate across lines (user report:
  // NidoranF recommended as Zebstrika's Double Kick donor), and a line that
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
// unlocked, a hatchable line's EVERY form is fieldable from any input
// (user ruling: "if I put in Beedrill but Kakuna was better, field Kakuna —
// I can hatch more Weedles"), while genderless/male-only/Undiscovered lines
// (Magnezone, Tauros) still can't reach downward.
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
// Nidoqueen's (audit: no fielded baby or Nido could ever receive an egg
// move). Union the breedable groups across the whole line, walking down to
// the root and up through every branch.
function getBreedableEggGroups(pokemonId) {
  const groups = new Set();
  for (const record of familyForms(pokemonId)) {
    for (const group of record.eggGroups || []) {
      if (!BLOCKED_EGG_GROUPS.has(group)) groups.add(group);
    }
  }
  return [...groups];
}

// Every species record in the family: walk down to the root, then up through
// every branch.
function familyForms(pokemonId) {
  let rootId = pokemonId;
  const seen = new Set();
  while (GEN7_PROGRESSION_SPECIES[rootId]?.prevoId && !seen.has(rootId)) {
    seen.add(rootId);
    rootId = GEN7_PROGRESSION_SPECIES[rootId].prevoId;
  }

  const forms = [];
  const walked = new Set();
  const visit = (id) => {
    const record = GEN7_PROGRESSION_SPECIES[id];
    if (!record || walked.has(id)) return;
    walked.add(id);
    forms.push(record);
    for (const evoId of record.evos || []) visit(evoId);
  };
  visit(rootId);
  return forms;
}

function emptyContext() {
  return {
    byPokemonId: {},
    ownedSpecies: [],
  };
}
