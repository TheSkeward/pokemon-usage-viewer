export function createTeamBuilderSetDetailsLoader({
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
    describeSource,
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
      const response = await fetch(
        dataUrl(`set-index/${getFamily()}/${getSelection()}/${pokemonId}.json`),
      );

      if (requestGeneration !== generation) return;

      if (response.status === 404) {
        detail = null;
        status = {
          phase: "empty",
          checked: 1,
          total: 1,
          contributed: 0,
        };
        message = "No precomputed set details found for this pick.";
        onUpdate();
        return;
      }

      if (!response.ok) {
        throw new Error(`Failed to load set details (${response.status})`);
      }

      detail = await response.json();

      if (requestGeneration !== generation) return;

      status = {
        phase: "ready",
        checked: 1,
        total: 1,
        contributed: detail?.sourcesUsed?.length || 1,
      };
      message = "";

      onUpdate();
    } catch (error) {
      if (requestGeneration !== generation) return;

      console.error("Team Builder set detail load failed", error);

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

  function describeSource(source) {
    if (source?.primarySource?.sourceText)
      return source.primarySource.sourceText;

    if (source?.sourceText) return source.sourceText;

    if (source?.selection === "all") {
      return `${source.formatId} @ ${source.cutoff} (all available)`;
    }

    return source?.formatId ? `${source.formatId} @ ${source.cutoff}` : "";
  }
}

function dataUrl(path) {
  const base = import.meta.env.BASE_URL || "/";
  return `${base.replace(/\/$/, "")}/data/${path.replace(/^\//, "")}`;
}
