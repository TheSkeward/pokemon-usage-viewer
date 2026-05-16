import { getMoveMeta, getTypeColor, getCategoryColor } from "../moveMeta";

const HIDDEN_MOVESET_ENTRY_KEYS = new Set(["other", "nothing"]);
const SPREAD_STATS = ["HP", "Atk", "Def", "SpA", "SpD", "Spe"];

export function renderMovesetPanel(container, options = {}) {
  const {
    selectedPokemonName = null,
    movesetEntry = null,
    lookupLabel = "",
    aggregate = false,
    stitched = false,
    status = null,
  } = options;

  if (!selectedPokemonName) {
    container.innerHTML = `
      <section class="panel details-panel empty-details">
        <h2>Movesets</h2>
        <p>Select a Pokémon to inspect its common moves, items, abilities, and spreads.</p>
      </section>
    `;
    return;
  }

  if (!movesetEntry && (!status || status.phase === "idle")) {
    container.innerHTML = `
      <section class="panel details-panel empty-details">
        <h2>${escapeHtml(selectedPokemonName)}</h2>
        <p>No moveset data found for ${escapeHtml(lookupLabel || "the current source")}.</p>
      </section>
    `;
    return;
  }

  const moves = cleanEntries(movesetEntry?.moves || []);
  const items = cleanEntries(movesetEntry?.items || []);
  const abilities = cleanEntries(movesetEntry?.abilities || []);
  const spreads = cleanEntries(movesetEntry?.spreads || []);
  const topSpreads = spreads.slice(0, 3);

  const notes = [];

  if (aggregate) notes.push("This is an all-period view.");
  if (stitched)
    notes.push(
      "Additional set options are shown with source tags instead of misleading percentages.",
    );

  notes.push("Other and Nothing are hidden.");
  notes.push(
    "Hover a move to highlight matches. Click a move to show only moves with the same type and category.",
  );

  container.innerHTML = `
    <section class="panel details-panel wide-details">
      <div class="panel-header">
        <div>
          <h2>${escapeHtml(selectedPokemonName)}</h2>
          ${renderStatusLine(status)}
          <p>Movesets from ${escapeHtml(lookupLabel || "the current source")}</p>
          ${notes.map((note) => `<p>${escapeHtml(note)}</p>`).join("")}
        </div>
      </div>

      ${
        !movesetEntry
          ? '<p class="muted">Loading movesets...</p>'
          : `
            <div class="moveset-summary-grid">
              <section class="summary-card">
                <h3>Abilities</h3>
                ${renderCompactList(abilities, "Abilities")}
              </section>
              <section class="summary-card">
                <h3>Top spreads</h3>
                ${renderCompactList(topSpreads, "Spreads")}
              </section>
            </div>

            <div class="moveset-main-grid">
              ${renderSection("Moves", moves)}
              ${renderSection("Items", items)}
            </div>

            <details class="spreads-details">
              <summary>Show full spread list (${spreads.length})</summary>
              ${renderSection("Spreads", spreads, true)}
            </details>
          `
      }
    </section>
  `;

  bindMoveInteractions(container);
}

function renderStatusLine(status) {
  if (!status || status.phase === "idle") return "";

  let label = "";
  const tone = status.phase;

  if (status.phase === "loading") {
    label =
      status.total > 0
        ? `Loading set details… ${status.checked}/${status.total}`
        : "Loading set details…";
  } else if (status.phase === "loading-tail") {
    label = `Loading additional set options… ${status.checked}/${status.total}`;
  } else if (status.phase === "ready") {
    label =
      status.contributed > 1
        ? `Complete · ${status.contributed} sources contributed`
        : "Complete";
  } else if (status.phase === "empty") {
    label = "No moveset data found";
  }

  return `<div class="moveset-status-line"><span class="status-pill ${tone}">${escapeHtml(label)}</span></div>`;
}

function renderCompactList(entries = [], sectionTitle = "") {
  if (entries.length === 0) return '<p class="muted">No data.</p>';

  return `
    <ul class="compact-list">
      ${entries
        .map(
          (entry, index) => `
            <li class="${isAdditionalEntry(entry) ? "tail-entry" : ""}">
              <span class="entry-left">
                <span class="entry-rank">${index + 1}.</span>
                <span>${renderPlainEntryName(entry.name, sectionTitle)}</span>
              </span>
              ${renderEntryValue(entry)}
            </li>
          `,
        )
        .join("")}
    </ul>
  `;
}

function renderSection(title, entries = [], alreadyExpanded = false) {
  if (entries.length === 0) {
    return `
      <section class="moveset-section">
        <h3>${title}</h3>
        <p class="muted">No data.</p>
      </section>
    `;
  }

  let additionalStarted = false;
  const rows = [];

  for (const [index, entry] of entries.entries()) {
    const moveMeta = title === "Moves" ? getMoveMeta(entry.name) : null;
    const moveAttrs = moveMeta
      ? `data-move-type="${escapeAttr(moveMeta.type)}" data-move-category="${escapeAttr(moveMeta.category)}"`
      : "";

    if (isAdditionalEntry(entry) && !additionalStarted) {
      additionalStarted = true;
      rows.push('<li class="section-divider">Additional set options</li>');
    }

    rows.push(
      title === "Moves"
        ? renderMoveRow(entry, index, moveMeta, moveAttrs)
        : renderStandardRow(entry, index, title),
    );
  }

  const movesFilterBar =
    title === "Moves"
      ? `
        <div class="moves-filter-bar">
          <span class="moves-filter-status">Showing all moves</span>
          <button type="button" class="moves-filter-clear hidden">Clear filter</button>
        </div>
      `
      : "";

  return `
    <section class="moveset-section ${alreadyExpanded ? "spreads-section" : ""}" data-section="${escapeAttr(title)}">
      <div class="moveset-section-header">
        <h3>${title}</h3>
        ${movesFilterBar}
      </div>
      <ul>${rows.join("")}</ul>
    </section>
  `;
}

function renderMoveRow(entry, index, moveMeta, moveAttrs) {
  return `
    <li class="moveset-row move-row ${isAdditionalEntry(entry) ? "tail-entry" : ""} ${moveMeta ? "move-entry" : ""}" ${moveAttrs}>
      <span class="move-row-main">
        <span class="move-row-name" title="${escapeAttr(entry.name)}">
          <span class="entry-rank">${index + 1}.</span>
          <span class="entry-name-text">${escapeHtml(entry.name)}</span>
        </span>
        <span class="move-row-types">
          ${
            moveMeta
              ? `
                <span class="move-badge" style="${badgeStyle(getTypeColor(moveMeta.type))}">${escapeHtml(moveMeta.type)}</span>
                <span class="move-badge" style="${badgeStyle(getCategoryColor(moveMeta.category))}">${escapeHtml(moveMeta.category)}</span>
              `
              : '<span class="entry-meta">—</span>'
          }
        </span>
        ${typeof entry.usage === "number" ? `<strong>${entry.usage.toFixed(1)}%</strong>` : ""}
      </span>
      ${typeof entry.usage === "number" ? "" : renderSourceLine(entry)}
    </li>
  `;
}

function renderStandardRow(entry, index, sectionTitle) {
  return `
    <li class="moveset-row ${isAdditionalEntry(entry) ? "tail-entry" : ""}">
      <span class="entry-left">
        <span class="entry-rank">${index + 1}.</span>
        <span>${renderPlainEntryName(entry.name, sectionTitle)}</span>
      </span>
      ${renderEntryValue(entry)}
    </li>
  `;
}

function renderEntryValue(entry) {
  if (typeof entry.usage === "number") {
    return `<strong>${entry.usage.toFixed(1)}%</strong>`;
  }

  return renderSourceLine(entry);
}

function renderSourceLine(entry) {
  const full = entry.sourceText || "";
  const compact = compactSourceText(full);

  return `
    <span class="entry-meta source-meta" title="${escapeAttr(full)}">
      ${escapeHtml(compact)}
    </span>
  `;
}

function compactSourceText(value) {
  return String(value || "")
    .replace(/\s+—\s+/g, " · ")
    .replace(/\s+\((\d+)\/(\d+) mo\)/g, " $1/$2 mo")
    .replace("alternate Mega form", "alt Mega")
    .replace("pre-evolution", "pre-evo")
    .replace("base form", "base");
}

function isAdditionalEntry(entry) {
  return entry.kind === "fallback" || entry.kind === "additional";
}

function renderPlainEntryName(name, sectionTitle) {
  return escapeHtml(formatEntryName(name, sectionTitle));
}

function badgeStyle(color) {
  return `border-color:${color};color:${color};`;
}

function formatEntryName(name, sectionTitle) {
  return sectionTitle === "Spreads" ? prettyPrintSpread(name) : name;
}

function prettyPrintSpread(value) {
  const parts = value.split(":");
  if (parts.length !== 2) return value;

  const [nature, evs] = parts;
  const evParts = evs.split("/");
  if (evParts.length !== 6) return value;

  const rendered = evParts
    .map((ev, index) => {
      const amount = Number.parseInt(ev, 10);
      if (!Number.isFinite(amount) || amount <= 0) return null;
      return `${amount} ${SPREAD_STATS[index]}`;
    })
    .filter(Boolean);

  return rendered.length > 0 ? `${nature} — ${rendered.join(" / ")}` : nature;
}

function bindMoveInteractions(container) {
  const moveRows = [
    ...container.querySelectorAll(
      ".move-entry[data-move-type][data-move-category]",
    ),
  ];

  if (!moveRows.length) return;

  const statusNode = container.querySelector(".moves-filter-status");
  const clearButton = container.querySelector(".moves-filter-clear");
  let lockedFilter = null;

  const applyLockedFilter = () => {
    for (const row of moveRows) {
      row.classList.remove("move-filter-hidden");

      if (
        lockedFilter &&
        (row.dataset.moveType !== lockedFilter.type ||
          row.dataset.moveCategory !== lockedFilter.category)
      ) {
        row.classList.add("move-filter-hidden");
      }
    }

    if (statusNode) {
      statusNode.textContent = lockedFilter
        ? `Showing only ${lockedFilter.type} + ${lockedFilter.category}`
        : "Showing all moves";
    }

    if (clearButton) clearButton.classList.toggle("hidden", !lockedFilter);
  };

  const clearHover = () => {
    for (const row of moveRows) {
      row.classList.remove("move-match-highlight", "move-hover-source");
    }
  };

  const applyHover = (sourceRow) => {
    const { moveType, moveCategory } = sourceRow.dataset;

    clearHover();

    for (const row of moveRows) {
      if (
        row.dataset.moveType === moveType &&
        row.dataset.moveCategory === moveCategory &&
        !row.classList.contains("move-filter-hidden")
      ) {
        row.classList.add("move-match-highlight");
      }
    }

    sourceRow.classList.add("move-hover-source");
  };

  for (const row of moveRows) {
    row.addEventListener("mouseenter", () => applyHover(row));
    row.addEventListener("mouseleave", clearHover);

    row.addEventListener("click", () => {
      const nextFilter = {
        type: row.dataset.moveType,
        category: row.dataset.moveCategory,
      };

      lockedFilter =
        lockedFilter &&
        lockedFilter.type === nextFilter.type &&
        lockedFilter.category === nextFilter.category
          ? null
          : nextFilter;

      applyLockedFilter();

      if (!row.classList.contains("move-filter-hidden")) applyHover(row);
      else clearHover();
    });
  }

  clearButton?.addEventListener("click", () => {
    lockedFilter = null;
    applyLockedFilter();
    clearHover();
  });

  applyLockedFilter();
}

function cleanEntries(entries = []) {
  return entries.filter(
    (entry) => !HIDDEN_MOVESET_ENTRY_KEYS.has(normalizeKey(entry.name)),
  );
}

function normalizeKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
