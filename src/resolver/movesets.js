import {
  getMovesetResolverCandidates,
  loadAggregatedMovesetCandidate,
} from "../data";

export function createResolverMovesetController({
  cacheSchemaVersion,
  getAvailability,
  getFormatLabel,
  getState,
  onUpdate,
}) {
  let detail = null;
  let status = {
    phase: "idle",
    checked: 0,
    total: 0,
    contributed: 0,
  };
  let selectionKey = null;
  let requestToken = 0;
  let inFlightKey = null;

  const detailCache = new Map();

  return {
    getDetail() {
      return detail;
    },

    getStatus() {
      return status;
    },

    loadPersistentCache() {
      detailCache.clear();

      try {
        const raw = localStorage.getItem(getStorageKey());
        if (!raw) return;

        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return;

        for (const [key, value] of Object.entries(parsed)) {
          detailCache.set(key, value);
        }
      } catch (error) {
        console.warn("Failed to load resolver moveset cache", error);
      }
    },

    prime() {
      const state = getState();
      const key = state.resolverSelectedPokemon
        ? `${state.family}:${state.resolverMonth}:${state.resolverSelectedPokemon}`
        : null;

      if (!key) {
        selectionKey = null;
        detail = null;
        status = {
          phase: "idle",
          checked: 0,
          total: 0,
          contributed: 0,
        };
        requestToken += 1;
        inFlightKey = null;
        return;
      }

      const cached = detailCache.get(key);

      selectionKey = key;
      requestToken += 1;
      inFlightKey = null;

      if (cached) {
        detail = cloneValue(cached.detail);
        status = cloneValue(cached.status);
        return;
      }

      detail = null;
      status = {
        phase: "loading",
        checked: 0,
        total: 0,
        contributed: 0,
      };
    },

    async kick() {
      const state = getState();

      if (state.view !== "resolver") return;

      const pokemonId = state.resolverSelectedPokemon;
      const selection = state.resolverMonth;
      const family = state.family;

      if (!pokemonId) return;

      const key = `${family}:${selection}:${pokemonId}`;
      if (detailCache.has(key) || inFlightKey === key) return;

      const availability = getAvailability();
      const candidates = getMovesetResolverCandidates(
        availability,
        family,
        selection,
      );

      const total = candidates.length;
      const token = requestToken;

      inFlightKey = key;

      let nextDetail = null;
      let contributed = 0;

      const seen = {
        moves: new Set(),
        items: new Set(),
        abilities: new Set(),
        spreads: new Set(),
      };

      for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates[index];
        const aggregated = await loadAggregatedMovesetCandidate(
          candidate,
          pokemonId,
        );

        if (selectionKey !== key || token !== requestToken) {
          if (inFlightKey === key) inFlightKey = null;
          return;
        }

        if (aggregated) {
          if (!nextDetail) {
            nextDetail = createDetail(aggregated);
            detail = nextDetail;
            seedSeenSetsFromDetail(seen, detail);
            contributed = 1;
          } else if (appendFallback(nextDetail, aggregated, seen)) {
            nextDetail.stitched = true;
            nextDetail.sourcesUsed.push({
              formatId: aggregated.formatId,
              cutoff: aggregated.cutoff,
              monthsAvailable: aggregated.monthsAvailable,
              monthsPresent: aggregated.monthsPresent,
              sourceText: formatFallbackSource(aggregated),
            });
            contributed += 1;
            detail = nextDetail;
          }
        }

        const checked = index + 1;
        let phase = "loading";

        if (checked >= total) {
          phase = detail ? "ready" : "empty";
        } else if (detail) {
          phase = "loading-tail";
        }

        status = { phase, checked, total, contributed };
        onUpdate?.();
      }

      if (selectionKey === key && token === requestToken) {
        inFlightKey = null;

        const persisted = {
          detail,
          status,
        };

        detailCache.set(key, cloneValue(persisted));
        savePersistentCache();
      }
    },
  };

  function createDetail(aggregated) {
    return {
      ...aggregated,
      stitched: false,
      sourcesUsed: [
        {
          formatId: aggregated.formatId,
          cutoff: aggregated.cutoff,
          monthsAvailable: aggregated.monthsAvailable,
          monthsPresent: aggregated.monthsPresent,
          sourceText: formatFallbackSource(aggregated),
        },
      ],
      moves: aggregated.entry.moves.map((entry) => ({
        ...entry,
        kind: "primary",
      })),
      items: aggregated.entry.items.map((entry) => ({
        ...entry,
        kind: "primary",
      })),
      abilities: aggregated.entry.abilities.map((entry) => ({
        ...entry,
        kind: "primary",
      })),
      spreads: aggregated.entry.spreads.map((entry) => ({
        ...entry,
        kind: "primary",
      })),
    };
  }

  function seedSeenSetsFromDetail(seen, currentDetail) {
    for (const entry of currentDetail.moves)
      seen.moves.add(normalizeName(entry.name));
    for (const entry of currentDetail.items)
      seen.items.add(normalizeName(entry.name));
    for (const entry of currentDetail.abilities)
      seen.abilities.add(normalizeName(entry.name));
    for (const entry of currentDetail.spreads)
      seen.spreads.add(normalizeName(entry.name));
  }

  function appendFallback(currentDetail, aggregated, seen) {
    const sourceText = formatFallbackSource(aggregated);

    return (
      appendFallbackEntries(
        currentDetail.moves,
        aggregated.entry.moves,
        seen.moves,
        sourceText,
      ) ||
      appendFallbackEntries(
        currentDetail.items,
        aggregated.entry.items,
        seen.items,
        sourceText,
      ) ||
      appendFallbackEntries(
        currentDetail.abilities,
        aggregated.entry.abilities,
        seen.abilities,
        sourceText,
      ) ||
      appendFallbackEntries(
        currentDetail.spreads,
        aggregated.entry.spreads,
        seen.spreads,
        sourceText,
      )
    );
  }

  function appendFallbackEntries(target, entries, seenSet, sourceText) {
    let contributed = false;

    for (const entry of entries) {
      const key = normalizeName(entry.name);
      if (!key || seenSet.has(key)) continue;

      seenSet.add(key);
      target.push({
        name: entry.name,
        usage: null,
        kind: "fallback",
        sourceText,
      });
      contributed = true;
    }

    return contributed;
  }

  function formatFallbackSource(source) {
    const label = getFormatLabel(source.formatId);

    return source.selection === "all"
      ? `${label} @ ${source.cutoff} (${source.monthsPresent}/${source.monthsAvailable} mo)`
      : `${label} @ ${source.cutoff}`;
  }

  function getStorageKey() {
    const availability = getAvailability();

    return `resolverMovesets:${cacheSchemaVersion}:${availability?.latestMonth || "none"}`;
  }

  function savePersistentCache() {
    try {
      const payload = Object.fromEntries(detailCache);
      localStorage.setItem(getStorageKey(), JSON.stringify(payload));
    } catch (error) {
      console.warn("Failed to save resolver moveset cache", error);
    }
  }
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}
