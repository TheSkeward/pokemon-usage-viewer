import {
  REBORN_ANALYSIS_TYPES,
  getTypeMultiplier,
  prepareFitScoring,
  resetFitScoring,
  getLineChoiceOptions,
  bestAssignmentForLines,
  evaluateTeam,
  betterEvaluated,
  teamIdentityKey,
  forEachCombination,
  createTopTeams,
  offerTopTeam,
  getRealizedTeamScore,
} from './search-kernel.js';
import { parallelFullSearch, PARALLEL_THRESHOLD } from './parallel-search.js';
import { tunable } from './scoring-constants.js';

/**
 * Selects the best team the pool's resolved lines can field — exhaustive or
 * budgeted search over line combinations, then form/mega assignment.
 * @return {!Promise<{team: !Array<!Object>, megaUsed: ?Object,
 *     lines: !Array<!Object>, unresolved: !Array<!Object>,
 *     linesConsidered: number, searchExact: boolean,
 *     benchSwapScores: ?Object, teamScore: ?number, searchPolish: ?Object,
 *     bestEvaluated: ?Object}>}
 */
export async function choosePoolTeam(
  lines,
  opponentTypeBias = {},
  {
    exhaustive = true,
    incremental = null,
    searchKey = null,
    benchSwaps = true,
    hint = false,
    onSearchProgress = null,
    onSearchStage = null,
  } = {},
) {
  const resolvedLines = lines.filter((line) => line.best || line.bestNonMega);
  const unresolved = lines.filter((line) => line.unresolved);
  const bestTeam = await selectTeamByFit(resolvedLines, opponentTypeBias, {
    exhaustive,
    incremental,
    searchKey,
    benchSwaps,
    hint,
    onSearchProgress,
    onSearchStage,
  });
  const evaluated = bestTeam.evaluated;
  const team = addTeamFitNotes(evaluated.team);
  const megaUsed = evaluated.megaUsed
    ? team.find(
      (choice) =>
        choice.inputPokemonId === evaluated.megaUsed.inputPokemonId &&
          choice.pokemonId === evaluated.megaUsed.pokemonId,
    )
    : null;

  return {
    team,
    megaUsed,
    lines,
    unresolved,
    linesConsidered: resolvedLines.length,
    searchExact: bestTeam.searchExact !== false,
    // Per non-selected line, the best team score achievable by swapping it onto
    // the optimal team — used by the bench view to flag the most droppable mon
    // (coverage-aware, not just by usage tier).
    benchSwapScores: bestTeam.benchSwapScores || null,
    // The chosen team's own realized score — the reference the bench swap
    // scores are compared against (valid for approximate searches too, where
    // bestEvaluated below is withheld from the incremental cache).
    teamScore: evaluated.score ?? null,
    // Swap-polish audit record (shortlist path only): {swaps: [{in, out,
    // gain, attribution}], audited}. Non-null means the full-pool 1-swap
    // audit ran; swaps.length > 0 means the shortlist provably missed a
    // better team and it was repaired. Null on exact paths (nothing to
    // audit — the search already saw every mon).
    searchPolish: bestTeam.searchPolish || null,
    // The raw (pre-note) winning team, so the optimizer can cache it and grow
    // the search incrementally next time. Only exact results are safe to seed.
    bestEvaluated: bestTeam.searchExact ? evaluated : null,
  };
}

/**
 * Post-selection build assignment (roadmap Phase 3): with the six lines fixed,
 * pick one build per member (at most one build per evolutionary line holds by
 * construction — builds are alternatives of the same member) maximizing the
 * realized team score. Always scores through the exact path (real coverage
 * vectors, never the selection relaxation). Deterministic: fixed enumeration
 * order, strict improvement. Returns { team, score }.
 */
export function assignTeamBuilds(team, opponentTypeBias = {}) {
  if (!team.length) return { team, score: 0 };
  const options = team.map((choice) =>
    choice.buildAlternatives?.length ? choice.buildAlternatives : [choice],
  );
  if (options.every((builds) => builds.length === 1)) {
    return { team, score: getRealizedTeamScore(team, opponentTypeBias) };
  }

  let best = null;
  const assignment = new Array(team.length);
  const walk = (index) => {
    if (index === team.length) {
      const score = getRealizedTeamScore(assignment, opponentTypeBias);
      if (!best || score > best.score) best = { score, team: [...assignment] };
      return;
    }
    for (const build of options[index]) {
      assignment[index] = build;
      walk(index + 1);
    }
  };
  walk(0);
  return best || { team, score: getRealizedTeamScore(team, opponentTypeBias) };
}

// Realizes each of the top relaxed teams and returns the best by EXACT realized
// score (the fix for the relaxation's blind spot: a line that looks like it
// patches two holes no single build patches together can win the relaxed
// ranking; another top-N team may beat it once builds are concrete).
// Deterministic: realized score, then team identity.
function realizeBestTeam(candidates, opponentTypeBias) {
  let best = null;
  let bestIdentity = '';
  for (const evaluated of candidates) {
    if (!evaluated?.team?.length) continue;
    const realized = assignTeamBuilds(evaluated.team, opponentTypeBias);
    const identity = teamIdentityKey(realized.team);
    if (
      !best ||
      realized.score > best.score ||
      (realized.score === best.score && identity < bestIdentity)
    ) {
      best = {
        ...evaluated,
        team: realized.team,
        score: realized.score,
        megaUsed: realized.team.find((choice) => choice.isMega) || null,
      };
      bestIdentity = identity;
    }
  }
  return best;
}

function addTeamFitNotes(team) {
  const attackTypeCounts = new Map();

  for (const choice of team) {
    for (const attackType of choice.legalityProfile?.attackTypes || []) {
      attackTypeCounts.set(
        attackType,
        (attackTypeCounts.get(attackType) || 0) + 1,
      );
    }
  }

  return team.map((choice) => {
    const reasons = getTeamFitReasons(choice, team, attackTypeCounts);
    if (!reasons.length) return choice;

    return {
      ...choice,
      note: [choice.note, `team fit: ${reasons.join('; ')}`]
        .filter(Boolean)
        .join('; '),
    };
  });
}

function getTeamFitReasons(choice, team, attackTypeCounts) {
  const profile = choice.legalityProfile;
  if (!profile) return [];

  const reasons = [];
  const uniqueAttackTypes = (profile.attackTypes || []).filter(
    (type) => attackTypeCounts.get(type) === 1,
  );
  const defensiveCovers = getDefensiveCoverTypes(profile, team);

  if (uniqueAttackTypes.length) {
    reasons.push(`adds ${uniqueAttackTypes.slice(0, 2).join('/')} attacks`);
  }

  if (defensiveCovers.length) {
    reasons.push(`covers ${defensiveCovers.slice(0, 2).join('/')}`);
  }

  return reasons.slice(0, 2);
}

function getDefensiveCoverTypes(profile, team) {
  return REBORN_ANALYSIS_TYPES.filter((attackType) => {
    const multiplier =
      getTypeMultiplier(attackType, profile.currentTypes || []);
    if (!(multiplier === 0 || (multiplier > 0 && multiplier < 1))) {
      return false;
    }

    const weakCount = team.filter((choice) => {
      const types = choice.legalityProfile?.currentTypes || [];
      return getTypeMultiplier(attackType, types) > 1;
    }).length;

    return weakCount > 0;
  });
}

// A team's score is intrinsic to its own members, so the optimum is the argmax
// over all teams of the target size — which means it must NOT depend on what
// else is sitting unused in the pool. Teams are enumerated exactly whenever
// affordable; pools beyond the budget reduce to a coverage-preserving
// shortlist that is itself enumerated exactly (see buildShortlist).
//
// Big searches run across Web Workers, so they're off the main thread and
// core-count faster; most edits never hit them anyway — the incremental path
// is exact regardless of budget; the budget only gates a from-scratch search.
// Above the budgets (tunables — see scoringConstants) the shortlist+polish
// path takes over — exact on the shortlist, repaired by the full-pool 1-swap
// audit, and honest about itself in the provenance footer. countCombinations'
// overflow early-out keeps a fixed sibling cap above the tunable budgets.
const COMBINATION_OVERFLOW_CAP = 3_000_000;

// Cooperative main-thread yield, time-sliced (same rationale as the
// optimizer's resolver yield): the polish/realization tail of the search
// phase runs as long synchronous blocks; yielding ~20 times a second lets
// the progress caption actually paint.
let lastSelectionYieldAt = 0;
function yieldForPaint() {
  const now = Date.now();
  if (now - lastSelectionYieldAt < 50) return Promise.resolve();
  lastSelectionYieldAt = now;
  return new Promise((resolve) => setTimeout(resolve, 0));
}
// Hint-grade searches — the investment plan's future-cap "fast" runs. The
// plan reads LINE scores (exact under any search path) plus a rough future
// six for the "projected to SEAT" flag, so full enumeration is pure waste;
// a 12-mon shortlist enumerates in 924 combinations.
const HINT_SEARCH_BUDGET = 20_000;
const HINT_SHORTLIST_MAX = 12;
// --- Full-enumeration team store -------------------------------------------
// When a SEQUENTIAL exact search enumerates every C(N, size) team, we keep them
// all — each team's line positions + score — keyed by the score context. The
// optimum of ANY sub-pool is then just the best stored team that uses only
// surviving lines, so a deletion to a never-visited subset is answered by a
// fast scan instead of a re-search. Big pools take the parallel path, which
// does NOT build a store (so it's invalidated there) — a subset-delete of a big
// pool just re-searches in parallel; small pools keep the instant scan.
let teamStore = null;

function createTeamStore(searchKey, lines, targetSize, capacity) {
  const posToLineKey = lines.map((line) => line.lineKey);
  return {
    searchKey,
    targetSize,
    posToLineKey,
    lineKeyToPos: new Map(posToLineKey.map((key, i) => [key, i])),
    count: 0,
    positions: new Uint8Array(capacity * targetSize),
    scores: new Float32Array(capacity),
  };
}

function recordStoreTeam(store, comboPositions, evaluated) {
  const index = store.count++;
  const base = index * store.targetSize;
  for (let j = 0; j < store.targetSize; j++) {
    store.positions[base + j] = comboPositions[j];
  }
  store.scores[index] = evaluated.score;
}

// The current pool is a subset of the stored full search — same context, same
// target size, every current line present — so the store holds every team it
// can form and a scan yields the exact optimum.
function teamStoreCovers(searchKey, lines, targetSize) {
  if (!teamStore || teamStore.searchKey !== searchKey) return false;
  if (teamStore.targetSize !== targetSize) return false;
  for (const line of lines) {
    if (!teamStore.lineKeyToPos.has(line.lineKey)) return false;
  }
  return true;
}

// Top-N surviving teams from the full-enumeration store (best relaxed scores,
// reconstructed and re-compared with the full deterministic comparator), for
// the realization re-rank.
function queryTeamStoreTop(lines, targetSize, opponentTypeBias, topCount) {
  const store = teamStore;
  const lineByKey = new Map(lines.map((line) => [line.lineKey, line]));
  const allowed = new Uint8Array(store.posToLineKey.length);
  for (const line of lines) allowed[store.lineKeyToPos.get(line.lineKey)] = 1;

  const size = store.targetSize;
  // Bounded insertion list of {score, base}, kept sorted descending by score.
  const keep = [];
  for (let i = 0; i < store.count; i++) {
    const base = i * size;
    let ok = true;
    for (let j = 0; j < size; j++) {
      if (!allowed[store.positions[base + j]]) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const score = store.scores[i];
    if (keep.length >= topCount && score <= keep[keep.length - 1].score) {
      continue;
    }
    let index = keep.length;
    while (index > 0 && score > keep[index - 1].score) index -= 1;
    keep.splice(index, 0, { score, base });
    if (keep.length > topCount) keep.pop();
  }
  if (!keep.length) return [];

  const top = createTopTeams(topCount);
  for (const { base } of keep) {
    const comboLines = [];
    for (let j = 0; j < size; j++) {
      comboLines.push(
        lineByKey.get(store.posToLineKey[store.positions[base + j]]));
    }
    const candidate =
      bestAssignmentForLines(comboLines, targetSize, opponentTypeBias);
    if (candidate) offerTopTeam(top, candidate);
  }
  return top.items;
}

async function selectTeamByFit(
  lines,
  opponentTypeBias = {},
  {
    exhaustive = true,
    incremental = null,
    searchKey = null,
    benchSwaps = true,
    hint = false,
    onSearchProgress = null,
    onSearchStage = null,
  } = {},
) {
  const targetSize = Math.min(6, lines.length);
  if (targetSize === 0) {
    return {
      evaluated: { team: [], megaUsed: null },
      searchExact: true,
      benchSwapScores: new Map(),
    };
  }

  const incApplies = incrementalApplicable(incremental, lines, targetSize);
  const addedCount = incApplies
    ? lines.filter((line) => !incremental.baseLineKeys.has(line.lineKey)).length
    : 0;
  const combinations = countCombinations(lines.length, targetSize);
  const budget = hint
    ? HINT_SEARCH_BUDGET
    : exhaustive
      ? tunable('EXHAUSTIVE_CAP')
      : tunable('AUTO_EXHAUSTIVE_BUDGET');

  // A from-scratch / grown search big enough to be worth it runs in parallel
  // off the main thread. A pure deletion (incremental, no added lines) and a
  // store-covered subset stay on their instant sequential paths; an addition
  // takes the parallel full enumeration (exact, and core-count fast).
  const isPureDeletion = incApplies && addedCount === 0;
  const isStoreCovered =
    !!searchKey && teamStoreCovers(searchKey, lines, targetSize);
  // Test hook (regret validation only): force the shortlist path even on a pool
  // small enough to enumerate fully, so its optimum can be compared to the true
  // exact optimum. No effect in production (the global is never set).
  const forceShortlist =
    !!tunable('FORCE_SHORTLIST') && !incApplies && !isStoreCovered;
  const useParallel =
    !forceShortlist &&
    !isPureDeletion &&
    !isStoreCovered &&
    combinations <= budget &&
    combinations >= PARALLEL_THRESHOLD;

  const realizationPool = Math.max(1, tunable('REALIZATION_POOL'));

  if (useParallel) {
    teamStore = null;
    const compactLines = buildCompactLines(lines);
    const refs = await parallelFullSearch(
      compactLines,
      targetSize,
      opponentTypeBias,
      combinations,
      realizationPool,
      onSearchProgress,
    );
    prepareFitScoring(lines, opponentTypeBias);
    try {
      onSearchStage?.('realize');
      await yieldForPaint();
      const candidates = (refs?.top || [])
        .map((entry) =>
          evaluatedFromRefs(entry, lines, targetSize, opponentTypeBias))
        .filter(Boolean);
      const evaluated = realizeBestTeam(candidates, opponentTypeBias);
      if (evaluated) {
        if (benchSwaps) {
          onSearchStage?.('bench');
          await yieldForPaint();
        }
        const benchSwapScores = benchSwaps
          ? scanTeamSwaps(lines, evaluated.team, opponentTypeBias).scores
          : null;
        return {
          evaluated,
          searchExact: true,
          benchSwapScores,
          searchPolish: null,
        };
      }
    } finally {
      resetFitScoring(lines);
    }
    // Unmappable result (shouldn't happen) — fall through to a sequential
    // search.
  }

  prepareFitScoring(lines, opponentTypeBias);
  try {
    let candidates;
    let searchExact;
    let usedShortlist = false;

    if (isStoreCovered) {
      // The team store answers any SUBSET of a fully-enumerated pool exactly,
      // including the realization top-N — so it outranks the incremental
      // seed for pure deletions (the seed-only path returns just the cached
      // winner, missing stored teams that newly enter the top-N when a
      // deletion frees their slots).
      candidates = queryTeamStoreTop(
        lines,
        targetSize,
        opponentTypeBias,
        realizationPool,
      );
      searchExact = true;
    } else if (incApplies) {
      // Reuse the cached optimum: instant for a pure deletion, or enumerate the
      // teams that include a newly-added line (small pools; big adds went
      // parallel).
      const top = createTopTeams(realizationPool);
      selectTeamExhaustive(
        lines, targetSize, opponentTypeBias, incremental, null, top);
      candidates = top.items;
      searchExact = true;
    } else if (combinations <= budget && !forceShortlist) {
      // Sequential full enumeration: record every team so later subsets of this
      // pool are answered by queryTeamStore.
      const store = searchKey
        ? createTeamStore(searchKey, lines, targetSize, combinations)
        : null;
      const top = createTopTeams(realizationPool);
      selectTeamExhaustive(
        lines, targetSize, opponentTypeBias, null, store, top);
      if (store) teamStore = store;
      candidates = top.items;
      searchExact = true;
    } else {
      // Too big to enumerate fully: reduce to a coverage-preserving shortlist
      // and enumerate THAT exactly. Route through the Web Worker pool when it's
      // worth it, so a big pool still uses all cores.
      usedShortlist = true;
      const shortlist = buildShortlist(lines, hint ? HINT_SHORTLIST_MAX : null);
      const shortSize = Math.min(6, shortlist.length);
      const shortCombos = countCombinations(shortlist.length, shortSize);
      candidates = null;
      if (shortCombos >= PARALLEL_THRESHOLD) {
        const compactLines = buildCompactLines(shortlist);
        const refs = await parallelFullSearch(
          compactLines,
          shortSize,
          opponentTypeBias,
          shortCombos,
          realizationPool,
          onSearchProgress,
        );
        // parallelFullSearch's SYNCHRONOUS fallback (no worker pool) runs
        // searchCombinationRange on this thread, whose own prepare/reset
        // cycle clears the fit state this branch prepared above — re-prepare
        // so ref mapping and bench swaps stay on the fast prepared path.
        prepareFitScoring(lines, opponentTypeBias);
        if (refs?.top?.length) {
          candidates = refs.top
            .map((entry) =>
              evaluatedFromRefs(entry, shortlist, shortSize, opponentTypeBias),
            )
            .filter(Boolean);
        }
      }
      if (!candidates?.length) {
        const top = createTopTeams(realizationPool);
        selectTeamExhaustive(
          shortlist, shortSize, opponentTypeBias, null, null, top);
        candidates = top.items;
      }
      searchExact = false; // exact on the shortlist, not the whole pool
    }

    onSearchStage?.('realize');
    await yieldForPaint();
    let evaluated =
      realizeBestTeam(candidates || [], opponentTypeBias) || {
        team: [],
        megaUsed: null,
      };

    // The swap-polish audit (polishTeamBySwaps) is the shortlist path's
    // exactness repair, not display — so it runs regardless of the benchSwaps
    // option.
    let searchPolish = null;
    let benchSwapScores = null;
    // Hint runs skip the exactness repair by contract: the polish is a full-
    // pool scan applied to a fixed point, and hint consumers (the investment
    // plan) read line scores plus a rough six, not an audited optimum.
    if (usedShortlist && evaluated.team.length && !hint) {
      const polished = await polishTeamBySwaps(
        lines,
        evaluated,
        opponentTypeBias,
        onSearchStage,
      );
      evaluated = polished.evaluated;
      searchPolish = polished.record;
      benchSwapScores = polished.scanScores;
    } else if (benchSwaps) {
      onSearchStage?.('bench');
      await yieldForPaint();
      // Exact paths: the ranking is display-only (the bench view's "most
      // droppable" flags) and skippable — the confidence sweep only needs the
      // seated set, and this is hundreds of full team evaluations per call.
      benchSwapScores = scanTeamSwaps(
        lines,
        evaluated.team,
        opponentTypeBias,
      ).scores;
    }

    return { evaluated, searchExact, benchSwapScores, searchPolish };
  } finally {
    resetFitScoring(lines);
  }
}

// Trims each line to the minimal, structured-cloneable shape a worker needs to
// score teams: the form options (pre-deduped/ordered by getLineChoiceOptions),
// each with its types, team-score, mega flag, and identity. No legality profile
// internals, bundles, or move data — keeps the worker message tiny.
function buildCompactLines(lines) {
  return lines.map((line) => ({
    lineKey: line.lineKey,
    choiceOptions: getLineChoiceOptions(line).map((choice) => ({
      inputPokemonId: choice.inputPokemonId,
      pokemonId: choice.pokemonId,
      isMega: !!choice.isMega,
      teamScore: choice.teamScore ?? choice.score ?? 0,
      // Phase 3 synergy + core-completion inputs — the worker's fastTeamFit
      // needs the line's usage trust and both pair-evidence maps (top-24
      // entries each, still tiny).
      usageWeight: choice.usageWeight ?? 0,
      _teammates: choice._teammates || null,
      _corePartners: choice._corePartners || null,
      legalityProfile: {
        attackTypes: choice.legalityProfile?.attackTypes || [],
        currentTypes: choice.legalityProfile?.currentTypes || [],
        // Workers score the selection relaxation: the optimistic (max-over-
        // builds) vector when the line has build variants.
        coverageVector:
          choice.optimisticCoverageVector ||
          choice.legalityProfile?.coverageVector ||
          null,
      },
    })),
  }));
}

// Maps the parallel search's compact id refs back to the real choice objects
// and re-evaluates the team on the main thread (so it carries full legality
// profiles for display and seeding). Returns null if any ref can't be mapped.
function evaluatedFromRefs(bestRefs, lines, targetSize, opponentTypeBias) {
  const byKey = new Map();
  for (const line of lines) {
    for (const choice of getLineChoiceOptions(line)) {
      byKey.set(`${choice.inputPokemonId}|${choice.pokemonId}`, choice);
    }
  }

  const team = [];
  for (const ref of bestRefs.team) {
    const choice = byKey.get(`${ref.inputPokemonId}|${ref.pokemonId}`);
    if (!choice) return null;
    team.push(choice);
  }
  const megaUsed = bestRefs.megaUsed
    ? byKey.get(`${bestRefs.megaUsed.inputPokemonId}|${bestRefs.megaUsed.pokemonId}`) || null
    : null;

  return evaluateTeam(team, megaUsed, targetSize, opponentTypeBias);
}

// One exhaustive 1-swap scan of the WHOLE pool against the current team: for
// each line not on the team, the best team score achievable by swapping it in
// for one of the starters (best over the line's form options and the slot it
// replaces, honouring the one-Mega limit). Returns both readings of the same
// pass:
//   scores — inputPokemonId -> best swap score, the bench view's droppability
//            ranking (a high score means the pool genuinely wants this mon);
//   best   — the single strongest swap {line, form, slot, score}, which is the
//            swap-polish audit: if best.score beats the team's own realized
//            score, the search provably missed a better team.
function scanTeamSwaps(lines, team, opponentTypeBias) {
  const scores = new Map();
  let best = null;
  if (!team.length) return { scores, best };

  const teamInputIds = new Set(team.map((choice) => choice.inputPokemonId));

  for (const line of lines) {
    const representative = line.best || line.bestNonMega;
    if (!representative) continue;
    if (teamInputIds.has(representative.inputPokemonId)) continue;

    let lineBest = -Infinity;
    for (const form of getLineChoiceOptions(line)) {
      for (let slot = 0; slot < team.length; slot += 1) {
        const swapped = team.slice();
        swapped[slot] = form;

        let megaCount = 0;
        for (const choice of swapped) if (choice.isMega) megaCount += 1;
        if (megaCount > 1) continue;

        // Exact path deliberately (not getTeamScore): the team members are
        // REALIZED builds, and these scores are compared against the team's
        // realized score (investment's close-bench reference). getTeamScore
        // would score via prepared `_fit` — optimistic vectors — when every
        // member is single-build, but fall back to exact when any member is
        // a build wrapper: same pool, two different scales, chosen by an
        // unrelated property.
        const score = getRealizedTeamScore(swapped, opponentTypeBias);
        if (score > lineBest) lineBest = score;
        // Deterministic best-swap pick: score, then incoming line key, then
        // slot — so equal-scoring audits repair identically on every run.
        if (
          !best ||
          score > best.score ||
          (score === best.score &&
            (line.lineKey < best.line.lineKey ||
              (line.lineKey === best.line.lineKey && slot < best.slot)))
        ) {
          best = { line, form, slot, score };
        }
      }
    }

    if (lineBest > -Infinity) {
      scores.set(representative.inputPokemonId, lineBest);
    }
  }

  return { scores, best };
}

// Swap-polish: repeatedly apply the best strictly-improving single swap from
// scanTeamSwaps until none exists. The final team is a 1-swap local optimum
// over the ENTIRE pool — any individually-better mon the shortlist missed
// gets seated — and
// each accepted swap is recorded with attribution (why the shortlist missed
// the incomer) as the shortlist-quality diagnostic. Sound but one-sided:
// repairs prove a shortlist miss; zero repairs certify local optimality, not
// global (a synergy PAIR both outside the shortlist stays invisible).
// Deterministic throughout; terminates because the realized score strictly
// increases per accepted swap, with a paranoia cap well above any observed
// repair count.
const POLISH_MAX_SWAPS = 8;

async function polishTeamBySwaps(
  lines, evaluated, opponentTypeBias, onSearchStage = null) {
  let current = evaluated;
  const swaps = [];
  onSearchStage?.('polish', { round: 1 });
  await yieldForPaint();
  let scan = scanTeamSwaps(lines, current.team, opponentTypeBias);

  while (
    scan.best &&
    scan.best.score > (current.score ?? -Infinity) &&
    swaps.length < POLISH_MAX_SWAPS
  ) {
    const swapped = current.team.slice();
    const outgoing = swapped[scan.best.slot];
    swapped[scan.best.slot] = scan.best.form;
    // Re-realize builds for the new composition (the incomer's best build can
    // differ in this team context). The scan already scored one concrete
    // assignment, so realization can only match or improve it — the guard is
    // a monotonicity backstop that also guarantees termination.
    const realized = assignTeamBuilds(swapped, opponentTypeBias);
    if (!(realized.score > (current.score ?? -Infinity))) break;

    swaps.push({
      in: choiceLabel(scan.best.form),
      out: choiceLabel(outgoing),
      gain: Math.round(realized.score - (current.score ?? 0)),
      attribution: explainShortlistMiss(lines, scan.best.line),
    });
    current = {
      ...current,
      team: realized.team,
      score: realized.score,
      megaUsed: realized.team.find((choice) => choice.isMega) || null,
    };
    onSearchStage?.('polish', { round: swaps.length + 1 });
    await yieldForPaint();
    scan = scanTeamSwaps(lines, current.team, opponentTypeBias);
  }

  return {
    evaluated: current,
    // The last scan audited the FINAL team and found no improvement — exactly
    // the bench view's droppability map, for free.
    scanScores: scan.scores,
    record: { swaps, audited: lines.length },
  };
}

function choiceLabel(choice) {
  return {
    inputName: choice?.inputName || '',
    name:
      choice?.legalityProfile?.currentName ||
      choice?.inputName ||
      choice?.pokemonId ||
      '?',
  };
}

// Why did the shortlist exclude this line? Reports its rank under the same
// individual-score ordering buildShortlist cuts on, plus every shortlist gate
// it DID satisfy (it lost those slots to better-ranked entries) — so a repair
// reads as either the known blind spot ("ranked 51st, matched nothing:
// team-context value the individual score can't see") or a genuine heuristic
// bug ("ranked 9th and still missed").
function explainShortlistMiss(lines, line) {
  const scored = rankShortlistEntries(lines);
  const index = scored.findIndex((entry) => entry.line === line);
  const entry = index >= 0 ? scored[index] : null;
  const matched = [];
  if (entry) {
    REBORN_ANALYSIS_TYPES.forEach((type, typeIndex) => {
      if ((shortlistCoverageOf(entry)?.[typeIndex] || 0) >= 0.5) {
        matched.push(`hits ${type}`);
      }
      const multiplier = getTypeMultiplier(
        type,
        entry.best?.legalityProfile?.currentTypes || [],
      );
      if (multiplier === 0) matched.push(`immune to ${type}`);
      else if (multiplier < 1) matched.push(`resists ${type}`);
    });
    if ((entry.best?.currentFeatures?.speedQ || 0) >= 0.8) matched.push('fast');
    if (
      (entry.best?.legalityProfile?.recommendedMoves || []).some(
        (move) => (move.priority || 0) > 0,
      )
    ) {
      matched.push('priority');
    }
    if ((entry.best?.currentFeatures?.utilityQ || 0) >= 0.6) {
      matched.push('utility');
    }
    if ((entry.best?.online ?? 0) === 1 && (entry.best?.friction || 0) === 0) {
      matched.push('friction-free online');
    }
  }
  return { rank: index + 1, of: scored.length, matched };
}

// Maps a realized team back onto the prepared per-line choice objects by
// (input, form) identity. Null if any member can't be found among the current
// choice options (defensive — the incremental context signature guarantees
// lines resolved identically).
function remapToPreparedChoices(team, lines) {
  const byKey = new Map();
  for (const line of lines) {
    for (const choice of getLineChoiceOptions(line)) {
      byKey.set(`${choice.inputPokemonId}|${choice.pokemonId}`, choice);
    }
  }
  const remapped = [];
  for (const member of team) {
    const choice = byKey.get(`${member.inputPokemonId}|${member.pokemonId}`);
    if (!choice) return null;
    remapped.push(choice);
  }
  return {
    team: remapped,
    megaUsed: remapped.find((choice) => choice.isMega) || null,
  };
}

// Incremental is valid when the cached optimum is a full team of the same
// target size and all of the cached TEAM's lines are still present. Non-team
// lines may have been removed — the optimum is invariant to unused mons, so a
// deletion that doesn't touch the team is reused as-is, and an addition grows
// the search.
function incrementalApplicable(incremental, lines, targetSize) {
  if (!incremental?.previousBest?.team?.length) return false;
  if (incremental.previousBest.team.length !== targetSize) return false;
  const present = new Set(lines.map((line) => line.lineKey));
  for (const key of incremental.teamLineKeys || incremental.baseLineKeys) {
    if (!present.has(key)) return false;
  }
  return true;
}

// Streams every team of the target size, keeping the single best. With
// `incremental`, it seeds the best from the cached optimum and only enumerates
// teams containing at least one newly-added line.
function selectTeamExhaustive(
  lines,
  targetSize,
  opponentTypeBias,
  incremental,
  recordStore,
  topCollector = null,
) {
  let best = null;
  const offer = (candidate) => {
    if (topCollector) offerTopTeam(topCollector, candidate);
    if (!best || betterEvaluated(candidate, best)) best = candidate;
  };

  if (incremental) {
    // The cached optimum is a REALIZED team (post-build-assignment wrappers:
    // no _fit, real coverage vectors), while every enumerated challenger is
    // scored on the prepared choices' optimistic relaxation. Re-map the seed
    // onto the CURRENT prepared choices so it competes on the same scale —
    // offered as-is it entered the top-N tournament systematically deflated
    // and could be evicted by challengers that realize WORSE, ratcheting the
    // optimum downward across pool edits. The context
    // signature is unchanged whenever incremental applies, so the mapping
    // only fails defensively; the realized seed is still offered then.
    const remapped = remapToPreparedChoices(
      incremental.previousBest.team,
      lines,
    );
    offer(
      evaluateTeam(
        remapped?.team || incremental.previousBest.team,
        remapped ? remapped.megaUsed : incremental.previousBest.megaUsed,
        targetSize,
        opponentTypeBias,
      ),
    );
    const baseKeys = incremental.baseLineKeys;
    const added = lines.filter((line) => !baseKeys.has(line.lineKey));
    const old = lines.filter((line) => baseKeys.has(line.lineKey));

    // Teams with exactly `a` added lines and `targetSize - a` old lines, for
    // a = 1..; this enumerates every team with >=1 added line, once each.
    const maxAdded = Math.min(targetSize, added.length);
    for (let a = 1; a <= maxAdded; a++) {
      const fromOld = targetSize - a;
      if (fromOld < 0 || fromOld > old.length) continue;
      forEachCombination(added.length, a, (addedIdx) => {
        const addedLines = addedIdx.map((i) => added[i]);
        forEachCombination(old.length, fromOld, (oldIdx) => {
          const comboLines = addedLines.concat(oldIdx.map((i) => old[i]));
          const candidate =
            bestAssignmentForLines(comboLines, targetSize, opponentTypeBias);
          if (candidate) offer(candidate);
        });
      });
    }
    return best || { team: [], megaUsed: null };
  }

  forEachCombination(lines.length, targetSize, (comboIndices) => {
    const comboLines = comboIndices.map((index) => lines[index]);
    const candidate =
      bestAssignmentForLines(comboLines, targetSize, opponentTypeBias);
    if (!candidate) return;
    if (recordStore) recordStoreTeam(recordStore, comboIndices, candidate);
    offer(candidate);
  });

  return best || { team: [], megaUsed: null };
}

function countCombinations(n, k) {
  if (k < 0 || k > n) return 0;
  const r = Math.min(k, n - k);
  let result = 1;
  for (let i = 0; i < r; i++) {
    result = (result * (n - i)) / (i + 1);
    if (result > COMBINATION_OVERFLOW_CAP * 8) return Infinity;
  }
  return Math.round(result);
}

// Reduces a too-big pool to a shortlist that the optimiser can enumerate
// exactly. Keeps the top mons by individual score (SHORTLIST_CORE) plus the
// best-scoring provider of every capability a team could need a specialist for:
// real damage into each defense type (optimistic across builds), each defensive
// resist and IMMUNITY, speed, priority, utility infrastructure, and
// low-friction evolved forms — so no mon that could earn a slot on quality OR
// any coverage axis is pruned before the optimiser sees it. Deterministic
// (scored order + fixed type order), so the shortlist — and thus the result —
// is stable. The individual-score ordering the shortlist cuts on — shared with
// explainShortlistMiss so repair attribution ranks by EXACTLY the ordering that
// excluded the mon.
function rankShortlistEntries(lines) {
  return lines
    .map((line) => {
      const best = getLineChoiceOptions(line)[0];
      return { line, best, score: best?.teamScore ?? best?.score ?? 0 };
    })
    .sort(
      (a, b) =>
        b.score - a.score || a.line.lineKey.localeCompare(b.line.lineKey),
    );
}

function shortlistCoverageOf(entry) {
  return (
    entry.best?.optimisticCoverageVector ||
    entry.best?.legalityProfile?.coverageVector ||
    null
  );
}

function buildShortlist(lines, maxSizeOverride = null) {
  const scored = rankShortlistEntries(lines);

  const maxSize = maxSizeOverride ?? tunable('SHORTLIST_MAX');
  const coreSize = Math.min(tunable('SHORTLIST_CORE'), maxSize);
  const picked = new Map();
  const add = (entry) => {
    if (entry && !picked.has(entry.line.lineKey)) {
      picked.set(entry.line.lineKey, entry.line);
    }
  };
  const coverageOf = shortlistCoverageOf;

  for (let i = 0; i < scored.length && picked.size < coreSize; i++) {
    add(scored[i]);
  }

  // Per defense type, damage INTO it must be real — the 0.5 bar keeps a chip
  // move from qualifying as coverage.
  REBORN_ANALYSIS_TYPES.forEach((type, typeIndex) => {
    if (picked.size >= maxSize) return;
    add(scored.find((s) => (coverageOf(s)?.[typeIndex] || 0) >= 0.5));
    if (picked.size >= maxSize) return;
    add(
      scored.find(
        (s) =>
          getTypeMultiplier(type, s.best?.legalityProfile?.currentTypes || []) <
          1,
      ),
    );
    if (picked.size >= maxSize) return;
    add(
      scored.find(
        (s) =>
          getTypeMultiplier(
            type,
            s.best?.legalityProfile?.currentTypes || [],
          ) === 0,
      ),
    );
  });

  const bySpecialty = (predicate) => scored.find(predicate);
  if (picked.size < maxSize)
    add(bySpecialty((s) => (s.best?.currentFeatures?.speedQ || 0) >= 0.8));
  if (picked.size < maxSize)
    add(
      bySpecialty((s) =>
        (s.best?.legalityProfile?.recommendedMoves || []).some(
          (move) => (move.priority || 0) > 0,
        ),
      ),
    );
  if (picked.size < maxSize)
    add(bySpecialty((s) => (s.best?.currentFeatures?.utilityQ || 0) >= 0.6));
  if (picked.size < maxSize)
    add(
      bySpecialty(
        (s) => (s.best?.online ?? 0) === 1 && (s.best?.friction || 0) === 0,
      ),
    );

  for (const s of scored) {
    if (picked.size >= maxSize) break;
    add(s);
  }
  return [...picked.values()];
}
