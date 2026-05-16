import {
  getMovesetResolverCandidates,
  loadAggregatedMovesetCandidate,
} from "../data";

export function createTeamBuilderSetDetailsLoader({
  getAvailability,
  getFamily,
  getFormatLabel,
  getSelection,
  onUpdate,
  waitForPaint,
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
    describeSource,
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
      total: 0,
      contributed: 0,
    };
    message = "Loading primary set details...";

    onUpdate();

    void loadPrimarySetDetail(pokemonId, requestGeneration);
  }

  function cancel() {
    generation += 1;
    selectedPokemonId = null;
    detail = null;
    status = null;
    message = "";
  }

  async function loadPrimarySetDetail(pokemonId, requestGeneration) {
    try {
      const candidates = getMovesetResolverCandidates(
        getAvailability(),
        getFamily(),
        getSelection(),
      );

      for (let index = 0; index < candidates.length; index += 1) {
        if (requestGeneration !== generation) return;

        const candidate = candidates[index];

        status = {
          phase: "loading",
          checked: index,
          total: candidates.length,
          contributed: 0,
        };
        message = `Checking set source ${index + 1}/${candidates.length}...`;

        onUpdate();
        await waitForPaint();

        const aggregated = await loadAggregatedMovesetCandidate(
          candidate,
          pokemonId,
        );

        if (requestGeneration !== generation) return;
        if (!aggregated) continue;

        detail = createPrimarySetDetail(aggregated);
        status = {
          phase: "ready",
          checked: index + 1,
          total: candidates.length,
          contributed: 1,
        };
        message = "";

        onUpdate();
        return;
      }

      if (requestGeneration !== generation) return;

      detail = null;
      status = {
        phase: "empty",
        checked: candidates.length,
        total: candidates.length,
        contributed: 0,
      };
      message = "No set details found for this pick.";

      onUpdate();
    } catch (error) {
      if (requestGeneration !== generation) return;

      console.error("Team Builder set detail load failed", error);

      detail = null;
      status = {
        phase: "empty",
        checked: 0,
        total: 0,
        contributed: 0,
      };
      message = `Set details failed: ${error?.message || error}`;

      onUpdate();
    }
  }

  function createPrimarySetDetail(aggregated) {
    return {
      ...aggregated,
      stitched: false,
      sourcesUsed: [
        {
          formatId: aggregated.formatId,
          cutoff: aggregated.cutoff,
          monthsAvailable: aggregated.monthsAvailable,
          monthsPresent: aggregated.monthsPresent,
          sourceText: describeSource(aggregated),
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

  function describeSource(source) {
    const label = getFormatLabel(source.formatId);

    if (source.selection === "all") {
      return `${label} @ ${source.cutoff} (all available, ${source.monthsPresent}/${source.monthsAvailable} months with this mon)`;
    }

    return `${label} @ ${source.cutoff} (${source.month})`;
  }
}
