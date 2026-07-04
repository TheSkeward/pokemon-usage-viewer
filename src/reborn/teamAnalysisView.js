import { escapeHtml } from "../utils/html.js";
import { getTypeColor } from "../moveMeta";
import { toId } from "../utils/ids.js";
import { describeEvolutionPath } from "./evolutionRequirements.js";
import {
  buildRebornTeamAnalysis,
  formatTeamPokepaste,
  REBORN_ANALYSIS_TYPES,
} from "./teamAnalysis";

// The page re-renders several times per optimize (result render, analysis-
// pending render, confidence render, investment render) with IDENTICAL panel
// inputs, and the underlying analysis (per-member legal-move entries, damage
// tables, bench swaps) is the most expensive thing on the page — so memo the
// build by input signature and re-paint from it. This also stops the panel
// flashing back to its "Checking..." placeholder on every re-render.
let analysisMemo = { key: null, promise: null };

export function renderRebornTeamAnalysisPanel(root, {
  family,
  itemAssignments,
  lines = [],
  pokemonIndex = [],
  poolQuery = "",
  progression,
  selection,
  team,
}) {
  if (!root) return;

  if (!team?.length) {
    root.innerHTML = "";
    return;
  }

  const memoKey = JSON.stringify([
    team.map((member) => `${member.pokemonId}|${member.buildKey || ""}`),
    itemAssignments || null,
    progression || null,
    family || "",
    selection || "",
    poolQuery,
  ]);

  if (analysisMemo.key !== memoKey) {
    const memo = {
      key: memoKey,
      settled: false,
      promise: buildRebornTeamAnalysis(team, progression, {
        family,
        itemAssignments,
        lines,
        pokemonIndex,
        query: poolQuery,
        selection,
      })
        .catch((error) => {
          console.error("Failed to build Reborn team analysis", error);
          return null;
        })
        .then((analysis) => {
          memo.settled = true;
          return analysis;
        }),
    };
    analysisMemo = memo;
  }
  if (!analysisMemo.settled) {
    root.innerHTML = `
      <section class="panel reborn-team-analysis-panel">
        <div class="panel-header">
          <div>
            <h2>Team Analysis</h2>
            <p class="muted">Checking defensive profile and legal attacking coverage...</p>
          </div>
        </div>
      </section>
    `;
  }

  // Returned so callers can sequence heavy background work (the confidence
  // sweep) AFTER the movesets are actually on screen. Resolves on failure too —
  // it signals "the panel is settled", not "the analysis succeeded".
  return analysisMemo.promise.then((analysis) => {
    if (!root.isConnected) return; // this render was superseded by a newer one
    if (analysis) {
      root.innerHTML = renderAnalysis(analysis);
      wirePokepasteCopy(root, analysis);
    } else {
      root.innerHTML = `
        <section class="panel reborn-team-analysis-panel">
          <h2>Team Analysis</h2>
          <p class="muted">Team analysis could not be loaded.</p>
        </section>
      `;
    }
  });
}

function wirePokepasteCopy(root, analysis) {
  // Bind every copy button on the page, not just the one inside this panel —
  // the modern layout puts a second one in the team-table header.
  const scope = root.ownerDocument || document;
  const buttons = scope.querySelectorAll("[data-copy-pokepaste]");
  if (!buttons.length) return;

  const pokepaste = formatTeamPokepaste(
    analysis.profiles.map((profile) => profile.recommendedSet),
  );

  for (const button of buttons) {
    if (button.dataset.pokepasteWired) continue;
    button.dataset.pokepasteWired = "1";
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(pokepaste);
        button.textContent = "Copied!";
      } catch {
        button.textContent = "Copy failed";
      }
      setTimeout(() => {
        button.textContent = "Copy team as poképaste";
      }, 2000);
    });
  }
}

function renderAnalysis(analysis) {
  const sharedWeaknesses = analysis.defensive
    .filter((entry) => entry.weak.length >= 2)
    .sort(
      (a, b) =>
        b.weak.length - a.weak.length ||
        getCoverCount(a) - getCoverCount(b) ||
        a.type.localeCompare(b.type),
    );

  const uncoveredWeaknesses = sharedWeaknesses.filter(
    (entry) => entry.resist.length + entry.immune.length === 0,
  );

  const sturdySwitchTypes = analysis.defensive
    .filter((entry) => entry.resist.length + entry.immune.length >= 2)
    .sort(
      (a, b) =>
        getCoverCount(b) - getCoverCount(a) ||
        a.weak.length - b.weak.length ||
        a.type.localeCompare(b.type),
    );

  return `
    <section class="panel reborn-team-analysis-panel">
      <div class="panel-header team-analysis-header">
        <div>
          <h2>Team Analysis</h2>
          <p>${analysis.members.length} picks at the current Reborn progression. Damage shown is naive unresisted output at your level cap.</p>
        </div>
        <button type="button" class="view-tab" data-copy-pokepaste>Copy team as poképaste</button>
      </div>

      <div class="team-analysis-grid">
        ${renderSummaryCard({
          label: "Shared Weaknesses",
          value: sharedWeaknesses.length,
          detail: sharedWeaknesses.length
            ? sharedWeaknesses.slice(0, 3).map((entry) => entry.type).join(", ")
            : "No type hits 2+ picks super effectively.",
        })}
        ${renderSummaryCard({
          label: "Weaknesses with no switch-in",
          value: uncoveredWeaknesses.length,
          detail: uncoveredWeaknesses.length
            ? uncoveredWeaknesses.slice(0, 3).map((entry) => entry.type).join(", ")
            : "Every shared weakness has a resist or immunity.",
        })}
        ${renderSummaryCard({
          label: "Picks with a STAB attack",
          value: `${analysis.members.length - analysis.offensive.missingStabMembers.length}/${analysis.members.length}`,
          detail: analysis.offensive.missingStabMembers.length
            ? `No STAB yet: ${analysis.offensive.missingStabMembers
                .slice(0, 3)
                .map((entry) => entry.member.name)
                .join(", ")}.`
            : "Every pick has a recommended damaging STAB move.",
        })}
        ${renderSummaryCard({
          label: "Types with no SE answer",
          value: analysis.offensive.missingSuperEffectiveTargets.length,
          detail: analysis.offensive.missingSuperEffectiveTargets.length
            ? analysis.offensive.missingSuperEffectiveTargets.slice(0, 4).join(", ")
            : "The team can hit every type super effectively.",
        })}
      </div>

      <h3>Recommended Sets</h3>
      ${renderSetCards(analysis.profiles)}

      ${renderExplanation(analysis.explanation)}

      <div class="team-analysis-columns">
        <div>
          <h3>Defensive Profile</h3>
          ${renderDefensiveRows(sharedWeaknesses, sturdySwitchTypes)}
        </div>
        <div>
          <h3>Team Coverage</h3>
          ${renderCoverageSummary(analysis.offensive)}
        </div>
      </div>
    </section>
  `;
}

function renderExplanation(explanation) {
  if (!explanation) return "";

  return `
    <section class="team-analysis-explanation">
      <div>
        <h3>Why This Team?</h3>
        ${renderExplanationList(explanation.pickReasons)}
      </div>
      <div>
        <h3>Team Holes</h3>
        ${renderExplanationList(explanation.holes)}
      </div>
      <div>
        <h3>Possible Fixes</h3>
        ${renderExplanationList(explanation.fixSuggestions)}
      </div>
    </section>
  `;
}

function renderExplanationList(items = []) {
  if (!items.length) {
    return `<p class="muted">No major issues found in this slice of the analysis.</p>`;
  }

  return `
    <ul class="team-analysis-explanation-list">
      ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
    </ul>
  `;
}

function renderSetCards(profiles = []) {
  if (!profiles.length) {
    return `<p class="muted">No recommended sets are available yet.</p>`;
  }

  return `
    <div class="team-set-cards">
      ${profiles.map(renderSetCard).join("")}
    </div>
  `;
}

function renderSetCard(profile) {
  const set = profile.recommendedSet || {};
  const eventual =
    profile.representativeName &&
    profile.representativeName !== profile.currentName
      ? profile.representativeName
      : null;
  const subParts = [
    profile.inputName && profile.inputName !== profile.currentName
      ? // "from Burmy@20 (Female, in buildings)" — what the input mon needs to
        // become this form; empty when the input isn't its pre-evolution.
        `from ${profile.inputName}${describeEvolutionPath(
          toId(profile.inputName),
          profile.currentId,
        )}`
      : null,
    eventual ? `→ ${eventual} later` : null,
  ].filter(Boolean);
  const meta = [
    set.item || "No item recommended",
    set.ability,
    set.level ? `Lv ${set.level}` : null,
    set.nature ? `${set.nature} nature` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const evs = formatEvs(set.evs);
  const moves = profile.recommendedMoves?.length ? profile.recommendedMoves : [];

  return `
    <div class="team-set-card ${profile.bestStabMove ? "" : "warning"}" data-set-card="${escapeHtml(profile.currentId || "")}">
      <div class="team-set-head">
        <strong>${escapeHtml(profile.currentName)}</strong>
        ${subParts.length ? `<small>${escapeHtml(subParts.join(" · "))}</small>` : ""}
      </div>
      <div class="team-set-meta">${escapeHtml(meta)}</div>
      ${evs ? `<div class="team-set-evs">${escapeHtml(evs)}</div>` : ""}
      <div class="team-set-moves">
        ${
          moves.length
            ? moves.map(renderSetMove).join("")
            : `<small class="muted">No legal damaging moves available yet.</small>`
        }
      </div>
      <div class="team-set-foot">
        <small>${profile.superEffectiveTargetCount}/${REBORN_ANALYSIS_TYPES.length} types hit super effectively</small>
      </div>
    </div>
  `;
}

function renderSetMove(move) {
  return `
    <div class="team-set-move">
      ${renderTypeBadge(move.type)}
      <span class="team-set-move-name">${escapeHtml(move.name)}</span>
      <span class="team-set-move-dmg">${escapeHtml(formatDamage(move))}</span>
      <span class="team-set-move-src">${escapeHtml(move.sourceLabel || "Legal")}</span>
    </div>
  `;
}

function formatEvs(evs) {
  if (!Array.isArray(evs)) return "";
  const labels = ["HP", "Atk", "Def", "SpA", "SpD", "Spe"];
  const parts = evs
    .map((value, index) => (value > 0 ? `${value} ${labels[index]}` : null))
    .filter(Boolean);
  return parts.length ? `EVs: ${parts.join(" / ")}` : "";
}

function renderSummaryCard({ detail, label, value }) {
  return `
    <div class="team-analysis-summary-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <p>${escapeHtml(detail)}</p>
    </div>
  `;
}

function renderDefensiveRows(sharedWeaknesses, sturdySwitchTypes) {
  return `
    <div class="team-analysis-block">
      <h4>Shared weaknesses</h4>
      ${
        sharedWeaknesses.length
          ? sharedWeaknesses
              .map((entry) =>
                renderDefenseTypeRow(entry, {
                  primary: `${entry.weak.length} weak`,
                  secondary:
                    entry.immune.length > 0
                      ? `${entry.immune.length} immune`
                      : `${entry.resist.length} resist`,
                }),
              )
              .join("")
          : `<p class="muted">No shared weaknesses across the current picks.</p>`
      }
    </div>

    <div class="team-analysis-block">
      <h4>Resists and immunities</h4>
      ${
        sturdySwitchTypes.length
          ? sturdySwitchTypes
              .slice(0, 8)
              .map((entry) =>
                renderDefenseTypeRow(entry, {
                  primary: `${getCoverCount(entry)} cover`,
                  secondary:
                    entry.weak.length > 0 ? `${entry.weak.length} weak` : "no weak",
                }),
              )
              .join("")
          : `<p class="muted">No attack type has multiple resists or immunities.</p>`
      }
    </div>
  `;
}

function renderDefenseTypeRow(entry, { primary, secondary }) {
  return `
    <div class="team-analysis-row">
      ${renderTypeBadge(entry.type)}
      <strong>${escapeHtml(primary)}</strong>
      <span>${escapeHtml(secondary)}</span>
      <small>${escapeHtml(formatDefenseNames(entry))}</small>
    </div>
  `;
}

function renderCoverageSummary(offensive) {
  const weakestHits = offensive.bestCoverageByTarget
    .filter((entry) => entry.best)
    .slice(0, 6);

  return `
    <div class="team-analysis-block">
      <h4>No super-effective answer</h4>
      ${
        offensive.missingSuperEffectiveTargets.length
          ? `<div class="team-analysis-chip-list">${offensive.missingSuperEffectiveTargets.map(renderTypeBadge).join("")}</div>`
          : `<p class="muted">The recommended attacks hit every type super effectively.</p>`
      }
    </div>

    <div class="team-analysis-block">
      <h4>Thinnest super-effective answers</h4>
      <p class="muted team-analysis-hint">Types you can only hit super effectively with a weak move.</p>
      ${
        weakestHits.length
          ? weakestHits.map(renderCoverageTargetRow).join("")
          : `<p class="muted">No super-effective recommended hits are available yet.</p>`
      }
    </div>
  `;
}

function renderCoverageTargetRow(entry) {
  const best = entry.best;

  return `
    <div class="team-analysis-row ${best ? "" : "warning"}">
      ${renderTypeBadge(entry.type)}
      <strong>${best ? formatPower(best.estimatedDamage) : "none"}</strong>
      <span>${best ? escapeHtml(best.attackType) : "missing"}</span>
      <small>${
        best
          ? escapeHtml(`${best.moveName} from ${best.memberName}`)
          : "No recommended super-effective hit"
      }</small>
    </div>
  `;
}

function formatPower(value) {
  if (!Number.isFinite(value)) return "";

  return Math.round(value).toLocaleString();
}

// "142 dmg · Phys" style label from a formatted move (estimatedDamage + category).
function formatDamage(move) {
  if (!move) return "";

  const damage = Number.isFinite(move.estimatedDamage)
    ? `${formatPower(move.estimatedDamage)} dmg`
    : "";
  const category = formatCategory(move.category);

  if (damage && category) return `${damage} · ${category}`;
  return damage || category;
}

function formatCategory(category) {
  if (category === "Physical") return "Phys";
  if (category === "Special") return "Spec";
  return "";
}

function formatDefenseNames(entry) {
  const weak = entry.weak.map(({ member }) => member.name);
  const cover = [...entry.resist, ...entry.immune].map(({ member }) => member.name);

  if (weak.length && cover.length) {
    return `${weak.join(", ")} covered by ${cover.join(", ")}`;
  }

  if (weak.length) return weak.join(", ");
  if (cover.length) return cover.join(", ");

  return "Neutral across team";
}

function getCoverCount(entry) {
  return entry.resist.length + entry.immune.length;
}

function renderTypeBadge(type) {
  const safeType = REBORN_ANALYSIS_TYPES.includes(type) ? type : "Normal";

  return `
    <span class="move-badge team-analysis-type-badge" style="background:${getTypeColor(safeType)}">
      ${escapeHtml(type)}
    </span>
  `;
}

