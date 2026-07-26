import { getActiveGame } from '../games/registry.js';
import {
  applyBreedingContextToProgression,
} from '../reborn/breeding.js';
import {
  applySketchContextToProgression,
  buildRebornMoveTransferContexts,
  sketchContextSignature,
} from '../reborn/sketch.js';
import { GEN7_PROGRESSION_SPECIES } from '../generated/gen7ProgressionSpecies.generated.js';
import {
  getCurrentRebornSpeciesForChoice,
} from '../reborn/current-species.js';
import {
  getAvailableRebornMoves,
  loadRebornLegalMoveData,
} from '../reborn/legal-moves';
import { buildCandidateLegalityProfile } from '../reborn/team-analysis';
import { loadTopSet } from '../reborn/top-spread.js';
import { computeSetReadiness } from '../reborn/set-readiness.js';
import { buildInputGroups } from './input-groups';
import { parseAbilityAnnotations } from './pool-parsing';
import { normalizeName } from './name-utils';
import {
  tunable,
  scoringOverridesSignature,
} from './scoring-constants.js';
import {
  hasReliableTempoRamp,
  utilityTagVector,
} from './current-form-value.js';
import {
  MIN_MEANINGFUL_USAGE_PERCENT,
  compareScoredCandidates,
  computeUsageRamp,
  getUsageRanking,
  hasCompetitivePriorEvidence,
  scoreCandidate,
} from './candidate-scoring';
import { resolveRepresentativeLightBundle } from './representative-bundle';
import { choosePoolTeam } from './team-selection';
import { attachCoreLift } from './core-completion.js';
import { attachTeammateLift } from './teammate-synergy.js';
import { loadPersistedResults, persistResult } from './result-cache-store.js';
import { getDataSignature } from '../manifest.js';
import {
  SCORED_POOL_LIMIT,
  deduplicateUsageEntries,
  getLineUsageOrder,
  takeTopUsageEntries,
} from './usage-line-ranking.js';
import {
  getEvolutionDepth,
  getReachableLineCandidates,
  getReachableLineFallbackKey,
} from './line-reachability.js';

// --- Incremental caches ----------------------------------------------------
// In a playthrough you mostly grow the pool one mon at a time at a fixed game
// state, so we cache work keyed on everything that affects a line's score.
//   Layer 1: resolved lines, so adding a mon re-resolves only that mon.
// Layer 2: the exact optimum + its pool, so a pure addition only has to search
// teams that include the new mon (seeded from the cached best), and a
//            non-team deletion reuses the optimum outright.
//   Layer 3: full results memoized by (score context + mon set). The optimum is
//            a pure function of those, so revisiting any pool state seen this
//            session — undo, toggle a mon off/on, delete-then-re-add — returns
//            instantly with no line resolution and no search.
// All invalidate the moment the score context (family/selection/progression, or
// a line's reachable egg moves) changes — it's folded into every key.
const lineCache = new Map();
const MAX_LINE_CACHE = 4000;
// { searchKey, team, megaUsed, baseLineKeys, teamLineKeys }
let searchCache = null;
const resultCache = new Map();
const MAX_RESULT_CACHE = 400;

// Layer 3 is also persisted to IndexedDB (resultCacheStore) so it survives page
// reloads. Bump this whenever a change alters optimizer output (scoring, the
// search, or the legality/damage model): a mismatched version retires the
// stored results so a reload after such a deploy recomputes rather than showing
// stale teams. UI-only deploys keep the version, so results survive them. v10:
// fixed-damage honesty, tiebreaker K, pre-evo representative exclusion — three
// output-changing fixes shipped without a data-signature change, so persisted
// results from older builds must retire. v11: do-nothing status moves lost
// their utility flag (Splash-class) and fixed-damage moves count as attacks
// with live flat coverage — output changes again with no data-signature change.
// (Hidden Power gating needed no bump: its new progression field changes the
// progression key itself.) v12: the v11 utility-flag demotion is reverted
// (usage-backed status moves like Z-Splash are legitimate; the zero-usage
// filter is the real guard), so utility builds change back. v13: Snore's sleep
// gate became set-conditional (Rest in the legal pool no longer makes Snore a
// usable attack in a Rest-less set), changing recommended sets and their
// coverage. v14: results carry teamScore (the chosen team's realized score —
// the close-bench reference) and note text was rebuilt; persisted v13 results
// would render without both. v15: low-usage rows no longer get a noisy "trace
// usage" note; the Source column already says what tier/usage row the prior
// came from. v16: level-1 relearner relists survive alongside delayed/candy
// pre-evo routes (Honchkrow Sucker Punch was delayed-only at cap 55+), changing
// builds/friction for affected mons; breeding donor ties are now total- ordered
// so provenance no longer varies with pool text order. v17: a fielded
// evolution's OWN below-arrival level-up entries obey the arrival window
// (candy-down/relearner, not phantom natural), and equal- level donor ties
// prefer less hassle — chain details/labels change (Pineco's Pin Missile:
// Skorupi@9, not Drapion@9).
//
// v18: shortlist-path teams are polished to a 1-swap local optimum over the
// FULL pool (swap-polish audit repairs shortlist misses), results carry the
// searchPolish record, and the shortlist path always carries bench swap
// scores (the audit's final scan) — v17 large-pool teams may differ and
// lack both fields.
// v19: Focus Punch / Shell Trap amortize to 1/3 effective power (their
// fail-if-disrupted mechanic is a dex condition, not flags.charge, so the
// exposed-charge rule missed them) — recommended sets, damage estimates,
// and coverage change wherever they were priced as clean 150 BP hits.
// v20: leaky-dodge charge moves (Fly/Bounce/Dig/Dive) amortize to 2/3 —
// their dodge is punched through at 2x and the lock-in gifts a free turn
// (full power stays only where there's NO punch-through: Phantom Force/
// Shadow Force vanish, Sky Drop steals the target's turn).
// v21: daycare reachability: with the daycare unlocked, a
// hatchable line fields ANY family form from any input (Beedrill can field
// Kakuna; Mothim reaches the Wormadams) — and without it, sibling branches
// are now correctly OFF the table (Mothim could wrongly field Wormadam
// before). Same progression can produce different candidates than v20.
// v22: ability damage layer — abilities previously never factored into the
// damage estimates. The set's assumed ability now scales every
// damage estimate — Huge Power, Technician, Skill Link, Tough Claws, Sheer
// Force, the -ate type converters, and the rest of the move-property-
// conditional family — so damage-derived scores shift without any data
// signature change.
// v23: score-what-you-show — displayed sets had come apart from the sets
// that produced the score. Default/delayed builds (and the ability
// probe) now anchor on canonical move usage + the stitched competitive move
// rank — the same inputs the analysis pane displays — and the non-passive
// floor hardened alongside it (currentFormValue). Every line's default
// build can change, so every score can.
// v24: variable-power moves priced against a reference defender with the
// median stats for the level (Super Fang against median HP). Electro Ball /
// Gyro Ball / Grass Knot / Low Kick / Heavy Slam / Heat Crash / Punishment /
// Crush Grip / Wring Out / Flail / Reversal / Magnitude were priced at ZERO
// (dex base power 0) and not even counted as attacks; Foul Play used the user's
// Attack instead of the target's. Sets, coverage vectors, and scores change
// wherever these moves are legal. v25: the speed formulas read the attacker's
// EXACT speed (the stat line's spread-derived spe — the tooltip figure) instead
// of per-move investment assumptions: the attacker's exact speed is known, so
// use it, with the median value standing in for the defender. v26: acquisition
// friction defaults zeroed — knowing the best team comes first; whether the
// grind is worth it is the player's call, made with the receipts in view.
// Evolution requirements still render as receipts and access gates still block,
// but friendship/item/ trade/time K no longer moves scores.
// DELAYED_EVO_FRICTION kept (an in-run strength cost, not out-of-game grind).
// v27: scoring V0 retired (Rejuvenation prep; V1 was by then the thoroughly
// exercised model) — the usage-convergence blend is the only model; the UI
// toggle, the scoringModel option, and the per-model cache signature suffix are
// gone, so every pre-v27 entry (v0- or v1-scored) must retire rather than
// answer a run that can no longer say which it was. v28: the two-clause
// convergence law replaces "at w = 1 the score IS the prior": dead lines (no
// meaningful usage in any tier) still converge fully, but present-prior lines
// cap downward trust at PRIOR_DRAG_CAP — every converged over-performer's score
// rises, and lines carry linePriorPresent for the sweep's re-scoring.
//
// NOTE: results now persist their post-analysis (confidence sweep +
// investment plan) alongside the team — a change to the sweep grid, its
// contender selection, or the investment projection is ALSO an output
// change and needs a bump, even when the team itself is untouched.
// v29: Dream Eater is gated on the set carrying an opponent-sleep move (it
// deals zero into a non-sleeping target); mega readiness gate fixed
// (fieldableRepresentativeId). Damage-coverage builds that leaned on a
// phantom Dream Eater lose it, shifting sets and scores where it appeared.
// v30: attacker offense became per-build and additive — damageQ =
// buildPeak·(1 − w·(1 − breadth)) over the build's OWN recommended attacks,
// replacing the profile-global peak shared across all builds.
// v31: support moves that genuinely act at priority (intrinsic priority or
// Prankster) gain a distinct priority-utility role, and build dominance sees
// the same mechanical priority tag. Ability-sensitive support now affects the
// existing primary-vs-secondary probe as well as the selected build.
// v32: a type-resilient bulky-attacker role lets strong offense use its better
// defensive side only when the full defensive typing supplies enough broadly
// favorable switch-in matchups. Current-feature and role output both change.
// v33: Speed Boost gains a post-turn tempo-attacker role with an explicit
// protected-ramp fact. Reachable Mega candidates now score their actual battle
// form while preserving the fielded base and its pre-Mega ability for
// readiness, annotations, sensitivity, and Speed Boost carryover.
// v34: the ordinary balanced-bulk attacker and utility routes now adjust raw
// two-sided bulk by broad defensive type resilience. Neutral typing is fixed;
// vulnerable and favorable typings move effective bulk symmetrically.
// v35: the fast-attacker route now applies a small bounded access discount
// only where middling Speed and poor effective bulk overlap. Current-feature
// output and the confidence grid expose the new judgement.
// v36: executable single-action team protection is a complete support route,
// and sustained trace usage in a shallow format prevents the absence law from
// treating a competitively present line as dead. Move/build facts and score
// breakdowns change, so persisted results must retire.
// v37: the additive role routes (specialist bulk, tempo, priority utility)
// saturate through a soft knee instead of a hard clamp at 1, so elite roles
// stay ordered instead of tying at C = 2000. Sub-knee scores are unchanged.
// v38: field-extender bonus (Amplifield Rock): owning the Reborn-original
// duration extender scales a build's field-setting move's utility
// contribution by the measured borrowed-prior coefficient. Scores change
// only for progressions that own the item.
// v39: Belch is berry-gated — it counts as a damaging move only when the
// holder carries a berry, so recommended sets and coverage change for
// Belch carriers.
// v40: delayed-evolution routes prefer the least evolutionary delay
// (Staravia@43 over Starly@37 at cap 45) — route labels and legality
// proofs in persisted results change.
// v41: breeding-donor routes obey the same least-evolutionary-delay
// preference, so chain provenance, donor labels, and interim guides in
// persisted results change.
// v42: legality honors post-game level caps above 100 (previously truncated
// to 100), so candidates, available moves, and scores change for
// progressions with caps in the 101-150 range.
// v43: equal-hop breeding routes minimize forced NFE donor levels before
// raw learn level, changing egg-source instructions and interim guides.
// v44: equal-hop breeding routes return to preferring the lowest acquisition
// level, even when the learner remains unevolved longer.
// v45: the quantile-feature keys renamed to camelCase (damage_q → damageQ
// et al.) in code, tests, and SCORING.md together; persisted results carry
// the old keys in their feature vectors and would render blank breakdowns.
// v46: Smeargle's Sketch moves require a currently obtainable move on another
// pool Pokemon, so its builds and source receipts now depend on its partners.
// v47: pools above 126 recognized lines score only their top usage-ranked
// subset, while every listed line remains in the breeding/Sketch donor graph.
// v48: repeated inputs that resolve to the same bench form share one scored
// slot, and results retain the usage-ranked unscored tail for display.
// v49: reusable TM/TMX and tutor routes display ahead of the Heart
// Scale-consuming move relearner when the same move has several legal sources.
// v50: Rollout/Ice Ball escalation accounts for each miss ending the chain,
// reducing their effective damage and potentially changing recommended sets.
// v51: bench dedup keys on the ability annotation too — an annotated
// input (Froakie (Protean)) is never a duplicate of a differently-
// annotated line on the same bench form, so both stay in the scored pool.
// v52: team fit adds the bounded core-completion bonus from real-team pair
// evidence (core-index), so persisted team selections can change.
const RESULT_CACHE_VERSION = '52';

// Hydrate the in-memory memo from persisted results once, lazily. optimize()
// awaits this before consulting the memo so a reload-then-same-pool is a hit.
let hydration = null;
function ensureHydrated() {
  if (!hydration) {
    hydration = loadPersistedResults(RESULT_CACHE_VERSION)
      .then((entries) => {
        for (const [poolKey, result] of entries) {
          // Re-stamp the key: records written before post-analysis persistence
          // predate the stamp, and persistPostAnalysis needs it to write back.
          result.poolKey = poolKey;
          if (!resultCache.has(poolKey)) resultCache.set(poolKey, result);
        }
      })
      .catch(() => {});
  }
  return hydration;
}

/**
 * End-to-end optimize: resolves the pool's lines under the progression,
 * attaches teammate lift, runs the team search, and memoizes/persists the
 * result (degraded runs render best-effort but never persist).
 * @return {!Promise<!Object>} The choosePoolTeam result extended with
 *     timings, telemetryMeta, degraded, and poolKey.
 */
export async function optimizeTeamFromPool({
  availability,
  family,
  pokemonIndex,
  progression = {},
  query,
  selection,
  onProgress,
  exhaustive = true,
  // "fast" is for background projections (the investment plan's future-cap
  // runs): line scores stay exact — they never depend on the search — but the
  // team search runs shortlist-budget with no bench-swap ranking, and the run
  // is quarantined from the interactive search state: its cache keys carry a
  // "search:fast" tag so a fast verdict can never answer (or poison) a real
  // optimize, and it neither reads nor seeds the incremental search cache.
  // Fast results DO memoize and persist (under their tagged keys): the
  // investment plan depends on their cross-session warmth.
  searchMode = 'full',
  // Diagnostics that compare every member of a reference population need all
  // lines scored. The interactive app never sets this: its bounded 126-line
  // working set remains the production default.
  scoreAllLines = false,
}) {
  const fastMode = searchMode === 'fast';
  const scoringPoolLimit = scoreAllLines ? Infinity : SCORED_POOL_LIMIT;
  const setupStart = Date.now();
  const allGroups = buildInputGroups(query, pokemonIndex);
  const recognizedPoolSize = allGroups.filter(
    (group) => !group.unresolved,
  ).length;
  const unresolvedPoolSize = allGroups.length - recognizedPoolSize;
  const initialScoredPoolSize = Math.min(
    recognizedPoolSize,
    scoringPoolLimit,
  );
  let total = initialScoredPoolSize + unresolvedPoolSize;
  let completed = 0;
  onProgress?.({ phase: 'resolve', completed, total });

  await ensureHydrated();

  const { breedingContext, sketchContext } =
    await buildRebornMoveTransferContexts({
      pokemonIndex,
      progression,
      query,
    });

  const progressionSig = stableStringify(progression);
  // A line's egg moves can come from any current owned species via breeding,
  // and the current species can be a pre-evolution of the line's representative
  // — so rather than risk under-keying per line, all lines share one breeding
  // signature. It's trivial when the daycare is locked (full caching) and only
  // changes the whole pool's cache when reachable egg moves actually change.
  const breedingSig =
    breedingContext?.byPokemonId &&
    Object.keys(breedingContext.byPokemonId).length
      ? stableStringify(breedingContext.byPokemonId)
      : 'none';
  const sketchSig = sketchContextSignature(sketchContext);
  // Ability annotations ("Froakie (Torrent)") change a line's builds, so they
  // are part of the score context too.
  const abilityAnnotations = parseAbilityAnnotations(query, pokemonIndex);
  const abilitySig = abilityAnnotations.size
    ? [...abilityAnnotations.entries()]
      .sort()
      .map(([name, ability]) => `${name}=${ability}`)
      .join(',')
    : 'none';
  // Scoring overrides (confidence sweep / tests) and the DATA signature are
  // part of the score context: a sweep run must never hit — or seed — the
  // production ("base") caches, and a data refresh must retire every cached
  // verdict.
  const dataSignature = await getDataSignature();
  // The fast tag is appended (not a new fixed field) so every existing
  // full-mode key — including results persisted before fast mode existed —
  // keeps hitting. "fast2": fast runs resolve DEFAULT-ONLY builds, so a
  // tag-only bump retires stale fast entries while every exact result stays
  // warm.
  // The game id leads the signature: every cache layer keyed by contextSig
  // (line cache, result cache, persisted results) is per-game, so switching
  // games can never serve one game's verdicts to another.
  const contextSig = `${getActiveGame().id}|${family}|${selection}|${progressionSig}|${breedingSig}|${sketchSig}|${abilitySig}|${scoringOverridesSignature()}|${dataSignature}${
    fastMode ? '|search:fast2' : ''
  }${scoreAllLines ? '|pool:all' : ''}`;

  // Layer 3: the result is a pure function of the score context and the set of
  // input mons, so memoize by both. A hit short-circuits line resolution and
  // the search entirely; re-seed the incremental search from it so a later
  // addition still grows rather than re-enumerates.
  const poolKey = `${contextSig}|${allGroups
    .map((group) => group.input?.id ?? group.token)
    .sort()
    .join(',')}`;
  const memoized = resultCache.get(poolKey);
  if (memoized) {
    onProgress?.({ phase: 'resolve', completed: total, total });
    // A fast-mode hit must not touch the incremental cache: its results are
    // shortlist-grade (searchExact false), so seeding would NULL the exact
    // Layer-2 state the user's next pool edit needs.
    if (!fastMode) seedSearchCache(memoized, memoized.lines, contextSig);
    // Telemetry facts for the caller (poolWidget records the full pipeline
    // sample — optimizer, item loading, render, post-analysis — so this only
    // DESCRIBES the run; it never records). Overwritten fresh on every hit.
    memoized.telemetryMeta = {
      cache: 'result',
      poolSize:
        memoized.poolSelection?.scoredLines ?? initialScoredPoolSize,
      builds: countKeptBuilds(memoized.lines),
      dataSignature,
      setupMs: Date.now() - setupStart,
      resolveMs: 0,
      searchMs: 0,
    };
    return memoized;
  }

  const scoringPool = await selectScoringGroups({
    abilityAnnotations,
    allGroups,
    availability,
    family,
    pokemonIndex,
    progression,
    selection,
    onProgress,
    limit: scoringPoolLimit,
  });
  const groups = scoringPool.groups;
  total = groups.length;
  completed = 0;
  onProgress?.({ phase: 'resolve', completed, total });

  const hitLineKeys = new Set();
  const resolveStart = Date.now();

  const lines = (
    await Promise.all(
      groups.map((group) =>
        resolvePoolLineCached({
          args: {
            availability,
            breedingContext,
            sketchContext,
            family,
            group,
            pokemonIndex,
            progression,
            selection,
            abilityAnnotations,
            fastMode,
            candidateBundles: scoringPool.candidateBundlesByGroup.get(group),
          },
          contextSig,
          hitLineKeys,
        }).then((line) => {
          completed += 1;
          onProgress?.({ phase: 'resolve', completed, total });
          return line;
        }),
      ),
    )
  ).filter(Boolean);

  // Layer 2: if nothing about the score context changed and every line of the
  // cached optimal TEAM is unchanged (a cache hit), the previous optimum is
  // still valid — the team score is intrinsic, so removing any non-team mon
  // can't beat it, and added mons only need their containing teams enumerated.
  // So a deletion that doesn't touch the team returns the cached result with no
  // search, and an addition (with or without unrelated deletions) grows it.
  const searchKey = contextSig;
  const incremental =
    !fastMode &&
    searchCache &&
    searchCache.searchKey === searchKey &&
    [...searchCache.teamLineKeys].every((key) => hitLineKeys.has(key))
      ? {
        previousBest: {
          team: searchCache.team,
          megaUsed: searchCache.megaUsed,
        },
        baseLineKeys: searchCache.baseLineKeys,
        teamLineKeys: searchCache.teamLineKeys,
      }
      : null;

  const searchStart = Date.now();
  // Pair-evidence attachment (teammate lift + core index) fetches per-line
  // index files, so on a cold load it is a visible slice of the "search"
  // phase — captioned as its own stage.
  onProgress?.({ phase: 'search', stage: 'synergy' });
  await Promise.all([
    attachTeammateLift(lines, family),
    attachCoreLift(lines, family),
  ]);
  onProgress?.({ phase: 'search' });
  const result = await choosePoolTeam(lines, progression.opponentTypeBias, {
    exhaustive: exhaustive && !fastMode,
    incremental,
    // The team store is keyed on the same context as the incremental cache, so
    // a deletion to an unvisited subset is answered from the last full search.
    searchKey,
    // Bench-swap ranking is hundreds of full team evaluations and only feeds
    // extra bench annotation, so keep it for explicit full optimizes only.
    benchSwaps: exhaustive && !fastMode,
    // Hint-grade search: tiny budget, capped shortlist, no polish. Line
    // scores — the part the investment plan actually consumes — stay exact.
    hint: fastMode,
    onSearchProgress: (scanned, totalCombos) =>
      onProgress?.({ phase: 'search', completed: scanned, total: totalCombos }),
    // Post-scan tail stages (swap-polish audit rounds, build realization,
    // bench ranking) get their own captions — on a fast machine the worker
    // scan is sub-second and the VISIBLE search time is this tail.
    onSearchStage: (stage, detail) =>
      onProgress?.({ phase: 'search', stage, detail }),
  });
  result.timings = {
    resolveMs: searchStart - resolveStart,
    searchMs: Date.now() - searchStart,
  };
  result.poolSelection = scoringPool.selection;
  result.poolUsageEntries = scoringPool.poolUsageEntries;
  // Warm = anything short of from-scratch: line-cache hits and/or an
  // incremental (grown) search. Cold = every line resolved fresh AND a full
  // search.
  result.telemetryMeta = {
    cache: hitLineKeys.size > 0 || incremental ? 'warm' : 'cold',
    poolSize: scoringPool.selection.scoredLines,
    builds: countKeptBuilds(lines),
    dataSignature,
    setupMs: resolveStart - setupStart,
    resolveMs: result.timings.resolveMs,
    searchMs: result.timings.searchMs,
  };

  // A run degraded by transient fetch failures still renders (best effort),
  // but its verdict must not outlive the run: caching it would replay a
  // crippled team on a healthy network until the data signature changed.
  result.degraded = lines.some(lineIsDegraded);
  if (result.degraded) {
    searchCache = null;
  } else {
    // Fast runs never seed the incremental cache (same shortlist-grade rule
    // as the memo-hit path); memory memo AND persistence they DO share,
    // because a cold investment plan is two full future-cap runs.
    if (!fastMode) seedSearchCache(result, lines, searchKey);
    // The key rides on the result so persistPostAnalysis can write the
    // analysis back through to the same record later.
    result.poolKey = poolKey;
    storeResult(poolKey, result);
    persistResult(RESULT_CACHE_VERSION, poolKey, result);
  }

  return result;
}

/**
 * Attaches the post-analysis (confidence sweep + investment plan) to its
 * result and writes the result back through to IndexedDB, so a later hit —
 * memo or reload — restores the analysis panels instead of re-paying the
 * sweep and two future-cap optimizes. Degraded results never persist (same
 * rule as the result itself), and a result that predates this build simply
 * lacks the field and recomputes.
 */
export function persistPostAnalysis(result, postAnalysis) {
  if (!result || result.degraded || !postAnalysis) return;
  result.postAnalysis = postAnalysis;
  if (result.poolKey) {
    persistResult(RESULT_CACHE_VERSION, result.poolKey, result);
  }
}

// Seed the Layer-2 incremental cache from an exact result, so the next pool
// edit can grow/reuse it instead of re-searching. Only exact optima are safe to
// seed.
function seedSearchCache(result, lines, searchKey) {
  if (!(result.searchExact && result.bestEvaluated)) {
    searchCache = null;
    return;
  }

  const lineKeyByInput = new Map();
  for (const line of lines) {
    const rep = line.best || line.bestNonMega;
    if (rep) lineKeyByInput.set(rep.inputPokemonId, line.lineKey);
  }

  searchCache = {
    searchKey,
    team: result.bestEvaluated.team,
    megaUsed: result.bestEvaluated.megaUsed,
    baseLineKeys: new Set(
      lines
        .filter((line) => line.best || line.bestNonMega)
        .map((line) => line.lineKey),
    ),
    // The cached team's own line keys — incremental stays valid as long as
    // these survive, regardless of which other (unused) mons come and go.
    teamLineKeys: new Set(
      result.bestEvaluated.team
        .map((choice) => lineKeyByInput.get(choice.inputPokemonId))
        .filter(Boolean),
    ),
  };
}

// Total candidate builds that survived dominance pruning across the pool —
// the realization pass's working-set size. Line-level choices carry the kept
// builds as `buildAlternatives` (makeChoice renames the scored row's
// `buildChoices`).
function countKeptBuilds(lines) {
  let total = 0;
  for (const line of lines || []) {
    const rep = line.best || line.bestNonMega;
    if (rep) total += rep.buildAlternatives?.length || 1;
  }
  return total;
}

function storeResult(poolKey, result) {
  if (resultCache.size >= MAX_RESULT_CACHE) resultCache.clear();
  resultCache.set(poolKey, result);
}

// Cooperative main-thread yield, time-sliced so the overhead is bounded: a
// yield is a real event-loop turn (~1–4ms in browsers), so unconditional
// per-candidate yields would tax node suites and browsers alike. Once per
// 50ms keeps the UI responsive (scroll, clicks) through long resolve passes.
let lastYieldAt = 0;
function yieldToEventLoop() {
  const now = Date.now();
  if (now - lastYieldAt < 50) return Promise.resolve();
  lastYieldAt = now;
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function resolvePoolLineCached({ args, contextSig, hitLineKeys }) {
  const { group } = args;
  const inputId = group.input?.id ?? group.token;
  const cacheKey = `${inputId}|${contextSig}`;

  const cached = lineCache.get(cacheKey);
  if (cached) {
    if (cached.lineKey) hitLineKeys.add(cached.lineKey);
    return cached;
  }

  const line = await resolvePoolLine(args);
  // A line degraded by a TRANSIENT failure (a fetch threw mid-resolve, its
  // candidate scored -Infinity) must not be cached: fetchJsonCached already
  // declines to cache errors so a retry can heal, and caching the degraded
  // VERDICT here would defeat that — the mon would stay excluded on a
  // perfect network until the signature changed.
  if (!lineIsDegraded(line)) {
    if (lineCache.size >= MAX_LINE_CACHE) lineCache.clear();
    lineCache.set(cacheKey, line);
  }
  return line;
}

function lineIsDegraded(line) {
  // `degraded` is stamped by resolvePoolLine (errored candidates are filtered
  // out of the ranked list, so the flag is the only surviving trace).
  return Boolean(line?.degraded);
}

/**
 * Every recognized query line has already entered the breeding and Sketch
 * contexts before this runs. Production keeps the best 126 by numbered-bench
 * usage order; explicit diagnostics may request every line.
 */
async function selectScoringGroups({
  abilityAnnotations,
  allGroups,
  availability,
  family,
  pokemonIndex,
  progression,
  selection,
  onProgress,
  limit,
}) {
  const recognized = allGroups.filter((group) => !group.unresolved);

  if (recognized.length <= limit) {
    const selectionSummary = {
      limit: Number.isFinite(limit) ? limit : null,
      inputLines: recognized.length,
      recognizedLines: recognized.length,
      duplicateLines: 0,
      scoredLines: recognized.length,
      donorOnlyLines: 0,
    };
    return {
      groups: allGroups,
      candidateBundlesByGroup: new Map(),
      selection: selectionSummary,
      poolUsageEntries: [],
    };
  }

  let completed = 0;
  onProgress?.({ phase: 'rank', completed, total: recognized.length });
  const ranked = await Promise.all(
    recognized.map(async (group) => {
      const candidates = getReachableLineCandidates(
        group,
        pokemonIndex,
        progression,
      );
      const rows = await Promise.all(
        candidates.map(async (candidate) => ({
          candidate,
          bundle: await resolveRepresentativeLightBundle({
            availability,
            family,
            minMeaningfulUsagePercent: MIN_MEANINGFUL_USAGE_PERCENT,
            pokemonId: candidate.id,
            selection,
          }).catch((error) => {
            // Same containment as resolvePoolLine: a transient fetch failure
            // degrades one candidate's rank signal (the null bundle is
            // skipped by the ranking readers), never the whole optimize.
            console.warn(
              'Failed to rank team-builder candidate', candidate.id, error);
            return null;
          }),
        })),
      );
      completed += 1;
      onProgress?.({ phase: 'rank', completed, total: recognized.length });
      const usageOrder = getLineUsageOrder(rows, group.input.name);
      return {
        group,
        inputPokemonId: group.input.id,
        inputEvolutionDepth: getEvolutionDepth(group.input.id),
        candidateBundles: new Map(
          rows.map((row) => [row.candidate.id, row.bundle]),
        ),
        usageOrder,
        abilityAnnotation:
          abilityAnnotations?.get(normalizeName(group.input.name)) || null,
        displayKey:
          usageOrder.ceiling?.pokemonId ||
          usageOrder.trace?.pokemonId ||
          getReachableLineFallbackKey(candidates, group.input.id),
      };
    }),
  );

  const uniqueRanked = deduplicateUsageEntries(ranked);
  const selectedEntries = takeTopUsageEntries(uniqueRanked, limit);
  const selectedGroups = new Set(selectedEntries.map((entry) => entry.group));
  const candidateBundlesByGroup = new Map(
    selectedEntries.map((entry) => [entry.group, entry.candidateBundles]),
  );
  const scoredInputIds = new Set(
    selectedEntries.map((entry) => entry.inputPokemonId),
  );
  const selectionSummary = {
    limit: Number.isFinite(limit) ? limit : null,
    inputLines: recognized.length,
    recognizedLines: uniqueRanked.length,
    duplicateLines: recognized.length - uniqueRanked.length,
    scoredLines: selectedEntries.length,
    donorOnlyLines: Math.max(0, uniqueRanked.length - selectedEntries.length),
  };

  return {
    // Usage rank chooses membership, not enumeration order. Keeping query order
    // preserves deterministic search ties and incremental-cache behavior.
    groups: allGroups.filter(
      (group) => group.unresolved || selectedGroups.has(group),
    ),
    candidateBundlesByGroup,
    selection: selectionSummary,
    poolUsageEntries: uniqueRanked.map((entry) => ({
      displayKey: entry.displayKey,
      inputPokemonId: entry.inputPokemonId,
      inputName: entry.group.input.name,
      displayPokemonId:
        entry.usageOrder.ceiling?.pokemonId ||
        entry.usageOrder.trace?.pokemonId ||
        entry.inputPokemonId,
      displayName:
        entry.usageOrder.ceiling?.name ||
        entry.usageOrder.trace?.name ||
        entry.group.input.name,
      ceiling: entry.usageOrder.ceiling,
      trace: entry.usageOrder.trace,
      scored: scoredInputIds.has(entry.inputPokemonId),
    })),
  };
}

// Stable, order-independent stringify for cache keys: object keys are sorted
// and array elements (which here are set-like — owned items, TM ids, bias) too.
function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).sort().join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${key}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

async function resolvePoolLine({
  availability,
  breedingContext,
  sketchContext,
  family,
  group,
  pokemonIndex,
  progression,
  selection,
  fastMode = false,
  abilityAnnotations = null,
  candidateBundles = null,
}) {
  if (group.unresolved || !group.entries.length) {
    return {
      unresolved: true,
      inputName: group.token,
      lineKey: `unresolved:${group.token}`,
      best: null,
      bestNonMega: null,
      candidates: [],
    };
  }

  const input = group.input;
  const candidates = getReachableLineCandidates(
    group,
    pokemonIndex,
    progression,
  );
  const abilityOverride =
    abilityAnnotations?.get(normalizeName(input.name)) || null;

  const prepared = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        const bundle =
          candidateBundles?.get(candidate.id) ||
          await resolveRepresentativeLightBundle({
            availability,
            family,
            minMeaningfulUsagePercent: MIN_MEANINGFUL_USAGE_PERCENT,
            pokemonId: candidate.id,
            selection,
          });
        const builds = await resolveCandidateBuilds({
          breedingContext,
          sketchContext,
          candidate,
          family,
          input,
          progression,
          selection,
          abilityOverride,
          fastMode,
        });
        return { candidate, bundle, builds };
      } catch (error) {
        console.warn('Failed to prepare team-builder candidate', {
          candidate,
          error,
          input,
        });
        return { candidate, error };
      }
    }),
  );

  // Usage trust (w) is a property of the LINE, anchored to its
  // representative — the form with the best first-meaningful tier (higher
  // usage % breaks ties; FEAR-class pre-evos win this legitimately). Every
  // form then blends under that SAME w against its OWN prior, so a lesser
  // line-mate can't dodge the endgame drag by having a trivially-complete
  // set while the real form converges.
  const familyConfig = availability?.familyConfigs?.[family] || {};
  const formatOrder = familyConfig.formatOrder || [];
  const cutoffPriority = familyConfig.cutoffPriority || [];
  const levelCap = Number.parseInt(progression.levelCap, 10) || 0;
  let repRank = null;
  let repEntry = null;
  for (const entry of prepared) {
    if (entry.error || !entry.bundle?.usage) continue;
    const rank = getUsageRanking(entry.bundle, formatOrder, cutoffPriority);
    if (
      !repRank ||
      rank.tierRank < repRank.tierRank ||
      (rank.tierRank === repRank.tierRank && rank.value > repRank.value)
    ) {
      repRank = rank;
      repEntry = entry;
    }
  }
  const lineRamp = repEntry
    ? computeUsageRamp(
      repEntry.builds?.variants?.[0]?.profile || null, levelCap)
    : 0;
  // Absence vs bounded-trust law selector: a meaningful rank OR sustained
  // shallow-format trace on any form proves the line is not absent. Trace
  // remains unranked and cannot raise U_rank; it changes only which downward
  // trust law applies.
  const linePriorPresent = prepared.some(
    (entry) =>
      !entry.error &&
      hasCompetitivePriorEvidence(
        entry.bundle,
        formatOrder,
        cutoffPriority,
      ),
  );

  const scored = prepared.map(({ candidate, bundle, builds, error }) => {
    if (error || !builds) {
      return {
        input,
        candidate,
        bundle: bundle || { usage: null, leads: null },
        score: -Infinity,
        teamScore: -Infinity,
        meaningfulUsage: false,
        usagePercent: 0,
        rawCount: 0,
        leadPercent: 0,
        legalityProfile: null,
        ...(error ? { error } : {}),
      };
    }
    try {
      const scoreOf = (legalityProfile) =>
        scoreCandidate({
          availability,
          bundle,
          candidate,
          family,
          legalityProfile,
          levelCap,
          opponentTypeBias: progression.opponentTypeBias,
          lineRamp,
          linePriorPresent,
        });

      const scoredBuilds = builds.variants
        .map((variant) => ({
          input,
          candidate,
          bundle,
          buildKey: variant.key,
          buildLabel: variant.label,
          legalityProfile: variant.profile,
          ...scoreOf(variant.profile),
        }))
        .filter((row) => Number.isFinite(row.score));
      if (!scoredBuilds.length) {
        // No usage bundle for this form (e.g. a mega with no ladder data):
        // an unscoreable candidate, filtered by the ranked cut — not an error.
        return {
          input,
          candidate,
          bundle,
          score: -Infinity,
          teamScore: -Infinity,
          meaningfulUsage: false,
          usagePercent: 0,
          rawCount: 0,
          leadPercent: 0,
          legalityProfile: builds.variants[0]?.profile || null,
        };
      }

      // Ability sensitivity: how much V rests on the ability ASSUMPTION
      // (primary vs secondary on the same set). Zero when the user pinned the
      // ability. Stored on every build so the sweep's "assume the secondary
      // ability" axis and the explanation layer can both use it.
      if (builds.sensitivityProbe) {
        const probe = scoreOf(builds.sensitivityProbe);
        const defaultRow =
          scoredBuilds.find((row) => row.buildKey === 'default') ||
            scoredBuilds[0];
        const sensitivity = Number.isFinite(probe.score)
          ? Math.max(0, Math.round(defaultRow.score - probe.score))
          : 0;
        for (const row of scoredBuilds) {
          row.abilitySensitivity = sensitivity;
          row.legalityProfile.abilitySensitivity = sensitivity;
        }
      }

      const kept = pruneDominatedBuilds(scoredBuilds);
      kept.sort(compareScoredCandidates);
      const best = kept[0];
      // Choice-shaped builds for the post-selection realization pass, built
      // BEFORE tagging `best` so there is no self-nesting.
      const buildChoices = kept.map((row) =>
        makeChoice(input, row, row.buildLabel || 'Build'),
      );
      best.buildChoices = buildChoices;
      best.optimisticCoverageVector = optimisticCoverageVector(kept);
      return best;
    } catch (error) {
      console.warn('Failed to score team-builder candidate', {
        candidate,
        error,
        input,
      });

      return {
        input,
        candidate,
        bundle: { usage: null, leads: null },
        score: -Infinity,
        meaningfulUsage: false,
        usagePercent: 0,
        rawCount: 0,
        leadPercent: 0,
        legalityProfile: null,
        error,
      };
    }
  });

  const ranked = scored
    .filter((candidate) => Number.isFinite(candidate.score))
    .sort(compareScoredCandidates);
  const degraded = scored.some((candidate) => candidate.error) || undefined;

  if (!ranked.length) {
    return {
      unresolved: false,
      inputName: input.name,
      lineKey: getLineKey(candidates, input.id),
      best: null,
      bestNonMega: null,
      candidates: scored,
      lineRamp,
      linePriorPresent,
      degraded,
    };
  }

  const best = ranked[0];
  const bestNonMega = ranked.find((entry) => !entry.candidate.isMega) || null;

  return {
    unresolved: false,
    inputName: input.name,
    lineKey: getLineKey(candidates, input.id),
    best: makeChoice(
      input,
      best,
      best.candidate.isMega ? 'Best overall; uses Mega slot' : 'Best overall',
    ),
    bestNonMega: bestNonMega
      ? makeChoice(
        input,
        bestNonMega,
        best.candidate.isMega ? 'Best non-Mega fallback' : 'Best non-Mega',
      )
      : null,
    choiceOptions: buildChoiceOptions(input, ranked, best, bestNonMega),
    candidates: ranked,
    // The line-anchored usage trust: every form of this line was scored
    // under this ONE ramp. Carried on the line so the confidence sweep's
    // re-scoring uses the same anchor — its scoreCandidate calls would
    // otherwise fall back to per-form ramps, re-introducing the exact
    // pre-evo-dodges-the-drag bug the anchoring exists to prevent. The
    // prior-presence flag rides along for the same reason (law selection
    // must not flip between the run and the sweep).
    lineRamp,
    linePriorPresent,
    degraded,
  };
}

// Dominance pruning across a candidate's build variants — on MECHANICAL facts
// only (coverage into every defense type, utility tags, peak damage, friction),
// never on scored value: the confidence sweep perturbs the value weights, so a
// build pruned "because it scores lower under today's constants" could be
// exactly the alternative a sweep setting needs. Pruning on facts that no sweep
// axis can reorder keeps the robustness test honest (friction scales uniformly
// under FRICTION_SCALE, so ≤ friction is scale-invariant). Keep at most four
// (realization enumerates ≤4^6 — trivial); the default build is always kept as
// the canonical honest set.
function pruneDominatedBuilds(rows) {
  const facts = rows.map((row) => ({
    coverage: row.legalityProfile?.coverageVector || [],
    // Component-wise utility tags (accuracy-weighted counts, NO weights): a
    // recovery build and a status build are incomparable, so both survive —
    // a weighted scalar here could smuggle a judgement into what must stay a
    // sweep-invariant candidate set.
    utility: utilityTagVector(
      row.legalityProfile?.recommendedMoves,
      row.legalityProfile?.assumedAbility,
    ),
    peak: Math.max(
      row.legalityProfile?.bestStabMove?.estimatedDamage || 0,
      row.legalityProfile?.bestDamagingMove?.estimatedDamage || 0,
    ),
    // Protect-style moves are intentionally not generic utility. They are a
    // distinct mechanical fact only when they complete a Speed Boost ramp,
    // so a coverage build cannot dominate away the canonical tempo set.
    tempoRamp: hasReliableTempoRamp(row.legalityProfile),
    friction: row.legalityProfile?.frictionCost || 0,
  }));
  const dominates = (a, b) => {
    if (facts[a].friction > facts[b].friction) return false;
    if (facts[a].peak < facts[b].peak - 1e-9) return false;
    if (Number(facts[a].tempoRamp) < Number(facts[b].tempoRamp)) return false;
    const ua = facts[a].utility;
    const ub = facts[b].utility;
    for (let i = 0; i < ub.length; i++) {
      if ((ua[i] || 0) < (ub[i] || 0) - 1e-9) return false;
    }
    const ca = facts[a].coverage;
    const cb = facts[b].coverage;
    for (let i = 0; i < cb.length; i++) {
      if ((ca[i] || 0) < (cb[i] || 0) - 1e-9) return false;
    }
    return true;
  };

  const kept = [];
  for (let b = 0; b < rows.length; b++) {
    const dominated = rows.some((_, a) => {
      if (a === b) return false;
      if (!dominates(a, b)) return false;
      // Mutually-equal twins: keep the earlier (default-first) one only.
      if (dominates(b, a)) return a < b;
      return true;
    });
    if (!dominated || rows[b].buildKey === 'default') kept.push(rows[b]);
  }
  // Deterministic, value-free ordering.
  const coverageMass = (row) =>
    (row.legalityProfile?.coverageVector || []).reduce((sum, v) => sum + v, 0);
  kept.sort(
    (a, b) =>
      Number(b.buildKey === 'default') - Number(a.buildKey === 'default') ||
      coverageMass(b) - coverageMass(a) ||
      (a.legalityProfile?.frictionCost || 0) -
        (b.legalityProfile?.frictionCost || 0),
  );
  return kept.slice(0, 4);
}

// Element-wise max of the kept builds' coverage vectors: the line's optimistic
// coverage for team SELECTION (a relaxation — realized by assignTeamBuilds).
function optimisticCoverageVector(rows) {
  let vector = null;
  for (const row of rows) {
    const cv = row.legalityProfile?.coverageVector;
    if (!cv) continue;
    if (!vector) vector = [...cv];
    else for (let i = 0; i < vector.length; i++) vector[i] =
      Math.max(vector[i], cv[i] || 0);
  }
  return vector;
}

function buildChoiceOptions(input, ranked, best, bestNonMega) {
  const options = [];

  for (const result of ranked.slice(0, 5)) {
    options.push(
      makeChoice(
        input,
        result,
        getChoiceOptionNote(result, best, bestNonMega),
      ),
    );
  }

  if (
    bestNonMega &&
    !options.some((choice) => choice.pokemonId === bestNonMega.candidate.id)
  ) {
    options.push(
      makeChoice(
        input,
        bestNonMega,
        getChoiceOptionNote(bestNonMega, best, bestNonMega),
      ),
    );
  }

  return options;
}

function getChoiceOptionNote(result, best, bestNonMega) {
  if (result.candidate.id === best.candidate.id) {
    return best.candidate.isMega
      ? 'Best overall; uses Mega slot'
      : 'Best overall';
  }

  if (bestNonMega && result.candidate.id === bestNonMega.candidate.id) {
    return best.candidate.isMega ? 'Best non-Mega fallback' : 'Best non-Mega';
  }

  return result.candidate.isMega
    ? 'Team-fit option; uses Mega slot'
    : 'Team-fit option';
}

function makeChoice(input, result, note) {
  // Row notes carry only what the rest of the page does NOT already show:
  // the default build label and per-move facts live on the set card, so the
  // note keeps build labels only when non-default, states a useful readiness
  // gate when real usage exists but is not counted yet, and keeps genuine
  // warnings (no STAB, damage-defining ability assumption).
  const parts = [];
  if (note && note !== 'Standard set') parts.push(note);
  if (
    !result.meaningfulUsage &&
    (result.usagePercent || 0) >= MIN_MEANINGFUL_USAGE_PERCENT
  ) {
    parts.push(`usage ${result.usagePercent.toFixed(1)}% not counted yet: set not ready`);
  }
  const usageNote = parts.join('; ');
  const legalityNote = formatLegalityNote(result.legalityProfile);

  return {
    inputPokemonId: input.id,
    inputName: input.name,
    pokemonId: result.candidate.id,
    name: result.candidate.name,
    isMega: Boolean(result.candidate.isMega),
    score: result.score,
    teamScore: result.teamScore,
    meaningfulUsage: result.meaningfulUsage,
    legalityProfile: result.legalityProfile,
    legalityScore: result.legalityScore,
    friction: result.friction,
    currentRole: result.currentRole,
    currentFeatures: result.currentFeatures,
    ceiling: result.ceiling,
    online: result.online,
    futureValue: result.futureValue,
    usagePercent: result.usagePercent,
    tierRank: result.tierRank,
    usageWeight: result.usageWeight ?? 0,
    buildKey: result.buildKey || 'default',
    buildLabel: result.buildLabel || null,
    abilitySensitivity: result.abilitySensitivity || 0,
    ...(result.buildChoices ? { buildAlternatives: result.buildChoices } : {}),
    ...(result.optimisticCoverageVector
      ? { optimisticCoverageVector: result.optimisticCoverageVector }
      : {}),
    bundle: result.bundle,
    note: [usageNote, legalityNote].filter(Boolean).join('; '),
  };
}

// Warnings only. The pick's actual moves live on its set card — repeating a
// separately-derived "best legal STAB" here would let the two disagree on
// the same page. What stays is what the set card CANNOT show: that no legal
// STAB exists at all, and that the score leans on a damage-defining ability.
function formatLegalityNote(profile) {
  if (!profile) return '';

  const notes = [];
  if (!profile.bestStabMove?.name) notes.push('no current legal STAB');
  const ability = String(profile.assumedAbility || '').toLowerCase();
  if (ability === 'protean' || ability === 'adaptability') {
    notes.push(`scored assuming ${profile.assumedAbility}`);
  }
  return notes.join('; ');
}

// Generates the candidate's BUILD VARIANTS: a build is a concrete (form,
// ability, move set, friction) with its own legality profile and coverage
// vector. 2–4 plausible builds per viable form:
//   default   — the usage-anchored competitive set (natural evolution path)
//   coverage  — maximizes distinct real attacking coverage
//   utility   — leads with role moves (recovery/hazards/speed control)
//   delayed   — the default set allowed to use delayed-evolution moves, paying
//               DELAYED_EVO_FRICTION and labelled
// plus, when the caught mon's ability is UNKNOWN, a secondary-ability probe
// used only to measure ability sensitivity (the optimizer must never "choose"
// an ability the player doesn't control; a user annotation pins it instead).
//
// Score what you show: the default/delayed builds (and the probe, which
// measures the default set) anchor on the SAME inputs the analysis pane
// displays — canonical move usage and the stitched competitive move rank.
// Coverage/utility variants stay damage-/role-led by design: they exist as
// alternatives to the canonical set. TWO deliberate differences remain:
// scoring stays item-blind
// (items are inventory-dependent and priced by the owned-item system;
// folding the top competitive item into scored damage would double-count),
// and scoring uses ideal offensive investment rather than the displayed
// competitive spread (see the NOTE at makeProfile — real spreads are often
// defensive and collapsed PvE attacker offense).
async function resolveCandidateBuilds({
  breedingContext,
  sketchContext,
  candidate,
  family,
  input,
  progression,
  selection,
  abilityOverride = null,
  // Fast (hint-grade) runs — the investment plan's future-cap projections —
  // resolve ONLY the default build: no coverage/utility alternatives, no
  // delayed variant, no ability probe. The plan reads line scores and the
  // future team; its stated bar is "shortlist-grade hint".
  fastMode = false,
}) {
  // Profile building is the optimizer's dominant synchronous CPU block —
  // hence the yield here.
  await yieldToEventLoop();
  const choice = {
    inputPokemonId: input.id,
    inputName: input.name,
    pokemonId: candidate.id,
    name: candidate.name,
  };
  const currentSpecies = getCurrentRebornSpeciesForChoice(choice, progression);
  const candidateRecord = GEN7_PROGRESSION_SPECIES[candidate.id];
  const megaBaseId = candidateRecord?.isMega
    ? candidateRecord.baseSpeciesId || null
    : null;
  // A mega's usage representative is reachable only once its base species is
  // the form the player can field. Before then, the pre-evolution keeps its
  // own battle stats/typing/ability; once ready, combat uses the mega form
  // while evolution/readiness still tracks the fielded base.
  const megaReady = Boolean(
    candidate.isMega &&
      megaBaseId &&
      currentSpecies?.id === megaBaseId,
  );
  const battleSpeciesId = megaReady
    ? candidate.id
    : currentSpecies?.id || candidate.id;
  const legalMoveData = await loadRebornLegalMoveData(
    battleSpeciesId,
  );
  const memberPokemonId = currentSpecies?.id || legalMoveData?.pokemonId;
  const memberProgression = applySketchContextToProgression(
    applyBreedingContextToProgression(
      progression,
      memberPokemonId,
      breedingContext,
    ),
    memberPokemonId,
    sketchContext,
  );
  const member = {
    id: battleSpeciesId,
    inputName: input.name,
    name: megaReady ? candidate.name : currentSpecies?.name || candidate.name,
    representativeId: candidate.id,
    representativeName: currentSpecies?.differsFromRepresentative
      ? currentSpecies.representativeName
      : '',
    types: legalMoveData?.types || [],
  };
  const moves = getAvailableRebornMoves(legalMoveData, memberProgression);
  const naturalMoves = moves.filter((move) => !move.delayedEvolution);
  const delayedMoves = moves.filter((move) => move.delayedEvolution);

  // Ability: a user annotation ("Froakie (Torrent)") pins the caught mon's real
  // ability; otherwise assume its primary competitive ability and measure
  // sensitivity against the secondary. A reachable Mega has two simultaneous
  // facts: the base's caught ability before Mega Evolution and the Mega's fixed
  // active ability afterward. Damage uses the latter; tempo can use either.
  const topSet = await loadTopSet({
    family,
    pokemonId: candidate.id,
    selection,
  });
  const caughtTopSet = candidate.isMega
    ? await loadTopSet({
      family,
      pokemonId: megaBaseId,
      selection,
    })
    : topSet;
  const abilitySource = caughtTopSet || topSet;
  const abilityChoices = abilitySource?.abilities || [];
  const matchedOverride = abilityOverride
    ? abilityChoices.find(
      (entry) => entry.name.toLowerCase() === abilityOverride.toLowerCase(),
    )?.name || null
    : null;
  const caughtAssumedAbility =
    matchedOverride || abilitySource?.ability || topSet?.ability || null;
  const assumedAbility = megaReady
    ? topSet?.ability || caughtAssumedAbility
    : caughtAssumedAbility;
  const preMegaAbility = megaReady ? caughtAssumedAbility : null;
  const abilityKnown = Boolean(matchedOverride);
  const secondaryAbility =
    !abilityKnown && abilityChoices.length > 1
      ? abilityChoices.find(
        (entry) => entry.name !== caughtAssumedAbility,
      )?.name || null
      : null;

  const evolution = currentSpecies
    ? {
      friction: currentSpecies.evolutionFriction || 0,
      steps: currentSpecies.evolutionSteps || [],
      blocked: currentSpecies.blockedEvolutions || [],
    }
    : { friction: 0, steps: [], blocked: [] };

  // Canonical-set readiness (Phase 1) — a property of the LINE, shared by
  // every build variant. Feeds the readiness badges and the w ramp.
  const setReadiness = computeSetReadiness({
    legalMoveData,
    availableMoves: moves,
    topSet,
    progression: memberProgression,
  });

  // NOTE — scoring deliberately does NOT use the top spread's real EVs/nature
  // (attackerStats stays the generic strongest-side investment computed
  // inside buildCandidateLegalityProfile): competitive singles spreads are
  // often defensive, which collapses PvE attacker offense pool-wide and lets
  // zero-offense walls displace real attackers. A playthrough mon's
  // investment is the player's choice, so scoring prices the attacking
  // potential — "best obtainable", the same philosophy as the assumed
  // ability — while the pane displays the competitive spread it recommends.
  const makeProfile = ({
    movePreference,
    buildMoves,
    buildFriction = 0,
    ability,
    preMegaAbility: buildPreMegaAbility = null,
    usageAnchored = false,
  }) => {
    const profile = buildCandidateLegalityProfile({
      member,
      moves: buildMoves,
      representativeName: candidate.name,
      levelCap: progression.levelCap,
      ability,
      evolution,
      buildFriction,
      opponentTypeBias: progression.opponentTypeBias,
      movePreference,
      fieldExtenderOwned:
        ((progression.ownedItems || {}).amplifieldrock || 0) > 0,
      ...(usageAnchored
        ? { moveUsage: topSet.moveUsage, moveRank: topSet.moveRank }
        : {}),
    });
    profile.fieldedId = currentSpecies?.id || member.id;
    profile.fieldedName = currentSpecies?.name || member.name;
    profile.preMegaAbility = buildPreMegaAbility;
    profile.megaReady = megaReady;
    profile.legalityProof.fielded = profile.fieldedId;
    if (profile.currentId !== profile.fieldedId) {
      profile.legalityProof.battleForm = profile.currentId;
    }
    profile.abilityKnown = abilityKnown;
    profile.abilityOptions = abilityChoices;
    profile.setReadiness = setReadiness;
    return profile;
  };

  const variants = [
    {
      key: 'default',
      label: 'Standard set',
      profile: makeProfile({
        movePreference: 'default',
        buildMoves: naturalMoves,
        ability: assumedAbility,
        preMegaAbility,
        usageAnchored: true,
      }),
    },
  ];

  if (!fastMode) {
    variants.push(
      {
        key: 'coverage',
        label: 'Coverage set',
        profile: makeProfile({
          movePreference: 'coverage',
          buildMoves: naturalMoves,
          ability: assumedAbility,
          preMegaAbility,
        }),
      },
      {
        key: 'utility',
        label: 'Utility set',
        profile: makeProfile({
          movePreference: 'utility',
          buildMoves: naturalMoves,
          ability: assumedAbility,
          preMegaAbility,
        }),
      },
    );

    if (delayedMoves.length) {
      const delayedProfile = makeProfile({
        movePreference: 'default',
        buildMoves: [...naturalMoves, ...delayedMoves],
        ability: assumedAbility,
        preMegaAbility,
        usageAnchored: true,
      });
      const delayedIds = new Set(delayedMoves.map((move) => move.id));
      const usedDelayed = (delayedProfile.recommendedMoves || []).filter(
        (move) => delayedIds.has(move.id),
      );
      if (usedDelayed.length) {
        delayedProfile.frictionCost += tunable('DELAYED_EVO_FRICTION');
        delayedProfile.legalityProof.buildFriction = tunable('DELAYED_EVO_FRICTION');
        delayedProfile.legalityProof.delayedMoves = usedDelayed.map((move) => ({
          name: move.name,
          source: move.availableSources?.[0]?.label || 'delayed evolution',
        }));
        variants.push({
          key: 'delayed',
          label: `Delayed-evolution set (${usedDelayed.map((m) => m.name).join(', ')})`,
          profile: delayedProfile,
        });
      }
    }
  }

  const sensitivityProbe =
    !fastMode && secondaryAbility
      ? makeProfile({
        movePreference: 'default',
        buildMoves: naturalMoves,
        ability: megaReady ? assumedAbility : secondaryAbility,
        preMegaAbility: megaReady ? secondaryAbility : null,
        usageAnchored: true,
      })
      : null;

  return {
    variants,
    sensitivityProbe,
    assumedAbility,
    abilityKnown,
    secondaryAbility,
  };
}

function getLineKey(candidates, fallbackId) {
  if (!candidates.length) return fallbackId;

  return candidates
    .map((candidate) => candidate.id)
    .sort()
    .join('|');
}
