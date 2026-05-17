import { getTypeColor } from "../moveMeta";
import {
  buildRebornTeamAnalysis,
  REBORN_ANALYSIS_TYPES,
} from "./teamAnalysis";

export function renderRebornTeamAnalysisPanel(root, { progression, team }) {
  if (!root) return;

  if (!team?.length) {
    root.innerHTML = "";
    return;
  }

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

  buildRebornTeamAnalysis(team, progression)
    .then((analysis) => {
      root.innerHTML = renderAnalysis(analysis);
    })
    .catch((error) => {
      console.error("Failed to build Reborn team analysis", error);
      root.innerHTML = `
        <section class="panel reborn-team-analysis-panel">
          <h2>Team Analysis</h2>
          <p class="muted">Team analysis could not be loaded.</p>
        </section>
      `;
    });
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
      <div class="panel-header">
        <div>
          <h2>Team Analysis</h2>
          <p>${analysis.members.length} picks checked against current Reborn progression settings.</p>
        </div>
      </div>

      <div class="team-analysis-grid">
        ${renderSummaryCard({
          label: "Shared Weaknesses",
          value: sharedWeaknesses.length,
          detail: sharedWeaknesses.length
            ? sharedWeaknesses.slice(0, 3).map((entry) => entry.type).join(", ")
            : "No attack type hits multiple picks super effectively.",
        })}
        ${renderSummaryCard({
          label: "No Defensive Cover",
          value: uncoveredWeaknesses.length,
          detail: uncoveredWeaknesses.length
            ? uncoveredWeaknesses.slice(0, 3).map((entry) => entry.type).join(", ")
            : "Every shared weakness has at least one resist or immunity.",
        })}
        ${renderSummaryCard({
          label: "Legal Attack Types",
          value: analysis.offensive.attackingTypes.length,
          detail: analysis.offensive.attackingTypes.length
            ? "Damaging move types available through current progression."
            : "No legal attacking moves found yet.",
        })}
        ${renderSummaryCard({
          label: "Legal STAB",
          value: `${analysis.members.length - analysis.offensive.missingStabMembers.length}/${analysis.members.length}`,
          detail: analysis.offensive.missingStabMembers.length
            ? `No current STAB for ${analysis.offensive.missingStabMembers
                .slice(0, 3)
                .map((entry) => entry.member.name)
                .join(", ")}.`
            : "Every pick has at least one legal damaging STAB move.",
        })}
        ${renderSummaryCard({
          label: "Missing Coverage",
          value: analysis.offensive.missingSuperEffectiveTargets.length,
          detail: analysis.offensive.missingSuperEffectiveTargets.length
            ? `No super-effective legal hit for ${analysis.offensive.missingSuperEffectiveTargets.slice(0, 4).join(", ")}.`
            : "Current legal attacks can hit every type super effectively.",
        })}
      </div>

      <div class="team-analysis-columns">
        <div>
          <h3>Defensive Profile</h3>
          ${renderDefensiveRows(sharedWeaknesses, sturdySwitchTypes)}
        </div>
        <div>
          <h3>Legal Coverage</h3>
          ${renderOffensiveRows(analysis.offensive)}
        </div>
      </div>
    </section>
  `;
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

function renderOffensiveRows(offensive) {
  return `
    <div class="team-analysis-block">
      <h4>Best current STAB</h4>
      ${
        offensive.memberStab.length
          ? offensive.memberStab.map(renderStabRow).join("")
          : `<p class="muted">No legal STAB moves are available under current progression settings.</p>`
      }
    </div>

    <div class="team-analysis-block">
      <h4>Available attacking types</h4>
      ${
        offensive.attackingTypes.length
          ? offensive.attackingTypes
              .map(
                (entry) => `
                  <div class="team-analysis-row">
                    ${renderTypeBadge(entry.type)}
                    <strong>${entry.moveCount} moves</strong>
                    <span>${entry.stabMembers.length} STAB</span>
                    <small>${escapeHtml(formatAttackTypeDetail(entry))}</small>
                  </div>
                `,
              )
              .join("")
          : `<p class="muted">No legal attacking moves are available under current progression settings.</p>`
      }
    </div>

    <div class="team-analysis-block">
      <h4>Weakest super-effective hits</h4>
      ${
        offensive.bestCoverageByTarget.length
          ? offensive.bestCoverageByTarget
              .slice(0, 8)
              .map(renderCoverageTargetRow)
              .join("")
          : `<p class="muted">No super-effective legal hits are available yet.</p>`
      }
    </div>

    <div class="team-analysis-block">
      <h4>Missing super-effective coverage</h4>
      ${
        offensive.missingSuperEffectiveTargets.length
          ? `<div class="team-analysis-chip-list">${offensive.missingSuperEffectiveTargets.map(renderTypeBadge).join("")}</div>`
          : `<p class="muted">Current legal attacks include at least one super-effective option into every type.</p>`
      }
    </div>
  `;
}

function renderStabRow(entry) {
  const bestMove = entry.bestMove;

  return `
    <div class="team-analysis-move-row ${bestMove ? "" : "warning"}">
      <strong>${escapeHtml(entry.member.name)}</strong>
      ${
        bestMove
          ? `${renderTypeBadge(bestMove.type)}<span>${escapeHtml(bestMove.name)}</span><small>${formatPower(bestMove.basePower)} base power</small>`
          : `<span class="team-analysis-empty-cell">No legal damaging STAB</span>`
      }
    </div>
  `;
}

function renderCoverageTargetRow(entry) {
  const best = entry.best;

  return `
    <div class="team-analysis-row ${best ? "" : "warning"}">
      ${renderTypeBadge(entry.type)}
      <strong>${best ? formatPower(best.adjustedPower) : "none"}</strong>
      <span>${best ? escapeHtml(best.attackType) : "missing"}</span>
      <small>${
        best
          ? escapeHtml(`${best.moveName} from ${best.memberName}`)
          : "No legal super-effective hit"
      }</small>
    </div>
  `;
}

function formatAttackTypeDetail(entry) {
  const best = entry.bestMove;
  const memberText = entry.members.length
    ? entry.members.slice(0, 3).join(", ")
    : "No picks";
  const overflow = entry.members.length > 3 ? ` +${entry.members.length - 3}` : "";

  if (!best) return `${memberText}${overflow}`;

  return `${best.name} from ${best.memberName}; ${memberText}${overflow}`;
}

function formatPower(value) {
  if (!Number.isFinite(value)) return "";

  return Math.round(value).toLocaleString();
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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
