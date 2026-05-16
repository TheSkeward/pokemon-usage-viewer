export function createPrecomputedSetDetailsLoader({
  getFamily,
  getSelection,
  onUpdate,
}) {
  let generation = 0;
  let selectedPokemonId = null;
  let detail = null;
  let status = null;
  let message = "";

  return {
    cancel,
    getDetail: () => detail,
    getMessage: () => message,
    getSelectedPokemonId: () => selectedPokemonId,
    getStatus: () => status,
    isSelected: (pokemonId) => selectedPokemonId === pokemonId,
    select,
  };

  function select(pokemonId) {
    if (!pokemonId) return;

    if (selectedPokemonId === pokemonId) {
      cancel();
      onUpdate();
      return;
    }

    const requestGeneration = ++generation;

    selectedPokemonId = pokemonId;
    detail = null;
    status = {
      phase: "loading",
      checked: 0,
      total: 1,
      contributed: 0,
    };
    message = "Loading set details...";

    onUpdate();
    void loadPrecomputedSetDetail(pokemonId, requestGeneration);
  }

  function cancel() {
    generation += 1;
    selectedPokemonId = null;
    detail = null;
    status = null;
    message = "";
  }

  async function loadPrecomputedSetDetail(pokemonId, requestGeneration) {
    try {
      const requestedSelection = getSelection();
      const result = await fetchSetDetailWithAllFallback({
        family: getFamily(),
        pokemonId,
        selection: requestedSelection,
      });

      if (requestGeneration !== generation) return;

      if (!result.detail) {
        detail = null;
        status = {
          phase: "empty",
          checked: 1,
          total: 1,
          contributed: 0,
        };
        message = "No precomputed set details found for this Pokémon.";
        onUpdate();
        return;
      }

      detail = result.detail;

      if (result.usedFallback) {
        detail = {
          ...detail,
          requestedSelection,
          selectionFallback: {
            requested: requestedSelection,
            used: result.usedSelection,
          },
        };
      }

      status = {
        phase: "ready",
        checked: 1,
        total: 1,
        contributed: detail?.sourcesUsed?.length || 1,
      };

      message = result.usedFallback
        ? `Showing all-period set details; ${requestedSelection} has no precomputed set file.`
        : "";

      onUpdate();
    } catch (error) {
      if (requestGeneration !== generation) return;

      console.error("Set detail load failed", error);

      detail = null;
      status = {
        phase: "empty",
        checked: 0,
        total: 1,
        contributed: 0,
      };
      message = `Set details failed: ${error?.message || error}`;

      onUpdate();
    }
  }
}

export function describePrecomputedSetSource(source) {
  const fallback = source?.selectionFallback;

  const base =
    source?.primarySource?.sourceText ||
    source?.sourceText ||
    (source?.selection === "all"
      ? `${source.formatId} @ ${source.cutoff} (all available)`
      : source?.formatId
        ? `${source.formatId} @ ${source.cutoff}`
        : "");

  if (fallback) {
    return `${base} · all-period details shown for ${fallback.requested}`;
  }

  return base;
}

async function fetchSetDetailWithAllFallback({ family, pokemonId, selection }) {
  const primary = await fetchSetDetail({ family, pokemonId, selection });

  if (primary || selection === "all") {
    return {
      detail: primary,
      usedFallback: false,
      usedSelection: selection,
    };
  }

  const fallback = await fetchSetDetail({
    family,
    pokemonId,
    selection: "all",
  });

  return {
    detail: fallback,
    usedFallback: Boolean(fallback),
    usedSelection: "all",
  };
}

async function fetchSetDetail({ family, pokemonId, selection }) {
  const response = await fetch(
    dataUrl(`set-index/${family}/${selection}/${pokemonId}.json`),
  );

  if (response.status === 404) return null;

  if (!response.ok) {
    throw new Error(`Failed to load set details (${response.status})`);
  }

  return response.json();
}

function dataUrl(path) {
  const base = import.meta.env.BASE_URL || "/";
  return `${base.replace(/\/$/, "")}/data/${path.replace(/^\//, "")}`;
}
