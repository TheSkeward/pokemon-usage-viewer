// Test harness that runs the REAL optimizer against the committed site data —
// the same modules the browser runs, with fetch/localStorage shimmed to the
// filesystem.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA = path.join(ROOT, 'site-data', 'data');

globalThis.__ENV__ = { BASE_URL: '/' };
globalThis.localStorage = {
  getItem: () => null,
  setItem() {},
  removeItem() {},
  key: () => null,
  length: 0,
};
globalThis.fetch = async (url) => {
  // Strip the ?v=<dataSignature> cache-buster (utils/dataUrl.js) like any
  // static file server would — the filesystem has no query strings.
  const rel = String(url)
    .replace(/\?.*$/, '')
    .replace(/^\/?data\//, '')
    .replace(/^\//, '');
  try {
    const buf = await readFile(path.join(DATA, rel));
    return {
      ok: true,
      status: 200,
      json: async () => JSON.parse(buf.toString()),
      text: async () => buf.toString(),
    };
  } catch {
    return { ok: false, status: 404, json: async () => null, text: async () => '' };
  }
};

const { loadAvailability, loadPokemonIndex } = await import('../../src/data.js');
const { optimizeTeamFromPool } = await import(
  '../../src/teamBuilder/teamOptimizer.js',
);
// Wire the exact-search worker pool to node worker_threads, mirroring the
// browser's Web Worker pool: each big search splits its combination range
// across cores. Web-Worker-shaped shim over worker_threads' EventEmitter API.
// Generous timeout: a CI box splitting a 2M-combo range is legitimately slow.
{
  const { Worker: NodeWorker } = await import('node:worker_threads');
  const { setSearchWorkerPoolFactory } = await import(
    '../../src/teamBuilder/parallelSearch.js',
  );
  const os = await import('node:os');
  const workerUrl = new URL('./searchWorker.node.mjs', import.meta.url);
  const shim = () => {
    const worker = new NodeWorker(workerUrl);
    worker.unref();
    const wrapped = new Map();
    return {
      addEventListener(type, fn) {
        const handler =
          type === 'message'
            ? (data) => fn({ data })
            : (err) => fn({ message: err?.message || String(err) });
        wrapped.set(fn, [type, handler]);
        worker.on(type, handler);
      },
      removeEventListener(type, fn) {
        const entry = wrapped.get(fn);
        if (entry) worker.off(entry[0], entry[1]);
        wrapped.delete(fn);
      },
      postMessage(msg) {
        worker.postMessage(msg);
      },
      terminate() {
        void worker.terminate();
      },
    };
  };
  const size = Math.max(1, Math.min(8, (os.availableParallelism?.() || 4) - 1));
  setSearchWorkerPoolFactory(
    () => Array.from({ length: size }, shim),
    { timeoutMs: 300_000 },
  );
}

const { setScoringOverrides } = await import(
  '../../src/teamBuilder/scoringConstants.js',
);
const progressionOptions = await import(
  '../../src/reborn/progressionOptions.js',
);

const shared = { availability: null, pokemonIndex: null };
export async function loadShared() {
  if (!shared.availability) {
    [shared.availability, shared.pokemonIndex] = await Promise.all([
      loadAvailability(),
      loadPokemonIndex(),
    ]);
  }
  return shared;
}

function badgeNumber(text) {
  const match = /Badge\s+(\d+)/.exec(text || '');
  return match ? Number(match[1]) : 99; // no badge string => not yet available
}

// Progression state for "badge N, level cap L": TMs/TMXs whose availability
// badge is unlocked, tutor moves via the tutor GROUPS (options carry no
// availability of their own).
export function progressionAt(
  { badge = 1, levelCap = 25, opponentTypeBias = {} } = {}) {
  const {
    REBORN_TM_OPTIONS,
    REBORN_TMX_OPTIONS,
    REBORN_TUTOR_OPTIONS,
    REBORN_TUTOR_GROUPS,
  } = progressionOptions;
  const atBadge = (options) =>
    options.filter((option) => badgeNumber(option.available) <= badge).map(
      (o) => o.id);
  const tutorMoves = new Set(
    (REBORN_TUTOR_GROUPS || [])
      .filter((group) => badgeNumber(group.available) <= badge)
      .flatMap((group) => group.moves),
  );
  return {
    levelCap: String(levelCap),
    moveRelearnerUnlocked: false,
    daycareUnlocked: false,
    availableTmIds: atBadge(REBORN_TM_OPTIONS),
    availableTmxIds: atBadge(REBORN_TMX_OPTIONS),
    availableTutorMoveIds: (REBORN_TUTOR_OPTIONS || [])
      .filter((option) => tutorMoves.has(option.move))
      .map((option) => option.id),
    ownedItems: {},
    opponentTypeBias,
  };
}

export async function runPool({
  pool,
  badge = 1,
  levelCap = 25,
  opponentTypeBias = {},
  overrides = null,
  progression = null,
}) {
  const { availability, pokemonIndex } = await loadShared();
  if (overrides) setScoringOverrides(overrides);
  try {
    return await optimizeTeamFromPool({
      availability,
      family: 'singles',
      pokemonIndex,
      progression:
        progression || progressionAt({ badge, levelCap, opponentTypeBias }),
      query: pool.join('\n'),
      selection: 'all',
    });
  } finally {
    if (overrides) setScoringOverrides(null);
  }
}

export function teamInputNames(result) {
  return result.team.map((choice) => choice.inputName).sort();
}

export function teamSet(result) {
  return new Set(teamInputNames(result));
}

export function lineFor(result, inputName) {
  const key = String(inputName).toLowerCase();
  return result.lines.find(
    (line) =>
      (line.best || line.bestNonMega)?.inputName?.toLowerCase() === key,
  );
}

export function bestChoice(result, inputName) {
  const line = lineFor(result, inputName);
  return line ? line.best || line.bestNonMega : null;
}
