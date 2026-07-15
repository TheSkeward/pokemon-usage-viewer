// Explanation layer (roadmap Phase 8): no recommendation is a naked scalar.
// Every seated pick explains its role, its assumptions (ability, evolution
// path, delayed moves), the team holes it patches, and — once the confidence
// sweep lands — how robust its seat is. Notable exclusions explain WHY they
// lost, in the same auditable terms.

import { REBORN_ANALYSIS_TYPES } from "../reborn/typeChart.js";
import { GEN7_PROGRESSION_SPECIES } from "../generated/gen7ProgressionSpecies.generated.js";

const ROLE_LABELS = {
  fast_attacker: "fast attacker",
  bulky_attacker: "bulky attacker",
  specialist_bulky_attacker: "type-resilient bulky attacker",
  tempo_attacker: "Speed Boost tempo attacker",
  bulky_utility: "bulky utility",
  fast_utility: "fast utility",
  priority_utility: "priority utility",
};

function speciesName(id) {
  return GEN7_PROGRESSION_SPECIES[id]?.name || id;
}

function formatPercent(fraction) {
  return `${Math.round(fraction * 100)}%`;
}

// Types where this member is the team's best real answer (its A value is the
// team max and represents a genuine hit) — "what hole does this pick patch?".
function coverageContribution(choice, team) {
  const vector = choice.legalityProfile?.coverageVector;
  if (!vector) return [];
  const contributions = [];
  for (let i = 0; i < REBORN_ANALYSIS_TYPES.length; i++) {
    const value = vector[i] || 0;
    if (value < 0.45) continue;
    const isBest = team.every((other) => {
      if (other === choice) return true;
      return (other.legalityProfile?.coverageVector?.[i] || 0) <= value + 1e-9;
    });
    if (isBest) contributions.push(REBORN_ANALYSIS_TYPES[i]);
  }
  return contributions;
}

export function explainSeatedChoice(choice, team, confidenceEntry) {
  const lines = [];
  const profile = choice.legalityProfile || {};
  const features = choice.currentFeatures || {};

  const role = ROLE_LABELS[choice.currentRole] || choice.currentRole || "pick";
  const featureBits = [];
  if (features.damage_q != null)
    featureBits.push(`damage ${formatPercent(features.damage_q)}`);
  if (features.speed_q != null)
    featureBits.push(`speed ${formatPercent(features.speed_q)}`);
  if (
    choice.currentRole === "tempo_attacker" &&
    features.tempo_speed_q != null
  ) {
    featureBits.push(
      `after one boost ${formatPercent(features.tempo_speed_q)}`,
    );
    if (features.tempo_reliability_q) featureBits.push("protected ramp");
  }
  if (
    choice.currentRole === "specialist_bulky_attacker" &&
    features.physical_bulk_q != null &&
    features.special_bulk_q != null
  ) {
    featureBits.push(
      `best-side bulk ${formatPercent(
        Math.max(features.physical_bulk_q, features.special_bulk_q),
      )}`,
    );
    if (features.type_resilience_q != null) {
      featureBits.push(
        `type resilience ${formatPercent(features.type_resilience_q)}`,
      );
    }
  } else if (
    ["bulky_attacker", "bulky_utility"].includes(choice.currentRole) &&
    features.effective_bulk_q != null
  ) {
    featureBits.push(
      `effective bulk ${formatPercent(features.effective_bulk_q)}`,
    );
    if (
      features.bulk_q != null &&
      features.type_resilience_q != null
    ) {
      featureBits.push(
        `raw bulk ${formatPercent(features.bulk_q)}, type resilience ${formatPercent(features.type_resilience_q)}`,
      );
    }
  } else if (
    choice.currentRole === "fast_attacker" &&
    features.fast_attacker_penalty_q != null
  ) {
    featureBits.push(
      `effective bulk ${formatPercent(features.effective_bulk_q || 0)}`,
    );
    if (features.fast_attacker_penalty_q >= 0.005) {
      featureBits.push(
        `frailty discount ${formatPercent(features.fast_attacker_penalty_q)}`,
      );
    }
  } else if (features.bulk_q != null) {
    featureBits.push(`bulk ${formatPercent(features.bulk_q)}`);
  }
  lines.push(`Seats as ${role} (${featureBits.join(", ")}).`);

  if (choice.buildKey && choice.buildKey !== "default") {
    lines.push(`Runs the ${choice.buildLabel || choice.buildKey} build.`);
  }

  const moves = (profile.recommendedMoves || []).map((move) => move.name);
  if (moves.length) lines.push(`Set: ${moves.join(" / ")}.`);

  if (profile.preMegaAbility && profile.assumedAbility) {
    const sameAbility =
      profile.preMegaAbility.toLowerCase() ===
      profile.assumedAbility.toLowerCase();
    const sensitivity = choice.abilitySensitivity || 0;
    if (profile.abilityKnown) {
      lines.push(
        sameAbility
          ? `Ability: ${profile.preMegaAbility} (yours), retained after Mega Evolution.`
          : `Ability path: ${profile.preMegaAbility} (yours), then ${profile.assumedAbility} after Mega Evolution.`,
      );
    } else {
      const path = sameAbility
        ? `${profile.preMegaAbility} before and after Mega Evolution`
        : `${profile.preMegaAbility} before Mega Evolution, then ${profile.assumedAbility}`;
      lines.push(
        sensitivity > 100
          ? `Assumes ${path} â€” the score leans on the starting ability (âˆ’${sensitivity} with the other ability); pin it with "${choice.inputName} (${profile.preMegaAbility})" if yours matches.`
          : `Assumes ${path}; the starting ability is not required for inclusion (âˆ’${sensitivity} with the other ability).`,
      );
    }
  } else if (profile.assumedAbility) {
    if (profile.abilityKnown) {
      lines.push(`Ability: ${profile.assumedAbility} (yours).`);
    } else {
      const sensitivity = choice.abilitySensitivity || 0;
      lines.push(
        sensitivity > 100
          ? `Assumes ${profile.assumedAbility} — the score leans on it (−${sensitivity} with the other ability); pin it with "${choice.inputName} (${profile.assumedAbility})" if yours matches.`
          : `Assumes ${profile.assumedAbility}; not required for inclusion (−${sensitivity} with the other ability).`,
      );
    }
  }

  const steps = profile.legalityProof?.evolutionSteps || [];
  if (steps.length) {
    const path = steps
      .map((step) =>
        step.friction
          ? `${speciesName(step.to)} (${step.reason}, K ${step.friction})`
          : `${speciesName(step.to)} (${step.reason})`,
      )
      .join(" → ");
    lines.push(`Evolution path: ${path}.`);
  }
  const delayed = profile.legalityProof?.delayedMoves || [];
  if (delayed.length) {
    lines.push(
      `Requires delayed evolution for ${delayed
        .map((move) => `${move.name} (${move.source})`)
        .join(", ")} — K ${profile.legalityProof.buildFriction}.`,
    );
  }
  const blocked = profile.legalityProof?.blockedEvolutions || [];
  if (blocked.length) {
    lines.push(
      `Not assumed: ${blocked
        .map((entry) => `${speciesName(entry.to)} (${entry.reason})`)
        .join("; ")}.`,
    );
  }

  const patches = coverageContribution(choice, team);
  if (patches.length) {
    lines.push(`Team's best answer into ${patches.join("/")}.`);
  }

  if (confidenceEntry) {
    const drop = confidenceEntry.dropConditions?.length
      ? ` Drops under: ${confidenceEntry.dropConditions.join(", ")}.`
      : "";
    lines.push(
      `Appears in ${formatPercent(confidenceEntry.frequency)} of robustness settings (${confidenceEntry.tier}).${drop}`,
    );
  }

  return lines;
}

export function explainExcludedChoice(choice, result, confidenceAlternative) {
  const lines = [];
  const team = result.team || [];
  const weakest = [...team].sort(
    (a, b) => (a.teamScore ?? 0) - (b.teamScore ?? 0),
  )[0];

  if (weakest && (choice.teamScore ?? 0) < (weakest.teamScore ?? 0)) {
    lines.push(
      `Lower current value than the weakest seat (${Math.round(choice.teamScore ?? 0)} vs ${weakest.inputName} ${Math.round(weakest.teamScore ?? 0)}).`,
    );
  }

  const patches = coverageContribution(choice, [...team, choice]);
  if (!patches.length) {
    lines.push("Coverage redundant: adds no answer the team lacks.");
  } else {
    lines.push(`Would add coverage into ${patches.join("/")}.`);
  }

  if ((choice.friction || 0) > 0) {
    lines.push(`Carries friction K ${Math.round(choice.friction)} (evolution requirements).`);
  }
  const blocked = choice.legalityProfile?.legalityProof?.blockedEvolutions || [];
  if (blocked.length) {
    lines.push(
      `Better forms unavailable: ${blocked
        .map((entry) => `${speciesName(entry.to)} — ${entry.reason}`)
        .join("; ")}.`,
    );
  }
  if ((choice.online ?? 1) < 0.35) {
    lines.push(
      "Readiness gate: cannot express its line's strength at this stage.",
    );
  }
  if (confidenceAlternative) {
    lines.push(
      `Seats in ${formatPercent(confidenceAlternative.frequency)} of robustness settings — a genuine flex option.`,
    );
  }

  return lines;
}
