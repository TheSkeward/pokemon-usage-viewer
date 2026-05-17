import {
  getAvailableMoveMap,
  getAvailableRebornMoves,
  getRebornMoveId,
  loadRebornLegalMoveData,
} from "./legalMoves";

const HIDDEN_MOVESET_ENTRY_KEYS = new Set(["other", "nothing"]);
const SOURCE_TONE = {
  "level-up": "level",
  relearner: "relearner",
  tm: "machine",
  tmx: "machine",
  tutor: "tutor",
  egg: "egg",
};

export function renderRebornLegalMovesPanel(container, options) {
  const { currentSpecies, movesetEntry, pokemonId, pokemonName, progression } = options;
  const legalityPokemonId = currentSpecies?.id || pokemonId;
  const legalityPokemonName = currentSpecies?.name || pokemonName;
  const renderKey = JSON.stringify({ pokemonId, progression });
  container.dataset.legalMovesKey = renderKey;
  container.innerHTML = `
    <section class="panel details-panel reborn-legal-panel">
      <h3>Reborn Legal Moves</h3>
      <p class="muted">Checking current progression...</p>
    </section>
  `;

  loadRebornLegalMoveData(legalityPokemonId)
    .then((legalMoveData) => {
      if (container.dataset.legalMovesKey !== renderKey) return;
      container.innerHTML = renderLoadedPanel({
        currentSpecies,
        legalMoveData,
        legalityPokemonName,
        movesetEntry,
        pokemonName,
        progression,
      });
    })
    .catch((error) => {
      if (container.dataset.legalMovesKey !== renderKey) return;
      container.innerHTML = `
        <section class="panel details-panel reborn-legal-panel">
          <h3>Reborn Legal Moves</h3>
          <p class="muted">${escapeHtml(error.message || error)}</p>
        </section>
      `;
    });
}

function renderLoadedPanel({
  currentSpecies,
  legalMoveData,
  legalityPokemonName,
  movesetEntry,
  pokemonName,
  progression,
}) {
  if (!legalMoveData) {
    return `
      <section class="panel details-panel reborn-legal-panel">
        <h3>Reborn Legal Moves</h3>
        <p class="muted">No generated legality data found for ${escapeHtml(pokemonName)}.</p>
      </section>
    `;
  }

  const availableMoves = getAvailableRebornMoves(legalMoveData, progression);
  const availableMoveMap = getAvailableMoveMap(legalMoveData, progression);
  const observedMoves = cleanObservedMoves(movesetEntry?.moves || []);
  const observedAvailableCount = observedMoves.reduce(
    (count, move) =>
      count + (availableMoveMap.has(getRebornMoveId(move.name)) ? 1 : 0),
    0,
  );

  return `
    <section class="panel details-panel reborn-legal-panel">
      <div class="panel-header">
        <div>
          <h3>Reborn Legal Moves</h3>
          <p>${availableMoves.length} currently legal move options for ${escapeHtml(legalityPokemonName)} from ${escapeHtml(legalMoveData.learnsetPokemonName)} learnset data.</p>
          ${
            currentSpecies?.differsFromRepresentative
              ? `<p class="muted">Long-term representative: ${escapeHtml(currentSpecies.representativeName)}. Current progression is checked against ${escapeHtml(currentSpecies.name)}.</p>`
              : ""
          }
          ${
            observedMoves.length
              ? `<p>${observedAvailableCount}/${observedMoves.length} observed Smogon moves are available under this progression.</p>`
              : '<p class="muted">Load set details to compare observed Smogon moves against legality.</p>'
          }
        </div>
      </div>

      ${renderObservedMoves(observedMoves, availableMoveMap)}

      <details class="legal-move-details">
        <summary>Show legal move pool (${availableMoves.length})</summary>
        ${renderMovePool(availableMoves)}
      </details>
    </section>
  `;
}

function renderObservedMoves(observedMoves, availableMoveMap) {
  if (!observedMoves.length) return "";

  return `
    <section class="legal-move-section">
      <h4>Observed Set Moves</h4>
      <div class="legal-observed-grid">
        ${observedMoves
          .map((entry) => {
            const availableMove = availableMoveMap.get(getRebornMoveId(entry.name));
            return `
              <div class="legal-observed-row ${availableMove ? "available" : "unavailable"}">
                <strong>${escapeHtml(entry.name)}</strong>
                ${
                  availableMove
                    ? renderSourcePills(availableMove.availableSources)
                    : '<span class="legal-source-pill unavailable">Unavailable now</span>'
                }
              </div>
            `;
          })
          .join("")}
      </div>
    </section>
  `;
}

function renderMovePool(availableMoves) {
  if (!availableMoves.length) {
    return '<p class="muted">No moves are currently available. Set a level cap or unlock progression options above.</p>';
  }

  return `
    <div class="legal-move-pool">
      ${availableMoves
        .map(
          (move) => `
            <div class="legal-move-row">
              <span>
                <strong>${escapeHtml(move.name)}</strong>
                <small>${escapeHtml(move.type)} / ${escapeHtml(move.category)}</small>
              </span>
              ${renderSourcePills(move.availableSources)}
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderSourcePills(sources) {
  return `
    <span class="legal-source-list">
      ${sources
        .map(
          (source) => `
            <span
              class="legal-source-pill ${escapeAttr(SOURCE_TONE[source.kind] || source.kind)}"
              title="${escapeAttr(source.detail || source.label)}"
            >
              ${escapeHtml(source.label)}
            </span>
          `,
        )
        .join("")}
    </span>
  `;
}

function cleanObservedMoves(entries = []) {
  return entries.filter(
    (entry) => !HIDDEN_MOVESET_ENTRY_KEYS.has(getRebornMoveId(entry.name)),
  );
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
