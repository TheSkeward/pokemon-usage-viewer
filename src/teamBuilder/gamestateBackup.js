// Gamestate backup (user ask: "this should be a quick fix... I prefer the
// version with a downloadable file"). Everything that defines a playthrough
// lives in localStorage — the pool text, the full Reborn progression
// (badge/caps, TM/tutor checks, item inventory, evolution access, bias), and
// the scoring model — and localStorage is one browser-data clear away from
// gone. This module is the pure serialize/parse half; the widget wires it to
// a download link and a file picker.

const FORMAT = "pokemon-usage-viewer-gamestate";
const VERSION = 1;

export function buildGamestateExport({ query, progression, scoringModel }) {
  return JSON.stringify(
    {
      format: FORMAT,
      version: VERSION,
      exportedAt: new Date().toISOString(),
      pool: String(query || ""),
      progression: progression || {},
      scoringModel: scoringModel === "v0" ? "v0" : "v1",
    },
    null,
    2,
  );
}

// Parses an export back into {pool, progression, scoringModel}; throws with
// a human-readable message on anything that isn't a gamestate file. The
// progression object is passed through as-is — the caller routes it through
// the normal save/load path so normalizeRebornProgression sanitizes it the
// same way it sanitizes every other stored progression.
export function parseGamestateImport(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Not a JSON file.");
  }
  if (parsed?.format !== FORMAT) {
    throw new Error("Not a gamestate export from this tool.");
  }
  if (parsed.version !== VERSION) {
    throw new Error(
      `Unsupported gamestate version ${parsed.version} (this build reads v${VERSION}).`,
    );
  }
  if (typeof parsed.pool !== "string") {
    throw new Error("Gamestate file has no pool text.");
  }
  if (parsed.progression == null || typeof parsed.progression !== "object") {
    throw new Error("Gamestate file has no progression.");
  }
  return {
    pool: parsed.pool,
    progression: parsed.progression,
    scoringModel: parsed.scoringModel === "v0" ? "v0" : "v1",
  };
}

export function gamestateFileName(now = new Date()) {
  return `reborn-gamestate-${now.toISOString().slice(0, 10)}.json`;
}
