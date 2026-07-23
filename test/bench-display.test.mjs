import test from 'node:test';
import assert from 'node:assert/strict';

const { renderBenchLine } = await import(
  '../src/teamBuilder/team-builder-view.js',
);

function scoredLine(inputPokemonId, inputName, displayId, displayName, usage) {
  return {
    best: {
      inputPokemonId,
      inputName,
      pokemonId: displayId,
      name: displayName,
    },
    bestNonMega: null,
    candidates: [
      {
        candidate: { id: displayId, name: displayName },
        bundle: {
          ranking: {
            tierRank: 5,
            value: usage,
            formatId: 'gen7pu',
            cutoff: 1500,
          },
        },
      },
    ],
  };
}

test('bench deduplicates routes and renders the unscored tail unnumbered', () => {
  const html = renderBenchLine({
    team: [],
    lines: [
      scoredLine('ducklett', 'Ducklett', 'swanna', 'Swanna', 4.1),
      scoredLine('swanna', 'Swanna', 'swanna', 'Swanna', 4.1),
    ],
    poolUsageEntries: [
      {
        displayKey: 'swanna',
        inputPokemonId: 'swanna',
        inputName: 'Swanna',
        displayPokemonId: 'swanna',
        displayName: 'Swanna',
        ceiling: {
          pokemonId: 'swanna',
          name: 'Swanna',
          tierRank: 5,
          value: 4.1,
          formatId: 'gen7pu',
          cutoff: 1500,
        },
        trace: null,
        scored: true,
      },
      {
        displayKey: 'lurantis',
        inputPokemonId: 'lurantis',
        inputName: 'Lurantis',
        displayPokemonId: 'lurantis',
        displayName: 'Lurantis',
        ceiling: {
          pokemonId: 'lurantis',
          name: 'Lurantis',
          tierRank: 5,
          value: 4,
          formatId: 'gen7pu',
          cutoff: 1500,
        },
        trace: null,
        scored: false,
      },
    ],
  });

  assert.equal((html.match(/<span class="bench-index/g) || []).length, 1);
  assert.match(html, />1\.<\/span> Swanna <em>4\.1%<\/em>/);
  assert.doesNotMatch(html, /Swanna \(Ducklett\)/);
  assert.match(html, />Lurantis <em>4\.0%<\/em>/);
  assert.match(html, /outside the 126-line scored working set/);
});
