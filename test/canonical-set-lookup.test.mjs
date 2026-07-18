// Display contract for the Set Lookup results table: the headline Usage % and
// Source cells speak CANONICAL-tier language — the first tier the mon is
// meaningfully played in (best trace tier below the bar), the same sourcing
// policy the team builder uses — with the shallowest-appearance row (typically
// AG @ 1760 noise) demoted to an explicit fallback line. Renders with a stub
// container; no optimizer, no fetches.
import test from "node:test";
import assert from "node:assert/strict";

globalThis.__ENV__ ??= { BASE_URL: "/" };
const { renderResolverResults } = await import(
  "../src/views/resolverResultsView.js"
);

const FORMATS_INDEX = [
  { id: "gen7anythinggoes", label: "Gen 7 AG" },
  { id: "gen7uu", label: "Gen 7 UU" },
  { id: "gen7zu", label: "Gen 7 ZU" },
];

function renderToHtml(rows) {
  const container = { innerHTML: "" };
  renderResolverResults(
    container,
    rows,
    { resolverQuery: "query", resolverSelectedPokemon: null },
    FORMATS_INDEX,
    "All available",
  );
  return container.innerHTML;
}

function row(pokemonId, bundle) {
  return { pokemonId, name: pokemonId, inputName: pokemonId, bundle };
}

test("ranked mon headlines its meaningful tier, AG appearance demoted to fallback", () => {
  // Scizor-shaped: meaningful in UU at 42.74%, headline appearance AG @ 0.41%.
  const html = renderToHtml([
    row("scizor", {
      usage: {
        selection: "all", formatId: "gen7anythinggoes", cutoff: 1760,
        monthsAvailable: 73, monthsPresent: 70, value: 0.41,
      },
      leads: null,
      ranking: { tierRank: 12, formatId: "gen7uu", cutoff: 1760, value: 42.74 },
      trace: null,
    }),
  ]);
  assert.match(html, /Gen 7 UU @ 1760 — canonical/);
  // The Usage % cell carries the meaningful-tier value; the AG appearance
  // value must not surface anywhere in the row.
  assert.match(html, /<td>42\.74<\/td>/);
  assert.doesNotMatch(html, /0\.41/);
  assert.match(html, /fallback: Gen 7 AG @ 1760/);
});

test("never-meaningful mon headlines its trace tier, labeled as trace", () => {
  // Beedrill-shaped: no ranking anywhere, trace in ZU at 1.00%, AG appearance.
  const html = renderToHtml([
    row("beedrill", {
      usage: {
        selection: "all", formatId: "gen7anythinggoes", cutoff: 1760,
        monthsAvailable: 73, monthsPresent: 70, value: 0.0045,
      },
      leads: null,
      ranking: null,
      trace: { tierRank: 31, formatId: "gen7zu", cutoff: 0, value: 1.0 },
    }),
  ]);
  assert.match(html, /Gen 7 ZU @ 0 — canonical \(trace\)/);
  assert.match(html, /fallback: Gen 7 AG @ 1760/);
});

test("mon with only a shallow appearance keeps the old plain source cell", () => {
  const html = renderToHtml([
    row("unown", {
      usage: {
        selection: "all", formatId: "gen7anythinggoes", cutoff: 1760,
        monthsAvailable: 73, monthsPresent: 12, value: 0.001,
      },
      leads: null,
      ranking: null,
      trace: null,
    }),
  ]);
  // No canonical badge in the ROW (the header explainer may use the word).
  assert.doesNotMatch(html, /— canonical/);
  assert.match(html, /Gen 7 AG @ 1760/);
});
