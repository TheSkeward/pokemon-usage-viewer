import {
  REBORN_MOVE_LEGALITY_BASE,
  REBORN_PROGRESSION_NOTES,
  REBORN_PROMOTED_TM_MOVES,
  REBORN_TMX_MOVES,
} from "./rules";

export function renderRebornProgressionPanel(progression) {
  return `
    <section class="panel progression-panel">
      <div class="panel-header">
        <div>
          <h2>Reborn Progression</h2>
          <p>Saved locally. These unlocks will drive legal-move checks; current team picks still use the usage-data prior.</p>
        </div>
      </div>

      <div class="progression-grid">
        <label>
          <span>Level cap</span>
          <input
            id="progression-level-cap"
            data-progression-field="levelCap"
            type="number"
            min="1"
            max="100"
            inputmode="numeric"
            value="${escapeAttr(progression.levelCap)}"
            placeholder="e.g. 45"
          />
        </label>

        <label class="checkbox-label">
          <input
            data-progression-field="moveRelearnerUnlocked"
            type="checkbox"
            ${progression.moveRelearnerUnlocked ? "checked" : ""}
          />
          <span>Move relearner unlocked</span>
        </label>

        <label class="checkbox-label">
          <input
            data-progression-field="daycareUnlocked"
            type="checkbox"
            ${progression.daycareUnlocked ? "checked" : ""}
          />
          <span>Daycare / breeding unlocked</span>
        </label>

        <label class="wide-control">
          <span>Available TMs</span>
          <textarea
            data-progression-field="availableTmsText"
            rows="3"
            placeholder="Flamethrower, Thunderbolt, Power-Up Punch..."
          >${escapeHtml(progression.availableTmsText)}</textarea>
        </label>

        <label class="wide-control">
          <span>Available TMXs</span>
          <textarea
            data-progression-field="availableTmxsText"
            rows="2"
            placeholder="Cut, Rock Smash, Fly, Surf, Waterfall..."
          >${escapeHtml(progression.availableTmxsText)}</textarea>
        </label>

        <label class="wide-control">
          <span>Available tutors</span>
          <textarea
            data-progression-field="availableTutorsText"
            rows="3"
            placeholder="Icy Wind, Knock Off, Signal Beam..."
          >${escapeHtml(progression.availableTutorsText)}</textarea>
        </label>
      </div>

      <details class="progression-rules">
        <summary>Reborn legality assumptions</summary>
        <ul>
          <li>Base: ${escapeHtml(REBORN_MOVE_LEGALITY_BASE.baseGames)} learnsets.</li>
          <li>Transfer moves available by default: ${REBORN_MOVE_LEGALITY_BASE.transferMovesAvailableByDefault ? "yes" : "no"}.</li>
          <li>TMX moves: ${REBORN_TMX_MOVES.map(escapeHtml).join(", ")}.</li>
          <li>Promoted TMs: ${REBORN_PROMOTED_TM_MOVES.map(escapeHtml).join(", ")}.</li>
          ${REBORN_PROGRESSION_NOTES.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}
        </ul>
      </details>

      <div class="toolbar">
        <button class="view-tab danger-button" id="clear-progression-button">Clear progression</button>
        <span class="muted" data-progression-status></span>
      </div>
    </section>
  `;
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
